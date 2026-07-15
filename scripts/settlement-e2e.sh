#!/usr/bin/env sh
set -eu

HOST="${RFQ_ANVIL_HOST:-127.0.0.1}"
PORT="${RFQ_ANVIL_PORT:-18545}"
CHAIN_ID="${RFQ_ANVIL_CHAIN_ID:-31337}"
RPC_URL="http://${HOST}:${PORT}"
LOG_FILE="${RFQ_ANVIL_LOG_FILE:-tmp/settlement-e2e-anvil.log}"
E2E_SCRIPT="${RFQ_SETTLEMENT_E2E_SCRIPT:-scripts/settlement-e2e.mjs}"
NODE_IMPORT="${RFQ_SETTLEMENT_E2E_NODE_IMPORT:-}"

case "$CHAIN_ID" in
  ''|*[!0-9]*|0)
    echo "RFQ_ANVIL_CHAIN_ID must be a positive decimal integer" >&2
    exit 1
    ;;
esac
if [ ! -f "$E2E_SCRIPT" ]; then
  echo "RFQ_SETTLEMENT_E2E_SCRIPT must name an existing file" >&2
  exit 1
fi
if [ -n "$NODE_IMPORT" ] && [ ! -f "$NODE_IMPORT" ]; then
  echo "RFQ_SETTLEMENT_E2E_NODE_IMPORT must name an existing file" >&2
  exit 1
fi

if ! command -v anvil >/dev/null 2>&1; then
  echo "anvil is required for settlement-e2e" >&2
  exit 1
fi

mkdir -p "$(dirname "$LOG_FILE")"
anvil --silent --host "$HOST" --port "$PORT" --chain-id "$CHAIN_ID" >"$LOG_FILE" 2>&1 &
anvil_pid="$!"

cleanup() {
  kill "$anvil_pid" 2>/dev/null || true
}

trap cleanup EXIT INT TERM

export RFQ_ANVIL_RPC_URL="$RPC_URL"
export RFQ_ANVIL_CHAIN_ID="$CHAIN_ID"
attempt=0
until node -e '
const expectedChainId = `0x${Number(process.env.RFQ_ANVIL_CHAIN_ID).toString(16)}`;
fetch(process.env.RFQ_ANVIL_RPC_URL, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
}).then(async (response) => {
  const payload = await response.json();
  process.exit(response.ok && payload.result === expectedChainId ? 0 : 1);
}).catch(() => process.exit(1));
'; do
  attempt=$((attempt + 1))
  if ! kill -0 "$anvil_pid" 2>/dev/null || [ "$attempt" -ge 100 ]; then
    cat "$LOG_FILE" >&2 || true
    exit 1
  fi
  sleep 0.1
done

if [ -n "$NODE_IMPORT" ]; then
  node --import "$NODE_IMPORT" "$E2E_SCRIPT" || e2e_status="$?"
else
  node "$E2E_SCRIPT" || e2e_status="$?"
fi
if [ "${e2e_status:-0}" -ne 0 ]; then
  cat "$LOG_FILE" >&2 || true
  exit "$e2e_status"
fi
