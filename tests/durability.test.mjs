// Tests for the data-integrity defects found during the production audit:
// lost updates under concurrency, and state vanishing on restart.

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

import { devEnv, restartOnSameData, signIn, startServer } from './helpers.mjs';

describe('concurrent writes', () => {
  let server;
  let cookie;

  before(async () => {
    server = await startServer(devEnv);
    ({ cookie } = await signIn(server, '+972500000001'));
  });
  after(async () => { await server.stop(); });

  it('keeps every group when creations overlap', async () => {
    // Handlers read a collection, modify it and write it back with awaits in
    // between. Eight overlapping creations used to leave one group.
    const before = (await (await server.fetch('/api/dashboard', { headers: { Cookie: cookie } })).json()).groups.length;

    const responses = await Promise.all(
      Array.from({ length: 8 }, (_, index) => server.fetch('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ title: `Concurrent ${index}` })
      }))
    );

    for (const response of responses) {
      assert.equal(response.status, 200);
    }

    const dashboard = await (await server.fetch('/api/dashboard', { headers: { Cookie: cookie } })).json();
    const created = dashboard.groups.filter((group) => /Concurrent /.test(JSON.stringify(group.title)));

    assert.equal(created.length, 8, 'no creation may be lost');
    assert.equal(dashboard.groups.length, before + 8);

    const ids = new Set(dashboard.groups.map((group) => group.id));
    assert.equal(ids.size, dashboard.groups.length, 'ids must stay unique');
  });

  it('keeps every user when creations and group edits interleave', async () => {
    const results = await Promise.all([
      ...Array.from({ length: 6 }, (_, index) => server.fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ role: 'student', phone: `+97251000${String(index).padStart(4, '0')}` })
      })),
      ...Array.from({ length: 6 }, (_, index) => server.fetch('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ title: `Mixed ${index}` })
      }))
    ]);

    for (const response of results) {
      assert.equal(response.status, 200);
    }

    const dashboard = await (await server.fetch('/api/dashboard', { headers: { Cookie: cookie } })).json();
    assert.equal(dashboard.users.filter((user) => /^\+97251000/.test(user.phone)).length, 6);
    assert.equal(dashboard.groups.filter((group) => /Mixed /.test(JSON.stringify(group.title))).length, 6);
  });
});

describe('restart', () => {
  it('keeps sessions and data across a restart', async () => {
    const server = await startServer(devEnv);
    const { cookie } = await signIn(server, '+972500000001');

    const created = await server.fetch('/api/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ title: 'Survives restart' })
    });
    assert.equal(created.status, 200);

    const { port, dataDir } = server;
    // Stop the process but keep the data directory for the next boot.
    await server.stopKeepingData();

    const restarted = await restartOnSameData({ port, dataDir, env: devEnv });
    try {
      // Sessions used to live in a Map, so any restart signed everyone out.
      const response = await restarted.fetch('/api/dashboard', { headers: { Cookie: cookie } });
      assert.equal(response.status, 200, 'session must survive a restart');

      const dashboard = await response.json();
      assert.equal(dashboard.user.role, 'admin');
      assert.ok(
        dashboard.groups.some((group) => /Survives restart/.test(JSON.stringify(group.title))),
        'data written before the restart must still be there'
      );

      assert.ok(!/db\.seeded/.test(restarted.output), 'must not re-import seed data');
    } finally {
      await restarted.stop();
      await server.cleanup();
    }
  });
});

describe('price lists', () => {
  it('moves students billed the old way onto price lists without charging them again', async () => {
    const server = await startServer(devEnv);
    const { cookie } = await signIn(server, '+972500000001');
    const post = async (path, body) => (await server.fetch(`/api/business${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body)
    })).json();
    const { businessTimezone } = (await (await server.fetch('/api/business/settings', { headers: { Cookie: cookie } })).json()).settings;
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: businessTimezone }).format(new Date());
    const shift = (days) => new Date(Date.parse(`${today}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

    const overdue = (await post('/students', { firstName: 'Old', lastName: 'Monthly', joinedAt: shift(-200), currency: 'ILS', prices: [] })).student;
    const ahead = (await post('/students', { firstName: 'Paid', lastName: 'Ahead', joinedAt: shift(-200), currency: 'ILS', prices: [] })).student;
    const pack = (await post('/students', { firstName: 'Old', lastName: 'Package', joinedAt: shift(-200), currency: 'ILS', prices: [] })).student;
    await post('/payments', { studentId: overdue.id, amount: 250, currency: 'ILS', paidAt: shift(-100), periodLabel: '' });
    await post('/payments', { studentId: pack.id, amount: 800, currency: 'ILS', paidAt: shift(-10), lessonsCount: 8 });

    const { port, dataDir } = server;
    await server.stopKeepingData();
    // Make them look like records from before price lists.
    const database = new DatabaseSync(join(dataDir, 'yalla-chess.db'));
    const legacy = database.prepare("UPDATE students SET prices = '[]', ledger_from = '', opening_balance = NULL, billing_type = ?, price = ?, package_size = ?, billing_day = NULL, next_payment_at = ? WHERE id = ?");
    legacy.run('monthly', 250, null, shift(-40), overdue.id);
    legacy.run('monthly', 250, null, shift(70), ahead.id);
    legacy.run('package', 100, 8, '', pack.id);
    database.prepare("DELETE FROM settings WHERE key = 'studentPricesMigrated'").run();
    database.close();

    const restarted = await restartOnSameData({ port, dataDir, env: devEnv });
    try {
      const get = async (id) => (await (await restarted.fetch(`/api/business/students/${id}`, { headers: { Cookie: cookie } })).json());

      // Due 40 days ago and again since: two months owed, overdue since the first.
      const late = await get(overdue.id);
      assert.deepEqual(late.student.prices.map(({ kind, model, amount }) => ({ kind, model, amount })), [{ kind: 'group', model: 'monthly', amount: 250 }]);
      assert.equal(late.payment.balance, -500);
      assert.equal(late.payment.nextPaymentAt, shift(-40));
      assert.equal(late.payment.state, 'overdue');

      // Paid until 70 days from now: the billing days before then are covered.
      const early = await get(ahead.id);
      assert.ok(early.payment.balance >= 250, `paid ahead, got ${early.payment.balance}`);
      assert.equal(early.payment.state, 'ok');

      // Eight lessons paid for and none taken: eight lessons of credit.
      const prepaid = await get(pack.id);
      assert.deepEqual(prepaid.student.prices.map(({ model, amount, packageSize }) => ({ model, amount, packageSize })), [{ model: 'package', amount: 800, packageSize: 8 }]);
      assert.equal(prepaid.payment.balance, 800);
    } finally {
      await restarted.stop();
      await server.cleanup();
    }
  });
});
