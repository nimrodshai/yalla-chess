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

  it('shows portal accounts only their own payment state', async () => {
    const phone = '+972500000666';
    const sibling = (await (await server.fetch('/api/business/students', json(teacher.cookie, { firstName: 'Sib', lastName: 'One', parentName: 'Shared Parent', parentPhone: phone, groupId: 'rookies', price: 250, billingType: 'monthly' }))).json()).student;
    await server.fetch('/api/business/payments', json(teacher.cookie, { studentId: sibling.id, amount: 250, currency: 'ILS', periodLabel: '2026-11' }));
    await server.fetch('/api/business/students', json(teacher.cookie, { firstName: 'Sib', lastName: 'Two', parentName: 'Shared Parent', parentPhone: phone, groupId: 'rookies', price: 250, billingType: 'monthly' }));
    await server.fetch('/api/users', json(teacher.cookie, { role: 'student', phone }));

    let dashboard = await (await server.fetch('/api/dashboard', { headers: { Cookie: teacher.cookie } })).json();
    let account = dashboard.users.find((user) => user.phone === phone);
    assert.equal(account.billing, null, 'two students on one parent phone: neither status is shown');

    // A single student on the parent phone is only suggested, never shown as that account's status.
    const lonePhone = '+972500000667';
    const lone = (await (await server.fetch('/api/business/students', json(teacher.cookie, { firstName: 'Lone', lastName: 'Child', parentPhone: lonePhone, price: 250, billingType: 'monthly' }))).json()).student;
    await server.fetch('/api/users', json(teacher.cookie, { role: 'student', phone: lonePhone }));
    dashboard = await (await server.fetch('/api/dashboard', { headers: { Cookie: teacher.cookie } })).json();
    const loneAccount = dashboard.users.find((user) => user.phone === lonePhone);
    assert.equal(loneAccount.billing.linked, false);
    assert.equal(loneAccount.billing.studentId, lone.id);
    assert.equal(loneAccount.billing.state, undefined, 'no payment state until the account is explicitly linked');

    // An explicit sign-in phone on one of them links the account to that student.
    await server.fetch(`/api/business/students/${sibling.id}`, json(teacher.cookie, { userPhone: phone }, 'PATCH'));
    dashboard = await (await server.fetch('/api/dashboard', { headers: { Cookie: teacher.cookie } })).json();
    account = dashboard.users.find((user) => user.phone === phone);
    assert.equal(account.billing.linked, true);
    assert.equal(account.billing.studentId, sibling.id);
    assert.equal(account.billing.state, 'ok');

    // The same sign-in phone cannot be given to a second student.
    const dupe = await server.fetch('/api/business/students', json(teacher.cookie, { firstName: 'Dupe', userPhone: phone }));
    assert.equal(dupe.status, 409);
  });

  it('rejects a student without a name', async () => {
    const response = await server.fetch('/api/business/students', json(teacher.cookie, { age: 9 }));
    assert.equal(response.status, 400);
  });

  it('logs a lesson and updates the topics every attending student has learned', async () => {
    const students = (await (await server.fetch('/api/business/students?groupId=rookies', { headers: { Cookie: teacher.cookie } })).json()).students;
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
    assert.ok(composed.message.body.includes(target.parentName), 'the parent name is filled in');
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

  it('persists settings and uses them when composing', async () => {
    const updated = await server.fetch('/api/business/settings', json(teacher.cookie, { teacherName: 'Coach Test', templates: { custom: { he: 'שלום {parentName}, {notes} — {teacherName}' } } }, 'PUT'));
    assert.equal(updated.status, 200);
    const settings = (await updated.json()).settings;
    assert.equal(settings.teacherName, 'Coach Test');

    const lead = (await (await server.fetch('/api/business/leads', { headers: { Cookie: teacher.cookie } })).json()).leads.find((entry) => entry.parentPhone && entry.language === 'he');
    const composed = await (await server.fetch('/api/business/messages/compose', json(teacher.cookie, { kind: 'custom', leadId: lead.id, lang: 'he', values: { notes: 'בדיקה' } }))).json();
    assert.equal(composed.message.body, `שלום ${lead.parentName}, בדיקה — Coach Test`);
  });

  it('rejects malformed JSON and unknown routes cleanly', async () => {
    const malformed = await server.fetch('/api/business/students', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: teacher.cookie }, body: '{' });
    assert.equal(malformed.status, 400);
    const unknown = await server.fetch('/api/business/nothing', { headers: { Cookie: teacher.cookie } });
    assert.equal(unknown.status, 404);
  });
});
