// Lesson summaries from Zoom: a lesson on the calendar whose Zoom meeting
// has a transcript gets its log filled in by Claude, once, and a lesson a
// teacher already logged keeps what they wrote. Zoom and Claude are one stub
// server in this process.

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { devEnv, signIn, startServer } from './helpers.mjs';

const ADMIN = '+972500000001';
const MEETING = '81234567890';

const TRANSCRIPT = `WEBVTT

1
00:00:01.000 --> 00:00:04.000
Dolev: Today we learn about pins.

2
00:00:05.000 --> 00:00:08.000
Dolev: Find the pin in this position.

3
00:00:09.000 --> 00:00:12.000
Noa Cohen: Bishop to b5!
`;

const SUMMARY = {
  isLesson: true,
  summary: 'Noa learned pins and found the Bb5 pin herself.',
  topic: 'Pins',
  topics: ['Pins'],
  exercises: '- Find the pin',
  games: '',
  successes: 'Noa found Bb5.',
  difficulties: '',
  homework: 'Three pin puzzles',
  nextSteps: 'Skewers'
};

function json(cookie, body, method = 'POST') {
  return { method, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body) };
}

// Zoom's OAuth and API, its file downloads and Claude's Messages API. Each
// meeting instance is { uuid, start_time, transcript }; a missing
// transcript is one Zoom has not finished yet.
function startStub() {
  const state = { instances: [], claudeCalls: [], downloads: 0 };
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const send = (status, data, type = 'application/json') => {
        res.writeHead(status, { 'Content-Type': type });
        res.end(type === 'application/json' ? JSON.stringify(data) : data);
      };
      const url = new URL(req.url, 'http://stub');
      if (req.method === 'POST' && url.pathname === '/oauth/token') return send(200, { access_token: 'zoom-token', expires_in: 3600 });
      if (req.method === 'POST' && url.pathname === '/v1/messages') {
        state.claudeCalls.push({ headers: req.headers, body: JSON.parse(body) });
        return send(200, { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(state.summary || SUMMARY) }] });
      }
      if (req.headers.authorization !== 'Bearer zoom-token') return send(401, { message: 'Invalid access token.' });
      if (url.pathname === `/v2/past_meetings/${MEETING}/instances`) {
        return send(200, { meetings: state.instances.map(({ uuid, start_time }) => ({ uuid, start_time })) });
      }
      const recording = /^\/v2\/meetings\/(.+)\/recordings$/.exec(url.pathname);
      if (recording) {
        const instance = state.instances.find((entry) => entry.uuid === decodeURIComponent(decodeURIComponent(recording[1])));
        if (!instance?.transcript) return send(404, { code: 3301, message: 'This recording does not exist.' });
        return send(200, { recording_files: [
          { file_type: 'MP4', status: 'completed', download_url: `${stub.base}/rec/download/video` },
          { file_type: 'TRANSCRIPT', status: 'completed', download_url: `${stub.base}/rec/download/${encodeURIComponent(instance.uuid)}` }
        ] });
      }
      const download = /^\/rec\/download\/(.+)$/.exec(url.pathname);
      if (download) {
        state.downloads += 1;
        const instance = state.instances.find((entry) => entry.uuid === decodeURIComponent(download[1]));
        return instance?.transcript ? send(200, instance.transcript, 'text/vtt') : send(404, { message: 'missing' });
      }
      send(404, { message: `stub has no ${req.method} ${url.pathname}` });
    });
  });
  const stub = { state };
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    stub.base = `http://127.0.0.1:${server.address().port}`;
    stub.close = () => new Promise((done) => server.close(done));
    resolve(stub);
  }));
}

describe('lesson summaries from Zoom', () => {
  let stub;
  let server;
  let admin;

  const run = async (now) => {
    const response = await server.fetch('/api/debug/lesson-summaries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ now, fresh: true }) });
    assert.equal(response.status, 200);
    return (await response.json()).summary;
  };
  const lessonsOf = async (studentId) => (await (await server.fetch(`/api/business/lessons?studentId=${studentId}`, { headers: { Cookie: admin.cookie } })).json()).lessons;
  const createStudent = async (firstName) => {
    const response = await server.fetch('/api/business/students', json(admin.cookie, { firstName, lastName: 'Cohen', age: 9, status: 'active', language: 'en', timezone: 'Asia/Jerusalem', joinedAt: '2026-01-01' }));
    assert.equal(response.status, 200, await response.clone().text());
    return (await response.json()).student;
  };
  // A one-off private lesson in the Zoom meeting, at a local time in Israel.
  const createLesson = async (studentId, date, startTime, zoomLink = `https://us02web.zoom.us/j/${MEETING}?pwd=abc`) => {
    const response = await server.fetch('/api/business/events', json(admin.cookie, { kind: 'private', date, startTime, durationMinutes: 45, studentId, zoomLink }));
    assert.equal(response.status, 200, await response.clone().text());
  };

  before(async () => {
    stub = await startStub();
    server = await startServer({
      ...devEnv,
      ZOOM_ACCOUNT_ID: 'acc',
      ZOOM_CLIENT_ID: 'client',
      ZOOM_CLIENT_SECRET: 'secret',
      ZOOM_OAUTH_BASE: stub.base,
      ZOOM_API_BASE: `${stub.base}/v2`,
      ANTHROPIC_API_KEY: 'test-key',
      ANTHROPIC_API_BASE: stub.base
    });
    admin = await signIn(server, ADMIN);
  });

  after(async () => {
    await server?.stop();
    await stub?.close();
  });

  it('says on the settings page that Zoom and Claude are set up', async () => {
    const data = await (await server.fetch('/api/business/settings', { headers: { Cookie: admin.cookie } })).json();
    assert.deepEqual(data.lessonSummaries, { zoom: true, claude: true });
  });

  it('waits for the transcript, then logs the lesson from it once', async () => {
    const student = await createStudent('Noa');
    // 17:00 in Israel on 8 November is 15:00 UTC; the lesson ends at 15:45.
    await createLesson(student.id, '2026-11-08', '17:00');
    stub.state.instances = [{ uuid: 'inst/A==', start_time: '2026-11-08T14:58:10Z' }];

    // Still in the lesson: nothing is looked at.
    assert.equal((await run('2026-11-08T15:30:00Z')).checked, 0);

    // Over, but Zoom has no transcript yet: Claude is not asked.
    const early = await run('2026-11-08T16:00:00Z');
    assert.equal(early.waiting, 1);
    assert.equal(stub.state.claudeCalls.length, 0);
    assert.equal((await lessonsOf(student.id)).length, 0);

    stub.state.instances[0].transcript = TRANSCRIPT;
    const done = await run('2026-11-08T17:00:00Z');
    assert.equal(done.filled, 1, JSON.stringify(done));

    const [lesson] = await lessonsOf(student.id);
    assert.equal(lesson.date, '2026-11-08');
    assert.equal(lesson.startTime, '17:00');
    assert.equal(lesson.kind, 'private');
    assert.equal(lesson.status, 'held');
    assert.deepEqual(lesson.studentIds, [student.id]);
    assert.equal(lesson.topic, 'Pins');
    assert.equal(lesson.homework, 'Three pin puzzles');
    assert.equal(lesson.nextSteps, 'Skewers');
    assert.equal(lesson.aiSummary, SUMMARY.summary);
    assert.equal(lesson.zoomMeetingUuid, 'inst/A==');
    assert.ok(lesson.aiSummaryAt);

    // Claude got the transcript as lines, the lesson's details, the
    // student's language and a schema for the answer.
    const call = stub.state.claudeCalls[0];
    assert.equal(call.headers['x-api-key'], 'test-key');
    assert.equal(call.body.model, 'claude-opus-5');
    assert.equal(call.body.output_config.format.type, 'json_schema');
    const prompt = call.body.messages[0].content;
    assert.match(prompt, /Dolev: Today we learn about pins\. Find the pin in this position\.\nNoa Cohen: Bishop to b5!/);
    assert.match(prompt, /Students: Noa Cohen/);
    assert.match(prompt, /in English/);

    // The lesson is no longer waiting for a summary, so it is not done again.
    assert.equal((await run('2026-11-08T18:00:00Z')).checked, 0);
    assert.equal(stub.state.claudeCalls.length, 1);
    assert.equal((await lessonsOf(student.id)).length, 1);
  });

  it('fills only what a teacher left empty in a lesson they logged', async () => {
    const student = await createStudent('Itai');
    await createLesson(student.id, '2026-11-09', '18:00');
    const logged = await server.fetch('/api/business/lessons', json(admin.cookie, { date: '2026-11-09', startTime: '18:00', kind: 'private', studentIds: [student.id], topic: 'Opening principles', homework: '' }));
    assert.equal(logged.status, 200, await logged.clone().text());
    stub.state.instances = [{ uuid: 'inst-B', start_time: '2026-11-09T16:01:00Z', transcript: TRANSCRIPT }];

    assert.equal((await run('2026-11-09T17:30:00Z')).filled, 1);
    const lessons = await lessonsOf(student.id);
    assert.equal(lessons.length, 1);
    assert.equal(lessons[0].topic, 'Opening principles');
    assert.equal(lessons[0].homework, 'Three pin puzzles');
    assert.equal(lessons[0].aiSummary, SUMMARY.summary);

    // Editing the lesson afterwards keeps the summary.
    const edited = await server.fetch(`/api/business/lessons/${lessons[0].id}`, json(admin.cookie, { notes: 'Good focus', aiSummary: 'overwritten' }, 'PATCH'));
    assert.equal(edited.status, 200);
    assert.equal((await edited.json()).lesson.aiSummary, SUMMARY.summary);
  });

  it('leaves a meeting that was not a lesson, and lessons without a meeting number', async () => {
    const student = await createStudent('Maya');
    await createLesson(student.id, '2026-11-10', '09:00');
    const other = await createStudent('Ron');
    await createLesson(other.id, '2026-11-10', '09:00', 'https://zoom.us/my/dolev');
    stub.state.instances = [{ uuid: 'inst-C', start_time: '2026-11-10T07:00:00Z', transcript: TRANSCRIPT }];
    stub.state.summary = { ...SUMMARY, isLesson: false };
    try {
      const result = await run('2026-11-10T08:30:00Z');
      assert.equal(result.checked, 1);
      assert.equal(result.skipped, 1);
      assert.equal((await lessonsOf(student.id)).length, 0);
      assert.equal((await lessonsOf(other.id)).length, 0);
    } finally {
      delete stub.state.summary;
    }
  });
});
