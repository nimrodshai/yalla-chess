// Request-level security: origin checks, rate limiting and response headers.

import { config } from './config.mjs';

// ---------------------------------------------------------------- client IP

export function getClientIp(req) {
  if (config.trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.trim()) {
      // Left-most entry is the original client when the chain is trusted.
      const first = forwarded.split(',')[0].trim();
      if (first) return first;
    }
  }

  return req.socket?.remoteAddress || 'unknown';
}

// ---------------------------------------------------------------------- CORS

function getLocalDevOrigins() {
  if (config.isProduction) return [];
  return [
    `http://127.0.0.1:${config.port}`,
    `http://localhost:${config.port}`
  ];
}

export function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (config.publicOrigin && origin === config.publicOrigin) return true;
  if (config.allowedOrigins.includes(origin)) return true;
  return getLocalDevOrigins().includes(origin);
}

// Same-origin requests need no CORS headers. Cross-origin requests get them
// only when the origin is explicitly allowed -- never reflected blindly, which
// would let any site read authenticated responses.
export function getCorsHeaders(req) {
  const origin = req.headers.origin;
  if (!origin || !isAllowedOrigin(origin)) return {};

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    Vary: 'Origin'
  };
}

export function isCrossOriginRequest(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  if (config.publicOrigin && origin === config.publicOrigin) return false;
  return !getLocalDevOrigins().includes(origin);
}

// A state-changing request from a browser must either be same-origin or come
// from an allowed origin. Blocks cross-site requests that ride the session
// cookie; requests with no Origin header (curl, server-to-server) are allowed
// through because the cookie is SameSite and cannot be attached by a site.
export function isForbiddenCrossSiteWrite(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  return !isAllowedOrigin(origin);
}

// ------------------------------------------------------------- rate limiting

// Fixed-window counters held in memory. Single-process deployment, so this is
// authoritative; it is a spend/abuse guard, not a correctness mechanism.
const buckets = new Map();

export function checkRateLimit(key, { limit, windowMs }) {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }

  bucket.count += 1;
  if (bucket.count > limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
    };
  }

  return { allowed: true, remaining: limit - bucket.count, retryAfterSeconds: 0 };
}

// Undo a consumed slot, so a rejected request does not count against a caller
// (for example a login for a phone that is not on the allowlist).
export function refundRateLimit(key) {
  const bucket = buckets.get(key);
  if (bucket && bucket.count > 0) {
    bucket.count -= 1;
  }
}

export function pruneRateLimits() {
  const now = Date.now();
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }
}

export function rateLimitBucketCount() {
  return buckets.size;
}

// ---------------------------------------------------------------- headers

const CSP = [
  "default-src 'self'",
  // The app is one HTML file with inline <style> and <script>, and pulls fonts
  // from Google Fonts. 'unsafe-inline' is required until those are extracted.
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data:",
  "media-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'"
].join('; ');

export function getSecurityHeaders() {
  const headers = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'Content-Security-Policy': CSP
  };

  if (config.isProduction) {
    headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  }

  return headers;
}

// ---------------------------------------------------------------- cookies

export function buildSessionCookie(sessionId, { maxAgeMs = null } = {}) {
  const crossOrigin = Boolean(config.publicOrigin && config.allowedOrigins.length > 0);
  const secure = config.isProduction || config.publicOrigin.startsWith('https://');

  return [
    `yalla_session=${encodeURIComponent(sessionId)}`,
    'HttpOnly',
    'Path=/',
    crossOrigin ? 'SameSite=None' : 'SameSite=Lax',
    (crossOrigin || secure) ? 'Secure' : null,
    maxAgeMs ? `Max-Age=${Math.floor(maxAgeMs / 1000)}` : null
  ].filter(Boolean).join('; ');
}

export function buildClearedSessionCookie() {
  const secure = config.isProduction || config.publicOrigin.startsWith('https://');
  const crossOrigin = Boolean(config.publicOrigin && config.allowedOrigins.length > 0);

  return [
    'yalla_session=',
    'HttpOnly',
    'Path=/',
    crossOrigin ? 'SameSite=None' : 'SameSite=Lax',
    (crossOrigin || secure) ? 'Secure' : null,
    'Max-Age=0'
  ].filter(Boolean).join('; ');
}
