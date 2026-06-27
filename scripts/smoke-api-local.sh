#!/usr/bin/env sh
set -eu

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-3000}"
API_URL="${API_URL:-http://${HOST}:${PORT}}"
LOG_FILE="${LOG_FILE:-tmp/smoke-api-backend.log}"

export HOST
export PORT
export API_URL

mkdir -p "$(dirname "$LOG_FILE")"
node backend/dist/main.js >"$LOG_FILE" 2>&1 &
server_pid="$!"

cleanup() {
  kill "$server_pid" 2>/dev/null || true
}

trap cleanup EXIT INT TERM

attempt=0
until node -e "fetch(process.env.API_URL + '/ready').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"; do
  attempt=$((attempt + 1))
  if ! kill -0 "$server_pid" 2>/dev/null; then
    cat "$LOG_FILE" >&2 || true
    exit 1
  fi
  if [ "$attempt" -ge 50 ]; then
    cat "$LOG_FILE" >&2 || true
    exit 1
  fi
  sleep 0.1
done

node scripts/smoke-api.mjs
