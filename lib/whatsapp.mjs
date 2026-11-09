// WhatsApp through Twilio's Messages API: the templates Meta approved, the
// sending call, and the check that a webhook really came from Twilio.
//
// A message a business starts has to use a template Meta approved, so the
// wording lives here rather than in the editable templates in settings.
// Each template is created in Twilio's Content Template Builder with exactly
// this text, and its content SID is set in the environment.

import { createHmac, timingSafeEqual } from 'node:crypto';

import { config } from './config.mjs';

// {{n}} are the template's variables, in the order of `variables`. Meta
// refuses a template that starts or ends with a variable.
export const TEMPLATES = {
  lesson_reminder: {
    variables: ['parentName', 'studentName', 'when', 'zoomLink', 'teacherName'],
    he: 'היי {{1}}! תזכורת: השיעור של {{2}} מתחיל {{3}}.\nקישור לזום: {{4}}\nנתראה!\n{{5}} מ-Yalla-Chess',
    en: 'Hi {{1}}! Reminder: {{2}}\'s chess lesson starts {{3}}.\nZoom link: {{4}}\nSee you soon!\n{{5}} from Yalla-Chess'
  },
  payment_reminder: {
    variables: ['parentName', 'studentName', 'amount', 'teacherName'],
    he: 'היי {{1}}, הגיע מועד התשלום עבור השיעורים של {{2}}: {{3}}.\nתודה רבה!\n{{4}} מ-Yalla-Chess',
    en: 'Hi {{1}}, the payment for {{2}}\'s lessons is now due: {{3}}.\nThank you!\n{{4}} from Yalla-Chess'
  }
};

const CONTENT_ENV = {
  lesson_reminder: { he: 'TWILIO_CONTENT_LESSON_REMINDER_HE', en: 'TWILIO_CONTENT_LESSON_REMINDER_EN' },
  payment_reminder: { he: 'TWILIO_CONTENT_PAYMENT_DUE_HE', en: 'TWILIO_CONTENT_PAYMENT_DUE_EN' }
};

const env = (name) => (process.env[name] || '').trim();

export function getWhatsAppConfig() {
  const apiKeySid = env('TWILIO_API_KEY_SID');
  const apiKeySecret = env('TWILIO_API_KEY_SECRET');
  const accountSid = env('TWILIO_ACCOUNT_SID');
  const authToken = env('TWILIO_AUTH_TOKEN');
  const from = env('TWILIO_WHATSAPP_FROM').replace(/^whatsapp:/, '');
  const contentSids = {};
  for (const [kind, langs] of Object.entries(CONTENT_ENV)) {
    contentSids[kind] = { he: env(langs.he), en: env(langs.en) };
  }
  // Tests point this at a stub. Never in production, where credentials
  // must only ever go to Twilio.
  const apiBase = (!config.isProduction && env('TWILIO_API_BASE')) || 'https://api.twilio.com';
  const username = apiKeySid && apiKeySecret ? apiKeySid : accountSid;
  const password = apiKeySid && apiKeySecret ? apiKeySecret : authToken;
  return {
    accountSid,
    authToken,
    from,
    contentSids,
    apiBase,
    authorization: username && password ? `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` : '',
    // Sending needs the account (it is in the API path), credentials and a
    // sender; a kind can be sent once its template SID is set too.
    canSend: Boolean(accountSid && username && password && from),
    // Twilio signs webhooks with the auth token, so without it no webhook
    // can be trusted and none is accepted.
    canVerifyWebhooks: Boolean(authToken)
  };
}

// What the settings page shows: which parts are set up, never the values.
export function whatsAppReadiness(whatsApp = getWhatsAppConfig()) {
  const templates = {};
  for (const [kind, langs] of Object.entries(whatsApp.contentSids)) {
    templates[kind] = { he: Boolean(langs.he), en: Boolean(langs.en) };
  }
  return { sender: whatsApp.canSend, webhooks: whatsApp.canVerifyWebhooks, templates };
}

// The template's text with its variables filled, as the parent will read it.
export function renderTemplate(kind, language, values) {
  const template = TEMPLATES[kind];
  return template[language].replace(/\{\{(\d+)\}\}/g, (match, index) => values[template.variables[Number(index) - 1]] ?? '');
}

export function contentSidFor(kind, language, whatsApp = getWhatsAppConfig()) {
  return whatsApp.contentSids[kind]?.[language] || '';
}

// Sends one approved template. Resolves with Twilio's message SID and
// status; rejects with Twilio's reason when it refuses the message.
export async function sendTemplate({ to, kind, language, values, statusCallback = '' }, whatsApp = getWhatsAppConfig()) {
  const contentSid = contentSidFor(kind, language, whatsApp);
  if (!whatsApp.canSend || !contentSid) throw new Error(`WhatsApp is not set up for ${kind} (${language}).`);
  const template = TEMPLATES[kind];
  const variables = {};
  template.variables.forEach((name, index) => {
    // An empty variable is refused by WhatsApp.
    variables[String(index + 1)] = String(values[name] ?? '').trim() || '-';
  });
  const form = new URLSearchParams({
    From: `whatsapp:${whatsApp.from}`,
    To: `whatsapp:${to}`,
    ContentSid: contentSid,
    ContentVariables: JSON.stringify(variables)
  });
  if (statusCallback) form.set('StatusCallback', statusCallback);

  const response = await fetch(`${whatsApp.apiBase}/2010-04-01/Accounts/${encodeURIComponent(whatsApp.accountSid)}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: whatsApp.authorization,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      'User-Agent': env('TWILIO_USER_AGENT') || 'Yalla-Chess/1.0'
    },
    body: form,
    signal: AbortSignal.timeout(15_000)
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(data?.message || `Twilio request failed (${response.status}).`);
    error.code = data?.code ? String(data.code) : String(response.status);
    throw error;
  }
  return { sid: String(data?.sid || ''), status: String(data?.status || 'queued') };
}

// Twilio signs each webhook: HMAC-SHA1 with the auth token over the URL it
// called followed by every POST parameter, sorted by name, as name + value.
export function isValidTwilioSignature({ url, params, signature }, authToken = getWhatsAppConfig().authToken) {
  if (!authToken || !signature) return false;
  const payload = url + Object.keys(params).sort().map((key) => key + params[key]).join('');
  const expected = Buffer.from(createHmac('sha1', authToken).update(payload, 'utf8').digest('base64'));
  const given = Buffer.from(String(signature));
  return expected.length === given.length && timingSafeEqual(expected, given);
}

// Twilio's delivery statuses, as the message log keeps them.
export const DELIVERY_STATUSES = {
  accepted: 'queued',
  scheduled: 'queued',
  queued: 'queued',
  sending: 'queued',
  sent: 'sent',
  delivered: 'delivered',
  read: 'read',
  failed: 'failed',
  undelivered: 'failed',
  canceled: 'failed'
};
