#!/bin/bash
set -Eeuo pipefail

APP_DIR="${POI_DUMP_CRON_APP_DIR:-$(cd "$(dirname "$0")" && pwd)}"
LOCK_FILE="${POI_DUMP_CRON_LOCK_FILE:-/var/lock/poi-server-monthly-dump.lock}"
TIMEOUT="${POI_DUMP_CRON_TIMEOUT:-12h}"

fail() {
  printf '[poi-dump-maintenance] error: %s\n' "$*" >&2
  exit 1
}

command -v date >/dev/null || fail "date is required"
command -v flock >/dev/null || fail "flock is required"
command -v timeout >/dev/null || fail "timeout is required"
date --iso-8601=seconds >/dev/null 2>&1 || fail "GNU date with --iso-8601=seconds is required"
flock --version >/dev/null 2>&1 || fail "util-linux flock is required"
timeout --foreground -- 1s true >/dev/null 2>&1 ||
  fail "GNU timeout with --foreground is required"

started_epoch="$(date +%s)"

log_maintenance() {
  printf '[poi-dump-maintenance] timestamp=%s %s\n' "$(date --iso-8601=seconds)" "$*"
}

on_error() {
  local exit_code="$?"
  local elapsed_seconds=$(( $(date +%s) - started_epoch ))
  log_maintenance "status=failed exit_code=$exit_code elapsed_seconds=$elapsed_seconds"
  exit "$exit_code"
}

trap on_error ERR

absolute_path_pattern='^/[A-Za-z0-9_./-]*$'
[[ "$APP_DIR" =~ $absolute_path_pattern ]] ||
  fail "POI_DUMP_CRON_APP_DIR must be an absolute path with supported characters"
[[ "$LOCK_FILE" =~ $absolute_path_pattern ]] ||
  fail "POI_DUMP_CRON_LOCK_FILE must be an absolute path with supported characters"
[[ "$TIMEOUT" =~ ^[1-9][0-9]*[smhd]$ ]] ||
  fail "POI_DUMP_CRON_TIMEOUT must be a positive duration ending in s, m, h, or d"
[[ -x "$APP_DIR/fnm-exec" ]] || fail "$APP_DIR/fnm-exec is not executable"

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  log_maintenance "status=skipped reason=overlap"
  exit 0
fi

log_maintenance "status=started"
cd -- "$APP_DIR"
timeout --foreground -- "$TIMEOUT" ./fnm-exec npm run --silent db:dumps:maintain
elapsed_seconds=$(( $(date +%s) - started_epoch ))
log_maintenance "status=succeeded elapsed_seconds=$elapsed_seconds"
