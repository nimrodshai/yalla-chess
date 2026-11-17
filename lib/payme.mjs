// PayMe, the school's card processor: payment links and the receipts PayMe
// issues for them.
//
// The school is a direct seller, so its one credential is its MPL
// (seller_payme_id). The admin pastes it once in the app, where it is kept
// server-side in the meta table and never sent to the browser; PAYME_SELLER_ID
// in the environment overrides it.
//
// A seller has no secret to check PayMe's callbacks with, so a callback is
// only ever a nudge: every status comes from asking PayMe (get-sales) about a
// sale we created, with our own order id and amount checked against its
// answer. Docs: https://docs.payme.io/agents/seller/payme-seller-integration

import { config } from './config.mjs';
import { getMeta, setMeta } from './db.mjs';

const env = (name) => (process.env[name] || '').trim();

const BASES = {
  sandbox: 'https://sandbox.payme.io/api',
  production: 'https://live.payme.io/api'
};

// PayMe's default price range, in minor units, the same in every currency.
export const MIN_MINOR = 500;
export const MAX_MINOR = 4_000_000;

export const SIGNUP_URL = 'https://paid.co.il';

export function paymeEnvironment() {
  const requested = env('PAYME_ENV').toLowerCase();
  if (requested === 'sandbox' || requested === 'production') return requested;
  return config.isProduction ? 'production' : 'sandbox';
}

export function getPaymeConfig() {
  const environment = paymeEnvironment();
  // Tests point this at a stub. Never in production, where the MPL must
  // only ever go to PayMe.
  const apiBase = (!config.isProduction && env('PAYME_API_BASE')) || BASES[environment];
  const sellerId = env('PAYME_SELLER_ID') || getMeta('payme_seller_id') || '';
  const origin = config.publicOrigin;
  // PayMe refuses a local address for either URL and fails the whole call,
  // so without a public origin both are left out and the scheduled re-check
  // finds the payments instead.
  const isPublic = /^https:\/\//.test(origin) && !/\/\/(localhost|127\.|10\.|192\.168\.|\[)/.test(origin);
  return {
    environment,
    apiBase,
    sellerId,
    fromEnvironment: Boolean(env('PAYME_SELLER_ID')),
    verifiedAt: getMeta('payme_verified_at') || '',
    callbackUrl: isPublic ? `${origin}/api/payme/callback` : '',
    returnUrl: isPublic ? `${origin}/paid` : '',
    ready: Boolean(sellerId)
  };
}

export function saveSellerId(sellerId) {
  setMeta('payme_seller_id', sellerId);
  setMeta('payme_verified_at', sellerId ? new Date().toISOString() : '');
}

// The MPL shown back to the admin: enough to recognise, not to use.
export function maskSellerId(sellerId) {
  const value = String(sellerId || '');
  if (value.length <= 8) return value ? '••••' : '';
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}

// MPLs look like MPL16838-12345ABC-DEFG1234-HIJK5678. Only the shape is
// checked here; PayMe says whether it is real.
export function normalizeSellerId(value) {
  const cleaned = String(value || '').trim();
  return /^[A-Za-z0-9-]{8,80}$/.test(cleaned) ? cleaned : '';
}

// Amounts are integer minor units: 250 shekels is 25000. Anything that is
// not a plain amount with at most two decimals is refused rather than
// rounded, because PayMe rounds silently and charges the wrong sum.
export function toMinor(amount) {
  const text = typeof amount === 'number' ? amount.toFixed(2) : String(amount ?? '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(minor) ? minor : null;
}

export class PaymeError extends Error {
  // kind: 'refused' — PayMe answered no, nothing happened;
  //       'unknown' — PayMe may have acted (timeout, lost connection, 991/999).
  constructor(kind, message, { code = 0, session = '', status = 0 } = {}) {
    super(message);
    this.name = 'PaymeError';
    this.kind = kind;
    this.code = code;
    this.session = session;
    this.httpStatus = status;
  }
}

const UNKNOWN_CODES = new Set([991, 999, 20002]);

// One call to PayMe: JSON in, JSON out. Success is status_code 0 in a 2xx;
// PayMe sends refusals as HTTP 500 and declines as HTTP 200, so the body's
// code decides, never the HTTP status alone.
export async function paymeCall(path, body, { paymeConfig = getPaymeConfig(), timeoutMs = 20_000 } = {}) {
  let response;
  try {
    response = await fetch(`${paymeConfig.apiBase}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ language: 'en', ...body }),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    // A connection that never opened did not reach PayMe; anything else may have.
    const unsent = ['ENOTFOUND', 'ECONNREFUSED', 'EAI_AGAIN'].includes(error?.cause?.code);
    throw new PaymeError(unsent ? 'refused' : 'unknown', `PayMe could not be reached (${error?.cause?.code || error?.name || 'error'}).`);
  }
  const data = await response.json().catch(() => null);
  const code = Number(data?.status_error_code) || 0;
  const session = String(data?.session || '');
  if (response.ok && data && Number(data.status_code) === 0) return data;
  if (response.status === 429 || code === 998) throw new PaymeError('unknown', 'PayMe is busy; try again in a moment.', { code: 998, session, status: response.status });
  if (UNKNOWN_CODES.has(code)) throw new PaymeError('unknown', `PayMe did not say whether this went through (code ${code}).`, { code, session, status: response.status });
  if (data && Number(data.status_code) === 1 && code) {
    const details = String(data.status_error_details || '').slice(0, 300);
    throw new PaymeError('refused', `PayMe refused: ${details || 'error'} (code ${code}).`, { code, session, status: response.status });
  }
  if (response.status >= 400 && response.status < 500) throw new PaymeError('refused', `PayMe refused the request (HTTP ${response.status}).`, { status: response.status, session });
  throw new PaymeError('unknown', `PayMe gave an unexpected answer (HTTP ${response.status}).`, { status: response.status, session });
}

// Whether an MPL is a real seller in this environment: a one-row sales
// query answers 0 for a known seller and 251 (or 163) for an unknown one.
export async function checkSellerId(sellerId, paymeConfig = getPaymeConfig()) {
  try {
    await paymeCall('get-sales', { seller_payme_id: sellerId, page_size: 1 }, { paymeConfig });
    return { ok: true };
  } catch (error) {
    if (error instanceof PaymeError && error.kind === 'refused') return { ok: false, code: error.code, error: error.message };
    throw error;
  }
}

// Opens a payment page. Returns { paymeSaleId, paymeSaleCode, saleUrl }.
export async function generateSale({ orderId, amountMinor, currency, productName, buyerName = '', buyerEmail = '', buyerPhone = '', language = 'he', expirySeconds = 0 }, paymeConfig = getPaymeConfig()) {
  if (!paymeConfig.sellerId) throw new PaymeError('refused', 'PayMe is not set up yet.');
  if (!Number.isSafeInteger(amountMinor) || amountMinor < MIN_MINOR || amountMinor > MAX_MINOR) throw new PaymeError('refused', 'The amount is outside what PayMe accepts.');
  const body = {
    seller_payme_id: paymeConfig.sellerId,
    sale_price: amountMinor,
    currency,
    product_name: String(productName).slice(0, 500),
    transaction_id: orderId,
    installments: '1',
    sale_type: 'sale',
    // The buyer chooses among the methods turned on in the account (card,
    // Bit, Apple Pay, Google Pay); Bit is shekels only.
    sale_payment_method: currency === 'ILS' ? 'multi' : 'credit-card'
  };
  if (paymeConfig.callbackUrl) body.sale_callback_url = paymeConfig.callbackUrl;
  if (paymeConfig.returnUrl) body.sale_return_url = `${paymeConfig.returnUrl}/${encodeURIComponent(orderId)}`;
  if (buyerName) body.sale_name = buyerName;
  if (buyerEmail) body.sale_email = buyerEmail;
  if (buyerPhone) body.sale_mobile = buyerPhone;
  if (expirySeconds) body.sale_expiry_seconds = expirySeconds;
  const data = await paymeCall('generate-sale', { ...body, language: language === 'en' ? 'en' : 'he' }, { paymeConfig });
  if (!data.payme_sale_id || !data.sale_url) throw new PaymeError('unknown', 'PayMe created the sale but sent no link.', { session: String(data.session || '') });
  return { paymeSaleId: String(data.payme_sale_id), paymeSaleCode: data.payme_sale_code ? String(data.payme_sale_code) : '', saleUrl: String(data.sale_url) };
}

const ALL_SALE_STATUSES = ['initial', 'completed', 'refunded', 'partial-refund', 'authorized', 'failed', 'chargeback', 'canceled', 'voided', 'partial-void', 'partial-chargeback'];

// What PayMe says about one of our sales, or null when PayMe does not know
// it. Throws when the answer is about another seller or another order.
export async function fetchSale({ paymeSaleId, orderId }, paymeConfig = getPaymeConfig()) {
  const data = await paymeCall('get-sales', {
    seller_payme_id: paymeConfig.sellerId,
    sale_payme_id: paymeSaleId,
    sale_status: ALL_SALE_STATUSES,
    page_size: 10
  }, { paymeConfig });
  const items = Array.isArray(data.items) ? data.items : [];
  if (items.some((item) => item.seller_payme_id && item.seller_payme_id !== paymeConfig.sellerId)) {
    throw new PaymeError('unknown', 'PayMe answered about another seller.');
  }
  const item = items.find((entry) => entry.sale_payme_id === paymeSaleId);
  if (!item) return null;
  if (String(item.transaction_id ?? '') !== orderId) throw new PaymeError('unknown', 'PayMe\'s sale belongs to another order.');
  const invoices = Object.values(item.sale_invoices && typeof item.sale_invoices === 'object' ? item.sale_invoices : {})
    .map((invoice) => ({ number: String(invoice?.invoice_doc_number ?? ''), url: String(invoice?.invoice_url ?? '') }))
    .filter((invoice) => invoice.number || invoice.url);
  return {
    status: String(item.sale_status || ''),
    priceMinor: Number(item.sale_price),
    currency: String(item.sale_currency || ''),
    paidAt: String(item.sale_paid_date || ''),
    paymentMethod: String(item.sale_payment_method || ''),
    invoices
  };
}
