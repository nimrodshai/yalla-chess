// Structured logging.
//
// Production emits one JSON object per line for log shippers; development
// prints a compact human-readable line. Personal data is redacted at the
// boundary so that phone numbers and email addresses never reach disk.

import { config } from './config.mjs';

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const threshold = LEVELS[config.logLevel] ?? LEVELS.info;

// Keep enough of an identifier to correlate events without storing it.
export function maskPhone(value) {
  const raw = String(value || '');
  if (!raw) return '';
  return raw.length <= 4 ? '***' : `${raw.slice(0, 4)}***${raw.slice(-2)}`;
}

export function maskEmail(value) {
  const raw = String(value || '');
  const at = raw.indexOf('@');
  if (at <= 0) return raw ? '***' : '';
  const name = raw.slice(0, at);
  const domain = raw.slice(at + 1);
  return `${name.slice(0, 1)}***@${domain}`;
}

const SENSITIVE = /^(phone|to|username|email|contactemail|code|password|token|authorization|cookie|apikey)$/i;

function redact(fields = {}) {
  const output = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null || value === '') continue;

    if (SENSITIVE.test(key)) {
      const raw = String(value);
      output[key] = raw.includes('@') ? maskEmail(raw) : maskPhone(raw);
      continue;
    }

    output[key] = value;
  }
  return output;
}

function write(level, event, fields = {}) {
  if ((LEVELS[level] ?? LEVELS.info) > threshold) return;

  const safe = redact(fields);

  if (config.isProduction) {
    process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), level, event, ...safe })}\n`);
    return;
  }

  const detail = Object.entries(safe).map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`).join(' ');
  process.stdout.write(`${level.toUpperCase().padEnd(5)} ${event}${detail ? ` ${detail}` : ''}\n`);
}

export const logInfo = (event, fields) => write('info', event, fields);
export const logWarn = (event, fields) => write('warn', event, fields);
export const logDebug = (event, fields) => write('debug', event, fields);

export function logError(event, error, fields = {}) {
  write('error', event, {
    ...fields,
    message: error?.message || String(error || 'unknown error'),
    // Stacks are useful but noisy; keep them out of production log lines.
    ...(config.isProduction ? {} : { stack: error?.stack })
  });
}
