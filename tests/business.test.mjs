// The business-management API: access control, student lifecycle with
// portal sync, lesson logging, payment status, prospects, calendar and the
// daily brief. Runs against a real server on a throwaway database with the
// development demo data seeded.

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { devEnv, signIn, startServer } from './helpers.mjs';

const TEACHER = '+972500000001';
const STUDENT = '+972500000004';

function json(cookie, body, method = 'POST') {
  return { method, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body) };
}

describe('business API', () => {
  let server;
  let teacher;
  let student;

  before(async () => {
    server = await startServer(devEnv);
    teacher = await signIn(server, TEACHER);
    student = await signIn(server, STUDENT);
  });
  after(async () => { await server.stop(); });

  it('serves the management app to teachers only through the API', async () => {
    const anonymous = await server.fetch('/api/business/overview');
    assert.equal(anonymous.status, 401);

    const asStudent = await server.fetch('/api/business/overview', { headers: { Cookie: student.cookie } });
    assert.equal(asStudent.status, 403);

    const asTeacher = await server.fetch('/api/business/overview', { headers: { Cookie: teacher.cookie } });
    assert.equal(asTeacher.status, 200);
    const body = await asTeacher.json();
    assert.equal(body.ok, true);
    assert.ok(Array.isArray(body.lessonsToday));
    assert.ok(body.stats.activeStudents > 0, 'demo data should be seeded in development');

    const page = await server.fetch('/admin');
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /text\/html/);
  });

  it('creates a student, links a portal account and places them in their group', async () => {
    const phone = '+972500000777';
    const created = await server.fetch('/api/business/students', json(teacher.cookie, {
      firstName: 'Test', lastName: 'Student', age: 9, parentName: 'Parent', parentPhone: '050-111-2222',
      groupId: 'rookies', userPhone: phone, price: 250, currency: 'ILS', billingType: 'monthly'
    }));
    assert.equal(created.status, 200);
    const { student: record } = await created.json();
    assert.equal(record.parentPhone, '+972501112222', 'phones are normalised to E.164');
    assert.equal(record.groupName, 'Rookies');

    const dashboard = await (await server.fetch('/api/dashboard', { headers: { Cookie: teacher.cookie } })).json();
    const rookies = dashboard.groups.find((group) => group.id === 'rookies');
    assert.ok(rookies.members.includes(phone), 'portal group membership follows the student record');
    assert.ok(dashboard.users.some((user) => user.phone === phone && user.role === 'student'), 'a portal account was created');

    // Moving the student to another group moves the portal membership too.
    const moved = await server.fetch(`/api/business/students/${record.id}`, json(teacher.cookie, { groupId: 'tactics' }, 'PATCH'));
    assert.equal(moved.status, 200);
    const after_ = await (await server.fetch('/api/dashboard', { headers: { Cookie: teacher.cookie } })).json();
    assert.ok(!after_.groups.find((group) => group.id === 'rookies').members.includes(phone));
    assert.ok(after_.groups.find((group) => group.id === 'tactics').members.includes(phone));

    const detail = await (await server.fetch(`/api/business/students/${record.id}`, { headers: { Cookie: teacher.cookie } })).json();
    assert.equal(detail.payment.state, 'due_soon', 'a new monthly student is due on their join date');
  });

  it('shows every student file behind a portal phone with its own payment state', async () => {
    const phone = '+972500000666';
    const sibling = (await (await server.fetch('/api/business/students', json(teacher.cookie, { firstName: 'Sib', lastName: 'One', parentName: 'Shared Parent', parentPhone: phone, groupId: 'rookies', price: 250, billingType: 'monthly' }))).json()).student;
    await server.fetch('/api/business/payments', json(teacher.cookie, { studentId: sibling.id, amount: 250, currency: 'ILS', periodLabel: '2026-11' }));
    const second = (await (await server.fetch('/api/business/students', json(teacher.cookie, { firstName: 'Sib', lastName: 'Two', parentName: 'Shared Parent', parentPhone: phone, groupId: 'rookies', price: 250, billingType: 'monthly' }))).json()).student;
    await server.fetch('/api/users', json(teacher.cookie, { role: 'student', phone }));

    // A parent with two children sees both files, each under its own name
    // and with its own state, exactly as the management app shows them.
    let dashboard = await (await server.fetch('/api/dashboard', { headers: { Cookie: teacher.cookie } })).json();
    let account = dashboard.users.find((user) => user.phone === phone);
    assert.equal(account.billing.length, 2);
    const paid = account.billing.find((file) => file.studentId === sibling.id);
    const unpaid = account.billing.find((file) => file.studentId === second.id);
    assert.equal(paid.studentName, 'Sib One');
    assert.equal(paid.state, 'ok');
    assert.equal(paid.lastPaymentAmount, 250);
    assert.equal(unpaid.state, 'due_soon');

    // A single file on the parent phone is that account's file: no extra link step.
    const lonePhone = '+972500000667';
    const lone = (await (await server.fetch('/api/business/students', json(teacher.cookie, { firstName: 'Lone', lastName: 'Child', parentPhone: lonePhone, price: 250, billingType: 'monthly' }))).json()).student;
    await server.fetch('/api/users', json(teacher.cookie, { role: 'student', phone: lonePhone }));
    dashboard = await (await server.fetch('/api/dashboard', { headers: { Cookie: teacher.cookie } })).json();
    const loneAccount = dashboard.users.find((user) => user.phone === lonePhone);
    assert.equal(loneAccount.billing.length, 1);
    assert.equal(loneAccount.billing[0].studentId, lone.id);
    assert.equal(loneAccount.billing[0].state, 'due_soon');

    // A phone with no file at all gets an empty list, which the portal
    // turns into a "create student file" shortcut.
    const nobody = '+972500000668';
    await server.fetch('/api/users', json(teacher.cookie, { role: 'student', phone: nobody }));
    dashboard = await (await server.fetch('/api/dashboard', { headers: { Cookie: teacher.cookie } })).json();
    assert.deepEqual(dashboard.users.find((user) => user.phone === nobody).billing, []);

    // A sign-in phone on a file links it too, once, even when it is also the parent phone.
    await server.fetch(`/api/business/students/${sibling.id}`, json(teacher.cookie, { userPhone: phone }, 'PATCH'));
    dashboard = await (await server.fetch('/api/dashboard', { headers: { Cookie: teacher.cookie } })).json();
    account = dashboard.users.find((user) => user.phone === phone);
    assert.equal(account.billing.length, 2);
    assert.equal(account.billing.filter((file) => file.studentId === sibling.id).length, 1);

    // The same sign-in phone cannot be given to a second student.
    const dupe = await server.fetch('/api/business/students', json(teacher.cookie, { firstName: 'Dupe', userPhone: phone }));
    assert.equal(dupe.status, 409);
  });

  it('rejects a student without a name', async () => {
    const response = await server.fetch('/api/business/students', json(teacher.cookie, { age: 9 }));
    assert.equal(response.status, 400);
  });

  it('logs a lesson and updates the topics every attending student has learned', async () => {
    // Students added to the group by earlier tests joined after this lesson.
    const students = (await (await server.fetch('/api/business/students?groupId=rookies', { headers: { Cookie: teacher.cookie } })).json()).students.filter((entry) => entry.joinedAt <= '2026-10-05');
    assert.ok(students.length >= 2);
    const [present, absent] = students;

    const response = await server.fetch('/api/business/lessons', json(teacher.cookie, {
      date: '2026-10-05', startTime: '17:00', kind: 'group', groupId: 'rookies',
      topic: 'Test topic', topics: ['Test topic', 'Back-rank mate'],
      attendance: { [absent.id]: 'absent' }
    }));
    assert.equal(response.status, 200);
    const { lesson } = await response.json();
    assert.deepEqual(lesson.topics, ['Test topic', 'Back-rank mate']);

    const presentDetail = await (await server.fetch(`/api/business/students/${present.id}`, { headers: { Cookie: teacher.cookie } })).json();
    assert.ok(presentDetail.topics.includes('Back-rank mate'));
    const absentDetail = await (await server.fetch(`/api/business/students/${absent.id}`, { headers: { Cookie: teacher.cookie } })).json();
    assert.ok(!absentDetail.topics.includes('Back-rank mate'), 'an absent student does not inherit the topic');

    const group = (await (await server.fetch('/api/business/groups', { headers: { Cookie: teacher.cookie } })).json()).groups.find((entry) => entry.id === 'rookies');
    assert.ok(group.topicsLearned.includes('Back-rank mate'));
  });

  it('tracks payments: recording one clears an overdue monthly student', async () => {
    const overview = (await (await server.fetch('/api/business/payments', { headers: { Cookie: teacher.cookie } })).json()).overview;
    const overdue = overview.find((entry) => entry.state === 'overdue' && entry.billingType === 'monthly');
    assert.ok(overdue, 'demo data includes an overdue monthly student');

    const paid = await server.fetch('/api/business/payments', json(teacher.cookie, { studentId: overdue.studentId, amount: overdue.price, currency: overdue.currency, method: 'bit', periodLabel: '2026-11' }));
    assert.equal(paid.status, 200);

    const after_ = (await (await server.fetch('/api/business/payments', { headers: { Cookie: teacher.cookie } })).json()).overview.find((entry) => entry.studentId === overdue.studentId);
    assert.equal(after_.state, 'ok');
    assert.ok(after_.nextPaymentAt > after_.lastPaymentAt);
    assert.ok(after_.nextPaymentAt.startsWith('2026-12'), 'a payment for November makes the next one due in December');

    // Arrears for an earlier month must not drag the due date back.
    const arrears = await server.fetch('/api/business/payments', json(teacher.cookie, { studentId: overdue.studentId, amount: overdue.price, currency: overdue.currency, method: 'bank', periodLabel: '2026-09' }));
    assert.equal(arrears.status, 200);
    const afterArrears = (await (await server.fetch('/api/business/payments', { headers: { Cookie: teacher.cookie } })).json()).overview.find((entry) => entry.studentId === overdue.studentId);
    assert.equal(afterArrears.state, 'ok');
    assert.ok(afterArrears.nextPaymentAt.startsWith('2026-12'), 'the latest month covered decides the next due date');

    // A later payment with no month label still counts from its own date.
    const unlabeled = await server.fetch('/api/business/payments', json(teacher.cookie, { studentId: overdue.studentId, amount: overdue.price, currency: overdue.currency, method: 'cash', paidAt: '2026-12-03', periodLabel: '' }));
    assert.equal(unlabeled.status, 200);
    const afterUnlabeled = (await (await server.fetch('/api/business/payments', { headers: { Cookie: teacher.cookie } })).json()).overview.find((entry) => entry.studentId === overdue.studentId);
    assert.equal(afterUnlabeled.state, 'ok');
    assert.ok(afterUnlabeled.nextPaymentAt.startsWith('2027-01'), 'an unlabeled payment pushes the due date past its own month');
  });

  it('refuses a payment for an unknown student', async () => {
    const response = await server.fetch('/api/business/payments', json(teacher.cookie, { studentId: 'nope', amount: 100 }));
    assert.equal(response.status, 404);
  });

  it('moves a prospect through a trial lesson into a student', async () => {
    const created = await (await server.fetch('/api/business/leads', json(teacher.cookie, {
      parentName: 'Lead Parent', parentPhone: '+972500000888', childName: 'Lead Child', childAge: 10, level: 'novice', language: 'he', source: 'facebook', preference: 'group'
    }))).json();
    const lead = created.lead;
    assert.equal(lead.status, 'new');

    const detail = await (await server.fetch(`/api/business/leads/${lead.id}`, { headers: { Cookie: teacher.cookie } })).json();
    assert.ok(Array.isArray(detail.matches) && detail.matches.length > 0, 'matching groups are suggested');

    const trial = await (await server.fetch('/api/business/events', json(teacher.cookie, { kind: 'trial', date: '2026-11-20', startTime: '18:00', durationMinutes: 40, leadId: lead.id, title: 'Trial' }))).json();
    assert.equal(trial.event.kind, 'trial');
    const calendar = await (await server.fetch('/api/business/calendar?from=2026-11-20&to=2026-11-20', { headers: { Cookie: teacher.cookie } })).json();
    assert.ok(calendar.occurrences.some((occurrence) => occurrence.eventId === trial.event.id && occurrence.kind === 'trial'));

    const converted = await server.fetch(`/api/business/leads/${lead.id}/convert`, json(teacher.cookie, { groupId: 'rookies' }));
    assert.equal(converted.status, 200);
    const body = await converted.json();
    assert.equal(body.lead.status, 'converted');
    assert.equal(body.student.firstName, 'Lead');
    assert.equal(body.student.groupId, 'rookies');

    const again = await server.fetch(`/api/business/leads/${lead.id}/convert`, json(teacher.cookie, {}));
    assert.equal(again.status, 409, 'a prospect converts once');
    // A converted lead is a student now, so it leaves the leads list.
    const open = await (await server.fetch('/api/business/leads', { headers: { Cookie: teacher.cookie } })).json();
    assert.ok(!open.leads.some((entry) => entry.id === lead.id));
    // Students have no status to set: whatever is asked for, a student is active.
    const patched = await (await server.fetch(`/api/business/students/${body.student.id}`, json(teacher.cookie, { status: 'waitlist' }, 'PATCH'))).json();
    assert.equal(patched.student.status, 'active');
  });

  it('applies cancellations and reschedules to the calendar', async () => {
    const week = await (await server.fetch('/api/business/calendar?from=2026-11-08&to=2026-11-14', { headers: { Cookie: teacher.cookie } })).json();
    const rookies = week.occurrences.find((occurrence) => occurrence.groupId === 'rookies' && occurrence.kind === 'group');
    assert.ok(rookies, 'the weekly group lesson appears');

    await server.fetch('/api/business/events', json(teacher.cookie, { kind: 'cancel', date: rookies.date, groupId: 'rookies', note: 'holiday' }));
    const afterCancel = await (await server.fetch(`/api/business/calendar?from=${rookies.date}&to=${rookies.date}`, { headers: { Cookie: teacher.cookie } })).json();
    assert.ok(!afterCancel.occurrences.some((occurrence) => occurrence.groupId === 'rookies'), 'cancelled lesson disappears');

    const reschedule = await server.fetch('/api/business/events', json(teacher.cookie, { kind: 'reschedule', date: '2026-11-25', startTime: '18:30', originalDate: '2026-11-23', groupId: 'rookies' }));
    assert.equal(reschedule.status, 200);
    const target = await (await server.fetch('/api/business/calendar?from=2026-11-23&to=2026-11-25', { headers: { Cookie: teacher.cookie } })).json();
    const moved = target.occurrences.filter((occurrence) => occurrence.groupId === 'rookies');
    assert.equal(moved.length, 1);
    assert.equal(moved[0].date, '2026-11-25');
    assert.equal(moved[0].startTime, '18:30');

    const bad = await server.fetch('/api/business/calendar?from=2026-01-01&to=2026-12-31', { headers: { Cookie: teacher.cookie } });
    assert.equal(bad.status, 400);
  });

  it('composes a WhatsApp message from a template and logs it as sent', async () => {
    const students = (await (await server.fetch('/api/business/students?status=active', { headers: { Cookie: teacher.cookie } })).json()).students;
    const target = students.find((entry) => entry.parentPhone);
    const composed = await (await server.fetch('/api/business/messages/compose', json(teacher.cookie, { kind: 'payment_reminder', studentId: target.id }))).json();
    assert.ok(composed.message.body.includes(`${target.parentFirstName},`), 'the parent is greeted by first name');
    assert.ok(!composed.message.body.includes(target.parentName), 'not by full name');
    assert.match(composed.message.whatsappLink, /^https:\/\/wa\.me\/\d+\?text=/);

    const logged = await server.fetch('/api/business/messages', json(teacher.cookie, { kind: 'payment_reminder', studentId: target.id, recipientPhone: target.parentPhone, body: composed.message.body, status: 'sent' }));
    assert.equal(logged.status, 200);
    const detail = await (await server.fetch(`/api/business/students/${target.id}`, { headers: { Cookie: teacher.cookie } })).json();
    assert.equal(detail.messages[0].kind, 'payment_reminder');
    assert.equal(detail.messages[0].status, 'sent');
  });

  it('builds a monthly report with income, expenses and profit in ILS', async () => {
    await server.fetch('/api/business/expenses', json(teacher.cookie, { date: '2026-11-03', category: 'advertising', amount: 100, currency: 'USD' }));
    const report = await (await server.fetch('/api/business/reports?month=2026-11', { headers: { Cookie: teacher.cookie } })).json();
    assert.equal(report.current.month, '2026-11');
    assert.ok(report.current.expenses.byCategory.advertising >= 370, 'USD expenses are converted at the configured rate');
    assert.equal(Math.round((report.current.income.total - report.current.expenses.total) * 100) / 100, report.current.profit);
    assert.equal(report.trend.length, 6);
    assert.equal(report.trend[5].month, '2026-11');
  });

  it('keeps the parent name as first and last, and still accepts one full name', async () => {
    const split = (await (await server.fetch('/api/business/leads', json(teacher.cookie, { parentFirstName: 'Bob', parentLastName: 'Cohen', parentPhone: '+972500000777' }))).json()).lead;
    assert.equal(split.parentName, 'Bob Cohen');
    const legacy = (await (await server.fetch('/api/business/leads', json(teacher.cookie, { parentName: 'Mary Ann Smith', parentPhone: '+972500000778' }))).json()).lead;
    assert.equal(legacy.parentFirstName, 'Mary');
    assert.equal(legacy.parentLastName, 'Ann Smith');
    const edited = (await (await server.fetch(`/api/business/leads/${legacy.id}`, json(teacher.cookie, { parentFirstName: 'Mary Ann', parentLastName: 'Smith' }, 'PATCH'))).json()).lead;
    assert.equal(edited.parentName, 'Mary Ann Smith');
    const renamed = (await (await server.fetch(`/api/business/leads/${split.id}`, json(teacher.cookie, { parentFirstName: 'Robert' }, 'PATCH'))).json()).lead;
    assert.equal(renamed.parentLastName, 'Cohen', 'a partial update keeps the other half');
    assert.equal(renamed.parentName, 'Robert Cohen');
    const composed = await (await server.fetch('/api/business/messages/compose', json(teacher.cookie, { kind: 'followup', leadId: edited.id, lang: 'en' }))).json();
    assert.match(composed.message.body, /^Hi Mary Ann, /);
    assert.equal(composed.message.recipientName, 'Mary Ann Smith');
  });

  it('persists settings and uses them when composing', async () => {
    const updated = await server.fetch('/api/business/settings', json(teacher.cookie, { teacherName: 'Coach Test', templates: { custom: { he: 'שלום {parentName}, {notes} — {teacherName}' } } }, 'PUT'));
    assert.equal(updated.status, 200);
    const settings = (await updated.json()).settings;
    assert.equal(settings.teacherName, 'Coach Test');

    const lead = (await (await server.fetch('/api/business/leads', { headers: { Cookie: teacher.cookie } })).json()).leads.find((entry) => entry.parentPhone && entry.language === 'he');
    const composed = await (await server.fetch('/api/business/messages/compose', json(teacher.cookie, { kind: 'custom', leadId: lead.id, lang: 'he', values: { notes: 'בדיקה' } }))).json();
    assert.equal(composed.message.body, `שלום ${lead.parentFirstName}, בדיקה — Coach Test`);
  });

  it('gives every group the capacity from settings, ignoring any per-group value', async () => {
    const groupsNow = async () => (await (await server.fetch('/api/business/groups', { headers: { Cookie: teacher.cookie } })).json()).groups;
    const saved = await server.fetch('/api/business/groups/rookies/profile', json(teacher.cookie, { maxStudents: 2 }, 'PATCH'));
    assert.equal(saved.status, 200);
    assert.ok((await groupsNow()).every((group) => group.seatsTotal === 5));

    await server.fetch('/api/business/settings', json(teacher.cookie, { maxGroupSize: 7 }, 'PUT'));
    const groups = await groupsNow();
    assert.ok(groups.every((group) => group.seatsTotal === 7 && group.seatsFree === Math.max(0, 7 - group.studentCount)));
    assert.ok(groups.every((group) => !('maxStudents' in group.profile)));
    await server.fetch('/api/business/settings', json(teacher.cookie, { maxGroupSize: 5 }, 'PUT'));
  });

  it('keeps a teachers list, and renames or unassigns a teacher everywhere it is used', async () => {
    const list = async () => (await (await server.fetch('/api/business/teachers', { headers: { Cookie: teacher.cookie } })).json()).teachers;
    const profileOf = async (id) => (await (await server.fetch('/api/business/groups', { headers: { Cookie: teacher.cookie } })).json()).groups.find((group) => group.id === id).profile;
    assert.ok((await list()).some((entry) => entry.name === 'דולב'));

    const created = await (await server.fetch('/api/business/teachers', json(teacher.cookie, { name: 'Maya', phone: '050-1234567' }))).json();
    assert.equal(created.teacher.phone, '+972501234567');
    assert.equal((await server.fetch('/api/business/teachers', json(teacher.cookie, { name: 'maya' }))).status, 409);
    assert.equal((await server.fetch('/api/business/teachers', json(teacher.cookie, { name: '  ' }))).status, 400);
    // A phone that cannot be a phone is refused rather than dropped, and two teachers cannot share one.
    assert.equal((await server.fetch('/api/business/teachers', json(teacher.cookie, { name: 'Typo', phone: '050-12' }))).status, 400);
    assert.equal((await server.fetch('/api/business/teachers', json(teacher.cookie, { name: 'Twin', phone: '+972 50 123 4567' }))).status, 409);
    assert.equal((await server.fetch(`/api/business/teachers/${created.teacher.id}`, json(teacher.cookie, { phone: 'call me' }, 'PATCH'))).status, 400);

    await server.fetch('/api/business/groups/rookies/profile', json(teacher.cookie, { teacher: 'Maya' }, 'PATCH'));
    const renamed = await server.fetch(`/api/business/teachers/${created.teacher.id}`, json(teacher.cookie, { name: 'Maya Cohen' }, 'PATCH'));
    assert.equal(renamed.status, 200);
    assert.equal((await profileOf('rookies')).teacher, 'Maya Cohen');
    assert.equal((await list()).find((entry) => entry.id === created.teacher.id).groupCount, 1);

    const dolev = (await list()).find((entry) => entry.name === 'דולב');
    await server.fetch('/api/business/settings', json(teacher.cookie, { teacherName: 'דולב' }, 'PUT'));
    await server.fetch(`/api/business/teachers/${dolev.id}`, json(teacher.cookie, { name: 'דולב ש' }, 'PATCH'));
    const settings = (await (await server.fetch('/api/business/settings', { headers: { Cookie: teacher.cookie } })).json()).settings;
    assert.equal(settings.teacherName, 'דולב ש');
    await server.fetch(`/api/business/teachers/${dolev.id}`, json(teacher.cookie, { name: 'דולב' }, 'PATCH'));

    const removed = await server.fetch(`/api/business/teachers/${created.teacher.id}`, { method: 'DELETE', headers: { Cookie: teacher.cookie } });
    assert.equal(removed.status, 200);
    assert.equal((await profileOf('rookies')).teacher, '');
    assert.ok(!(await list()).some((entry) => entry.id === created.teacher.id));

    // A new lesson cannot bring a removed teacher back.
    const lesson = await (await server.fetch('/api/business/lessons', json(teacher.cookie, { date: '2026-11-01', groupId: 'rookies', teacher: 'Maya Cohen', topic: 'Forks' }))).json();
    assert.notEqual(lesson.lesson.teacher, 'Maya Cohen');
    assert.ok(lesson.lesson.teacher === '' || (await list()).some((entry) => entry.name === lesson.lesson.teacher));
    // An edit keeps the lesson's teacher unless a listed one is asked for.
    const lessonUrl = `/api/business/lessons/${lesson.lesson.id}`;
    const original = lesson.lesson.teacher;
    assert.equal((await (await server.fetch(lessonUrl, json(teacher.cookie, { topic: 'Pins' }, 'PATCH'))).json()).lesson.teacher, original);
    assert.equal((await (await server.fetch(lessonUrl, json(teacher.cookie, { teacher: 'Nobody' }, 'PATCH'))).json()).lesson.teacher, original);
    await server.fetch(lessonUrl, { method: 'DELETE', headers: { Cookie: teacher.cookie } });
  });

  it('shows a teacher their lessons and the month\'s pay at their hourly rate', async () => {
    const get = async (url) => (await server.fetch(url, { headers: { Cookie: teacher.cookie } })).json();
    const created = (await (await server.fetch('/api/business/teachers', json(teacher.cookie, { name: 'Rate Test', hourlyRate: 120, currency: 'usd' }))).json()).teacher;
    assert.equal(created.hourlyRate, 120);
    assert.equal(created.currency, 'USD');

    const lessonIds = [];
    for (const [date, durationMinutes, status] of [['2026-09-03', 90, 'held'], ['2026-09-10', 45, 'held'], ['2026-09-17', 60, 'cancelled'], ['2026-08-20', 60, 'held']]) {
      const lesson = (await (await server.fetch('/api/business/lessons', json(teacher.cookie, { date, durationMinutes, status, groupId: 'rookies', teacher: 'Rate Test', topic: 'Pay' }))).json()).lesson;
      lessonIds.push(lesson.id);
    }

    const september = await get(`/api/business/teachers/${created.id}?month=2026-09`);
    assert.equal(september.lessons.length, 3, 'the month lists cancelled lessons too');
    assert.deepEqual(september.pay.earned, { lessons: 2, minutes: 135, amount: 270 }, 'held lessons only, by their length');
    assert.equal(september.upcoming.length, 0, 'a past month has nothing still to come');
    assert.deepEqual(september.history.map((row) => [row.month, row.amount]), [['2026-09', 270], ['2026-08', 120]]);
    assert.equal(september.totals.amount, 390);

    // Without a rate the hours are still counted but no amount is made up.
    await server.fetch(`/api/business/teachers/${created.id}`, json(teacher.cookie, { hourlyRate: null }, 'PATCH'));
    const unpriced = await get(`/api/business/teachers/${created.id}?month=2026-09`);
    assert.equal(unpriced.pay.earned.minutes, 135);
    assert.equal(unpriced.pay.earned.amount, null);

    // A private lesson is credited to the student's teacher, not the default one.
    await server.fetch(`/api/business/teachers/${created.id}`, json(teacher.cookie, { hourlyRate: 120 }, 'PATCH'));
    const pupil = (await (await server.fetch('/api/business/students', json(teacher.cookie, { firstName: 'Pay', lastName: 'Pupil', lessonType: 'private', teacher: 'Rate Test' }))).json()).student;
    const privateLesson = (await (await server.fetch('/api/business/lessons', json(teacher.cookie, { date: '2026-09-24', durationMinutes: 30, kind: 'private', studentIds: [pupil.id], topic: 'Mates' }))).json()).lesson;
    lessonIds.push(privateLesson.id);
    assert.equal(privateLesson.teacher, 'Rate Test');
    assert.equal((await get(`/api/business/teachers/${created.id}?month=2026-09`)).pay.earned.minutes, 165);
    await server.fetch(`/api/business/students/${pupil.id}`, { method: 'DELETE', headers: { Cookie: teacher.cookie } });

    // A group with no teacher is taught by the default teacher, so its
    // coming lessons count toward the default teacher's month.
    const settings = (await get('/api/business/settings')).settings;
    const owner = (await get('/api/business/teachers')).teachers.find((entry) => entry.name === settings.teacherName);
    const groups = (await get('/api/business/groups')).groups;
    const unassigned = groups.find((group) => group.schedule.length && group.profile.status !== 'closed');
    const previousTeacher = unassigned.profile.teacher;
    await server.fetch(`/api/business/groups/${unassigned.id}/profile`, json(teacher.cookie, { teacher: '' }, 'PATCH'));
    const ownerPage = await get(`/api/business/teachers/${owner.id}`);
    assert.ok([...ownerPage.upcoming, ...ownerPage.unlogged].some((occurrence) => occurrence.groupId === unassigned.id), 'an unassigned group shows on the default teacher\'s page');
    await server.fetch(`/api/business/groups/${unassigned.id}/profile`, json(teacher.cookie, { teacher: previousTeacher }, 'PATCH'));

    assert.equal((await server.fetch('/api/business/teachers/nope', { headers: { Cookie: teacher.cookie } })).status, 404);
    for (const id of lessonIds) await server.fetch(`/api/business/lessons/${id}`, { method: 'DELETE', headers: { Cookie: teacher.cookie } });
    await server.fetch(`/api/business/teachers/${created.id}`, { method: 'DELETE', headers: { Cookie: teacher.cookie } });
  });

  it('imports every game from a PGN file as a content item', async () => {
    const pgn = `[Event "London"]
[White "Edward Lasker"]
[Black "George Thomas"]
[Date "1912.10.29"]
[Result "1-0"]

1. d4 e6 2. Nf3 f5 3. Nc3 Nf6 4. Bg5 Be7 5. Bxf6 Bxf6 6. e4 fxe4 7. Nxe4 b6 8. Ne5 O-O 9. Bd3 Bb7 10. Qh5 Qe7 11. Qxh7+ Kxh7 12. Nxf6+ Kh6 13. Neg4+ Kg5 14. h4+ Kf4 15. g3+ Kf3 16. Be2+ Kg2 17. Rh2+ Kg1 18. Kd2# 1-0

[Event "Paris"]
[White "Paul Morphy"]
[Black "Duke Karl"]
[Result "1-0"]

1.e4 e5 2.Nf3 d6 3.d4 Bg4 {pin} 4.dxe5 Bxf3 5.Qxf3 dxe5 6.Bc4 Nf6 7.Qb3 Qe7 8.Nc3 c6 9.Bg5 b5 10.Nxb5 cxb5 11.Bxb5+ Nbd7 12.O-O-O Rd8 13.Rxd7 Rxd7 14.Rd1 Qe6 15.Bxd7+ Nxd7 16.Qb8+ Nxb8 17.Rd8# 1-0
`;
    const response = await server.fetch('/api/business/content/import-pgn', json(teacher.cookie, { fileName: 'classics.pgn', pgn }));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.imported, 2);
    assert.equal(body.items[0].white, 'Edward Lasker');
    assert.equal(body.items[0].result, '1-0');
    assert.equal(body.items[0].movesCount, 35);
    assert.equal(body.items[1].title, 'Paul Morphy – Duke Karl, Paris');
    assert.equal(body.items[1].sourceFile, 'classics.pgn');

    const games = (await (await server.fetch('/api/business/content?kind=game', { headers: { Cookie: teacher.cookie } })).json()).content;
    assert.ok(games.some((item) => item.id === body.items[1].id && item.pgn.includes('17.Rd8#')));

    const emptyFile = await server.fetch('/api/business/content/import-pgn', json(teacher.cookie, { fileName: 'empty.pgn', pgn: '   ' }));
    assert.equal(emptyFile.status, 400);

    // Nested variations, line comments and a FEN start position.
    const annotated = `[Event "Study"]
[SetUp "1"]
[FEN "8/8/8/8/8/4k3/4p3/4K3 b - - 0 1"]

1... Kd3 ; a line comment runs to the end of the line
2. Kf2 (2. Kd1 e1=Q+ (2... Kd2) 3. Kxe1) 2... e1=Q+ 3. Kxe1 Kd2 *
`;
    const study = await (await server.fetch('/api/business/content/import-pgn', json(teacher.cookie, { fileName: 'study.pgn', pgn: annotated }))).json();
    assert.equal(study.imported, 1);
    assert.equal(study.items[0].movesCount, 5, 'variations and comments are not counted as moves');

    const awkward = `[Event "Comments"]

1. e4 {best; by far} e5 ; and now { not a comment
2. Nf3 $1 Nc6 3. Bb5 (3. Bc4 {Italian; also good}) a6 1/2-1/2
`;
    const parsed = await (await server.fetch('/api/business/content/import-pgn', json(teacher.cookie, { fileName: 'comments.pgn', pgn: awkward }))).json();
    assert.equal(parsed.items[0].movesCount, 6, 'a ";" inside braces and a "{" inside a line comment are both just comment text');
    assert.equal(study.items[0].fen, '8/8/8/8/8/4k3/4p3/4K3 b - - 0 1');
  });

  it('links lessons to games in the list: renames follow, deletions are remembered', async () => {
    const game = (await (await server.fetch('/api/business/content/import-pgn', json(teacher.cookie, { fileName: 'one.pgn', pgn: '[White "Greco"]\n[Black "NN"]\n\n1. e4 e5 2. Nf3 *' }))).json()).items[0];
    const created = await server.fetch('/api/business/lessons', json(teacher.cookie, { date: '2026-10-12', groupId: 'rookies', topic: 'Italian', gameRefs: [{ id: game.id }] }));
    assert.equal(created.status, 200);
    const { lesson } = await created.json();
    assert.deepEqual(lesson.gamesResolved.map((entry) => [entry.title, entry.exists]), [[game.title, true]]);

    const byGame = async () => (await (await server.fetch(`/api/business/lessons?gameId=${game.id}`, { headers: { Cookie: teacher.cookie } })).json()).lessons;
    assert.deepEqual((await byGame()).map((entry) => entry.id), [lesson.id], 'a game lists the lessons that used it');

    await server.fetch(`/api/business/content/${game.id}`, json(teacher.cookie, { title: 'Greco – NN, renamed' }, 'PATCH'));
    const groupLessons = (await (await server.fetch('/api/business/lessons?groupId=rookies', { headers: { Cookie: teacher.cookie } })).json()).lessons;
    assert.equal(groupLessons.find((entry) => entry.id === lesson.id).gamesResolved[0].title, 'Greco – NN, renamed', 'a rename shows on past lessons');

    await server.fetch(`/api/business/content/${game.id}`, { method: 'DELETE', headers: { Cookie: teacher.cookie } });
    const [afterDelete] = await byGame();
    assert.equal(afterDelete.gamesResolved[0].exists, false);
    assert.equal(afterDelete.gamesResolved[0].title, 'Greco – NN, renamed', 'a deleted game is remembered by its last name');

    // Re-saving the lesson keeps the reference to the deleted game.
    const resaved = await (await server.fetch(`/api/business/lessons/${lesson.id}`, json(teacher.cookie, { topic: 'Italian (edited)', gameRefs: afterDelete.gamesResolved }, 'PATCH'))).json();
    assert.equal(resaved.lesson.gamesResolved[0].title, 'Greco – NN, renamed');

    // Sending only the id, or a different name, cannot erase or rewrite it.
    const idOnly = await (await server.fetch(`/api/business/lessons/${lesson.id}`, json(teacher.cookie, { gameRefs: [game.id] }, 'PATCH'))).json();
    assert.equal(idOnly.lesson.gamesResolved[0].title, 'Greco – NN, renamed', 'an id-only save keeps the remembered name');
    const renamedByClient = await (await server.fetch(`/api/business/lessons/${lesson.id}`, json(teacher.cookie, { gameRefs: [{ id: game.id, title: 'Something else' }] }, 'PATCH'))).json();
    assert.equal(renamedByClient.lesson.gamesResolved[0].title, 'Greco – NN, renamed', 'the client cannot rename a deleted game');

    // An edit that does not mention games leaves them alone.
    const untouched = await (await server.fetch(`/api/business/lessons/${lesson.id}`, json(teacher.cookie, { homework: 'Play the Italian' }, 'PATCH'))).json();
    assert.equal(untouched.lesson.gamesResolved.length, 1);
  });

  it('keeps a group lesson on each student who was in it, and suggests games none of them has seen', async () => {
    const get = async (path) => (await server.fetch(`/api/business${path}`, { headers: { Cookie: teacher.cookie } })).json();
    const game = (await (await server.fetch('/api/business/content/import-pgn', json(teacher.cookie, { fileName: 'roster.pgn', pgn: '[White "Morphy"]\n[Black "Duke"]\n\n1. e4 e5 *' }))).json()).items[0];
    const rookies = (await get('/students?groupId=rookies')).students.filter((entry) => entry.joinedAt <= '2026-10-19');
    const [mover] = rookies;
    const created = await (await server.fetch('/api/business/lessons', json(teacher.cookie, { date: '2026-10-19', kind: 'group', groupId: 'rookies', topic: 'Opera game', gameRefs: [{ id: game.id }] }))).json();
    assert.deepEqual([...created.lesson.studentIds].sort(), rookies.map((entry) => entry.id).sort(), 'a group lesson records who was in the group');

    // Editing a group lesson from the form sends no students; the roster stays.
    const edited = await (await server.fetch(`/api/business/lessons/${created.lesson.id}`, json(teacher.cookie, { homework: 'Replay it', studentIds: [] }, 'PATCH'))).json();
    assert.deepEqual([...edited.lesson.studentIds].sort(), rookies.map((entry) => entry.id).sort());

    const tacticsBefore = (await get('/lessons?groupId=tactics')).lessons.map((lesson) => lesson.id);
    assert.ok(tacticsBefore.length, 'demo data has a tactics lesson');
    await server.fetch(`/api/business/students/${mover.id}`, json(teacher.cookie, { groupId: 'tactics' }, 'PATCH'));

    const moved = await get(`/students/${mover.id}`);
    assert.ok(moved.lessons.some((lesson) => lesson.id === created.lesson.id), 'the old group\'s lesson stays on the student who moved');
    assert.ok(moved.games.some((entry) => entry.id === game.id), 'and so does the game they saw');
    assert.ok(!moved.lessons.some((lesson) => tacticsBefore.includes(lesson.id)), 'the new group\'s past lessons are not theirs');
    assert.ok((await get(`/lessons?studentId=${mover.id}`)).lessons.some((lesson) => lesson.id === created.lesson.id));

    // A tactics summary logged late, for a date before the move, is not theirs,
    // and an attendance mark for someone outside the group is dropped.
    const late = await (await server.fetch('/api/business/lessons', json(teacher.cookie, { date: '2026-10-20', kind: 'group', groupId: 'tactics', topic: 'Logged late', attendance: { [mover.id]: 'present', [rookies[1].id]: 'present' } }))).json();
    assert.ok(!late.lesson.studentIds.includes(mover.id), 'a student who joined the group after the lesson is not on it');
    assert.ok(!late.lesson.studentIds.includes(rookies[1].id), 'nor is a student from another group');
    assert.deepEqual(late.lesson.attendance, {});
    assert.ok(!(await get(`/students/${mover.id}`)).lessons.some((lesson) => lesson.id === late.lesson.id));

    // The form sends the roster the teacher ticked, so a rookies summary logged
    // late can include the student who has left the group since.
    const ticked = await (await server.fetch('/api/business/lessons', json(teacher.cookie, { date: '2026-10-26', kind: 'group', groupId: 'rookies', topic: 'Before the move', studentIds: rookies.map((entry) => entry.id), attendance: { [mover.id]: 'present' } }))).json();
    assert.ok(ticked.lesson.studentIds.includes(mover.id));
    assert.deepEqual(ticked.lesson.attendance, { [mover.id]: 'present' });
    assert.ok((await get(`/students/${mover.id}`)).lessons.some((lesson) => lesson.id === ticked.lesson.id));

    // The tactics group's next lesson now includes the student who moved, who
    // has seen the new game, so the suggestion is one nobody there has seen.
    const calendar = await get('/calendar?from=2026-11-08&to=2026-11-14');
    const next = calendar.occurrences.find((occurrence) => occurrence.groupId === 'tactics');
    assert.ok(next.studentIds.includes(mover.id));
    assert.ok(next.suggestedGame, 'an upcoming lesson suggests a game');
    assert.equal(next.suggestedGame.seenBy, 0);
    assert.notEqual(next.suggestedGame.id, game.id);
  });

  it('suggests the game the fewest students have seen when all have been shown', async () => {
    const { suggestGame } = await import('../lib/business.mjs');
    const games = [{ id: 'a', title: 'A' }, { id: 'b', title: 'B', level: 'beginner' }, { id: 'c', title: 'C' }];
    const seen = { s1: new Set(['a', 'b', 'c']), s2: new Set(['a', 'b']), s3: new Set(['a']) };
    assert.deepEqual(suggestGame(['s1', 's2', 's3'], games, seen), { id: 'c', title: 'C', seenBy: 1, of: 3 });
    assert.equal(suggestGame(['s3'], games, seen, { level: 'beginner' }).id, 'b', 'a tie goes to the group\'s level');
    assert.equal(suggestGame(['s3'], games, seen, { usage: { b: 4 } }).id, 'c', 'then to the game used least');
    assert.equal(suggestGame(['s1'], [], seen), null);
  });

  it('rejects malformed JSON and unknown routes cleanly', async () => {
    const malformed = await server.fetch('/api/business/students', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: teacher.cookie }, body: '{' });
    assert.equal(malformed.status, 400);
    const unknown = await server.fetch('/api/business/nothing', { headers: { Cookie: teacher.cookie } });
    assert.equal(unknown.status, 404);
  });
});

// A teacher record with a phone is a sign-in. The teacher sees their own
// groups, students, lessons and pay; the rest of the school stays with the
// admin.
describe('teacher accounts', () => {
  let server;
  let admin;
  let teacher;
  let teacherRecord;
  const NAME = 'Rina Test';
  const PHONE = '+972500000611';

  const get = async (cookie, path) => {
    const response = await server.fetch(`/api/business${path}`, { headers: { Cookie: cookie } });
    return { status: response.status, body: await response.json() };
  };
  const send = async (cookie, path, body, method = 'POST') => {
    const response = await server.fetch(`/api/business${path}`, json(cookie, body, method));
    return { status: response.status, body: await response.json() };
  };

  before(async () => {
    server = await startServer(devEnv);
    admin = await signIn(server, TEACHER);
    teacherRecord = (await send(admin.cookie, '/teachers', { name: NAME, phone: '050-000-0611', hourlyRate: 100 })).body.teacher;
    await send(admin.cookie, '/groups/tactics/profile', { teacher: NAME }, 'PATCH');
    teacher = await signIn(server, PHONE);
  });
  after(async () => { await server.stop(); });

  it('gives a new teacher a sign-in with the teacher role', async () => {
    const me = await (await server.fetch('/api/me', { headers: { Cookie: teacher.cookie } })).json();
    assert.equal(me.user.role, 'teacher');
    assert.equal(me.user.canUseManagement, true);
    assert.equal(me.user.canManageUsers, false);
    assert.equal(me.user.firstName, 'Rina');

    const adminMe = await (await server.fetch('/api/me', { headers: { Cookie: admin.cookie } })).json();
    assert.equal(adminMe.user.role, 'admin');
  });

  it('counts a teacher\'s group students as their students', async () => {
    const inGroup = (await get(admin.cookie, '/students')).body.students.filter((entry) => entry.groupId === 'tactics');
    const row = (await get(admin.cookie, '/teachers')).body.teachers.find((entry) => entry.id === teacherRecord.id);
    assert.ok(inGroup.length > 0);
    assert.equal(row.studentCount, inGroup.length);
    assert.equal(row.assignedStudentCount, 0, 'none are assigned to them directly');
  });

  it('shows a teacher only their own groups and students, without prices', async () => {
    const groups = (await get(teacher.cookie, '/groups')).body.groups;
    assert.deepEqual(groups.map((group) => group.id), ['tactics']);
    assert.equal('price' in groups[0].profile, false);

    const students = (await get(teacher.cookie, '/students')).body.students;
    assert.ok(students.length > 0);
    for (const student of students) {
      assert.equal(student.groupId, 'tactics');
      assert.equal('price' in student, false);
      assert.equal('paymentState' in student, false);
    }

    const everyone = (await get(admin.cookie, '/students')).body.students;
    const outsider = everyone.find((student) => student.groupId === 'rookies');
    assert.equal((await get(teacher.cookie, `/students/${outsider.id}`)).status, 404);
    const own = await get(teacher.cookie, `/students/${students[0].id}`);
    assert.equal(own.status, 200);
    assert.equal(own.body.payments, undefined);
    assert.equal(own.body.payment, undefined);

    const portal = await (await server.fetch('/api/dashboard', { headers: { Cookie: teacher.cookie } })).json();
    assert.deepEqual(portal.groups.map((group) => group.id), ['tactics']);
    assert.deepEqual(portal.users, []);
    assert.equal(portal.canManageGroups, false);
  });

  it('keeps payments, prospects, reports and changes to the school with the admin', async () => {
    for (const path of ['/payments', '/leads', '/reports', '/expenses']) {
      assert.equal((await get(teacher.cookie, path)).status, 403, path);
    }
    assert.equal((await send(teacher.cookie, '/settings', { teacherName: 'x' }, 'PUT')).status, 403);
    assert.equal((await send(teacher.cookie, '/students', { firstName: 'Nope' })).status, 403);
    assert.equal((await send(teacher.cookie, '/teachers', { name: 'Nope' })).status, 403);
    assert.equal((await send(teacher.cookie, '/groups/tactics/profile', { teacher: '' }, 'PATCH')).status, 403);
    const create = await server.fetch('/api/groups', json(teacher.cookie, { title: 'Not allowed' }));
    assert.equal(create.status, 403);

    const settings = (await get(teacher.cookie, '/settings')).body;
    assert.equal(settings.settings.defaultGroupPrice, undefined);
    assert.ok(!settings.vocabulary.messageKinds.includes('payment_reminder'));

    const teachers = (await get(teacher.cookie, '/teachers')).body.teachers;
    assert.deepEqual(teachers.map((entry) => entry.id), [teacherRecord.id]);
    const others = (await get(admin.cookie, '/teachers')).body.teachers.filter((entry) => entry.id !== teacherRecord.id);
    assert.equal((await get(teacher.cookie, `/teachers/${others[0].id}`)).status, 404);
    assert.equal((await get(teacher.cookie, `/teachers/${teacherRecord.id}`)).status, 200);
  });

  it('lets a teacher log and edit only their own lessons, credited to them', async () => {
    const rookies = await send(teacher.cookie, '/lessons', { groupId: 'rookies', date: '2026-11-01', topic: 'Not mine' });
    assert.equal(rookies.status, 403);

    const logged = await send(teacher.cookie, '/lessons', { groupId: 'tactics', date: '2026-11-01', startTime: '18:30', topic: 'Pins', teacher: 'דולב' });
    assert.equal(logged.status, 200);
    assert.equal(logged.body.lesson.teacher, NAME, 'a teacher always logs as themselves');
    const edited = await send(teacher.cookie, `/lessons/${logged.body.lesson.id}`, { topic: 'Pins and skewers' }, 'PATCH');
    assert.equal(edited.status, 200);
    assert.equal(edited.body.lesson.teacher, NAME);
    assert.equal((await server.fetch(`/api/business/lessons/${logged.body.lesson.id}`, { method: 'DELETE', headers: { Cookie: teacher.cookie } })).status, 403);

    const byAdmin = await send(admin.cookie, '/lessons', { groupId: 'tactics', date: '2026-10-25', topic: 'Given by the owner', teacher: 'דולב' });
    assert.equal((await send(teacher.cookie, `/lessons/${byAdmin.body.lesson.id}`, { topic: 'Mine now' }, 'PATCH')).status, 403);

    const lessons = (await get(teacher.cookie, '/lessons')).body.lessons;
    assert.ok(lessons.every((lesson) => lesson.groupId === 'tactics' || lesson.teacher === NAME));

    const calendar = (await get(teacher.cookie, '/calendar?from=2026-11-08&to=2026-11-14')).body;
    assert.ok(calendar.occurrences.length > 0);
    assert.ok(calendar.occurrences.every((occurrence) => occurrence.teacher === NAME), 'only the lessons the teacher gives');
  });

  it('lets a teacher message their own families about lessons only, under their name', async () => {
    const student = (await get(teacher.cookie, '/students')).body.students[0];
    const summary = await send(teacher.cookie, '/messages/compose', { kind: 'progress', studentId: student.id, values: { notes: 'Great week' } });
    assert.equal(summary.status, 200);
    assert.match(summary.body.message.body, /Rina Test/);
    assert.equal((await send(teacher.cookie, '/messages/compose', { kind: 'payment_reminder', studentId: student.id })).status, 403);

    const outsider = (await get(admin.cookie, '/students')).body.students.find((entry) => entry.groupId === 'rookies');
    assert.equal((await send(teacher.cookie, '/messages/compose', { kind: 'progress', studentId: outsider.id })).status, 403);
    assert.equal((await send(teacher.cookie, '/messages', { kind: 'progress', studentId: outsider.id, body: 'Hi' })).status, 403);
  });

  it('keeps other groups\' students off a teacher\'s lesson roster', async () => {
    const everyone = (await get(admin.cookie, '/students')).body.students;
    const outsider = everyone.find((entry) => entry.groupId === 'rookies');
    const own = everyone.find((entry) => entry.groupId === 'tactics');
    const before = (await get(admin.cookie, `/students/${outsider.id}`)).body.topics;

    const sneaky = await send(teacher.cookie, '/lessons', { groupId: 'tactics', date: '2026-11-02', topic: 'Roster', topics: ['Sneaky topic'], studentIds: [own.id, outsider.id], attendance: { [outsider.id]: 'present' } });
    assert.equal(sneaky.status, 403);

    const logged = await send(teacher.cookie, '/lessons', { groupId: 'tactics', date: '2026-11-02', topic: 'Roster', studentIds: [own.id] });
    assert.equal(logged.status, 200);
    const widened = await send(teacher.cookie, `/lessons/${logged.body.lesson.id}`, { studentIds: [own.id, outsider.id], topics: ['Sneaky topic'] }, 'PATCH');
    assert.equal(widened.status, 403);
    assert.deepEqual((await get(admin.cookie, `/students/${outsider.id}`)).body.topics, before, 'nothing was written to the other student');
  });

  it('composes a teacher\'s message only from a lesson they give', async () => {
    const zoom = 'https://zoom.us/j/rookies-only';
    assert.equal((await server.fetch('/api/groups/rookies/zoom-link', json(admin.cookie, { zoomLink: zoom }))).status, 200);
    const calendar = (await get(admin.cookie, '/calendar?from=2026-11-08&to=2026-11-14')).body;
    const rookies = calendar.occurrences.find((occurrence) => occurrence.groupId === 'rookies');
    const own = (await get(teacher.cookie, '/students')).body.students[0];

    const composed = await send(teacher.cookie, '/messages/compose', { kind: 'lesson_reminder', studentId: own.id, occurrenceKey: rookies.key });
    assert.equal(composed.status, 200);
    assert.ok(!composed.body.message.body.includes(zoom), 'another group\'s Zoom link must not leak');
  });

  it('refuses a teacher phone that already signs in a student', async () => {
    const clash = await send(admin.cookie, '/teachers', { name: 'Clash Teacher', phone: STUDENT });
    assert.equal(clash.status, 409);
    const names = (await get(admin.cookie, '/teachers')).body.teachers.map((entry) => entry.name);
    assert.ok(!names.includes('Clash Teacher'));
    const student = await signIn(server, STUDENT);
    const me = await (await server.fetch('/api/me', { headers: { Cookie: student.cookie } })).json();
    assert.equal(me.user.role, 'student');
  });

  it('moves the sign-in with a new phone and closes it when the teacher is removed', async () => {
    const moved = await send(admin.cookie, `/teachers/${teacherRecord.id}`, { phone: '+972500000612' }, 'PATCH');
    assert.equal(moved.status, 200);
    assert.equal((await server.fetch('/api/me', { headers: { Cookie: teacher.cookie } })).status, 401, 'the old number is signed out');
    const again = await signIn(server, '+972500000612');
    assert.equal((await get(again.cookie, '/groups')).status, 200);

    const removed = await server.fetch(`/api/business/teachers/${teacherRecord.id}`, { method: 'DELETE', headers: { Cookie: admin.cookie } });
    assert.equal(removed.status, 200);
    assert.equal((await server.fetch('/api/me', { headers: { Cookie: again.cookie } })).status, 401, 'a removed teacher is signed out');
    const login = await server.fetch('/api/login', json('', { phone: '+972500000612' }));
    assert.equal(login.status, 403, 'and cannot sign in again');
  });
});
