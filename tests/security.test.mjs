// Regression tests for the vulnerabilities found during the production audit.
// Each test names the behaviour that was broken.

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { devEnv, signIn, startServer } from './helpers.mjs';

describe('dev conveniences fail closed', () => {
  let server;
  before(async () => { server = await startServer(); });
  after(async () => { await server.stop(); });

  it('does not expose /api/debug/session without an explicit opt-in', async () => {
    // This returned a valid 180-day teacher session for any phone number,
    // with no credentials, whenever NODE_ENV was not set to production.
    const response = await server.fetch('/api/debug/session?phone=%2B972500000001');
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('set-cookie'), null);
  });

  it('does not expose /api/debug/otp without an explicit opt-in', async () => {
    const response = await server.fetch('/api/debug/otp?phone=%2B972500000001');
    assert.equal(response.status, 404);
  });

  it('refuses to send codes to the console unless asked', async () => {
    const response = await server.fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '+972500000001' })
    });

    assert.equal(response.status, 503);
    assert.ok(!/SMS OTP/.test(server.output), 'no code should be printed');
  });
});

describe('production configuration', () => {
  it('refuses to boot without SMS credentials or an https origin', async () => {
    const server = await startServer({
      NODE_ENV: 'production',
      // Deliberately set the dev escapes; production must ignore them.
      ENABLE_DEBUG_ENDPOINTS: 'true',
      TWILIO_ALLOW_CONSOLE_FALLBACK: 'true'
    });

    assert.equal(server.bootFailed, true, 'server should not have started');
    assert.equal(server.exitCode, 78, 'should exit EX_CONFIG');
    assert.match(server.output, /TWILIO_VERIFY_SERVICE_SID/);
    assert.match(server.output, /PUBLIC_ORIGIN/);
    await server.stop();
  });

  it('ignores the debug opt-in when NODE_ENV=production', async () => {
    const server = await startServer({
      NODE_ENV: 'production',
      ENABLE_DEBUG_ENDPOINTS: 'true',
      TWILIO_VERIFY_SERVICE_SID: 'VA_test',
      TWILIO_ACCOUNT_SID: 'AC_test',
      TWILIO_AUTH_TOKEN: 'token',
      PUBLIC_ORIGIN: 'https://yalla-chess.test',
      BOOTSTRAP_TEACHER_PHONE: '+972500000001'
    });

    assert.notEqual(server.bootFailed, true, `expected boot, got:\n${server.output}`);
    const response = await server.fetch('/api/debug/session?phone=%2B972500000001');
    assert.equal(response.status, 404);
    assert.match(server.output, /ignored in production/);
    await server.stop();
  });
});

describe('CORS', () => {
  let server;
  before(async () => { server = await startServer(devEnv); });
  after(async () => { await server.stop(); });

  it('does not reflect an arbitrary origin', async () => {
    // getCorsHeaders used to echo any Origin back together with
    // Access-Control-Allow-Credentials, letting any site read the API as a
    // signed-in teacher.
    const response = await server.fetch('/api/me', {
      headers: { Origin: 'https://evil.example.com' }
    });

    assert.equal(response.headers.get('access-control-allow-origin'), null);
    assert.equal(response.headers.get('access-control-allow-credentials'), null);
  });

  it('rejects a state-changing request from a disallowed origin', async () => {
    const response = await server.fetch('/api/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example.com' },
      body: JSON.stringify({ title: 'Injected' })
    });

    assert.equal(response.status, 403);
  });

  it('allows an explicitly configured origin', async () => {
    const allowed = await startServer({ ...devEnv, ALLOWED_ORIGINS: 'https://portal.example.com' });
    const response = await allowed.fetch('/api/me', {
      headers: { Origin: 'https://portal.example.com' }
    });

    assert.equal(response.headers.get('access-control-allow-origin'), 'https://portal.example.com');
    await allowed.stop();
  });
});

describe('rate limiting', () => {
  let server;
  before(async () => { server = await startServer({ ...devEnv, RATE_LIMIT_LOGIN_PER_PHONE: '3' }); });
  after(async () => { await server.stop(); });

  it('caps login attempts per phone, since each one sends a billable SMS', async () => {
    const statuses = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await server.fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: '+972500000001' })
      });
      statuses.push(response.status);
      if (response.status === 429) {
        assert.ok(response.headers.get('retry-after'), 'should say when to retry');
      }
    }

    assert.deepEqual(statuses.slice(0, 3), [200, 200, 200]);
    assert.deepEqual(statuses.slice(3), [429, 429]);
  });

  it('does not spend a real number\'s budget on unknown numbers', async () => {
    // Otherwise a third party could lock a student out by burning their quota.
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await server.fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: '+972599999999' })
      });
    }

    const response = await server.fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '+972599999999' })
    });

    assert.equal(response.status, 403, 'unknown numbers stay a 403, not a 429');
  });
});

describe('response headers', () => {
  let server;
  before(async () => { server = await startServer(devEnv); });
  after(async () => { await server.stop(); });

  it('sets security headers on the app shell', async () => {
    const response = await server.fetch('/');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.ok(response.headers.get('referrer-policy'));
  });
});

describe('authorization', () => {
  let server;
  before(async () => { server = await startServer(devEnv); });
  after(async () => { await server.stop(); });

  it('keeps a student out of teacher-only data and actions', async () => {
    const { cookie } = await signIn(server, '+972500000004');

    const dashboard = await (await server.fetch('/api/dashboard', { headers: { Cookie: cookie } })).json();
    assert.equal(dashboard.canManageUsers, false);
    assert.deepEqual(dashboard.users, [], 'a student must not receive the user list');
    for (const group of dashboard.groups) {
      assert.deepEqual(group.members, [], 'a student must not receive member identifiers');
    }

    const create = await server.fetch('/api/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ title: 'Not allowed' })
    });
    assert.equal(create.status, 403);
  });

  it('rejects unauthenticated access to the dashboard', async () => {
    const response = await server.fetch('/api/dashboard');
    assert.equal(response.status, 401);
  });

  it('invalidates the session on logout', async () => {
    const { cookie } = await signIn(server, '+972500000002');
    assert.equal((await server.fetch('/api/dashboard', { headers: { Cookie: cookie } })).status, 200);

    await server.fetch('/api/logout', { method: 'POST', headers: { Cookie: cookie } });
    assert.equal((await server.fetch('/api/dashboard', { headers: { Cookie: cookie } })).status, 401);
  });
});
