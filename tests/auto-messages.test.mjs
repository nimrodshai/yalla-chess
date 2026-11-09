// Automatic WhatsApp reminders: when each one goes out, that it goes out
// once, the trial mode and quiet hours, and Twilio's signed webhooks for
// delivery reports and parents' replies. Twilio itself is a stub server in
// this process, which records every message the app asks it to send.

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';

import { devEnv, signIn, startServer } from './helpers.mjs';

const ADMIN = '+972500000001';
const AUTH_TOKEN = 'test-auth-token';
const CONTENT = {
  TWILIO_CONTENT_LESSON_REMINDER_HE: 'HXlessonhe',
  TWILIO_CONTENT_LESSON_REMINDER_EN: 'HXlessonen',
  TWILIO_CONTENT_PAYMENT_DUE_HE: 'HXpaymenthe',
  TWILIO_CONTENT_PAYMENT_DUE_EN: 'HXpaymenten'
};

function json(cookie, body, method = 'POST') {
  return { method, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body) };
}

// Twilio's webhook signature over the URL and the sorted form fields.
function sign(url, params, token = AUTH_TOKEN) {
  const payload = url + Object.keys(params).sort().map((key) => key + params[key]).join('');
  return createHmac('sha1', token).update(payload, 'utf8').digest('base64');
}

function startTwilioStub() {
  const requests = [];
  let next = 0;
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const form = Object.fromEntries(new URLSearchParams(body));
      requests.push({ path: req.url, authorization: req.headers.authorization, form });
      next += 1;
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sid: `SM${String(next).padStart(32, '0')}`, status: 'queued' }));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    base: `http://127.0.0.1:${server.address().port}`,
    requests,
    to: (phone) => requests.filter((request) => request.form.To === `whatsapp:${phone}`),
    close: () => new Promise((done) => server.close(done))
  })));
}

describe('automatic WhatsApp messages', () => {
  let twilio;
  let server;
  let admin;

  const run = async (now) => {
    const response = await server.fetch('/api/debug/auto-messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ now }) });
    assert.equal(response.status, 200);
    return (await response.json()).summary;
  };
  const setAuto = async (autoMessages) => {
    const response = await server.fetch('/api/business/settings', json(admin.cookie, { autoMessages }, 'PUT'));
    assert.equal(response.status, 200);
    return (await response.json()).settings.autoMessages;
  };
  const messagesOf = async (studentId) => (await (await server.fetch(`/api/business/messages?studentId=${studentId}`, { headers: { Cookie: admin.cookie } })).json()).messages;
  const createStudent = async (fields) => {
    const response = await server.fetch('/api/business/students', json(admin.cookie, {
      lastName: 'Auto', age: 9, status: 'active', language: 'he', timezone: 'Asia/Jerusalem', autoMessages: true, ...fields
    }));
    assert.equal(response.status, 200, await response.clone().text());
    return (await response.json()).student;
  };
  // A one-off private lesson, at a local time in Israel.
  const createLesson = async (studentId, date, startTime) => {
    const response = await server.fetch('/api/business/events', json(admin.cookie, { kind: 'private', date, startTime, durationMinutes: 45, studentId, zoomLink: 'https://zoom.example/j/1' }));
    assert.equal(response.status, 200, await response.clone().text());
  };

  before(async () => {
    twilio = await startTwilioStub();
    server = await startServer({
      ...devEnv,
      TWILIO_ACCOUNT_SID: 'ACtest',
      TWILIO_AUTH_TOKEN: AUTH_TOKEN,
      TWILIO_WHATSAPP_FROM: '+14155238886',
      TWILIO_API_BASE: twilio.base,
      ...CONTENT
    });
    admin = await signIn(server, ADMIN);
  });
  after(async () => {
    await server.stop();
    await twilio.close();
  });

  it('is off until it is turned on, and shows what is set up', async () => {
    const response = await server.fetch('/api/business/settings', { headers: { Cookie: admin.cookie } });
    const { settings, whatsApp } = await response.json();
    assert.equal(settings.autoMessages.mode, 'off');
    assert.deepEqual(whatsApp, {
      sender: true,
      webhooks: true,
      templates: { lesson_reminder: { he: true, en: true }, payment_reminder: { he: true, en: true } }
    });
    assert.ok(!JSON.stringify(whatsApp).includes('HX'), 'the template SIDs themselves are not shown');

    const student = await createStudent({ firstName: 'Offmode', parentName: 'Dana Off', parentPhone: '+972501110001', lessonType: 'private', reminderLeadHours: 3 });
    await createLesson(student.id, '2030-03-05', '17:00');
    assert.equal((await run('2030-03-05T13:00:00Z')).mode, 'off');
    assert.equal(twilio.to('+972501110001').length, 0);
    assert.equal((await messagesOf(student.id)).length, 0);
  });

  it('leaves every student off until they are turned on, one by one or all at once', async () => {
    const quiet = await createStudent({ firstName: 'Default', parentName: 'Ada Default', parentPhone: '+972501110010', lessonType: 'private', autoMessages: undefined });
    assert.equal(quiet.autoMessages, false, 'a new student starts off');

    const before = await (await server.fetch('/api/business/auto-messages', { headers: { Cookie: admin.cookie } })).json();
    assert.ok(before.off.some((student) => student.id === quiet.id));

    const declined = await createStudent({ firstName: 'Declined', parentName: 'Ben Declined', parentPhone: '+972501110011', lessonType: 'private', autoMessages: undefined, remindersEnabled: false });
    const allOn = await (await server.fetch('/api/business/auto-messages', json(admin.cookie, { enabled: true }))).json();
    assert.ok(allOn.changed > 0);
    assert.equal(allOn.settings.autoMessages.newStudents, true);
    assert.ok(!allOn.off.some((student) => student.id === quiet.id), 'turned on');
    assert.ok(allOn.off.some((student) => student.id === declined.id && student.remindersOff), 'reminders turned off before stay off');

    const added = await createStudent({ firstName: 'Added', parentName: 'Cy Added', parentPhone: '+972501110012', lessonType: 'private', autoMessages: undefined });
    assert.equal(added.autoMessages, true, 'new students follow once everyone is on');

    const allOff = await (await server.fetch('/api/business/auto-messages', json(admin.cookie, { enabled: false }))).json();
    assert.equal(allOff.on, 0);
    assert.equal(allOff.settings.autoMessages.newStudents, false);
    const later = await createStudent({ firstName: 'Later', parentName: 'Di Later', parentPhone: '+972501110013', lessonType: 'private', autoMessages: undefined });
    assert.equal(later.autoMessages, false);

    // Off for a student means nothing goes out to them, even when on.
    await setAuto({ mode: 'on' });
    await createLesson(quiet.id, '2030-02-20', '17:00');
    await run('2030-02-20T13:00:00Z');
    assert.equal(twilio.to('+972501110010').length, 0);
    await setAuto({ mode: 'off' });
  });

  it('keeps settings it does not understand as they were', async () => {
    const saved = await setAuto({ mode: 'loud', quietStart: 'soon', autoReply: { he: '' } });
    assert.equal(saved.mode, 'off');
    assert.equal(saved.quietStart, '21:00');
    assert.match(saved.autoReply.he, /תזכורות בלבד/);
  });

  it('in trial mode logs what would go out, sends nothing, and logs it once', async () => {
    await setAuto({ mode: 'trial' });
    const student = await createStudent({ firstName: 'Trial', parentName: 'Noa Trial', parentPhone: '+972501110002', lessonType: 'private', reminderLeadHours: 3 });
    await createLesson(student.id, '2030-03-06', '17:00');

    // 17:00 in Israel is 15:00 UTC; three hours before is 12:00 UTC.
    await run('2030-03-06T11:59:00Z');
    assert.equal((await messagesOf(student.id)).length, 0, 'not before the student\'s lead time');

    await run('2030-03-06T12:00:00Z');
    await run('2030-03-06T12:01:00Z');
    const logged = await messagesOf(student.id);
    assert.equal(logged.length, 1);
    assert.equal(logged[0].status, 'trial');
    assert.equal(logged[0].createdBy, 'auto');
    assert.equal(logged[0].kind, 'lesson_reminder');
    assert.equal(logged[0].body, 'היי Noa! תזכורת: השיעור של Trial מתחיל היום ב-17:00.\nקישור לזום: https://zoom.example/j/1\nנתראה!\nדולב מ-Yalla-Chess');
    assert.equal(twilio.to('+972501110002').length, 0);
  });

  it('waits out the quiet hours, and drops a reminder whose lesson has started', async () => {
    await setAuto({ mode: 'trial', quietStart: '21:00', quietEnd: '08:00' });
    const early = await createStudent({ firstName: 'Early', parentName: 'Gil Early', parentPhone: '+972501110003', lessonType: 'private', reminderLeadHours: 3 });
    await createLesson(early.id, '2030-03-07', '09:00');

    // Due at 06:00 in Israel, quiet until 08:00.
    await run('2030-03-07T04:30:00Z');
    assert.equal((await messagesOf(early.id)).length, 0, 'nothing during the quiet hours');
    await run('2030-03-07T06:00:00Z');
    assert.equal((await messagesOf(early.id)).length, 1, 'sent once the quiet hours end');

    const late = await createStudent({ firstName: 'Late', parentName: 'Tal Late', parentPhone: '+972501110004', lessonType: 'private', reminderLeadHours: 3 });
    await createLesson(late.id, '2030-03-07', '07:30');
    await run('2030-03-07T06:00:00Z');
    assert.equal((await messagesOf(late.id)).length, 0, 'a lesson that already started gets no reminder');
  });

  it('sends the approved template once, in the parent\'s language, and follows delivery reports', async () => {
    await setAuto({ mode: 'on' });
    const student = await createStudent({ firstName: 'Live', parentName: 'Ron Live', parentPhone: '+972501110005', parentLanguage: 'en', lessonType: 'private', reminderLeadHours: 24, timezone: 'America/New_York' });
    await createLesson(student.id, '2030-03-08', '17:00');

    // 17:00 in Israel is 10:00 in New York; a day ahead it says "tomorrow".
    await run('2030-03-07T16:00:00Z');
    await run('2030-03-07T16:05:00Z');
    const sent = twilio.to('+972501110005');
    assert.equal(sent.length, 1, 'once, however many runs');
    assert.equal(sent[0].path, '/2010-04-01/Accounts/ACtest/Messages.json');
    assert.equal(sent[0].form.From, 'whatsapp:+14155238886');
    assert.equal(sent[0].form.ContentSid, 'HXlessonen');
    assert.deepEqual(JSON.parse(sent[0].form.ContentVariables), { 1: 'Ron', 2: 'Live', 3: 'tomorrow at 10:00', 4: 'https://zoom.example/j/1', 5: 'דולב' });
    assert.match(sent[0].authorization, /^Basic /);

    const [record] = await messagesOf(student.id);
    assert.equal(record.status, 'queued');
    assert.match(record.providerId, /^SM/);

    const url = `${server.base}/api/whatsapp/status`;
    const report = async (params, signature = sign(url, params)) => server.fetch('/api/whatsapp/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': signature },
      body: new URLSearchParams(params).toString()
    });

    const forged = await report({ MessageSid: record.providerId, MessageStatus: 'read' }, sign(url, { MessageSid: record.providerId, MessageStatus: 'read' }, 'wrong-token'));
    assert.equal(forged.status, 403);
    assert.equal((await messagesOf(student.id))[0].status, 'queued', 'an unsigned report changes nothing');

    assert.equal((await report({ MessageSid: record.providerId, MessageStatus: 'delivered' })).status, 200);
    assert.equal((await messagesOf(student.id))[0].status, 'delivered');
    await report({ MessageSid: record.providerId, MessageStatus: 'sent' });
    assert.equal((await messagesOf(student.id))[0].status, 'delivered', 'a late report does not move it back');

    // The day's reminder list counts it as sent, so nobody sends it again by hand.
    const reminders = (await (await server.fetch('/api/business/reminders?date=2030-03-08', { headers: { Cookie: admin.cookie } })).json()).reminders;
    assert.equal(reminders.find((reminder) => reminder.studentId === student.id).sent, true);
  });

  it('does not send a reminder already sent by hand', async () => {
    const student = await createStudent({ firstName: 'Manual', parentName: 'Yael Manual', parentPhone: '+972501110006', lessonType: 'private', reminderLeadHours: 3 });
    await createLesson(student.id, '2030-03-09', '17:00');
    const reminders = (await (await server.fetch('/api/business/reminders?date=2030-03-09', { headers: { Cookie: admin.cookie } })).json()).reminders;
    const { reference } = reminders.find((reminder) => reminder.studentId === student.id);
    await server.fetch('/api/business/messages', json(admin.cookie, { kind: 'lesson_reminder', studentId: student.id, reference, body: 'sent from my phone', status: 'sent' }));

    await run('2030-03-09T13:00:00Z');
    assert.equal(twilio.to('+972501110006').length, 0);
  });

  it('sends the payment message on the day the family starts to owe, and not for an older debt', async () => {
    const owes = await createStudent({ firstName: 'Payer', parentName: 'Eli Payer', parentPhone: '+972501110007', lessonType: 'group', joinedAt: '2030-04-01', prices: [{ model: 'monthly', kind: 'group', amount: 200 }] });
    const old = await createStudent({ firstName: 'Older', parentName: 'Ori Older', parentPhone: '+972501110008', lessonType: 'group', joinedAt: '2030-03-25', prices: [{ model: 'monthly', kind: 'group', amount: 200 }] });

    await run('2030-03-31T08:00:00Z');
    assert.equal(twilio.to('+972501110007').length, 0, 'nothing before the charge');

    // The 1st: Payer starts to owe today, Older has owed since the 25th.
    await run('2030-04-01T08:00:00Z');
    await run('2030-04-01T09:00:00Z');
    const sent = twilio.to('+972501110007');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].form.ContentSid, 'HXpaymenthe');
    assert.deepEqual(JSON.parse(sent[0].form.ContentVariables), { 1: 'Eli', 2: 'Payer', 3: '₪200', 4: 'דולב' });
    assert.equal(twilio.to('+972501110008').length, 0, 'a debt from days ago gets no message');
    const [record] = await messagesOf(owes.id);
    assert.equal(record.kind, 'payment_reminder');
    assert.equal(record.body, 'היי Eli, הגיע מועד התשלום עבור השיעורים של Payer: ₪200.\nתודה רבה!\nדולב מ-Yalla-Chess');
    assert.equal((await messagesOf(old.id)).length, 0);
  });

  it('logs a failed send with Twilio\'s reason and does not retry it', async () => {
    await twilio.close();
    const student = await createStudent({ firstName: 'Fail', parentName: 'Dov Fail', parentPhone: '+972501110009', lessonType: 'private', reminderLeadHours: 3 });
    await createLesson(student.id, '2030-03-10', '17:00');
    await run('2030-03-10T13:00:00Z');
    const [record] = await messagesOf(student.id);
    assert.equal(record.status, 'failed');
    assert.ok(record.error);

    twilio = await startTwilioStub();
    await run('2030-03-10T13:05:00Z');
    assert.equal((await messagesOf(student.id)).length, 1);
  });

  it('answers a parent who writes to the number, once in a while, and only signed requests', async () => {
    const url = `${server.base}/api/whatsapp/inbound`;
    const params = { From: 'whatsapp:+972501110005', To: 'whatsapp:+14155238886', Body: 'Thanks!', MessageSid: 'SMin1' };
    const write = (signature = sign(url, params)) => server.fetch('/api/whatsapp/inbound', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': signature },
      body: new URLSearchParams(params).toString()
    });

    assert.equal((await write('bogus')).status, 403);

    const first = await write();
    assert.equal(first.status, 200);
    assert.match(first.headers.get('content-type'), /xml/);
    const body = await first.text();
    // Ron's parent language is English.
    assert.match(body, /<Message>Hi! This number only sends reminders.*contact דולב directly/);

    const second = await (await write()).text();
    assert.doesNotMatch(second, /<Message>/, 'not again within 12 hours');
  });

  it('stops every message to a parent who asks to, lists them, and keeps them out of "on for everyone"', async () => {
    const student = await createStudent({ firstName: 'Stopper', parentName: 'Mor Stopper', parentPhone: '+972501110014', lessonType: 'private', reminderLeadHours: 3 });
    const sibling = await createStudent({ firstName: 'Sibling', parentName: 'Mor Stopper', parentPhone: '+972501110014', lessonType: 'private', reminderLeadHours: 3 });
    const url = `${server.base}/api/whatsapp/inbound`;
    const params = { From: 'whatsapp:+972501110014', To: 'whatsapp:+14155238886', Body: ' הסר! ', MessageSid: 'SMin2' };
    const response = await server.fetch('/api/whatsapp/inbound', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': sign(url, params) },
      body: new URLSearchParams(params).toString()
    });
    assert.match(await response.text(), /<Message>הבנו, לא נשלח לכם יותר תזכורות אוטומטיות/);

    const roster = await (await server.fetch('/api/business/auto-messages', { headers: { Cookie: admin.cookie } })).json();
    for (const id of [student.id, sibling.id]) {
      const entry = roster.off.find((item) => item.id === id);
      assert.ok(entry?.optedOutAt, 'both children of that parent are listed as opted out');
    }

    await createLesson(student.id, '2030-03-11', '17:00');
    await run('2030-03-11T13:00:00Z');
    assert.equal(twilio.to('+972501110014').length, 0, 'nothing goes out after they asked to stop');

    await server.fetch('/api/business/auto-messages', json(admin.cookie, { enabled: true }));
    const detail = await (await server.fetch(`/api/business/students/${student.id}`, { headers: { Cookie: admin.cookie } })).json();
    assert.equal(detail.student.autoMessages, false, '"on for everyone" leaves them out');

    // Turned back on by hand, the request no longer stands.
    const patched = await (await server.fetch(`/api/business/students/${student.id}`, json(admin.cookie, { autoMessages: true }, 'PATCH'))).json();
    assert.equal(patched.student.autoMessages, true);
    assert.equal(patched.student.autoMessagesOptedOutAt, '');
  });
});
