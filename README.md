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
| `DATA_DIR` | Where the SQLite database lives. Must be a persistent volume. |
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
