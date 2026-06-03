import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

const ROOT = process.cwd();
const PORT = Number(process.env.PORT || 8001);
const USERS_FILE = join(ROOT, 'auth-users.json');
const SESSION_COOKIE = 'yalla_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const sessions = new Map();

const DEFAULT_USERS = [
  { role: 'teacher', username: 'admin', password: 'admin123' },
  { role: 'teacher', username: 'Dolevkrav@gmail.com', password: 'pass123' },
  { role: 'student', username: 'student', password: 'student123' }
];

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.mp4': 'video/mp4',
  '.ico': 'image/x-icon'
};

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, text, contentType = 'text/plain; charset=utf-8', extraHeaders = {}) {
  res.writeHead(statusCode, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    ...extraHeaders
  });
  res.end(text);
}

function parseCookies(cookieHeader = '') {
  return cookieHeader.split(';').reduce((acc, pair) => {
    const index = pair.indexOf('=');
    if (index === -1) return acc;
    const key = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    if (key) acc[key] = decodeURIComponent(value);
    return acc;
  }, {});
}

function getCorsHeaders(req) {
  const origin = req.headers.origin;
  if (!origin) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Vary': 'Origin'
  };
}

function isCrossOriginRequest(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  return origin !== 'http://127.0.0.1:8001' && origin !== 'http://localhost:8001';
}

async function loadUsers() {
  try {
    const raw = await readFile(USERS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    const users = Array.isArray(parsed?.users) ? parsed.users : [];
    return users
      .map((user) => ({
        role: normalizeRole(user?.role),
        username: typeof user?.username === 'string' ? user.username : '',
        password: typeof user?.password === 'string' ? user.password : ''
      }))
      .filter((user) => user.role && user.username && user.password);
  } catch {
    return DEFAULT_USERS;
  }
}

async function saveUsers(users) {
  const payload = {
    users: users.map((user) => ({
      role: normalizeRole(user?.role),
      username: typeof user?.username === 'string' ? user.username : '',
      password: typeof user?.password === 'string' ? user.password : ''
    })).filter((user) => user.role && user.username && user.password)
  };

  await writeFile(USERS_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function normalizeRole(role) {
  if (role === 'teacher' || role === 'admin') return 'teacher';
  if (role === 'student') return 'student';
  return null;
}

function normalizeLoginIdentifier(value) {
  return String(value || '').trim().toLowerCase();
}

function getLoginIdentifiers(username) {
  const normalized = normalizeLoginIdentifier(username);
  const identifiers = new Set();

  if (normalized) {
    identifiers.add(normalized);
    const atIndex = normalized.indexOf('@');
    if (atIndex > 0) {
      identifiers.add(normalized.slice(0, atIndex));
    }
  }

  return identifiers;
}

function createSession(user) {
  const id = randomBytes(24).toString('hex');
  const expiresAt = Date.now() + SESSION_TTL_MS;
  sessions.set(id, {
    username: user.username,
    role: user.role,
    expiresAt
  });
  return { id, expiresAt };
}

function getSessionFromRequest(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  const sessionId = cookies[SESSION_COOKIE];
  if (!sessionId) return null;
  const session = sessions.get(sessionId);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(sessionId);
    return null;
  }
  return { id: sessionId, ...session };
}

function clearExpiredSessions() {
  const now = Date.now();
  for (const [sessionId, session] of sessions.entries()) {
    if (session.expiresAt <= now) {
      sessions.delete(sessionId);
    }
  }
}

async function readRequestBody(req, limitBytes = 16 * 1024) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body, 'utf8') > limitBytes) {
      const err = new Error('Request body too large');
      err.statusCode = 413;
      throw err;
    }
  }
  return body;
}

async function handleLogin(req, res) {
  let payload;
  try {
    payload = JSON.parse(await readRequestBody(req));
  } catch (error) {
    sendJson(res, error.statusCode || 400, { ok: false, error: 'Invalid JSON payload.' });
    return;
  }

  const username = typeof payload.username === 'string' ? payload.username.trim() : '';
  const password = typeof payload.password === 'string' ? payload.password : '';
  const remember = payload.remember !== false;

  if (!username || !password) {
    sendJson(res, 400, { ok: false, error: 'Missing username or password.' });
    return;
  }

  const users = await loadUsers();
  const loginIdentifiers = getLoginIdentifiers(username);
  const user = users.find((entry) => {
    const entryIdentifiers = getLoginIdentifiers(entry.username);
    const usernameMatches = [...loginIdentifiers].some((identifier) => entryIdentifiers.has(identifier));
    return usernameMatches && entry.password === password;
  });

  if (!user) {
    sendJson(res, 401, { ok: false, error: 'Invalid username or password.' });
    return;
  }

  const session = createSession(user);
  const crossOrigin = isCrossOriginRequest(req);
  const cookie = [
    `${SESSION_COOKIE}=${encodeURIComponent(session.id)}`,
    'HttpOnly',
    'Path=/',
    crossOrigin ? 'SameSite=None' : 'SameSite=Lax',
    crossOrigin ? 'Secure' : null,
    remember ? `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}` : null
  ].filter(Boolean).join('; ');

  sendJson(res, 200, {
    ok: true,
    user: {
      username: user.username,
      role: user.role
    }
  }, {
    ...getCorsHeaders(req),
    'Set-Cookie': cookie
  });
}

async function handleChangePassword(req, res) {
  const session = getSessionFromRequest(req);
  if (!session) {
    sendJson(res, 401, { ok: false, error: 'Not authenticated.' }, getCorsHeaders(req));
    return;
  }

  let payload;
  try {
    payload = JSON.parse(await readRequestBody(req));
  } catch (error) {
    sendJson(res, error.statusCode || 400, { ok: false, error: 'Invalid JSON payload.' }, getCorsHeaders(req));
    return;
  }

  const currentPassword = typeof payload.currentPassword === 'string' ? payload.currentPassword : '';
  const newPassword = typeof payload.newPassword === 'string' ? payload.newPassword : '';
  const users = await loadUsers();
  const userIndex = users.findIndex((entry) => entry.username === session.username);

  if (userIndex === -1) {
    sendJson(res, 404, { ok: false, error: 'Account not found.' }, getCorsHeaders(req));
    return;
  }

  if (!currentPassword || users[userIndex].password !== currentPassword) {
    sendJson(res, 401, { ok: false, error: 'Current password is incorrect.' }, getCorsHeaders(req));
    return;
  }

  if (!newPassword || newPassword.length < 6) {
    sendJson(res, 400, { ok: false, error: 'New password must be at least 6 characters.' }, getCorsHeaders(req));
    return;
  }

  users[userIndex].password = newPassword;
  await saveUsers(users);

  sendJson(res, 200, {
    ok: true,
    user: {
      username: users[userIndex].username,
      role: users[userIndex].role
    }
  }, getCorsHeaders(req));
}

function handleMe(req, res) {
  const session = getSessionFromRequest(req);
  if (!session) {
    sendJson(res, 401, { ok: false, error: 'Not authenticated.' }, getCorsHeaders(req));
    return;
  }

  sendJson(res, 200, {
    ok: true,
    user: {
      username: session.username,
      role: session.role
    }
  }, getCorsHeaders(req));
}

function handleLogout(req, res) {
  const cookies = parseCookies(req.headers.cookie || '');
  const sessionId = cookies[SESSION_COOKIE];
  if (sessionId) sessions.delete(sessionId);

  sendJson(res, 200, { ok: true }, {
    'Set-Cookie': [
    `${SESSION_COOKIE}=`,
    'HttpOnly',
    'Path=/',
    isCrossOriginRequest(req) ? 'SameSite=None' : 'SameSite=Lax',
    isCrossOriginRequest(req) ? 'Secure' : null,
    'Max-Age=0'
  ].join('; ')
  }, getCorsHeaders(req));
}

async function serveStatic(req, res, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const safePath = normalize(decodeURIComponent(requested)).replace(/^(\.\.(\/|\\|$))+/, '');
  const absolute = resolve(ROOT, `.${safePath}`);

  if (!absolute.startsWith(ROOT)) {
    sendText(res, 403, 'Forbidden');
    return;
  }

  try {
    const fileStat = await stat(absolute);
    if (!fileStat.isFile()) throw new Error('Not a file');
    const type = MIME_TYPES[extname(absolute).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': type.startsWith('text/') || type.includes('javascript') ? 'no-store' : 'public, max-age=3600'
    });
    createReadStream(absolute).pipe(res);
  } catch {
    const indexPath = join(ROOT, 'index.html');
    const type = MIME_TYPES['.html'];
    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': 'no-store'
    });
    createReadStream(indexPath).pipe(res);
  }
}

const server = createServer(async (req, res) => {
  clearExpiredSessions();

  if (!req.url) {
    sendText(res, 400, 'Bad Request');
    return;
  }

  const url = new URL(req.url, 'http://127.0.0.1');

  if (url.pathname === '/api/login' && req.method === 'POST') {
    await handleLogin(req, res);
    return;
  }

  if (url.pathname.startsWith('/api/') && req.method === 'OPTIONS') {
    sendText(res, 204, '', 'text/plain; charset=utf-8', {
      ...getCorsHeaders(req),
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Accept',
      'Access-Control-Max-Age': '600'
    });
    return;
  }

  if (url.pathname === '/api/me' && req.method === 'GET') {
    handleMe(req, res);
    return;
  }

  if (url.pathname === '/api/password' && req.method === 'POST') {
    await handleChangePassword(req, res);
    return;
  }

  if (url.pathname === '/api/logout' && req.method === 'POST') {
    handleLogout(req, res);
    return;
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    await serveStatic(req, res, url.pathname);
    return;
  }

  sendText(res, 405, 'Method Not Allowed');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Yalla-Chess server running at http://127.0.0.1:${PORT}`);
});
