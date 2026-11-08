// Business management for the school: students, groups, calendar, lesson
// log, payments, prospects, teaching content, expenses, reports, reminders
// and the daily brief. Exposed under /api/business/* to teachers only.
//
// server.mjs owns HTTP, sessions and the portal's `groups` / `users` tables;
// it hands this module a small context (loadGroups, saveGroups, ensure a
// portal account for a student) so group membership stays in sync with what
// the member portal shows.

import * as store from './business-db.mjs';
import {
  DEFAULT_TIMEZONE,
  addDays,
  addMonths,
  daysBetween,
  formatClock,
  formatDateInZone,
  formatInZone,
  formatIsoDate,
  getZonedParts,
  monthLabel,
  normalizeTimeZone,
  parseClock,
  parseIsoDate,
  todayInZone,
  weekdayOfIsoDate,
  zonedTimeToUtc
} from './time.mjs';

// -------------------------------------------------------------- vocabulary

export const STUDENT_STATUSES = ['trial', 'active', 'waitlist', 'inactive'];
export const LEVELS = ['basic', 'beginner', 'intermediate', 'advanced'];
export const LESSON_TYPES = ['group', 'private', 'both'];
export const BILLING_TYPES = ['monthly', 'package', 'per_lesson'];
// A price in a student's price list: which lessons it is for, and how it
// is billed.
export const PRICE_KINDS = ['group', 'private', 'any'];
export const PRICE_MODELS = ['per_lesson', 'monthly', 'package'];
export const CURRENCIES = ['ILS', 'USD', 'EUR'];
export const LANGUAGES = ['he', 'en', 'he_en', 'ru', 'fr', 'es', 'other'];
// The forms offer only these; the longer lists above still accept what
// older records hold, so saving one does not rewrite it.
export const OFFERED_CURRENCIES = ['ILS', 'USD'];
export const OFFERED_LANGUAGES = ['he', 'en', 'he_en'];
// Messages are written in Hebrew or English, so a parent reads one of those.
export const PARENT_LANGUAGES = ['he', 'en'];

// The language to write to a family in: the parent's own, else the child's
// (a child who speaks only English most likely has English-reading parents).
export function parentLanguageOf(record) {
  if (PARENT_LANGUAGES.includes(record?.parentLanguage)) return record.parentLanguage;
  return record?.language === 'en' ? 'en' : 'he';
}

// Whether a child and a group share a language. A child (or a group) in
// both Hebrew and English fits a Hebrew group and an English group alike.
export function languagesFit(a, b) {
  if (a === b) return true;
  return (a === 'he_en' && (b === 'he' || b === 'en')) || (b === 'he_en' && (a === 'he' || a === 'en'));
}
export const LESSON_KINDS = ['group', 'private', 'trial', 'makeup'];
export const LESSON_STATUSES = ['held', 'cancelled'];
export const ATTENDANCE = ['present', 'absent', 'late'];
export const LEAD_STATUSES = ['new', 'contacted', 'trial_scheduled', 'trial_done', 'waiting_group', 'converted', 'lost'];
// A paid ad and a referral come first: they are where most families come from.
export const LEAD_SOURCES = ['paid_ad', 'referral', 'facebook', 'instagram', 'website', 'other'];
export const LEAD_PREFERENCES = ['group', 'private', 'either'];
export const CONTENT_KINDS = ['plan', 'exercise', 'game', 'homework', 'curriculum'];
export const EXPENSE_CATEGORIES = ['advertising', 'teacher', 'operations', 'software', 'other'];
export const EVENT_KINDS = ['cancel', 'reschedule', 'makeup', 'trial', 'private', 'other'];
export const GROUP_STATUSES = ['active', 'forming', 'full', 'closed'];
export const MESSAGE_KINDS = ['lesson_reminder', 'payment_reminder', 'lesson_summary', 'homework', 'progress', 'trial_invite', 'followup', 'schedule_change', 'new_group', 'review_request', 'tournament', 'custom'];
export const PAYMENT_METHODS = ['bit', 'paybox', 'bank', 'paypal', 'credit', 'cash', 'other'];

const DEFAULT_SETTINGS = {
  businessTimezone: DEFAULT_TIMEZONE,
  reminderLeadHours: 3,
  paymentReminderDays: 5,
  usdToIls: 3.7,
  eurToIls: 4.0,
  defaultCurrency: 'ILS',
  defaultGroupPrice: 250,
  defaultPrivatePrice: 150,
  teacherName: 'דולב',
  maxGroupSize: 5,
  // How far a child may be from a group's students and still count as
  // close, for the group suggested to each prospect.
  matchAgeYears: 2,
  matchLevelSteps: 1,
  matchRatingPoints: 150,
  templates: {
    lesson_reminder: {
      he: 'היי {parentName}! תזכורת: השיעור של {studentName} מתחיל היום ב-{time}.\nקישור לזום: {zoomLink}\nנתראה! {teacherName}',
      en: 'Hi {parentName}! Reminder: {studentName}\'s chess lesson starts today at {time}.\nZoom link: {zoomLink}\nSee you soon! {teacherName}'
    },
    payment_reminder: {
      he: 'היי {parentName}, תזכורת קטנה: התשלום עבור השיעורים של {studentName} ({amount}) מגיע ב-{dueDate}. תודה רבה! {teacherName}',
      en: 'Hi {parentName}, a gentle reminder: the payment for {studentName}\'s lessons ({amount}) is due on {dueDate}. Thank you! {teacherName}'
    },
    lesson_summary: {
      he: 'היי {parentName}! סיכום השיעור של {studentName} מהיום:\nנושא: {topic}\n{successes}\nשיעורי בית: {homework}\nשבוע טוב! {teacherName}',
      en: 'Hi {parentName}! Here is a summary of {studentName}\'s lesson today:\nTopic: {topic}\n{successes}\nHomework: {homework}\nHave a great week! {teacherName}'
    },
    homework: {
      he: 'היי {parentName}, שיעורי הבית של {studentName} לשבוע הקרוב:\n{homework}\nבהצלחה! {teacherName}',
      en: 'Hi {parentName}, {studentName}\'s homework for this week:\n{homework}\nGood luck! {teacherName}'
    },
    progress: {
      he: 'היי {parentName}! רציתי לעדכן על ההתקדמות של {studentName}: {notes}\n{teacherName}',
      en: 'Hi {parentName}! A quick update on {studentName}\'s progress: {notes}\n{teacherName}'
    },
    trial_invite: {
      he: 'היי {parentName}! שמחתי לשמוע ממך. אשמח להזמין את {studentName} לשיעור ניסיון ב-{trialDate} בשעה {time}.\nקישור לזום: {zoomLink}\nמחכה לראותכם! {teacherName}',
      en: 'Hi {parentName}! Great to hear from you. I\'d love to invite {studentName} to a trial lesson on {trialDate} at {time}.\nZoom link: {zoomLink}\nLooking forward! {teacherName}'
    },
    followup: {
      he: 'היי {parentName}, רק בודק אם עדיין רלוונטי לכם לשיעורי השחמט עבור {studentName}? אשמח לעזור בכל שאלה. {teacherName}',
      en: 'Hi {parentName}, just checking in: are you still interested in chess lessons for {studentName}? Happy to answer any questions. {teacherName}'
    },
    schedule_change: {
      he: 'היי {parentName}, עדכון לגבי השיעור של {studentName}: {notes}\nתודה על ההבנה! {teacherName}',
      en: 'Hi {parentName}, an update about {studentName}\'s lesson: {notes}\nThanks for understanding! {teacherName}'
    },
    new_group: {
      he: 'היי {parentName}! נפתחת קבוצה חדשה שמתאימה ל-{studentName}: {notes}. רוצים להצטרף? {teacherName}',
      en: 'Hi {parentName}! A new group that fits {studentName} is opening: {notes}. Would you like to join? {teacherName}'
    },
    review_request: {
      he: 'היי {parentName}! אם אתם מרוצים מהשיעורים של {studentName}, אשמח מאוד אם תוכלו לכתוב כמה מילים של המלצה. תודה ענקית! {teacherName}',
      en: 'Hi {parentName}! If you\'re happy with {studentName}\'s lessons, I\'d be grateful for a short recommendation. Thank you so much! {teacherName}'
    },
    tournament: {
      he: 'היי {parentName}! {notes}\n{teacherName}',
      en: 'Hi {parentName}! {notes}\n{teacherName}'
    },
    custom: { he: '{notes}', en: '{notes}' }
  }
};

// ---------------------------------------------------------------- helpers

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function text(value, max = 2000) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\r\n/g, '\n').trim().slice(0, max);
}

function oneOf(value, allowed, fallback) {
  const normalized = text(value, 64).toLowerCase();
  return allowed.includes(normalized) ? normalized : fallback;
}

function int(value, { min = -Infinity, max = Infinity } = {}) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(max, Math.max(min, parsed));
}

function num(value, { min = -Infinity, max = Infinity } = {}) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(max, Math.max(min, Math.round(parsed * 100) / 100));
}

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function isoDate(value) {
  const parts = parseIsoDate(value);
  return parts ? formatIsoDate(parts) : '';
}

function clock(value) {
  const parsed = parseClock(value);
  return parsed ? formatClock(parsed) : '';
}

function isoDateTime(value) {
  const trimmed = text(value, 40);
  if (!trimmed) return '';
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
}

function stringList(value, max = 60) {
  const source = Array.isArray(value)
    ? value
    : String(value || '').split(/[,\n]/);
  const out = [];
  for (const entry of source) {
    const normalized = text(entry, 120);
    if (normalized && !out.includes(normalized)) out.push(normalized);
    if (out.length >= max) break;
  }
  return out;
}

function phone(value) {
  const raw = text(value, 40);
  if (!raw) return '';
  let digits = raw.replace(/[^\d+]/g, '');
  if (digits.startsWith('00')) digits = `+${digits.slice(2)}`;
  if (!digits.startsWith('+')) {
    if (digits.startsWith('0') && digits.length >= 9 && digits.length <= 10) digits = `+972${digits.slice(1)}`;
    else if (digits.length === 10 && digits.startsWith('1')) digits = `+${digits}`;
    else digits = `+${digits}`;
  }
  return /^\+\d{7,15}$/.test(digits) ? digits : '';
}

// A phone that may later sign someone in: a typo is an error, not a blank.
function requiredFormatPhone(value, label) {
  const normalized = phone(value);
  if (text(value, 40) && !/^\+[1-9]\d{7,14}$/.test(normalized)) {
    throw new HttpError(400, `${label} is not a valid phone number. Use the international format, for example +972 50 123 4567.`);
  }
  return normalized;
}

function nowIso() {
  return new Date().toISOString();
}

function localized(value, lang) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return value[lang] || value.he || value.en || Object.values(value)[0] || '';
}

function studentName(student) {
  return [student?.firstName, student?.lastName].filter(Boolean).join(' ').trim() || student?.parentName || '';
}

// The parent's first and last name. Older callers send one parentName; split
// it at the first space like the one-time backfill does.
function parentNames(payload, base) {
  if ('parentFirstName' in payload || 'parentLastName' in payload) {
    const pick = (key) => text(key in payload ? payload[key] : base[key], 60);
    return { first: pick('parentFirstName'), last: pick('parentLastName') };
  }
  if ('parentName' in payload) {
    const [first, ...rest] = text(payload.parentName, 120).split(/\s+/);
    return { first: first || '', last: rest.join(' ') };
  }
  return { first: base.parentFirstName || '', last: base.parentLastName || '' };
}

function withParentNames(record, names) {
  record.parentFirstName = names.first;
  record.parentLastName = names.last;
  record.parentName = [names.first, names.last].filter(Boolean).join(' ');
  return record;
}

function ageOf(record, today) {
  if (record?.birthDate) {
    const birth = parseIsoDate(record.birthDate);
    const now = parseIsoDate(today);
    if (birth && now) {
      let age = now.year - birth.year;
      if (now.month < birth.month || (now.month === birth.month && now.day < birth.day)) age -= 1;
      return age;
    }
  }
  return record?.age ?? null;
}

// ------------------------------------------------------------- settings

export function getSettings() {
  const stored = store.listSettings();
  const templates = { ...DEFAULT_SETTINGS.templates };
  for (const [kind, value] of Object.entries(stored.templates || {})) {
    if (value && typeof value === 'object') {
      templates[kind] = { ...(templates[kind] || {}), ...value };
    }
  }
  return { ...DEFAULT_SETTINGS, ...stored, templates };
}

function normalizeSettingsPatch(payload) {
  const patch = {};
  if ('businessTimezone' in payload) patch.businessTimezone = normalizeTimeZone(payload.businessTimezone);
  if ('reminderLeadHours' in payload) patch.reminderLeadHours = int(payload.reminderLeadHours, { min: 0, max: 72 }) ?? DEFAULT_SETTINGS.reminderLeadHours;
  if ('paymentReminderDays' in payload) patch.paymentReminderDays = int(payload.paymentReminderDays, { min: 0, max: 60 }) ?? DEFAULT_SETTINGS.paymentReminderDays;
  if ('usdToIls' in payload) patch.usdToIls = num(payload.usdToIls, { min: 0.01, max: 100 }) ?? DEFAULT_SETTINGS.usdToIls;
  if ('eurToIls' in payload) patch.eurToIls = num(payload.eurToIls, { min: 0.01, max: 100 }) ?? DEFAULT_SETTINGS.eurToIls;
  if ('defaultCurrency' in payload) patch.defaultCurrency = oneOf(payload.defaultCurrency, CURRENCIES, 'ILS').toUpperCase();
  if ('defaultGroupPrice' in payload) patch.defaultGroupPrice = num(payload.defaultGroupPrice, { min: 0 }) ?? 0;
  if ('defaultPrivatePrice' in payload) patch.defaultPrivatePrice = num(payload.defaultPrivatePrice, { min: 0 }) ?? 0;
  if ('teacherName' in payload) patch.teacherName = text(payload.teacherName, 80);
  if ('maxGroupSize' in payload) patch.maxGroupSize = int(payload.maxGroupSize, { min: 1, max: 30 }) ?? 5;
  if ('matchAgeYears' in payload) patch.matchAgeYears = int(payload.matchAgeYears, { min: 0, max: 20 }) ?? DEFAULT_SETTINGS.matchAgeYears;
  if ('matchLevelSteps' in payload) patch.matchLevelSteps = int(payload.matchLevelSteps, { min: 0, max: LEVELS.length - 1 }) ?? DEFAULT_SETTINGS.matchLevelSteps;
  if ('matchRatingPoints' in payload) patch.matchRatingPoints = int(payload.matchRatingPoints, { min: 0, max: 3000 }) ?? DEFAULT_SETTINGS.matchRatingPoints;
  if (payload.templates && typeof payload.templates === 'object') {
    patch.templates = {};
    for (const kind of MESSAGE_KINDS) {
      const value = payload.templates[kind];
      if (!value || typeof value !== 'object') continue;
      patch.templates[kind] = {};
      for (const lang of ['he', 'en']) {
        if (typeof value[lang] === 'string') patch.templates[kind][lang] = text(value[lang], 2000);
      }
    }
  }
  return patch;
}

// -------------------------------------------------------- normalisation

function normalizeSchedule(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((row) => ({
      weekday: int(row?.weekday, { min: 0, max: 6 }),
      startTime: clock(row?.startTime),
      durationMinutes: int(row?.durationMinutes, { min: 15, max: 240 }) ?? 60
    }))
    .filter((row) => row.weekday !== null && row.startTime)
    .slice(0, 7);
}

// Prices by lesson length, for a student who pays per lesson and has
// lessons of different lengths. One price per length; a row without a
// price is dropped, so the length falls back to the student's own price.
function normalizeLessonPrices(value) {
  if (!Array.isArray(value)) return [];
  const byLength = new Map();
  for (const row of value) {
    const durationMinutes = int(row?.durationMinutes, { min: 15, max: 240 });
    const price = num(row?.price, { min: 0, max: 100000 });
    if (durationMinutes !== null && price !== null) byLength.set(durationMinutes, { durationMinutes, price });
  }
  return [...byLength.values()].sort((a, b) => b.durationMinutes - a.durationMinutes).slice(0, 10);
}

// A student's price list. A price keeps its id across edits; one added to
// an existing student starts charging monthly from `since` (today), one on
// a new student from the day they start.
function normalizePrices(value, previous = [], since = '') {
  if (!Array.isArray(value)) return [];
  const before = Object.fromEntries((previous || []).map((item) => [item.id, item]));
  const out = [];
  for (const row of value.slice(0, 20)) {
    const model = oneOf(row?.model, PRICE_MODELS, 'per_lesson');
    const amount = num(row?.amount, { min: 0, max: 100000 });
    if (amount === null) continue;
    const packageSize = model === 'package' ? int(row?.packageSize, { min: 1, max: 200 }) : null;
    // A monthly price's single lesson, for a month the student has only
    // part of.
    const lessonAmount = model === 'monthly' ? num(row?.lessonAmount, { min: 0, max: 100000 }) : null;
    if (model === 'package' && !packageSize) continue;
    const id = text(row?.id, 40);
    const kept = id && before[id];
    out.push({
      id: kept ? id : store.newId('prc'),
      kind: oneOf(row?.kind, PRICE_KINDS, 'any'),
      model,
      durationMinutes: model === 'monthly' ? null : int(row?.durationMinutes, { min: 15, max: 240 }),
      amount,
      packageSize,
      lessonAmount,
      since: kept ? (kept.since || '') : since
    });
  }
  return out;
}

// The price list for billing set the old way: one billing type and price,
// with prices by length for per-lesson students. A package price was per
// lesson.
function legacyPrices(student) {
  const price = student.price;
  if (student.billingType === 'monthly') {
    if (price === null || price === undefined) return [];
    const kind = student.lessonType === 'private' ? 'private' : student.lessonType === 'both' ? 'any' : 'group';
    return [{ id: store.newId('prc'), kind, model: 'monthly', durationMinutes: null, amount: price, packageSize: null, lessonAmount: null, since: '' }];
  }
  if (student.billingType === 'package') {
    if (price === null || price === undefined) return [];
    const size = student.packageSize || 1;
    return [{ id: store.newId('prc'), kind: 'any', model: 'package', durationMinutes: null, amount: round2(price * size), packageSize: size, since: '' }];
  }
  const byLength = (student.lessonPrices || []).map((row) => ({ id: store.newId('prc'), kind: 'any', model: 'per_lesson', durationMinutes: row.durationMinutes, amount: row.price, packageSize: null, since: '' }));
  if (price !== null && price !== undefined) byLength.push({ id: store.newId('prc'), kind: 'any', model: 'per_lesson', durationMinutes: null, amount: price, packageSize: null, since: '' });
  return byLength;
}

export function normalizeStudent(payload = {}, existing = null) {
  const base = existing || {};
  const value = (key) => (key in payload ? payload[key] : base[key]);
  const settings = getSettings();
  const created = base.createdAt || nowIso();

  // A student is active until they leave: a leaving date (today or earlier)
  // makes them inactive, and clearing it brings them back. The other
  // states exist only on old records.
  const leftAt = isoDate(value('leftAt'));
  if (leftAt && leftAt > todayInZone(settings.businessTimezone)) throw new HttpError(400, 'A leaving date cannot be in the future.');
  const status = leftAt || (base.status === 'inactive' && !('leftAt' in payload)) ? 'inactive' : 'active';
  const record = {
    id: base.id || store.newId('stu'),
    firstName: text(value('firstName'), 80),
    lastName: text(value('lastName'), 80),
    age: int(value('age'), { min: 3, max: 99 }),
    birthDate: isoDate(value('birthDate')),
    country: text(value('country'), 80),
    region: text(value('region'), 80),
    timezone: value('timezone') ? normalizeTimeZone(value('timezone'), settings.businessTimezone) : '',
    language: oneOf(value('language'), LANGUAGES, 'he'),
    parentLanguage: '',
    parentPhone: phone(value('parentPhone')),
    parentPhone2: phone(value('parentPhone2')),
    parentEmail: text(value('parentEmail'), 160).toLowerCase(),
    level: oneOf(value('level'), LEVELS, 'basic'),
    chesscomUsername: text(value('chesscomUsername'), 80),
    chesscomRating: int(value('chesscomRating'), { min: 0, max: 4000 }),
    lichessUsername: text(value('lichessUsername'), 80),
    lichessRating: int(value('lichessRating'), { min: 0, max: 4000 }),
    groupId: text(value('groupId'), 80),
    teacher: text(value('teacher'), 120),
    lessonType: oneOf(value('lessonType'), LESSON_TYPES, 'group'),
    privateSchedule: normalizeSchedule(value('privateSchedule')),
    privateZoomLink: text(value('privateZoomLink'), 500),
    joinedAt: isoDate(value('joinedAt')) || base.joinedAt || '',
    groupJoinedAt: base.groupJoinedAt || '',
    leftAt,
    status,
    topicsLearned: stringList(value('topicsLearned'), 200),
    strengths: text(value('strengths')),
    weaknesses: text(value('weaknesses')),
    goals: text(value('goals')),
    notes: text(value('notes'), 8000),
    price: num(value('price'), { min: 0, max: 100000 }),
    currency: oneOf(value('currency'), CURRENCIES.map((c) => c.toLowerCase()), 'ils').toUpperCase(),
    billingType: oneOf(value('billingType'), BILLING_TYPES, 'monthly'),
    lessonPrices: normalizeLessonPrices(value('lessonPrices')),
    packageSize: int(value('packageSize'), { min: 1, max: 200 }),
    billingDay: int(value('billingDay'), { min: 1, max: 28 }),
    paymentTerms: text(value('paymentTerms'), 500),
    nextPaymentAt: isoDate(value('nextPaymentAt')),
    remindersEnabled: bool(value('remindersEnabled'), base.remindersEnabled ?? true),
    reminderLeadHours: int(value('reminderLeadHours'), { min: 0, max: 72 }),
    userPhone: phone(value('userPhone')),
    source: text(value('source'), 80),
    referredBy: text(value('referredBy'), 120),
    leadId: text(value('leadId'), 80),
    createdAt: created,
    updatedAt: nowIso()
  };
  if (record.source !== 'referral') record.referredBy = '';
  // A new student given a billing type and price the old way (the demo
  // data, an older client) gets the matching price list.
  record.prices = 'prices' in payload
    ? normalizePrices(payload.prices, base.prices, existing ? todayInZone(settings.businessTimezone) : '')
    : (existing ? (base.prices || []) : legacyPrices(record));
  record.chargeHistory = base.chargeHistory || [];
  record.ledgerFrom = base.ledgerFrom || '';
  record.openingBalance = base.openingBalance ?? null;
  record.parentLanguage = oneOf(value('parentLanguage'), PARENT_LANGUAGES, parentLanguageOf(record));

  withParentNames(record, parentNames(payload, base));
  if (!record.firstName && !record.parentName) {
    throw new HttpError(400, 'A student needs a first name.');
  }
  if (record.userPhone) {
    const clash = store.students.list({ where: 'user_phone = ? AND id != ?', params: [record.userPhone, record.id] });
    if (clash.length) throw new HttpError(409, 'Another student already uses that portal sign-in phone.');
  }
  if (!record.joinedAt && (status === 'active' || status === 'trial')) {
    record.joinedAt = todayInZone(settings.businessTimezone);
  }
  // A new group starts today; a student created in a group joined it when
  // they joined the school. Records from before this field use joinedAt.
  if (!record.groupId) record.groupJoinedAt = '';
  else if (!existing) record.groupJoinedAt = record.joinedAt;
  else if (base.groupId !== record.groupId) record.groupJoinedAt = todayInZone(settings.businessTimezone);
  else if (!record.groupJoinedAt) record.groupJoinedAt = record.joinedAt;
  if (status === 'inactive' && !record.leftAt) {
    record.leftAt = todayInZone(settings.businessTimezone);
  }
  if (status !== 'inactive') {
    record.leftAt = '';
  }
  return record;
}

export function normalizeGroupProfile(payload = {}, existing = null, groupId = '') {
  const base = existing || {};
  const value = (key) => (key in payload ? payload[key] : base[key]);
  return {
    groupId: groupId || base.groupId,
    minAge: int(value('minAge'), { min: 3, max: 99 }),
    maxAge: int(value('maxAge'), { min: 3, max: 99 }),
    level: oneOf(value('level'), LEVELS, ''),
    ratingMin: int(value('ratingMin'), { min: 0, max: 4000 }),
    ratingMax: int(value('ratingMax'), { min: 0, max: 4000 }),
    language: oneOf(value('language'), LANGUAGES, 'he'),
    teacher: text(value('teacher'), 120),
    status: oneOf(value('status'), GROUP_STATUSES, 'active'),
    price: num(value('price'), { min: 0, max: 100000 }),
    currency: oneOf(value('currency'), CURRENCIES.map((c) => c.toLowerCase()), 'ils').toUpperCase(),
    description: text(value('description'), 2000),
    updatedAt: nowIso()
  };
}

export function normalizeLesson(payload = {}, existing = null, actor = '') {
  const base = existing || {};
  const value = (key) => (key in payload ? payload[key] : base[key]);
  const attendanceSource = value('attendance');
  const attendance = {};
  if (attendanceSource && typeof attendanceSource === 'object') {
    for (const [studentId, status] of Object.entries(attendanceSource)) {
      const normalized = oneOf(status, ATTENDANCE, '');
      if (normalized) attendance[text(studentId, 80)] = normalized;
    }
  }

  const record = {
    id: base.id || store.newId('les'),
    date: isoDate(value('date')),
    startTime: clock(value('startTime')),
    durationMinutes: int(value('durationMinutes'), { min: 10, max: 300 }),
    kind: oneOf(value('kind'), LESSON_KINDS, 'group'),
    groupId: text(value('groupId'), 80),
    studentIds: stringList(value('studentIds'), 60),
    teacher: text(value('teacher'), 120),
    topic: text(value('topic'), 300),
    topics: stringList(value('topics'), 40),
    exercises: text(value('exercises')),
    games: text(value('games')),
    gameRefs: normalizeGameRefs(value('gameRefs'), base.gameRefs),
    successes: text(value('successes')),
    difficulties: text(value('difficulties')),
    homework: text(value('homework')),
    nextSteps: text(value('nextSteps')),
    notes: text(value('notes'), 8000),
    rawSummary: text(value('rawSummary'), 8000),
    attendance,
    status: oneOf(value('status'), LESSON_STATUSES, 'held'),
    createdBy: base.createdBy || actor,
    createdAt: base.createdAt || nowIso(),
    updatedAt: nowIso()
  };

  // The price picked by hand for a student, when not the automatic one.
  const choices = value('priceChoices');
  record.priceChoices = {};
  if (choices && typeof choices === 'object') {
    for (const [studentId, priceId] of Object.entries(choices)) {
      if (priceId) record.priceChoices[text(studentId, 80)] = text(priceId, 40);
    }
  }
  // A kept charge belongs to the lesson as it was: one moved to another
  // date or length is charged afresh for everyone, and a student given
  // another price is charged afresh on their own.
  const sameLesson = base.date === record.date && (base.durationMinutes ?? null) === record.durationMinutes;
  record.charges = {};
  if (sameLesson && base.charges && typeof base.charges === 'object') {
    for (const [studentId, charge] of Object.entries(base.charges)) {
      if ((base.priceChoices?.[studentId] || '') === (record.priceChoices[studentId] || '')) record.charges[studentId] = charge;
    }
  }

  if (!record.date) throw new HttpError(400, 'A lesson needs a date.');
  if (!record.groupId && !record.studentIds.length) throw new HttpError(400, 'A lesson needs a group or at least one student.');
  if (!record.topics.length && record.topic) record.topics = [record.topic];
  return record;
}

// A lesson points at games in the content list by id. The title is copied
// in as well, so a game that is later deleted still says what was shown;
// while the game exists its current title always wins (see withGames).
function normalizeGameRefs(value, previous = []) {
  if (!Array.isArray(value)) return Array.isArray(previous) ? previous : [];
  const remembered = Object.fromEntries((previous || []).map((ref) => [ref.id, ref.title]));
  const out = [];
  for (const entry of value.slice(0, 20)) {
    const id = text(typeof entry === 'string' ? entry : entry?.id, 80);
    if (!id || out.some((ref) => ref.id === id)) continue;
    const item = store.content.get(id);
    // The name of a game that is gone is whatever this lesson already
    // remembered: the client can neither drop it by sending only the id nor
    // replace it with a different name. A brand-new reference to a missing
    // game needs a title to be kept at all.
    const title = item ? item.title : (remembered[id] || text(entry?.title, 200));
    if (!title) continue;
    out.push({ id, title });
  }
  return out;
}

// Every content item, not only games: an item whose kind was changed after
// a lesson used it still resolves by its current name instead of reading
// as deleted.
function gameIndex() {
  return Object.fromEntries(store.content.list().map((item) => [item.id, item]));
}

export function withGames(lesson, index = gameIndex()) {
  return {
    ...lesson,
    gamesResolved: (lesson.gameRefs || []).map((ref) => {
      const item = index[ref.id];
      return item
        ? { id: ref.id, title: item.title, exists: true, white: item.white, black: item.black, result: item.result }
        : { id: ref.id, title: ref.title, exists: false };
    })
  };
}

export function normalizePayment(payload = {}, existing = null, actor = '') {
  const base = existing || {};
  const value = (key) => (key in payload ? payload[key] : base[key]);
  const record = {
    id: base.id || store.newId('pay'),
    studentId: text(value('studentId'), 80),
    amount: num(value('amount'), { min: 0, max: 1000000 }) ?? 0,
    currency: oneOf(value('currency'), CURRENCIES.map((c) => c.toLowerCase()), 'ils').toUpperCase(),
    paidAt: isoDate(value('paidAt')) || todayInZone(getSettings().businessTimezone),
    method: oneOf(value('method'), PAYMENT_METHODS, 'other'),
    periodLabel: text(value('periodLabel'), 40),
    lessonsCount: int(value('lessonsCount'), { min: 0, max: 500 }),
    receiptIssued: bool(value('receiptIssued'), false),
    receiptNumber: text(value('receiptNumber'), 80),
    notes: text(value('notes'), 2000),
    createdBy: base.createdBy || actor,
    createdAt: base.createdAt || nowIso()
  };
  if (!record.studentId) throw new HttpError(400, 'A payment needs a student.');
  if (!store.students.get(record.studentId)) throw new HttpError(404, 'Unknown student.');
  return record;
}

export function normalizeLead(payload = {}, existing = null) {
  const base = existing || {};
  const value = (key) => (key in payload ? payload[key] : base[key]);
  const record = {
    id: base.id || store.newId('lead'),
    parentPhone: phone(value('parentPhone')),
    parentEmail: text(value('parentEmail'), 160).toLowerCase(),
    childName: text(value('childName'), 120),
    childAge: int(value('childAge'), { min: 3, max: 99 }),
    level: oneOf(value('level'), LEVELS, ''),
    chesscomRating: int(value('chesscomRating'), { min: 0, max: 4000 }),
    lichessRating: int(value('lichessRating'), { min: 0, max: 4000 }),
    language: oneOf(value('language'), LANGUAGES, 'he'),
    country: text(value('country'), 80),
    timezone: value('timezone') ? normalizeTimeZone(value('timezone')) : '',
    availability: text(value('availability'), 500),
    preference: oneOf(value('preference'), LEAD_PREFERENCES, 'either'),
    priceQuoted: num(value('priceQuoted'), { min: 0, max: 100000 }),
    currency: oneOf(value('currency'), CURRENCIES.map((c) => c.toLowerCase()), 'ils').toUpperCase(),
    source: oneOf(value('source'), LEAD_SOURCES, 'other'),
    referredBy: text(value('referredBy'), 120),
    status: oneOf(value('status'), LEAD_STATUSES, 'new'),
    trialAt: isoDateTime(value('trialAt')),
    trialResult: text(value('trialResult'), 2000),
    nextFollowupAt: isoDate(value('nextFollowupAt')),
    lastContactAt: isoDate(value('lastContactAt')),
    notes: text(value('notes'), 8000),
    convertedStudentId: text(value('convertedStudentId'), 80),
    createdAt: base.createdAt || nowIso(),
    updatedAt: nowIso()
  };
  if (record.source !== 'referral') record.referredBy = '';
  withParentNames(record, parentNames(payload, base));
  if (!record.parentName && !record.childName && !record.parentPhone) {
    throw new HttpError(400, 'A prospect needs a name or a phone number.');
  }
  return record;
}

export function normalizeContent(payload = {}, existing = null, actor = '') {
  const base = existing || {};
  const value = (key) => (key in payload ? payload[key] : base[key]);
  const record = {
    id: base.id || store.newId('con'),
    kind: oneOf(value('kind'), CONTENT_KINDS, 'plan'),
    title: text(value('title'), 200),
    topic: text(value('topic'), 120),
    level: oneOf(value('level'), LEVELS, ''),
    ageMin: int(value('ageMin'), { min: 3, max: 99 }),
    ageMax: int(value('ageMax'), { min: 3, max: 99 }),
    durationMinutes: int(value('durationMinutes'), { min: 5, max: 300 }),
    fen: text(value('fen'), 120),
    pgn: text(value('pgn'), 8000),
    solution: text(value('solution'), 4000),
    body: text(value('body'), 20000),
    tags: stringList(value('tags'), 30),
    verified: bool(value('verified'), false),
    white: text(value('white'), 120),
    black: text(value('black'), 120),
    event: text(value('event'), 200),
    gameDate: text(value('gameDate'), 20),
    result: text(value('result'), 10),
    sourceFile: text(value('sourceFile'), 200),
    movesCount: int(value('movesCount'), { min: 0, max: 1000 }),
    createdBy: base.createdBy || actor,
    createdAt: base.createdAt || nowIso(),
    updatedAt: nowIso()
  };
  if (!record.title) throw new HttpError(400, 'Content needs a title.');
  return record;
}

// ------------------------------------------------------------ PGN import

// Splits a PGN file into games and reads the seven-tag roster. Move legality
// is checked in the browser when a game is opened; here we only count moves.
export function parsePgnFile(textContent) {
  const games = [];
  let current = [];
  let sawMoves = false;
  for (const line of String(textContent || '').replace(/\r\n/g, '\n').split('\n')) {
    const isHeader = /^\s*\[\w+\s+".*"\]\s*$/.test(line);
    if (isHeader && sawMoves) { games.push(current.join('\n')); current = []; sawMoves = false; }
    if (!isHeader && line.trim()) sawMoves = true;
    current.push(line);
  }
  if (current.some((line) => line.trim())) games.push(current.join('\n'));

  return games.filter((game) => game.trim()).map((pgn) => {
    const headers = {};
    const moveLines = [];
    for (const line of pgn.split('\n')) {
      const header = /^\s*\[(\w+)\s+"(.*)"\]\s*$/.exec(line);
      if (header) headers[header[1]] = header[2].replace(/\\"/g, '"');
      else moveLines.push(line);
    }
    const tokens = stripMovetext(moveLines.join('\n')).split(/\s+/).filter(Boolean);
    let movesCount = 0;
    for (const token of tokens) {
      if (/^(1-0|0-1|1\/2-1\/2|\*)$/.test(token)) break;
      const cleaned = token.replace(/^\d+\.+/, '').replace(/e\.p\.?$/i, '');
      if (!cleaned || /^\.+$/.test(cleaned) || cleaned === '--' || cleaned === 'Z0') continue;
      movesCount += 1;
    }
    return { pgn: pgn.trim(), headers, movesCount };
  }).filter((game) => game.movesCount > 0 || Object.keys(game.headers).length > 0);
}

// Removes brace comments, rest-of-line comments and variations from PGN
// movetext with one pass, so a ';' inside braces or a '{' inside a line
// comment cannot derail the parse the way regex passes did.
export function stripMovetext(text) {
  let out = '';
  let mode = 'moves';
  let depth = 0;
  for (const char of String(text || '')) {
    if (mode === 'brace') { if (char === '}') mode = 'moves'; continue; }
    if (mode === 'line') { if (char === '\n') { mode = 'moves'; out += ' '; } continue; }
    if (char === '{') { mode = 'brace'; out += ' '; continue; }
    if (char === ';') { mode = 'line'; continue; }
    if (char === '(') { depth += 1; continue; }
    if (char === ')') { depth = Math.max(0, depth - 1); continue; }
    if (depth === 0) out += char;
  }
  return out.replace(/\$\d+/g, ' ');
}

function gameTitle(headers) {
  const white = headers.White && headers.White !== '?' ? headers.White : '';
  const black = headers.Black && headers.Black !== '?' ? headers.Black : '';
  const players = white || black ? `${white || '?'} – ${black || '?'}` : '';
  const event = headers.Event && headers.Event !== '?' ? headers.Event : '';
  const year = headers.Date && /^\d{4}/.test(headers.Date) ? headers.Date.slice(0, 4) : '';
  return [players, [event, year].filter(Boolean).join(' ')].filter(Boolean).join(', ') || 'Game';
}

export function normalizeExpense(payload = {}, existing = null) {
  const base = existing || {};
  const value = (key) => (key in payload ? payload[key] : base[key]);
  const record = {
    id: base.id || store.newId('exp'),
    date: isoDate(value('date')) || todayInZone(getSettings().businessTimezone),
    category: oneOf(value('category'), EXPENSE_CATEGORIES, 'other'),
    amount: num(value('amount'), { min: 0, max: 1000000 }) ?? 0,
    currency: oneOf(value('currency'), CURRENCIES.map((c) => c.toLowerCase()), 'ils').toUpperCase(),
    description: text(value('description'), 500),
    createdAt: base.createdAt || nowIso()
  };
  return record;
}

export function normalizeTeacher(payload = {}, existing = null) {
  const base = existing || {};
  const value = (key) => (key in payload ? payload[key] : base[key]);
  const record = {
    id: base.id || store.newId('tch'),
    name: text(value('name'), 120),
    phone: requiredFormatPhone(value('phone'), 'The teacher\'s phone'),
    email: text(value('email'), 200),
    notes: text(value('notes'), 2000),
    hourlyRate: num(value('hourlyRate'), { min: 0, max: 100000 }),
    currency: oneOf(value('currency'), CURRENCIES.map((c) => c.toLowerCase()), getSettings().defaultCurrency.toLowerCase()).toUpperCase(),
    createdAt: base.createdAt || nowIso(),
    updatedAt: nowIso()
  };
  if (!record.name) throw new HttpError(400, 'Teacher name is required.');
  return record;
}

export function normalizeEvent(payload = {}, existing = null) {
  const base = existing || {};
  const value = (key) => (key in payload ? payload[key] : base[key]);
  const record = {
    id: base.id || store.newId('evt'),
    kind: oneOf(value('kind'), EVENT_KINDS, 'other'),
    date: isoDate(value('date')),
    startTime: clock(value('startTime')),
    durationMinutes: int(value('durationMinutes'), { min: 10, max: 300 }),
    groupId: text(value('groupId'), 80),
    studentId: text(value('studentId'), 80),
    leadId: text(value('leadId'), 80),
    title: text(value('title'), 200),
    zoomLink: text(value('zoomLink'), 500),
    note: text(value('note'), 2000),
    originalDate: isoDate(value('originalDate')),
    originalTime: clock(value('originalTime')),
    createdAt: base.createdAt || nowIso()
  };
  if (!record.date) throw new HttpError(400, 'An event needs a date.');
  if (record.kind === 'cancel' && !record.groupId && !record.studentId) {
    throw new HttpError(400, 'A cancellation needs a group or a student.');
  }
  if (record.kind === 'reschedule' && !record.originalDate) {
    record.originalDate = record.date;
  }
  if (record.kind !== 'cancel' && !record.startTime) {
    throw new HttpError(400, 'An event needs a start time.');
  }
  return record;
}

// -------------------------------------------------------- groups + seats

function groupTitle(group, lang = 'he') {
  return localized(group?.title, lang) || group?.id || '';
}

function scheduleRows(group) {
  const schedule = group?.schedule || {};
  const rows = Array.isArray(schedule.rows) && schedule.rows.length ? schedule.rows : [schedule];
  return rows
    .map((row) => ({
      weekday: int(row?.weekday, { min: 0, max: 6 }),
      startTime: clock(row?.startTime),
      durationMinutes: int(row?.durationMinutes, { min: 10, max: 300 }) ?? 60
    }))
    .filter((row) => row.weekday !== null && row.startTime);
}

function groupTimezone(group, settings) {
  return normalizeTimeZone(group?.schedule?.timezone, settings.businessTimezone);
}

function lessonsForGroup(groupId) {
  return store.lessons.list({ where: 'group_id = ? AND status = ?', params: [groupId, 'held'] });
}

function topicsFromLessons(lessonRows) {
  const topics = [];
  for (const lesson of lessonRows) {
    for (const topic of lesson.topics || []) {
      if (!topics.includes(topic)) topics.push(topic);
    }
  }
  return topics;
}

export function buildGroupViews(groups, settings = getSettings()) {
  const allStudents = store.students.list();
  const profiles = Object.fromEntries(store.groupProfiles.list().map((profile) => [profile.groupId, profile]));

  return groups.map((group) => {
    const profile = profiles[group.id] || normalizeGroupProfile({}, null, group.id);
    const members = allStudents.filter((student) => student.groupId === group.id && ['active', 'trial'].includes(student.status));
    const waiting = allStudents.filter((student) => student.groupId === group.id && student.status === 'waitlist');
    const held = lessonsForGroup(group.id);
    const lastLesson = held[0] || null;
    // Capacity is one setting for every group, not part of the profile.
    const seatsTotal = settings.maxGroupSize;
    const seatsFree = Math.max(0, seatsTotal - members.length);
    return {
      id: group.id,
      title: group.title,
      name: groupTitle(group, 'he'),
      nameEn: groupTitle(group, 'en'),
      schedule: scheduleRows(group),
      timezone: groupTimezone(group, settings),
      zoomLink: group.zoomLink || '',
      portalMembers: Array.isArray(group.members) ? group.members : [],
      profile,
      students: members.map((student) => ({ id: student.id, name: studentName(student), age: ageOf(student, todayInZone(settings.businessTimezone)), level: student.level, chesscomRating: student.chesscomRating, lichessRating: student.lichessRating, status: student.status, userPhone: student.userPhone })),
      waitlist: waiting.map((student) => ({ id: student.id, name: studentName(student) })),
      studentCount: members.length,
      seatsTotal,
      seatsFree,
      lessonsHeld: held.length,
      lastLessonAt: lastLesson ? lastLesson.date : '',
      lastLessonTopic: lastLesson ? lastLesson.topic : '',
      nextSteps: lastLesson ? lastLesson.nextSteps : '',
      topicsLearned: topicsFromLessons(held)
    };
  });
}

// ------------------------------------------------------------- calendar

// Expands recurring group schedules, private schedules and one-off events
// into concrete occurrences between two dates (inclusive), in the business
// zone. Cancellations and reschedules recorded as events are applied.
export function buildOccurrences(groups, fromDate, toDate, settings = getSettings()) {
  const timezone = settings.businessTimezone;
  const students = store.students.list();
  const studentById = Object.fromEntries(students.map((student) => [student.id, student]));
  const events = store.scheduleEvents.list({ where: 'date >= ? AND date <= ?', params: [fromDate, toDate] });
  const originEvents = store.scheduleEvents.list({ where: 'original_date >= ? AND original_date <= ?', params: [fromDate, toDate] });
  const lessonsLogged = store.lessons.list({ where: 'date >= ? AND date <= ?', params: [fromDate, toDate] });
  const groupViews = buildGroupViews(groups, settings);

  const cancelled = new Set();
  for (const event of [...events, ...originEvents]) {
    if (event.kind === 'cancel') cancelled.add(`${event.groupId || `s:${event.studentId}`}@${event.date}`);
    if (event.kind === 'reschedule') cancelled.add(`${event.groupId || `s:${event.studentId}`}@${event.originalDate}`);
  }

  const occurrences = [];
  // A logged lesson belongs to the slot of its group (or, for a lesson with
  // no group, of its students) on its date and at its time; one logged
  // without a time stands for every such slot that day.
  const push = (occurrence) => {
    const clockParts = parseClock(occurrence.startTime) || { hour: 0, minute: 0 };
    const dateParts = parseIsoDate(occurrence.date);
    const startAt = zonedTimeToUtc({ ...dateParts, ...clockParts }, occurrence.timezone || timezone);
    const endAt = new Date(startAt.getTime() + (occurrence.durationMinutes || 60) * 60_000);
    const fits = (lesson) => lesson.date === occurrence.date && (occurrence.groupId
      ? lesson.groupId === occurrence.groupId
      : !lesson.groupId && occurrence.studentIds.length && lesson.studentIds.some((id) => occurrence.studentIds.includes(id)));
    const logged = lessonsLogged.find((lesson) => fits(lesson) && lesson.startTime === occurrence.startTime)
      || lessonsLogged.find((lesson) => fits(lesson) && !lesson.startTime);
    occurrences.push({
      ...occurrence,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      loggedLessonId: logged ? logged.id : '',
      loggedStatus: logged ? logged.status : ''
    });
  };

  for (let date = fromDate; date <= toDate; date = addDays(date, 1)) {
    const weekday = weekdayOfIsoDate(date);

    for (const view of groupViews) {
      if (view.profile.status === 'closed') continue;
      for (const row of view.schedule) {
        if (row.weekday !== weekday) continue;
        if (cancelled.has(`${view.id}@${date}`)) continue;
        push({
          key: `g:${view.id}:${date}:${row.startTime}`,
          kind: 'group',
          date,
          startTime: row.startTime,
          durationMinutes: row.durationMinutes,
          timezone: view.timezone,
          groupId: view.id,
          title: view.name,
          titleEn: view.nameEn,
          teacher: view.profile.teacher,
          zoomLink: view.zoomLink,
          studentIds: view.students.map((student) => student.id),
          students: view.students.map((student) => student.name)
        });
      }
    }

    for (const student of students) {
      if (!['active', 'trial'].includes(student.status)) continue;
      if (!['private', 'both'].includes(student.lessonType)) continue;
      if (cancelled.has(`s:${student.id}@${date}`)) continue;
      for (const row of student.privateSchedule || []) {
        if (row.weekday !== weekday) continue;
        push({
          key: `p:${student.id}:${date}:${row.startTime}`,
          kind: 'private',
          date,
          startTime: row.startTime,
          durationMinutes: row.durationMinutes,
          timezone,
          groupId: '',
          title: studentName(student),
          titleEn: studentName(student),
          teacher: student.teacher,
          zoomLink: student.privateZoomLink,
          studentIds: [student.id],
          students: [studentName(student)]
        });
      }
    }
  }

  for (const event of events) {
    if (event.kind === 'cancel') continue;
    const group = event.groupId ? groupViews.find((view) => view.id === event.groupId) : null;
    const student = event.studentId ? studentById[event.studentId] : null;
    const lead = event.leadId ? store.leads.get(event.leadId) : null;
    const studentIds = group ? group.students.map((entry) => entry.id) : student ? [student.id] : [];
    push({
      key: `e:${event.id}`,
      kind: event.kind === 'reschedule' ? (group ? 'group' : 'private') : event.kind,
      eventId: event.id,
      date: event.date,
      startTime: event.startTime,
      durationMinutes: event.durationMinutes || (group ? group.schedule[0]?.durationMinutes : null) || 60,
      timezone: group ? group.timezone : timezone,
      groupId: event.groupId,
      leadId: event.leadId,
      title: event.title || (group ? group.name : student ? studentName(student) : lead ? `${lead.childName || lead.parentName}` : ''),
      titleEn: event.title || (group ? group.nameEn : student ? studentName(student) : lead ? `${lead.childName || lead.parentName}` : ''),
      teacher: group ? group.profile.teacher : student ? student.teacher : '',
      zoomLink: event.zoomLink || group?.zoomLink || student?.privateZoomLink,
      studentIds,
      students: group ? group.students.map((entry) => entry.name) : student ? [studentName(student)] : lead ? [lead.childName || lead.parentName] : [],
      note: event.note,
      rescheduledFrom: event.kind === 'reschedule' ? `${event.originalDate} ${event.originalTime}`.trim() : ''
    });
  }

  occurrences.sort((a, b) => a.startAt.localeCompare(b.startAt));

  // A lesson not logged yet suggests a game from the list for whoever is
  // in it now, by what each of them has already seen.
  const games = store.content.list().filter((item) => item.kind === 'game');
  if (games.length) {
    const allLessons = store.lessons.list();
    const seen = gamesSeenByStudent(allLessons);
    const usage = {};
    for (const lesson of allLessons) if (lesson.status === 'held') for (const ref of lesson.gameRefs || []) usage[ref.id] = (usage[ref.id] || 0) + 1;
    for (const occurrence of occurrences) {
      if (occurrence.loggedLessonId || !occurrence.studentIds.length) continue;
      const level = occurrence.groupId ? groupViews.find((view) => view.id === occurrence.groupId)?.profile.level : studentById[occurrence.studentIds[0]]?.level;
      occurrence.suggestedGame = suggestGame(occurrence.studentIds, games, seen, { level, usage });
    }
  }

  // Flag overlaps for the same teacher (or when no teacher is set, any
  // overlap: the owner teaches by default).
  for (let i = 0; i < occurrences.length; i += 1) {
    for (let j = i + 1; j < occurrences.length; j += 1) {
      const a = occurrences[i];
      const b = occurrences[j];
      if (b.startAt >= a.endAt) break;
      if (a.teacher && b.teacher && a.teacher !== b.teacher) continue;
      a.conflicts = [...(a.conflicts || []), b.key];
      b.conflicts = [...(b.conflicts || []), a.key];
    }
  }

  return occurrences;
}

// ------------------------------------------------------------- payments

function convertToIls(amount, currency, settings) {
  if (currency === 'USD') return amount * (settings.usdToIls || 1);
  if (currency === 'EUR') return amount * (settings.eurToIls || 1);
  return amount;
}

function convertMoney(amount, from, to, settings) {
  if (!from || from === to) return amount;
  return convertToIls(amount, from, settings) / convertToIls(1, to, settings);
}

function attendedLesson(lesson, studentId) {
  return lesson.status === 'held' && lesson.attendance?.[studentId] !== 'absent' && lesson.studentIds.includes(studentId);
}

// A lesson's studentIds is who it was for. A group lesson keeps the roster
// it had when it was logged, so a student who moves groups keeps their own
// history and does not pick up the new group's past. The form sends the
// roster the teacher ticked (someone who has left the group since can be
// on a summary logged late). Without one, a new lesson takes the group's
// students who were in it by its date, and an edit keeps the roster it had
// unless the lesson moved to another group. Attendance only counts for
// students on the roster.
function withRoster(lesson, existing = null, sentRoster = false) {
  if (!lesson.groupId) return lesson;
  // An empty list is what older copies of the form send for every group
  // lesson, so it means "not chosen", never "nobody".
  const studentIds = sentRoster && lesson.studentIds.length
    ? lesson.studentIds
    : existing && existing.groupId === lesson.groupId && existing.studentIds.length
    ? existing.studentIds
    : store.students.list({ where: 'group_id = ?', params: [lesson.groupId] })
      .filter((student) => (student.status !== 'inactive' || (student.leftAt && student.leftAt >= lesson.date)) && (student.groupJoinedAt || student.joinedAt || '') <= lesson.date)
      .map((student) => student.id);
  const attendance = Object.fromEntries(Object.entries(lesson.attendance || {}).filter(([id]) => studentIds.includes(id)));
  return { ...lesson, studentIds, attendance };
}

function lessonsAttendedByStudent(student, allLessons) {
  return allLessons.filter((lesson) => {
    if (student.joinedAt && lesson.date < student.joinedAt) return false;
    return attendedLesson(lesson, student.id);
  });
}

// The games from the list each student has seen, from the lessons they
// attended: { studentId: Set(gameId) }.
function gamesSeenByStudent(lessons) {
  const seen = {};
  for (const lesson of lessons) {
    if (lesson.status !== 'held' || !(lesson.gameRefs || []).length) continue;
    for (const id of lesson.studentIds) {
      if (lesson.attendance?.[id] === 'absent') continue;
      const set = (seen[id] ||= new Set());
      for (const ref of lesson.gameRefs) set.add(ref.id);
    }
  }
  return seen;
}

// The game from the list to show next: one none of these students has seen,
// else the one the fewest have. Ties go to a game at the group's level, then
// the one used least overall, then by title.
export function suggestGame(studentIds, games, seen, { level = '', usage = {} } = {}) {
  if (!games.length) return null;
  const ranked = games.map((game) => ({
    game,
    seenBy: studentIds.filter((id) => seen[id]?.has(game.id)).length,
    levelMiss: level && game.level === level ? 0 : 1,
    uses: usage[game.id] || 0
  })).sort((a, b) => a.seenBy - b.seenBy || a.levelMiss - b.levelMiss || a.uses - b.uses || a.game.title.localeCompare(b.game.title));
  const best = ranked[0];
  return { id: best.game.id, title: best.game.title, seenBy: best.seenBy, of: studentIds.length };
}

// ---- price lists and the account
//
// Each student has their own list of prices: a kind of lesson (group,
// private or any), how it is billed (per lesson, monthly, or a package of
// lessons), an optional length, and an amount in the student's currency.
// Everything the student owes and pays goes through one account:
//   - a monthly price is charged in advance, on the 1st of each month. In
//     a month the student starts after the 1st or leaves before its end,
//     a monthly price with a single-lesson price charges the lessons they
//     attended that month at it instead, up to the monthly amount;
//   - lessons billed per lesson are charged together at the end of the
//     month they were in, each at the price it matches (see matchPrice);
//     a lesson covered by a monthly price costs nothing more;
//   - a package is charged per lesson, as lessons happen, at its amount
//     divided by its size;
//   - payments count at the rates in settings when in another currency.
// The balance is payments less charges: below zero the student owes.
//
// When the price list or anything a charge depends on changes, past
// charges keep what they cost (see keepPastCharges): a lesson keeps its
// charge on the lesson record, a month the terms it was charged on in the
// student's chargeHistory. ledgerFrom/openingBalance carry over the
// standing from before price lists: only lessons and months after
// ledgerFrom are charged, on top of openingBalance; months in
// chargeHistory always count.

const round2 = (value) => Math.round(value * 100) / 100;

// What a lesson of this price costs: a monthly price covers the lesson.
function priceCharge(item) {
  if (item.model === 'monthly') return 0;
  if (item.model === 'package') return round2(item.amount / (item.packageSize || 1));
  return item.amount;
}

// The student's price for a lesson they attended: the one picked on the
// lesson, else a monthly price for its kind of lesson, else a per-lesson
// or package price of its length, else one with no length, else the only
// one there is. A price for its own kind of lesson wins over one for any.
// null when no price fits.
function matchPrice(student, lesson) {
  const prices = student.prices || [];
  const chosen = lesson.priceChoices?.[student.id];
  const picked = chosen && prices.find((item) => item.id === chosen);
  if (picked) return picked;
  const kind = lesson.groupId ? 'group' : 'private';
  const fits = prices.filter((item) => item.kind === kind || item.kind === 'any')
    .sort((a, b) => Number(a.kind === 'any') - Number(b.kind === 'any'));
  const monthly = fits.find((item) => item.model === 'monthly' && (!item.since || item.since <= lesson.date));
  if (monthly) return monthly;
  const perLesson = fits.filter((item) => item.model !== 'monthly');
  const minutes = lesson.durationMinutes || (lesson.groupId ? null : scheduleSlot(student.privateSchedule || [], lesson)?.durationMinutes);
  return perLesson.find((item) => item.durationMinutes && item.durationMinutes === minutes)
    || perLesson.find((item) => !item.durationMinutes)
    || (perLesson.length === 1 ? perLesson[0] : null);
}

const monthEnd = (month) => addDays(`${monthLabel(addMonths(`${month}-01`, 1))}-01`, -1);

// When a monthly price starts charging: the student's start, or the day
// the price was added.
function monthlyStart(student, item) {
  return [student.joinedAt, item.since].filter(Boolean).sort().pop() || '';
}

// The dates a monthly price is charged on, up to `until`: the 1st of each
// month from its start, the first one on the start day itself when that
// is after the 1st; none after the student left.
function monthlyChargeDates(student, item, until) {
  const start = monthlyStart(student, item);
  if (!start) return [];
  const end = student.leftAt && student.leftAt < until ? student.leftAt : until;
  const dates = [];
  for (let month = monthLabel(start); month <= monthLabel(end); month = monthLabel(addMonths(`${month}-01`, 1))) {
    const date = `${month}-01` < start ? start : `${month}-01`;
    if (date <= end) dates.push(date);
  }
  return dates;
}

// Whether the student has only part of this month on a monthly price: they
// started after its 1st or left before its last day.
function partialMonth(student, start, month) {
  const late = start && monthLabel(start) === month && start > `${month}-01`;
  const early = student.leftAt && monthLabel(student.leftAt) === month && student.leftAt < monthEnd(month);
  return Boolean(late || early);
}

// Every charge and payment on the student's account up to today, oldest
// first, with the balance, the lessons of this month still to be charged
// at its end, and the charges coming next.
// Entry amounts are in the student's currency: payments positive, charges
// negative. A lesson no price fits is listed with unpriced: true.
export function studentAccount(student, studentPayments, allLessons, settings, today) {
  const currency = student.currency;
  const counts = (date) => !student.ledgerFrom || date > student.ledgerFrom;
  const prices = student.prices || [];
  const byId = Object.fromEntries(prices.map((item) => [item.id, item]));
  const entries = [];
  if (student.ledgerFrom && student.openingBalance) entries.push({ date: student.ledgerFrom, kind: 'opening', amount: student.openingBalance });
  for (const payment of studentPayments) {
    entries.push({ date: payment.paidAt, kind: 'payment', paymentId: payment.id, method: payment.method, amount: round2(convertMoney(payment.amount, payment.currency, currency, settings)) });
  }

  // Lessons: per-lesson ones gathered by month, group lessons under a
  // monthly price counted for partial months, packages charged as they go.
  const perLessonMonths = {};
  const monthlyLessons = {};
  for (const lesson of lessonsAttendedByStudent(student, allLessons)) {
    if (!counts(lesson.date) || lesson.date > today) continue;
    const base = { date: lesson.date, lessonId: lesson.id, topic: lesson.topic, lessonKind: lesson.groupId ? 'group' : 'private' };
    const kept = lesson.charges?.[student.id];
    const item = kept ? null : matchPrice(student, lesson);
    if (!kept && !item) { entries.push({ ...base, kind: 'lesson', unpriced: true, amount: 0 }); continue; }
    const model = kept ? (kept.model || byId[kept.priceId]?.model || 'per_lesson') : item.model;
    const priceId = kept ? (kept.priceId || '') : item.id;
    if (model === 'monthly') {
      const key = `${priceId}:${monthLabel(lesson.date)}`;
      monthlyLessons[key] = (monthlyLessons[key] || 0) + 1;
      continue;
    }
    const amount = kept ? round2(convertMoney(kept.amount, kept.currency, currency, settings)) : priceCharge(item);
    if (model === 'package') {
      if (amount) entries.push({ ...base, kind: 'lesson', priceId, amount: -amount });
      continue;
    }
    const month = (perLessonMonths[monthLabel(lesson.date)] ||= { count: 0, amount: 0 });
    month.count += 1;
    month.amount = round2(month.amount + amount);
  }
  let pending = null;
  for (const [month, total] of Object.entries(perLessonMonths)) {
    const date = monthEnd(month);
    if (date <= today) entries.push({ date, kind: 'lessons', month, count: total.count, amount: -total.amount });
    else pending = { date, month, count: total.count, amount: total.amount };
  }

  // Months: what was charged under earlier terms, then the current prices.
  const monthCharge = (terms, date) => {
    const month = monthLabel(date);
    const start = monthlyStart(student, terms);
    if (terms.lessonAmount !== null && terms.lessonAmount !== undefined && partialMonth(student, start, month)) {
      const count = monthlyLessons[`${terms.priceId}:${month}`] || 0;
      const amount = Math.min(terms.amount, round2(count * terms.lessonAmount));
      return amount ? { date, kind: 'month', month, priceId: terms.priceId, partial: true, count, lessonAmount: terms.lessonAmount, amount: -amount } : null;
    }
    return terms.amount ? { date, kind: 'month', month, priceId: terms.priceId, amount: -terms.amount } : null;
  };
  const charged = new Set();
  for (const month of student.chargeHistory || []) {
    charged.add(`${month.priceId}:${month.date.slice(0, 7)}`);
    if (month.date > today || (student.joinedAt && month.date < student.joinedAt) || (student.leftAt && month.date > student.leftAt)) continue;
    const terms = { ...month, amount: round2(convertMoney(month.amount, month.currency, currency, settings)), lessonAmount: month.lessonAmount === null || month.lessonAmount === undefined ? null : round2(convertMoney(month.lessonAmount, month.currency, currency, settings)) };
    const entry = monthCharge(terms, month.date);
    if (entry) entries.push(entry);
  }
  let nextMonthly = null;
  for (const item of prices.filter((entry) => entry.model === 'monthly')) {
    const terms = { priceId: item.id, amount: item.amount, lessonAmount: item.lessonAmount ?? null, since: item.since };
    for (const date of monthlyChargeDates(student, item, addMonths(today, 2))) {
      if (date > today) {
        if (!nextMonthly || date < nextMonthly.date) nextMonthly = { date, amount: item.amount };
        else if (date === nextMonthly.date) nextMonthly.amount += item.amount;
        break;
      }
      if (!counts(date) || charged.has(`${item.id}:${date.slice(0, 7)}`)) continue;
      const entry = monthCharge(terms, date);
      if (entry) entries.push(entry);
    }
  }

  // The opening amount stands for everything before it, so it comes first;
  // on the same day charges come before payments.
  entries.sort((a, b) => Number(b.kind === 'opening') - Number(a.kind === 'opening') || a.date.localeCompare(b.date) || Number(a.kind === 'payment') - Number(b.kind === 'payment'));
  let balance = 0;
  for (const entry of entries) {
    balance = round2(balance + entry.amount);
    entry.balance = balance;
  }
  // Payments pay the oldest charges first, so what is owed is owed since
  // the first charge they do not cover.
  let owedSince = '';
  if (balance < 0) {
    const credit = entries.filter((entry) => entry.amount > 0).reduce((sum, entry) => sum + entry.amount, 0);
    let chargedSoFar = 0;
    for (const entry of entries) {
      if (entry.amount >= 0) continue;
      chargedSoFar += -entry.amount;
      if (chargedSoFar > credit + 0.005) { owedSince = entry.date; break; }
    }
  }
  // What comes next: this month's lessons at its end, the next month's
  // monthly prices on its 1st.
  const upcoming = [pending, nextMonthly].filter((charge) => charge && charge.amount > 0);
  const nextCharge = upcoming.length ? {
    date: upcoming.map((charge) => charge.date).sort()[0],
    amount: round2(upcoming.reduce((sum, charge) => sum + charge.amount, 0))
  } : null;
  return {
    entries,
    balance,
    owedSince,
    pending,
    nextCharge,
    unpriced: entries.filter((entry) => entry.unpriced).length
  };
}

// What a lesson from a package costs, on average over the student's
// packages: their credit is counted in these. 0 without a package.
function packageLessonCharge(student) {
  const packages = (student.prices || []).filter((item) => item.model === 'package');
  return packages.length ? packages.reduce((sum, item) => sum + priceCharge(item), 0) / packages.length : 0;
}

// What a typical lesson costs the student apart from monthly prices: the
// average over their private slots, else over their per-lesson and
// package prices. 0 when everything is monthly.
function typicalLessonCharge(student) {
  const own = (student.prices || []).filter((item) => item.model !== 'monthly');
  if (!own.length) return 0;
  const charges = student.privateSchedule?.length
    ? student.privateSchedule.map((slot) => matchPrice(student, { date: '', groupId: '', durationMinutes: slot.durationMinutes })).filter(Boolean).map(priceCharge)
    : own.map(priceCharge);
  return charges.length ? charges.reduce((sum, charge) => sum + charge, 0) / charges.length : 0;
}

// Where the student stands: overdue once they owe since before today, due
// soon when they owe since today, when the next charges are near and the
// credit does not cover them, or when a package's credit covers fewer than
// two more lessons. A student who has left is inactive unless they owe.
export function computePaymentStatus(student, studentPayments, allLessons, settings, today) {
  const last = studentPayments[0] || null;
  const account = studentAccount(student, studentPayments, allLessons, settings, today);
  const result = {
    studentId: student.id,
    prices: student.prices || [],
    currency: student.currency,
    lastPaymentAt: last ? last.paidAt : '',
    lastPaymentAmount: last ? last.amount : null,
    lastPaymentCurrency: last ? last.currency : '',
    totalPaid: round2(account.entries.filter((entry) => entry.kind === 'payment').reduce((sum, entry) => sum + entry.amount, 0)),
    balance: account.balance,
    pending: account.pending,
    nextPaymentAt: account.nextCharge?.date || '',
    nextChargeAmount: account.nextCharge?.amount ?? null,
    daysUntilDue: null,
    unpricedLessons: account.unpriced,
    state: 'ok'
  };
  if (result.nextPaymentAt) result.daysUntilDue = daysBetween(today, result.nextPaymentAt);

  if (account.balance < 0) {
    result.nextPaymentAt = account.owedSince;
    result.daysUntilDue = daysBetween(today, account.owedSince);
    result.state = result.daysUntilDue < 0 ? 'overdue' : 'due_soon';
    return result;
  }
  if (!['active', 'trial'].includes(student.status)) {
    result.state = 'inactive';
    return result;
  }
  const perPackageLesson = packageLessonCharge(student);
  if (result.nextChargeAmount !== null && result.daysUntilDue <= settings.paymentReminderDays && result.nextChargeAmount > account.balance) result.state = 'due_soon';
  else if (perPackageLesson > 0 && account.balance < perPackageLesson * 2) result.state = 'due_soon';
  return result;
}

// Before what a student's charges depend on changes, the lessons they
// attended and the months already charged keep what they cost under the
// old terms. A lesson no price fitted stays open, so a price added for it
// later still charges it. A month keeps its terms rather than an amount,
// so a month still under way, or the one the student leaves in, is still
// counted from the lessons they attend.
const CHARGE_FIELDS = ['prices', 'currency', 'privateSchedule', 'joinedAt', 'leftAt'];
function keepPastCharges(before, after, settings = getSettings()) {
  if (CHARGE_FIELDS.every((field) => JSON.stringify(before[field] ?? null) === JSON.stringify(after[field] ?? null))) return after;
  const today = todayInZone(settings.businessTimezone);
  const counts = (date) => !before.ledgerFrom || date > before.ledgerFrom;
  for (const lesson of lessonsAttendedByStudent(before, store.lessons.list())) {
    if (lesson.charges?.[before.id] || !counts(lesson.date) || lesson.date > today) continue;
    const item = matchPrice(before, lesson);
    if (!item) continue;
    store.lessons.put({ ...lesson, charges: { ...(lesson.charges || {}), [before.id]: { amount: priceCharge(item), currency: before.currency, priceId: item.id, model: item.model } } });
  }
  const history = [...(before.chargeHistory || [])];
  const charged = new Set(history.map((month) => `${month.priceId}:${month.date.slice(0, 7)}`));
  for (const item of (before.prices || []).filter((entry) => entry.model === 'monthly')) {
    for (const date of monthlyChargeDates(before, item, today)) {
      if (counts(date) && !charged.has(`${item.id}:${date.slice(0, 7)}`)) {
        history.push({ date, priceId: item.id, amount: item.amount, lessonAmount: item.lessonAmount ?? null, since: item.since || '', currency: before.currency });
      }
    }
  }
  // The amount carried over from before price lists is in the student's
  // currency, so it moves with it.
  const openingBalance = before.openingBalance && before.currency !== after.currency
    ? round2(convertMoney(before.openingBalance, before.currency, after.currency, settings))
    : after.openingBalance;
  return { ...after, chargeHistory: history, openingBalance };
}

// Billing before price lists: one billing type and price per student,
// with optional prices by lesson length for per-lesson students. Kept only
// to carry each student's standing over into their price list once (see
// migrateStudentPrices).

// The price of a lesson of this length for a student with prices by
// length, else the student's own price.
function priceForLength(student, minutes) {
  const listed = (student.lessonPrices || []).find((row) => row.durationMinutes === minutes);
  return listed ? listed.price : student.price;
}

// What one attended lesson costs: its own length, else for a private lesson
// the length of its slot in the student's schedule. A group lesson with no
// length of its own is charged the student's price.
function lessonCharge(student, lesson) {
  const minutes = lesson.durationMinutes || (lesson.groupId ? null : scheduleSlot(student.privateSchedule || [], lesson)?.durationMinutes);
  return priceForLength(student, minutes);
}

// The average price of a lesson in the student's week, or of the listed
// prices when there is no private schedule.
function typicalLessonPrice(student) {
  let prices = student.privateSchedule?.length
    ? student.privateSchedule.map((row) => priceForLength(student, row.durationMinutes))
    : student.lessonPrices.map((row) => row.price);
  prices = prices.map((price) => price ?? 0);
  return prices.length ? prices.reduce((sum, price) => sum + price, 0) / prices.length : 0;
}

function legacyPaymentStatus(student, studentPayments, allLessons, settings, today) {
  const last = studentPayments[0] || null;
  const totalPaid = studentPayments.reduce((sum, payment) => sum + payment.amount, 0);
  const result = {
    studentId: student.id,
    billingType: student.billingType,
    price: student.price,
    currency: student.currency,
    lastPaymentAt: last ? last.paidAt : '',
    lastPaymentAmount: last ? last.amount : null,
    totalPaid,
    nextPaymentAt: '',
    daysUntilDue: null,
    lessonsRemaining: null,
    lessonsUsed: null,
    balance: null,
    state: 'ok'
  };

  if (!['active', 'trial'].includes(student.status)) {
    result.state = 'inactive';
    return result;
  }

  if (student.billingType === 'monthly') {
    let due = student.nextPaymentAt;
    if (!due) {
      // Every payment pushes the due date to the month after the one it
      // covers: the named month when there is one, otherwise the month of
      // the payment itself. The furthest date wins, so neither paying old
      // arrears nor a payment without a month label can pull a paid student
      // back into "overdue".
      const dueAfter = (payment) => {
        if (/^\d{4}-\d{2}$/.test(payment.periodLabel)) {
          const next = parseIsoDate(addMonths(`${payment.periodLabel}-01`, 1));
          const day = student.billingDay ?? parseIsoDate(payment.paidAt).day;
          return formatIsoDate({ ...next, day: Math.min(day, 28) });
        }
        let candidate = addMonths(payment.paidAt, 1);
        if (student.billingDay) {
          candidate = formatIsoDate({ ...parseIsoDate(candidate), day: Math.min(student.billingDay, 28) });
          if (candidate <= payment.paidAt) candidate = addMonths(candidate, 1);
        }
        return candidate;
      };
      const candidates = studentPayments.map(dueAfter).filter(Boolean);
      if (candidates.length) {
        due = candidates.reduce((best, candidate) => (candidate > best ? candidate : best));
      } else {
        due = student.joinedAt || today;
      }
    }
    result.nextPaymentAt = due;
    result.daysUntilDue = daysBetween(today, due);
    if (result.daysUntilDue < 0) result.state = 'overdue';
    else if (result.daysUntilDue <= settings.paymentReminderDays) result.state = 'due_soon';
    return result;
  }

  // Per lesson with prices by length: lessons cost different amounts, so
  // the balance is kept in money, what was paid less what the attended
  // lessons cost. lessonsRemaining is how many lessons that covers at the
  // price of a typical lesson, for the lists that count in lessons.
  // Payments in another currency count at the rates in settings, and a
  // lesson charged under earlier prices keeps that charge.
  if (student.billingType === 'per_lesson' && student.lessonPrices?.length) {
    const attended = lessonsAttendedByStudent(student, allLessons);
    const paid = studentPayments.reduce((sum, payment) => sum + convertMoney(payment.amount, payment.currency, student.currency, settings), 0);
    const owed = attended.reduce((sum, lesson) => {
      const kept = lesson.charges?.[student.id];
      return sum + (kept ? convertMoney(kept.amount, kept.currency, student.currency, settings) : (lessonCharge(student, lesson) ?? 0));
    }, 0);
    const typical = typicalLessonPrice(student);
    result.lessonsUsed = attended.length;
    result.balance = Math.round((paid - owed) * 100) / 100;
    result.lessonsRemaining = typical > 0 ? Math.floor(result.balance / typical) : null;
    if (result.balance <= 0) result.state = 'overdue';
    else if (result.lessonsRemaining !== null && result.lessonsRemaining <= 2) result.state = 'due_soon';
    return result;
  }

  // package / per_lesson: compare lessons paid for with lessons attended.
  const purchased = studentPayments.reduce((sum, payment) => sum + (payment.lessonsCount ?? (student.billingType === 'package' ? (student.packageSize || 0) : 1)), 0);
  const used = lessonsAttendedByStudent(student, allLessons).length;
  result.lessonsUsed = used;
  result.lessonsRemaining = purchased - used;
  if (result.lessonsRemaining <= 0) result.state = 'overdue';
  else if (result.lessonsRemaining <= 2) result.state = 'due_soon';
  return result;
}

// Where a student billed the old way stood, as a balance in their
// currency: a monthly student paid ahead has the months before their due
// date in credit, one overdue owes every month since it; a package or
// per-lesson student has their lessons left in credit, or owes for the
// lessons beyond what they paid.
// The months an overdue monthly student owes are returned as charges on
// their due dates, so they stay overdue from when they were due.
function legacyBalance(student, payments, lessons, settings, today) {
  const status = legacyPaymentStatus(student, payments, lessons, settings, today);
  if (status.state === 'inactive') return { balance: 0, owedMonths: [] };
  const price = student.price ?? 0;
  if (student.billingType !== 'monthly') {
    return { balance: status.balance ?? round2((status.lessonsRemaining ?? 0) * price), owedMonths: [] };
  }
  const due = status.nextPaymentAt;
  if (!parseIsoDate(due)) return { balance: 0, owedMonths: [] };
  const billingDay = Math.min(student.billingDay || parseIsoDate(due).day, 28);
  let months = 0;
  if (due <= today) {
    const owedMonths = [];
    for (let date = due; date <= today; date = addMonths(date, 1)) owedMonths.push(date);
    return { balance: -price * owedMonths.length, billingDay, owedMonths };
  }
  // Months are charged on the 1st: those before the due date are paid.
  for (let month = monthLabel(today); month <= monthLabel(due); month = monthLabel(addMonths(`${month}-01`, 1))) {
    const date = `${month}-01`;
    if (date > today && date < due) months += 1;
  }
  return { balance: price * months, billingDay, owedMonths: [] };
}

// Once, every student billed the old way gets the matching price list, and
// their account starts today from where they stood: charges up to today
// are replaced by one opening amount, so nobody is charged again for what
// the old billing already counted. Payments keep counting in full, so one
// recorded later for an earlier date still lands.
export function migrateStudentPrices(settings = getSettings()) {
  if (store.getSetting('studentPricesMigrated')) return 0;
  const today = todayInZone(settings.businessTimezone);
  const lessons = store.lessons.list();
  const payments = store.payments.list();
  let moved = 0;
  for (const student of store.students.list()) {
    if (student.prices?.length || student.ledgerFrom) continue;
    const own = payments.filter((payment) => payment.studentId === student.id);
    const standing = legacyBalance(student, own, lessons, settings, today);
    const paid = own.reduce((sum, payment) => sum + convertMoney(payment.amount, payment.currency, student.currency, settings), 0);
    const prices = legacyPrices(student);
    const chargeHistory = standing.owedMonths.map((date) => ({ date, priceId: prices[0]?.id || '', amount: student.price ?? 0, currency: student.currency }));
    const charged = chargeHistory.reduce((sum, month) => sum + month.amount, 0);
    store.students.put({
      ...student,
      prices,
      chargeHistory,
      billingDay: standing.billingDay ?? student.billingDay,
      ledgerFrom: today,
      openingBalance: round2(standing.balance - paid + charged)
    });
    moved += 1;
  }
  store.setSetting('studentPricesMigrated', true);
  return moved;
}

export function buildPaymentOverview(settings = getSettings()) {
  const today = todayInZone(settings.businessTimezone);
  const students = store.students.list();
  const payments = store.payments.list();
  const lessons = store.lessons.list();
  const byStudent = {};
  for (const payment of payments) {
    (byStudent[payment.studentId] ||= []).push(payment);
  }
  return students
    .filter((student) => ['active', 'trial'].includes(student.status) || student.leftAt)
    .map((student) => ({
      ...computePaymentStatus(student, byStudent[student.id] || [], lessons, settings, today),
      name: studentName(student),
      parentName: student.parentName,
      parentPhone: student.parentPhone,
      language: student.language,
      groupId: student.groupId,
      lessonType: student.lessonType
    }))
    // A student who has left stays only while they still owe.
    .filter((entry) => entry.state !== 'inactive');
}

// -------------------------------------------------------------- matching

function parseAvailability(value) {
  // Accepts an array of weekday numbers or free text with day names in
  // Hebrew or English. Empty means "unknown", which never counts against.
  if (Array.isArray(value)) return value.map((day) => int(day, { min: 0, max: 6 })).filter((day) => day !== null);
  const source = String(value || '').toLowerCase();
  const names = [
    [0, ['sun', 'ראשון', "א'"]],
    [1, ['mon', 'שני', "ב'"]],
    [2, ['tue', 'שלישי', "ג'"]],
    [3, ['wed', 'רביעי', "ד'"]],
    [4, ['thu', 'חמישי', "ה'"]],
    [5, ['fri', 'שישי', "ו'"]],
    [6, ['sat', 'שבת']]
  ];
  const found = [];
  for (const [day, aliases] of names) {
    if (aliases.some((alias) => source.includes(alias))) found.push(day);
  }
  return found;
}

function levelIndex(level) {
  const index = LEVELS.indexOf(level);
  return index < 0 ? null : index;
}

export function matchGroups(criteria, groups, settings = getSettings()) {
  const age = int(criteria.age, { min: 3, max: 99 });
  const rating = int(criteria.rating, { min: 0, max: 4000 });
  const level = oneOf(criteria.level, LEVELS, '');
  const language = oneOf(criteria.language, LANGUAGES, '');
  const availability = parseAvailability(criteria.availability);
  const excludeStudentId = text(criteria.excludeStudentId, 80);

  const views = buildGroupViews(groups, settings).filter((view) => view.profile.status !== 'closed');
  const scored = views.map((view) => {
    const reasons = [];
    const problems = [];
    let score = 0;
    const members = view.students.filter((student) => student.id !== excludeStudentId);
    const seatsFree = Math.max(0, view.seatsTotal - members.length);

    if (seatsFree > 0) { score += 30; reasons.push('seat'); } else { problems.push('full'); }

    if (age !== null) {
      const { minAge, maxAge } = view.profile;
      const memberAges = members.map((student) => student.age).filter((value) => value !== null);
      const low = minAge ?? (memberAges.length ? Math.min(...memberAges) - 1 : null);
      const high = maxAge ?? (memberAges.length ? Math.max(...memberAges) + 1 : null);
      if (low === null && high === null) { score += 5; }
      else if ((low === null || age >= low) && (high === null || age <= high)) { score += 25; reasons.push('age'); }
      else if ((low === null || age >= low - 2) && (high === null || age <= high + 2)) { score += 8; reasons.push('age_close'); }
      else { problems.push('age'); }
    }

    if (rating !== null && (view.profile.ratingMin !== null || view.profile.ratingMax !== null)) {
      const { ratingMin, ratingMax } = view.profile;
      if ((ratingMin === null || rating >= ratingMin) && (ratingMax === null || rating <= ratingMax)) { score += 25; reasons.push('rating'); }
      else if ((ratingMin === null || rating >= ratingMin - 150) && (ratingMax === null || rating <= ratingMax + 150)) { score += 8; reasons.push('rating_close'); }
      else { problems.push('rating'); }
    } else if (rating !== null) {
      const memberRatings = members.map((student) => student.chesscomRating).filter((value) => value !== null);
      if (memberRatings.length) {
        const average = memberRatings.reduce((sum, value) => sum + value, 0) / memberRatings.length;
        if (Math.abs(average - rating) <= 150) { score += 20; reasons.push('rating'); }
        else if (Math.abs(average - rating) <= 300) { score += 6; reasons.push('rating_close'); }
        else { problems.push('rating'); }
      }
    } else if (level && view.profile.level) {
      const delta = Math.abs((levelIndex(level) ?? 0) - (levelIndex(view.profile.level) ?? 0));
      if (delta === 0) { score += 20; reasons.push('level'); }
      else if (delta === 1) { score += 6; reasons.push('level_close'); }
      else { problems.push('level'); }
    }

    if (language) {
      if (languagesFit(language, view.profile.language)) { score += 15; reasons.push('language'); }
      else { problems.push('language'); }
    }

    if (availability.length) {
      const days = view.schedule.map((row) => row.weekday);
      if (days.some((day) => availability.includes(day))) { score += 20; reasons.push('availability'); }
      else { problems.push('availability'); }
    }

    return {
      groupId: view.id,
      name: view.name,
      nameEn: view.nameEn,
      schedule: view.schedule,
      seatsFree,
      seatsTotal: view.seatsTotal,
      studentCount: members.length,
      profile: view.profile,
      score,
      reasons,
      problems,
      recommended: problems.length === 0 && seatsFree > 0
    };
  });

  scored.sort((a, b) => b.score - a.score || a.studentCount - b.studentCount);
  return scored;
}

// The one group to offer a prospect: a group with a free seat whose
// students are close to the child in age, level and Chess.com rating, by the
// ranges in settings, and that teaches in the child's language. Close means
// within range of the students' average; a group with nobody in it yet is
// compared with its profile (age range, level, rating range) instead. A
// detail the child or the group lacks never rules a group out, but at least
// one must be compared. Of the groups that fit, the closest wins: each
// distance counts as a share of its range, and a tie goes to the group with
// more room.
export function suggestGroupFor(lead, views, settings = getSettings()) {
  if (lead.preference === 'private') return { group: null, reason: 'private' };
  const child = { age: lead.childAge ?? null, level: levelIndex(lead.level), rating: lead.chesscomRating ?? null };
  if (child.age === null && child.level === null && child.rating === null) return { group: null, reason: 'no_details' };
  const ranges = { age: settings.matchAgeYears, level: settings.matchLevelSteps, rating: settings.matchRatingPoints };
  const average = (values) => {
    const known = values.filter((value) => value !== null && value !== undefined);
    return known.length ? known.reduce((sum, value) => sum + value, 0) / known.length : null;
  };
  // Distance from a value to a range; 0 inside it.
  const outside = (value, low, high) => (low !== null && value < low ? low - value : high !== null && value > high ? value - high : 0);

  let best = null;
  for (const view of views) {
    if (view.profile.status === 'closed' || view.seatsFree <= 0) continue;
    if (lead.language && view.profile.language && !languagesFit(lead.language, view.profile.language)) continue;
    const members = view.students;
    const distances = {};
    if (members.length) {
      const group = { age: average(members.map((student) => student.age)), level: average(members.map((student) => levelIndex(student.level))), rating: average(members.map((student) => student.chesscomRating)) };
      for (const key of ['age', 'level', 'rating']) if (child[key] !== null && group[key] !== null) distances[key] = Math.abs(child[key] - group[key]);
    } else {
      const { minAge, maxAge, ratingMin, ratingMax } = view.profile;
      if (child.age !== null && (minAge !== null || maxAge !== null)) distances.age = outside(child.age, minAge, maxAge);
      if (child.level !== null && levelIndex(view.profile.level) !== null) distances.level = Math.abs(child.level - levelIndex(view.profile.level));
      if (child.rating !== null && (ratingMin !== null || ratingMax !== null)) distances.rating = outside(child.rating, ratingMin, ratingMax);
    }
    const compared = Object.keys(distances);
    if (!compared.length || compared.some((key) => distances[key] > ranges[key])) continue;
    const score = compared.reduce((sum, key) => sum + distances[key] / Math.max(ranges[key], 1), 0);
    if (!best || score < best.score || (score === best.score && view.seatsFree > best.view.seatsFree)) best = { view, score, compared };
  }
  if (!best) return { group: null, reason: 'none_fits' };
  const { view, compared } = best;
  return { group: { id: view.id, name: view.name, nameEn: view.nameEn, seatsFree: view.seatsFree, seatsTotal: view.seatsTotal, comparedWith: view.students.length ? 'students' : 'profile', compared }, reason: '' };
}

// Students on the waitlist and prospects waiting for a group, bucketed so
// that three or more compatible people suggest opening a new group.
export function suggestNewGroups(settings = getSettings()) {
  const today = todayInZone(settings.businessTimezone);
  const candidates = [];
  for (const student of store.students.list({ where: 'status = ?', params: ['waitlist'] })) {
    candidates.push({ type: 'student', id: student.id, name: studentName(student), age: ageOf(student, today), level: student.level, language: student.language, rating: student.chesscomRating });
  }
  for (const lead of store.leads.list({ where: 'status IN (?, ?, ?)', params: ['waiting_group', 'trial_done', 'contacted'] })) {
    if (lead.preference === 'private') continue;
    candidates.push({ type: 'lead', id: lead.id, name: lead.childName || lead.parentName, age: lead.childAge, level: lead.level, language: lead.language, rating: lead.chesscomRating });
  }

  const buckets = {};
  const bands = (candidate) => ({
    ageBand: candidate.age === null || candidate.age === undefined ? 'any' : candidate.age <= 7 ? '5-7' : candidate.age <= 10 ? '8-10' : candidate.age <= 13 ? '11-13' : '14+',
    levelBand: candidate.level || 'any'
  });
  const add = (language, candidate) => {
    const { ageBand, levelBand } = bands(candidate);
    (buckets[`${language}|${ageBand}|${levelBand}`] ||= { language, ageBand, levelBand, members: [] }).members.push(candidate);
  };
  for (const candidate of candidates) if (candidate.language !== 'he_en') add(candidate.language, candidate);
  // A child in both languages joins whichever of the Hebrew or English
  // buckets for their age and level is bigger, and only otherwise starts a
  // bucket of their own.
  for (const candidate of candidates.filter((entry) => entry.language === 'he_en')) {
    const { ageBand, levelBand } = bands(candidate);
    const sizes = ['he', 'en'].map((language) => [language, buckets[`${language}|${ageBand}|${levelBand}`]?.members.length || 0]);
    const [language, size] = sizes.sort((a, b) => b[1] - a[1])[0];
    add(size ? language : 'he_en', candidate);
  }

  return Object.values(buckets)
    .filter((bucket) => bucket.members.length >= 2)
    .sort((a, b) => b.members.length - a.members.length)
    .map((bucket) => ({ ...bucket, ready: bucket.members.length >= 3 }));
}

// --------------------------------------------------------------- reports

function monthRange(label) {
  const [year, month] = label.split('-').map(Number);
  const first = formatIsoDate({ year, month, day: 1 });
  const last = addDays(addMonths(first, 1), -1);
  return { first, last };
}

function previousMonth(label) {
  return monthLabel(addMonths(`${label}-01`, -1));
}

function computeMonth(label, groups, settings) {
  const { first, last } = monthRange(label);
  const students = store.students.list();
  const studentById = Object.fromEntries(students.map((student) => [student.id, student]));
  const payments = store.payments.list({ where: 'paid_at >= ? AND paid_at <= ?', params: [first, last] });
  const expenses = store.expenses.list({ where: 'date >= ? AND date <= ?', params: [first, last] });
  const lessons = store.lessons.list({ where: 'date >= ? AND date <= ? AND status = ?', params: [first, last, 'held'] });
  const leads = store.leads.list();

  // A student counts as active in the month if they joined by its end and
  // had not left before it started.
  const activeInMonth = students.filter((student) => {
    const joined = student.joinedAt || student.createdAt.slice(0, 10);
    if (joined > last) return false;
    if (student.status === 'inactive') return student.leftAt ? student.leftAt >= first : false;
    return ['active', 'trial'].includes(student.status);
  });

  const privateStudents = activeInMonth.filter((student) => student.lessonType === 'private');
  const groupStudents = activeInMonth.filter((student) => student.lessonType !== 'private');

  const income = { total: 0, private: 0, group: 0, byCurrency: {}, count: payments.length };
  for (const payment of payments) {
    const ils = convertToIls(payment.amount, payment.currency, settings);
    income.total += ils;
    income.byCurrency[payment.currency] = (income.byCurrency[payment.currency] || 0) + payment.amount;
    const student = studentById[payment.studentId];
    if (student?.lessonType === 'private') income.private += ils;
    else income.group += ils;
  }

  const expenseTotals = { total: 0, byCategory: {} };
  for (const expense of expenses) {
    const ils = convertToIls(expense.amount, expense.currency, settings);
    expenseTotals.total += ils;
    expenseTotals.byCategory[expense.category] = (expenseTotals.byCategory[expense.category] || 0) + ils;
  }

  const newStudents = students.filter((student) => student.joinedAt >= first && student.joinedAt <= last && student.status !== 'waitlist');
  const leftStudents = students.filter((student) => student.leftAt >= first && student.leftAt <= last);
  const trials = leads.filter((lead) => lead.trialAt && lead.trialAt.slice(0, 10) >= first && lead.trialAt.slice(0, 10) <= last);
  const trialConverted = trials.filter((lead) => lead.status === 'converted');
  const newLeads = leads.filter((lead) => lead.createdAt.slice(0, 10) >= first && lead.createdAt.slice(0, 10) <= last);

  const groupViews = buildGroupViews(groups, settings).filter((view) => view.profile.status !== 'closed');
  const advertising = expenseTotals.byCategory.advertising || 0;

  const round = (value) => Math.round(value * 100) / 100;
  return {
    month: label,
    activeStudents: activeInMonth.length,
    privateStudents: privateStudents.length,
    groupStudents: groupStudents.length,
    activeGroups: groupViews.length,
    groups: groupViews.map((view) => ({ id: view.id, name: view.name, students: view.studentCount, seatsTotal: view.seatsTotal })),
    lessonsHeld: lessons.length,
    income: { total: round(income.total), private: round(income.private), group: round(income.group), byCurrency: income.byCurrency, count: income.count },
    expenses: { total: round(expenseTotals.total), byCategory: Object.fromEntries(Object.entries(expenseTotals.byCategory).map(([key, value]) => [key, round(value)])) },
    profit: round(income.total - expenseTotals.total),
    newStudents: newStudents.length,
    leftStudents: leftStudents.length,
    newLeads: newLeads.length,
    trials: trials.length,
    trialConversions: trialConverted.length,
    trialConversionRate: trials.length ? round((trialConverted.length / trials.length) * 100) : null,
    acquisitionCost: newStudents.length ? round(advertising / newStudents.length) : null,
    revenuePerStudent: activeInMonth.length ? round(income.total / activeInMonth.length) : null,
    currency: 'ILS'
  };
}

export function buildReport(label, groups, settings = getSettings()) {
  const current = computeMonth(label, groups, settings);
  const previous = computeMonth(previousMonth(label), groups, settings);
  const paymentOverview = buildPaymentOverview(settings);
  const outstanding = paymentOverview.filter((entry) => entry.state === 'overdue' || entry.state === 'due_soon');
  const months = [];
  let cursor = label;
  for (let i = 0; i < 6; i += 1) {
    const summary = computeMonth(cursor, groups, settings);
    months.unshift({ month: cursor, income: summary.income.total, expenses: summary.expenses.total, profit: summary.profit, activeStudents: summary.activeStudents, newStudents: summary.newStudents, leftStudents: summary.leftStudents });
    cursor = previousMonth(cursor);
  }
  return { current, previous, outstanding, trend: months };
}

// ------------------------------------------------------------- messages

function fill(template, values) {
  return String(template || '').replace(/\{(\w+)\}/g, (match, key) => (key in values ? String(values[key] ?? '') : match));
}

function firstNameOf(record) {
  return record?.parentFirstName || (record?.parentName || '').split(/\s+/)[0] || '';
}

function currencySymbol(currency) {
  return currency === 'USD' ? '$' : currency === 'EUR' ? '€' : '₪';
}

// The amount a payment message asks for: what the student owes, else what
// the next monthly charge needs on top of their credit, else a lesson.
function messageAmount(student, status) {
  if (status.balance < 0) return -status.balance;
  if (status.nextChargeAmount !== null && status.nextChargeAmount > status.balance) return round2(status.nextChargeAmount - status.balance);
  const typical = typicalLessonCharge(student);
  return typical ? round2(typical) : null;
}

export function formatMoney(amount, currency) {
  if (amount === null || amount === undefined) return '';
  return `${currencySymbol(currency)}${Number(amount).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

function whatsappLink(phoneNumber, body) {
  const digits = String(phoneNumber || '').replace(/\D/g, '');
  if (!digits) return '';
  return `https://wa.me/${digits}?text=${encodeURIComponent(body)}`;
}

export function composeMessage({ kind, studentId, leadId, lang, occurrence, lesson, values = {} }, groups, settings = getSettings()) {
  const messageKind = oneOf(kind, MESSAGE_KINDS, 'custom');
  const student = studentId ? store.students.get(studentId) : null;
  const lead = leadId ? store.leads.get(leadId) : null;
  if (studentId && !student) throw new HttpError(404, 'Unknown student.');
  if (leadId && !lead) throw new HttpError(404, 'Unknown prospect.');

  const language = oneOf(lang, PARENT_LANGUAGES, parentLanguageOf(student || lead));
  const recipientZone = normalizeTimeZone(student?.timezone || lead?.timezone, settings.businessTimezone);
  // The hour is already in the family's own time zone, so templates saved
  // with the old {timezoneLabel} variable lose it rather than show a code.
  const template = (settings.templates[messageKind]?.[language] || settings.templates[messageKind]?.he || '{notes}').replace(/ ?\(?\{timezoneLabel\}\)?/g, '');
  const locale = language === 'he' ? 'he-IL' : 'en-US';

  const base = {
    // Messages greet by first name: "Hi Michal!", and "Noam's lesson".
    parentName: firstNameOf(student) || firstNameOf(lead),
    parentFullName: student?.parentName || lead?.parentName || '',
    studentName: student ? (student.firstName || studentName(student)) : (lead?.childName || '').split(/\s+/)[0],
    studentFullName: student ? studentName(student) : (lead?.childName || ''),
    teacherName: settings.teacherName,
    zoomLink: occurrence?.zoomLink || student?.privateZoomLink || '',
    time: '',
    trialDate: '',
    dueDate: '',
    amount: '',
    topic: lesson?.topic || '',
    successes: lesson?.successes || '',
    homework: lesson?.homework || '',
    notes: ''
  };

  if (occurrence?.startAt) {
    const startAt = new Date(occurrence.startAt);
    base.time = formatInZone(startAt, recipientZone, locale);
    base.trialDate = formatDateInZone(startAt, recipientZone, locale);
  }
  if (lead?.trialAt && !base.time) {
    const startAt = new Date(lead.trialAt);
    base.time = formatInZone(startAt, recipientZone, locale);
    base.trialDate = formatDateInZone(startAt, recipientZone, locale);
  }
  if (student) {
    const payments = store.payments.list({ where: 'student_id = ?', params: [student.id] });
    const status = computePaymentStatus(student, payments, store.lessons.list(), settings, todayInZone(settings.businessTimezone));
    base.amount = formatMoney(messageAmount(student, status), student.currency);
    base.dueDate = status.nextPaymentAt || '';
  }

  const merged = { ...base };
  for (const [key, value] of Object.entries(values || {})) {
    if (typeof value === 'string' || typeof value === 'number') merged[key] = text(value, 2000);
  }

  const body = fill(template, merged).replace(/\n{3,}/g, '\n\n').trim();
  const recipientPhone = student?.parentPhone || lead?.parentPhone || '';
  return {
    kind: messageKind,
    language,
    recipientPhone,
    recipientName: merged.parentFullName,
    body,
    whatsappLink: whatsappLink(recipientPhone, body),
    studentId: student?.id || '',
    leadId: lead?.id || ''
  };
}

export function normalizeMessage(payload = {}, actor = '') {
  const record = {
    id: store.newId('msg'),
    kind: oneOf(payload.kind, MESSAGE_KINDS, 'custom'),
    channel: oneOf(payload.channel, ['whatsapp', 'email', 'manual'], 'whatsapp'),
    recipientPhone: phone(payload.recipientPhone),
    studentId: text(payload.studentId, 80),
    leadId: text(payload.leadId, 80),
    reference: text(payload.reference, 200),
    body: text(payload.body, 4000),
    status: oneOf(payload.status, ['drafted', 'sent', 'failed'], 'sent'),
    sentAt: '',
    createdBy: actor,
    createdAt: nowIso()
  };
  if (record.status === 'sent') record.sentAt = nowIso();
  if (!record.body) throw new HttpError(400, 'A message needs a body.');
  return record;
}

// Lesson reminders due for a day: one per student per occurrence, with the
// composed text and whether it has already been logged as sent.
export function buildReminders(date, groups, settings = getSettings()) {
  const occurrences = buildOccurrences(groups, date, date, settings).filter((occurrence) => occurrence.kind !== 'cancel');
  const sent = new Set(store.messages.list({ where: 'kind = ? AND status = ?', params: ['lesson_reminder', 'sent'] }).map((message) => message.reference));
  const reminders = [];
  for (const occurrence of occurrences) {
    for (const studentId of occurrence.studentIds) {
      const student = store.students.get(studentId);
      if (!student || !student.parentPhone) continue;
      const leadHours = student.reminderLeadHours ?? settings.reminderLeadHours;
      const reference = `${occurrence.key}:${student.id}`;
      const message = composeMessage({ kind: 'lesson_reminder', studentId: student.id, occurrence }, groups, settings);
      reminders.push({
        reference,
        occurrenceKey: occurrence.key,
        occurrenceTitle: occurrence.title,
        startAt: occurrence.startAt,
        sendAt: new Date(Date.parse(occurrence.startAt) - leadHours * 3_600_000).toISOString(),
        studentId: student.id,
        studentName: studentName(student),
        parentName: student.parentName,
        parentPhone: student.parentPhone,
        enabled: student.remindersEnabled,
        sent: sent.has(reference),
        body: message.body,
        whatsappLink: message.whatsappLink
      });
    }
  }
  return reminders;
}

// ------------------------------------------------------------ overview

// Lessons in the next 48h paired with the last summary, so the teacher
// sees what to prepare.
function lessonsToPrepare(occurrences) {
  return occurrences
    .filter((occurrence) => Date.parse(occurrence.startAt) - Date.now() <= 48 * 3_600_000 && ['group', 'private', 'makeup', 'trial'].includes(occurrence.kind))
    .map((occurrence) => {
      const where = occurrence.groupId ? { where: 'group_id = ? AND status = ?', params: [occurrence.groupId, 'held'] } : { where: 'status = ?', params: ['held'] };
      const previous = store.lessons.list({ ...where, limit: 20 }).find((lesson) => occurrence.groupId ? true : lesson.studentIds.some((id) => occurrence.studentIds.includes(id)));
      return {
        key: occurrence.key,
        title: occurrence.title,
        startAt: occurrence.startAt,
        kind: occurrence.kind,
        lastTopic: previous?.topic || '',
        lastDate: previous?.date || '',
        nextSteps: previous?.nextSteps || '',
        difficulties: previous?.difficulties || ''
      };
    });
}

// How far back a scheduled lesson with no summary is still asked for.
const SUMMARY_LOOKBACK_DAYS = 30;

// Scheduled lessons that are over and have no summary yet, newest first:
// the lessons that happened but were never logged. A lesson counts only
// for students who had joined (the group, for a group lesson) by its date,
// so filling in a student today with a past join date brings in the
// lessons they had since, and a student added with today's date brings in
// none. Each keeps only those students, the ones it belongs to.
function lessonsAwaitingSummary(groups, settings, today) {
  const from = addDays(today, -SUMMARY_LOOKBACK_DAYS);
  const now = new Date().toISOString();
  const studentById = Object.fromEntries(store.students.list().map((student) => [student.id, student]));
  const joinedBy = (student, occurrence) => {
    const joined = (occurrence.groupId ? student.groupJoinedAt : '') || student.joinedAt || student.createdAt.slice(0, 10);
    return joined <= occurrence.date;
  };
  return buildOccurrences(groups, from, today, settings)
    .filter((occurrence) => occurrence.endAt <= now && !occurrence.loggedLessonId && ['group', 'private', 'makeup', 'trial'].includes(occurrence.kind))
    .map((occurrence) => {
      const studentIds = occurrence.studentIds.filter((id) => studentById[id] && joinedBy(studentById[id], occurrence));
      return { ...occurrence, studentIds, students: studentIds.map((id) => studentName(studentById[id])), suggestedGame: undefined, conflicts: undefined };
    })
    .filter((occurrence) => occurrence.studentIds.length)
    .reverse();
}

export function buildOverview(groups, settings = getSettings(), dateOverride = '') {
  const today = isoDate(dateOverride) || todayInZone(settings.businessTimezone);
  const weekEnd = addDays(today, 6);
  const students = store.students.list();
  const activeStudents = students.filter((student) => ['active', 'trial'].includes(student.status));
  const occurrencesToday = buildOccurrences(groups, today, today, settings);
  const occurrencesWeek = buildOccurrences(groups, today, weekEnd, settings);
  const paymentOverview = buildPaymentOverview(settings);
  const groupViews = buildGroupViews(groups, settings);
  const leads = store.leads.list();
  const openLeads = leads.filter((lead) => !['converted', 'lost'].includes(lead.status));

  const followUps = openLeads
    .filter((lead) => {
      if (lead.nextFollowupAt && lead.nextFollowupAt <= today) return true;
      if (lead.status === 'new' && daysBetween(lead.createdAt.slice(0, 10), today) >= 1) return true;
      if (lead.status === 'trial_done' && !lead.nextFollowupAt) return true;
      if (lead.status === 'contacted' && lead.lastContactAt && daysBetween(lead.lastContactAt, today) >= 5 && !lead.nextFollowupAt) return true;
      return false;
    })
    .map((lead) => ({ id: lead.id, parentName: lead.parentName, childName: lead.childName, parentPhone: lead.parentPhone, status: lead.status, nextFollowupAt: lead.nextFollowupAt, lastContactAt: lead.lastContactAt, createdAt: lead.createdAt }));

  const upcomingTrials = [
    ...openLeads
      .filter((lead) => lead.trialAt && lead.trialAt.slice(0, 10) >= today && lead.trialAt.slice(0, 10) <= weekEnd)
      .map((lead) => ({ leadId: lead.id, name: lead.childName || lead.parentName, parentPhone: lead.parentPhone, at: lead.trialAt, status: lead.status })),
    ...occurrencesWeek.filter((occurrence) => occurrence.kind === 'trial' && !occurrence.leadId).map((occurrence) => ({ name: occurrence.title, at: occurrence.startAt, status: 'scheduled' }))
  ].sort((a, b) => a.at.localeCompare(b.at));

  const trialsWithoutResult = leads.filter((lead) => lead.status === 'trial_scheduled' && lead.trialAt && lead.trialAt.slice(0, 10) < today);

  const openSeats = groupViews.filter((view) => view.profile.status !== 'closed' && view.seatsFree > 0);
  const smallGroups = groupViews.filter((view) => view.profile.status !== 'closed' && view.studentCount > 0 && view.studentCount <= 2);
  const waitlist = students.filter((student) => student.status === 'waitlist');

  const prepare = lessonsToPrepare(occurrencesWeek);

  const overdue = paymentOverview.filter((entry) => entry.state === 'overdue');
  const dueSoon = paymentOverview.filter((entry) => entry.state === 'due_soon');

  const recommendations = [];
  for (const bucket of suggestNewGroups(settings)) {
    recommendations.push({ type: bucket.ready ? 'open_group' : 'almost_group', bucket });
  }
  for (const view of smallGroups) {
    const partner = smallGroups.find((other) => other.id !== view.id && languagesFit(other.profile.language, view.profile.language) && other.studentCount + view.studentCount <= view.seatsTotal);
    if (partner && view.id < partner.id) recommendations.push({ type: 'merge_groups', groups: [{ id: view.id, name: view.name, students: view.studentCount }, { id: partner.id, name: partner.name, students: partner.studentCount }] });
  }
  for (const student of waitlist) {
    const matches = matchGroups({ age: ageOf(student, today), rating: student.chesscomRating, level: student.level, language: student.language }, groups, settings).filter((match) => match.recommended);
    if (matches.length) recommendations.push({ type: 'place_waitlisted', student: { id: student.id, name: studentName(student) }, groups: matches.slice(0, 2).map((match) => ({ id: match.groupId, name: match.name, seatsFree: match.seatsFree })) });
  }
  if (overdue.length >= 3) recommendations.push({ type: 'collect_payments', count: overdue.length });
  const stale = openLeads.filter((lead) => lead.status === 'new' && daysBetween(lead.createdAt.slice(0, 10), today) >= 3);
  if (stale.length) recommendations.push({ type: 'stale_leads', count: stale.length });

  const urgent = [];
  for (const entry of overdue.filter((item) => item.daysUntilDue !== null && item.daysUntilDue <= -14)) urgent.push({ type: 'payment_very_late', studentId: entry.studentId, name: entry.name, days: -entry.daysUntilDue });
  for (const lead of trialsWithoutResult) urgent.push({ type: 'trial_no_result', leadId: lead.id, name: lead.childName || lead.parentName });
  for (const occurrence of occurrencesToday.filter((item) => item.conflicts?.length)) urgent.push({ type: 'conflict', key: occurrence.key, name: occurrence.title, startAt: occurrence.startAt });

  const month = monthLabel(today);
  const monthSummary = computeMonth(month, groups, settings);

  return {
    date: today,
    timezone: settings.businessTimezone,
    stats: {
      activeStudents: activeStudents.length,
      privateStudents: activeStudents.filter((student) => student.lessonType === 'private').length,
      groupStudents: activeStudents.filter((student) => student.lessonType !== 'private').length,
      trialStudents: students.filter((student) => student.status === 'trial').length,
      waitlist: waitlist.length,
      activeGroups: groupViews.filter((view) => view.profile.status !== 'closed').length,
      openLeads: openLeads.length,
      monthIncome: monthSummary.income.total,
      monthExpenses: monthSummary.expenses.total,
      monthProfit: monthSummary.profit,
      lessonsToday: occurrencesToday.length,
      overdueCount: overdue.length,
      dueSoonCount: dueSoon.length
    },
    lessonsToday: occurrencesToday,
    lessonsWeek: occurrencesWeek,
    upcomingTrials,
    paymentsOverdue: overdue,
    paymentsDueSoon: dueSoon,
    followUps,
    openSeats: openSeats.map((view) => ({ id: view.id, name: view.name, seatsFree: view.seatsFree, seatsTotal: view.seatsTotal, schedule: view.schedule })),
    prepare,
    missingSummaries: lessonsAwaitingSummary(groups, settings, today),
    urgent,
    recommendations,
    reminders: buildReminders(today, groups, settings)
  };
}

// --------------------------------------------------------- student views

function studentSummary(student, groupsById, settings, today, paymentsByStudent, allLessons) {
  const group = student.groupId ? groupsById[student.groupId] : null;
  const payment = computePaymentStatus(student, paymentsByStudent[student.id] || [], allLessons, settings, today);
  return {
    ...student,
    name: studentName(student),
    age: ageOf(student, today),
    groupName: group ? groupTitle(group, 'he') : '',
    groupNameEn: group ? groupTitle(group, 'en') : '',
    groupSchedule: group ? scheduleRows(group) : [],
    paymentState: payment.state,
    nextPaymentAt: payment.nextPaymentAt,
    balance: payment.balance
  };
}

// The admin picks a country from a short list and stores its code; search
// still finds those students by the country's name in either language.
const COUNTRY_NAMES = { IL: 'ישראל Israel', CA: 'קנדה Canada', US: 'ארצות הברית ארה״ב USA United States' };

export function listStudents(query, groups, settings = getSettings()) {
  const today = todayInZone(settings.businessTimezone);
  const groupsById = Object.fromEntries(groups.map((group) => [group.id, group]));
  const q = text(query.q, 120).toLowerCase();
  const status = oneOf(query.status, STUDENT_STATUSES, '');
  const groupId = text(query.groupId, 80);
  const payments = store.payments.list();
  const paymentsByStudent = {};
  for (const payment of payments) (paymentsByStudent[payment.studentId] ||= []).push(payment);
  const allLessons = store.lessons.list();

  return store.students.list()
    .filter((student) => (status ? student.status === status : student.status !== 'inactive'))
    .filter((student) => !groupId || student.groupId === groupId)
    .filter((student) => {
      if (!q) return true;
      const haystack = [student.firstName, student.lastName, student.parentName, student.parentPhone, student.parentEmail, student.chesscomUsername, student.lichessUsername, student.country, COUNTRY_NAMES[student.country] || '', student.region, student.notes].join(' ').toLowerCase();
      return haystack.includes(q);
    })
    .map((student) => studentSummary(student, groupsById, settings, today, paymentsByStudent, allLessons));
}

export function getStudentDetail(id, groups, settings = getSettings()) {
  const student = store.students.get(id);
  if (!student) throw new HttpError(404, 'Unknown student.');
  const today = todayInZone(settings.businessTimezone);
  const groupsById = Object.fromEntries(groups.map((group) => [group.id, group]));
  const payments = store.payments.list({ where: 'student_id = ?', params: [id] });
  const allLessons = store.lessons.list();
  const lessons = allLessons.filter((lesson) => lesson.studentIds.includes(id));
  const messages = store.messages.list({ where: 'student_id = ?', params: [id], limit: 50 });
  const summary = studentSummary(student, groupsById, settings, today, { [id]: payments }, allLessons);
  const topicsFromLog = topicsFromLessons(lessons.filter((lesson) => lesson.status === 'held' && lesson.attendance?.[id] !== 'absent'));
  const attended = lessons.filter((lesson) => lesson.status === 'held' && lesson.attendance?.[id] !== 'absent').length;
  const absent = lessons.filter((lesson) => lesson.attendance?.[id] === 'absent').length;
  // The next lesson still to teach: not over, not cancelled, not logged.
  // It carries the game suggested for it, as the calendar does.
  const now = new Date().toISOString();
  const nextOccurrence = buildOccurrences(groups, today, addDays(today, 14), settings)
    .find((occurrence) => occurrence.studentIds.includes(id) && occurrence.kind !== 'cancel' && !occurrence.loggedLessonId && occurrence.endAt > now);
  return {
    student: summary,
    payment: computePaymentStatus(student, payments, allLessons, settings, today),
    ...(() => { const { entries, pending } = studentAccount(student, payments, allLessons, settings, today); return { account: entries, accountPending: pending }; })(),
    payments,
    lessons: (() => { const index = gameIndex(); return lessons.map((lesson) => ({ ...withGames(lesson, index), myAttendance: lesson.attendance?.[id] || '' })); })(),
    attendance: { attended, absent, total: lessons.filter((lesson) => lesson.status === 'held').length },
    topics: Array.from(new Set([...(student.topicsLearned || []), ...topicsFromLog])),
    games: (() => {
      const seen = gamesSeenByStudent(lessons)[id] || new Set();
      const index = gameIndex();
      const titles = {};
      for (const lesson of lessons) for (const ref of lesson.gameRefs || []) titles[ref.id] = index[ref.id]?.title || ref.title;
      return [...seen].map((gameId) => ({ id: gameId, title: titles[gameId] }));
    })(),
    messages,
    // Lessons of theirs that took place but were never logged, so the
    // history shows them waiting for a summary.
    awaitingSummary: lessonsAwaitingSummary(groups, settings, today).filter((occurrence) => occurrence.studentIds.includes(id)),
    nextLessonAt: nextOccurrence ? nextOccurrence.startAt : '',
    nextLesson: nextOccurrence || null,
    lead: student.leadId ? store.leads.get(student.leadId) : null
  };
}

// Student files keyed by portal phone, for the member portal's user list:
// each phone maps to every student whose sign-in phone or parent phone it is,
// each with the same payment state the management app shows on the file. A
// parent with two children sees both files, each under its own name.
export function billingByPhone(settings = getSettings()) {
  const overview = buildPaymentOverview(settings);
  const students = store.students.list();
  const byId = Object.fromEntries(overview.map((entry) => [entry.studentId, entry]));
  const result = {};
  for (const student of students) {
    const entry = byId[student.id] || { state: 'inactive', studentId: student.id };
    const summary = {
      studentId: student.id,
      studentName: studentName(student),
      status: student.status,
      state: entry.state,
      prices: student.prices || [],
      currency: student.currency,
      nextPaymentAt: entry.nextPaymentAt || '',
      nextChargeAmount: entry.nextChargeAmount ?? null,
      lastPaymentAt: entry.lastPaymentAt || '',
      lastPaymentAmount: entry.lastPaymentAmount ?? null,
      lastPaymentCurrency: entry.lastPaymentCurrency || '',
      balance: entry.balance ?? null,
      daysUntilDue: entry.daysUntilDue ?? null
    };
    for (const phoneNumber of new Set([student.userPhone, student.parentPhone, student.parentPhone2].filter(Boolean))) {
      (result[phoneNumber] ||= []).push(summary);
    }
  }
  return result;
}

// ----------------------------------------------------------- conversion

export function convertLead(lead, payload, settings = getSettings()) {
  const today = todayInZone(settings.businessTimezone);
  const nameParts = (lead.childName || '').split(/\s+/);
  const student = normalizeStudent({
    firstName: nameParts[0] || lead.parentName,
    lastName: nameParts.slice(1).join(' '),
    age: lead.childAge,
    language: lead.language,
    country: lead.country,
    timezone: lead.timezone,
    parentFirstName: lead.parentFirstName,
    parentLastName: lead.parentLastName,
    parentPhone: lead.parentPhone,
    parentEmail: lead.parentEmail,
    level: lead.level || 'basic',
    chesscomRating: lead.chesscomRating,
    lichessRating: lead.lichessRating,
    lessonType: lead.preference === 'private' ? 'private' : 'group',
    // The quoted price: a month of group lessons, or a private lesson.
    prices: lead.priceQuoted === null || lead.priceQuoted === undefined ? [] : [lead.preference === 'private'
      ? { kind: 'private', model: 'per_lesson', amount: lead.priceQuoted }
      : { kind: 'group', model: 'monthly', amount: lead.priceQuoted }],
    currency: lead.currency,
    status: 'active',
    joinedAt: today,
    source: lead.source,
    referredBy: lead.referredBy,
    leadId: lead.id,
    notes: lead.notes,
    ...payload
  });
  return student;
}

// -------------------------------------------------------- teacher access
//
// The admin (the owner) sees the whole school. A teacher signs in with the
// phone on their teacher record and sees only their own teaching: the
// groups and students assigned to them, the lessons given to those groups
// and students or by the teacher, and their own pay. Prices, payments,
// prospects, expenses and settings stay with the admin.

export function teacherForPhone(phoneNumber) {
  const normalized = phone(phoneNumber);
  if (!normalized) return null;
  return store.teachers.list().find((teacher) => teacher.phone === normalized) || null;
}

// A teacher teaches the groups assigned to them, every student in those
// groups and the students assigned to them directly.
function teachingOf(teacher) {
  const groupIds = new Set(store.groupProfiles.list({ where: 'teacher = ?', params: [teacher.name] }).map((profile) => profile.groupId));
  const studentIds = new Set(store.students.list()
    .filter((student) => student.teacher === teacher.name || (student.groupId && groupIds.has(student.groupId)))
    .map((student) => student.id));
  return { groupIds, studentIds };
}

// The portal groups a teacher teaches, for the member portal's dashboard.
export function teacherGroupIds(teacher) {
  return teacher ? teachingOf(teacher).groupIds : new Set();
}

// A group can be deleted once nobody is in it or waiting for it. Its profile
// and calendar changes go with it; lessons already taught stay in the log.
export function groupHasStudents(groupId) {
  return store.students.list({ where: 'group_id = ?', params: [groupId] }).some((student) => student.status !== 'inactive');
}

export function forgetGroup(groupId) {
  store.groupProfiles.remove(groupId);
  for (const event of store.scheduleEvents.list({ where: 'group_id = ?', params: [groupId] })) store.scheduleEvents.remove(event.id);
  for (const student of store.students.list({ where: 'group_id = ?', params: [groupId] })) store.students.put({ ...student, groupId: '', groupJoinedAt: '' });
}

function seesLesson(teacher, lesson, teaching) {
  return lesson.teacher === teacher.name || (lesson.groupId && teaching.groupIds.has(lesson.groupId)) || lesson.studentIds.some((id) => teaching.studentIds.has(id));
}

// A teacher logs lessons for their own groups, or for students who are all
// theirs, and always as themselves. Checked on the final roster, since a
// group lesson's roster comes from the form: every student on it must be
// the teacher's, or already on the lesson being edited (a student who has
// since left the group stays on its old lessons).
function assertTeachesLesson(teacher, lesson, existing = null) {
  const teaching = teachingOf(teacher);
  const kept = new Set(existing ? existing.studentIds : []);
  const ownStudents = lesson.studentIds.every((id) => teaching.studentIds.has(id) || kept.has(id));
  const allowed = ownStudents && (lesson.groupId ? teaching.groupIds.has(lesson.groupId) : lesson.studentIds.length > 0);
  if (!allowed) throw new HttpError(403, 'You can log lessons only for your own groups and students.');
}

// The calendar lessons a teacher gives: the ones credited to them once
// logged (see calendarTeacher).
function occurrencesOf(teacher, occurrences, settings) {
  const listed = new Set(store.teachers.list().map((entry) => entry.name));
  return occurrences.filter((occurrence) => calendarTeacher(occurrence, listed, settings) === teacher.name);
}

const BILLING_FIELDS = ['price', 'currency', 'billingType', 'lessonPrices', 'prices', 'chargeHistory', 'ledgerFrom', 'openingBalance', 'balance', 'packageSize', 'billingDay', 'paymentTerms', 'nextPaymentAt', 'paymentState', 'lessonsRemaining', 'source', 'leadId'];

function withoutBilling(student) {
  const copy = { ...student };
  for (const field of BILLING_FIELDS) delete copy[field];
  return copy;
}

function withoutGroupPrice(view) {
  const { price, currency, ...profile } = view.profile;
  return { ...view, profile };
}

function teacherSettings(settings) {
  const { businessTimezone, reminderLeadHours, defaultCurrency, maxGroupSize } = settings;
  return { businessTimezone, reminderLeadHours, defaultCurrency, maxGroupSize, teacherName: settings.teacherName };
}

// Messages a teacher sends go out under their own name.
function settingsSignedBy(teacher, settings = getSettings()) {
  return teacher ? { ...settings, teacherName: teacher.name } : settings;
}

// What a teacher may write to a family about: their lessons, never money
// or sales.
export const TEACHER_MESSAGE_KINDS = ['lesson_reminder', 'lesson_summary', 'homework', 'progress', 'schedule_change', 'custom'];

function assertTeacherMessage(teacher, { kind, studentId, leadId }) {
  if (leadId || !studentId || !teachingOf(teacher).studentIds.has(studentId)) throw new HttpError(403, 'You can message only the families of your own students.');
  if (!TEACHER_MESSAGE_KINDS.includes(oneOf(kind, MESSAGE_KINDS, 'custom'))) throw new HttpError(403, 'Only the admin can send this kind of message.');
}

// A teacher's overview: their lessons today and this week, what to prepare
// and the lesson reminders for today.
export function buildTeacherOverview(teacher, groups, settings = getSettings(), dateOverride = '') {
  const today = isoDate(dateOverride) || todayInZone(settings.businessTimezone);
  const week = occurrencesOf(teacher, buildOccurrences(groups, today, addDays(today, 6), settings), settings);
  const lessonsToday = week.filter((occurrence) => occurrence.date === today);
  const todayKeys = new Set(lessonsToday.map((occurrence) => occurrence.key));
  const teaching = teachingOf(teacher);
  const activeStudents = store.students.list().filter((student) => teaching.studentIds.has(student.id) && ['active', 'trial'].includes(student.status));
  return {
    date: today,
    timezone: settings.businessTimezone,
    teacher: { id: teacher.id, name: teacher.name },
    stats: {
      lessonsToday: lessonsToday.length,
      lessonsWeek: week.length,
      groups: teaching.groupIds.size,
      students: activeStudents.length
    },
    lessonsToday,
    lessonsWeek: week,
    prepare: lessonsToPrepare(week),
    missingSummaries: occurrencesOf(teacher, lessonsAwaitingSummary(groups, settings, today), settings),
    reminders: buildReminders(today, groups, settingsSignedBy(teacher, settings)).filter((reminder) => todayKeys.has(reminder.occurrenceKey))
  };
}

// ----------------------------------------------------------------- HTTP

function parseQuery(url) {
  return Object.fromEntries(url.searchParams.entries());
}

const ROUTES = [];
// A route is for the admin only unless it says { teacher: true }; such a
// route scopes what it reads and writes to ctx.teacher when one is set.
function route(method, pattern, handler, { teacher = false } = {}) {
  ROUTES.push({ method, pattern, handler, teacher });
}

// ctx: { session, url, teacher, body(), groups(), saveGroups(groups),
//        syncStudentPortal(student, previous), syncTeacherAccount(teacher, previous) }
// ctx.teacher is the signed-in teacher's record, or null for the admin.

route('GET', /^\/overview$/, async (ctx) => {
  const query = parseQuery(ctx.url);
  if (ctx.teacher) return buildTeacherOverview(ctx.teacher, await ctx.groups(), getSettings(), query.date);
  return buildOverview(await ctx.groups(), getSettings(), query.date);
}, { teacher: true });

route('GET', /^\/settings$/, async (ctx) => {
  if (!ctx.teacher) return { settings: getSettings(), vocabulary: vocabulary() };
  // The message composer offers a teacher only the kinds they may send.
  return { settings: teacherSettings(getSettings()), vocabulary: { ...vocabulary(), messageKinds: TEACHER_MESSAGE_KINDS } };
}, { teacher: true });

route('PUT', /^\/settings$/, async (ctx) => {
  const patch = normalizeSettingsPatch(await ctx.body());
  const current = getSettings();
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'templates') {
      const merged = { ...(store.getSetting('templates', {}) || {}) };
      for (const [kind, langs] of Object.entries(value)) merged[kind] = { ...(merged[kind] || {}), ...langs };
      store.setSetting('templates', merged);
    } else {
      store.setSetting(key, value);
    }
  }
  return { settings: getSettings(), previous: current };
});

route('GET', /^\/students$/, async (ctx) => {
  const students = listStudents(parseQuery(ctx.url), await ctx.groups());
  if (!ctx.teacher) return { students };
  const { studentIds } = teachingOf(ctx.teacher);
  return { students: students.filter((student) => studentIds.has(student.id)).map(withoutBilling) };
}, { teacher: true });

route('POST', /^\/students$/, async (ctx) => {
  const student = normalizeStudent(await ctx.body());
  store.students.put(student);
  await ctx.syncStudentPortal(student, null);
  return { student: getStudentDetail(student.id, await ctx.groups()).student };
});

route('GET', /^\/students\/([^/]+)$/, async (ctx, [id]) => {
  if (!ctx.teacher) return getStudentDetail(id, await ctx.groups());
  if (!teachingOf(ctx.teacher).studentIds.has(id)) throw new HttpError(404, 'Unknown student.');
  const { student, payment, account, accountPending, payments, lead, messages, ...detail } = getStudentDetail(id, await ctx.groups());
  return { ...detail, student: withoutBilling(student), messages: messages.filter((message) => TEACHER_MESSAGE_KINDS.includes(message.kind)) };
}, { teacher: true });

route('PATCH', /^\/students\/([^/]+)$/, async (ctx, [id]) => {
  const existing = store.students.get(id);
  if (!existing) throw new HttpError(404, 'Unknown student.');
  const student = keepPastCharges(existing, normalizeStudent(await ctx.body(), existing));
  store.students.put(student);
  await ctx.syncStudentPortal(student, existing);
  return { student: getStudentDetail(student.id, await ctx.groups()).student };
});

route('DELETE', /^\/students\/([^/]+)$/, async (ctx, [id]) => {
  const existing = store.students.get(id);
  if (!existing) throw new HttpError(404, 'Unknown student.');
  store.students.remove(id);
  await ctx.syncStudentPortal({ ...existing, groupId: '', status: 'inactive' }, existing);
  return { deleted: true };
});

route('GET', /^\/groups$/, async (ctx) => {
  const views = buildGroupViews(await ctx.groups());
  if (!ctx.teacher) return { groups: views };
  const { groupIds } = teachingOf(ctx.teacher);
  return { groups: views.filter((view) => groupIds.has(view.id)).map(withoutGroupPrice) };
}, { teacher: true });

route('PATCH', /^\/groups\/([^/]+)\/profile$/, async (ctx, [groupId]) => {
  const groups = await ctx.groups();
  if (!groups.some((group) => group.id === groupId)) throw new HttpError(404, 'Unknown group.');
  const profile = normalizeGroupProfile(await ctx.body(), store.groupProfiles.get(groupId), groupId);
  store.groupProfiles.put(profile);
  return { group: buildGroupViews(groups).find((view) => view.id === groupId) };
});

route('POST', /^\/groups\/match$/, async (ctx) => ({ matches: matchGroups(await ctx.body(), await ctx.groups()), suggestions: suggestNewGroups() }));

route('GET', /^\/calendar$/, async (ctx) => {
  const query = parseQuery(ctx.url);
  const settings = getSettings();
  const from = isoDate(query.from) || todayInZone(settings.businessTimezone);
  const to = isoDate(query.to) || addDays(from, 6);
  if (daysBetween(from, to) > 62 || to < from) throw new HttpError(400, 'Range must be between 1 and 62 days.');
  const occurrences = buildOccurrences(await ctx.groups(), from, to, settings);
  const events = store.scheduleEvents.list({ where: 'date >= ? AND date <= ?', params: [from, to] });
  if (!ctx.teacher) return { from, to, timezone: settings.businessTimezone, occurrences, events };
  const { groupIds, studentIds } = teachingOf(ctx.teacher);
  return {
    from,
    to,
    timezone: settings.businessTimezone,
    occurrences: occurrencesOf(ctx.teacher, occurrences, settings),
    events: events.filter((event) => (event.groupId && groupIds.has(event.groupId)) || (event.studentId && studentIds.has(event.studentId)))
  };
}, { teacher: true });

route('POST', /^\/events$/, async (ctx) => {
  const event = normalizeEvent(await ctx.body());
  store.scheduleEvents.put(event);
  return { event };
});

route('PATCH', /^\/events\/([^/]+)$/, async (ctx, [id]) => {
  const existing = store.scheduleEvents.get(id);
  if (!existing) throw new HttpError(404, 'Unknown event.');
  const event = normalizeEvent(await ctx.body(), existing);
  store.scheduleEvents.put(event);
  return { event };
});

route('DELETE', /^\/events\/([^/]+)$/, async (ctx, [id]) => {
  if (!store.scheduleEvents.remove(id)) throw new HttpError(404, 'Unknown event.');
  return { deleted: true };
});

route('GET', /^\/lessons$/, async (ctx) => {
  const query = parseQuery(ctx.url);
  const clauses = [];
  const params = [];
  if (query.groupId) { clauses.push('group_id = ?'); params.push(text(query.groupId, 80)); }
  if (query.from) { clauses.push('date >= ?'); params.push(isoDate(query.from)); }
  if (query.to) { clauses.push('date <= ?'); params.push(isoDate(query.to)); }
  let rows = store.lessons.list({ where: clauses.join(' AND '), params, limit: int(query.limit, { min: 1, max: 500 }) || 200 });
  if (query.studentId) {
    rows = rows.filter((lesson) => lesson.studentIds.includes(query.studentId));
  }
  if (ctx.teacher) {
    const teaching = teachingOf(ctx.teacher);
    rows = rows.filter((lesson) => seesLesson(ctx.teacher, lesson, teaching));
  }
  if (query.gameId) {
    const gameId = text(query.gameId, 80);
    rows = rows.filter((lesson) => (lesson.gameRefs || []).some((ref) => ref.id === gameId));
  }
  const index = gameIndex();
  let resolved = rows.map((lesson) => withGames(lesson, index));
  if (query.q) {
    const q = text(query.q, 120).toLowerCase();
    resolved = resolved.filter((lesson) => [lesson.topic, lesson.exercises, lesson.games, lesson.homework, lesson.notes, lesson.rawSummary, ...(lesson.topics || []), ...lesson.gamesResolved.map((game) => game.title)].join(' ').toLowerCase().includes(q));
  }
  return { lessons: resolved };
}, { teacher: true });

// A new lesson's teacher must be on the teachers list: the one asked for,
// else the group's, else (a lesson for one student outside a group) the
// student's, else the default signature name, else none. Edits keep
// whatever the lesson already has, since old lessons are history. The
// calendar uses the same order (see calendarTeacher) so a teacher's page
// expects the lessons that will be credited to them.
function lessonTeacher(requested, groupId, studentIds = []) {
  const listed = new Set(store.teachers.list().map((teacher) => teacher.name));
  const owner = groupId ? store.groupProfiles.get(groupId)?.teacher : studentIds.length === 1 ? store.students.get(studentIds[0])?.teacher : '';
  const candidates = [requested, owner, getSettings().teacherName];
  return candidates.find((name) => name && listed.has(name)) || '';
}

// Who will be credited with a calendar lesson once it is logged: its own
// teacher when listed, else the default teacher.
function calendarTeacher(occurrence, listed, settings) {
  return [occurrence.teacher, settings.teacherName].find((name) => name && listed.has(name)) || '';
}

route('POST', /^\/lessons$/, async (ctx) => {
  const body = await ctx.body();
  // Prices are the admin's: a teacher cannot pick one.
  if (ctx.teacher && body) delete body.priceChoices;
  const draft = normalizeLesson(body, null, ctx.session.username);
  const teacher = ctx.teacher ? ctx.teacher.name : lessonTeacher(draft.teacher, draft.groupId, draft.studentIds);
  const lesson = withRoster({ ...draft, teacher }, null, Array.isArray(body?.studentIds));
  if (ctx.teacher) assertTeachesLesson(ctx.teacher, lesson);
  store.lessons.put(lesson);
  applyLessonToStudents(lesson);
  return { lesson: withGames(lesson) };
}, { teacher: true });

route('PATCH', /^\/lessons\/([^/]+)$/, async (ctx, [id]) => {
  const existing = store.lessons.get(id);
  if (!existing) throw new HttpError(404, 'Unknown lesson.');
  const body = await ctx.body();
  if (ctx.teacher && body) delete body.priceChoices;
  const draft = normalizeLesson(body, existing, ctx.session.username);
  let lesson;
  if (ctx.teacher) {
    // A teacher edits only the lessons they gave, and they stay theirs.
    if (existing.teacher !== ctx.teacher.name) throw new HttpError(403, 'You can edit only the lessons you gave.');
    lesson = withRoster({ ...draft, teacher: ctx.teacher.name }, existing, Array.isArray(body?.studentIds));
    assertTeachesLesson(ctx.teacher, lesson, existing);
  } else {
    // Only an explicit change to a listed teacher replaces the lesson's own.
    const listed = store.teachers.list().some((teacher) => teacher.name === draft.teacher);
    lesson = withRoster(draft.teacher === existing.teacher || listed ? draft : { ...draft, teacher: existing.teacher }, existing, Array.isArray(body?.studentIds));
  }
  store.lessons.put(lesson);
  applyLessonToStudents(lesson);
  return { lesson: withGames(lesson) };
}, { teacher: true });

route('DELETE', /^\/lessons\/([^/]+)$/, async (ctx, [id]) => {
  if (!store.lessons.remove(id)) throw new HttpError(404, 'Unknown lesson.');
  return { deleted: true };
});

route('GET', /^\/payments$/, async (ctx) => {
  const query = parseQuery(ctx.url);
  const clauses = [];
  const params = [];
  if (query.studentId) { clauses.push('student_id = ?'); params.push(text(query.studentId, 80)); }
  if (query.month) { clauses.push('paid_at LIKE ?'); params.push(`${text(query.month, 7)}%`); }
  const students = Object.fromEntries(store.students.list().map((student) => [student.id, studentName(student)]));
  return {
    payments: store.payments.list({ where: clauses.join(' AND '), params, limit: 500 }).map((payment) => ({ ...payment, studentName: students[payment.studentId] || '' })),
    overview: buildPaymentOverview()
  };
});

route('POST', /^\/payments$/, async (ctx) => {
  const payment = normalizePayment(await ctx.body(), null, ctx.session.username);
  store.payments.put(payment);
  return { payment };
});

route('PATCH', /^\/payments\/([^/]+)$/, async (ctx, [id]) => {
  const existing = store.payments.get(id);
  if (!existing) throw new HttpError(404, 'Unknown payment.');
  const payment = normalizePayment(await ctx.body(), existing, ctx.session.username);
  store.payments.put(payment);
  return { payment };
});

route('DELETE', /^\/payments\/([^/]+)$/, async (ctx, [id]) => {
  if (!store.payments.remove(id)) throw new HttpError(404, 'Unknown payment.');
  return { deleted: true };
});

route('GET', /^\/leads$/, async (ctx) => {
  const query = parseQuery(ctx.url);
  const status = oneOf(query.status, LEAD_STATUSES, '');
  const q = text(query.q, 120).toLowerCase();
  // By default the open prospects only: a converted one is now a student,
  // and a lost one is from before prospects could only be deleted.
  const rows = store.leads.list(status ? { where: 'status = ?', params: [status] } : { where: "status NOT IN ('converted', 'lost')" })
    .filter((lead) => !q || [lead.parentName, lead.childName, lead.parentPhone, lead.parentEmail, lead.notes].join(' ').toLowerCase().includes(q));
  // Worked out afresh on every load, so it follows the groups as they fill.
  const settings = getSettings();
  const views = buildGroupViews(await ctx.groups(), settings);
  return { leads: rows.map((lead) => ({ ...lead, suggestedGroup: suggestGroupFor(lead, views, settings) })) };
});

route('POST', /^\/leads$/, async (ctx) => {
  const lead = normalizeLead(await ctx.body());
  store.leads.put(lead);
  return { lead };
});

route('GET', /^\/leads\/([^/]+)$/, async (ctx, [id]) => {
  const lead = store.leads.get(id);
  if (!lead) throw new HttpError(404, 'Unknown prospect.');
  const matches = matchGroups({ age: lead.childAge, rating: lead.chesscomRating, level: lead.level, language: lead.language, availability: lead.availability }, await ctx.groups());
  return { lead, matches, messages: store.messages.list({ where: 'lead_id = ?', params: [id], limit: 50 }) };
});

route('PATCH', /^\/leads\/([^/]+)$/, async (ctx, [id]) => {
  const existing = store.leads.get(id);
  if (!existing) throw new HttpError(404, 'Unknown prospect.');
  const lead = normalizeLead(await ctx.body(), existing);
  store.leads.put(lead);
  return { lead };
});

route('DELETE', /^\/leads\/([^/]+)$/, async (ctx, [id]) => {
  if (!store.leads.remove(id)) throw new HttpError(404, 'Unknown prospect.');
  return { deleted: true };
});

route('POST', /^\/leads\/([^/]+)\/convert$/, async (ctx, [id]) => {
  const lead = store.leads.get(id);
  if (!lead) throw new HttpError(404, 'Unknown prospect.');
  if (lead.convertedStudentId && store.students.get(lead.convertedStudentId)) throw new HttpError(409, 'Prospect already converted.');
  const payload = await ctx.body();
  const student = convertLead(lead, payload);
  store.students.put(student);
  store.leads.put({ ...lead, status: 'converted', convertedStudentId: student.id, updatedAt: nowIso() });
  await ctx.syncStudentPortal(student, null);
  return { student: getStudentDetail(student.id, await ctx.groups()).student, lead: store.leads.get(id) };
});

route('POST', /^\/content\/import-pgn$/, async (ctx) => {
  const payload = await ctx.body();
  const fileName = text(payload.fileName, 200);
  const games = parsePgnFile(String(payload.pgn || ''));
  if (!games.length) throw new HttpError(400, 'No games found in that file.');
  const items = [];
  store.transaction(() => {
    for (const game of games.slice(0, 500)) {
      const item = normalizeContent({
        kind: 'game',
        title: gameTitle(game.headers),
        topic: text(game.headers.Opening || game.headers.ECO || '', 120),
        pgn: game.pgn,
        fen: game.headers.FEN || '',
      white: game.headers.White || '',
      black: game.headers.Black || '',
      event: game.headers.Event || '',
      gameDate: game.headers.Date || '',
      result: game.headers.Result || '',
      sourceFile: fileName,
        movesCount: game.movesCount,
        tags: [fileName].filter(Boolean)
      }, null, ctx.session.username);
      store.content.put(item);
      items.push(item);
    }
  });
  return { imported: items.length, items };
});

route('GET', /^\/content$/, async (ctx) => {
  const query = parseQuery(ctx.url);
  const kind = oneOf(query.kind, CONTENT_KINDS, '');
  const q = text(query.q, 120).toLowerCase();
  const tag = text(query.tag, 120).toLowerCase();
  const all = store.content.list(kind ? { where: 'kind = ?', params: [kind] } : {});
  // A game is found by its players and event as well as by its tags, so
  // "Carlsen" and a trait tagged on it ("sacrifice") both bring it up.
  const rows = all
    .filter((item) => !tag || (item.tags || []).some((entry) => entry.toLowerCase() === tag))
    .filter((item) => !q || [item.title, item.topic, item.body, item.white, item.black, item.event, ...(item.tags || [])].join(' ').toLowerCase().includes(q));
  // Games keep their place, newest upload first: tagging one from the list
  // must not send it jumping to the top.
  if (kind === 'game') rows.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '') || a.title.localeCompare(b.title));
  // Every tag in use on this kind, most used first, for the filter and for
  // suggestions when tagging.
  const counts = new Map();
  for (const item of all) for (const entry of item.tags || []) counts.set(entry, (counts.get(entry) || 0) + 1);
  const tags = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name, count]) => ({ name, count }));
  return { content: rows, tags };
}, { teacher: true });

route('POST', /^\/content$/, async (ctx) => {
  const item = normalizeContent(await ctx.body(), null, ctx.session.username);
  store.content.put(item);
  return { item };
});

route('PATCH', /^\/content\/([^/]+)$/, async (ctx, [id]) => {
  const existing = store.content.get(id);
  if (!existing) throw new HttpError(404, 'Unknown content.');
  const item = normalizeContent(await ctx.body(), existing, ctx.session.username);
  store.transaction(() => {
    store.content.put(item);
    // Lessons show the live title anyway; refreshing the snapshot means a
    // game renamed and later deleted is remembered by its latest name.
    if (item.title !== existing.title) {
      for (const lesson of store.lessons.list({ where: 'game_refs LIKE ?', params: [`%${id}%`] })) {
        const gameRefs = (lesson.gameRefs || []).map((ref) => (ref.id === id ? { ...ref, title: item.title } : ref));
        store.lessons.put({ ...lesson, gameRefs });
      }
    }
  });
  return { item };
});

route('DELETE', /^\/content\/([^/]+)$/, async (ctx, [id]) => {
  if (!store.content.remove(id)) throw new HttpError(404, 'Unknown content.');
  return { deleted: true };
});

route('GET', /^\/expenses$/, async (ctx) => {
  const query = parseQuery(ctx.url);
  const month = text(query.month, 7);
  return { expenses: store.expenses.list(month ? { where: 'date LIKE ?', params: [`${month}%`] } : { limit: 500 }) };
});

route('POST', /^\/expenses$/, async (ctx) => {
  const expense = normalizeExpense(await ctx.body());
  store.expenses.put(expense);
  return { expense };
});

route('PATCH', /^\/expenses\/([^/]+)$/, async (ctx, [id]) => {
  const existing = store.expenses.get(id);
  if (!existing) throw new HttpError(404, 'Unknown expense.');
  const expense = normalizeExpense(await ctx.body(), existing);
  store.expenses.put(expense);
  return { expense };
});

route('DELETE', /^\/expenses\/([^/]+)$/, async (ctx, [id]) => {
  if (!store.expenses.remove(id)) throw new HttpError(404, 'Unknown expense.');
  return { deleted: true };
});

// Groups, students and lessons hold the teacher's name, not an id, so the
// list carries how many groups and students each teacher has. studentCount
// is everyone they teach (their groups' students and their own);
// assignedStudentCount is only the students assigned to them directly,
// which is what removing the teacher unassigns.
function teacherViews() {
  const count = (table, name) => table.list({ where: 'teacher = ?', params: [name] }).length;
  const active = store.students.list({ where: "status != 'inactive'" });
  return store.teachers.list().map((teacher) => {
    const { studentIds } = teachingOf(teacher);
    return {
      ...teacher,
      groupCount: count(store.groupProfiles, teacher.name),
      studentCount: active.filter((student) => studentIds.has(student.id)).length,
      assignedStudentCount: active.filter((student) => student.teacher === teacher.name).length
    };
  });
}

// Names and phones are both unique: the phone is the teacher's sign-in, so
// two teachers cannot share one.
function assertUniqueTeacher({ name, phone: phoneNumber }, id = '') {
  const others = store.teachers.list().filter((teacher) => teacher.id !== id);
  if (others.some((teacher) => teacher.name.toLowerCase() === name.toLowerCase())) throw new HttpError(409, 'A teacher with this name already exists.');
  const sharing = phoneNumber && others.find((teacher) => teacher.phone === phoneNumber);
  if (sharing) throw new HttpError(409, `${sharing.name} already uses this phone number.`);
}

route('GET', /^\/teachers$/, async (ctx) => ({ teachers: teacherViews().filter((teacher) => !ctx.teacher || teacher.id === ctx.teacher.id) }), { teacher: true });

// How long a lesson counts for in a teacher's pay: its own length, else the
// length of its slot in the group's or the student's schedule, else an hour.
function lessonMinutes(lesson, groupById, studentById) {
  if (lesson.durationMinutes) return lesson.durationMinutes;
  const rows = (lesson.groupId ? groupById[lesson.groupId]?.schedule : studentById[lesson.studentIds[0]]?.privateSchedule) || [];
  return scheduleSlot(rows, lesson)?.durationMinutes || 60;
}

// The weekly slot a lesson belongs to: the one on its weekday at its time,
// else on its weekday, else at its time, else the first.
function scheduleSlot(rows, lesson) {
  const weekday = lesson.date ? weekdayOfIsoDate(lesson.date) : null;
  return rows.find((row) => row.weekday === weekday && row.startTime === lesson.startTime) || rows.find((row) => row.weekday === weekday) || rows.find((row) => row.startTime === lesson.startTime) || rows[0];
}

// Lessons the calendar expects a teacher to give: what still counts toward
// the month's pay once it is logged.
const PAID_OCCURRENCE_KINDS = ['group', 'private', 'makeup', 'trial'];

// A teacher's page: the lessons they taught in a month, what that comes to
// at their hourly rate, what the calendar still has for them until the
// month ends, and a month by month history. Pay is computed from logged
// lessons only, so a lesson that took place but was not logged is listed
// apart and not paid until it is. Every month uses the current rate.
export function getTeacherDetail(id, groups, query = {}, settings = getSettings()) {
  const teacher = teacherViews().find((entry) => entry.id === id);
  if (!teacher) throw new HttpError(404, 'Unknown teacher.');
  const today = todayInZone(settings.businessTimezone);
  const month = /^\d{4}-\d{2}$/.test(query.month || '') ? query.month : monthLabel(today);
  const { first, last } = monthRange(month);

  const groupViews = buildGroupViews(groups, settings);
  const groupById = Object.fromEntries(groupViews.map((view) => [view.id, view]));
  const students = store.students.list();
  const studentById = Object.fromEntries(students.map((student) => [student.id, student]));
  const rate = teacher.hourlyRate;
  const payFor = (minutes) => (rate === null ? null : Math.round((minutes / 60) * rate * 100) / 100);
  const total = (rows) => {
    const minutes = rows.reduce((sum, row) => sum + row.minutes, 0);
    return { lessons: rows.length, minutes, amount: payFor(minutes) };
  };

  const lessons = store.lessons.list({ where: 'teacher = ?', params: [teacher.name] }).map((lesson) => {
    const minutes = lessonMinutes(lesson, groupById, studentById);
    return {
      id: lesson.id,
      date: lesson.date,
      startTime: lesson.startTime,
      kind: lesson.kind,
      status: lesson.status,
      topic: lesson.topic,
      groupId: lesson.groupId,
      groupName: groupById[lesson.groupId]?.name || '',
      students: lesson.studentIds.map((studentId) => studentById[studentId]).filter(Boolean).map(studentName),
      minutes,
      amount: lesson.status === 'held' ? payFor(minutes) : 0
    };
  });
  const held = lessons.filter((lesson) => lesson.status === 'held');

  const byMonth = {};
  for (const lesson of held) (byMonth[monthLabel(lesson.date)] ||= []).push(lesson);
  const history = Object.keys(byMonth).sort().reverse().map((label) => ({ month: label, ...total(byMonth[label]) }));

  const listed = new Set(store.teachers.list().map((entry) => entry.name));
  // The calendar's lessons for this teacher in the month that are not
  // logged: from today on they are still to come, before today they were
  // probably given and are waiting to be logged.
  const expected = last < today ? [] : buildOccurrences(groups, first, last, settings)
    .filter((occurrence) => !occurrence.loggedLessonId && PAID_OCCURRENCE_KINDS.includes(occurrence.kind) && calendarTeacher(occurrence, listed, settings) === teacher.name)
    .map((occurrence) => ({ key: occurrence.key, date: occurrence.date, startTime: occurrence.startTime, kind: occurrence.kind, title: occurrence.title, groupId: occurrence.groupId, studentIds: occurrence.groupId ? [] : occurrence.studentIds, minutes: occurrence.durationMinutes || 60 }));
  const monthStart = first > today ? first : today;
  const upcoming = expected.filter((occurrence) => occurrence.date >= monthStart);
  const unlogged = expected.filter((occurrence) => occurrence.date < today);

  const earned = total(held.filter((lesson) => lesson.date >= first && lesson.date <= last));
  const scheduled = total(upcoming);
  return {
    teacher,
    month,
    today,
    rate,
    currency: teacher.currency,
    pay: {
      earned,
      scheduled,
      expected: { lessons: earned.lessons + scheduled.lessons, minutes: earned.minutes + scheduled.minutes, amount: rate === null ? null : Math.round(((earned.amount || 0) + (scheduled.amount || 0)) * 100) / 100 }
    },
    lessons: lessons.filter((lesson) => lesson.date >= first && lesson.date <= last),
    upcoming,
    unlogged,
    history,
    totals: total(held)
  };
}

route('GET', /^\/teachers\/([^/]+)$/, async (ctx, [id]) => {
  if (ctx.teacher && id !== ctx.teacher.id) throw new HttpError(404, 'Unknown teacher.');
  return getTeacherDetail(id, await ctx.groups(), parseQuery(ctx.url));
}, { teacher: true });

route('POST', /^\/teachers$/, async (ctx) => {
  const teacher = normalizeTeacher(await ctx.body());
  assertUniqueTeacher(teacher);
  // The sign-in account first: a phone that already signs in a student
  // stops the teacher from being saved at all.
  await ctx.syncTeacherAccount(teacher, null);
  store.teachers.put(teacher);
  return { teacher };
});

route('PATCH', /^\/teachers\/([^/]+)$/, async (ctx, [id]) => {
  const existing = store.teachers.get(id);
  if (!existing) throw new HttpError(404, 'Unknown teacher.');
  const teacher = normalizeTeacher(await ctx.body(), existing);
  assertUniqueTeacher(teacher, id);
  await ctx.syncTeacherAccount(teacher, existing);
  store.transaction(() => {
    store.teachers.put(teacher);
    if (teacher.name !== existing.name) {
      for (const table of [store.groupProfiles, store.students, store.lessons]) {
        for (const record of table.list({ where: 'teacher = ?', params: [existing.name] })) table.put({ ...record, teacher: teacher.name });
      }
      // The message signature follows the rename too.
      if (getSettings().teacherName === existing.name) store.setSetting('teacherName', teacher.name);
    }
  });
  return { teacher };
});

// Removing a teacher unassigns them from groups and students and closes
// their sign-in; logged lessons keep the name as history.
route('DELETE', /^\/teachers\/([^/]+)$/, async (ctx, [id]) => {
  const existing = store.teachers.get(id);
  if (!existing) throw new HttpError(404, 'Unknown teacher.');
  await ctx.syncTeacherAccount(null, existing);
  store.transaction(() => {
    store.teachers.remove(id);
    for (const table of [store.groupProfiles, store.students]) {
      for (const record of table.list({ where: 'teacher = ?', params: [existing.name] })) table.put({ ...record, teacher: '' });
    }
  });
  return { deleted: true };
});

route('GET', /^\/reports$/, async (ctx) => {
  const query = parseQuery(ctx.url);
  const settings = getSettings();
  const month = /^\d{4}-\d{2}$/.test(query.month || '') ? query.month : monthLabel(todayInZone(settings.businessTimezone));
  return buildReport(month, await ctx.groups(), settings);
});

route('POST', /^\/messages\/compose$/, async (ctx) => {
  const payload = await ctx.body();
  if (ctx.teacher) assertTeacherMessage(ctx.teacher, payload);
  const groups = await ctx.groups();
  let occurrence = null;
  if (payload.occurrenceKey) {
    const settings = getSettings();
    const date = String(payload.occurrenceKey).split(':').find((part) => /^\d{4}-\d{2}-\d{2}$/.test(part));
    if (date) {
      // A teacher's message can only be about a lesson they give, so another
      // group's Zoom link and time never reach it.
      const day = buildOccurrences(groups, date, date, settings);
      occurrence = (ctx.teacher ? occurrencesOf(ctx.teacher, day, settings) : day).find((item) => item.key === payload.occurrenceKey) || null;
    }
  }
  let lesson = payload.lessonId ? store.lessons.get(payload.lessonId) : null;
  if (lesson && ctx.teacher && !seesLesson(ctx.teacher, lesson, teachingOf(ctx.teacher))) lesson = null;
  return { message: composeMessage({ ...payload, occurrence, lesson }, groups, settingsSignedBy(ctx.teacher)) };
}, { teacher: true });

route('GET', /^\/messages$/, async (ctx) => {
  const query = parseQuery(ctx.url);
  const clauses = [];
  const params = [];
  if (query.studentId) { clauses.push('student_id = ?'); params.push(text(query.studentId, 80)); }
  if (query.leadId) { clauses.push('lead_id = ?'); params.push(text(query.leadId, 80)); }
  if (query.kind) { clauses.push('kind = ?'); params.push(oneOf(query.kind, MESSAGE_KINDS, 'custom')); }
  let messages = store.messages.list({ where: clauses.join(' AND '), params, limit: 300 });
  if (ctx.teacher) {
    const { studentIds } = teachingOf(ctx.teacher);
    messages = messages.filter((message) => studentIds.has(message.studentId) && TEACHER_MESSAGE_KINDS.includes(message.kind));
  }
  return { messages };
}, { teacher: true });

route('POST', /^\/messages$/, async (ctx) => {
  const message = normalizeMessage(await ctx.body(), ctx.session.username);
  if (ctx.teacher) assertTeacherMessage(ctx.teacher, message);
  store.messages.put(message);
  if (message.leadId && message.status === 'sent') {
    const lead = store.leads.get(message.leadId);
    if (lead) store.leads.put({ ...lead, lastContactAt: todayInZone(getSettings().businessTimezone), status: lead.status === 'new' ? 'contacted' : lead.status, updatedAt: nowIso() });
  }
  return { message };
}, { teacher: true });

route('GET', /^\/reminders$/, async (ctx) => {
  const query = parseQuery(ctx.url);
  const settings = getSettings();
  const date = isoDate(query.date) || todayInZone(settings.businessTimezone);
  const groups = await ctx.groups();
  if (!ctx.teacher) return { date, reminders: buildReminders(date, groups, settings) };
  const mine = new Set(occurrencesOf(ctx.teacher, buildOccurrences(groups, date, date, settings), settings).map((occurrence) => occurrence.key));
  return { date, reminders: buildReminders(date, groups, settingsSignedBy(ctx.teacher, settings)).filter((reminder) => mine.has(reminder.occurrenceKey)) };
}, { teacher: true });

// When a lesson is logged, every student who attended inherits its topics.
function applyLessonToStudents(lesson) {
  if (lesson.status !== 'held') return;
  for (const id of lesson.studentIds) {
    if (lesson.attendance?.[id] === 'absent') continue;
    const student = store.students.get(id);
    if (!student) continue;
    const topics = Array.from(new Set([...(student.topicsLearned || []), ...(lesson.topics || [])]));
    if (topics.length !== (student.topicsLearned || []).length) {
      store.students.put({ ...student, topicsLearned: topics, updatedAt: nowIso() });
    }
  }
}

function vocabulary() {
  return {
    studentStatuses: STUDENT_STATUSES,
    levels: LEVELS,
    lessonTypes: LESSON_TYPES,
    priceKinds: PRICE_KINDS,
    priceModels: PRICE_MODELS,
    currencies: OFFERED_CURRENCIES,
    languages: OFFERED_LANGUAGES,
    parentLanguages: PARENT_LANGUAGES,
    lessonKinds: LESSON_KINDS,
    attendance: ATTENDANCE,
    leadStatuses: LEAD_STATUSES,
    leadSources: LEAD_SOURCES,
    leadPreferences: LEAD_PREFERENCES,
    contentKinds: CONTENT_KINDS,
    expenseCategories: EXPENSE_CATEGORIES,
    eventKinds: EVENT_KINDS,
    groupStatuses: GROUP_STATUSES,
    messageKinds: MESSAGE_KINDS,
    paymentMethods: PAYMENT_METHODS
  };
}

// What lessons cost students is the admin's: every lesson a teacher is
// sent, wherever it sits in the response, goes without its charges and
// picked prices.
function withoutLessonPrices(value) {
  if (Array.isArray(value)) return value.map(withoutLessonPrices);
  if (!value || typeof value !== 'object') return value;
  const copy = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key !== 'charges' && key !== 'priceChoices') copy[key] = withoutLessonPrices(entry);
  }
  return copy;
}

// Entry point used by server.mjs. Returns { status, payload }.
export async function handleBusinessRequest(method, path, ctx) {
  for (const entry of ROUTES) {
    if (entry.method !== method) continue;
    const match = entry.pattern.exec(path);
    if (!match) continue;
    if (ctx.teacher && !entry.teacher) return { status: 403, payload: { ok: false, error: 'Only the admin can do this.' } };
    try {
      const payload = await entry.handler(ctx, match.slice(1));
      return { status: 200, payload: { ok: true, ...(ctx.teacher ? withoutLessonPrices(payload) : payload) } };
    } catch (error) {
      if (error instanceof HttpError || (error && Number.isInteger(error.statusCode))) {
        return { status: error.statusCode, payload: { ok: false, error: error.message } };
      }
      throw error;
    }
  }
  return { status: 404, payload: { ok: false, error: 'Not found.' } };
}

export { HttpError, studentName, ageOf, groupTitle, scheduleRows };
