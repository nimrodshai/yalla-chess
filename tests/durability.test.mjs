// Tests for the data-integrity defects found during the production audit:
// lost updates under concurrency, and state vanishing on restart.

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { devEnv, restartOnSameData, signIn, startServer } from './helpers.mjs';

describe('concurrent writes', () => {
  let server;
  let cookie;

  before(async () => {
    server = await startServer(devEnv);
    ({ cookie } = await signIn(server, '+972500000002'));
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
    const { cookie } = await signIn(server, '+972500000002');

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
      assert.equal(dashboard.user.role, 'teacher');
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
