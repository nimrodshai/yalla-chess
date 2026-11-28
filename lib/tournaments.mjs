// Tournaments: played on Chess.com, run from here. Families register their
// children and pay; the school sets divisions, confirms who is in, enters the
// results and publishes them. Chess.com keeps the games and the pairings.
//
// A family is everyone reachable from the phone that signed in: a student
// whose portal phone or either parent phone is that number. Nothing a family
// sees carries another child's full name, phone or Chess.com account, and the
// link to join is only given to a child who is confirmed.

import * as store from './business-db.mjs';
import { ageOf, getSettings, HttpError, parentLanguageOf, PAYME_OPEN, studentName } from './business.mjs';
import { withWriteLock } from './mutex.mjs';
import { generateSale, getPaymeConfig, MAX_MINOR, MIN_MINOR, PaymeError, toMinor } from './payme.mjs';
import { formatClock, formatIsoDate, getZonedParts, parseClock, parseIsoDate, todayInZone, zonedTimeToUtc } from './time.mjs';

export const TOURNAMENT_STATUSES = ['draft', 'open', 'closed', 'active', 'finished'];
export const REGISTRATION_STATUSES = ['pending', 'confirmed', 'cancelled'];
export const MANUAL_PAYMENT_METHODS = ['bit', 'paybox', 'bank', 'zelle', 'cash', 'credit', 'waived', 'other'];
export const SIGNUP_STATUSES = ['new', 'handled', 'dismissed'];
const MAX_SIGNUP_CHILDREN = 6;

// A parent who opens the payment page and leaves holds the seat this long.
const CHECKOUT_LINK_SECONDS = 2 * 60 * 60;
const ISRAEL_NAMES = new Set(['il', 'israel', 'ישראל']);

const nowIso = () => new Date().toISOString();
const text = (value, max = 200) => String(value ?? '').trim().slice(0, max);

function intOrNull(value, min, max) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : null;
}

function chessComUrl(value) {
  const raw = text(value, 500);
  if (!raw) return '';
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpError(400, 'A Chess.com link must be a full address that starts with https://www.chess.com/');
  }
  if (url.protocol !== 'https:' || !/(^|\.)chess\.com$/i.test(url.hostname)) {
    throw new HttpError(400, 'A Chess.com link must be a full address that starts with https://www.chess.com/');
  }
  return url.toString();
}

function feeOf(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const amount = Number(value);
  const minor = toMinor(amount);
  // Free is allowed; anything else has to be a price PayMe can charge.
  if (minor === null || (minor !== 0 && (minor < MIN_MINOR || minor > MAX_MINOR))) {
    throw new HttpError(400, `A fee is 0 or between ${MIN_MINOR / 100} and ${MAX_MINOR / 100}.`);
  }
  return minor / 100;
}

// A date and time typed in the school's time zone, as a UTC instant.
function zonedInstant(date, time, zone) {
  const day = parseIsoDate(date);
  const clock = parseClock(time);
  if (!day || !clock) return '';
  return zonedTimeToUtc({ ...day, ...clock }, zone).toISOString();
}

function zonedFields(iso, zone) {
  if (!iso) return { date: '', time: '' };
  const parts = getZonedParts(new Date(iso), zone);
  return { date: formatIsoDate(parts), time: formatClock(parts) };
}

// First name and the last name's initial: enough for children to recognise
// each other, without publishing a minor's full name.
export function shortName(fullName) {
  const words = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return words[0] || '';
  return `${words.slice(0, -1).join(' ')} ${Array.from(words[words.length - 1])[0]}.`;
}

// ------------------------------------------------------------ the family

export function familyStudents(phone) {
  const number = String(phone || '');
  if (!number) return [];
  return store.students.list({
    where: "status != 'inactive' AND (user_phone = ? OR parent_phone = ? OR parent_phone_2 = ?)",
    params: [number, number, number]
  });
}

export function livesInIsrael(student) {
  const country = String(student?.country || '').trim().toLowerCase();
  if (country) return ISRAEL_NAMES.has(country);
  return student?.timezone === 'Asia/Jerusalem' || String(student?.parentPhone || '').startsWith('+972');
}

export function feeFor(student, tournament) {
  return livesInIsrael(student)
    ? { amount: tournament.feeIls, currency: 'ILS' }
    : { amount: tournament.feeUsd, currency: 'USD' };
}

// ------------------------------------------------------------- divisions

function fitsRange(value, min, max) {
  if (min === null && max === null) return true;
  if (value === null || value === undefined) return false;
  return (min === null || value >= min) && (max === null || value <= max);
}

// The first division the child's age and Chess.com rating both fit. A child
// with no rating fits only a division that does not ask for one. Two or more
// divisions with no limits at all (levels the school judges itself) cannot be
// told apart, so none of them is suggested and the school picks.
const unlimited = (division) => ['minAge', 'maxAge', 'minRating', 'maxRating'].every((key) => division[key] === null || division[key] === undefined);
export function suggestDivision(student, divisions, today) {
  const age = ageOf(student, today);
  const rating = student.chesscomRating ?? null;
  const open = divisions.filter(unlimited);
  return divisions.find((division) => (!unlimited(division) || open.length === 1)
    && fitsRange(age, division.minAge, division.maxAge) && fitsRange(rating, division.minRating, division.maxRating)) || null;
}

const divisionsOf = (tournamentId) => store.tournamentDivisions.list({ where: 'tournament_id = ?', params: [tournamentId] });
const signupsOf = (tournamentId) => store.tournamentSignups.list({ where: 'tournament_id = ?', params: [tournamentId] });
const registrationsOf = (tournamentId) => store.tournamentRegistrations.list({ where: 'tournament_id = ?', params: [tournamentId] });
const resultsOf = (tournamentId) => store.tournamentResults.list({ where: 'tournament_id = ?', params: [tournamentId] });

function salesOf(registrations) {
  const sales = {};
  for (const id of new Set(registrations.map((registration) => registration.saleId).filter(Boolean))) {
    const sale = store.paymeSales.get(id);
    if (sale) sales[id] = sale;
  }
  return sales;
}

const saleIsOpen = (sale, now) => Boolean(sale) && PAYME_OPEN.includes(sale.status) && (!sale.expiresAt || sale.expiresAt > now);

// Confirmed children hold a seat, and so does a child being paid for. A
// payment page left to expire gives the seat back.
function holdsSeat(registration, sales, now) {
  if (registration.status === 'confirmed') return true;
  if (registration.status !== 'pending') return false;
  return !registration.saleId || saleIsOpen(sales[registration.saleId], now);
}

function spotsLeft(tournament, registrations, sales, now) {
  if (tournament.capacity === null || tournament.capacity === undefined) return null;
  const taken = registrations.filter((registration) => holdsSeat(registration, sales, now)).length;
  return Math.max(0, tournament.capacity - taken);
}

function registrationOpen(tournament, now) {
  if (tournament.status !== 'open') return false;
  return now < (tournament.closesAt || tournament.startsAt);
}

// ---------------------------------------------------------- admin: write

function normalizeTournament(payload, existing, actor) {
  const zone = getSettings().businessTimezone;
  const base = existing || {};
  const value = (key, fallback) => (key in payload ? payload[key] : (base[key] ?? fallback));
  const name = text(value('name', ''), 120);
  if (!name) throw new HttpError(400, 'A tournament needs a name.');
  const startsAt = 'startDate' in payload ? zonedInstant(payload.startDate, payload.startTime, zone) : base.startsAt;
  if (!startsAt) throw new HttpError(400, 'A tournament needs a date and a time.');
  const closesAt = 'closeDate' in payload ? zonedInstant(payload.closeDate, payload.closeTime || '23:59', zone) : (base.closesAt || '');
  if (closesAt && closesAt > startsAt) throw new HttpError(400, 'Registration has to close before the tournament starts.');
  const now = nowIso();
  return {
    id: base.id || store.newId('trn'),
    name,
    nameEn: text(value('nameEn', ''), 120),
    rules: text(value('rules', ''), 4000),
    rulesEn: text(value('rulesEn', ''), 4000),
    timeControl: text(value('timeControl', '10+5'), 20),
    rounds: intOrNull(value('rounds', 4), 1, 30),
    startsAt,
    closesAt,
    capacity: intOrNull(value('capacity', null), 1, 2000),
    feeIls: feeOf(payload.feeIls, base.feeIls ?? 20),
    feeUsd: feeOf(payload.feeUsd, base.feeUsd ?? 10),
    chesscomUrl: chessComUrl(value('chesscomUrl', '')),
    status: TOURNAMENT_STATUSES.includes(payload.status) ? payload.status : (base.status || 'draft'),
    resultsPublishedAt: base.resultsPublishedAt || '',
    createdBy: base.createdBy || actor,
    createdAt: base.createdAt || now,
    updatedAt: now
  };
}

// The form sends the whole list. A division taken off it leaves its children
// without one, to be placed again.
function saveDivisions(tournamentId, list) {
  const before = divisionsOf(tournamentId);
  const kept = new Set();
  (Array.isArray(list) ? list : []).slice(0, 20).forEach((entry, index) => {
    const name = text(entry?.name, 80);
    if (!name) return;
    const known = before.find((division) => division.id === entry.id);
    const id = known?.id || store.newId('trd');
    kept.add(id);
    store.tournamentDivisions.put({
      id,
      tournamentId,
      name,
      nameEn: text(entry.nameEn, 80),
      minAge: intOrNull(entry.minAge, 0, 120),
      maxAge: intOrNull(entry.maxAge, 0, 120),
      minRating: intOrNull(entry.minRating, 0, 4000),
      maxRating: intOrNull(entry.maxRating, 0, 4000),
      chesscomUrl: chessComUrl(entry.chesscomUrl),
      sortOrder: index
    });
  });
  for (const division of before) {
    if (kept.has(division.id)) continue;
    store.tournamentDivisions.remove(division.id);
    for (const registration of registrationsOf(tournamentId)) {
      if (registration.divisionId === division.id) store.tournamentRegistrations.put({ ...registration, divisionId: '' });
    }
    for (const result of resultsOf(tournamentId)) {
      if (result.divisionId === division.id) store.tournamentResults.put({ ...result, divisionId: '' });
    }
  }
}

function requireTournament(id) {
  const tournament = store.tournaments.get(id);
  if (!tournament) throw new HttpError(404, 'Unknown tournament.');
  return tournament;
}

function writeRegistration({ tournament, student, existing, divisions, today, status, paidAt = '', paymentMethod = '', username, actor }) {
  const fee = feeFor(student, tournament);
  const now = nowIso();
  const registration = {
    id: existing?.id || store.newId('trg'),
    tournamentId: tournament.id,
    studentId: student.id,
    studentName: studentName(student),
    divisionId: existing?.divisionId || suggestDivision(student, divisions, today)?.id || '',
    chesscomUsername: username ?? student.chesscomUsername ?? '',
    status,
    feeAmount: fee.amount,
    currency: fee.currency,
    paidAt,
    paymentMethod,
    // Back after a cancellation: a page still open for this child stays
    // theirs, so paying on it confirms them.
    saleId: existing?.saleId || '',
    registeredBy: actor,
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };
  store.tournamentRegistrations.put(registration);
  return registration;
}

function addStudents(tournament, payload, actor) {
  const ids = [...new Set((Array.isArray(payload.studentIds) ? payload.studentIds : []).map((id) => text(id, 80)))].filter(Boolean);
  if (!ids.length) throw new HttpError(400, 'Pick at least one student.');
  const settled = payload.settled === true;
  const method = MANUAL_PAYMENT_METHODS.includes(payload.paymentMethod) ? payload.paymentMethod : 'other';
  const divisions = divisionsOf(tournament.id);
  const today = todayInZone(getSettings().businessTimezone);
  const registrations = registrationsOf(tournament.id);
  store.transaction(() => {
    for (const id of ids) {
      const student = store.students.get(id);
      if (!student) throw new HttpError(404, 'Unknown student.');
      const existing = registrations.find((registration) => registration.studentId === id);
      if (existing && existing.status !== 'cancelled') continue;
      const free = feeFor(student, tournament).amount === 0;
      writeRegistration({
        tournament, student, existing, divisions, today, actor,
        status: settled || free ? 'confirmed' : 'pending',
        paidAt: settled ? nowIso() : '',
        paymentMethod: settled ? method : ''
      });
    }
  });
}

function updateRegistration(tournament, registrationId, payload) {
  const registration = store.tournamentRegistrations.get(registrationId);
  if (!registration || registration.tournamentId !== tournament.id) throw new HttpError(404, 'Unknown registration.');
  const next = { ...registration, updatedAt: nowIso() };
  if ('divisionId' in payload) {
    const divisionId = text(payload.divisionId, 80);
    if (divisionId && !divisionsOf(tournament.id).some((division) => division.id === divisionId)) throw new HttpError(400, 'Unknown division.');
    next.divisionId = divisionId;
  }
  if (payload.settled === true) {
    next.status = 'confirmed';
    next.paidAt = nowIso();
    next.paymentMethod = MANUAL_PAYMENT_METHODS.includes(payload.paymentMethod) ? payload.paymentMethod : 'other';
  } else if (REGISTRATION_STATUSES.includes(payload.status)) {
    next.status = payload.status;
    // Reopening a registration that was settled by hand un-settles it. What
    // PayMe confirmed stays: that money really arrived.
    if (payload.status === 'pending' && next.paymentMethod !== 'payme') {
      next.paidAt = '';
      next.paymentMethod = '';
    }
  }
  store.tournamentRegistrations.put(next);
}

function autoAssign(tournament) {
  const divisions = divisionsOf(tournament.id);
  const today = todayInZone(getSettings().businessTimezone);
  let placed = 0;
  store.transaction(() => {
    for (const registration of registrationsOf(tournament.id)) {
      if (registration.divisionId || registration.status === 'cancelled') continue;
      const student = store.students.get(registration.studentId);
      const division = student ? suggestDivision(student, divisions, today) : null;
      if (!division) continue;
      store.tournamentRegistrations.put({ ...registration, divisionId: division.id, updatedAt: nowIso() });
      placed += 1;
    }
  });
  return placed;
}

// The whole table as typed. A row left empty is no result.
function saveResults(tournament, rows) {
  const registrations = registrationsOf(tournament.id).filter((registration) => registration.status !== 'cancelled');
  const existing = resultsOf(tournament.id);
  store.transaction(() => {
    for (const row of Array.isArray(rows) ? rows : []) {
      const studentId = text(row?.studentId, 80);
      const registration = registrations.find((entry) => entry.studentId === studentId);
      if (!registration) throw new HttpError(400, 'Results can only be entered for registered students.');
      const known = existing.find((entry) => entry.studentId === studentId);
      const score = row.score === null || row.score === undefined || row.score === '' ? null : Number(row.score);
      if (score !== null && (!Number.isFinite(score) || score < 0 || score > 100)) throw new HttpError(400, 'A score is a number from 0 to 100.');
      const result = {
        rank: intOrNull(row.rank, 1, 2000),
        score,
        wins: intOrNull(row.wins, 0, 100),
        draws: intOrNull(row.draws, 0, 100),
        losses: intOrNull(row.losses, 0, 100),
        gamesUrl: chessComUrl(row.gamesUrl)
      };
      const blank = result.rank === null && result.score === null && result.wins === null && result.draws === null && result.losses === null && !result.gamesUrl;
      if (blank) {
        if (known) store.tournamentResults.remove(known.id);
        continue;
      }
      store.tournamentResults.put({
        id: known?.id || store.newId('trr'),
        tournamentId: tournament.id,
        studentId,
        studentName: registration.studentName,
        divisionId: registration.divisionId,
        ...result,
        updatedAt: nowIso()
      });
    }
  });
}

function setPublished(tournament, published) {
  if (published && !resultsOf(tournament.id).length) throw new HttpError(409, 'Enter the results before publishing them.');
  store.tournaments.put({
    ...tournament,
    resultsPublishedAt: published ? nowIso() : '',
    status: published ? 'finished' : tournament.status,
    updatedAt: nowIso()
  });
}

function removeTournament(tournament) {
  const registrations = registrationsOf(tournament.id);
  if (registrations.some((registration) => registration.paidAt)) {
    throw new HttpError(409, 'Families already paid for this tournament, so it cannot be deleted.');
  }
  store.transaction(() => {
    for (const registration of registrations) store.tournamentRegistrations.remove(registration.id);
    for (const result of resultsOf(tournament.id)) store.tournamentResults.remove(result.id);
    for (const division of divisionsOf(tournament.id)) store.tournamentDivisions.remove(division.id);
    for (const signup of signupsOf(tournament.id)) store.tournamentSignups.remove(signup.id);
    store.tournaments.remove(tournament.id);
  });
}

// ----------------------------------------------------------- admin: read

function staffSummary(tournament, { finance }) {
  const zone = getSettings().businessTimezone;
  const now = nowIso();
  const registrations = registrationsOf(tournament.id);
  const sales = salesOf(registrations);
  const start = zonedFields(tournament.startsAt, zone);
  const close = zonedFields(tournament.closesAt, zone);
  const counts = Object.fromEntries(REGISTRATION_STATUSES.map((status) => [status, registrations.filter((registration) => registration.status === status).length]));
  const summary = {
    ...tournament,
    startDate: start.date,
    startTime: start.time,
    closeDate: close.date,
    closeTime: close.time,
    counts,
    newSignups: signupsOf(tournament.id).filter((signup) => signup.status === 'new').length,
    spotsLeft: spotsLeft(tournament, registrations, sales, now),
    registrationOpen: registrationOpen(tournament, now)
  };
  if (!finance) {
    delete summary.feeIls;
    delete summary.feeUsd;
    return summary;
  }
  const income = {};
  for (const registration of registrations) {
    // A waived fee is a confirmed child, not money received.
    if (registration.status === 'confirmed' && registration.paidAt && registration.paymentMethod !== 'waived') {
      income[registration.currency] = (income[registration.currency] || 0) + registration.feeAmount;
    }
  }
  summary.income = income;
  return summary;
}

function staffDetail(tournament, { finance }) {
  const settings = getSettings();
  const today = todayInZone(settings.businessTimezone);
  const divisions = divisionsOf(tournament.id);
  const registrations = registrationsOf(tournament.id);
  const sales = salesOf(registrations);
  const rows = registrations.map((registration) => {
    const student = store.students.get(registration.studentId);
    const suggestion = student ? suggestDivision(student, divisions, today) : null;
    const row = {
      id: registration.id,
      studentId: registration.studentId,
      studentName: student ? studentName(student) : registration.studentName,
      age: student ? ageOf(student, today) : null,
      rating: student?.chesscomRating ?? null,
      chesscomUsername: student?.chesscomUsername || registration.chesscomUsername,
      divisionId: registration.divisionId,
      suggestedDivisionId: suggestion?.id || '',
      status: registration.status,
      createdAt: registration.createdAt
    };
    if (!finance) return row;
    const sale = sales[registration.saleId];
    return {
      ...row,
      parentName: student?.parentName || '',
      parentPhone: student?.parentPhone || '',
      feeAmount: registration.feeAmount,
      currency: registration.currency,
      paidAt: registration.paidAt,
      paymentMethod: registration.paymentMethod,
      saleStatus: sale?.status || '',
      invoiceUrl: sale?.invoiceUrl || ''
    };
  });
  const registered = new Set(registrations.filter((registration) => registration.status !== 'cancelled').map((registration) => registration.studentId));
  const candidates = finance
    ? store.students.list({ where: "status != 'inactive'" })
      .filter((student) => !registered.has(student.id))
      .map((student) => ({ id: student.id, name: studentName(student), age: ageOf(student, today), rating: student.chesscomRating ?? null }))
    : [];
  // Sign-ups carry a parent's phone, so only the admin sees them. A phone we
  // already know shows which of the school's students it belongs to.
  const signups = finance
    ? signupsOf(tournament.id).map((signup) => ({
      ...signup,
      family: familyStudents(signup.phone).map((student) => ({ id: student.id, name: studentName(student), registered: registered.has(student.id) }))
    }))
    : [];
  return {
    tournament: staffSummary(tournament, { finance }),
    divisions,
    registrations: rows,
    signups,
    results: resultsOf(tournament.id),
    candidates,
    timezone: settings.businessTimezone,
    paymeReady: getPaymeConfig().ready,
    paymentMethods: MANUAL_PAYMENT_METHODS
  };
}

// Every child entered for any tournament, for the admin's list: the children
// registered (by the school or by a family in the portal) and each name left on
// the landing page's form. A name on the form that matches one of the family's
// students links to that student.
function staffEntries() {
  const tournaments = store.tournaments.list();
  const known = new Set(tournaments.map((tournament) => tournament.id));
  const divisions = new Map(store.tournamentDivisions.list().map((division) => [division.id, division]));
  const entries = [];
  for (const registration of store.tournamentRegistrations.list()) {
    if (!known.has(registration.tournamentId)) continue;
    const student = store.students.get(registration.studentId);
    const division = divisions.get(registration.divisionId);
    entries.push({
      id: registration.id,
      source: 'registration',
      tournamentId: registration.tournamentId,
      childName: student ? studentName(student) : registration.studentName,
      studentId: registration.studentId,
      parentName: student?.parentName || '',
      phone: student?.parentPhone || student?.userPhone || '',
      division: division?.name || '',
      divisionEn: division?.nameEn || '',
      status: registration.status,
      paid: Boolean(registration.paidAt),
      createdAt: registration.createdAt
    });
  }
  for (const signup of store.tournamentSignups.list()) {
    if (!known.has(signup.tournamentId)) continue;
    const family = familyStudents(signup.phone);
    signup.children.forEach((name, index) => {
      const student = family.find((entry) => studentName(entry).toLowerCase() === name.toLowerCase());
      entries.push({
        id: `${signup.id}:${index}`,
        source: 'signup',
        signupId: signup.id,
        tournamentId: signup.tournamentId,
        childName: name,
        studentId: student?.id || '',
        parentName: family[0]?.parentName || '',
        phone: signup.phone,
        division: '',
        divisionEn: '',
        status: signup.status,
        paid: false,
        createdAt: signup.createdAt
      });
    });
  }
  entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return {
    tournaments: tournaments
      .map(({ id, name, startsAt, status }) => ({ id, name, startsAt, status }))
      .sort((a, b) => b.startsAt.localeCompare(a.startsAt)),
    entries,
    timezone: getSettings().businessTimezone
  };
}

export function registerTournamentRoutes(route) {
  const finance = (ctx) => ({ finance: !ctx.teacher });

  route('GET', /^\/tournaments$/, async (ctx) => ({
    tournaments: store.tournaments.list().map((tournament) => staffSummary(tournament, finance(ctx)))
  }), { teacher: true });

  // Phones and parents' names: the admin's only.
  route('GET', /^\/tournament-entries$/, async () => staffEntries());

  route('POST', /^\/tournaments$/, async (ctx) => {
    const payload = await ctx.body();
    const tournament = normalizeTournament(payload, null, ctx.session.username);
    store.transaction(() => {
      store.tournaments.put(tournament);
      saveDivisions(tournament.id, payload.divisions);
    });
    return staffDetail(tournament, finance(ctx));
  });

  route('GET', /^\/tournaments\/([^/]+)$/, async (ctx, [id]) => staffDetail(requireTournament(id), finance(ctx)), { teacher: true });

  route('PATCH', /^\/tournaments\/([^/]+)$/, async (ctx, [id]) => {
    const existing = requireTournament(id);
    const payload = await ctx.body();
    const tournament = normalizeTournament(payload, existing, ctx.session.username);
    if (tournament.status === 'draft' && registrationsOf(id).some((registration) => registration.status !== 'cancelled')) {
      throw new HttpError(409, 'Families are already registered, so this tournament cannot go back to a draft.');
    }
    store.transaction(() => {
      store.tournaments.put(tournament);
      if ('divisions' in payload) saveDivisions(id, payload.divisions);
    });
    return staffDetail(tournament, finance(ctx));
  });

  route('DELETE', /^\/tournaments\/([^/]+)$/, async (ctx, [id]) => {
    removeTournament(requireTournament(id));
    return {};
  });

  route('POST', /^\/tournaments\/([^/]+)\/registrations$/, async (ctx, [id]) => {
    const tournament = requireTournament(id);
    addStudents(tournament, await ctx.body(), ctx.session.username);
    return staffDetail(tournament, finance(ctx));
  });

  route('PATCH', /^\/tournaments\/([^/]+)\/registrations\/([^/]+)$/, async (ctx, [id, registrationId]) => {
    const tournament = requireTournament(id);
    updateRegistration(tournament, registrationId, await ctx.body());
    return staffDetail(tournament, finance(ctx));
  });

  route('PATCH', /^\/tournaments\/([^/]+)\/signups\/([^/]+)$/, async (ctx, [id, signupId]) => {
    const tournament = requireTournament(id);
    const signup = store.tournamentSignups.get(signupId);
    if (!signup || signup.tournamentId !== tournament.id) throw new HttpError(404, 'Unknown sign-up.');
    const { status } = await ctx.body();
    if (!SIGNUP_STATUSES.includes(status)) throw new HttpError(400, 'Unknown status.');
    store.tournamentSignups.put({ ...signup, status, updatedAt: nowIso() });
    return staffDetail(tournament, finance(ctx));
  });

  route('POST', /^\/tournaments\/([^/]+)\/assign$/, async (ctx, [id]) => {
    const tournament = requireTournament(id);
    const placed = autoAssign(tournament);
    return { placed, ...staffDetail(tournament, finance(ctx)) };
  });

  route('PUT', /^\/tournaments\/([^/]+)\/results$/, async (ctx, [id]) => {
    const tournament = requireTournament(id);
    const payload = await ctx.body();
    saveResults(tournament, payload.results);
    return staffDetail(tournament, finance(ctx));
  }, { teacher: true });

  route('POST', /^\/tournaments\/([^/]+)\/publish$/, async (ctx, [id]) => {
    const tournament = requireTournament(id);
    const payload = await ctx.body();
    setPublished(tournament, payload.published !== false);
    return staffDetail(requireTournament(id), finance(ctx));
  });
}

// ---------------------------------------------------------- family: read

function familyTournamentView(tournament, children, today, now) {
  const divisions = divisionsOf(tournament.id);
  const registrations = registrationsOf(tournament.id);
  const sales = salesOf(registrations);
  const published = Boolean(tournament.resultsPublishedAt);
  const results = published ? resultsOf(tournament.id) : [];
  const urlOf = (divisionId) => divisions.find((division) => division.id === divisionId)?.chesscomUrl || tournament.chesscomUrl;
  const entries = children.map((child) => {
    const registration = registrations.find((entry) => entry.studentId === child.id);
    const active = registration && registration.status !== 'cancelled' ? registration : null;
    const fee = active ? { amount: active.feeAmount, currency: active.currency } : feeFor(child, tournament);
    const result = results.find((entry) => entry.studentId === child.id);
    return {
      studentId: child.id,
      firstName: child.firstName || studentName(child),
      status: active?.status || 'none',
      divisionId: active ? active.divisionId : (suggestDivision(child, divisions, today)?.id || ''),
      fee,
      paying: Boolean(active?.saleId && saleIsOpen(sales[active.saleId], now)),
      joinUrl: active?.status === 'confirmed' ? urlOf(active.divisionId) : '',
      result: result ? { rank: result.rank, score: result.score, wins: result.wins, draws: result.draws, losses: result.losses, gamesUrl: result.gamesUrl } : null
    };
  });
  return {
    id: tournament.id,
    name: tournament.name,
    nameEn: tournament.nameEn,
    rules: tournament.rules,
    rulesEn: tournament.rulesEn,
    timeControl: tournament.timeControl,
    rounds: tournament.rounds,
    startsAt: tournament.startsAt,
    closesAt: tournament.closesAt,
    status: tournament.status,
    registrationOpen: registrationOpen(tournament, now),
    spotsLeft: spotsLeft(tournament, registrations, sales, now),
    resultsPublished: published,
    divisions: divisions.map((division) => ({ id: division.id, name: division.name, nameEn: division.nameEn })),
    participants: registrations
      .filter((registration) => registration.status === 'confirmed')
      .map((registration) => ({ name: shortName(registration.studentName), divisionId: registration.divisionId, mine: children.some((child) => child.id === registration.studentId) })),
    standings: results.map((result) => ({
      name: shortName(result.studentName),
      mine: children.some((child) => child.id === result.studentId),
      divisionId: result.divisionId,
      rank: result.rank,
      score: result.score,
      wins: result.wins,
      draws: result.draws,
      losses: result.losses,
      gamesUrl: result.gamesUrl
    })),
    entries
  };
}

export function familyTournaments(phone) {
  const children = familyStudents(phone);
  const now = nowIso();
  const today = todayInZone(getSettings().businessTimezone);
  const tournaments = children.length
    ? store.tournaments.list({ where: "status != 'draft'" }).map((tournament) => familyTournamentView(tournament, children, today, now))
    : [];
  return {
    serverTime: now,
    paymeReady: getPaymeConfig().ready,
    children: children.map((child) => ({
      id: child.id,
      firstName: child.firstName || studentName(child),
      chesscomUsername: child.chesscomUsername || ''
    })),
    tournaments
  };
}

// --------------------------------------------------------- public: read

// The landing page at /tournament, for anyone, signed in or not: what the
// tournament is, never who is in it. Without an id it shows the next one a
// family can still register for, else the next one coming up.
export function publicTournament(id) {
  const now = nowIso();
  let tournament = null;
  if (id) {
    tournament = store.tournaments.get(String(id).slice(0, 80));
    if (tournament?.status === 'draft') tournament = null;
  } else {
    const upcoming = store.tournaments
      .list({ where: "status IN ('open', 'closed', 'active') AND starts_at > ?", params: [new Date(Date.now() - 12 * 3600 * 1000).toISOString()], order: 'starts_at ASC' });
    tournament = upcoming.find((entry) => registrationOpen(entry, now)) || upcoming[0] || null;
  }
  if (!tournament) return { serverTime: now, timezone: getSettings().businessTimezone, tournament: null };
  const registrations = registrationsOf(tournament.id);
  return {
    serverTime: now,
    timezone: getSettings().businessTimezone,
    tournament: {
      id: tournament.id,
      name: tournament.name,
      nameEn: tournament.nameEn,
      rules: tournament.rules,
      rulesEn: tournament.rulesEn,
      timeControl: tournament.timeControl,
      rounds: tournament.rounds,
      startsAt: tournament.startsAt,
      closesAt: tournament.closesAt,
      status: tournament.status,
      registrationOpen: registrationOpen(tournament, now),
      spotsLeft: spotsLeft(tournament, registrations, salesOf(registrations), now),
      resultsPublished: Boolean(tournament.resultsPublishedAt),
      // The names only: the page shows the same divisions the school places
      // children in, without the ages, ratings or links behind them.
      divisions: divisionsOf(tournament.id).map((division) => ({ name: division.name, nameEn: division.nameEn }))
    }
  };
}

// --------------------------------------------------------- public: write

// A phone as typed on the form: an Israeli 05x number, or any number with its
// country code. Returns +E.164, or '' when it cannot be a phone.
export function signupPhone(value) {
  let digits = String(value ?? '').trim().replace(/[\s\-().]/g, '');
  if (digits.startsWith('00')) digits = `+${digits.slice(2)}`;
  if (/^0\d{8,9}$/.test(digits)) digits = `+972${digits.slice(1)}`;
  else if (/^972\d{8,9}$/.test(digits)) digits = `+${digits}`;
  return /^\+[1-9]\d{7,14}$/.test(digits) ? digits : '';
}

// The landing page's form. Error messages are codes the page says in the
// family's language. A second form from the same phone adds its children to
// the first one rather than making the school read it twice.
export async function publicSignup(id, payload) {
  const phone = signupPhone(payload?.phone);
  if (!phone) throw new HttpError(400, 'phone');
  const seen = new Set();
  const children = (Array.isArray(payload?.children) ? payload.children : [])
    .map((name) => text(name, 60).replace(/\s+/g, ' '))
    .filter((name) => name && !seen.has(name.toLowerCase()) && seen.add(name.toLowerCase()));
  if (!children.length) throw new HttpError(400, 'children');
  if (children.length > MAX_SIGNUP_CHILDREN) throw new HttpError(400, 'too_many');
  return withWriteLock(async () => {
    const tournament = store.tournaments.get(String(id || '').slice(0, 80));
    if (!tournament || tournament.status === 'draft') throw new HttpError(404, 'not_found');
    const now = nowIso();
    if (!registrationOpen(tournament, now)) throw new HttpError(409, 'closed');
    const registrations = registrationsOf(tournament.id);
    if (spotsLeft(tournament, registrations, salesOf(registrations), now) === 0) throw new HttpError(409, 'full');
    const earlier = signupsOf(tournament.id).find((signup) => signup.phone === phone && signup.status === 'new');
    if (earlier) {
      const known = new Set(earlier.children.map((name) => name.toLowerCase()));
      const merged = [...earlier.children, ...children.filter((name) => !known.has(name.toLowerCase()))].slice(0, MAX_SIGNUP_CHILDREN * 2);
      store.tournamentSignups.put({ ...earlier, children: merged, updatedAt: now });
    } else {
      store.tournamentSignups.put({ id: store.newId('tsu'), tournamentId: tournament.id, phone, children, status: 'new', createdAt: now, updatedAt: now });
    }
    return { children: children.length };
  });
}

// --------------------------------------------------------- family: write

function familyChild(children, id) {
  const child = children.find((entry) => entry.id === id);
  if (!child) throw new HttpError(404, 'unknown_student');
  return child;
}

function registerFamily(phone, tournamentId, payload, actor) {
  const tournament = store.tournaments.get(tournamentId);
  if (!tournament || tournament.status === 'draft') throw new HttpError(404, 'unknown_tournament');
  const now = nowIso();
  if (!registrationOpen(tournament, now)) throw new HttpError(409, 'closed');
  const children = familyStudents(phone);
  const ids = [...new Set((Array.isArray(payload.studentIds) ? payload.studentIds : []).map((id) => text(id, 80)))].filter(Boolean);
  if (!ids.length) throw new HttpError(400, 'no_students');
  const picked = ids.map((id) => familyChild(children, id));

  // One payment page is in one currency.
  if (new Set(picked.map((child) => feeFor(child, tournament).currency)).size > 1) throw new HttpError(409, 'mixed_currency');

  const usernames = payload.usernames && typeof payload.usernames === 'object' ? payload.usernames : {};
  const named = picked.map((child) => {
    const username = text(usernames[child.id], 40) || child.chesscomUsername;
    if (!/^[A-Za-z0-9_-]{3,30}$/.test(username || '')) throw new HttpError(400, 'username');
    return { child, username };
  });

  const registrations = registrationsOf(tournament.id);
  if (registrations.some((entry) => ids.includes(entry.studentId) && entry.status !== 'cancelled')) throw new HttpError(409, 'already');
  const left = spotsLeft(tournament, registrations, salesOf(registrations), now);
  if (left !== null && left < ids.length) throw new HttpError(409, 'full');

  const divisions = divisionsOf(tournament.id);
  const today = todayInZone(getSettings().businessTimezone);
  store.transaction(() => {
    for (const { child, username } of named) {
      if (username !== child.chesscomUsername) store.students.put({ ...child, chesscomUsername: username, updatedAt: now });
      writeRegistration({
        tournament,
        student: { ...child, chesscomUsername: username },
        existing: registrations.find((entry) => entry.studentId === child.id),
        divisions,
        today,
        username,
        actor,
        status: feeFor(child, tournament).amount === 0 ? 'confirmed' : 'pending'
      });
    }
  });
}

function cancelFamily(phone, tournamentId, payload) {
  const child = familyChild(familyStudents(phone), text(payload.studentId, 80));
  const registration = registrationsOf(tournamentId).find((entry) => entry.studentId === child.id);
  if (!registration || registration.status === 'cancelled') throw new HttpError(404, 'unknown_registration');
  // A paid seat involves a refund, which is a conversation with the school.
  if (registration.status !== 'pending') throw new HttpError(409, 'paid');
  store.tournamentRegistrations.put({ ...registration, status: 'cancelled', updatedAt: nowIso() });
}

// What paying now means: a new page for the children who have none, else the
// page already open for them. A child is never on two open pages.
function planCheckout(phone, tournamentId) {
  const tournament = store.tournaments.get(tournamentId);
  if (!tournament) throw new HttpError(404, 'unknown_tournament');
  const children = familyStudents(phone);
  const ids = new Set(children.map((child) => child.id));
  const registrations = registrationsOf(tournamentId);
  const sales = salesOf(registrations);
  const now = nowIso();
  const pending = registrations.filter((entry) => ids.has(entry.studentId) && entry.status === 'pending');
  if (!pending.length) return { result: { payUrl: '' } };
  const payme = getPaymeConfig();
  if (!payme.ready) return { result: { payUrl: '' } };
  const unpaged = pending.filter((entry) => !saleIsOpen(sales[entry.saleId], now));
  if (!unpaged.length) return { result: { payUrl: sales[pending[0].saleId].saleUrl } };

  // A seat given back when an earlier page expired has to still be there.
  const lapsed = unpaged.filter((entry) => entry.saleId).length;
  const left = spotsLeft(tournament, registrations, sales, now);
  if (lapsed && left !== null && left < lapsed) throw new HttpError(409, 'full');
  if (!registrationOpen(tournament, now) && lapsed) throw new HttpError(409, 'closed');
  if (new Set(unpaged.map((entry) => entry.currency)).size > 1) throw new HttpError(409, 'mixed_currency');

  const amountMinor = unpaged.reduce((sum, entry) => sum + toMinor(entry.feeAmount), 0);
  const payer = children.find((child) => child.id === unpaged[0].studentId);
  return {
    create: {
      orderId: store.newId('pm'),
      amountMinor,
      currency: unpaged[0].currency,
      productName: `${tournament.nameEn || tournament.name} · ${unpaged.map((entry) => shortName(entry.studentName)).join(', ')}`,
      buyerName: payer.parentName || studentName(payer),
      buyerEmail: payer.parentEmail || '',
      buyerPhone: phone,
      language: parentLanguageOf(payer),
      expirySeconds: CHECKOUT_LINK_SECONDS
    },
    registrationIds: unpaged.map((entry) => entry.id),
    studentId: payer.id,
    environment: payme.environment,
    paymeConfig: payme
  };
}

function attachSale(plan, created, actor) {
  const now = nowIso();
  const sale = {
    id: plan.create.orderId,
    studentId: plan.studentId,
    paymeSaleId: created.paymeSaleId,
    paymeSaleCode: created.paymeSaleCode,
    saleUrl: created.saleUrl,
    amountMinor: plan.create.amountMinor,
    currency: plan.create.currency,
    description: plan.create.productName,
    periodLabel: '',
    purpose: 'tournament',
    environment: plan.environment,
    status: 'initial',
    paymentId: '',
    invoiceNumber: '',
    invoiceUrl: '',
    paidAt: '',
    expiresAt: new Date(Date.now() + CHECKOUT_LINK_SECONDS * 1000).toISOString(),
    checkedAt: '',
    checkError: '',
    createdBy: actor,
    createdAt: now,
    updatedAt: now
  };
  store.transaction(() => {
    store.paymeSales.put(sale);
    for (const id of plan.registrationIds) {
      const registration = store.tournamentRegistrations.get(id);
      if (registration) store.tournamentRegistrations.put({ ...registration, saleId: sale.id, updatedAt: now });
    }
  });
  return { payUrl: sale.saleUrl };
}

// The call to PayMe happens outside the write lock, so a slow answer does not
// hold up the rest of the site. One checkout per family and tournament runs
// at a time, which is what keeps a double click from opening two pages.
const checkingOut = new Set();

async function checkoutFamily(phone, tournamentId, actor) {
  const key = `${phone}:${tournamentId}`;
  if (checkingOut.has(key)) throw new HttpError(409, 'busy');
  checkingOut.add(key);
  try {
    const plan = await withWriteLock(async () => planCheckout(phone, tournamentId));
    if (!plan.create) return plan.result;
    let created;
    try {
      created = await generateSale(plan.create, plan.paymeConfig);
    } catch (error) {
      // The seat is saved either way; the family can try paying again.
      if (error instanceof PaymeError) return { payUrl: '', paymentFailed: true };
      throw error;
    }
    return await withWriteLock(async () => attachSale(plan, created, actor));
  } finally {
    checkingOut.delete(key);
  }
}

// PayMe confirmed the money. Everyone on the page is in, including a child
// who was cancelled after the page opened: their fee was paid with it.
export function confirmTournamentSale(saleId) {
  const now = nowIso();
  for (const registration of store.tournamentRegistrations.list({ where: 'sale_id = ?', params: [saleId] })) {
    store.tournamentRegistrations.put({ ...registration, status: 'confirmed', paidAt: registration.paidAt || now, paymentMethod: 'payme', updatedAt: now });
  }
}

// The portal's API: /api/tournaments. session is signed in. Error messages
// are codes, which the portal says in the family's language.
export async function handleFamilyTournaments(method, path, session, readBody) {
  try {
    const phone = session.phone || '';
    if (method === 'GET' && path === '/') return { status: 200, payload: { ok: true, ...familyTournaments(phone) } };
    const match = /^\/([^/]+)\/(register|pay|cancel)$/.exec(path);
    if (method !== 'POST' || !match) return { status: 404, payload: { ok: false, error: 'not_found' } };
    const [, id, action] = match;
    let checkout = {};
    if (action === 'register') {
      const payload = await readBody();
      await withWriteLock(async () => registerFamily(phone, id, payload, session.username));
      checkout = await checkoutFamily(phone, id, session.username);
    } else if (action === 'pay') {
      checkout = await checkoutFamily(phone, id, session.username);
    } else {
      const payload = await readBody();
      await withWriteLock(async () => cancelFamily(phone, id, payload));
    }
    return { status: 200, payload: { ok: true, ...checkout, ...familyTournaments(phone) } };
  } catch (error) {
    if (error instanceof HttpError || Number.isInteger(error?.statusCode)) {
      return { status: error.statusCode, payload: { ok: false, error: error.message } };
    }
    throw error;
  }
}
