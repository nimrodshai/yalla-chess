// Tournaments: family sign-in by a parent's phone, registering several
// children, fees by country, the PayMe checkout, privacy between families,
// and the school's side from divisions to published results. PayMe is a local
// stub, as in payme.test.mjs.

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { devEnv, signIn, startServer } from './helpers.mjs';

const ADMIN = '+972500000001';
const MPL = 'MPL12345-ABCDEFGH-IJKLMNOP-QRSTUVWX';
const PARENT = '+972521110001';
const OTHER_PARENT = '+972521110002';
const ABROAD_PARENT = '+12025550188';

function json(cookie, body, method = 'POST') {
  return { method, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body) };
}

function startStub() {
  const state = { generated: [], sales: {}, next: 1 };
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {};
      const send = (payload) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(payload)); };
      if (req.url === '/api/generate-sale') {
        state.generated.push(body);
        const id = `SALE-${state.next++}`;
        state.sales[id] = { seller_payme_id: MPL, sale_payme_id: id, transaction_id: body.transaction_id, sale_status: 'initial', sale_price: body.sale_price, sale_currency: body.currency };
        return send({ status_code: 0, sale_url: `https://sandbox.payme.io/sale/${id}`, payme_sale_id: id, payme_sale_code: 77 });
      }
      if (req.url === '/api/get-sales') {
        const items = body.sale_payme_id ? [state.sales[body.sale_payme_id]].filter(Boolean) : [];
        return send({ status_code: 0, items_count: items.length, items });
      }
      return send({ status_code: 1, status_error_code: 1, status_error_details: 'no such call' });
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    state,
    base: `http://127.0.0.1:${server.address().port}/api`,
    close: () => new Promise((done) => server.close(done))
  })));
}

describe('tournaments', () => {
  let stub;
  let server;
  let admin;
  let family;
  let otherFamily;
  let abroadFamily;
  const kids = {};

  const staff = async (path, init) => {
    const response = await server.fetch(`/api/business${path}`, init || { headers: { Cookie: admin.cookie } });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    return body;
  };
  const portal = (who, path, body) => server.fetch(`/api/tournaments${path}`, body === undefined ? { headers: { Cookie: who.cookie } } : json(who.cookie, body));
  const view = async (who, id) => {
    const body = await (await portal(who, '')).json();
    return id ? body.tournaments.find((tournament) => tournament.id === id) : body;
  };
  const addStudent = async (fields) => (await staff('/students', json(admin.cookie, { status: 'active', language: 'he', ...fields }))).student;
  const newTournament = async (fields = {}) => (await staff('/tournaments', json(admin.cookie, {
    name: 'גביע יאללה', nameEn: 'Yalla Cup', startDate: '2099-03-01', startTime: '18:00', status: 'open', ...fields
  }))).tournament;
  const connectPayme = () => staff('/payme', json(admin.cookie, { sellerId: MPL }, 'PUT'));
  const disconnectPayme = () => staff('/payme', json(admin.cookie, { sellerId: '' }, 'PUT'));

  before(async () => {
    stub = await startStub();
    server = await startServer({ ...devEnv, PAYME_ENV: 'sandbox', PAYME_API_BASE: stub.base });
    admin = await signIn(server, ADMIN);
    kids.noa = await addStudent({ firstName: 'Noa', lastName: 'Levi', country: 'IL', age: 9, chesscomRating: 700, chesscomUsername: 'noa_levi', parentFirstName: 'Dana', parentLastName: 'Levi', parentPhone: PARENT });
    kids.tom = await addStudent({ firstName: 'Tom', lastName: 'Levi', country: 'ישראל', age: 13, parentPhone: PARENT });
    kids.ella = await addStudent({ firstName: 'Ella', lastName: 'Cohen', country: 'IL', age: 10, chesscomUsername: 'ella_c', parentPhone: OTHER_PARENT });
    kids.max = await addStudent({ firstName: 'Max', lastName: 'Green', country: 'US', age: 11, chesscomUsername: 'max_g', parentPhone: ABROAD_PARENT });
    family = await signIn(server, PARENT);
    otherFamily = await signIn(server, OTHER_PARENT);
    abroadFamily = await signIn(server, ABROAD_PARENT);
  });

  after(async () => {
    await server?.stop();
    await stub?.close();
  });

  it('lets a parent sign in with the phone on the student, and only that phone', async () => {
    const known = await server.fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: OTHER_PARENT }) });
    assert.equal(known.status, 200);
    const stranger = await server.fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: '+972521119999' }) });
    assert.equal(stranger.status, 403);
  });

  it('shows a parent all their children and nobody else\'s', async () => {
    const body = await view(family);
    assert.deepEqual(body.children.map((child) => child.firstName).sort(), ['Noa', 'Tom']);
  });

  it('keeps drafts away from families and requires a sign-in', async () => {
    const draft = await newTournament({ status: 'draft' });
    assert.equal(await view(family, draft.id), undefined);
    assert.equal((await server.fetch('/api/tournaments')).status, 401);
    assert.equal((await portal(family, `/${draft.id}/register`, { studentIds: [kids.noa.id] })).status, 404);
  });

  it('charges 20 shekels in Israel and 10 dollars abroad', async () => {
    const tournament = await newTournament();
    assert.deepEqual((await view(family, tournament.id)).entries[0].fee, { amount: 20, currency: 'ILS' });
    assert.deepEqual((await view(abroadFamily, tournament.id)).entries[0].fee, { amount: 10, currency: 'USD' });
  });

  it('saves the seat and waits for payment while PayMe is not connected', async () => {
    const tournament = await newTournament();
    const response = await portal(family, `/${tournament.id}/register`, { studentIds: [kids.noa.id] });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.payUrl, '');
    const entry = body.tournaments.find((row) => row.id === tournament.id).entries.find((row) => row.studentId === kids.noa.id);
    assert.equal(entry.status, 'pending');
    assert.equal(entry.joinUrl, '', 'no Chess.com link before payment');
  });

  it('asks for a Chess.com username and keeps it on the student', async () => {
    const tournament = await newTournament();
    const missing = await portal(family, `/${tournament.id}/register`, { studentIds: [kids.tom.id] });
    assert.equal(missing.status, 400);
    assert.equal((await missing.json()).error, 'username');
    const given = await portal(family, `/${tournament.id}/register`, { studentIds: [kids.tom.id], usernames: { [kids.tom.id]: 'tom_levi' } });
    assert.equal(given.status, 200);
    assert.equal((await staff(`/students/${kids.tom.id}`)).student.chesscomUsername, 'tom_levi');
  });

  it('refuses another family\'s child, a double registration and a full tournament', async () => {
    const tournament = await newTournament({ capacity: 1 });
    assert.equal((await portal(otherFamily, `/${tournament.id}/register`, { studentIds: [kids.noa.id] })).status, 404);
    assert.equal((await portal(family, `/${tournament.id}/register`, { studentIds: [kids.noa.id] })).status, 200);
    assert.equal((await (await portal(family, `/${tournament.id}/register`, { studentIds: [kids.noa.id] })).json()).error, 'already');
    const full = await portal(otherFamily, `/${tournament.id}/register`, { studentIds: [kids.ella.id] });
    assert.equal(full.status, 409);
    assert.equal((await full.json()).error, 'full');
  });

  it('refuses a registration after it closed', async () => {
    const tournament = await newTournament({ status: 'closed' });
    const response = await portal(family, `/${tournament.id}/register`, { studentIds: [kids.noa.id] });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error, 'closed');
  });

  it('registers siblings together on one payment and confirms them when PayMe says paid', async () => {
    await connectPayme();
    try {
      const tournament = await newTournament({ chesscomUrl: 'https://www.chess.com/play/tournament/1' });
      const response = await portal(family, `/${tournament.id}/register`, { studentIds: [kids.noa.id, kids.tom.id] });
      const body = await response.json();
      assert.equal(response.status, 200, JSON.stringify(body));
      assert.match(body.payUrl, /sandbox\.payme\.io\/sale\//);
      const generated = stub.state.generated.at(-1);
      assert.equal(generated.sale_price, 4000);
      assert.equal(generated.currency, 'ILS');

      // Paying again opens the same page rather than a second charge.
      const count = stub.state.generated.length;
      assert.equal((await (await portal(family, `/${tournament.id}/pay`, {})).json()).payUrl, body.payUrl);
      assert.equal(stub.state.generated.length, count);

      const saleId = body.payUrl.split('/').at(-1);
      stub.state.sales[saleId].sale_status = 'completed';
      const orderId = generated.transaction_id;
      await staff(`/payme/sales/${orderId}/check`, json(admin.cookie, {}));

      const after = await view(family, tournament.id);
      assert.deepEqual(after.entries.map((entry) => entry.status), ['confirmed', 'confirmed']);
      assert.equal(after.entries[0].joinUrl, 'https://www.chess.com/play/tournament/1');

      // An entry fee is not a lesson payment.
      assert.equal((await staff(`/payments?studentId=${kids.noa.id}`)).payments.length, 0);
      const detail = await staff(`/tournaments/${tournament.id}`);
      assert.deepEqual(detail.tournament.income, { ILS: 40 });

      // A paid seat is not cancelled from the portal.
      const cancel = await portal(family, `/${tournament.id}/cancel`, { studentId: kids.noa.id });
      assert.equal(cancel.status, 409);
      assert.equal((await cancel.json()).error, 'paid');
    } finally {
      await disconnectPayme();
    }
  });

  it('lets the school settle a payment by hand', async () => {
    const tournament = await newTournament({ chesscomUrl: 'https://www.chess.com/play/tournament/2' });
    await portal(otherFamily, `/${tournament.id}/register`, { studentIds: [kids.ella.id] });
    const detail = await staff(`/tournaments/${tournament.id}`);
    const registration = detail.registrations[0];
    await staff(`/tournaments/${tournament.id}/registrations/${registration.id}`, json(admin.cookie, { settled: true, paymentMethod: 'bit' }, 'PATCH'));
    const entry = (await view(otherFamily, tournament.id)).entries[0];
    assert.equal(entry.status, 'confirmed');
    assert.equal(entry.joinUrl, 'https://www.chess.com/play/tournament/2');
  });

  it('places a child by age and rating, and the school can move them', async () => {
    const tournament = await newTournament({ divisions: [
      { name: 'עד 10', maxAge: 10, chesscomUrl: 'https://www.chess.com/play/tournament/young' },
      { name: 'מעל 10', minAge: 11, chesscomUrl: 'https://www.chess.com/play/tournament/old' }
    ] });
    await staff(`/tournaments/${tournament.id}/registrations`, json(admin.cookie, { studentIds: [kids.noa.id, kids.max.id], settled: true, paymentMethod: 'waived' }));
    const detail = await staff(`/tournaments/${tournament.id}`);
    const [young, old] = detail.divisions;
    const noa = detail.registrations.find((row) => row.studentId === kids.noa.id);
    assert.equal(noa.divisionId, young.id);
    assert.equal(detail.registrations.find((row) => row.studentId === kids.max.id).divisionId, old.id);

    await staff(`/tournaments/${tournament.id}/registrations/${noa.id}`, json(admin.cookie, { divisionId: old.id }, 'PATCH'));
    assert.equal((await view(family, tournament.id)).entries.find((entry) => entry.studentId === kids.noa.id).joinUrl, 'https://www.chess.com/play/tournament/old');
    assert.deepEqual((await staff(`/tournaments/${tournament.id}`)).tournament.income, {}, 'a waived fee is not income');
  });

  it('shows other children by first name and initial, with no contact details', async () => {
    const tournament = await newTournament();
    await staff(`/tournaments/${tournament.id}/registrations`, json(admin.cookie, { studentIds: [kids.ella.id], settled: true }));
    const raw = JSON.stringify(await view(family, tournament.id));
    assert.match(raw, /Ella C\./);
    assert.doesNotMatch(raw, /Cohen/);
    assert.doesNotMatch(raw, /ella_c/);
    assert.ok(!raw.includes(OTHER_PARENT));
  });

  it('keeps results private until they are published', async () => {
    const tournament = await newTournament();
    await staff(`/tournaments/${tournament.id}/registrations`, json(admin.cookie, { studentIds: [kids.noa.id, kids.ella.id], settled: true }));
    await staff(`/tournaments/${tournament.id}/results`, json(admin.cookie, { results: [
      { studentId: kids.noa.id, rank: 1, score: 3.5, wins: 3, draws: 1, losses: 0, gamesUrl: 'https://www.chess.com/games/archive/noa_levi' },
      { studentId: kids.ella.id, rank: 2, score: 2, wins: 2, draws: 0, losses: 2 }
    ] }, 'PUT'));
    assert.deepEqual((await view(family, tournament.id)).standings, []);
    assert.equal((await view(family, tournament.id)).entries[0].result, null);

    await staff(`/tournaments/${tournament.id}/publish`, json(admin.cookie, {}));
    const shown = await view(family, tournament.id);
    assert.equal(shown.status, 'finished');
    assert.deepEqual(shown.standings.map((row) => [row.rank, row.name]), [[1, 'Noa L.'], [2, 'Ella C.']]);
    assert.equal(shown.entries.find((entry) => entry.studentId === kids.noa.id).result.score, 3.5);
  });

  it('accepts only real Chess.com links', async () => {
    const response = await server.fetch('/api/business/tournaments', json(admin.cookie, { name: 'X', startDate: '2099-03-01', startTime: '18:00', chesscomUrl: 'https://evil.example/chess.com' }));
    assert.equal(response.status, 400);
  });

  it('lets a teacher enter results without seeing money or parents\' phones', async () => {
    const teacherPhone = '+972521110077';
    await staff('/teachers', json(admin.cookie, { name: 'Coach Test', phone: teacherPhone }));
    const coach = await signIn(server, teacherPhone);
    const tournament = await newTournament();
    await staff(`/tournaments/${tournament.id}/registrations`, json(admin.cookie, { studentIds: [kids.noa.id], settled: true, paymentMethod: 'bit' }));

    const seen = await server.fetch(`/api/business/tournaments/${tournament.id}`, { headers: { Cookie: coach.cookie } });
    assert.equal(seen.status, 200);
    const raw = await seen.text();
    for (const secret of ['feeAmount', 'feeIls', 'income', 'parentPhone', PARENT]) assert.ok(!raw.includes(secret), `a teacher must not see ${secret}`);

    const saved = await server.fetch(`/api/business/tournaments/${tournament.id}/results`, json(coach.cookie, { results: [{ studentId: kids.noa.id, rank: 1 }] }, 'PUT'));
    assert.equal(saved.status, 200);
    assert.equal((await server.fetch(`/api/business/tournaments/${tournament.id}/publish`, json(coach.cookie, {}))).status, 403);
    assert.equal((await server.fetch(`/api/business/tournaments/${tournament.id}`, json(coach.cookie, { status: 'closed' }, 'PATCH'))).status, 403);
  });

  it('does not reuse an entry-fee page as a lesson payment link', async () => {
    await connectPayme();
    try {
      const tournament = await newTournament();
      const registered = await (await portal(otherFamily, `/${tournament.id}/register`, { studentIds: [kids.ella.id] })).json();
      assert.ok(registered.payUrl);
      const lesson = await staff('/payme/sales', json(admin.cookie, { studentId: kids.ella.id, amount: 20, currency: 'ILS' }));
      assert.equal(lesson.reused, false);
      assert.notEqual(lesson.sale.saleUrl, registered.payUrl);
    } finally {
      await disconnectPayme();
    }
  });

  it('keeps the school\'s screens away from families', async () => {
    assert.equal((await server.fetch('/api/business/tournaments', { headers: { Cookie: family.cookie } })).status, 403);
  });
});
