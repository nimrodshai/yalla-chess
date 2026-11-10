# Yalla-Chess

[![CI](https://github.com/nimrodshai/yalla-chess/actions/workflows/ci.yml/badge.svg)](https://github.com/nimrodshai/yalla-chess/actions/workflows/ci.yml)

Landing page and member portal for Dolev's chess school. Hebrew/English,
phone-based sign-in, and a portal where teachers manage groups, schedules,
Zoom links and students.

No dependencies to install: the server is plain Node using `node:sqlite`.

## Requirements

- Node 22.13 or newer, for `node:sqlite` without an experimental flag. Node 24 is
  what this is developed against; CI covers 22.13.0, latest 22 and latest 24.
- A Twilio Verify service, for sign-in codes.
- Optionally a Resend API key, to be emailed about contact-form submissions.

## Running locally

```bash
npm run dev
```

That sets `TWILIO_ALLOW_CONSOLE_FALLBACK=true`, so sign-in codes are printed to
the terminal instead of sent by SMS, and `ENABLE_DEBUG_ENDPOINTS=true`, which
exposes `/api/debug/*`. Both are ignored when `NODE_ENV=production`.

Then open http://127.0.0.1:8001 and sign in as `+972500000001` (the admin),
`+972500000005` (a teacher, from the demo business data) or `+972500000004`
(a student). Those demo accounts are seeded only outside production.

```bash
npm test      # 57 tests against a real server on a throwaway database
npm run check # syntax check every module
```

Both run in CI on every push and pull request, alongside a Docker image build
and a guard job that fails the build if runtime data, a database or anything
credential-shaped is ever committed.

## Management app

`/admin` is the business side of the portal, for staff only: students
with full profiles, groups with capacity and level, a weekly calendar with
cancellations and reschedules, a lesson log that tracks what each student
has learned, payments (monthly or per package, ILS/USD/EUR), prospects with
trial scheduling and conversion, a content library (plans, exercises with a
FEN board, famous games), a teachers list that groups and students pick
their teacher from, monthly reports, WhatsApp message templates and a
daily brief. Sign in to the portal as staff and open the "Management"
pill, or go to `/admin` directly; it shares the session cookie.

There are two staff roles. The **admin** (the owner) sees and changes
everything, in the portal and in `/admin`. A **teacher** signs in with the
phone on their teacher record: saving a teacher with a phone creates their
account, a new phone moves it, and removing the teacher or the phone closes
it. A teacher sees only their own groups and the students in them (without
prices or payments), the calendar lessons they give, the lesson log for
their students, the content library to read, and their own pay. They log
and edit their own lessons and message their students' families about
lessons. Students, groups, payments, prospects, expenses, reports,
settings and the portal's user management stay with the admin. The server
enforces this (`ctx.teacher` in `lib/business.mjs`); the views only hide
what would be refused.

Data lives in extra tables in the same SQLite file (`lib/business-db.mjs`);
the API is `/api/business/*` (`lib/business.mjs`), the front end is plain
JavaScript under `admin/`. Group hours and the member list stay in the
portal's `groups` table; a student with a portal phone is added to their
group there automatically. In development the database is seeded with demo
students, lessons, payments and prospects (`lib/business-seed.mjs`).
Messages open WhatsApp with the text prefilled and are logged once sent;
Google Calendar sync and the assistant are the next step.

### Automatic WhatsApp reminders

The server sends two messages by itself, through Twilio's WhatsApp sender
(`lib/auto-messages.mjs`, `lib/whatsapp.mjs`): a lesson reminder at each
student's reminder time before the lesson, and a payment message on the day
the family starts to owe (a debt that started more than two days ago gets
none). It checks once a minute. Each message goes out once, logged in the
student's message history under the same reference a reminder sent by hand
gets, so neither is ever sent twice; a failed one is logged with Twilio's
reason and not retried. Nothing goes out during the quiet hours in the
family's own time zone.

Every student has their own switch (the student form, under payment), and
every student starts with it off: nothing goes out to a family until it is
turned on for them. Settings has "Turn on for everyone", which leaves out
parents who asked to stop and students whose reminders were turned off
before, and makes new students start on; "Turn off for everyone" undoes
both. A parent who replies "הסר" or STOP to the number has automatic
messages turned off for all their children and is told so; Settings lists
them with the date, and ticking the switch again by hand turns them back on.

Settings → "Automatic WhatsApp reminders" has the mode: **off**, **trial**
(every message that would have gone out is logged, nothing is sent) or
**on**. It also shows which Twilio parts are set up. To set it up:

Rolling it out: deploy with everyone off; set the mode to on and turn it on
for one test student whose parent phone is yours; tell the families; then
"Turn on for everyone".

1. Connect the business number as a WhatsApp sender in the Twilio console.
2. Create the four templates in Twilio's Content Template Builder with the
   text in `TEMPLATES` in `lib/whatsapp.mjs` (lesson reminder and payment
   due, Hebrew and English, category Utility) and submit them to WhatsApp.
3. Set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM` and
   the four `TWILIO_CONTENT_*` SIDs.
4. On the sender, set "When a message comes in" to
   `<PUBLIC_ORIGIN>/api/whatsapp/inbound`. Delivery reports come to
   `/api/whatsapp/status` by themselves. Both are refused unless Twilio
   signed them.

A parent who writes to the number gets the automatic reply from the
settings, at most once every 12 hours, and only while the mode is on.

### Lesson summaries from Zoom

Every lesson on the calendar whose Zoom link has a meeting number
(`zoom.us/j/…`) is watched once it is over. When Zoom has finished the
meeting's audio transcript, Claude (`claude-sonnet-5`) writes the lesson's log
from it: topic, topics, exercises, games, successes, difficulties, homework,
next steps and a short summary. A lesson not logged yet is logged as held,
with everyone present; a lesson already logged gets only the fields still
empty. The lesson page shows the summary with a "Filled from Zoom" badge.
Nothing is sent to parents. The server checks every 5 minutes, a lesson
without a transcript yet less and less often, for up to 3 days
(`lib/lesson-summaries.mjs`). Settings shows which parts are set up.

1. In Zoom (a paid plan): Settings → Recording → turn on cloud recording,
   automatic recording to the cloud, and "Create audio transcript".
2. In the Zoom App Marketplace, create a Server-to-Server OAuth app with the
   scopes to list past meeting instances and read cloud recordings
   (`meeting:read:list_past_instances:admin`,
   `cloud_recording:read:list_recording_files:admin`, or the classic
   `meeting:read:admin` and `recording:read:admin`), and activate it.
3. Set `ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET` from the app
   and `ANTHROPIC_API_KEY` from console.anthropic.com.

## Configuration

Every setting is an environment variable; see [.env.example](.env.example) for
the full list. The ones that matter:

| Variable | Notes |
| --- | --- |
| `NODE_ENV` | Set to `production`. This alone disables the debug endpoints and the console code fallback. |
| `PUBLIC_ORIGIN` | Required in production, must be `https://`. Session cookies are marked `Secure` based on it. |
| `HOST` / `PORT` | `127.0.0.1` behind a local reverse proxy, `0.0.0.0` in a container. |
| `TRUST_PROXY` | Set to `true` only when a proxy you control sets `X-Forwarded-For`, otherwise per-IP rate limits can be spoofed. |
| `DATA_DIR` | Where the SQLite database lives. A persistent volume, or an ephemeral directory plus the `LITESTREAM_*` variables below. |
| `LITESTREAM_BUCKET`, `LITESTREAM_ENDPOINT`, `LITESTREAM_ACCESS_KEY_ID`, `LITESTREAM_SECRET_ACCESS_KEY` | Docker image only. Replicate the database to an S3-compatible bucket and restore from it at boot, for hosts without a persistent disk. Empty bucket means off. |
| `TWILIO_VERIFY_SERVICE_SID` + API key or account token | Required in production. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`, `TWILIO_CONTENT_*` | Automatic WhatsApp reminders. Optional; see above. |
| `ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET`, `ANTHROPIC_API_KEY` | Lesson summaries from Zoom. Optional; see above. |
| `BOOTSTRAP_TEACHER_PHONE` | Creates the admin account when the database is empty. Remove after first boot. |

A production process **refuses to start** (exit code 78) without Twilio
credentials and an https `PUBLIC_ORIGIN`, rather than starting in a state where
nobody can sign in. Check the logs if it exits immediately.

## Deploying

The server speaks plain HTTP and expects TLS to be terminated in front of it.

### Docker

```bash
docker build -t yalla-chess .
docker run -d --name yalla-chess \
  -p 127.0.0.1:8001:8001 \
  -v /var/lib/yalla-chess:/data \
  --env-file .env \
  --restart unless-stopped \
  yalla-chess
```

### Render (free tier, no card)

[render.yaml](render.yaml) describes the service: Docker runtime, Frankfurt,
`free` plan, health check on `/healthz`, auto-deploy on every push to `main`.

Free instances have no persistent disk and are wiped on every deploy, restart
and spin-down, so the database is kept alive two ways:

- **Litestream** inside the container restores `yalla-chess.db` from a
  Backblaze B2 bucket at boot and streams every committed write back out
  within a second. Config in [deploy/litestream.yml](deploy/litestream.yml),
  boot sequence in [deploy/entrypoint.sh](deploy/entrypoint.sh). CI boots the
  image against a throwaway S3 server, stops it, boots a second copy and
  checks the data came back.
- **A keep-alive ping** from [cron-job.org](https://cron-job.org) (free) hits
  `/healthz` every five minutes, under Render's 15-minute idle timeout. An
  external scheduler is used rather than GitHub Actions because GitHub pauses
  scheduled workflows after 60 days without a commit.

Hard kills lose at most the last second of writes. Even an idle site makes a
few hundred B2 listing calls a day, because Litestream's cleanup and compaction
loops list the bucket on a timer; `deploy/litestream.yml` stretches those
timers to stay well under B2's free daily cap of 2,500 Class C calls. If that
cap is ever hit, every call fails with "Transaction cap exceeded", including
the restore at boot, so the service cannot start until the cap resets at
midnight UTC or is raised under **Caps & Alerts** in Backblaze.

1. Backblaze: create an account (no card needed) and a **private** bucket in
   the EU, e.g. `yalla-chess-db`. Note the bucket's S3 endpoint from its
   details page, in the form `s3.eu-central-003.backblazeb2.com`. Then
   **Application Keys → Add a New Application Key**, restricted to that bucket
   with read and write access. Copy the `keyID` and `applicationKey`; the
   latter is shown once.
2. Render dashboard: **New → Blueprint**, pick this repository. Render reads
   `render.yaml` and prompts for the secrets: Twilio, Resend, the bootstrap
   teacher phone, and the four `LITESTREAM_*` values (bucket name, endpoint,
   keyID as the access key, applicationKey as the secret).
3. Check the first deploy's logs for `litestream.restore.empty` followed by a
   healthy server. From the second boot on it reads `litestream.restore.done`.
4. Open the service → **Settings → Custom Domains** and add
   `yallachessacademy.com`. Render adds `www` and redirects it to the root
   automatically.
5. At the registrar (Porkbun → Domain Management → DNS), delete the default
   parking records and add:

   | Type | Host | Answer |
   | --- | --- | --- |
   | ALIAS | (root) | `yalla-chess.onrender.com` |
   | CNAME | www | `yalla-chess.onrender.com` |

   Do not add `AAAA` records; Render asks that there be none. Certificates are
   issued automatically once the records resolve.
6. Once signed in as the bootstrap teacher, clear `BOOTSTRAP_TEACHER_PHONE` in
   the service's environment.
7. cron-job.org: create a free account, then **Cronjobs → Create cronjob**:

   | Setting | Value |
   | --- | --- |
   | Title | `yalla-chess keepalive` |
   | URL | `https://yallachessacademy.com/healthz` |
   | Schedule | Every 5 minutes |
   | Request method | GET |
   | Request timeout | 30 seconds |
   | Notifications | On failure, and when it comes back |

   Under **Advanced**, keep "Save responses" off. The first run may take up to
   a minute if the instance is asleep; after that every ping should answer in
   well under a second with `{"ok":true,...}`. If the domain is not live yet,
   point the job at `https://yalla-chess.onrender.com/healthz` and change it
   later.

`PUBLIC_ORIGIN` is set in the Blueprint to `https://yallachessacademy.com`;
change it there if the domain ever changes.

Free-tier limits that matter here: 750 instance hours a month, which covers
exactly one always-on service, and 100 GB of outbound bandwidth, which the
86 MB homepage video can exhaust in about a thousand full plays. Re-encoding
or externally hosting the video is the fix if traffic grows.

**Moving to a paid plan later**: in `render.yaml` set `plan: starter` and
uncomment the `disk` block. Leave the `LITESTREAM_*` variables in place: the
entrypoint keeps a local database when one exists, so the replica becomes an
off-site backup of the disk rather than its source.

### systemd

```ini
# /etc/systemd/system/yalla-chess.service
[Unit]
Description=Yalla-Chess
After=network.target

[Service]
Type=simple
User=yalla
WorkingDirectory=/srv/yalla-chess
EnvironmentFile=/etc/yalla-chess.env
ExecStart=/usr/bin/node server.mjs
Restart=always
RestartSec=2

# The process only ever needs to write to its data directory.
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/yalla-chess

[Install]
WantedBy=multi-user.target
```

### Reverse proxy

Caddy, which handles certificates itself:

```
yalla-chess.example {
	encode gzip
	reverse_proxy 127.0.0.1:8001
}
```

Set `TRUST_PROXY=true` so rate limiting sees real client addresses.

## Operations

- **Health**: `GET /healthz` returns `{"ok":true,...}`, unauthenticated.
- **Logs**: one JSON object per line in production. API requests, errors and
  config problems are logged; phone numbers and email addresses are masked.
  `LOG_LEVEL` accepts `error`, `warn`, `info`, `debug`.
- **Restarts** are safe. Sessions live in the database, so nobody is signed out.
  A sign-in already in progress needs a fresh code, because pending codes are
  held in memory on purpose.
- **Backups**: the database is one file. Use SQLite's own backup so you never
  copy a torn page:

  ```bash
  sqlite3 /var/lib/yalla-chess/yalla-chess.db ".backup '/backups/yalla-$(date +%F).db'"
  ```

  On Render the Litestream replica is the backup. To pull a copy to your
  machine, install [litestream](https://litestream.io) and run it with the
  same four `LITESTREAM_*` variables plus `DATA_DIR=. DB_FILE=yalla-chess.db`:

  ```bash
  litestream restore -config deploy/litestream.yml -o ./yalla-restored.db ./yalla-chess.db
  ```

  Add `-timestamp 2026-10-08T06:00:00Z` for point-in-time recovery within the
  72-hour retention window.

- **Inspecting data**: `sqlite3 /var/lib/yalla-chess/yalla-chess.db` then
  `.tables`, `SELECT * FROM users;`.

## Data

SQLite, in `$DATA_DIR/yalla-chess.db`. Tables: `users`, `groups`,
`contact_requests`, `sessions`, `meta`.

On first boot the server imports `auth-users.json`, `groups.json` and
`contact-requests.json` if they are present, then records that it has done so,
so a deleted user does not come back on the next start. Those files are read and
never written; they remain as a pre-migration backup and are gitignored.

## Security notes

- Sign-in is a one-time SMS code to a phone number that must already be in the
  `users` table. There is no self-registration and no password.
- CORS is an allowlist. Cross-origin state changes are rejected.
- Login, code verification and the contact form are rate limited. Each accepted
  login sends a billable SMS, so the per-phone cap is deliberately low.
- **Never commit `auth-users.json` or the database.** GitHub Pages publishes
  this repo's `main` branch from the root, so anything committed is downloadable
  at a predictable URL. Plaintext passwords from before the SMS migration are
  still in git history and should be treated as compromised.
- GitHub Pages can only serve the static landing page. `/api/*` does not exist
  there, so sign-in cannot work on `*.github.io` — the portal needs this Node
  server.
