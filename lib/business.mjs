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
export const LEVELS = ['beginner', 'novice', 'intermediate', 'advanced', 'competitive'];
export const LESSON_TYPES = ['group', 'private', 'both'];
export const BILLING_TYPES = ['monthly', 'package', 'per_lesson'];
export const CURRENCIES = ['ILS', 'USD', 'EUR'];
export const LANGUAGES = ['he', 'en', 'ru', 'fr', 'es', 'other'];
export const LESSON_KINDS = ['group', 'private', 'trial', 'makeup'];
export const LESSON_STATUSES = ['held', 'cancelled'];
export const ATTENDANCE = ['present', 'absent', 'late'];
export const LEAD_STATUSES = ['new', 'contacted', 'trial_scheduled', 'trial_done', 'waiting_group', 'converted', 'lost'];
export const LEAD_SOURCES = ['facebook', 'instagram', 'website', 'referral', 'other'];
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
  defaultZoomLink: '',
  teacherName: 'דולב',
  maxGroupSize: 5,
  templates: {
    lesson_reminder: {
      he: 'היי {parentName}! תזכורת: השיעור של {studentName} מתחיל היום ב-{time} ({timezoneLabel}).\nקישור לזום: {zoomLink}\nנתראה! {teacherName}',
      en: 'Hi {parentName}! Reminder: {studentName}\'s chess lesson starts today at {time} ({timezoneLabel}).\nZoom link: {zoomLink}\nSee you soon! {teacherName}'
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
  if ('defaultZoomLink' in payload) patch.defaultZoomLink = text(payload.defaultZoomLink, 500);
  if ('teacherName' in payload) patch.teacherName = text(payload.teacherName, 80);
  if ('maxGroupSize' in payload) patch.maxGroupSize = int(payload.maxGroupSize, { min: 1, max: 30 }) ?? 5;
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

export function normalizeStudent(payload = {}, existing = null) {
  const base = existing || {};
  const value = (key) => (key in payload ? payload[key] : base[key]);
  const settings = getSettings();
  const created = base.createdAt || nowIso();

  const status = oneOf(value('status'), STUDENT_STATUSES, base.status || 'active');
  const record = {
    id: base.id || store.newId('stu'),
    firstName: text(value('firstName'), 80),
    lastName: text(value('lastName'), 80),
    age: int(value('age'), { min: 3, max: 99 }),
    birthDate: isoDate(value('birthDate')),
    country: text(value('country'), 80),
    timezone: value('timezone') ? normalizeTimeZone(value('timezone'), settings.businessTimezone) : '',
    language: oneOf(value('language'), LANGUAGES, 'he'),
    parentName: text(value('parentName'), 120),
    parentPhone: phone(value('parentPhone')),
    parentPhone2: phone(value('parentPhone2')),
    parentEmail: text(value('parentEmail'), 160).toLowerCase(),
    level: oneOf(value('level'), LEVELS, 'beginner'),
    chesscomUsername: text(value('chesscomUsername'), 80),
    chesscomRating: int(value('chesscomRating'), { min: 0, max: 4000 }),
    groupId: text(value('groupId'), 80),
    teacher: text(value('teacher'), 120),
    lessonType: oneOf(value('lessonType'), LESSON_TYPES, 'group'),
    privateSchedule: normalizeSchedule(value('privateSchedule')),
    privateZoomLink: text(value('privateZoomLink'), 500),
    joinedAt: isoDate(value('joinedAt')) || base.joinedAt || '',
    leftAt: isoDate(value('leftAt')),
    status,
    topicsLearned: stringList(value('topicsLearned'), 200),
    strengths: text(value('strengths')),
    weaknesses: text(value('weaknesses')),
    goals: text(value('goals')),
    notes: text(value('notes'), 8000),
    price: num(value('price'), { min: 0, max: 100000 }),
    currency: oneOf(value('currency'), CURRENCIES.map((c) => c.toLowerCase()), 'ils').toUpperCase(),
    billingType: oneOf(value('billingType'), BILLING_TYPES, 'monthly'),
    packageSize: int(value('packageSize'), { min: 1, max: 200 }),
    billingDay: int(value('billingDay'), { min: 1, max: 28 }),
    paymentTerms: text(value('paymentTerms'), 500),
    nextPaymentAt: isoDate(value('nextPaymentAt')),
    remindersEnabled: bool(value('remindersEnabled'), base.remindersEnabled ?? true),
    reminderLeadHours: int(value('reminderLeadHours'), { min: 0, max: 72 }),
    userPhone: phone(value('userPhone')),
    source: text(value('source'), 80),
    leadId: text(value('leadId'), 80),
    createdAt: created,
    updatedAt: nowIso()
  };

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
  const settings = getSettings();
  return {
    groupId: groupId || base.groupId,
    maxStudents: int(value('maxStudents'), { min: 1, max: 30 }) ?? settings.maxGroupSize,
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

  if (!record.date) throw new HttpError(400, 'A lesson needs a date.');
  if (!record.groupId && !record.studentIds.length) throw new HttpError(400, 'A lesson needs a group or at least one student.');
  if (!record.topics.length && record.topic) record.topics = [record.topic];
  return record;
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
    parentName: text(value('parentName'), 120),
    parentPhone: phone(value('parentPhone')),
    parentEmail: text(value('parentEmail'), 160).toLowerCase(),
    childName: text(value('childName'), 120),
    childAge: int(value('childAge'), { min: 3, max: 99 }),
    level: oneOf(value('level'), LEVELS, ''),
    chesscomRating: int(value('chesscomRating'), { min: 0, max: 4000 }),
    language: oneOf(value('language'), LANGUAGES, 'he'),
    country: text(value('country'), 80),
    timezone: value('timezone') ? normalizeTimeZone(value('timezone')) : '',
    availability: text(value('availability'), 500),
    preference: oneOf(value('preference'), LEAD_PREFERENCES, 'either'),
    priceQuoted: num(value('priceQuoted'), { min: 0, max: 100000 }),
    currency: oneOf(value('currency'), CURRENCIES.map((c) => c.toLowerCase()), 'ils').toUpperCase(),
    source: oneOf(value('source'), LEAD_SOURCES, 'other'),
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
    createdBy: base.createdBy || actor,
    createdAt: base.createdAt || nowIso(),
    updatedAt: nowIso()
  };
  if (!record.title) throw new HttpError(400, 'Content needs a title.');
  return record;
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
    const seatsTotal = profile.maxStudents;
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
      students: members.map((student) => ({ id: student.id, name: studentName(student), age: ageOf(student, todayInZone(settings.businessTimezone)), level: student.level, chesscomRating: student.chesscomRating, status: student.status, userPhone: student.userPhone })),
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
  const push = (occurrence) => {
    const clockParts = parseClock(occurrence.startTime) || { hour: 0, minute: 0 };
    const dateParts = parseIsoDate(occurrence.date);
    const startAt = zonedTimeToUtc({ ...dateParts, ...clockParts }, occurrence.timezone || timezone);
    const endAt = new Date(startAt.getTime() + (occurrence.durationMinutes || 60) * 60_000);
    const logged = lessonsLogged.find((lesson) => lesson.date === occurrence.date && (
      (occurrence.groupId && lesson.groupId === occurrence.groupId) ||
      (!occurrence.groupId && occurrence.studentIds.length && lesson.studentIds.some((id) => occurrence.studentIds.includes(id)) && (!lesson.startTime || lesson.startTime === occurrence.startTime))
    ));
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
          zoomLink: view.zoomLink || settings.defaultZoomLink,
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
          zoomLink: student.privateZoomLink || settings.defaultZoomLink,
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
      zoomLink: event.zoomLink || group?.zoomLink || student?.privateZoomLink || settings.defaultZoomLink,
      studentIds,
      students: group ? group.students.map((entry) => entry.name) : student ? [studentName(student)] : lead ? [lead.childName || lead.parentName] : [],
      note: event.note,
      rescheduledFrom: event.kind === 'reschedule' ? `${event.originalDate} ${event.originalTime}`.trim() : ''
    });
  }

  occurrences.sort((a, b) => a.startAt.localeCompare(b.startAt));

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

function lessonsAttendedByStudent(student, allLessons) {
  return allLessons.filter((lesson) => {
    if (lesson.status !== 'held') return false;
    if (student.joinedAt && lesson.date < student.joinedAt) return false;
    const involved = lesson.studentIds.includes(student.id) || (lesson.groupId && lesson.groupId === student.groupId);
    if (!involved) return false;
    const attendance = lesson.attendance?.[student.id];
    return attendance !== 'absent';
  });
}

export function computePaymentStatus(student, studentPayments, allLessons, settings, today) {
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

  // package / per_lesson: compare lessons paid for with lessons attended.
  const purchased = studentPayments.reduce((sum, payment) => sum + (payment.lessonsCount ?? (student.billingType === 'package' ? (student.packageSize || 0) : 1)), 0);
  const used = lessonsAttendedByStudent(student, allLessons).length;
  result.lessonsUsed = used;
  result.lessonsRemaining = purchased - used;
  if (result.lessonsRemaining <= 0) result.state = 'overdue';
  else if (result.lessonsRemaining <= 2) result.state = 'due_soon';
  return result;
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
    .filter((student) => ['active', 'trial'].includes(student.status))
    .map((student) => ({
      ...computePaymentStatus(student, byStudent[student.id] || [], lessons, settings, today),
      name: studentName(student),
      parentName: student.parentName,
      parentPhone: student.parentPhone,
      language: student.language,
      groupId: student.groupId,
      lessonType: student.lessonType
    }));
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
      if (view.profile.language === language) { score += 15; reasons.push('language'); }
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
  for (const candidate of candidates) {
    const ageBand = candidate.age === null || candidate.age === undefined ? 'any' : candidate.age <= 7 ? '5-7' : candidate.age <= 10 ? '8-10' : candidate.age <= 13 ? '11-13' : '14+';
    const levelBand = !candidate.level ? 'any' : ['beginner', 'novice'].includes(candidate.level) ? 'beginner' : candidate.level === 'intermediate' ? 'intermediate' : 'advanced';
    const key = `${candidate.language}|${ageBand}|${levelBand}`;
    (buckets[key] ||= { language: candidate.language, ageBand, levelBand, members: [] }).members.push(candidate);
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

function currencySymbol(currency) {
  return currency === 'USD' ? '$' : currency === 'EUR' ? '€' : '₪';
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

  const language = oneOf(lang, ['he', 'en'], (student?.language || lead?.language) === 'en' ? 'en' : 'he');
  const recipientZone = normalizeTimeZone(student?.timezone || lead?.timezone, settings.businessTimezone);
  const template = settings.templates[messageKind]?.[language] || settings.templates[messageKind]?.he || '{notes}';
  const locale = language === 'he' ? 'he-IL' : 'en-US';

  const base = {
    parentName: student?.parentName || lead?.parentName || '',
    studentName: student ? studentName(student) : (lead?.childName || ''),
    teacherName: settings.teacherName,
    zoomLink: occurrence?.zoomLink || student?.privateZoomLink || settings.defaultZoomLink || '',
    time: '',
    timezoneLabel: recipientZone,
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
    base.amount = formatMoney(student.price, student.currency);
    const payments = store.payments.list({ where: 'student_id = ?', params: [student.id] });
    const status = computePaymentStatus(student, payments, store.lessons.list(), settings, todayInZone(settings.businessTimezone));
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
    recipientName: merged.parentName,
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

  // Lessons in the next 48h paired with the last summary, so the teacher
  // sees what to prepare.
  const prepare = occurrencesWeek
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

  const overdue = paymentOverview.filter((entry) => entry.state === 'overdue');
  const dueSoon = paymentOverview.filter((entry) => entry.state === 'due_soon');

  const recommendations = [];
  for (const bucket of suggestNewGroups(settings)) {
    recommendations.push({ type: bucket.ready ? 'open_group' : 'almost_group', bucket });
  }
  for (const view of smallGroups) {
    const partner = smallGroups.find((other) => other.id !== view.id && other.profile.language === view.profile.language && other.studentCount + view.studentCount <= view.seatsTotal);
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
    lessonsRemaining: payment.lessonsRemaining
  };
}

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
    .filter((student) => !status || student.status === status)
    .filter((student) => !groupId || student.groupId === groupId)
    .filter((student) => {
      if (!q) return true;
      const haystack = [student.firstName, student.lastName, student.parentName, student.parentPhone, student.parentEmail, student.chesscomUsername, student.country, student.notes].join(' ').toLowerCase();
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
  const lessons = allLessons.filter((lesson) => lesson.studentIds.includes(id) || (student.groupId && lesson.groupId === student.groupId && (!student.joinedAt || lesson.date >= student.joinedAt)));
  const messages = store.messages.list({ where: 'student_id = ?', params: [id], limit: 50 });
  const summary = studentSummary(student, groupsById, settings, today, { [id]: payments }, allLessons);
  const topicsFromLog = topicsFromLessons(lessons.filter((lesson) => lesson.status === 'held' && lesson.attendance?.[id] !== 'absent'));
  const attended = lessons.filter((lesson) => lesson.status === 'held' && lesson.attendance?.[id] !== 'absent').length;
  const absent = lessons.filter((lesson) => lesson.attendance?.[id] === 'absent').length;
  const nextOccurrence = buildOccurrences(groups, today, addDays(today, 14), settings).find((occurrence) => occurrence.studentIds.includes(id));
  return {
    student: summary,
    payment: computePaymentStatus(student, payments, allLessons, settings, today),
    payments,
    lessons: lessons.map((lesson) => ({ ...lesson, myAttendance: lesson.attendance?.[id] || '' })),
    attendance: { attended, absent, total: lessons.filter((lesson) => lesson.status === 'held').length },
    topics: Array.from(new Set([...(student.topicsLearned || []), ...topicsFromLog])),
    messages,
    nextLessonAt: nextOccurrence ? nextOccurrence.startAt : '',
    nextLesson: nextOccurrence || null,
    lead: student.leadId ? store.leads.get(student.leadId) : null
  };
}

// Payment state keyed by portal phone, for the member portal's user list.
// A portal account matches a student by its sign-in phone or the parent's.
export function billingByPhone(settings = getSettings()) {
  const overview = buildPaymentOverview(settings);
  const students = store.students.list();
  const byId = Object.fromEntries(overview.map((entry) => [entry.studentId, entry]));
  const result = {};
  const byUserPhone = new Map();
  const byParentPhone = new Map();
  for (const student of students) {
    const entry = byId[student.id] || { state: 'inactive', studentId: student.id };
    const summary = {
      studentId: student.id,
      studentName: studentName(student),
      status: student.status,
      state: entry.state,
      billingType: student.billingType,
      price: student.price,
      currency: student.currency,
      nextPaymentAt: entry.nextPaymentAt || '',
      lastPaymentAt: entry.lastPaymentAt || '',
      lastPaymentAmount: entry.lastPaymentAmount ?? null,
      lessonsRemaining: entry.lessonsRemaining ?? null,
      daysUntilDue: entry.daysUntilDue ?? null
    };
    if (student.userPhone) (byUserPhone.get(student.userPhone) || byUserPhone.set(student.userPhone, []).get(student.userPhone)).push(summary);
    if (student.parentPhone) (byParentPhone.get(student.parentPhone) || byParentPhone.set(student.parentPhone, []).get(student.parentPhone)).push(summary);
  }
  // Only the sign-in phone is an explicit link, so only it carries a payment
  // state. A parent phone that matches exactly one student is offered as a
  // suggestion (name and id, no status), because an account sharing a number
  // with a student is not proof it is that student: siblings, or an unrelated
  // account, must never be shown someone else's "paid up" or "overdue".
  for (const [phoneNumber, summaries] of byParentPhone) {
    if (summaries.length === 1 && !byUserPhone.has(phoneNumber)) {
      result[phoneNumber] = { linked: false, studentId: summaries[0].studentId, studentName: summaries[0].studentName };
    }
  }
  // Duplicate sign-in phones should not exist (the API refuses them), but
  // an older record could still hold one: then the link is ambiguous and
  // nothing is shown rather than one student's status for another.
  for (const [phoneNumber, summaries] of byUserPhone) {
    if (summaries.length === 1) result[phoneNumber] = { linked: true, ...summaries[0] };
    else delete result[phoneNumber];
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
    parentName: lead.parentName,
    parentPhone: lead.parentPhone,
    parentEmail: lead.parentEmail,
    level: lead.level || 'beginner',
    chesscomRating: lead.chesscomRating,
    lessonType: lead.preference === 'private' ? 'private' : 'group',
    price: lead.priceQuoted ?? (lead.preference === 'private' ? settings.defaultPrivatePrice : settings.defaultGroupPrice),
    currency: lead.currency,
    status: 'active',
    joinedAt: today,
    source: lead.source,
    leadId: lead.id,
    notes: lead.notes,
    ...payload
  });
  return student;
}

// ----------------------------------------------------------------- HTTP

function parseQuery(url) {
  return Object.fromEntries(url.searchParams.entries());
}

const ROUTES = [];
function route(method, pattern, handler) {
  ROUTES.push({ method, pattern, handler });
}

// ctx: { session, url, body(), groups(), saveGroups(groups), syncStudentPortal(student, previous) }

route('GET', /^\/overview$/, async (ctx) => {
  const query = parseQuery(ctx.url);
  return buildOverview(await ctx.groups(), getSettings(), query.date);
});

route('GET', /^\/settings$/, async () => ({ settings: getSettings(), vocabulary: vocabulary() }));

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

route('GET', /^\/students$/, async (ctx) => ({ students: listStudents(parseQuery(ctx.url), await ctx.groups()) }));

route('POST', /^\/students$/, async (ctx) => {
  const student = normalizeStudent(await ctx.body());
  store.students.put(student);
  await ctx.syncStudentPortal(student, null);
  return { student: getStudentDetail(student.id, await ctx.groups()).student };
});

route('GET', /^\/students\/([^/]+)$/, async (ctx, [id]) => getStudentDetail(id, await ctx.groups()));

route('PATCH', /^\/students\/([^/]+)$/, async (ctx, [id]) => {
  const existing = store.students.get(id);
  if (!existing) throw new HttpError(404, 'Unknown student.');
  const student = normalizeStudent(await ctx.body(), existing);
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

route('GET', /^\/groups$/, async (ctx) => ({ groups: buildGroupViews(await ctx.groups()) }));

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
  return { from, to, timezone: settings.businessTimezone, occurrences: buildOccurrences(await ctx.groups(), from, to, settings), events: store.scheduleEvents.list({ where: 'date >= ? AND date <= ?', params: [from, to] }) };
});

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
    const student = store.students.get(text(query.studentId, 80));
    rows = rows.filter((lesson) => lesson.studentIds.includes(query.studentId) || (student?.groupId && lesson.groupId === student.groupId));
  }
  if (query.q) {
    const q = text(query.q, 120).toLowerCase();
    rows = rows.filter((lesson) => [lesson.topic, lesson.exercises, lesson.games, lesson.homework, lesson.notes, lesson.rawSummary, ...(lesson.topics || [])].join(' ').toLowerCase().includes(q));
  }
  return { lessons: rows };
});

route('POST', /^\/lessons$/, async (ctx) => {
  const lesson = normalizeLesson(await ctx.body(), null, ctx.session.username);
  store.lessons.put(lesson);
  applyLessonToStudents(lesson);
  return { lesson };
});

route('PATCH', /^\/lessons\/([^/]+)$/, async (ctx, [id]) => {
  const existing = store.lessons.get(id);
  if (!existing) throw new HttpError(404, 'Unknown lesson.');
  const lesson = normalizeLesson(await ctx.body(), existing, ctx.session.username);
  store.lessons.put(lesson);
  applyLessonToStudents(lesson);
  return { lesson };
});

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
  // A pinned due date moves forward when a payment covers it. A payment for
  // an earlier month (arrears) leaves it alone.
  const student = store.students.get(payment.studentId);
  if (student && student.billingType === 'monthly' && student.nextPaymentAt && student.nextPaymentAt <= payment.paidAt) {
    const coversDueMonth = !/^\d{4}-\d{2}$/.test(payment.periodLabel) || payment.periodLabel >= monthLabel(student.nextPaymentAt);
    if (coversDueMonth) store.students.put({ ...student, nextPaymentAt: addMonths(student.nextPaymentAt, 1), updatedAt: nowIso() });
  }
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
  const rows = store.leads.list(status ? { where: 'status = ?', params: [status] } : {})
    .filter((lead) => !q || [lead.parentName, lead.childName, lead.parentPhone, lead.parentEmail, lead.notes].join(' ').toLowerCase().includes(q));
  return { leads: rows };
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

route('GET', /^\/content$/, async (ctx) => {
  const query = parseQuery(ctx.url);
  const kind = oneOf(query.kind, CONTENT_KINDS, '');
  const q = text(query.q, 120).toLowerCase();
  const rows = store.content.list(kind ? { where: 'kind = ?', params: [kind] } : {})
    .filter((item) => !q || [item.title, item.topic, item.body, ...(item.tags || [])].join(' ').toLowerCase().includes(q));
  return { content: rows };
});

route('POST', /^\/content$/, async (ctx) => {
  const item = normalizeContent(await ctx.body(), null, ctx.session.username);
  store.content.put(item);
  return { item };
});

route('PATCH', /^\/content\/([^/]+)$/, async (ctx, [id]) => {
  const existing = store.content.get(id);
  if (!existing) throw new HttpError(404, 'Unknown content.');
  const item = normalizeContent(await ctx.body(), existing, ctx.session.username);
  store.content.put(item);
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

route('GET', /^\/reports$/, async (ctx) => {
  const query = parseQuery(ctx.url);
  const settings = getSettings();
  const month = /^\d{4}-\d{2}$/.test(query.month || '') ? query.month : monthLabel(todayInZone(settings.businessTimezone));
  return buildReport(month, await ctx.groups(), settings);
});

route('POST', /^\/messages\/compose$/, async (ctx) => {
  const payload = await ctx.body();
  const groups = await ctx.groups();
  let occurrence = null;
  if (payload.occurrenceKey) {
    const settings = getSettings();
    const date = String(payload.occurrenceKey).split(':').find((part) => /^\d{4}-\d{2}-\d{2}$/.test(part));
    if (date) occurrence = buildOccurrences(groups, date, date, settings).find((item) => item.key === payload.occurrenceKey) || null;
  }
  const lesson = payload.lessonId ? store.lessons.get(payload.lessonId) : null;
  return { message: composeMessage({ ...payload, occurrence, lesson }, groups) };
});

route('GET', /^\/messages$/, async (ctx) => {
  const query = parseQuery(ctx.url);
  const clauses = [];
  const params = [];
  if (query.studentId) { clauses.push('student_id = ?'); params.push(text(query.studentId, 80)); }
  if (query.leadId) { clauses.push('lead_id = ?'); params.push(text(query.leadId, 80)); }
  if (query.kind) { clauses.push('kind = ?'); params.push(oneOf(query.kind, MESSAGE_KINDS, 'custom')); }
  return { messages: store.messages.list({ where: clauses.join(' AND '), params, limit: 300 }) };
});

route('POST', /^\/messages$/, async (ctx) => {
  const message = normalizeMessage(await ctx.body(), ctx.session.username);
  store.messages.put(message);
  if (message.leadId && message.status === 'sent') {
    const lead = store.leads.get(message.leadId);
    if (lead) store.leads.put({ ...lead, lastContactAt: todayInZone(getSettings().businessTimezone), status: lead.status === 'new' ? 'contacted' : lead.status, updatedAt: nowIso() });
  }
  return { message };
});

route('GET', /^\/reminders$/, async (ctx) => {
  const query = parseQuery(ctx.url);
  const settings = getSettings();
  const date = isoDate(query.date) || todayInZone(settings.businessTimezone);
  return { date, reminders: buildReminders(date, await ctx.groups(), settings) };
});

// When a lesson is logged, every student who attended inherits its topics.
function applyLessonToStudents(lesson) {
  if (lesson.status !== 'held') return;
  const involved = new Set(lesson.studentIds);
  if (lesson.groupId) {
    for (const student of store.students.list({ where: 'group_id = ?', params: [lesson.groupId] })) involved.add(student.id);
  }
  for (const id of involved) {
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
    billingTypes: BILLING_TYPES,
    currencies: CURRENCIES,
    languages: LANGUAGES,
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

// Entry point used by server.mjs. Returns { status, payload }.
export async function handleBusinessRequest(method, path, ctx) {
  for (const entry of ROUTES) {
    if (entry.method !== method) continue;
    const match = entry.pattern.exec(path);
    if (!match) continue;
    try {
      const payload = await entry.handler(ctx, match.slice(1));
      return { status: 200, payload: { ok: true, ...payload } };
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
