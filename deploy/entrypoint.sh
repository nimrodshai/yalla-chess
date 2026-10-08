#!/bin/sh
# Container entrypoint. With LITESTREAM_BUCKET set, restores the database from
# the replica when there is no local copy, then runs the server under
# `litestream replicate`, which streams changes out and forwards SIGTERM to
# the server so shutdown stays graceful. Without it, runs the server alone,
# which is the right behaviour on a host that has a real persistent disk.
set -eu

DATA_DIR="${DATA_DIR:-/data}"
DB_FILE="${DB_FILE:-yalla-chess.db}"
DB_PATH="$DATA_DIR/$DB_FILE"
CONFIG="${LITESTREAM_CONFIG:-/etc/litestream.yml}"

# Litestream expands these in its config file, so they must be set even when
# they are defaults.
export DATA_DIR DB_FILE
export LITESTREAM_PATH="${LITESTREAM_PATH:-$DB_FILE}"

if [ -z "${LITESTREAM_BUCKET:-}" ]; then
  echo '{"level":"info","event":"litestream.disabled","reason":"LITESTREAM_BUCKET is not set"}'
  exec node server.mjs
fi

for required in LITESTREAM_ENDPOINT LITESTREAM_ACCESS_KEY_ID LITESTREAM_SECRET_ACCESS_KEY; do
  eval "value=\${$required:-}"
  if [ -z "$value" ]; then
    echo "{\"level\":\"error\",\"event\":\"litestream.misconfigured\",\"missing\":\"$required\"}" >&2
    exit 78
  fi
done

mkdir -p "$DATA_DIR"

if [ -f "$DB_PATH" ]; then
  # A local database wins. This is the persistent-disk case, where the replica
  # is a backup rather than the source of truth, and it must never be
  # overwritten by an older copy.
  echo "{\"level\":\"info\",\"event\":\"litestream.restore.skipped\",\"reason\":\"database exists\",\"path\":\"$DB_PATH\"}"
else
  # -if-replica-exists makes a first boot against an empty bucket succeed, so
  # the server can create the schema and the bootstrap teacher from scratch.
  echo "{\"level\":\"info\",\"event\":\"litestream.restore.start\",\"path\":\"$DB_PATH\"}"
  litestream restore -config "$CONFIG" -if-replica-exists "$DB_PATH"
  if [ -f "$DB_PATH" ]; then
    echo '{"level":"info","event":"litestream.restore.done"}'
  else
    echo '{"level":"warn","event":"litestream.restore.empty","note":"no replica found; starting with a fresh database"}'
  fi
fi

# The server checkpoints with TRUNCATE on shutdown by default. Under Litestream
# a truncated WAL can hide the final frames from the replicator, so ask for a
# PASSIVE checkpoint instead and let Litestream's own shutdown sync ship them.
export DB_CLOSE_CHECKPOINT="${DB_CLOSE_CHECKPOINT:-passive}"

exec litestream replicate -config "$CONFIG" -exec "node server.mjs"
