// Persistence, backed by SQLite through node:sqlite (no external dependency).
//
// Replaces reading and rewriting whole JSON files. Two problems that fixes:
// data now survives a restart (sessions included), and each collection
// rewrite is a single transaction rather than a truncate-and-write that can
// interleave with another request. Callers must still hold the write lock in
// lib/mutex.mjs around read-modify-write sequences.
//
// Users are flat columns so the database stays inspectable with the sqlite3
// CLI. Group titles, members and schedules keep their nested shape as JSON,
// so the normalisation rules stay in one place in server.mjs.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { config } from './config.mjs';
import { logInfo, logWarn } from './log.mjs';

let db = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  username       TEXT PRIMARY KEY,
  role           TEXT NOT NULL,
  phone          TEXT NOT NULL DEFAULT '',
  contact_email  TEXT NOT NULL DEFAULT '',
  first_name     TEXT NOT NULL DEFAULT '',
  last_name      TEXT NOT NULL DEFAULT '',
  payment_status TEXT NOT NULL DEFAULT 'paid',
  plan_name      TEXT NOT NULL DEFAULT '',
  paid_until     TEXT NOT NULL DEFAULT '',
  notes          TEXT NOT NULL DEFAULT '',
  sort_order     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS users_phone_idx ON users(phone);

CREATE TABLE IF NOT EXISTS groups (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL DEFAULT '{}',
  members    TEXT NOT NULL DEFAULT '[]',
  schedule   TEXT NOT NULL DEFAULT '{}',
  zoom_link  TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS contact_requests (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  full_name  TEXT NOT NULL DEFAULT '',
  email      TEXT NOT NULL DEFAULT '',
  phone      TEXT NOT NULL DEFAULT '',
  message    TEXT NOT NULL DEFAULT '',
  source     TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  ip         TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS contact_requests_created_idx ON contact_requests(created_at DESC);

CREATE TABLE IF NOT EXISTS sessions (
  id                TEXT PRIMARY KEY,
  username          TEXT NOT NULL,
  role              TEXT NOT NULL,
  phone             TEXT NOT NULL DEFAULT '',
  contact_email     TEXT NOT NULL DEFAULT '',
  first_name        TEXT NOT NULL DEFAULT '',
  last_name         TEXT NOT NULL DEFAULT '',
  can_manage_groups INTEGER NOT NULL DEFAULT 0,
  expires_at        INTEGER NOT NULL,
  created_at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions(expires_at);
`;

export function openDatabase(file = config.dbFile) {
  if (db) return db;

  mkdirSync(dirname(file), { recursive: true });
  db = new DatabaseSync(file);

  // WAL keeps readers from blocking the writer; NORMAL is the right durability
  // trade-off under WAL. busy_timeout covers the brief lock held by a
  // checkpoint rather than surfacing SQLITE_BUSY to a request.
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec(SCHEMA);

  return db;
}

export function closeDatabase() {
  if (!db) return;
  try {
    // Fold the WAL back into the main file so a stopped process leaves one
    // self-contained database behind. Under a WAL replicator this is PASSIVE
    // instead, so the frames stay on disk for the replicator's final sync.
    db.exec(`PRAGMA wal_checkpoint(${config.dbCloseCheckpoint})`);
  } catch {
    // Checkpointing is best effort; closing still flushes committed data.
  }
  db.close();
  db = null;
}

function handle() {
  return db || openDatabase();
}

function transact(fn) {
  const database = handle();
  database.exec('BEGIN IMMEDIATE');
  try {
    const result = fn(database);
    database.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      database.exec('ROLLBACK');
    } catch {
      // Ignore: the original error is the one worth reporting.
    }
    throw error;
  }
}

function parseJson(value, fallback) {
  try {
    const parsed = JSON.parse(value);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

// ------------------------------------------------------------------- meta

export function getMeta(key) {
  const row = handle().prepare('SELECT value FROM meta WHERE key = ?').get(key);
  return row ? row.value : null;
}

export function setMeta(key, value) {
  handle().prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
}

// ------------------------------------------------------------------ users

export function listUsers() {
  return handle().prepare('SELECT * FROM users ORDER BY sort_order, username').all().map((row) => ({
    username: row.username,
    role: row.role,
    phone: row.phone,
    contactEmail: row.contact_email,
    firstName: row.first_name,
    lastName: row.last_name,
    paymentStatus: row.payment_status,
    planName: row.plan_name,
    paidUntil: row.paid_until,
    notes: row.notes
  }));
}

export function replaceUsers(users) {
  transact((database) => {
    database.prepare('DELETE FROM users').run();
    const insert = database.prepare(`
      INSERT INTO users (username, role, phone, contact_email, first_name, last_name,
                         payment_status, plan_name, paid_until, notes, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    users.forEach((user, index) => {
      insert.run(
        String(user.username || ''),
        String(user.role || 'student'),
        String(user.phone || ''),
        String(user.contactEmail || ''),
        String(user.firstName || ''),
        String(user.lastName || ''),
        String(user.paymentStatus || 'paid'),
        String(user.planName || ''),
        String(user.paidUntil || ''),
        String(user.notes || ''),
        index
      );
    });
  });
}

// ----------------------------------------------------------------- groups

export function listGroups() {
  return handle().prepare('SELECT * FROM groups ORDER BY sort_order, id').all().map((row) => ({
    id: row.id,
    title: parseJson(row.title, {}),
    members: parseJson(row.members, []),
    schedule: parseJson(row.schedule, {}),
    zoomLink: row.zoom_link,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by
  }));
}

export function replaceGroups(groups) {
  transact((database) => {
    database.prepare('DELETE FROM groups').run();
    const insert = database.prepare(`
      INSERT INTO groups (id, title, members, schedule, zoom_link, updated_at, updated_by, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    groups.forEach((group, index) => {
      insert.run(
        String(group.id || ''),
        JSON.stringify(group.title ?? {}),
        JSON.stringify(group.members ?? []),
        JSON.stringify(group.schedule ?? {}),
        String(group.zoomLink || ''),
        String(group.updatedAt || ''),
        String(group.updatedBy || ''),
        index
      );
    });
  });
}

// -------------------------------------------------------- contact requests

export function listContactRequests() {
  return handle().prepare('SELECT * FROM contact_requests ORDER BY created_at DESC').all().map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    message: row.message,
    source: row.source,
    userAgent: row.user_agent,
    ip: row.ip
  }));
}

export function replaceContactRequests(requests) {
  transact((database) => {
    database.prepare('DELETE FROM contact_requests').run();
    const insert = database.prepare(`
      INSERT INTO contact_requests (id, created_at, full_name, email, phone, message, source, user_agent, ip)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const request of requests) {
      insert.run(
        String(request.id || ''),
        String(request.createdAt || ''),
        String(request.fullName || ''),
        String(request.email || ''),
        String(request.phone || ''),
        String(request.message || ''),
        String(request.source || ''),
        String(request.userAgent || ''),
        String(request.ip || '')
      );
    }
  });
}

// --------------------------------------------------------------- sessions

export function insertSession(session) {
  handle().prepare(`
    INSERT INTO sessions (id, username, role, phone, contact_email, first_name, last_name,
                          can_manage_groups, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    session.id,
    String(session.username || ''),
    String(session.role || 'student'),
    String(session.phone || ''),
    String(session.contactEmail || ''),
    String(session.firstName || ''),
    String(session.lastName || ''),
    session.canManageGroups ? 1 : 0,
    session.expiresAt,
    Date.now()
  );
}

export function getSession(id) {
  const row = handle().prepare('SELECT * FROM sessions WHERE id = ?').get(id);
  if (!row) return null;

  return {
    id: row.id,
    username: row.username,
    role: row.role,
    phone: row.phone,
    contactEmail: row.contact_email,
    firstName: row.first_name,
    lastName: row.last_name,
    canManageGroups: row.can_manage_groups === 1,
    expiresAt: row.expires_at
  };
}

// Patch a live session in place, so a profile edit or an identifier change is
// reflected without forcing the person to sign in again.
export function updateSession(id, patch = {}) {
  const columns = {
    username: 'username',
    role: 'role',
    phone: 'phone',
    contactEmail: 'contact_email',
    firstName: 'first_name',
    lastName: 'last_name',
    canManageGroups: 'can_manage_groups',
    expiresAt: 'expires_at'
  };

  const assignments = [];
  const values = [];
  for (const [field, column] of Object.entries(columns)) {
    if (!(field in patch)) continue;
    assignments.push(`${column} = ?`);
    const value = patch[field];
    if (field === 'canManageGroups') values.push(value ? 1 : 0);
    else if (field === 'expiresAt') values.push(Number(value));
    else values.push(String(value ?? ''));
  }

  if (!assignments.length) return;

  values.push(id);
  handle().prepare(`UPDATE sessions SET ${assignments.join(', ')} WHERE id = ?`).run(...values);
}

export function deleteSession(id) {
  handle().prepare('DELETE FROM sessions WHERE id = ?').run(id);
}

export function deleteExpiredSessions(now = Date.now()) {
  return handle().prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now).changes;
}

// Re-point every live session at a renamed account, so an identifier change
// does not silently sign that person out or leave a stale role behind.
export function renameSessionUser(previousUsername, nextUsername) {
  handle().prepare('UPDATE sessions SET username = ? WHERE username = ?').run(nextUsername, previousUsername);
}

export function deleteSessionsForUser(username) {
  return handle().prepare('DELETE FROM sessions WHERE username = ?').run(username).changes;
}

export function countSessions() {
  return handle().prepare('SELECT COUNT(*) AS count FROM sessions').get().count;
}

// -------------------------------------------------------------- migration

// One-time import of the JSON files this app used to keep on disk. Guarded by
// a meta flag so that deleting a user does not cause them to reappear on the
// next boot. The JSON files are read but never modified.
export function seedIfEmpty({ users = [], groups = [], contactRequests = [], source = 'defaults' }) {
  if (getMeta('seeded_at')) {
    return { seeded: false };
  }

  const existingUsers = handle().prepare('SELECT COUNT(*) AS count FROM users').get().count;
  if (existingUsers > 0) {
    setMeta('seeded_at', new Date().toISOString());
    return { seeded: false };
  }

  if (users.length) replaceUsers(users);
  if (groups.length) replaceGroups(groups);
  if (contactRequests.length) replaceContactRequests(contactRequests);

  setMeta('seeded_at', new Date().toISOString());
  setMeta('seeded_from', source);

  if (users.length || groups.length || contactRequests.length) {
    logInfo('db.seeded', { source, users: users.length, groups: groups.length, contactRequests: contactRequests.length });
  } else {
    logWarn('db.seeded_empty', { source });
  }

  return { seeded: true, users: users.length, groups: groups.length, contactRequests: contactRequests.length };
}
