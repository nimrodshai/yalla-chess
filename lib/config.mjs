// Central configuration, resolved once at boot.
//
// Guiding rule: every development convenience must FAIL CLOSED. Anything that
// weakens authentication has to be opted into explicitly and is force-disabled
// when NODE_ENV=production, so that a deploy which forgets an environment
// variable is safe rather than wide open.

import { join, resolve } from 'node:path';

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function parseInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseList(value) {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeOrigin(value) {
  try {
    return new URL(value).origin;
  } catch {
    return '';
  }
}

const nodeEnv = (process.env.NODE_ENV || 'development').trim().toLowerCase();
const isProduction = nodeEnv === 'production';

// Opt-in only, and never available in production regardless of what is set.
const debugEndpointsRequested = parseBoolean(process.env.ENABLE_DEBUG_ENDPOINTS, false);
const smsConsoleFallbackRequested = parseBoolean(process.env.TWILIO_ALLOW_CONSOLE_FALLBACK, false);

const dataDir = resolve(process.env.DATA_DIR || process.cwd());

export const config = {
  nodeEnv,
  isProduction,

  port: parseInteger(process.env.PORT, 8001),
  // Bind loopback by default so an unconfigured process is not exposed; set
  // HOST=0.0.0.0 when running inside a container.
  host: (process.env.HOST || '127.0.0.1').trim(),
  // Only honour X-Forwarded-For when a trusted proxy sets it, otherwise a
  // client could spoof its address and bypass per-IP rate limits.
  trustProxy: parseBoolean(process.env.TRUST_PROXY, false),

  // Public origin of the deployed site, used to decide cookie flags.
  publicOrigin: normalizeOrigin(process.env.PUBLIC_ORIGIN || ''),

  // Empty means same-origin only: no CORS headers are emitted at all.
  allowedOrigins: parseList(process.env.ALLOWED_ORIGINS).map(normalizeOrigin).filter(Boolean),

  dataDir,
  dbFile: join(dataDir, process.env.DB_FILE || 'yalla-chess.db'),

  sessionTtlMs: parseInteger(process.env.SESSION_TTL_DAYS, 180) * 24 * 60 * 60 * 1000,
  otpTtlMs: parseInteger(process.env.OTP_TTL_MINUTES, 10) * 60 * 1000,
  otpMaxAttempts: parseInteger(process.env.OTP_MAX_ATTEMPTS, 5),

  // Requests allowed per window, per key. Login is deliberately tight because
  // each accepted request spends money on an SMS.
  rateLimits: {
    loginPerPhone: { limit: parseInteger(process.env.RATE_LIMIT_LOGIN_PER_PHONE, 5), windowMs: 15 * 60 * 1000 },
    loginPerIp: { limit: parseInteger(process.env.RATE_LIMIT_LOGIN_PER_IP, 20), windowMs: 15 * 60 * 1000 },
    verifyPerIp: { limit: parseInteger(process.env.RATE_LIMIT_VERIFY_PER_IP, 30), windowMs: 15 * 60 * 1000 },
    contactPerIp: { limit: parseInteger(process.env.RATE_LIMIT_CONTACT_PER_IP, 5), windowMs: 60 * 60 * 1000 },
    writePerSession: { limit: parseInteger(process.env.RATE_LIMIT_WRITE_PER_SESSION, 240), windowMs: 60 * 1000 }
  },

  enableDebugEndpoints: debugEndpointsRequested && !isProduction,
  smsConsoleFallback: smsConsoleFallbackRequested && !isProduction,

  contactNotifyTo: (process.env.CONTACT_NOTIFY_TO || '').trim(),

  logLevel: (process.env.LOG_LEVEL || 'info').trim().toLowerCase()
};

export function hasTwilioCredentials() {
  const apiKeySid = (process.env.TWILIO_API_KEY_SID || '').trim();
  const apiKeySecret = (process.env.TWILIO_API_KEY_SECRET || '').trim();
  const accountSid = (process.env.TWILIO_ACCOUNT_SID || '').trim();
  const authToken = (process.env.TWILIO_AUTH_TOKEN || '').trim();
  const serviceSid = (process.env.TWILIO_VERIFY_SERVICE_SID || '').trim();

  return Boolean(serviceSid && ((apiKeySid && apiKeySecret) || (accountSid && authToken)));
}

// Refuse to boot a production process that cannot actually authenticate
// anyone, instead of discovering it at the first login attempt.
export function validateConfig() {
  const problems = [];
  const warnings = [];

  if (config.isProduction) {
    if (!hasTwilioCredentials()) {
      problems.push('TWILIO_VERIFY_SERVICE_SID plus either TWILIO_API_KEY_SID/SECRET or TWILIO_ACCOUNT_SID/AUTH_TOKEN are required in production.');
    }

    if (!config.publicOrigin) {
      problems.push('PUBLIC_ORIGIN must be set in production (for example https://yalla-chess.com) so session cookies can be marked Secure.');
    } else if (!config.publicOrigin.startsWith('https://')) {
      problems.push(`PUBLIC_ORIGIN must be an https:// URL in production, got ${config.publicOrigin}.`);
    }

    if (!config.contactNotifyTo) {
      warnings.push('CONTACT_NOTIFY_TO is not set; contact requests will be stored but not emailed.');
    }

    if (debugEndpointsRequested) {
      warnings.push('ENABLE_DEBUG_ENDPOINTS was set but is ignored in production.');
    }

    if (smsConsoleFallbackRequested) {
      warnings.push('TWILIO_ALLOW_CONSOLE_FALLBACK was set but is ignored in production.');
    }
  } else if (!hasTwilioCredentials() && !config.smsConsoleFallback) {
    warnings.push('No Twilio credentials and no console fallback: logins will fail. Set TWILIO_ALLOW_CONSOLE_FALLBACK=true for local development.');
  }

  return { problems, warnings };
}
