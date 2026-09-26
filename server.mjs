import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { randomBytes, randomInt } from 'node:crypto';

import { config, hasTwilioCredentials, validateConfig } from './lib/config.mjs';
import {
  buildClearedSessionCookie,
  buildSessionCookie,
  checkRateLimit,
  getClientIp,
  getCorsHeaders,
  getSecurityHeaders,
  isCrossOriginRequest,
  isForbiddenCrossSiteWrite,
  pruneRateLimits,
  refundRateLimit
} from './lib/security.mjs';
import { logError, logInfo, logWarn } from './lib/log.mjs';
import {
  closeDatabase,
  deleteExpiredSessions,
  deleteSession,
  getSession,
  insertSession,
  listContactRequests,
  listGroups,
  listUsers,
  openDatabase,
  replaceContactRequests,
  replaceGroups,
  replaceUsers,
  seedIfEmpty,
  updateSession
} from './lib/db.mjs';
import { withWriteLock } from './lib/mutex.mjs';

const ROOT = process.cwd();
const PORT = config.port;
const USERS_FILE = join(ROOT, 'auth-users.json');
const GROUPS_FILE = join(ROOT, 'groups.json');
const CONTACT_REQUESTS_FILE = join(ROOT, 'contact-requests.json');
const CONTACT_NOTIFY_TO = config.contactNotifyTo;
const SESSION_COOKIE = 'yalla_session';
const SESSION_TTL_MS = config.sessionTtlMs;
const OTP_TTL_MS = config.otpTtlMs;
const OTP_MAX_ATTEMPTS = config.otpMaxAttempts;
// Sessions live in SQLite so they survive a restart; OTP challenges stay in
// memory because they expire in minutes and holding codes at rest is worse
// than making someone request a new one after a deploy.
const otpChallenges = new Map();

// Development-only seed data. Production seeds from BOOTSTRAP_TEACHER_PHONE
// instead, so these placeholders never reach a real database. Keep real names,
// emails and phone numbers out of here: this file is committed.
const DEFAULT_USERS = [
  { role: 'teacher', username: 'admin@yalla-chess.test', phone: '+972500000001' },
  { role: 'teacher', username: 'teacher@yalla-chess.test', phone: '+972500000002' },
  { role: 'teacher', username: 'coach@yalla-chess.test', phone: '+972500000003' },
  { role: 'student', username: 'student@yalla-chess.test', phone: '+972500000004' }
];

const DEFAULT_GROUPS = [
  {
    id: 'rookies',
    title: { en: 'Rookies', he: 'מתחילים' },
    members: ['+972500000004'],
    schedule: {
      weekday: 1,
      startTime: '17:00',
      durationMinutes: 60,
      timezone: 'Asia/Jerusalem'
    },
    zoomLink: '',
    updatedAt: '',
    updatedBy: ''
  },
  {
    id: 'tactics',
    title: { en: 'Tactics Lab', he: 'מעבדת טקטיקה' },
    members: ['+972500000003'],
    schedule: {
      weekday: 3,
      startTime: '18:30',
      durationMinutes: 60,
      timezone: 'Asia/Jerusalem'
    },
    zoomLink: '',
    updatedAt: '',
    updatedBy: ''
  },
  {
    id: 'champions',
    title: { en: 'Champions', he: 'אלופים' },
    members: [],
    schedule: {
      weekday: 4,
      startTime: '19:15',
      durationMinutes: 75,
      timezone: 'Asia/Jerusalem'
    },
    zoomLink: '',
    updatedAt: '',
    updatedBy: ''
  }
];

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.mp4': 'video/mp4',
  '.ico': 'image/x-icon'
};

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, text, contentType = 'text/plain; charset=utf-8', extraHeaders = {}) {
  res.writeHead(statusCode, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    ...extraHeaders
  });
  res.end(text);
}

function parseCookies(cookieHeader = '') {
  return cookieHeader.split(';').reduce((acc, pair) => {
    const index = pair.indexOf('=');
    if (index === -1) return acc;
    const key = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    if (key) acc[key] = decodeURIComponent(value);
    return acc;
  }, {});
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function getMailConfig() {
  const apiKey = (process.env.RESEND_API_KEY || process.env.EMAIL_API_KEY || '').trim();
  const from = (process.env.RESEND_FROM || process.env.EMAIL_FROM || '').trim();
  const allowConsoleFallback = parseBoolean(
    process.env.EMAIL_ALLOW_CONSOLE_FALLBACK ?? process.env.OTP_ALLOW_CONSOLE_FALLBACK,
    false
  );
  const userAgent = (process.env.RESEND_USER_AGENT || 'Yalla-Chess/1.0').trim();

  return {
    apiKey,
    from,
    allowConsoleFallback,
    userAgent
  };
}

function getTwilioConfig() {
  const apiKeySid = (process.env.TWILIO_API_KEY_SID || '').trim();
  const apiKeySecret = (process.env.TWILIO_API_KEY_SECRET || '').trim();
  const accountSid = (process.env.TWILIO_ACCOUNT_SID || '').trim();
  const authToken = (process.env.TWILIO_AUTH_TOKEN || '').trim();
  const serviceSid = (process.env.TWILIO_VERIFY_SERVICE_SID || '').trim();
  const allowConsoleFallback = config.smsConsoleFallback;
  const userAgent = (process.env.TWILIO_USER_AGENT || 'Yalla-Chess/1.0').trim();

  return {
    apiKeySid,
    apiKeySecret,
    accountSid,
    authToken,
    serviceSid,
    allowConsoleFallback,
    userAgent,
    hasCredentials: Boolean(
      (apiKeySid && apiKeySecret) || (accountSid && authToken)
    )
  };
}

function readResendError(response, data) {
  const detail =
    data?.error?.message ||
    data?.message ||
    data?.error ||
    data?.errors?.[0]?.message ||
    '';

  if (detail) {
    return detail;
  }

  switch (response.status) {
    case 401:
      return 'Resend API key is missing or invalid.';
    case 403:
      return 'Resend rejected this email request.';
    case 429:
      return 'Resend rate limit exceeded.';
    default:
      return `Resend request failed (${response.status}).`;
  }
}

async function sendResendMail({ to, subject, text, headers = {}, from }) {
  const config = getMailConfig();
  if (!config.apiKey || !config.from) {
    return { delivery: 'console', configured: false };
  }

  const payload = {
    from: from || config.from,
    to,
    subject,
    text
  };

  if (headers && Object.keys(headers).length) {
    payload.headers = headers;
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      'User-Agent': config.userAgent
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(readResendError(response, data));
  }

  return {
    delivery: 'resend',
    configured: true,
    id: typeof data?.id === 'string' ? data.id : ''
  };
}

function buildTwilioAuthorization(config) {
  const username = config.apiKeySid && config.apiKeySecret ? config.apiKeySid : config.accountSid;
  const password = config.apiKeySid && config.apiKeySecret ? config.apiKeySecret : config.authToken;

  if (!username || !password) {
    return '';
  }

  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
}

function readTwilioError(response, data) {
  const detail =
    data?.message ||
    data?.error_message ||
    data?.error ||
    data?.errors?.[0]?.message ||
    '';

  if (detail) {
    return detail;
  }

  switch (response.status) {
    case 401:
      return 'Twilio credentials are missing or invalid.';
    case 403:
      return 'Twilio rejected this verification request.';
    case 404:
      return 'Twilio Verify service or verification was not found.';
    case 429:
      return 'Twilio rate limit exceeded.';
    default:
      return `Twilio request failed (${response.status}).`;
  }
}

function normalizePhone(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const cleaned = raw.replace(/[^\d+]/g, '');
  if (cleaned.startsWith('00')) {
    return `+${cleaned.slice(2)}`;
  }

  if (cleaned.startsWith('+')) {
    return `+${cleaned.slice(1).replace(/\D/g, '')}`;
  }

  return cleaned;
}

function isPhoneNumber(value) {
  return /^\+[1-9]\d{1,14}$/.test(normalizePhone(value));
}

function getUserPhone(user) {
  const phone = normalizePhone(user?.phone || '');
  if (phone && isPhoneNumber(phone)) {
    return phone;
  }

  const usernamePhone = normalizePhone(user?.username || '');
  if (usernamePhone && isPhoneNumber(usernamePhone)) {
    return usernamePhone;
  }

  return '';
}

async function sendTwilioVerification(phone) {
  const config = getTwilioConfig();
  const authorization = buildTwilioAuthorization(config);

  if (!config.serviceSid || !authorization) {
    throw new Error('SMS delivery is not configured on this server.');
  }

  const response = await fetch(`https://verify.twilio.com/v2/Services/${config.serviceSid}/Verifications`, {
    method: 'POST',
    headers: {
      Authorization: authorization,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': config.userAgent
    },
    body: new URLSearchParams({
      To: phone,
      Channel: 'sms'
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(readTwilioError(response, data));
  }

  return {
    delivery: 'twilio',
    configured: true,
    sid: typeof data?.sid === 'string' ? data.sid : '',
    status: typeof data?.status === 'string' ? data.status : '',
    phone
  };
}

async function checkTwilioVerification({ phone, verificationSid, code }) {
  const config = getTwilioConfig();
  const authorization = buildTwilioAuthorization(config);

  if (!config.serviceSid || !authorization) {
    throw new Error('SMS delivery is not configured on this server.');
  }

  const response = await fetch(`https://verify.twilio.com/v2/Services/${config.serviceSid}/VerificationCheck`, {
    method: 'POST',
    headers: {
      Authorization: authorization,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': config.userAgent
    },
    body: new URLSearchParams({
      To: phone,
      Code: code,
      VerificationSid: verificationSid
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(readTwilioError(response, data));
  }

  if (data?.status && data.status !== 'approved') {
    throw new Error('That code is not correct. Try again.');
  }

  return {
    delivery: 'twilio',
    configured: true,
    approved: true,
    status: typeof data?.status === 'string' ? data.status : '',
    phone
  };
}

async function notifyContactRequest(request) {
  const config = getMailConfig();
  if (!config.apiKey || !config.from || !CONTACT_NOTIFY_TO || !isEmailAddress(CONTACT_NOTIFY_TO)) {
    return { delivery: 'skipped', configured: false };
  }

  const subject = `Yalla-Chess contact request from ${request.fullName}`;
  const text = [
    'A new Yalla-Chess access request was submitted.',
    '',
    `Name: ${request.fullName}`,
    `Email: ${request.email}`,
    request.phone ? `Phone: ${request.phone}` : 'Phone: -',
    request.message ? `Notes: ${request.message}` : 'Notes: -',
    '',
    `Source: ${request.source || 'login-denied'}`,
    `Submitted: ${request.createdAt}`,
    request.ip ? `IP: ${request.ip}` : null,
    request.userAgent ? `User agent: ${request.userAgent}` : null
  ].filter(Boolean).join('\n');

  return sendResendMail({
    to: CONTACT_NOTIFY_TO,
    subject,
    text,
    headers: request.email ? {
      'Reply-To': request.email
    } : {}
  });
}

function normalizeLocalizedText(value, fallback = '') {
  const text = typeof fallback === 'string' ? fallback.trim() : '';

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return {
      en: trimmed,
      he: trimmed
    };
  }

  if (value && typeof value === 'object') {
    const en = typeof value.en === 'string' ? value.en.trim() : '';
    const he = typeof value.he === 'string' ? value.he.trim() : '';
    return {
      en: en || he || text,
      he: he || en || text
    };
  }

  return {
    en: text,
    he: text
  };
}

function normalizeScheduleWeekday(value, fallback = 1) {
  const weekday = Number(value);
  return Number.isInteger(weekday) && weekday >= 0 && weekday <= 6 ? weekday : fallback;
}

function parseScheduleTimeMinutes(value) {
  const match = typeof value === 'string' ? value.trim().match(/^(\d{2}):(\d{2})$/) : null;
  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }

  return hours * 60 + minutes;
}

function formatScheduleTime(minutes) {
  const normalized = ((Number(minutes) % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60);
  const mins = normalized % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

function normalizeScheduleTime(value, fallback = '17:00') {
  const minutes = parseScheduleTimeMinutes(value);
  return minutes == null ? fallback : formatScheduleTime(minutes);
}

function clampScheduleDuration(minutes, fallback = 60) {
  const value = Number(minutes);
  return Number.isFinite(value) ? Math.max(30, Math.min(180, Math.round(value))) : fallback;
}

function getScheduleDurationMinutes(source = {}, fallback = 60) {
  if (Number.isFinite(Number(source.durationMinutes))) {
    return clampScheduleDuration(source.durationMinutes, fallback);
  }

  const startMinutes = parseScheduleTimeMinutes(source.startTime);
  const endMinutes = parseScheduleTimeMinutes(source.endTime);
  if (startMinutes != null && endMinutes != null) {
    const diff = (endMinutes - startMinutes + 1440) % 1440;
    if (diff > 0) {
      return clampScheduleDuration(diff, fallback);
    }
  }

  return fallback;
}

function normalizeGroupScheduleRow(row, fallback) {
  const source = row && typeof row === 'object' ? row : {};
  const weekday = normalizeScheduleWeekday(source.weekday, fallback.weekday);
  const startTime = normalizeScheduleTime(source.startTime, fallback.startTime);
  const durationMinutes = getScheduleDurationMinutes({ ...source, startTime }, fallback.durationMinutes);
  const endTime = normalizeScheduleTime(source.endTime, formatScheduleTime(parseScheduleTimeMinutes(startTime) + durationMinutes));

  return {
    weekday,
    startTime,
    endTime,
    durationMinutes
  };
}

function normalizeGroupSchedule(schedule) {
  const source = schedule && typeof schedule === 'object' ? schedule : {};
  const timezone = typeof source.timezone === 'string' && source.timezone.trim() ? source.timezone.trim() : 'Asia/Jerusalem';
  const fallbackStart = normalizeScheduleTime(source.startTime, '17:00');
  const fallbackDuration = getScheduleDurationMinutes({
    startTime: fallbackStart,
    endTime: source.endTime,
    durationMinutes: source.durationMinutes
  }, 60);
  const fallback = {
    weekday: normalizeScheduleWeekday(source.weekday, 1),
    startTime: fallbackStart,
    endTime: normalizeScheduleTime(source.endTime, formatScheduleTime(parseScheduleTimeMinutes(fallbackStart) + fallbackDuration)),
    durationMinutes: fallbackDuration
  };
  const rowSource = Array.isArray(source.rows)
    ? source.rows
    : Array.isArray(source.entries)
      ? source.entries
      : [];
  const rows = rowSource.length
    ? rowSource.map((row) => normalizeGroupScheduleRow(row, fallback))
    : [normalizeGroupScheduleRow(fallback, fallback)];
  const primary = rows[0] || fallback;

  return {
    weekday: primary.weekday,
    startTime: primary.startTime,
    endTime: primary.endTime,
    durationMinutes: primary.durationMinutes,
    timezone,
    rows
  };
}

function normalizeGroupMembers(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(new Set(value
    .map((entry) => typeof entry === 'string' ? entry.trim() : '')
    .filter(Boolean)
    .filter((entry) => isUserIdentifier(entry))));
}

function isZoomLink(value) {
  if (typeof value !== 'string') {
    return false;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  try {
    const url = new URL(trimmed);
    return url.protocol === 'https:' && /(^|\.)zoom\.us$/i.test(url.hostname);
  } catch {
    return false;
  }
}

function normalizeGroup(group) {
  const schedule = normalizeGroupSchedule(group?.schedule);
  const zoomLink = typeof group?.zoomLink === 'string' ? group.zoomLink.trim() : '';

  return {
    id: typeof group?.id === 'string' ? group.id.trim() : '',
    title: normalizeLocalizedText(group?.title, typeof group?.id === 'string' ? group.id : ''),
    members: normalizeGroupMembers(group?.members),
    schedule,
    zoomLink: isZoomLink(zoomLink) ? zoomLink : '',
    updatedAt: typeof group?.updatedAt === 'string' ? group.updatedAt : '',
    updatedBy: typeof group?.updatedBy === 'string' ? group.updatedBy.trim() : ''
  };
}

function normalizeGroupsPayload(payload) {
  const groups = Array.isArray(payload?.groups) ? payload.groups : [];
  return groups
    .map(normalizeGroup)
    .filter((group) => group.id);
}

// Reads no longer fall back to DEFAULT_GROUPS: seeding happens once at boot,
// so deleting the last group keeps it deleted instead of resurrecting demo data.
async function loadGroups() {
  return normalizeGroupsPayload({ groups: listGroups() });
}

async function saveGroups(groups) {
  replaceGroups(normalizeGroupsPayload({ groups }));
}

function slugifyGroupId(value) {
  const source = normalizeLocalizedText(value, '');
  const preferred = source.en || source.he || '';
  const slug = preferred
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug || 'group';
}

function getUniqueGroupId(baseId, groups, currentId = '') {
  const existing = new Set(groups.map((group) => group.id).filter(Boolean));
  if (currentId) {
    existing.delete(currentId);
  }

  let candidate = baseId || 'group';
  let suffix = 2;
  while (existing.has(candidate)) {
    candidate = `${baseId || 'group'}-${suffix++}`;
  }

  return candidate;
}

function applyGroupPatch(group, payload) {
  const nextGroup = {
    ...group
  };
  let zoomLinkProvided = false;

  if (Object.prototype.hasOwnProperty.call(payload, 'title')) {
    nextGroup.title = normalizeLocalizedText(payload.title, group.title);
    if (!(nextGroup.title.en || nextGroup.title.he)) {
      throw new Error('Please enter a group name.');
    }
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'members')) {
    nextGroup.members = normalizeGroupMembers(payload.members);
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'schedule')) {
    nextGroup.schedule = normalizeGroupSchedule(payload.schedule);
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'zoomLink') || Object.prototype.hasOwnProperty.call(payload, 'link')) {
    zoomLinkProvided = true;
    const zoomLink = typeof payload.zoomLink === 'string'
      ? payload.zoomLink.trim()
      : typeof payload.link === 'string'
        ? payload.link.trim()
        : '';

    if (zoomLink && !isZoomLink(zoomLink)) {
      throw new Error('Please enter a valid Zoom meeting link.');
    }

    nextGroup.zoomLink = zoomLink;
  }

  if (!Object.prototype.hasOwnProperty.call(payload, 'members') && !Object.prototype.hasOwnProperty.call(payload, 'title') && !Object.prototype.hasOwnProperty.call(payload, 'schedule') && !zoomLinkProvided) {
    return null;
  }

  nextGroup.updatedAt = new Date().toISOString();

  return nextGroup;
}

function buildNewGroup(payload, groups) {
  const titleSource = Object.prototype.hasOwnProperty.call(payload, 'title')
    ? payload.title
    : Object.prototype.hasOwnProperty.call(payload, 'name')
      ? payload.name
      : '';
  const title = normalizeLocalizedText(titleSource, 'New group');
  const normalizedTitle = (title.en || title.he || '').trim();
  if (!normalizedTitle) {
    throw new Error('Please enter a group name.');
  }

  const group = normalizeGroup({
    id: getUniqueGroupId(slugifyGroupId(title), groups),
    title,
    members: payload.members,
    schedule: payload.schedule,
    zoomLink: payload.zoomLink
  });

  group.updatedAt = new Date().toISOString();
  return group;
}

function canManageGroups(user) {
  return user?.role === 'teacher';
}

function canManageUsers(user) {
  return canManageGroups(user);
}

function getLocalizedValue(value, lang = 'en') {
  if (typeof value === 'string') {
    return value;
  }

  if (value && typeof value === 'object') {
    return lang === 'he'
      ? (value.he || value.en || '')
      : (value.en || value.he || '');
  }

  return '';
}

function parseLessonClock(startTime) {
  const match = typeof startTime === 'string' ? startTime.trim().match(/^(\d{2}):(\d{2})$/) : null;
  if (!match) {
    return { hour: 17, minute: 0 };
  }

  return {
    hour: Number(match[1]),
    minute: Number(match[2])
  };
}

function getTimeZoneParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false
  });

  const parts = formatter.formatToParts(date).reduce((acc, part) => {
    if (part.type !== 'literal') {
      acc[part.type] = part.value;
    }
    return acc;
  }, {});

  return {
    weekday: parts.weekday,
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second)
  };
}

function weekdayNameToIndex(value) {
  switch (String(value || '').slice(0, 3).toLowerCase()) {
    case 'sun': return 0;
    case 'mon': return 1;
    case 'tue': return 2;
    case 'wed': return 3;
    case 'thu': return 4;
    case 'fri': return 5;
    case 'sat': return 6;
    default: return 0;
  }
}

function zonedTimeToUtc({ year, month, day, hour, minute, second = 0 }, timeZone) {
  let utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);

  for (let i = 0; i < 4; i += 1) {
    const current = getTimeZoneParts(new Date(utcGuess), timeZone);
    const currentAsUtc = Date.UTC(current.year, current.month - 1, current.day, current.hour, current.minute, current.second);
    const targetAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
    const diff = targetAsUtc - currentAsUtc;
    utcGuess += diff;

    if (Math.abs(diff) < 1000) {
      break;
    }
  }

  return utcGuess;
}

function computeNextLessonTimestamp(schedule, entry, now = new Date()) {
  const timeZone = schedule.timezone;
  const lessonClock = parseLessonClock(entry.startTime);
  const current = getTimeZoneParts(now, timeZone);
  const currentWeekday = weekdayNameToIndex(current.weekday);
  const daysUntilLesson = (entry.weekday - currentWeekday + 7) % 7;

  const targetLocal = new Date(Date.UTC(current.year, current.month - 1, current.day + daysUntilLesson, lessonClock.hour, lessonClock.minute, 0));
  let nextLessonAt = zonedTimeToUtc({
    year: targetLocal.getUTCFullYear(),
    month: targetLocal.getUTCMonth() + 1,
    day: targetLocal.getUTCDate(),
    hour: lessonClock.hour,
    minute: lessonClock.minute,
    second: 0
  }, timeZone);

  if (nextLessonAt <= now.getTime()) {
    const nextWeek = new Date(Date.UTC(targetLocal.getUTCFullYear(), targetLocal.getUTCMonth(), targetLocal.getUTCDate() + 7, lessonClock.hour, lessonClock.minute, 0));
    nextLessonAt = zonedTimeToUtc({
      year: nextWeek.getUTCFullYear(),
      month: nextWeek.getUTCMonth() + 1,
      day: nextWeek.getUTCDate(),
      hour: lessonClock.hour,
      minute: lessonClock.minute,
      second: 0
    }, timeZone);
  }

  return nextLessonAt;
}

function computeNextLessonAt(group, now = new Date()) {
  const schedule = normalizeGroupSchedule(group?.schedule);
  const rows = Array.isArray(schedule.rows) && schedule.rows.length ? schedule.rows : [schedule];
  const nextLessonAt = Math.min(...rows.map((row) => computeNextLessonTimestamp(schedule, row, now)));

  return new Date(nextLessonAt).toISOString();
}

function serializeDashboardGroup(group, session) {
  const members = normalizeGroupMembers(group.members);
  const isMember = Boolean(session) && members.some((member) => sameUserIdentifier(member, session.username) || sameUserIdentifier(member, session.phone));
  const canEdit = canManageGroups(session);

  return {
    id: group.id,
    title: group.title,
    members: canEdit ? members : [],
    membersCount: members.length,
    schedule: group.schedule,
    zoomLink: group.zoomLink,
    updatedAt: group.updatedAt,
    updatedBy: group.updatedBy,
    nextLessonAt: computeNextLessonAt(group),
    isMember,
    canEdit
  };
}

function normalizeUserList(users) {
  return users
    .map((user) => normalizeUserRecord(user))
    .filter((user) => user.role && (isUserIdentifier(user.username) || isUserIdentifier(user.phone)));
}

async function loadUsers() {
  return normalizeUserList(listUsers());
}

async function saveUsers(users) {
  replaceUsers(normalizeUserList(users));
}

function normalizeContactRequest(request) {
  return {
    id: typeof request?.id === 'string' ? request.id : '',
    createdAt: typeof request?.createdAt === 'string' ? request.createdAt : '',
    fullName: typeof request?.fullName === 'string' ? request.fullName.trim() : '',
    email: typeof request?.email === 'string' ? request.email.trim() : '',
    phone: typeof request?.phone === 'string' ? request.phone.trim() : '',
    message: typeof request?.message === 'string' ? request.message.trim() : '',
    source: typeof request?.source === 'string' ? request.source.trim() : '',
    userAgent: typeof request?.userAgent === 'string' ? request.userAgent.trim() : '',
    ip: typeof request?.ip === 'string' ? request.ip.trim() : ''
  };
}

function normalizeContactRequestList(requests) {
  return requests
    .map(normalizeContactRequest)
    .filter((request) => request.id && request.createdAt && request.fullName && isEmailAddress(request.email));
}

async function loadContactRequests() {
  return normalizeContactRequestList(listContactRequests());
}

async function saveContactRequests(requests) {
  replaceContactRequests(normalizeContactRequestList(requests));
}

function normalizeRole(role) {
  if (role === 'teacher' || role === 'admin') return 'teacher';
  if (role === 'student') return 'student';
  return null;
}

function normalizeEmail(value) {
  return String(value || '')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
    .trim()
    .toLowerCase();
}

function isEmailAddress(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
}

function normalizeContactEmail(value) {
  const email = normalizeEmail(value);
  return email && isEmailAddress(email) ? email : '';
}

function normalizeProfileName(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isUserIdentifier(value) {
  return isEmailAddress(value) || isPhoneNumber(value);
}

function normalizeUserIdentifier(value) {
  const phone = normalizePhone(value);
  if (phone && isPhoneNumber(phone)) {
    return phone;
  }

  const email = normalizeEmail(value);
  if (email && isEmailAddress(email)) {
    return email;
  }

  return '';
}

function sameUserIdentifier(a, b) {
  const aIdentifier = normalizeUserIdentifier(a);
  const bIdentifier = normalizeUserIdentifier(b);
  if (aIdentifier && bIdentifier) {
    return aIdentifier === bIdentifier;
  }

  return false;
}

function getUserContactEmail(user) {
  return normalizeContactEmail(user?.contactEmail);
}

function normalizePaymentStatus(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return 'paid';
  if (['paid', 'trial', 'overdue', 'inactive', 'pending'].includes(normalized)) {
    return normalized;
  }
  return 'paid';
}

function normalizePaidUntil(value) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) {
    return '';
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toISOString().slice(0, 10);
}

function normalizeUserNotes(value) {
  return typeof value === 'string' ? value.trim().slice(0, 500) : '';
}

function normalizeUserRecord(user, fallback = {}) {
  const fallbackUsername = typeof fallback.username === 'string' ? fallback.username.trim() : '';
  const fallbackPhone = typeof fallback.phone === 'string' ? fallback.phone.trim() : '';
  const phone = normalizePhone(user?.phone || fallbackPhone || '');
  const username = typeof user?.username === 'string' && user.username.trim()
    ? user.username.trim()
    : fallbackUsername || phone;

  return {
    role: normalizeRole(user?.role) || normalizeRole(fallback.role) || 'student',
    username,
    phone,
    contactEmail: normalizeContactEmail(user?.contactEmail || fallback.contactEmail || ''),
    firstName: normalizeProfileName(user?.firstName || fallback.firstName || ''),
    lastName: normalizeProfileName(user?.lastName || fallback.lastName || ''),
    paymentStatus: normalizePaymentStatus(user?.paymentStatus || fallback.paymentStatus),
    planName: normalizeProfileName(user?.planName || fallback.planName || ''),
    paidUntil: normalizePaidUntil(user?.paidUntil || fallback.paidUntil || ''),
    notes: normalizeUserNotes(user?.notes || fallback.notes || '')
  };
}

function getUserPrimaryIdentifier(user) {
  return getUserPhone(user) || normalizeUserIdentifier(user?.username) || normalizeUserIdentifier(user?.contactEmail);
}

function getUserIdentifierSet(user) {
  return Array.from(new Set([
    normalizeUserIdentifier(user?.username),
    normalizeUserIdentifier(user?.phone),
    normalizeUserIdentifier(user?.contactEmail)
  ].filter(Boolean)));
}

function findUserIndexByIdentifier(users, identifier) {
  const normalized = normalizeUserIdentifier(identifier);
  if (!normalized) {
    return -1;
  }

  return users.findIndex((entry) => getUserIdentifierSet(entry).some((value) => value === normalized));
}

function serializeUser(user, phone = '') {
  return {
    username: user.username,
    role: user.role,
    phone: phone || getUserPhone(user),
    contactEmail: getUserContactEmail(user),
    firstName: normalizeProfileName(user?.firstName),
    lastName: normalizeProfileName(user?.lastName),
    paymentStatus: normalizePaymentStatus(user?.paymentStatus),
    planName: normalizeProfileName(user?.planName),
    paidUntil: normalizePaidUntil(user?.paidUntil),
    notes: normalizeUserNotes(user?.notes),
    canManageGroups: canManageGroups(user),
    canManageUsers: canManageUsers(user)
  };
}

function getUserByEmail(users, email) {
  const normalizedEmail = normalizeEmail(email);
  return users.find((entry) => normalizeEmail(entry.username) === normalizedEmail) || null;
}

function getUserByPhone(users, phone) {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone || !isPhoneNumber(normalizedPhone)) {
    return null;
  }

  return users.find((entry) => getUserPhone(entry) === normalizedPhone) || null;
}

function generateOtpCode() {
  return String(randomInt(0, 1000000)).padStart(6, '0');
}

function clearExpiredOtpChallenges() {
  const now = Date.now();
  for (const [challengeId, challenge] of otpChallenges.entries()) {
    if (challenge.expiresAt <= now) {
      otpChallenges.delete(challengeId);
    }
  }
}

function clearOtpChallengesForPhone(phone) {
  const normalizedPhone = normalizePhone(phone);
  for (const [challengeId, challenge] of otpChallenges.entries()) {
    if (challenge.phone === normalizedPhone) {
      otpChallenges.delete(challengeId);
    }
  }
}

function getOtpChallengeForPhone(phone) {
  const normalizedPhone = normalizePhone(phone);
  for (const challenge of otpChallenges.values()) {
    if (challenge.phone === normalizedPhone) {
      return challenge;
    }
  }
  return null;
}

function createOtpChallenge(user, remember) {
  clearExpiredOtpChallenges();
  const phone = getUserPhone(user);
  clearOtpChallengesForPhone(phone);

  const challengeId = randomBytes(18).toString('hex');
  const challenge = {
    challengeId,
    email: normalizeEmail(user.username),
    phone,
    verificationSid: '',
    code: '',
    delivery: 'twilio',
    expiresAt: Date.now() + OTP_TTL_MS,
    attemptsLeft: OTP_MAX_ATTEMPTS,
    remember: remember !== false
  };

  otpChallenges.set(challengeId, challenge);
  return challenge;
}

function createSession(user) {
  const id = randomBytes(24).toString('hex');
  const expiresAt = Date.now() + SESSION_TTL_MS;
  insertSession({
    id,
    username: user.username,
    role: user.role,
    phone: getUserPhone(user),
    contactEmail: getUserContactEmail(user),
    firstName: normalizeProfileName(user?.firstName),
    lastName: normalizeProfileName(user?.lastName),
    canManageGroups: canManageGroups(user),
    expiresAt
  });
  return { id, expiresAt };
}

function getSessionFromRequest(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  const sessionId = cookies[SESSION_COOKIE];
  if (!sessionId) return null;
  const session = getSession(sessionId);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    deleteSession(sessionId);
    return null;
  }
  return session;
}

function clearExpiredSessions() {
  deleteExpiredSessions();
}

async function readRequestBody(req, limitBytes = 16 * 1024) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body, 'utf8') > limitBytes) {
      const err = new Error('Request body too large');
      err.statusCode = 413;
      throw err;
    }
  }
  return body;
}

async function handleLogin(req, res) {
  let payload;
  try {
    payload = JSON.parse(await readRequestBody(req));
  } catch (error) {
    sendJson(res, error.statusCode || 400, { ok: false, error: 'Invalid JSON payload.' }, getCorsHeaders(req));
    return;
  }

  const phone = typeof payload.phone === 'string'
    ? payload.phone.trim()
    : typeof payload.username === 'string'
      ? payload.username.trim()
      : typeof payload.email === 'string'
        ? payload.email.trim()
        : '';
  const remember = payload.remember !== false;

  if (!isPhoneNumber(phone)) {
    sendJson(res, 400, { ok: false, error: 'Please enter a valid phone number.' }, getCorsHeaders(req));
    return;
  }

  // Each accepted request sends a billable SMS, so cap both the caller and the
  // destination number before doing any work.
  const ipKey = `login:ip:${getClientIp(req)}`;
  const phoneKey = `login:phone:${normalizePhone(phone)}`;
  const ipLimit = checkRateLimit(ipKey, config.rateLimits.loginPerIp);
  if (!ipLimit.allowed) {
    sendJson(res, 429, { ok: false, error: 'Too many attempts. Request a new code.' }, {
      ...getCorsHeaders(req),
      'Retry-After': String(ipLimit.retryAfterSeconds)
    });
    return;
  }

  const phoneLimit = checkRateLimit(phoneKey, config.rateLimits.loginPerPhone);
  if (!phoneLimit.allowed) {
    sendJson(res, 429, { ok: false, error: 'Too many attempts. Request a new code.' }, {
      ...getCorsHeaders(req),
      'Retry-After': String(phoneLimit.retryAfterSeconds)
    });
    return;
  }

  const users = await loadUsers();
  const user = getUserByPhone(users, phone);

  if (!user) {
    // No SMS goes out, so do not spend this number's budget; the per-IP cap
    // still bounds enumeration attempts.
    refundRateLimit(phoneKey);
    sendJson(res, 403, { ok: false, error: "This phone number isn't on the paid list yet." }, {
      ...getCorsHeaders(req)
    });
    return;
  }

  const userPhone = getUserPhone(user);
  const twilioConfig = getTwilioConfig();
  if (twilioConfig.hasCredentials && twilioConfig.serviceSid && !userPhone && !twilioConfig.allowConsoleFallback) {
    sendJson(res, 503, { ok: false, error: "This account doesn't have a phone number on file yet. Please contact Dolev." }, getCorsHeaders(req));
    return;
  }

  const challenge = createOtpChallenge(user, remember);
  try {
    if (twilioConfig.hasCredentials && twilioConfig.serviceSid && userPhone) {
      const verification = await sendTwilioVerification(userPhone);
      challenge.delivery = 'twilio';
      challenge.phone = userPhone;
      challenge.verificationSid = verification.sid;
    } else if (twilioConfig.allowConsoleFallback) {
      challenge.delivery = 'console';
      challenge.code = generateOtpCode();
      console.log(`[Yalla-Chess SMS OTP] ${user.username}: ${challenge.code}`);
    } else {
      throw new Error('SMS delivery is not configured on this server.');
    }
  } catch (error) {
    otpChallenges.delete(challenge.challengeId);
    refundRateLimit(phoneKey);
    logError('otp.send_failed', error, { phone: userPhone });
    sendJson(res, 503, { ok: false, error: error.message || 'SMS delivery is not configured on this server.' }, {
      ...getCorsHeaders(req)
    });
    return;
  }

  sendJson(res, 200, {
    ok: true,
    challengeId: challenge.challengeId,
    email: user.username,
    phone: userPhone,
    contactEmail: getUserContactEmail(user)
  }, {
    ...getCorsHeaders(req)
  });
}

async function handleLoginVerify(req, res) {
  let payload;
  try {
    payload = JSON.parse(await readRequestBody(req));
  } catch (error) {
    sendJson(res, error.statusCode || 400, { ok: false, error: 'Invalid JSON payload.' }, getCorsHeaders(req));
    return;
  }

  const phone = typeof payload.phone === 'string'
    ? payload.phone.trim()
    : typeof payload.username === 'string'
      ? payload.username.trim()
      : typeof payload.email === 'string'
        ? payload.email.trim()
        : '';
  const challengeId = typeof payload.challengeId === 'string' ? payload.challengeId.trim() : '';
  const code = typeof payload.code === 'string' ? payload.code.replace(/\s+/g, '') : '';
  const remember = payload.remember !== false;

  if (!isPhoneNumber(phone)) {
    sendJson(res, 400, { ok: false, error: 'Please enter a valid phone number.' }, getCorsHeaders(req));
    return;
  }

  if (!challengeId || !/^\d{6}$/.test(code)) {
    sendJson(res, 400, { ok: false, error: 'Enter the 6-digit code from your text message.' }, getCorsHeaders(req));
    return;
  }

  // Per-challenge attempts are capped already; this bounds an attacker cycling
  // through fresh challenges from one host.
  const verifyLimit = checkRateLimit(`verify:ip:${getClientIp(req)}`, config.rateLimits.verifyPerIp);
  if (!verifyLimit.allowed) {
    sendJson(res, 429, { ok: false, error: 'Too many attempts. Request a new code.' }, {
      ...getCorsHeaders(req),
      'Retry-After': String(verifyLimit.retryAfterSeconds)
    });
    return;
  }

  clearExpiredOtpChallenges();
  const challenge = otpChallenges.get(challengeId);
  if (!challenge || challenge.phone !== normalizePhone(phone)) {
    sendJson(res, 401, { ok: false, error: 'That code has expired. Request a new one.' }, getCorsHeaders(req));
    return;
  }

  if (challenge.expiresAt <= Date.now()) {
    otpChallenges.delete(challengeId);
    sendJson(res, 401, { ok: false, error: 'That code has expired. Request a new one.' }, getCorsHeaders(req));
    return;
  }

  const users = await loadUsers();
  const user = getUserByPhone(users, phone);
  if (!user) {
    otpChallenges.delete(challengeId);
    sendJson(res, 403, { ok: false, error: "This phone number isn't on the paid list yet." }, {
      ...getCorsHeaders(req)
    });
    return;
  }

  if (challenge.delivery === 'twilio') {
    const phone = challenge.phone || getUserPhone(user);
    if (!phone) {
      otpChallenges.delete(challengeId);
      sendJson(res, 503, { ok: false, error: "This account doesn't have a phone number on file yet. Please contact Dolev." }, getCorsHeaders(req));
      return;
    }

    try {
      await checkTwilioVerification({
        phone,
        verificationSid: challenge.verificationSid || challengeId,
        code
      });
    } catch (error) {
      const message = String(error?.message || '');
      if (message === 'SMS delivery is not configured on this server.') {
        sendJson(res, 503, { ok: false, error: message }, getCorsHeaders(req));
        return;
      }

      if (/not found|expired/i.test(message)) {
        otpChallenges.delete(challengeId);
        sendJson(res, 401, { ok: false, error: 'That code has expired. Request a new one.' }, getCorsHeaders(req));
        return;
      }

      if (/rate limit|too many/i.test(message)) {
        sendJson(res, 429, { ok: false, error: 'Too many attempts. Request a new code.' }, getCorsHeaders(req));
        return;
      }

      sendJson(res, 401, { ok: false, error: 'That code is not correct. Try again.' }, getCorsHeaders(req));
      return;
    }
  } else {
    challenge.attemptsLeft -= 1;
    if (challenge.code !== code) {
      if (challenge.attemptsLeft <= 0) {
        otpChallenges.delete(challengeId);
        sendJson(res, 429, { ok: false, error: 'Too many attempts. Request a new code.' }, getCorsHeaders(req));
        return;
      }

      sendJson(res, 401, { ok: false, error: 'That code is not correct. Try again.' }, getCorsHeaders(req));
      return;
    }
  }

  otpChallenges.delete(challengeId);

  const session = createSession(user);
  const persist = remember !== false && challenge.remember !== false;
  const cookie = buildSessionCookie(session.id, { maxAgeMs: persist ? SESSION_TTL_MS : null });

  sendJson(res, 200, {
    ok: true,
    user: serializeUser(user, challenge.phone || getUserPhone(user))
  }, {
    ...getCorsHeaders(req),
    'Set-Cookie': cookie
  });
}

function handleDebugOtp(req, res, url) {
  if (!config.enableDebugEndpoints) {
    sendJson(res, 404, { ok: false, error: 'Not found.' }, getCorsHeaders(req));
    return;
  }

  const email = url.searchParams.get('email') || '';
  const phone = url.searchParams.get('phone') || email || url.searchParams.get('username') || '';
  if (!isPhoneNumber(phone)) {
    sendJson(res, 400, { ok: false, error: 'Please enter a valid phone number.' }, getCorsHeaders(req));
    return;
  }

  clearExpiredOtpChallenges();
  const challenge = getOtpChallengeForPhone(phone);
  if (!challenge) {
    sendJson(res, 404, { ok: false, error: 'No active OTP challenge found.' }, getCorsHeaders(req));
    return;
  }

  sendJson(res, 200, {
    ok: true,
    email: challenge.email,
    phone: challenge.phone,
    challengeId: challenge.challengeId,
    code: challenge.delivery === 'console' ? challenge.code : '',
    delivery: challenge.delivery,
    expiresAt: challenge.expiresAt
  }, getCorsHeaders(req));
}

async function handleDebugSession(req, res, url) {
  if (!config.enableDebugEndpoints) {
    sendJson(res, 404, { ok: false, error: 'Not found.' }, getCorsHeaders(req));
    return;
  }

  const phone = url.searchParams.get('phone') || url.searchParams.get('username') || url.searchParams.get('email') || '';
  const users = await loadUsers();
  const user = getUserByPhone(users, phone) || getUserByEmail(users, phone);
  if (!user) {
    sendJson(res, 404, { ok: false, error: 'User not found.' }, getCorsHeaders(req));
    return;
  }

  const session = createSession(user);
  const cookie = buildSessionCookie(session.id, { maxAgeMs: SESSION_TTL_MS });

  sendText(res, 302, '', 'text/plain; charset=utf-8', {
    ...getCorsHeaders(req),
    'Set-Cookie': cookie,
    Location: '/'
  });
}

async function handleProfileUpdate(req, res) {
  const session = getSessionFromRequest(req);
  if (!session) {
    sendJson(res, 401, { ok: false, error: 'Not authenticated.' }, getCorsHeaders(req));
    return;
  }

  let payload;
  try {
    payload = JSON.parse(await readRequestBody(req));
  } catch (error) {
    sendJson(res, error.statusCode || 400, { ok: false, error: 'Invalid JSON payload.' }, getCorsHeaders(req));
    return;
  }

  const contactEmail = typeof payload.contactEmail === 'string' ? payload.contactEmail.trim() : '';
  const firstName = normalizeProfileName(payload.firstName);
  const lastName = normalizeProfileName(payload.lastName);
  if (contactEmail && !isEmailAddress(contactEmail)) {
    sendJson(res, 400, {
      ok: false,
      field: 'contactEmail',
      error: 'Please enter a valid email address.'
    }, getCorsHeaders(req));
    return;
  }

  if (firstName.length > 80) {
    sendJson(res, 400, {
      ok: false,
      field: 'firstName',
      error: 'First name must be 80 characters or fewer.'
    }, getCorsHeaders(req));
    return;
  }

  if (lastName.length > 80) {
    sendJson(res, 400, {
      ok: false,
      field: 'lastName',
      error: 'Last name must be 80 characters or fewer.'
    }, getCorsHeaders(req));
    return;
  }

  const users = await loadUsers();
  const userIndex = users.findIndex((entry) => sameUserIdentifier(entry.username, session.username));
  if (userIndex === -1) {
    sendJson(res, 404, { ok: false, error: 'Account not found.' }, getCorsHeaders(req));
    return;
  }

  users[userIndex].contactEmail = normalizeContactEmail(contactEmail);
  users[userIndex].firstName = firstName;
  users[userIndex].lastName = lastName;
  await saveUsers(users);

  const updatedUser = users[userIndex];
  updateSession(session.id, {
    contactEmail: getUserContactEmail(updatedUser),
    firstName: normalizeProfileName(updatedUser.firstName),
    lastName: normalizeProfileName(updatedUser.lastName)
  });

  sendJson(res, 200, {
    ok: true,
    user: serializeUser(updatedUser)
  }, getCorsHeaders(req));
}

async function handleContactRequest(req, res) {
  const contactLimit = checkRateLimit(`contact:ip:${getClientIp(req)}`, config.rateLimits.contactPerIp);
  if (!contactLimit.allowed) {
    sendJson(res, 429, { ok: false, error: 'Too many requests. Please try again later.' }, {
      ...getCorsHeaders(req),
      'Retry-After': String(contactLimit.retryAfterSeconds)
    });
    return;
  }

  let payload;
  try {
    payload = JSON.parse(await readRequestBody(req, 32 * 1024));
  } catch (error) {
    sendJson(res, error.statusCode || 400, { ok: false, error: 'Invalid JSON payload.' }, getCorsHeaders(req));
    return;
  }

  const fullName = typeof payload.fullName === 'string'
    ? payload.fullName.trim()
    : typeof payload.name === 'string'
      ? payload.name.trim()
      : '';
  const email = typeof payload.email === 'string' ? payload.email.trim() : '';
  const phone = typeof payload.phone === 'string' ? payload.phone.trim() : '';
  const message = typeof payload.message === 'string' ? payload.message.trim() : '';
  const source = typeof payload.source === 'string' ? payload.source.trim() : 'login-denied';

  if (!fullName) {
    sendJson(res, 400, { ok: false, error: 'Please enter your full name.' }, getCorsHeaders(req));
    return;
  }

  if (!isEmailAddress(email)) {
    sendJson(res, 400, { ok: false, error: 'Please enter a valid email address.' }, getCorsHeaders(req));
    return;
  }

  if (!phone && !message) {
    sendJson(res, 400, { ok: false, error: 'Please share a phone number or a short note.' }, getCorsHeaders(req));
    return;
  }

  const request = {
    id: randomBytes(12).toString('hex'),
    createdAt: new Date().toISOString(),
    fullName: fullName.slice(0, 120),
    email: email.slice(0, 180),
    phone: phone.slice(0, 80),
    message: message.slice(0, 1000),
    source: source.slice(0, 80),
    userAgent: String(req.headers['user-agent'] || '').slice(0, 300),
    ip: String(req.socket.remoteAddress || '').slice(0, 80)
  };

  const requests = await loadContactRequests();
  requests.unshift(request);
  await saveContactRequests(requests.slice(0, 500));

  void notifyContactRequest(request).catch((error) => {
    console.error(`[Yalla-Chess contact] notification failed for ${request.email}: ${error.message}`);
  });

  sendJson(res, 200, {
    ok: true,
    requestId: request.id
  }, getCorsHeaders(req));
}

function handleMe(req, res) {
  const session = getSessionFromRequest(req);
  if (!session) {
    sendJson(res, 401, { ok: false, error: 'Not authenticated.' }, getCorsHeaders(req));
    return;
  }

  sendJson(res, 200, {
    ok: true,
    user: serializeUser(session, session.phone || '')
  }, getCorsHeaders(req));
}

async function handleDashboard(req, res) {
  const session = getSessionFromRequest(req);
  if (!session) {
    sendJson(res, 401, { ok: false, error: 'Not authenticated.' }, getCorsHeaders(req));
    return;
  }

  const groups = await loadGroups();
  const canEditGroups = canManageGroups(session);
  const canEditUsers = canManageUsers(session);
  const users = canEditUsers ? await loadUsers() : [];
  const visibleSource = canManageGroups(session)
    ? groups
    : groups.filter((group) => {
      const members = normalizeGroupMembers(group.members);
      return members.some((member) => sameUserIdentifier(member, session.username) || sameUserIdentifier(member, session.phone));
    });

  const visibleGroups = visibleSource
    .map((group) => serializeDashboardGroup(group, session))
    .sort((a, b) => new Date(a.nextLessonAt).getTime() - new Date(b.nextLessonAt).getTime());

  sendJson(res, 200, {
    ok: true,
    serverTime: new Date().toISOString(),
    user: serializeUser(session, session.phone || ''),
    canManageGroups: canEditGroups,
    canManageUsers: canEditUsers,
    activeGroupId: visibleGroups[0]?.id || '',
    groups: visibleGroups,
    users: canEditUsers ? users.map((user) => serializeUser(user, getUserPhone(user))) : []
  }, getCorsHeaders(req));
}

function getUserPayloadIdentifiers(payload, fallbackUser = {}) {
  const nextUser = normalizeUserRecord(payload, fallbackUser);
  if (!nextUser.username && nextUser.phone) {
    nextUser.username = nextUser.phone;
  }

  if (!nextUser.phone && isPhoneNumber(nextUser.username)) {
    nextUser.phone = normalizePhone(nextUser.username);
  }

  if (!nextUser.phone || !isPhoneNumber(nextUser.phone)) {
    throw new Error('Please enter a valid phone number.');
  }

  if (!isUserIdentifier(nextUser.username)) {
    throw new Error('Please enter a valid phone number or email address.');
  }

  return nextUser;
}

function findUserConflict(users, candidate, currentIndex = -1) {
  const candidateIdentifiers = getUserIdentifierSet(candidate);
  if (!candidateIdentifiers.length) {
    return -1;
  }

  return users.findIndex((entry, index) => {
    if (index === currentIndex) {
      return false;
    }

    const entryIdentifiers = getUserIdentifierSet(entry);
    return entryIdentifiers.some((entryIdentifier) => candidateIdentifiers.some((candidateIdentifier) => sameUserIdentifier(entryIdentifier, candidateIdentifier)));
  });
}

function mutateGroupsForUserChange(groups, previousIdentifiers, nextIdentifier, updatedBy = '') {
  const identifiers = Array.from(new Set((Array.isArray(previousIdentifiers) ? previousIdentifiers : [])
    .map((value) => normalizeUserIdentifier(value))
    .filter(Boolean)));

  if (!identifiers.length) {
    return {
      groups,
      changed: false
    };
  }

  let changed = false;
  const nextGroups = groups.map((group) => {
    const currentMembers = normalizeGroupMembers(group.members);
    const nextMembers = normalizeGroupMembers(currentMembers.map((member) => {
      return identifiers.some((identifier) => sameUserIdentifier(member, identifier))
        ? (nextIdentifier || '')
        : member;
    }));

    const groupChanged = currentMembers.length !== nextMembers.length || currentMembers.some((member, index) => !sameUserIdentifier(member, nextMembers[index]));
    if (!groupChanged) {
      return group;
    }

    changed = true;
    return {
      ...group,
      members: nextMembers,
      updatedAt: new Date().toISOString(),
      updatedBy: updatedBy || group.updatedBy || ''
    };
  });

  return {
    groups: nextGroups,
    changed
  };
}

async function handleUserCreate(req, res) {
  const session = getSessionFromRequest(req);
  if (!session) {
    sendJson(res, 401, { ok: false, error: 'Not authenticated.' }, getCorsHeaders(req));
    return;
  }

  if (!canManageUsers(session)) {
    sendJson(res, 403, { ok: false, error: 'Not authorized.' }, getCorsHeaders(req));
    return;
  }

  let payload;
  try {
    payload = JSON.parse(await readRequestBody(req));
  } catch (error) {
    sendJson(res, error.statusCode || 400, { ok: false, error: 'Invalid JSON payload.' }, getCorsHeaders(req));
    return;
  }

  const users = await loadUsers();
  let nextUser;

  try {
    nextUser = getUserPayloadIdentifiers(payload || {}, {
      role: 'student',
      paymentStatus: 'paid'
    });
  } catch (error) {
    sendJson(res, 400, { ok: false, error: error.message || 'Unable to create user.' }, getCorsHeaders(req));
    return;
  }

  const conflictIndex = findUserConflict(users, nextUser);
  if (conflictIndex !== -1) {
    sendJson(res, 409, { ok: false, error: 'Another user already uses that phone number or email address.' }, getCorsHeaders(req));
    return;
  }

  users.push(nextUser);
  await saveUsers(users);

  sendJson(res, 200, {
    ok: true,
    user: serializeUser(nextUser, nextUser.phone),
    serverTime: new Date().toISOString()
  }, getCorsHeaders(req));
}

async function handleUserUpdate(req, res, userId) {
  const session = getSessionFromRequest(req);
  if (!session) {
    sendJson(res, 401, { ok: false, error: 'Not authenticated.' }, getCorsHeaders(req));
    return;
  }

  if (!canManageUsers(session)) {
    sendJson(res, 403, { ok: false, error: 'Not authorized.' }, getCorsHeaders(req));
    return;
  }

  let payload;
  try {
    payload = JSON.parse(await readRequestBody(req));
  } catch (error) {
    sendJson(res, error.statusCode || 400, { ok: false, error: 'Invalid JSON payload.' }, getCorsHeaders(req));
    return;
  }

  const users = await loadUsers();
  const index = findUserIndexByIdentifier(users, decodeURIComponent(userId));
  if (index === -1) {
    sendJson(res, 404, { ok: false, error: 'User not found.' }, getCorsHeaders(req));
    return;
  }

  const currentUser = users[index];
  let nextUser;
  try {
    nextUser = getUserPayloadIdentifiers({
      ...currentUser,
      ...payload
    }, currentUser);
  } catch (error) {
    sendJson(res, 400, { ok: false, error: error.message || 'Unable to update user.' }, getCorsHeaders(req));
    return;
  }

  if (sameUserIdentifier(currentUser.username, currentUser.phone) || !currentUser.username) {
    nextUser.username = nextUser.phone;
  }

  const hasChanges = JSON.stringify(normalizeUserRecord(currentUser)) !== JSON.stringify(normalizeUserRecord(nextUser));
  if (!hasChanges) {
    sendJson(res, 400, { ok: false, error: 'No changes provided.' }, getCorsHeaders(req));
    return;
  }

  const conflictIndex = findUserConflict(users, nextUser, index);
  if (conflictIndex !== -1) {
    sendJson(res, 409, { ok: false, error: 'Another user already uses that phone number or email address.' }, getCorsHeaders(req));
    return;
  }

  const previousIdentifiers = getUserIdentifierSet(currentUser);
  const nextPrimaryIdentifier = getUserPrimaryIdentifier(nextUser);
  users[index] = nextUser;

  const groups = await loadGroups();
  const groupMutation = mutateGroupsForUserChange(groups, previousIdentifiers, nextPrimaryIdentifier, session.username);
  if (groupMutation.changed) {
    await saveGroups(groupMutation.groups);
  }

  await saveUsers(users);

  if (previousIdentifiers.some((identifier) => sameUserIdentifier(identifier, session.username) || sameUserIdentifier(identifier, session.phone))) {
    updateSession(session.id, {
      username: nextUser.username,
      role: nextUser.role,
      phone: nextUser.phone,
      contactEmail: nextUser.contactEmail,
      firstName: nextUser.firstName,
      lastName: nextUser.lastName,
      canManageGroups: canManageGroups(nextUser)
    });
  }

  sendJson(res, 200, {
    ok: true,
    user: serializeUser(nextUser, nextUser.phone),
    serverTime: new Date().toISOString()
  }, getCorsHeaders(req));
}

async function handleUserDelete(req, res, userId) {
  const session = getSessionFromRequest(req);
  if (!session) {
    sendJson(res, 401, { ok: false, error: 'Not authenticated.' }, getCorsHeaders(req));
    return;
  }

  if (!canManageUsers(session)) {
    sendJson(res, 403, { ok: false, error: 'Not authorized.' }, getCorsHeaders(req));
    return;
  }

  const users = await loadUsers();
  const index = findUserIndexByIdentifier(users, decodeURIComponent(userId));
  if (index === -1) {
    sendJson(res, 404, { ok: false, error: 'User not found.' }, getCorsHeaders(req));
    return;
  }

  const removedUser = users[index];
  users.splice(index, 1);

  const groups = await loadGroups();
  const groupMutation = mutateGroupsForUserChange(groups, getUserIdentifierSet(removedUser), '', session.username);
  if (groupMutation.changed) {
    await saveGroups(groupMutation.groups);
  }

  await saveUsers(users);

  if (getUserIdentifierSet(removedUser).some((identifier) => sameUserIdentifier(identifier, session.username) || sameUserIdentifier(identifier, session.phone))) {
    deleteSession(session.id);
  }

  sendJson(res, 200, {
    ok: true,
    serverTime: new Date().toISOString()
  }, getCorsHeaders(req));
}

async function handleGroupCreate(req, res) {
  const session = getSessionFromRequest(req);
  if (!session) {
    sendJson(res, 401, { ok: false, error: 'Not authenticated.' }, getCorsHeaders(req));
    return;
  }

  if (!canManageGroups(session)) {
    sendJson(res, 403, { ok: false, error: 'Not authorized.' }, getCorsHeaders(req));
    return;
  }

  let payload;
  try {
    payload = JSON.parse(await readRequestBody(req));
  } catch (error) {
    sendJson(res, error.statusCode || 400, { ok: false, error: 'Invalid JSON payload.' }, getCorsHeaders(req));
    return;
  }

  const groups = await loadGroups();
  let group;

  try {
    group = buildNewGroup(payload || {}, groups);
  } catch (error) {
    sendJson(res, 400, { ok: false, error: error.message || 'Unable to create group.' }, getCorsHeaders(req));
    return;
  }

  group.updatedBy = session.username;
  groups.push(group);

  await saveGroups(groups);

  sendJson(res, 200, {
    ok: true,
    group: serializeDashboardGroup(group, session),
    serverTime: new Date().toISOString()
  }, getCorsHeaders(req));
}

async function handleGroupUpdate(req, res, groupId) {
  const session = getSessionFromRequest(req);
  if (!session) {
    sendJson(res, 401, { ok: false, error: 'Not authenticated.' }, getCorsHeaders(req));
    return;
  }

  if (!canManageGroups(session)) {
    sendJson(res, 403, { ok: false, error: 'Not authorized.' }, getCorsHeaders(req));
    return;
  }

  let payload;
  try {
    payload = JSON.parse(await readRequestBody(req));
  } catch (error) {
    sendJson(res, error.statusCode || 400, { ok: false, error: 'Invalid JSON payload.' }, getCorsHeaders(req));
    return;
  }

  const groups = await loadGroups();
  const index = groups.findIndex((group) => group.id === groupId);
  if (index === -1) {
    sendJson(res, 404, { ok: false, error: 'Group not found.' }, getCorsHeaders(req));
    return;
  }

  let nextGroup;
  try {
    nextGroup = applyGroupPatch(groups[index], payload || {});
  } catch (error) {
    sendJson(res, 400, { ok: false, error: error.message || 'Unable to update group.' }, getCorsHeaders(req));
    return;
  }

  if (!nextGroup) {
    sendJson(res, 400, { ok: false, error: 'No changes provided.' }, getCorsHeaders(req));
    return;
  }

  nextGroup.updatedBy = session.username;
  groups[index] = nextGroup;
  await saveGroups(groups);

  sendJson(res, 200, {
    ok: true,
    group: serializeDashboardGroup(groups[index], session),
    serverTime: new Date().toISOString()
  }, getCorsHeaders(req));
}

async function handleGroupDelete(req, res, groupId) {
  const session = getSessionFromRequest(req);
  if (!session) {
    sendJson(res, 401, { ok: false, error: 'Not authenticated.' }, getCorsHeaders(req));
    return;
  }

  if (!canManageGroups(session)) {
    sendJson(res, 403, { ok: false, error: 'Not authorized.' }, getCorsHeaders(req));
    return;
  }

  const groups = await loadGroups();
  const nextGroups = groups.filter((group) => group.id !== groupId);
  if (nextGroups.length === groups.length) {
    sendJson(res, 404, { ok: false, error: 'Group not found.' }, getCorsHeaders(req));
    return;
  }

  await saveGroups(nextGroups);

  sendJson(res, 200, {
    ok: true,
    serverTime: new Date().toISOString()
  }, getCorsHeaders(req));
}

async function handleGroupZoomLinkUpdate(req, res, groupId) {
  const session = getSessionFromRequest(req);
  if (!session) {
    sendJson(res, 401, { ok: false, error: 'Not authenticated.' }, getCorsHeaders(req));
    return;
  }

  if (!canManageGroups(session)) {
    sendJson(res, 403, { ok: false, error: 'Not authorized.' }, getCorsHeaders(req));
    return;
  }

  let payload;
  try {
    payload = JSON.parse(await readRequestBody(req));
  } catch (error) {
    sendJson(res, error.statusCode || 400, { ok: false, error: 'Invalid JSON payload.' }, getCorsHeaders(req));
    return;
  }

  const zoomLink = typeof payload.zoomLink === 'string'
    ? payload.zoomLink.trim()
    : typeof payload.link === 'string'
      ? payload.link.trim()
      : '';

  const groups = await loadGroups();
  const index = groups.findIndex((group) => group.id === groupId);
  if (index === -1) {
    sendJson(res, 404, { ok: false, error: 'Group not found.' }, getCorsHeaders(req));
    return;
  }

  let nextGroup;
  try {
    nextGroup = applyGroupPatch(groups[index], { zoomLink });
  } catch (error) {
    sendJson(res, 400, { ok: false, error: error.message || 'Unable to update group.' }, getCorsHeaders(req));
    return;
  }

  if (!nextGroup) {
    sendJson(res, 400, { ok: false, error: 'No changes provided.' }, getCorsHeaders(req));
    return;
  }

  nextGroup.updatedBy = session.username;
  groups[index] = nextGroup;

  await saveGroups(groups);

  sendJson(res, 200, {
    ok: true,
    group: serializeDashboardGroup(groups[index], session),
    serverTime: new Date().toISOString()
  }, getCorsHeaders(req));
}

function handleLogout(req, res) {
  const cookies = parseCookies(req.headers.cookie || '');
  const sessionId = cookies[SESSION_COOKIE];
  if (sessionId) deleteSession(sessionId);

  sendJson(res, 200, { ok: true }, {
    'Set-Cookie': buildClearedSessionCookie()
  }, getCorsHeaders(req));
}

// Long-lived caching for media, revalidation for the app shell. index.html is
// never cached because it contains the whole application.
function getCacheControl(type) {
  if (type.startsWith('text/html')) return 'no-cache';
  if (type.startsWith('video/') || type.startsWith('image/') || type.startsWith('font/')) return 'public, max-age=86400';
  return 'no-cache';
}

function buildEtag(fileStat) {
  return `W/"${fileStat.size.toString(16)}-${Math.floor(fileStat.mtimeMs).toString(16)}"`;
}

// Parse a single byte range. Multi-range requests are answered in full, which
// is allowed and is all any browser needs for media seeking.
function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header || '').trim());
  if (!match) return null;

  const [, rawStart, rawEnd] = match;
  if (rawStart === '' && rawEnd === '') return null;

  let start;
  let end;

  if (rawStart === '') {
    // Suffix form: the last N bytes.
    const length = Number(rawEnd);
    if (!Number.isFinite(length) || length <= 0) return null;
    start = Math.max(0, size - length);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === '' ? size - 1 : Number(rawEnd);
  }

  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start > end || start >= size) return { unsatisfiable: true };

  return { start, end: Math.min(end, size - 1) };
}

function resolveStaticPath(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null; // Malformed percent-encoding.
  }

  if (decoded.includes('\0')) return null;

  const safePath = normalize(decoded).replace(/^(\.\.(\/|\\|$))+/, '');
  const absolute = resolve(ROOT, `.${safePath}`);

  // Prefix alone would also match a sibling directory such as <ROOT>-backup.
  if (absolute !== ROOT && !absolute.startsWith(ROOT + sep)) return null;

  return absolute;
}

async function serveStatic(req, res, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const absolute = resolveStaticPath(requested);

  if (!absolute) {
    sendText(res, 403, 'Forbidden');
    return;
  }

  let fileStat;
  try {
    fileStat = await stat(absolute);
    if (!fileStat.isFile()) throw new Error('Not a file');
  } catch {
    // A request for a missing asset must be a 404, not the app shell with a
    // 200, which hides broken references from browsers and monitoring. Paths
    // without an extension fall through to the single-page app.
    if (extname(absolute)) {
      sendText(res, 404, 'Not Found');
      return;
    }

    await serveStatic(req, res, '/index.html');
    return;
  }

  const type = MIME_TYPES[extname(absolute).toLowerCase()] || 'application/octet-stream';
  const etag = buildEtag(fileStat);
  const lastModified = new Date(fileStat.mtimeMs).toUTCString();

  const baseHeaders = {
    'Content-Type': type,
    'Cache-Control': getCacheControl(type),
    'Accept-Ranges': 'bytes',
    ETag: etag,
    'Last-Modified': lastModified
  };

  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, baseHeaders);
    res.end();
    return;
  }

  const range = req.headers.range ? parseRange(req.headers.range, fileStat.size) : null;

  if (range?.unsatisfiable) {
    res.writeHead(416, { ...baseHeaders, 'Content-Range': `bytes */${fileStat.size}` });
    res.end();
    return;
  }

  // Serving the 86MB video without this means re-sending the whole file for
  // every seek, and browsers cannot scrub at all.
  if (range) {
    const length = range.end - range.start + 1;
    res.writeHead(206, {
      ...baseHeaders,
      'Content-Range': `bytes ${range.start}-${range.end}/${fileStat.size}`,
      'Content-Length': String(length)
    });

    if (req.method === 'HEAD') {
      res.end();
      return;
    }

    createReadStream(absolute, { start: range.start, end: range.end }).pipe(res);
    return;
  }

  res.writeHead(200, { ...baseHeaders, 'Content-Length': String(fileStat.size) });

  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  createReadStream(absolute).pipe(res);
}

async function handleRequest(req, res) {
  clearExpiredSessions();
  pruneRateLimits();

  // Set before any handler writes, so every response carries them. Values
  // passed later to writeHead take precedence over these.
  for (const [header, value] of Object.entries(getSecurityHeaders())) {
    res.setHeader(header, value);
  }

  if (!req.url) {
    sendText(res, 400, 'Bad Request');
    return;
  }

  const url = new URL(req.url, 'http://127.0.0.1');

  // Unauthenticated liveness probe for the reverse proxy or container runtime.
  if (url.pathname === '/healthz' && (req.method === 'GET' || req.method === 'HEAD')) {
    sendJson(res, 200, { ok: true, status: 'ok', uptimeSeconds: Math.round(process.uptime()) });
    return;
  }

  // The session cookie is SameSite, but reject cross-site state changes
  // explicitly rather than relying on that alone.
  if (url.pathname.startsWith('/api/') && req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
    if (isForbiddenCrossSiteWrite(req)) {
      logWarn('cors.blocked_write', { path: url.pathname, origin: req.headers.origin });
      sendJson(res, 403, { ok: false, error: 'Cross-site requests are not allowed.' });
      return;
    }
  }

  if (url.pathname === '/api/login' && req.method === 'POST') {
    await handleLogin(req, res);
    return;
  }

  if (url.pathname === '/api/login/verify' && req.method === 'POST') {
    await handleLoginVerify(req, res);
    return;
  }

  if (url.pathname === '/api/debug/otp' && req.method === 'GET') {
    handleDebugOtp(req, res, url);
    return;
  }

  if (url.pathname === '/api/debug/session' && req.method === 'GET') {
    await handleDebugSession(req, res, url);
    return;
  }

  if (url.pathname.startsWith('/api/') && req.method === 'OPTIONS') {
    sendText(res, 204, '', 'text/plain; charset=utf-8', {
      ...getCorsHeaders(req),
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Accept',
      'Access-Control-Max-Age': '600'
    });
    return;
  }

  if (url.pathname === '/api/me' && req.method === 'GET') {
    handleMe(req, res);
    return;
  }

  if (url.pathname === '/api/dashboard' && req.method === 'GET') {
    await handleDashboard(req, res);
    return;
  }

  if (url.pathname === '/api/groups' && req.method === 'POST') {
    await withWriteLock(() => handleGroupCreate(req, res));
    return;
  }

  if (url.pathname === '/api/users' && req.method === 'POST') {
    await withWriteLock(() => handleUserCreate(req, res));
    return;
  }

  const groupUpdateMatch = url.pathname.match(/^\/api\/groups\/([^/]+)$/);
  if (groupUpdateMatch && req.method === 'PATCH') {
    await withWriteLock(() => handleGroupUpdate(req, res, groupUpdateMatch[1]));
    return;
  }

  if (groupUpdateMatch && req.method === 'DELETE') {
    await withWriteLock(() => handleGroupDelete(req, res, groupUpdateMatch[1]));
    return;
  }

  const zoomLinkMatch = url.pathname.match(/^\/api\/groups\/([^/]+)\/zoom-link$/);
  if (zoomLinkMatch && req.method === 'POST') {
    await withWriteLock(() => handleGroupZoomLinkUpdate(req, res, zoomLinkMatch[1]));
    return;
  }

  const userUpdateMatch = url.pathname.match(/^\/api\/users\/([^/]+)$/);
  if (userUpdateMatch && req.method === 'PATCH') {
    await withWriteLock(() => handleUserUpdate(req, res, userUpdateMatch[1]));
    return;
  }

  if (userUpdateMatch && req.method === 'DELETE') {
    await withWriteLock(() => handleUserDelete(req, res, userUpdateMatch[1]));
    return;
  }

  if ((url.pathname === '/api/profile' || url.pathname === '/api/contact-email') && req.method === 'POST') {
    await withWriteLock(() => handleProfileUpdate(req, res));
    return;
  }

  if (url.pathname === '/api/contact-request' && req.method === 'POST') {
    await withWriteLock(() => handleContactRequest(req, res));
    return;
  }

  if (url.pathname === '/api/logout' && req.method === 'POST') {
    handleLogout(req, res);
    return;
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    await serveStatic(req, res, url.pathname);
    return;
  }

  sendText(res, 405, 'Method Not Allowed');
}

const server = createServer((req, res) => {
  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    // Static asset noise is not worth a line each; API traffic and errors are.
    if (req.url?.startsWith('/api/') || res.statusCode >= 400) {
      logInfo('request', {
        method: req.method,
        path: req.url?.split('?')[0],
        status: res.statusCode,
        durationMs: Math.round(durationMs)
      });
    }
  });

  // Without this a throwing handler becomes an unhandled rejection, which
  // terminates the process in Node 15 and later.
  handleRequest(req, res).catch((error) => {
    logError('request.failed', error, { method: req.method, path: req.url?.split('?')[0] });

    if (res.headersSent) {
      res.destroy();
      return;
    }

    sendJson(res, 500, { ok: false, error: 'Internal server error.' });
  });
});

// Give in-flight requests a chance to finish, then release the database so the
// WAL is folded back into the main file.
let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logInfo('server.shutdown', { signal });

  const timer = setTimeout(() => {
    logWarn('server.shutdown_forced', { signal });
    closeDatabase();
    process.exit(1);
  }, 10_000);
  timer.unref();

  server.close(() => {
    clearTimeout(timer);
    closeDatabase();
    logInfo('server.stopped', { signal });
    process.exit(0);
  });

  server.closeIdleConnections?.();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logError('process.unhandled_rejection', reason instanceof Error ? reason : new Error(String(reason)));
});

// An uncaught exception leaves the process in an undefined state, so log it and
// let the supervisor restart us rather than continuing to serve traffic.
process.on('uncaughtException', (error) => {
  logError('process.uncaught_exception', error);
  shutdown('uncaughtException');
});

// Import the JSON files this app used to persist to, exactly once. They are
// read and left untouched, so the originals remain as a backup.
async function readJsonFile(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function seedDatabase() {
  const usersJson = await readJsonFile(USERS_FILE);
  const groupsJson = await readJsonFile(GROUPS_FILE);
  const contactJson = await readJsonFile(CONTACT_REQUESTS_FILE);

  let seedUsers = normalizeUserList(Array.isArray(usersJson?.users) ? usersJson.users : []);
  let seedGroups = normalizeGroupsPayload(groupsJson || {});
  const seedContact = normalizeContactRequestList(Array.isArray(contactJson?.requests) ? contactJson.requests : []);
  let source = 'auth-users.json';

  if (!seedUsers.length) {
    if (config.bootstrapTeacherPhone) {
      seedUsers = normalizeUserList([{
        role: 'teacher',
        username: config.bootstrapTeacherPhone,
        phone: config.bootstrapTeacherPhone
      }]);
      source = 'BOOTSTRAP_TEACHER_PHONE';
    } else if (!config.isProduction) {
      // Demo accounts are a development convenience only; their phone numbers
      // are unroutable, but they have no business in a production database.
      seedUsers = normalizeUserList(DEFAULT_USERS);
      seedGroups = seedGroups.length ? seedGroups : DEFAULT_GROUPS.map(normalizeGroup);
      source = 'built-in defaults';
    }
  }

  return seedIfEmpty({ users: seedUsers, groups: seedGroups, contactRequests: seedContact, source });
}

const { problems, warnings } = validateConfig();
for (const warning of warnings) {
  logWarn('config.warning', { detail: warning });
}

if (problems.length) {
  for (const problem of problems) {
    logError('config.invalid', new Error(problem));
  }
  process.exit(78); // EX_CONFIG
}

openDatabase();
await seedDatabase();

server.listen(PORT, config.host, () => {
  logInfo('server.listening', {
    host: config.host,
    port: PORT,
    env: config.nodeEnv,
    sms: hasTwilioCredentials() ? 'twilio' : (config.smsConsoleFallback ? 'console' : 'disabled'),
    debugEndpoints: config.enableDebugEndpoints
  });
});
