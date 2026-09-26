// Boots the real server as a child process against a throwaway data directory,
// so tests exercise HTTP behaviour rather than internals.

import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER = fileURLToPath(new URL('../server.mjs', import.meta.url));

let nextPort = 8300 + Math.floor(Math.random() * 400);

export async function startServer(env = {}) {
  const port = nextPort++;
  const dataDir = await mkdtemp(join(tmpdir(), 'yalla-test-'));

  const child = spawn(process.execPath, [SERVER], {
    env: {
      // A bare environment, so a stray variable on the developer's machine
      // cannot change what the tests observe.
      PATH: process.env.PATH,
      PORT: String(port),
      HOST: '127.0.0.1',
      DATA_DIR: dataDir,
      ...env
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });

  const base = `http://127.0.0.1:${port}`;
  const exited = new Promise((resolve) => child.once('exit', (code) => resolve(code)));

  const server = {
    base,
    port,
    dataDir,
    get output() { return output; },
    exited,
    async fetch(path, init) {
      return fetch(`${base}${path}`, { redirect: 'manual', ...init });
    },
    // Stop the process and remove the data directory.
    async stop() {
      await server.stopKeepingData();
      await server.cleanup();
    },
    // Stop the process but leave the database in place, so another process can
    // be started against the same data.
    async stopKeepingData() {
      if (child.exitCode === null) {
        child.kill('SIGTERM');
        await Promise.race([exited, new Promise((r) => setTimeout(r, 4000))]);
        if (child.exitCode === null) child.kill('SIGKILL');
      }
    },
    async cleanup() {
      await rm(dataDir, { recursive: true, force: true });
    }
  };

  // Wait for readiness rather than sleeping a fixed amount.
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) return { ...server, bootFailed: true, exitCode: child.exitCode };
    try {
      const response = await fetch(`${base}/healthz`);
      if (response.ok) return server;
    } catch {
      // Not listening yet.
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  await server.stop();
  throw new Error(`server did not become ready:\n${output}`);
}

// Boots a second process on the same port and data directory, to assert that
// state survives a restart.
export async function restartOnSameData({ port, dataDir, env = {} }) {
  const child = spawn(process.execPath, [SERVER], {
    env: { PATH: process.env.PATH, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dataDir, ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let output = '';
  child.stdout.on('data', (c) => { output += c; });
  child.stderr.on('data', (c) => { output += c; });

  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/healthz`);
      if (response.ok) {
        return {
          base,
          get output() { return output; },
          fetch: (path, init) => fetch(`${base}${path}`, { redirect: 'manual', ...init }),
          async stop() {
            child.kill('SIGTERM');
            await new Promise((r) => { child.once('exit', r); setTimeout(r, 4000); });
          }
        };
      }
    } catch {
      // Not listening yet.
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  child.kill('SIGKILL');
  throw new Error(`restarted server did not become ready:\n${output}`);
}

const DEV_ENV = {
  TWILIO_ALLOW_CONSOLE_FALLBACK: 'true',
  ENABLE_DEBUG_ENDPOINTS: 'true',
  LOG_LEVEL: 'debug'
};

export const devEnv = DEV_ENV;

// Completes a real OTP login and returns the session cookie.
export async function signIn(server, phone) {
  const start = await server.fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone })
  });

  const started = await start.json();
  if (!started.ok) throw new Error(`login failed: ${started.error}`);

  const peek = await server.fetch(`/api/debug/otp?phone=${encodeURIComponent(phone)}`);
  const challenge = await peek.json();

  const verify = await server.fetch('/api/login/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, challengeId: started.challengeId, code: challenge.code })
  });

  if (!verify.ok) throw new Error(`verify failed: ${verify.status}`);

  const raw = verify.headers.getSetCookie?.()[0] || verify.headers.get('set-cookie') || '';
  const match = /yalla_session=([^;]+)/.exec(raw);
  if (!match) throw new Error('no session cookie returned');

  return { cookie: `yalla_session=${match[1]}`, setCookie: raw };
}
