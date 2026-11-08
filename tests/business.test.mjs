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
    // The group's own name, which depends on the seed (a local groups.json
    // or the built-in demo groups).
    const rookiesView = (await (await server.fetch('/api/business/groups', { headers: { Cookie: teacher.cookie } })).json()).groups.find((group) => group.id === 'rookies');
    assert.equal(record.groupName, rookiesView.name);

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

  it('tracks payments: paying what is owed clears an overdue student', async () => {
    const overview = (await (await server.fetch('/api/business/payments', { headers: { Cookie: teacher.cookie } })).json()).overview;
    const overdue = overview.find((entry) => entry.state === 'overdue');
    assert.ok(overdue, 'demo data includes an overdue student');
    assert.ok(overdue.balance < 0, 'an overdue student owes money');
    assert.ok(overdue.daysUntilDue < 0, 'and has owed it since before today');

    const paid = await server.fetch('/api/business/payments', json(teacher.cookie, { studentId: overdue.studentId, amount: -overdue.balance, currency: overdue.currency, method: 'bit' }));
    assert.equal(paid.status, 200);
    const after_ = (await (await server.fetch('/api/business/payments', { headers: { Cookie: teacher.cookie } })).json()).overview.find((entry) => entry.studentId === overdue.studentId);
    assert.equal(after_.balance, 0);
    assert.notEqual(after_.state, 'overdue');
  });

  it('keeps one account per student across their own prices', async () => {
    const get = async (path) => (await server.fetch(path, { headers: { Cookie: teacher.cookie } })).json();
    const { usdToIls, businessTimezone } = (await get('/api/business/settings')).settings;
    // Dates relative to today: the student started on the 1st two months
    // ago, and the lessons were in that first month.
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: businessTimezone }).format(new Date());
    const monthStart = (back) => {
      const date = new Date(`${today.slice(0, 7)}-01T12:00:00Z`);
      date.setUTCMonth(date.getUTCMonth() - back);
      return date.toISOString().slice(0, 10);
    };
    const first = monthStart(2);
    const day = (n) => `${first.slice(0, 8)}${String(n).padStart(2, '0')}`;
    const sunday = day(2 + ((7 - new Date(`${day(2)}T12:00:00Z`).getUTCDay()) % 7));
    const lastDay = (date) => new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0)).toISOString().slice(0, 10);

    const created = await (await server.fetch('/api/business/students', json(teacher.cookie, {
      firstName: 'Mixed', lastName: 'Prices', lessonType: 'both', groupId: 'rookies', joinedAt: first, billingDay: 1, currency: 'USD',
      privateSchedule: [{ weekday: 0, startTime: '17:00', durationMinutes: 60 }, { weekday: 3, startTime: '17:00', durationMinutes: 40 }],
      prices: [
        { kind: 'private', model: 'per_lesson', durationMinutes: 60, amount: 70 },
        { kind: 'private', model: 'per_lesson', durationMinutes: 40, amount: 50 },
        { kind: 'group', model: 'monthly', amount: 200 },
        // A package needs its number of lessons and a price needs an amount.
        { kind: 'any', model: 'package', amount: 500 },
        { kind: 'any', model: 'per_lesson' }
      ]
    }))).json();
    const pupil = created.student;
    assert.equal(pupil.prices.length, 3);
    const [sixty, forty, monthly] = pupil.prices;

    // The group lesson is covered by the month; Sunday's private lesson
    // takes its slot's 60 minutes; a missed lesson costs nothing.
    const lessonIds = [];
    const log = async (body) => {
      const { lesson } = await (await server.fetch('/api/business/lessons', json(teacher.cookie, { topic: 'Endgames', ...body }))).json();
      lessonIds.push(lesson.id);
    };
    await log({ date: day(3), groupId: 'rookies', studentIds: [pupil.id] });
    await log({ date: sunday, startTime: '17:00', kind: 'private', studentIds: [pupil.id] });
    await log({ date: day(12), startTime: '17:00', durationMinutes: 40, kind: 'private', studentIds: [pupil.id] });
    await log({ date: day(13), startTime: '17:00', durationMinutes: 60, kind: 'private', studentIds: [pupil.id], attendance: { [pupil.id]: 'absent' } });
    await server.fetch('/api/business/payments', json(teacher.cookie, { studentId: pupil.id, amount: 400, currency: 'USD', paidAt: day(14) }));

    // Three months at 200 on their 1st, and the month's lessons at 70 and 50
    // at its end: 720 less 400. The payment pays the oldest charges, so
    // last month's is the first unpaid.
    const detail = await get(`/api/business/students/${pupil.id}`);
    assert.equal(detail.payment.balance, -320);
    assert.equal(detail.payment.nextPaymentAt, monthStart(1));
    assert.equal(detail.payment.state, 'overdue');
    assert.deepEqual(detail.account.filter((entry) => entry.kind === 'month').map((entry) => entry.date), [monthStart(2), monthStart(1), monthStart(0)]);
    assert.deepEqual(detail.account.filter((entry) => entry.kind === 'lessons').map(({ date, count, amount }) => ({ date, count, amount })), [{ date: lastDay(first), count: 2, amount: -120 }]);
    const reminder = await (await server.fetch('/api/business/messages/compose', json(teacher.cookie, { kind: 'payment_reminder', studentId: pupil.id }))).json();
    assert.ok(reminder.message.body.includes('$320'), 'the reminder asks for what is owed');

    // A payment in shekels counts at the rate in settings.
    await server.fetch('/api/business/payments', json(teacher.cookie, { studentId: pupil.id, amount: usdToIls * 320, currency: 'ILS', paidAt: today }));
    const settled = (await get('/api/business/payments')).overview.find((entry) => entry.studentId === pupil.id);
    assert.equal(settled.balance, 0);
    assert.equal(settled.nextChargeAmount, 200);
    assert.ok(settled.nextPaymentAt > today, 'the next charge is the coming month');

    // New prices apply from now on: what was already charged stays.
    const raised = [{ ...sixty, amount: 80 }, { ...forty, amount: 60 }, { ...monthly, amount: 250 }];
    await server.fetch(`/api/business/students/${pupil.id}`, json(teacher.cookie, { prices: raised }, 'PATCH'));
    assert.equal((await get(`/api/business/students/${pupil.id}`)).payment.balance, 0);

    // A price picked by hand wins over the one the lesson's length matches.
    await log({ date: day(20), startTime: '17:00', durationMinutes: 60, kind: 'private', studentIds: [pupil.id], priceChoices: { [pupil.id]: forty.id } });
    assert.equal((await get(`/api/business/students/${pupil.id}`)).payment.balance, -60);

    for (const id of lessonIds) await server.fetch(`/api/business/lessons/${id}`, { method: 'DELETE', headers: { Cookie: teacher.cookie } });
    await server.fetch(`/api/business/students/${pupil.id}`, { method: 'DELETE', headers: { Cookie: teacher.cookie } });
  });

  it('charges part of a month by the lesson, and this month\'s lessons at its end', async () => {
    const get = async (path) => (await server.fetch(path, { headers: { Cookie: teacher.cookie } })).json();
    const { businessTimezone } = (await get('/api/business/settings')).settings;
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: businessTimezone }).format(new Date());
    const monthStart = (back) => {
      const date = new Date(`${today.slice(0, 7)}-01T12:00:00Z`);
      date.setUTCMonth(date.getUTCMonth() - back);
      return date.toISOString().slice(0, 10);
    };
    const on = (back, dayOfMonth) => `${monthStart(back).slice(0, 8)}${String(dayOfMonth).padStart(2, '0')}`;
    const lessonIds = [];
    const log = async (body) => {
      const { lesson } = await (await server.fetch('/api/business/lessons', json(teacher.cookie, { topic: 'Forks', ...body }))).json();
      lessonIds.push(lesson.id);
    };

    // Joined on the 15th two months ago: that month is two lessons at 60,
    // the next one the full 200 on its 1st.
    const pupil = (await (await server.fetch('/api/business/students', json(teacher.cookie, {
      firstName: 'Mid', lastName: 'Month', lessonType: 'both', groupId: 'rookies', joinedAt: on(2, 15), currency: 'USD',
      prices: [{ kind: 'group', model: 'monthly', amount: 200, lessonAmount: 60 }, { kind: 'private', model: 'per_lesson', amount: 80 }]
    }))).json()).student;
    await log({ date: on(2, 16), groupId: 'rookies', studentIds: [pupil.id] });
    await log({ date: on(2, 23), groupId: 'rookies', studentIds: [pupil.id] });
    await log({ date: on(1, 5), groupId: 'rookies', studentIds: [pupil.id] });
    await log({ date: on(1, 20), groupId: 'rookies', studentIds: [pupil.id] });
    let months = (await get(`/api/business/students/${pupil.id}`)).account.filter((entry) => entry.kind === 'month');
    assert.deepEqual(months.slice(0, 2).map(({ date, amount, count }) => ({ date, amount, count })), [
      { date: on(2, 15), amount: -120, count: 2 },
      { date: monthStart(1), amount: -200, count: undefined }
    ]);

    // A private lesson this month waits for the month's end.
    if (today < `${today.slice(0, 8)}28`) {
      await log({ date: today, durationMinutes: 60, kind: 'private', studentIds: [pupil.id] });
      const status = (await get(`/api/business/students/${pupil.id}`)).payment;
      assert.equal(status.pending.amount, 80);
      assert.equal(status.nextChargeAmount, 80, 'the next charge is the month-end lessons, not next month\'s fee with them');
      assert.ok(!(await get(`/api/business/students/${pupil.id}`)).account.some((entry) => entry.kind === 'lessons'), 'not charged yet');
      await server.fetch(`/api/business/lessons/${lessonIds.pop()}`, { method: 'DELETE', headers: { Cookie: teacher.cookie } });
    }

    // Left on the 10th of last month: that month is the one lesson before
    // it at 60; the one on the 20th, and anything later, is not charged.
    const left = await server.fetch(`/api/business/students/${pupil.id}`, json(teacher.cookie, { leftAt: on(1, 10) }, 'PATCH'));
    assert.equal((await left.json()).student.status, 'inactive');
    months = (await get(`/api/business/students/${pupil.id}`)).account.filter((entry) => entry.kind === 'month');
    assert.deepEqual(months.map(({ date, amount }) => ({ date, amount })), [{ date: on(2, 15), amount: -120 }, { date: monthStart(1), amount: -60 }]);
    const owing = (await get('/api/business/payments')).overview.find((entry) => entry.studentId === pupil.id);
    assert.equal(owing.balance, -180, 'a student who left and still owes stays on the payments list');

    const future = await server.fetch(`/api/business/students/${pupil.id}`, json(teacher.cookie, { leftAt: '2999-01-01' }, 'PATCH'));
    assert.equal(future.status, 400);

    for (const id of lessonIds) await server.fetch(`/api/business/lessons/${id}`, { method: 'DELETE', headers: { Cookie: teacher.cookie } });
    await server.fetch(`/api/business/students/${pupil.id}`, { method: 'DELETE', headers: { Cookie: teacher.cookie } });
  });

  it('keeps a lesson charged before charges recorded their billing, whatever its price becomes', async () => {
    const { studentAccount } = await import('../lib/business.mjs');
    const student = { id: 's1', currency: 'USD', joinedAt: '2026-01-01', prices: [{ id: 'p1', kind: 'any', model: 'monthly', amount: 200 }] };
    const lesson = { id: 'l1', date: '2026-01-10', status: 'held', studentIds: ['s1'], attendance: {}, groupId: '', charges: { s1: { amount: 70, currency: 'USD', priceId: 'p1' } } };
    const account = studentAccount(student, [], [lesson], { usdToIls: 3.7 }, '2026-01-20');
    assert.ok(!account.entries.some((entry) => entry.kind === 'lessons'), 'still this month');
    assert.equal(account.pending.amount, 70);
  });

  it('keeps what a lesson cost one student when another is given a different price', async () => {
    const get = async (path) => (await server.fetch(path, { headers: { Cookie: teacher.cookie } })).json();
    const make = async (firstName) => (await (await server.fetch('/api/business/students', json(teacher.cookie, {
      firstName, lastName: 'Pair', lessonType: 'private', joinedAt: '2026-01-01', currency: 'USD',
      prices: [{ kind: 'private', model: 'per_lesson', amount: 70 }, { kind: 'private', model: 'per_lesson', durationMinutes: 30, amount: 40 }]
    }))).json()).student;
    const alice = await make('Alice');
    const bob = await make('Bob');
    const { lesson } = await (await server.fetch('/api/business/lessons', json(teacher.cookie, { date: '2026-02-02', durationMinutes: 60, kind: 'private', studentIds: [alice.id, bob.id], topic: 'Pins' }))).json();

    // Alice's raise leaves the lesson she had at 70.
    await server.fetch(`/api/business/students/${alice.id}`, json(teacher.cookie, { prices: [{ ...alice.prices[0], amount: 100 }, alice.prices[1]] }, 'PATCH'));
    assert.equal((await get(`/api/business/students/${alice.id}`)).payment.balance, -70);

    // Bob given the 30-minute price is charged afresh; Alice is not.
    await server.fetch(`/api/business/lessons/${lesson.id}`, json(teacher.cookie, { priceChoices: { [bob.id]: bob.prices[1].id } }, 'PATCH'));
    assert.equal((await get(`/api/business/students/${bob.id}`)).payment.balance, -40);
    assert.equal((await get(`/api/business/students/${alice.id}`)).payment.balance, -70);

    await server.fetch(`/api/business/lessons/${lesson.id}`, { method: 'DELETE', headers: { Cookie: teacher.cookie } });
    for (const student of [alice, bob]) await server.fetch(`/api/business/students/${student.id}`, { method: 'DELETE', headers: { Cookie: teacher.cookie } });
  });

  it('refuses a payment for an unknown student', async () => {
    const response = await server.fetch('/api/business/payments', json(teacher.cookie, { studentId: 'nope', amount: 100 }));
    assert.equal(response.status, 404);
  });

  it('moves a prospect through a trial lesson into a student', async () => {
    const created = await (await server.fetch('/api/business/leads', json(teacher.cookie, {
      parentName: 'Lead Parent', parentPhone: '+972500000888', childName: 'Lead Child', childAge: 10, level: 'beginner', chesscomRating: 700, lichessRating: 1100, language: 'he', source: 'facebook', preference: 'group'
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
    assert.equal(body.student.level, 'beginner', 'the level carries over');
    assert.equal(body.student.chesscomRating, 700);
    assert.equal(body.student.lichessRating, 1100, 'so do both ratings');

    const again = await server.fetch(`/api/business/leads/${lead.id}/convert`, json(teacher.cookie, {}));
    assert.equal(again.status, 409, 'a prospect converts once');
    // A converted lead is a student now, so it leaves the leads list.
    const open = await (await server.fetch('/api/business/leads', { headers: { Cookie: teacher.cookie } })).json();
    assert.ok(!open.leads.some((entry) => entry.id === lead.id));
    // Students have no status to set: whatever is asked for, a student is active.
    const patched = await (await server.fetch(`/api/business/students/${body.student.id}`, json(teacher.cookie, { status: 'waitlist' }, 'PATCH'))).json();
    assert.equal(patched.student.status, 'active');
  });

  it('keeps who referred a family, only while the source is a referral', async () => {
    const created = await (await server.fetch('/api/business/leads', json(teacher.cookie, {
      parentName: 'Referral Parent', parentPhone: '+972500000887', childName: 'Referral Child', source: 'referral', referredBy: 'Dana, Noa\'s mom'
    }))).json();
    assert.equal(created.lead.source, 'referral');
    assert.equal(created.lead.referredBy, 'Dana, Noa\'s mom');

    const body = await (await server.fetch(`/api/business/leads/${created.lead.id}/convert`, json(teacher.cookie, {}))).json();
    assert.equal(body.student.source, 'referral', 'the source carries over to the student');
    assert.equal(body.student.referredBy, 'Dana, Noa\'s mom');

    const ad = await (await server.fetch(`/api/business/students/${body.student.id}`, json(teacher.cookie, { source: 'paid_ad' }, 'PATCH'))).json();
    assert.equal(ad.student.source, 'paid_ad');
    assert.equal(ad.student.referredBy, '', 'a paid ad has no referrer');
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

  it('renames, reschedules and deletes a group only once nobody is in it', async () => {
    const groups = async () => (await (await server.fetch('/api/business/groups', { headers: { Cookie: teacher.cookie } })).json()).groups;
    const created = await server.fetch('/api/groups', json(teacher.cookie, { title: { he: 'זמנית', en: 'Temporary' }, schedule: { timezone: 'Asia/Jerusalem', rows: [{ weekday: 0, startTime: '17:00', durationMinutes: 60 }] } }));
    const { id } = (await created.json()).group;
    await server.fetch(`/api/business/groups/${id}/profile`, json(teacher.cookie, { level: 'beginner' }, 'PATCH'));

    const edited = await server.fetch(`/api/groups/${id}`, json(teacher.cookie, { title: { he: 'חדשה', en: 'Renamed' }, schedule: { timezone: 'Asia/Jerusalem', rows: [{ weekday: 2, startTime: '18:30', durationMinutes: 45 }] } }, 'PATCH'));
    assert.equal(edited.status, 200);
    const view = (await groups()).find((group) => group.id === id);
    assert.equal(view.name, 'חדשה');
    assert.equal(view.nameEn, 'Renamed');
    assert.deepEqual([view.schedule[0].weekday, view.schedule[0].startTime, view.schedule[0].durationMinutes], [2, '18:30', 45]);

    const member = (await (await server.fetch('/api/business/students', json(teacher.cookie, { firstName: 'Only', lastName: 'Member', groupId: id }))).json()).student;
    await server.fetch('/api/business/events', json(teacher.cookie, { kind: 'cancel', date: '2026-11-10', groupId: id }));
    const refused = await server.fetch(`/api/groups/${id}`, { method: 'DELETE', headers: { Cookie: teacher.cookie } });
    assert.equal(refused.status, 409, 'a group with students is not deleted');

    await server.fetch(`/api/business/students/${member.id}`, json(teacher.cookie, { groupId: '' }, 'PATCH'));
    const deleted = await server.fetch(`/api/groups/${id}`, { method: 'DELETE', headers: { Cookie: teacher.cookie } });
    assert.equal(deleted.status, 200);
    assert.ok(!(await groups()).some((group) => group.id === id));
    const events = (await (await server.fetch('/api/business/calendar?from=2026-11-01&to=2026-11-30', { headers: { Cookie: teacher.cookie } })).json()).events;
    assert.ok(!events.some((event) => event.groupId === id), 'its calendar changes go with it');
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

  it('reminds a family of the lesson at their own hour, with no time zone name', async () => {
    const created = (await (await server.fetch('/api/business/students', json(teacher.cookie, { firstName: 'Far', lastName: 'Away', parentName: 'NY Parent', groupId: 'rookies', price: 250, billingType: 'monthly', timezone: 'America/New_York', language: 'en' }))).json()).student;
    const week = await (await server.fetch('/api/business/calendar?from=2026-12-06&to=2026-12-12', { headers: { Cookie: teacher.cookie } })).json();
    const lesson = week.occurrences.find((occurrence) => occurrence.groupId === 'rookies');
    const composed = await (await server.fetch('/api/business/messages/compose', json(teacher.cookie, { kind: 'lesson_reminder', studentId: created.id, occurrenceKey: lesson.key }))).json();
    const newYorkHour = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(lesson.startAt));
    assert.ok(composed.message.body.includes(`at ${newYorkHour}`), composed.message.body);
    assert.ok(!/America|\(\)/.test(composed.message.body), composed.message.body);
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

    // A student's page shows the next lesson with its suggested game too,
    // for a group lesson and for a private student on their own.
    const moverNext = (await get(`/students/${mover.id}`)).nextLesson;
    assert.ok(moverNext.suggestedGame, 'a group student\'s next lesson suggests a game');
    assert.notEqual(moverNext.suggestedGame.id, game.id, 'not one they have seen');
    const loner = (await get('/students')).students.find((entry) => entry.lessonType === 'private' && entry.privateSchedule.length);
    const lonerNext = (await get(`/students/${loner.id}`)).nextLesson;
    assert.equal(lonerNext.kind, 'private');
    assert.ok(lonerNext.suggestedGame, 'a private student\'s next lesson suggests a game');
    assert.equal(lonerNext.suggestedGame.of, 1);
  });

  it('counts a logged lesson only for its own slot', async () => {
    const get = async (path) => (await server.fetch(`/api/business${path}`, { headers: { Cookie: teacher.cookie } })).json();
    const week = async () => (await get('/calendar?from=2026-11-22&to=2026-11-28')).occurrences;
    const groupSlot = (await week()).find((occurrence) => occurrence.kind === 'group' && !occurrence.loggedLessonId);
    const privateSlot = (await week()).find((occurrence) => occurrence.kind === 'private' && !occurrence.loggedLessonId);
    assert.ok(groupSlot && privateSlot, 'demo data has group and private lessons that week');

    // A group lesson logged at another time that day leaves the scheduled one open.
    await server.fetch('/api/business/lessons', json(teacher.cookie, { date: groupSlot.date, startTime: groupSlot.startTime === '06:00' ? '07:00' : '06:00', kind: 'group', groupId: groupSlot.groupId, topic: 'Extra' }));
    // So does a group lesson for a private student's group on their private day.
    const loner = (await get(`/students/${privateSlot.studentIds[0]}`)).student;
    if (loner.groupId) await server.fetch('/api/business/lessons', json(teacher.cookie, { date: privateSlot.date, startTime: privateSlot.startTime, kind: 'group', groupId: loner.groupId, topic: 'Group day' }));
    const after = await week();
    assert.equal(after.find((occurrence) => occurrence.key === groupSlot.key).loggedLessonId, '');
    assert.ok(after.find((occurrence) => occurrence.key === groupSlot.key).suggestedGame, 'it still suggests a game');
    assert.equal(after.find((occurrence) => occurrence.key === privateSlot.key).loggedLessonId, '');

    // Logged at its own time, it is the slot's.
    await server.fetch('/api/business/lessons', json(teacher.cookie, { date: groupSlot.date, startTime: groupSlot.startTime, kind: 'group', groupId: groupSlot.groupId, topic: 'On time' }));
    assert.ok((await week()).find((occurrence) => occurrence.key === groupSlot.key).loggedLessonId);

    // One logged without a time covers each of its students' lessons that day.
    const privates = after.filter((occurrence) => occurrence.kind === 'private' && occurrence.date === privateSlot.date && !occurrence.loggedLessonId);
    await server.fetch('/api/business/lessons', json(teacher.cookie, { date: privateSlot.date, kind: 'private', studentIds: privates.flatMap((occurrence) => occurrence.studentIds), topic: 'Untimed' }));
    const untimed = await week();
    for (const slot of privates) assert.ok(untimed.find((occurrence) => occurrence.key === slot.key).loggedLessonId, 'an untimed summary logs every lesson it covers');
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

  it('suggests for each prospect the closest group with room, by the ranges in settings', async () => {
    const { suggestGroupFor } = await import('../lib/business.mjs');
    const settings = { matchAgeYears: 2, matchLevelSteps: 1, matchRatingPoints: 150 };
    const student = (age, level, chesscomRating) => ({ age, level, chesscomRating });
    const group = (id, students, { seatsFree = 2, status = 'active', language = 'he', ...profile } = {}) => ({
      id, name: id, nameEn: id, seatsFree, seatsTotal: 5, students,
      profile: { status, language, minAge: null, maxAge: null, level: '', ratingMin: null, ratingMax: null, ...profile }
    });
    const lead = (fields) => ({ preference: 'group', language: 'he', childAge: null, level: '', chesscomRating: null, ...fields });
    const views = [
      group('far', [student(13, 'advanced', 1300)]),
      group('close', [student(8, 'beginner', 500), student(10, 'beginner', 620)]),
      group('closer-but-full', [student(9, 'beginner', 560)], { seatsFree: 0 }),
      group('closed', [student(9, 'beginner', 560)], { status: 'closed' }),
      group('english', [student(9, 'beginner', 560)], { language: 'en' }),
      group('empty', [], { minAge: 6, maxAge: 8, level: 'basic' })
    ];

    const child = lead({ childAge: 9, level: 'beginner', chesscomRating: 550 });
    assert.equal(suggestGroupFor(child, views, settings).group.id, 'close', 'full, closed and other-language groups are skipped');
    assert.equal(suggestGroupFor(child, views, settings).group.comparedWith, 'students');

    const young = lead({ childAge: 7, level: 'basic' });
    const empty = suggestGroupFor(young, views, settings).group;
    assert.equal(empty.id, 'empty', 'an empty group is compared with its profile');
    assert.equal(empty.comparedWith, 'profile');

    assert.equal(suggestGroupFor(lead({ childAge: 12 }), views, { ...settings, matchAgeYears: 0 }).reason, 'none_fits', 'a tighter range rules groups out');
    assert.equal(suggestGroupFor(lead({ childAge: 12 }), views, settings).group.id, 'far');
    assert.equal(suggestGroupFor(lead({ preference: 'private', childAge: 9 }), views, settings).reason, 'private');
    assert.equal(suggestGroupFor(lead({}), views, settings).reason, 'no_details');
  });

  it('fits a child in both Hebrew and English to Hebrew and English groups alike', async () => {
    const { suggestGroupFor, languagesFit } = await import('../lib/business.mjs');
    assert.ok(languagesFit('he_en', 'he') && languagesFit('he_en', 'en') && languagesFit('en', 'he_en'));
    assert.ok(!languagesFit('he', 'en') && !languagesFit('he_en', 'ru'));
    const settings = { matchAgeYears: 2, matchLevelSteps: 1, matchRatingPoints: 150 };
    const group = (id, language) => ({
      id, name: id, nameEn: id, seatsFree: 2, seatsTotal: 5, students: [{ age: 9, level: 'beginner', chesscomRating: 550 }],
      profile: { status: 'active', language, minAge: null, maxAge: null, level: '', ratingMin: null, ratingMax: null }
    });
    const child = (language) => ({ preference: 'group', language, childAge: 9, level: 'beginner', chesscomRating: 550 });
    assert.equal(suggestGroupFor(child('he_en'), [group('english', 'en')], settings).group.id, 'english');
    assert.equal(suggestGroupFor(child('he_en'), [group('hebrew', 'he')], settings).group.id, 'hebrew');
    assert.equal(suggestGroupFor(child('he'), [group('english', 'en')], settings).reason, 'none_fits');
  });

  it('shows a suggested group on every prospect and follows the matching settings', async () => {
    const leads = async () => (await (await server.fetch('/api/business/leads', { headers: { Cookie: teacher.cookie } })).json()).leads;
    // Earlier tests fill groups, so compare wide ranges with none at all.
    const put = (body) => server.fetch('/api/business/settings', json(teacher.cookie, body, 'PUT'));
    const suggested = (list) => list.filter((entry) => entry.suggestedGroup.group).length;
    await put({ matchAgeYears: 20, matchLevelSteps: 3, matchRatingPoints: 3000 });
    const wide = await leads();
    assert.ok(wide.length > 0);
    assert.ok(wide.every((entry) => 'suggestedGroup' in entry));
    assert.ok(suggested(wide) > 0, 'with wide ranges some prospect fits a group');

    const saved = await (await put({ matchAgeYears: 0, matchLevelSteps: 0, matchRatingPoints: 0 })).json();
    assert.equal(saved.settings.matchAgeYears, 0);
    assert.ok(suggested(await leads()) < suggested(wide), 'tighter ranges suggest fewer groups');
    await put({ matchAgeYears: 2, matchLevelSteps: 1, matchRatingPoints: 150 });
  });

  it('writes to a family in the parent\'s language, not the child\'s', async () => {
    const create = async (fields) => (await (await server.fetch('/api/business/students', json(teacher.cookie, { firstName: 'Lang', parentFirstName: 'Dana', parentPhone: '050-333-4444', ...fields }))).json()).student;
    const compose = async (studentId, lang) => (await (await server.fetch('/api/business/messages/compose', json(teacher.cookie, { kind: 'payment_reminder', studentId, lang }))).json()).message;

    // Without a choice the parent's language follows the child's.
    const englishChild = await create({ language: 'en' });
    assert.equal(englishChild.parentLanguage, 'en');
    const bilingualChild = await create({ language: 'he_en' });
    assert.equal(bilingualChild.parentLanguage, 'he');

    // A child in Hebrew and English whose parents read English.
    const record = await create({ language: 'he_en', parentLanguage: 'en' });
    assert.equal(record.parentLanguage, 'en');
    assert.equal((await compose(record.id)).language, 'en');
    assert.equal((await compose(record.id, 'he')).language, 'he', 'a language picked in the composer still wins');

    // Editing another field keeps it; an unknown value falls back.
    const edited = (await (await server.fetch(`/api/business/students/${record.id}`, json(teacher.cookie, { notes: 'x' }, 'PATCH'))).json()).student;
    assert.equal(edited.parentLanguage, 'en');
    const odd = await create({ language: 'he', parentLanguage: 'klingon' });
    assert.equal(odd.parentLanguage, 'he');
  });

  it('tags games and finds them by tag, player or trait', async () => {
    const pgn = '[White "Tal"]\n[Black "Smyslov"]\n[Event "Candidates"]\n\n1. e4 c6 *\n\n[White "Petrosian"]\n[Black "Spassky"]\n\n1. d4 Nf6 *';
    const [tal, petrosian] = (await (await server.fetch('/api/business/content/import-pgn', json(teacher.cookie, { fileName: 'tags.pgn', pgn }))).json()).items;
    const list = async (query) => (await (await server.fetch(`/api/business/content?kind=game&${query}`, { headers: { Cookie: teacher.cookie } })).json());

    const tagged = await server.fetch(`/api/business/content/${tal.id}`, json(teacher.cookie, { tags: ['tags.pgn', 'Sacrifice', 'attack'] }, 'PATCH'));
    assert.equal(tagged.status, 200);
    assert.deepEqual((await tagged.json()).item.tags, ['tags.pgn', 'Sacrifice', 'attack']);

    const bySacrifice = await list('tag=sacrifice');
    assert.deepEqual(bySacrifice.content.map((item) => item.id), [tal.id], 'a tag matches whatever its case');
    assert.ok(bySacrifice.tags.some((tag) => tag.name === 'Sacrifice' && tag.count === 1));
    assert.ok(bySacrifice.tags.some((tag) => tag.name === 'tags.pgn' && tag.count === 2), 'the tag list counts every game, not only the filtered ones');
    assert.deepEqual((await list('q=smyslov')).content.map((item) => item.id), [tal.id], 'found by a player');
    assert.deepEqual((await list('q=candidates')).content.map((item) => item.id), [tal.id], 'found by the event');
    assert.deepEqual((await list('q=spassky')).content.map((item) => item.id), [petrosian.id]);

    const order = (await list('q=tags.pgn')).content.map((item) => item.id);
    assert.equal(order.length, 2);
    await server.fetch(`/api/business/content/${order[1]}`, json(teacher.cookie, { tags: ['tags.pgn', 'endgame'] }, 'PATCH'));
    assert.deepEqual((await list('q=tags.pgn')).content.map((item) => item.id), order, 'tagging a game does not move it in the list');

    // Removing a tag takes the game out of that filter.
    await server.fetch(`/api/business/content/${tal.id}`, json(teacher.cookie, { tags: ['tags.pgn', 'attack'] }, 'PATCH'));
    assert.equal((await list('tag=sacrifice')).content.length, 0);
    assert.ok(!(await list('')).tags.some((tag) => tag.name === 'Sacrifice'));
  });

  it('shows lessons that took place without a summary in the history and on the dashboard', async () => {
    const get = async (path) => (await server.fetch(`/api/business${path}`, { headers: { Cookie: teacher.cookie } })).json();
    const { settings } = await get('/settings');
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: settings.businessTimezone }).format(new Date());
    const shift = (days) => new Date(Date.parse(`${today}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
    const weekday = new Date(`${shift(-3)}T00:00:00Z`).getUTCDay();
    // Entered today, but taking a weekly private lesson since 12 days ago:
    // the lessons 10 and 3 days ago took place and were never logged.
    const create = (firstName, joinedAt) => server.fetch('/api/business/students', json(teacher.cookie, {
      firstName, lastName: 'Backfill', parentPhone: '050-333-4444', lessonType: 'private', status: 'active', joinedAt,
      privateSchedule: [{ weekday, startTime: '10:00', durationMinutes: 45 }]
    })).then((response) => response.json());
    const { student: record } = await create('Past', shift(-12));
    const { student: fresh } = await create('Fresh', today);

    const detail = await get(`/students/${record.id}`);
    assert.deepEqual(detail.awaitingSummary.map((occurrence) => occurrence.date), [shift(-3), shift(-10)]);
    assert.equal((await get(`/students/${fresh.id}`)).awaitingSummary.length, 0, 'nothing from before a student joined');

    const mine = (overview) => overview.missingSummaries.filter((occurrence) => occurrence.studentIds.includes(record.id));
    assert.equal(mine(await get('/overview')).length, 2);

    // Writing the summary takes the lesson off the list.
    const logged = await server.fetch('/api/business/lessons', json(teacher.cookie, { date: shift(-10), startTime: '10:00', kind: 'private', studentIds: [record.id], topic: 'Forks' }));
    assert.equal(logged.status, 200);
    assert.deepEqual(mine(await get('/overview')).map((occurrence) => occurrence.date), [shift(-3)]);
    assert.equal((await get(`/students/${record.id}`)).awaitingSummary.length, 1);
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
      assert.equal('prices' in student, false);
      assert.equal('paymentState' in student, false);
    }

    const everyone = (await get(admin.cookie, '/students')).body.students;
    const outsider = everyone.find((student) => student.groupId === 'rookies');
    assert.equal((await get(teacher.cookie, `/students/${outsider.id}`)).status, 404);
    const own = await get(teacher.cookie, `/students/${students[0].id}`);
    assert.equal(own.status, 200);
    assert.equal(own.body.payments, undefined);
    assert.equal(own.body.payment, undefined);
    assert.equal(own.body.account, undefined);
    // What a lesson cost, or a price picked for it, stays with the admin.
    const lessonsJson = JSON.stringify((await get(teacher.cookie, '/lessons')).body);
    assert.ok(!lessonsJson.includes('"charges"') && !lessonsJson.includes('"priceChoices"'));

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
