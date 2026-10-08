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

Then open http://127.0.0.1:8001 and sign in as `+972500000001` (a teacher) or
`+972500000004` (a student). Those demo accounts are seeded only outside
production.

```bash
npm test      # 27 tests against a real server on a throwaway database
npm run check # syntax check every module
```

Both run in CI on every push and pull request, alongside a Docker image build
and a guard job that fails the build if runtime data, a database or anything
credential-shaped is ever committed.

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
| `BOOTSTRAP_TEACHER_PHONE` | Creates the first teacher when the database is empty. Remove after first boot. |

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

Hard kills lose at most the last second of writes. Reads never touch the WAL,
so an idle site makes no B2 API calls at all.

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
