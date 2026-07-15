#!/usr/bin/env sh
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${RFQ_ANALYTICS_KAFKA_BROKERS:?RFQ_ANALYTICS_KAFKA_BROKERS is required}"
: "${RFQ_CLICKHOUSE_URL:?RFQ_CLICKHOUSE_URL is required}"
: "${RFQ_ANALYTICS_INTEGRATION_CONFIRM:?RFQ_ANALYTICS_INTEGRATION_CONFIRM is required}"

HOST="${RFQ_ANALYTICS_WORKER_HOST:-127.0.0.1}"
PORT="${RFQ_ANALYTICS_WORKER_PORT:-13002}"
LOG_FILE="${RFQ_ANALYTICS_E2E_LOG_FILE:-tmp/analytics-e2e-worker.log}"

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

mkdir -p "$(dirname "$LOG_FILE")"
node backend/dist/analytics-worker-main.js >"$LOG_FILE" 2>&1 &
worker_pid="$!"

cleanup() {
  kill "$worker_pid" 2>/dev/null || true
  wait "$worker_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

export RFQ_ANALYTICS_E2E_READY_URL="http://${HOST}:${PORT}/ready"
attempt=0
until node -e '
fetch(process.env.RFQ_ANALYTICS_E2E_READY_URL)
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

if ! node scripts/analytics-integration-check.mjs; then
  cat "$LOG_FILE" >&2 || true
  exit 1
fi
