// Persistence for the business-management side of the portal: students,
// lessons, payments, prospects, teaching content, expenses, one-off schedule
// events, message log, the teachers list and settings.
//
// Each table is described once (column name, type) and a small generic layer
// handles insert / update / get / list / delete, so adding a field is a one
// line change here plus its normaliser in lib/business.mjs. Columns stay flat
// so the database remains inspectable with the sqlite3 CLI; only lists and
// maps are JSON.
//
// Groups keep living in the `groups` table that the member portal owns
// (title, members, schedule, zoom link). The business profile of a group
// (age and level range, language, teacher, price) is a separate
// table keyed by group id, because the portal rewrites the whole `groups`
// table on every edit and would drop extra columns.

import { randomBytes } from 'node:crypto';

import { getDatabase, runInTransaction } from './db.mjs';

// ---------------------------------------------------------------- schema

const SCHEMA = `
CREATE TABLE IF NOT EXISTS students (
  id                   TEXT PRIMARY KEY,
  first_name           TEXT NOT NULL DEFAULT '',
  last_name            TEXT NOT NULL DEFAULT '',
  age                  INTEGER,
  birth_date           TEXT NOT NULL DEFAULT '',
  country              TEXT NOT NULL DEFAULT '',
  timezone             TEXT NOT NULL DEFAULT '',
  language             TEXT NOT NULL DEFAULT 'he',
  parent_name          TEXT NOT NULL DEFAULT '',
  parent_phone         TEXT NOT NULL DEFAULT '',
  parent_phone_2       TEXT NOT NULL DEFAULT '',
  parent_email         TEXT NOT NULL DEFAULT '',
  level                TEXT NOT NULL DEFAULT 'beginner',
  chesscom_username    TEXT NOT NULL DEFAULT '',
  chesscom_rating      INTEGER,
  group_id             TEXT NOT NULL DEFAULT '',
  teacher              TEXT NOT NULL DEFAULT '',
  lesson_type          TEXT NOT NULL DEFAULT 'group',
  private_schedule     TEXT NOT NULL DEFAULT '[]',
  private_zoom_link    TEXT NOT NULL DEFAULT '',
  joined_at            TEXT NOT NULL DEFAULT '',
  left_at              TEXT NOT NULL DEFAULT '',
  status               TEXT NOT NULL DEFAULT 'active',
  topics_learned       TEXT NOT NULL DEFAULT '[]',
  strengths            TEXT NOT NULL DEFAULT '',
  weaknesses           TEXT NOT NULL DEFAULT '',
  goals                TEXT NOT NULL DEFAULT '',
  notes                TEXT NOT NULL DEFAULT '',
  price                REAL,
  currency             TEXT NOT NULL DEFAULT 'ILS',
  billing_type         TEXT NOT NULL DEFAULT 'monthly',
  package_size         INTEGER,
  billing_day          INTEGER,
  payment_terms        TEXT NOT NULL DEFAULT '',
  next_payment_at      TEXT NOT NULL DEFAULT '',
  reminders_enabled    INTEGER NOT NULL DEFAULT 1,
  reminder_lead_hours  INTEGER,
  user_phone           TEXT NOT NULL DEFAULT '',
  source               TEXT NOT NULL DEFAULT '',
  lead_id              TEXT NOT NULL DEFAULT '',
  created_at           TEXT NOT NULL DEFAULT '',
  updated_at           TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS students_group_idx ON students(group_id);
CREATE INDEX IF NOT EXISTS students_status_idx ON students(status);

CREATE TABLE IF NOT EXISTS group_profiles (
  group_id      TEXT PRIMARY KEY,
  -- Unused: every group's capacity is the maxGroupSize setting.
  max_students  INTEGER NOT NULL DEFAULT 5,
  min_age       INTEGER,
  max_age       INTEGER,
  level         TEXT NOT NULL DEFAULT '',
  rating_min    INTEGER,
  rating_max    INTEGER,
  language      TEXT NOT NULL DEFAULT 'he',
  teacher       TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'active',
  price         REAL,
  currency      TEXT NOT NULL DEFAULT 'ILS',
  description   TEXT NOT NULL DEFAULT '',
  updated_at    TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS lessons (
  id               TEXT PRIMARY KEY,
  date             TEXT NOT NULL DEFAULT '',
  start_time       TEXT NOT NULL DEFAULT '',
  duration_minutes INTEGER,
  kind             TEXT NOT NULL DEFAULT 'group',
  group_id         TEXT NOT NULL DEFAULT '',
  student_ids      TEXT NOT NULL DEFAULT '[]',
  teacher          TEXT NOT NULL DEFAULT '',
  topic            TEXT NOT NULL DEFAULT '',
  topics           TEXT NOT NULL DEFAULT '[]',
  exercises        TEXT NOT NULL DEFAULT '',
  games            TEXT NOT NULL DEFAULT '',
  successes        TEXT NOT NULL DEFAULT '',
  difficulties     TEXT NOT NULL DEFAULT '',
  homework         TEXT NOT NULL DEFAULT '',
  next_steps       TEXT NOT NULL DEFAULT '',
  notes            TEXT NOT NULL DEFAULT '',
  raw_summary      TEXT NOT NULL DEFAULT '',
  attendance       TEXT NOT NULL DEFAULT '{}',
  status           TEXT NOT NULL DEFAULT 'held',
  created_by       TEXT NOT NULL DEFAULT '',
  created_at       TEXT NOT NULL DEFAULT '',
  updated_at       TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS lessons_date_idx ON lessons(date DESC);
CREATE INDEX IF NOT EXISTS lessons_group_idx ON lessons(group_id);

CREATE TABLE IF NOT EXISTS payments (
  id              TEXT PRIMARY KEY,
  student_id      TEXT NOT NULL DEFAULT '',
  amount          REAL NOT NULL DEFAULT 0,
  currency        TEXT NOT NULL DEFAULT 'ILS',
  paid_at         TEXT NOT NULL DEFAULT '',
  method          TEXT NOT NULL DEFAULT '',
  period_label    TEXT NOT NULL DEFAULT '',
  lessons_count   INTEGER,
  receipt_issued  INTEGER NOT NULL DEFAULT 0,
  receipt_number  TEXT NOT NULL DEFAULT '',
  notes           TEXT NOT NULL DEFAULT '',
  created_by      TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS payments_student_idx ON payments(student_id);
CREATE INDEX IF NOT EXISTS payments_paid_idx ON payments(paid_at DESC);

CREATE TABLE IF NOT EXISTS leads (
  id                    TEXT PRIMARY KEY,
  parent_name           TEXT NOT NULL DEFAULT '',
  parent_phone          TEXT NOT NULL DEFAULT '',
  parent_email          TEXT NOT NULL DEFAULT '',
  child_name            TEXT NOT NULL DEFAULT '',
  child_age             INTEGER,
  level                 TEXT NOT NULL DEFAULT '',
  chesscom_rating       INTEGER,
  language              TEXT NOT NULL DEFAULT 'he',
  country               TEXT NOT NULL DEFAULT '',
  timezone              TEXT NOT NULL DEFAULT '',
  availability          TEXT NOT NULL DEFAULT '',
  preference            TEXT NOT NULL DEFAULT 'either',
  price_quoted          REAL,
  currency              TEXT NOT NULL DEFAULT 'ILS',
  source                TEXT NOT NULL DEFAULT '',
  status                TEXT NOT NULL DEFAULT 'new',
  trial_at              TEXT NOT NULL DEFAULT '',
  trial_result          TEXT NOT NULL DEFAULT '',
  next_followup_at      TEXT NOT NULL DEFAULT '',
  last_contact_at       TEXT NOT NULL DEFAULT '',
  notes                 TEXT NOT NULL DEFAULT '',
  converted_student_id  TEXT NOT NULL DEFAULT '',
  created_at            TEXT NOT NULL DEFAULT '',
  updated_at            TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS leads_status_idx ON leads(status);

CREATE TABLE IF NOT EXISTS content (
  id               TEXT PRIMARY KEY,
  kind             TEXT NOT NULL DEFAULT 'plan',
  title            TEXT NOT NULL DEFAULT '',
  topic            TEXT NOT NULL DEFAULT '',
  level            TEXT NOT NULL DEFAULT '',
  age_min          INTEGER,
  age_max          INTEGER,
  duration_minutes INTEGER,
  fen              TEXT NOT NULL DEFAULT '',
  pgn              TEXT NOT NULL DEFAULT '',
  solution         TEXT NOT NULL DEFAULT '',
  body             TEXT NOT NULL DEFAULT '',
  tags             TEXT NOT NULL DEFAULT '[]',
  verified         INTEGER NOT NULL DEFAULT 0,
  created_by       TEXT NOT NULL DEFAULT '',
  created_at       TEXT NOT NULL DEFAULT '',
  updated_at       TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS expenses (
  id           TEXT PRIMARY KEY,
  date         TEXT NOT NULL DEFAULT '',
  category     TEXT NOT NULL DEFAULT 'other',
  amount       REAL NOT NULL DEFAULT 0,
  currency     TEXT NOT NULL DEFAULT 'ILS',
  description  TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS expenses_date_idx ON expenses(date DESC);

CREATE TABLE IF NOT EXISTS schedule_events (
  id               TEXT PRIMARY KEY,
  kind             TEXT NOT NULL DEFAULT 'other',
  date             TEXT NOT NULL DEFAULT '',
  start_time       TEXT NOT NULL DEFAULT '',
  duration_minutes INTEGER,
  group_id         TEXT NOT NULL DEFAULT '',
  student_id       TEXT NOT NULL DEFAULT '',
  lead_id          TEXT NOT NULL DEFAULT '',
  title            TEXT NOT NULL DEFAULT '',
  zoom_link        TEXT NOT NULL DEFAULT '',
  note             TEXT NOT NULL DEFAULT '',
  original_date    TEXT NOT NULL DEFAULT '',
  original_time    TEXT NOT NULL DEFAULT '',
  created_at       TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS schedule_events_date_idx ON schedule_events(date);

CREATE TABLE IF NOT EXISTS messages (
  id              TEXT PRIMARY KEY,
  kind            TEXT NOT NULL DEFAULT 'other',
  channel         TEXT NOT NULL DEFAULT 'whatsapp',
  recipient_phone TEXT NOT NULL DEFAULT '',
  student_id      TEXT NOT NULL DEFAULT '',
  lead_id         TEXT NOT NULL DEFAULT '',
  reference       TEXT NOT NULL DEFAULT '',
  body            TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'drafted',
  sent_at         TEXT NOT NULL DEFAULT '',
  created_by      TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS messages_reference_idx ON messages(reference);

-- The teachers a group or a student can be assigned to. Groups, students
-- and lessons keep the teacher's name as text, so renaming a teacher here
-- renames it there too (see the teachers routes in lib/business.mjs).
CREATE TABLE IF NOT EXISTS teachers (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL DEFAULT '',
  phone       TEXT NOT NULL DEFAULT '',
  email       TEXT NOT NULL DEFAULT '',
  notes       TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT '',
  updated_at  TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

// Columns added after the first release. CREATE TABLE IF NOT EXISTS does not
// touch an existing table, so each is added with ALTER TABLE when missing.
const MIGRATIONS = [
  ['content', 'white', "TEXT NOT NULL DEFAULT ''"],
  ['content', 'black', "TEXT NOT NULL DEFAULT ''"],
  ['content', 'event', "TEXT NOT NULL DEFAULT ''"],
  ['content', 'game_date', "TEXT NOT NULL DEFAULT ''"],
  ['content', 'result', "TEXT NOT NULL DEFAULT ''"],
  ['content', 'source_file', "TEXT NOT NULL DEFAULT ''"],
  ['content', 'moves_count', 'INTEGER'],
  // Games shown in a lesson, as references into the content list:
  // [{ id, title }]. The title is a snapshot for when the game is deleted.
  ['lessons', 'game_refs', "TEXT NOT NULL DEFAULT '[]'"],
  // The parent's name split in two, so messages can greet by first name.
  // parent_name stays as the full name for lists and search.
  ['students', 'parent_first_name', "TEXT NOT NULL DEFAULT ''"],
  ['students', 'parent_last_name', "TEXT NOT NULL DEFAULT ''"],
  ['leads', 'parent_first_name', "TEXT NOT NULL DEFAULT ''"],
  ['leads', 'parent_last_name', "TEXT NOT NULL DEFAULT ''"]
];

function ensureColumns() {
  const database = getDatabase();
  for (const [table, column, definition] of MIGRATIONS) {
    const existing = database.prepare(`PRAGMA table_info(${table})`).all().some((row) => row.name === column);
    if (!existing) database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

// The teachers list arrived after groups and students already carried free
// text teacher names. Once, fill it with every name in use so existing
// assignments show up in the new dropdowns. A flag rather than "table is
// empty" keeps a deliberately emptied list empty.
function backfillTeachers() {
  const database = getDatabase();
  if (database.prepare("SELECT 1 FROM settings WHERE key = 'teachersBackfilled'").get()) return;
  const names = new Set();
  for (const table of ['group_profiles', 'students']) {
    for (const row of database.prepare(`SELECT DISTINCT teacher FROM ${table} WHERE teacher != ''`).all()) names.add(row.teacher.trim());
  }
  const now = new Date().toISOString();
  const insert = database.prepare('INSERT INTO teachers (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)');
  for (const name of names) if (name) insert.run(newId('tch'), name, now, now);
  database.prepare("INSERT INTO settings (key, value) VALUES ('teachersBackfilled', 'true')").run();
}

// Parent names used to be one free text field. Once, split the existing ones
// at the first space: the first word is the first name, the rest the last.
function backfillParentNames() {
  const database = getDatabase();
  if (database.prepare("SELECT 1 FROM settings WHERE key = 'parentNamesSplit'").get()) return;
  for (const table of ['students', 'leads']) {
    const update = database.prepare(`UPDATE ${table} SET parent_first_name = ?, parent_last_name = ? WHERE id = ?`);
    for (const row of database.prepare(`SELECT id, parent_name FROM ${table} WHERE parent_name != '' AND parent_first_name = '' AND parent_last_name = ''`).all()) {
      const [first, ...rest] = row.parent_name.trim().split(/\s+/);
      update.run(first || '', rest.join(' '), row.id);
    }
  }
  database.prepare("INSERT INTO settings (key, value) VALUES ('parentNamesSplit', 'true')").run();
}

// Students used to go through trial, active, waitlist and inactive, and
// prospects through seven stages. Now a student is simply a student (one who
// leaves is deleted) and a prospect is open until it becomes a student. Once,
// fold the old in-between states in. Inactive students and lost prospects
// keep their status and stay out of the lists.
function simplifyStatuses() {
  const database = getDatabase();
  if (database.prepare("SELECT 1 FROM settings WHERE key = 'statusesSimplified'").get()) return;
  database.prepare("UPDATE students SET status = 'active' WHERE status IN ('trial', 'waitlist')").run();
  database.prepare("UPDATE leads SET status = 'new' WHERE status NOT IN ('new', 'converted', 'lost')").run();
  database.prepare("INSERT INTO settings (key, value) VALUES ('statusesSimplified', 'true')").run();
}

let ready = false;

export function openBusinessStore() {
  if (ready) return;
  getDatabase().exec(SCHEMA);
  ensureColumns();
  backfillTeachers();
  backfillParentNames();
  simplifyStatuses();
  ready = true;
}

// ----------------------------------------------------- generic row mapping

// type: text | int | real | bool | json
const TABLES = {
  students: {
    table: 'students',
    columns: {
      id: ['id', 'text'],
      firstName: ['first_name', 'text'],
      lastName: ['last_name', 'text'],
      age: ['age', 'int'],
      birthDate: ['birth_date', 'text'],
      country: ['country', 'text'],
      timezone: ['timezone', 'text'],
      language: ['language', 'text'],
      parentName: ['parent_name', 'text'],
      parentFirstName: ['parent_first_name', 'text'],
      parentLastName: ['parent_last_name', 'text'],
      parentPhone: ['parent_phone', 'text'],
      parentPhone2: ['parent_phone_2', 'text'],
      parentEmail: ['parent_email', 'text'],
      level: ['level', 'text'],
      chesscomUsername: ['chesscom_username', 'text'],
      chesscomRating: ['chesscom_rating', 'int'],
      groupId: ['group_id', 'text'],
      teacher: ['teacher', 'text'],
      lessonType: ['lesson_type', 'text'],
      privateSchedule: ['private_schedule', 'json'],
      privateZoomLink: ['private_zoom_link', 'text'],
      joinedAt: ['joined_at', 'text'],
      leftAt: ['left_at', 'text'],
      status: ['status', 'text'],
      topicsLearned: ['topics_learned', 'json'],
      strengths: ['strengths', 'text'],
      weaknesses: ['weaknesses', 'text'],
      goals: ['goals', 'text'],
      notes: ['notes', 'text'],
      price: ['price', 'real'],
      currency: ['currency', 'text'],
      billingType: ['billing_type', 'text'],
      packageSize: ['package_size', 'int'],
      billingDay: ['billing_day', 'int'],
      paymentTerms: ['payment_terms', 'text'],
      nextPaymentAt: ['next_payment_at', 'text'],
      remindersEnabled: ['reminders_enabled', 'bool'],
      reminderLeadHours: ['reminder_lead_hours', 'int'],
      userPhone: ['user_phone', 'text'],
      source: ['source', 'text'],
      leadId: ['lead_id', 'text'],
      createdAt: ['created_at', 'text'],
      updatedAt: ['updated_at', 'text']
    },
    order: 'first_name, last_name'
  },
  groupProfiles: {
    table: 'group_profiles',
    key: 'group_id',
    columns: {
      groupId: ['group_id', 'text'],
      minAge: ['min_age', 'int'],
      maxAge: ['max_age', 'int'],
      level: ['level', 'text'],
      ratingMin: ['rating_min', 'int'],
      ratingMax: ['rating_max', 'int'],
      language: ['language', 'text'],
      teacher: ['teacher', 'text'],
      status: ['status', 'text'],
      price: ['price', 'real'],
      currency: ['currency', 'text'],
      description: ['description', 'text'],
      updatedAt: ['updated_at', 'text']
    },
    order: 'group_id'
  },
  lessons: {
    table: 'lessons',
    columns: {
      id: ['id', 'text'],
      date: ['date', 'text'],
      startTime: ['start_time', 'text'],
      durationMinutes: ['duration_minutes', 'int'],
      kind: ['kind', 'text'],
      groupId: ['group_id', 'text'],
      studentIds: ['student_ids', 'json'],
      teacher: ['teacher', 'text'],
      topic: ['topic', 'text'],
      topics: ['topics', 'json'],
      exercises: ['exercises', 'text'],
      games: ['games', 'text'],
      gameRefs: ['game_refs', 'json'],
      successes: ['successes', 'text'],
      difficulties: ['difficulties', 'text'],
      homework: ['homework', 'text'],
      nextSteps: ['next_steps', 'text'],
      notes: ['notes', 'text'],
      rawSummary: ['raw_summary', 'text'],
      attendance: ['attendance', 'json'],
      status: ['status', 'text'],
      createdBy: ['created_by', 'text'],
      createdAt: ['created_at', 'text'],
      updatedAt: ['updated_at', 'text']
    },
    order: 'date DESC, start_time DESC, created_at DESC'
  },
  payments: {
    table: 'payments',
    columns: {
      id: ['id', 'text'],
      studentId: ['student_id', 'text'],
      amount: ['amount', 'real'],
      currency: ['currency', 'text'],
      paidAt: ['paid_at', 'text'],
      method: ['method', 'text'],
      periodLabel: ['period_label', 'text'],
      lessonsCount: ['lessons_count', 'int'],
      receiptIssued: ['receipt_issued', 'bool'],
      receiptNumber: ['receipt_number', 'text'],
      notes: ['notes', 'text'],
      createdBy: ['created_by', 'text'],
      createdAt: ['created_at', 'text']
    },
    order: 'paid_at DESC, created_at DESC'
  },
  leads: {
    table: 'leads',
    columns: {
      id: ['id', 'text'],
      parentName: ['parent_name', 'text'],
      parentFirstName: ['parent_first_name', 'text'],
      parentLastName: ['parent_last_name', 'text'],
      parentPhone: ['parent_phone', 'text'],
      parentEmail: ['parent_email', 'text'],
      childName: ['child_name', 'text'],
      childAge: ['child_age', 'int'],
      level: ['level', 'text'],
      chesscomRating: ['chesscom_rating', 'int'],
      language: ['language', 'text'],
      country: ['country', 'text'],
      timezone: ['timezone', 'text'],
      availability: ['availability', 'text'],
      preference: ['preference', 'text'],
      priceQuoted: ['price_quoted', 'real'],
      currency: ['currency', 'text'],
      source: ['source', 'text'],
      status: ['status', 'text'],
      trialAt: ['trial_at', 'text'],
      trialResult: ['trial_result', 'text'],
      nextFollowupAt: ['next_followup_at', 'text'],
      lastContactAt: ['last_contact_at', 'text'],
      notes: ['notes', 'text'],
      convertedStudentId: ['converted_student_id', 'text'],
      createdAt: ['created_at', 'text'],
      updatedAt: ['updated_at', 'text']
    },
    order: 'created_at DESC'
  },
  content: {
    table: 'content',
    columns: {
      id: ['id', 'text'],
      kind: ['kind', 'text'],
      title: ['title', 'text'],
      topic: ['topic', 'text'],
      level: ['level', 'text'],
      ageMin: ['age_min', 'int'],
      ageMax: ['age_max', 'int'],
      durationMinutes: ['duration_minutes', 'int'],
      fen: ['fen', 'text'],
      pgn: ['pgn', 'text'],
      solution: ['solution', 'text'],
      body: ['body', 'text'],
      tags: ['tags', 'json'],
      verified: ['verified', 'bool'],
      white: ['white', 'text'],
      black: ['black', 'text'],
      event: ['event', 'text'],
      gameDate: ['game_date', 'text'],
      result: ['result', 'text'],
      sourceFile: ['source_file', 'text'],
      movesCount: ['moves_count', 'int'],
      createdBy: ['created_by', 'text'],
      createdAt: ['created_at', 'text'],
      updatedAt: ['updated_at', 'text']
    },
    order: 'updated_at DESC'
  },
  expenses: {
    table: 'expenses',
    columns: {
      id: ['id', 'text'],
      date: ['date', 'text'],
      category: ['category', 'text'],
      amount: ['amount', 'real'],
      currency: ['currency', 'text'],
      description: ['description', 'text'],
      createdAt: ['created_at', 'text']
    },
    order: 'date DESC'
  },
  scheduleEvents: {
    table: 'schedule_events',
    columns: {
      id: ['id', 'text'],
      kind: ['kind', 'text'],
      date: ['date', 'text'],
      startTime: ['start_time', 'text'],
      durationMinutes: ['duration_minutes', 'int'],
      groupId: ['group_id', 'text'],
      studentId: ['student_id', 'text'],
      leadId: ['lead_id', 'text'],
      title: ['title', 'text'],
      zoomLink: ['zoom_link', 'text'],
      note: ['note', 'text'],
      originalDate: ['original_date', 'text'],
      originalTime: ['original_time', 'text'],
      createdAt: ['created_at', 'text']
    },
    order: 'date, start_time'
  },
  teachers: {
    table: 'teachers',
    columns: {
      id: ['id', 'text'],
      name: ['name', 'text'],
      phone: ['phone', 'text'],
      email: ['email', 'text'],
      notes: ['notes', 'text'],
      createdAt: ['created_at', 'text'],
      updatedAt: ['updated_at', 'text']
    },
    order: 'name COLLATE NOCASE'
  },
  messages: {
    table: 'messages',
    columns: {
      id: ['id', 'text'],
      kind: ['kind', 'text'],
      channel: ['channel', 'text'],
      recipientPhone: ['recipient_phone', 'text'],
      studentId: ['student_id', 'text'],
      leadId: ['lead_id', 'text'],
      reference: ['reference', 'text'],
      body: ['body', 'text'],
      status: ['status', 'text'],
      sentAt: ['sent_at', 'text'],
      createdBy: ['created_by', 'text'],
      createdAt: ['created_at', 'text']
    },
    order: 'created_at DESC'
  }
};

function toColumn(type, value) {
  switch (type) {
    case 'int': {
      if (value === null || value === undefined || value === '') return null;
      const parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) ? parsed : null;
    }
    case 'real': {
      if (value === null || value === undefined || value === '') return null;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    case 'bool':
      return value ? 1 : 0;
    case 'json':
      return JSON.stringify(value ?? null);
    default:
      return value === null || value === undefined ? '' : String(value);
  }
}

function fromColumn(type, value) {
  switch (type) {
    case 'int':
    case 'real':
      return value === null || value === undefined ? null : Number(value);
    case 'bool':
      return value === 1 || value === true;
    case 'json': {
      try {
        return JSON.parse(value);
      } catch {
        return null;
      }
    }
    default:
      return value ?? '';
  }
}

function rowToRecord(spec, row) {
  if (!row) return null;
  const record = {};
  for (const [field, [column, type]] of Object.entries(spec.columns)) {
    record[field] = fromColumn(type, row[column]);
  }
  return record;
}

function keyColumn(spec) {
  return spec.key || 'id';
}

export function newId(prefix = '') {
  const id = randomBytes(8).toString('hex');
  return prefix ? `${prefix}_${id}` : id;
}

function listRows(spec, { where = '', params = [], order = spec.order, limit = 0 } = {}) {
  const sql = `SELECT * FROM ${spec.table}${where ? ` WHERE ${where}` : ''}${order ? ` ORDER BY ${order}` : ''}${limit ? ` LIMIT ${Number(limit)}` : ''}`;
  return getDatabase().prepare(sql).all(...params).map((row) => rowToRecord(spec, row));
}

function getRow(spec, id) {
  const row = getDatabase().prepare(`SELECT * FROM ${spec.table} WHERE ${keyColumn(spec)} = ?`).get(String(id));
  return rowToRecord(spec, row);
}

// Insert or replace a whole record. Callers pass a fully normalised record,
// so every column is written and no stale value lingers.
function putRow(spec, record) {
  const columns = [];
  const placeholders = [];
  const values = [];
  for (const [field, [column, type]] of Object.entries(spec.columns)) {
    columns.push(column);
    placeholders.push('?');
    values.push(toColumn(type, record[field]));
  }
  getDatabase()
    .prepare(`INSERT OR REPLACE INTO ${spec.table} (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`)
    .run(...values);
  return record;
}

function deleteRow(spec, id) {
  return getDatabase().prepare(`DELETE FROM ${spec.table} WHERE ${keyColumn(spec)} = ?`).run(String(id)).changes > 0;
}

function countRows(spec, where = '', params = []) {
  return getDatabase().prepare(`SELECT COUNT(*) AS count FROM ${spec.table}${where ? ` WHERE ${where}` : ''}`).get(...params).count;
}

// --------------------------------------------------------------- students

export const students = {
  list: (options) => listRows(TABLES.students, options),
  get: (id) => getRow(TABLES.students, id),
  put: (record) => putRow(TABLES.students, record),
  remove: (id) => deleteRow(TABLES.students, id),
  count: (where, params) => countRows(TABLES.students, where, params)
};

export const groupProfiles = {
  list: (options) => listRows(TABLES.groupProfiles, options),
  get: (groupId) => getRow(TABLES.groupProfiles, groupId),
  put: (record) => putRow(TABLES.groupProfiles, record),
  remove: (groupId) => deleteRow(TABLES.groupProfiles, groupId)
};

export const lessons = {
  list: (options) => listRows(TABLES.lessons, options),
  get: (id) => getRow(TABLES.lessons, id),
  put: (record) => putRow(TABLES.lessons, record),
  remove: (id) => deleteRow(TABLES.lessons, id)
};

export const payments = {
  list: (options) => listRows(TABLES.payments, options),
  get: (id) => getRow(TABLES.payments, id),
  put: (record) => putRow(TABLES.payments, record),
  remove: (id) => deleteRow(TABLES.payments, id)
};

export const leads = {
  list: (options) => listRows(TABLES.leads, options),
  get: (id) => getRow(TABLES.leads, id),
  put: (record) => putRow(TABLES.leads, record),
  remove: (id) => deleteRow(TABLES.leads, id)
};

export const content = {
  list: (options) => listRows(TABLES.content, options),
  get: (id) => getRow(TABLES.content, id),
  put: (record) => putRow(TABLES.content, record),
  remove: (id) => deleteRow(TABLES.content, id)
};

export const expenses = {
  list: (options) => listRows(TABLES.expenses, options),
  get: (id) => getRow(TABLES.expenses, id),
  put: (record) => putRow(TABLES.expenses, record),
  remove: (id) => deleteRow(TABLES.expenses, id)
};

export const scheduleEvents = {
  list: (options) => listRows(TABLES.scheduleEvents, options),
  get: (id) => getRow(TABLES.scheduleEvents, id),
  put: (record) => putRow(TABLES.scheduleEvents, record),
  remove: (id) => deleteRow(TABLES.scheduleEvents, id)
};

export const teachers = {
  list: (options) => listRows(TABLES.teachers, options),
  get: (id) => getRow(TABLES.teachers, id),
  put: (record) => putRow(TABLES.teachers, record),
  remove: (id) => deleteRow(TABLES.teachers, id)
};

export const messages = {
  list: (options) => listRows(TABLES.messages, options),
  get: (id) => getRow(TABLES.messages, id),
  put: (record) => putRow(TABLES.messages, record),
  remove: (id) => deleteRow(TABLES.messages, id)
};

// --------------------------------------------------------------- settings

export function getSetting(key, fallback = null) {
  const row = getDatabase().prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value);
  } catch {
    return fallback;
  }
}

export function setSetting(key, value) {
  getDatabase()
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value ?? null));
}

export function listSettings() {
  const out = {};
  for (const row of getDatabase().prepare('SELECT key, value FROM settings').all()) {
    try {
      out[row.key] = JSON.parse(row.value);
    } catch {
      // Skip a corrupt value rather than failing every settings read.
    }
  }
  return out;
}

export const transaction = runInTransaction;

export function isBusinessStoreEmpty() {
  return countRows(TABLES.students) === 0 && countRows(TABLES.leads) === 0 && countRows(TABLES.lessons) === 0;
}
