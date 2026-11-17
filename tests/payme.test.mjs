// PayMe: connecting the seller key, payment links, and payments recorded
// only when PayMe itself confirms them. PayMe is a stub server in this
// process.

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { devEnv, signIn, startServer } from './helpers.mjs';

const ADMIN = '+972500000001';
const MPL = 'MPL16838-TESTTEST-TESTTEST-12345678';

function json(cookie, body, method = 'POST') {
  return { method, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body) };
}

// generate-sale and get-sales. `sales` maps a payme_sale_id to what get-sales
// answers for it; a test changes an entry to say the parent paid.
function startStub() {
  const state = { generated: [], queries: [], sales: {}, next: 1 };
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {};
      const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
      const refuse = (code, details) => send(500, { status_code: 1, status_error_code: code, status_error_details: details, session: 'S1' });
      if (body.seller_payme_id !== MPL) return refuse(251, 'Seller not found');
      if (req.url === '/api/generate-sale') {
        state.generated.push(body);
        const id = `SALE-TEST-${state.next++}`;
        state.sales[id] = { seller_payme_id: MPL, sale_payme_id: id, transaction_id: body.transaction_id, sale_status: 'initial', sale_price: body.sale_price, sale_currency: body.currency, sale_paid_date: null, sale_invoices: {} };
        return send(200, { status_code: 0, sale_url: `https://sandbox.payme.io/sale/generate/${id}`, payme_sale_id: id, payme_sale_code: 4242, price: body.sale_price, transaction_id: body.transaction_id, currency: body.currency, session: 'S2' });
      }
      if (req.url === '/api/get-sales') {
        state.queries.push(body);
        const items = body.sale_payme_id ? [state.sales[body.sale_payme_id]].filter(Boolean) : [];
        return send(200, { status_code: 0, items_count: items.length, items });
      }
      send(404, { status_code: 1, status_error_code: 1, status_error_details: `stub has no ${req.url}` });
    });
  });
  const stub = { state };
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    stub.base = `http://127.0.0.1:${server.address().port}/api`;
    stub.close = () => new Promise((done) => server.close(done));
    resolve(stub);
  }));
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

describe('PayMe', () => {
  let stub;
  let server;
  let admin;
  let student;

  const get = async (path) => (await server.fetch(`/api/business${path}`, { headers: { Cookie: admin.cookie } })).json();
  const paymentsOf = async (studentId) => (await get(`/payments?studentId=${studentId}`)).payments;
  const createLink = (body) => server.fetch('/api/business/payme/sales', json(admin.cookie, body));
  const callback = (fields) => server.fetch('/api/payme/callback', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString() });

  before(async () => {
    stub = await startStub();
    server = await startServer({ ...devEnv, PAYME_ENV: 'sandbox', PAYME_API_BASE: stub.base });
    admin = await signIn(server, ADMIN);
    const response = await server.fetch('/api/business/students', json(admin.cookie, { firstName: 'Noa', lastName: 'Levi', status: 'active', language: 'he', parentName: 'Michal Levi', parentPhone: '+972500000104', currency: 'ILS', joinedAt: '2026-01-01' }));
    assert.equal(response.status, 200, await response.clone().text());
    student = (await response.json()).student;
  });

  after(async () => {
    await server?.stop();
    await stub?.close();
  });

  it('shows the setup card until PayMe is connected, and refuses links before that', async () => {
    const overview = await get('/overview');
    assert.equal(overview.payme.ready, false);
    assert.match(overview.payme.signupUrl, /^https:\/\//);
    const response = await createLink({ studentId: student.id, amount: 250 });
    assert.equal(response.status, 409);
  });

  it('refuses a key PayMe does not know, and keeps a real one without showing it', async () => {
    const wrong = await server.fetch('/api/business/payme', json(admin.cookie, { sellerId: 'MPL00000-NOTREAL0-NOTREAL0-00000000' }, 'PUT'));
    assert.equal(wrong.status, 400);
    assert.equal((await get('/payme')).payme.ready, false);

    const right = await server.fetch('/api/business/payme', json(admin.cookie, { sellerId: MPL }, 'PUT'));
    assert.equal(right.status, 200, await right.clone().text());
    const { payme } = await right.json();
    assert.equal(payme.ready, true);
    assert.equal(payme.environment, 'sandbox');
    assert.equal(payme.sellerIdMasked, 'MPL1••••5678');

    const overview = await (await server.fetch('/api/business/overview', { headers: { Cookie: admin.cookie } })).text();
    const settings = await (await server.fetch('/api/business/settings', { headers: { Cookie: admin.cookie } })).text();
    assert.ok(!overview.includes(MPL) && !settings.includes(MPL), 'the key never reaches the browser');
    assert.equal(JSON.parse(overview).payme.ready, true);
  });

  it('refuses amounts PayMe would round', async () => {
    for (const amount of ['250.555', '1e3', ' 0x1f4', '-5', '2']) {
      const response = await createLink({ studentId: student.id, amount });
      assert.equal(response.status, 400, `amount ${JSON.stringify(amount)}`);
    }
    assert.equal(stub.state.generated.length, 0);
  });

  let sale;
  it('opens a link in minor units, and hands back the open one for the same amount', async () => {
    const response = await createLink({ studentId: student.id, amount: '250.50', periodLabel: '2026-11' });
    assert.equal(response.status, 200, await response.clone().text());
    ({ sale } = await response.json());
    assert.equal(stub.state.generated.length, 1);
    const sent = stub.state.generated[0];
    assert.equal(sent.sale_price, 25050);
    assert.equal(sent.currency, 'ILS');
    assert.equal(sent.transaction_id, sale.id);
    assert.equal(sent.sale_mobile, '+972500000104');
    assert.ok(!('sale_callback_url' in sent), 'no public origin, so no callback URL');
    assert.equal(sale.status, 'initial');
    assert.match(sale.saleUrl, /^https:\/\/sandbox\.payme\.io\/sale\/generate\//);

    const again = await (await createLink({ studentId: student.id, amount: 250.5 })).json();
    assert.equal(again.reused, true);
    assert.equal(again.sale.id, sale.id);
    assert.equal(stub.state.generated.length, 1);
  });

  it('ignores a callback that claims a payment PayMe does not confirm', async () => {
    const response = await callback({ notify_type: 'sale-complete', status_code: '0', payme_sale_id: sale.paymeSaleId, transaction_id: sale.id, price: '25050', currency: 'ILS' });
    assert.equal(response.status, 200);
    await settle();
    assert.equal((await paymentsOf(student.id)).length, 0);
    const [listed] = (await get('/payme/sales')).sales;
    assert.equal(listed.status, 'initial');
  });

  it('answers a callback for a sale it never made, and changes nothing', async () => {
    const queries = stub.state.queries.length;
    const response = await callback({ notify_type: 'sale-complete', payme_sale_id: 'SALE-SOMEONE-ELSE' });
    assert.equal(response.status, 200);
    await settle();
    assert.equal(stub.state.queries.length, queries);
  });

  it('does not record a payment PayMe has for another amount', async () => {
    Object.assign(stub.state.sales[sale.paymeSaleId], { sale_status: 'completed', sale_price: 500 });
    const response = await server.fetch(`/api/business/payme/sales/${sale.id}/check`, json(admin.cookie, {}));
    const data = await response.json();
    assert.equal(data.recorded, false);
    assert.match(data.sale.checkError, /not 250\.5/);
    assert.equal((await paymentsOf(student.id)).length, 0);
  });

  it('records the payment and its receipt once PayMe confirms it, once', async () => {
    Object.assign(stub.state.sales[sale.paymeSaleId], { sale_price: 25050, sale_paid_date: '2026-11-17 10:15:00', sale_invoices: { 1007: { invoice_doc_number: 1007, invoice_url: 'https://invoices.example/1007' } } });
    await callback({ notify_type: 'sale-complete', payme_sale_id: sale.paymeSaleId });
    await settle();
    await callback({ notify_type: 'sale-complete', payme_sale_id: sale.paymeSaleId });
    await settle();
    const payments = await paymentsOf(student.id);
    assert.equal(payments.length, 1);
    assert.equal(payments[0].amount, 250.5);
    assert.equal(payments[0].method, 'payme');
    assert.equal(payments[0].paidAt, '2026-11-17');
    assert.equal(payments[0].periodLabel, '2026-11');
    assert.equal(payments[0].receiptIssued, true);
    assert.equal(payments[0].receiptNumber, '1007');
    const [listed] = (await get('/payme/sales')).sales;
    assert.equal(listed.status, 'completed');
    assert.equal(listed.invoiceUrl, 'https://invoices.example/1007');
    assert.equal(listed.open, false);
  });

  it('finds a payment whose callback never came, on the scheduled check', async () => {
    const { sale: second } = await (await createLink({ studentId: student.id, amount: 100 })).json();
    Object.assign(stub.state.sales[second.paymeSaleId], { sale_status: 'completed', sale_paid_date: '2026-11-17 12:00:00' });
    const response = await server.fetch('/api/debug/payme-recheck', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(response.status, 200);
    const payments = await paymentsOf(student.id);
    assert.equal(payments.length, 2);
    // No receipt yet: recorded without one, and it is filled in when PayMe has it.
    const recorded = payments.find((payment) => payment.amount === 100);
    assert.equal(recorded.receiptIssued, false);
    stub.state.sales[second.paymeSaleId].sale_invoices = { 1008: { invoice_doc_number: 1008, invoice_url: 'https://invoices.example/1008' } };
    await server.fetch(`/api/business/payme/sales/${second.id}/check`, json(admin.cookie, {}));
    const updated = (await paymentsOf(student.id)).find((payment) => payment.amount === 100);
    assert.equal(updated.receiptNumber, '1008');
  });

  it('keeps a refund, and never moves a paid link back to unpaid', async () => {
    stub.state.sales[sale.paymeSaleId].sale_status = 'refunded';
    let data = await (await server.fetch(`/api/business/payme/sales/${sale.id}/check`, json(admin.cookie, {}))).json();
    assert.equal(data.sale.status, 'refunded');
    stub.state.sales[sale.paymeSaleId].sale_status = 'initial';
    data = await (await server.fetch(`/api/business/payme/sales/${sale.id}/check`, json(admin.cookie, {}))).json();
    assert.equal(data.sale.status, 'refunded');
  });

  it('thanks the parent on the return page', async () => {
    const response = await server.fetch(`/paid/${sale.id}?payme_status=success`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/html/);
    assert.match(await response.text(), /התשלום התקבל/);
  });

  it('disconnects', async () => {
    const response = await server.fetch('/api/business/payme', json(admin.cookie, { sellerId: '' }, 'PUT'));
    assert.equal((await response.json()).payme.ready, false);
  });
});
