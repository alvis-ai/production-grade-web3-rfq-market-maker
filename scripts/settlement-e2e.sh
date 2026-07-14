#!/usr/bin/env sh
set -eu

HOST="${RFQ_ANVIL_HOST:-127.0.0.1}"
PORT="${RFQ_ANVIL_PORT:-18545}"
RPC_URL="http://${HOST}:${PORT}"
LOG_FILE="${RFQ_ANVIL_LOG_FILE:-tmp/settlement-e2e-anvil.log}"

if ! command -v anvil >/dev/null 2>&1; then
  echo "anvil is required for settlement-e2e" >&2
  exit 1
fi

mkdir -p "$(dirname "$LOG_FILE")"
anvil --silent --host "$HOST" --port "$PORT" --chain-id 31337 >"$LOG_FILE" 2>&1 &
anvil_pid="$!"

cleanup() {
  kill "$anvil_pid" 2>/dev/null || true
}

trap cleanup EXIT INT TERM

export RFQ_ANVIL_RPC_URL="$RPC_URL"
attempt=0
until node -e '
fetch(process.env.RFQ_ANVIL_RPC_URL, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
}).then(async (response) => {
  const payload = await response.json();
  process.exit(response.ok && payload.result === "0x7a69" ? 0 : 1);
}).catch(() => process.exit(1));
'; do
  attempt=$((attempt + 1))
  if ! kill -0 "$anvil_pid" 2>/dev/null || [ "$attempt" -ge 100 ]; then
    cat "$LOG_FILE" >&2 || true
    exit 1
  fi
  sleep 0.1
done

if ! node scripts/settlement-e2e.mjs; then
  cat "$LOG_FILE" >&2 || true
  exit 1
fi
