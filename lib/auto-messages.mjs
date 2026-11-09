// The reminders the server sends on WhatsApp by itself: a lesson reminder
// at each student's lead time before the lesson, and a payment message on
// the day a family starts to owe. Each goes out once, logged in the message
// log under the same reference a reminder sent by hand gets, so a message
// sent either way is never sent again.

import * as store from './business-db.mjs';
import {
  SENT_STATUSES,
  buildOccurrences,
  buildPaymentOverview,
  buildReminders,
  getSettings,
  messageValues,
  parentLanguageOf
} from './business.mjs';
import { addDays, daysBetween, getZonedParts, parseClock, todayInZone } from './time.mjs';
import { DELIVERY_STATUSES, getWhatsAppConfig, renderTemplate, sendTemplate } from './whatsapp.mjs';
import { logInfo, logWarn } from './log.mjs';

// Lead times go up to 72 hours, so lessons up to three days ahead can be due.
const LOOKAHEAD_DAYS = 3;
// A debt that started while the server was down still gets its message
// within this many days; an older one, such as a debt from before automatic
// messages were turned on, does not.
const PAYMENT_CATCH_UP_DAYS = 2;
// One automatic reply per parent in this long, however many they write.
const AUTO_REPLY_EVERY_MS = 12 * 3_600_000;

const nowIso = () => new Date().toISOString();

export function inQuietHours(now, timeZone, { quietStart, quietEnd }) {
  const start = parseClock(quietStart);
  const end = parseClock(quietEnd);
  if (!start || !end) return false;
  const { hour, minute } = getZonedParts(now, timeZone);
  const minutes = hour * 60 + minute;
  const from = start.hour * 60 + start.minute;
  const to = end.hour * 60 + end.minute;
  if (from === to) return false;
  // 21:00–08:00 runs over midnight.
  return from < to ? minutes >= from && minutes < to : minutes >= from || minutes < to;
}

// "today at 17:00", "tomorrow at 17:00" or "on Tuesday at 17:00", in the
// family's own time zone and language.
export function lessonWhen(startAt, now, timeZone, language) {
  const locale = language === 'he' ? 'he-IL' : 'en-US';
  const time = new Intl.DateTimeFormat(locale, { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(startAt);
  const days = daysBetween(todayInZone(timeZone, now), todayInZone(timeZone, startAt));
  if (language === 'he') {
    if (days === 0) return `היום ב-${time}`;
    if (days === 1) return `מחר ב-${time}`;
    return `ב${new Intl.DateTimeFormat(locale, { timeZone, weekday: 'long' }).format(startAt)} ב-${time}`;
  }
  if (days === 0) return `today at ${time}`;
  if (days === 1) return `tomorrow at ${time}`;
  return `on ${new Intl.DateTimeFormat(locale, { timeZone, weekday: 'long' }).format(startAt)} at ${time}`;
}

// What is due to go out at `now`, whether or not it already has.
function dueMessages(groups, now, settings) {
  const today = todayInZone(settings.businessTimezone, now);
  const due = [];

  for (let offset = 0; offset <= LOOKAHEAD_DAYS; offset += 1) {
    const date = addDays(today, offset);
    const occurrences = new Map(buildOccurrences(groups, date, date, settings).map((occurrence) => [occurrence.key, occurrence]));
    for (const reminder of buildReminders(date, groups, settings)) {
      if (Date.parse(reminder.sendAt) > now.getTime() || Date.parse(reminder.startAt) <= now.getTime()) continue;
      const occurrence = occurrences.get(reminder.occurrenceKey);
      const { student, language, recipientZone, values } = messageValues({ studentId: reminder.studentId, occurrence, today }, settings);
      if (!student.autoMessages) continue;
      due.push({
        kind: 'lesson_reminder',
        reference: reminder.reference,
        student,
        language,
        recipientZone,
        values: {
          ...values,
          when: lessonWhen(new Date(reminder.startAt), now, recipientZone, language),
          zoomLink: values.zoomLink || (language === 'he' ? 'הקישור הקבוע' : 'your usual link')
        }
      });
    }
  }

  for (const entry of buildPaymentOverview(settings, today)) {
    // The day the family started to owe; a later charge they also owe does
    // not start a new debt, so it brings no new message.
    const owedSince = entry.balance < 0 ? entry.nextPaymentAt : '';
    if (!owedSince || owedSince > today || daysBetween(owedSince, today) > PAYMENT_CATCH_UP_DAYS) continue;
    const { student, language, recipientZone, values } = messageValues({ studentId: entry.studentId, today }, settings);
    if (!student.parentPhone || !student.autoMessages) continue;
    due.push({ kind: 'payment_reminder', reference: `payment_due:${student.id}:${owedSince}`, student, language, recipientZone, values });
  }

  return due;
}

// Sends, or in trial mode logs, every message due at `now` that has not gone
// out yet. Callers hold the write lock, so two runs never overlap.
export async function runAutoMessages({ groups, now = new Date(), settings = getSettings(), whatsApp = getWhatsAppConfig(), statusCallback = '' }) {
  const { mode } = settings.autoMessages;
  const summary = { mode, sent: 0, logged: 0, failed: 0, waiting: 0, skipped: 0 };
  if (mode === 'off') return summary;

  for (const message of dueMessages(groups, now, settings)) {
    const earlier = store.messages.list({ where: 'reference = ? AND kind = ?', params: [message.reference, message.kind] });
    // A message that failed is not tried again: the log shows it, and a
    // retry an hour later would be a reminder at the wrong time. A trial
    // run's record stops another trial record, never a real send.
    const done = earlier.some((record) => SENT_STATUSES.includes(record.status) || record.status === 'failed' || (mode === 'trial' && record.status === 'trial'));
    if (done) continue;
    if (inQuietHours(now, message.recipientZone, settings.autoMessages)) {
      summary.waiting += 1;
      continue;
    }

    const record = {
      id: store.newId('msg'),
      kind: message.kind,
      channel: 'whatsapp',
      recipientPhone: message.student.parentPhone,
      studentId: message.student.id,
      leadId: '',
      reference: message.reference,
      body: renderTemplate(message.kind, message.language, message.values),
      status: 'trial',
      sentAt: '',
      createdBy: 'auto',
      createdAt: nowIso(),
      providerId: '',
      error: ''
    };

    if (mode === 'trial') {
      store.messages.put(record);
      summary.logged += 1;
      continue;
    }

    if (!whatsApp.canSend || !whatsApp.contentSids[message.kind]?.[message.language]) {
      // Not set up yet: nothing is logged, so it goes out once it is, if
      // still on time.
      summary.skipped += 1;
      continue;
    }

    // Logged before the call, so a crash in the middle leaves a 'sending'
    // record that is never sent again rather than a second message.
    store.messages.put({ ...record, status: 'sending' });
    try {
      const result = await sendTemplate({ to: record.recipientPhone, kind: message.kind, language: message.language, values: message.values, statusCallback }, whatsApp);
      store.messages.put({ ...record, status: DELIVERY_STATUSES[result.status] || 'queued', providerId: result.sid, sentAt: nowIso() });
      summary.sent += 1;
    } catch (error) {
      store.messages.put({ ...record, status: 'failed', error: `${error.code ? `${error.code}: ` : ''}${error.message}`.slice(0, 500) });
      summary.failed += 1;
      logWarn('auto_messages.send_failed', { kind: message.kind, student: record.studentId, detail: error.message });
    }
  }

  if (summary.sent || summary.logged || summary.failed) logInfo('auto_messages.run', summary);
  return summary;
}

// Delivery reports only move a message forward: a late 'sent' report does
// not undo 'read'. A failure counts whenever it comes.
const PROGRESS = ['sending', 'queued', 'sent', 'delivered', 'read'];

export function recordDeliveryStatus({ sid, status, errorCode = '', errorMessage = '' }) {
  if (!sid) return false;
  const [record] = store.messages.list({ where: 'provider_id = ?', params: [sid], limit: 1 });
  const next = DELIVERY_STATUSES[status];
  if (!record || !next) return false;
  if (next === 'failed') {
    store.messages.put({ ...record, status: 'failed', error: [errorCode, errorMessage].filter(Boolean).join(': ').slice(0, 500) || 'failed' });
    return true;
  }
  if (record.status === 'failed' || PROGRESS.indexOf(next) <= PROGRESS.indexOf(record.status)) return false;
  store.messages.put({ ...record, status: next });
  return true;
}

// A message that is only one of these words asks to stop the messages.
const STOP_WORDS = new Set(['הסר', 'הסרה', 'הסירו', 'הסירי', 'עצור', 'בטל', 'ביטול', 'stop', 'unsubscribe', 'cancel', 'end', 'quit']);

const OPTED_OUT_REPLY = {
  he: 'הבנו, לא נשלח לכם יותר תזכורות אוטומטיות. כדי לחדש אותן אפשר לפנות ל{teacherName}.',
  en: 'Got it, we won\'t send you automatic reminders anymore. To get them again, please contact {teacherName}.'
};

export function isStopRequest(body) {
  return STOP_WORDS.has(String(body || '').trim().toLowerCase().replace(/[.!?,"'״׳\s]+/g, ''));
}

const lastAutoReply = new Map();

// What a parent who writes to the reminders number gets back, in their own
// language. A parent asking to stop has automatic messages turned off for
// every child of theirs, whatever the mode, and is told so. Anyone else gets
// the automatic reply while the mode is on, unless answered recently.
// Changes students, so callers hold the write lock.
export function answerInbound({ from, body }, { now = Date.now(), settings = getSettings() } = {}) {
  if (!from) return '';
  const students = store.students.list({ where: 'parent_phone = ? OR parent_phone_2 = ?', params: [from, from] });
  const language = students.length ? parentLanguageOf(students[0]) : 'he';
  const fill = (text) => text.replaceAll('{teacherName}', settings.teacherName);

  if (isStopRequest(body)) {
    const at = new Date(now).toISOString();
    for (const student of students) {
      if (!student.autoMessagesOptedOutAt) store.students.put({ ...student, autoMessages: false, autoMessagesOptedOutAt: at, updatedAt: at });
    }
    logInfo('auto_messages.opted_out', { students: students.length });
    return fill(OPTED_OUT_REPLY[language]);
  }

  if (settings.autoMessages.mode !== 'on') return '';
  for (const [phone, at] of lastAutoReply) {
    if (now - at >= AUTO_REPLY_EVERY_MS) lastAutoReply.delete(phone);
  }
  if (lastAutoReply.has(from)) return '';
  lastAutoReply.set(from, now);
  return fill(settings.autoMessages.autoReply[language]);
}
