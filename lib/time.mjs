// Time-zone helpers built on Intl only (no dependency), used by the business
// module to expand weekly schedules into concrete lesson occurrences and to
// show a lesson time in a parent's local zone.

const DEFAULT_TIMEZONE = 'Asia/Jerusalem';

export function isValidTimeZone(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value.trim() });
    return true;
  } catch {
    return false;
  }
}

export function normalizeTimeZone(value, fallback = DEFAULT_TIMEZONE) {
  return isValidTimeZone(value) ? value.trim() : fallback;
}

// Breaks an instant down into the wall-clock parts of a zone.
export function getZonedParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short'
  });

  const parts = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday)
  };
}

// Converts a wall-clock time in a zone to a UTC instant. Two passes handle
// DST transitions well enough for lesson scheduling.
export function zonedTimeToUtc({ year, month, day, hour = 0, minute = 0, second = 0 }, timeZone) {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  let utc = guess;
  for (let i = 0; i < 2; i += 1) {
    const parts = getZonedParts(new Date(utc), timeZone);
    const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    utc += guess - asUtc;
  }
  return new Date(utc);
}

export function parseIsoDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

export function formatIsoDate({ year, month, day }) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function todayInZone(timeZone, now = new Date()) {
  return formatIsoDate(getZonedParts(now, timeZone));
}

export function addDays(isoDate, days) {
  const parts = parseIsoDate(isoDate);
  if (!parts) return isoDate;
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return formatIsoDate({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() });
}

export function addMonths(isoDate, months) {
  const parts = parseIsoDate(isoDate);
  if (!parts) return isoDate;
  const date = new Date(Date.UTC(parts.year, parts.month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  return formatIsoDate({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: Math.min(parts.day, lastDay) });
}

export function weekdayOfIsoDate(isoDate) {
  const parts = parseIsoDate(isoDate);
  if (!parts) return -1;
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
}

export function daysBetween(fromIso, toIso) {
  const a = parseIsoDate(fromIso);
  const b = parseIsoDate(toIso);
  if (!a || !b) return 0;
  return Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86_400_000);
}

export function parseClock(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

export function formatClock({ hour, minute }) {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function monthLabel(isoDate) {
  return String(isoDate || '').slice(0, 7);
}

// Formats an instant as wall-clock time in another zone, for messages that
// tell a parent abroad when the lesson starts for them.
export function formatInZone(date, timeZone, locale = 'en-US') {
  try {
    return new Intl.DateTimeFormat(locale, {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }).format(date);
  } catch {
    return '';
  }
}

export function formatDateInZone(date, timeZone, locale = 'en-US') {
  try {
    return new Intl.DateTimeFormat(locale, {
      timeZone,
      weekday: 'long',
      day: 'numeric',
      month: 'long'
    }).format(date);
  } catch {
    return '';
  }
}

export { DEFAULT_TIMEZONE };
