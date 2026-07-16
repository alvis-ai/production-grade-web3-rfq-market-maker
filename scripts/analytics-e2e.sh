#!/usr/bin/env sh
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${RFQ_ANALYTICS_KAFKA_BROKERS:?RFQ_ANALYTICS_KAFKA_BROKERS is required}"
: "${RFQ_CLICKHOUSE_URL:?RFQ_CLICKHOUSE_URL is required}"
: "${RFQ_ANALYTICS_INTEGRATION_CONFIRM:?RFQ_ANALYTICS_INTEGRATION_CONFIRM is required}"

HOST="${RFQ_ANALYTICS_WORKER_HOST:-127.0.0.1}"
PORT="${RFQ_ANALYTICS_WORKER_PORT:-13002}"
LOG_FILE="${RFQ_ANALYTICS_E2E_LOG_FILE:-tmp/analytics-e2e-worker.log}"
E2E_TIMEOUT_SECONDS="${RFQ_ANALYTICS_E2E_TIMEOUT_SECONDS:-120}"
READY_REQUEST_TIMEOUT_MS="${RFQ_ANALYTICS_E2E_READY_REQUEST_TIMEOUT_MS:-1000}"

case "$HOST" in
  127.0.0.1|localhost|::1) ;;
  *)
    echo "RFQ_ANALYTICS_WORKER_HOST must be loopback for analytics-e2e" >&2
    exit 1
    ;;
esac
case "$PORT" in
  ''|*[!0-9]*|0)
    echo "RFQ_ANALYTICS_WORKER_PORT must be a positive decimal integer" >&2
    exit 1
    ;;
esac
case "$E2E_TIMEOUT_SECONDS" in
  ''|*[!0-9]*)
    echo "RFQ_ANALYTICS_E2E_TIMEOUT_SECONDS must be an integer between 2 and 600" >&2
    exit 1
    ;;
esac
if [ "$E2E_TIMEOUT_SECONDS" -lt 2 ] || [ "$E2E_TIMEOUT_SECONDS" -gt 600 ]; then
  echo "RFQ_ANALYTICS_E2E_TIMEOUT_SECONDS must be an integer between 2 and 600" >&2
  exit 1
fi
case "$READY_REQUEST_TIMEOUT_MS" in
  ''|*[!0-9]*)
    echo "RFQ_ANALYTICS_E2E_READY_REQUEST_TIMEOUT_MS must be an integer between 100 and 10000" >&2
    exit 1
    ;;
esac
if [ "$READY_REQUEST_TIMEOUT_MS" -lt 100 ] || [ "$READY_REQUEST_TIMEOUT_MS" -gt 10000 ]; then
  echo "RFQ_ANALYTICS_E2E_READY_REQUEST_TIMEOUT_MS must be an integer between 100 and 10000" >&2
  exit 1
fi

export RFQ_ANALYTICS_WORKER_HOST="$HOST"
export RFQ_ANALYTICS_WORKER_PORT="$PORT"
export RFQ_ANALYTICS_E2E_READY_REQUEST_TIMEOUT_MS="$READY_REQUEST_TIMEOUT_MS"

mkdir -p "$(dirname "$LOG_FILE")"
node backend/dist/analytics-worker-main.js >"$LOG_FILE" 2>&1 &
worker_pid="$!"
check_pid=""
watchdog_pid=""
watchdog_stop_file="${LOG_FILE}.watchdog-stop.$$"

stop_process() {
  process_pid="$1"
  [ -n "$process_pid" ] || return 0
  if kill -0 "$process_pid" 2>/dev/null; then
    kill "$process_pid" 2>/dev/null || true
    stop_attempt=0
    while kill -0 "$process_pid" 2>/dev/null && [ "$stop_attempt" -lt 40 ]; do
      stop_attempt=$((stop_attempt + 1))
      sleep 0.25
    done
    if kill -0 "$process_pid" 2>/dev/null; then
      kill -KILL "$process_pid" 2>/dev/null || true
    fi
  fi
  wait "$process_pid" 2>/dev/null || true
}

cleanup() {
  status="$?"
  trap - EXIT INT TERM
  if [ -n "$watchdog_pid" ]; then
    : >"$watchdog_stop_file"
    wait "$watchdog_pid" 2>/dev/null || true
  fi
  stop_process "$check_pid"
  stop_process "$worker_pid"
  rm -f "$watchdog_stop_file"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

script_pid="$$"
rm -f "$watchdog_stop_file"
(
  watchdog_elapsed=0
  while [ "$watchdog_elapsed" -lt "$E2E_TIMEOUT_SECONDS" ]; do
    [ ! -f "$watchdog_stop_file" ] || exit 0
    sleep 1
    watchdog_elapsed=$((watchdog_elapsed + 1))
  done
  [ ! -f "$watchdog_stop_file" ] || exit 0
  echo "Analytics E2E exceeded ${E2E_TIMEOUT_SECONDS}s hard deadline" >&2
  kill -TERM "$script_pid" 2>/dev/null || true
) &
watchdog_pid="$!"

export RFQ_ANALYTICS_E2E_READY_URL="http://${HOST}:${PORT}/ready"
attempt=0
until node -e '
const timeoutMs = Number(process.env.RFQ_ANALYTICS_E2E_READY_REQUEST_TIMEOUT_MS);
fetch(process.env.RFQ_ANALYTICS_E2E_READY_URL, { signal: AbortSignal.timeout(timeoutMs) })
  .then(async (response) => {
    const body = await response.json();
    process.exit(response.ok && body.status === "ok" ? 0 : 1);
  })
  .catch(() => process.exit(1));
'; do
  attempt=$((attempt + 1))
  if ! kill -0 "$worker_pid" 2>/dev/null || [ "$attempt" -ge 120 ]; then
    cat "$LOG_FILE" >&2 || true
    exit 1
  fi
  sleep 0.25
done

echo "Analytics E2E worker ready; starting transactional delivery check"
node scripts/analytics-integration-check.mjs &
check_pid="$!"
if wait "$check_pid"; then
  check_pid=""
else
  check_status="$?"
  check_pid=""
  cat "$LOG_FILE" >&2 || true
  exit "$check_status"
fi
