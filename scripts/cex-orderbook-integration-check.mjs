import assert from "node:assert/strict";
import { BinanceConnector } from "../backend/dist/modules/market-data/cex-orderbook/binance-connector.js";
import { CoinbaseConnector } from "../backend/dist/modules/market-data/cex-orderbook/coinbase-connector.js";
import { parseCexDecimal } from "../backend/dist/modules/market-data/cex-orderbook/decimal.js";

if (process.env.RFQ_CEX_INTEGRATION_CONFIRM !== "yes") {
  throw new Error("RFQ_CEX_INTEGRATION_CONFIRM=yes is required because this check opens a live exchange stream");
}

const exchange = readExchange(process.env.RFQ_CEX_INTEGRATION_EXCHANGE);
const symbol = readSymbol(process.env.RFQ_CEX_INTEGRATION_SYMBOL);
const timeoutMs = readInteger(process.env.RFQ_CEX_INTEGRATION_TIMEOUT_MS, 30_000, 1_000, 120_000);
const maxAgeMs = readInteger(process.env.RFQ_CEX_INTEGRATION_MAX_AGE_MS, 10_000, 100, 60_000);
const errors = [];
let resolveReady;
const ready = new Promise((resolve) => { resolveReady = resolve; });
const onError = (error) => {
  errors.push(error.message);
  while (errors.length > 100) errors.shift();
};
const connector = exchange === "binance"
  ? new BinanceConnector(symbol, resolveReady, onError)
  : new CoinbaseConnector(symbol, resolveReady, onError);
const timeout = setTimeout(() => resolveReady("timeout"), timeoutMs);

try {
  connector.start();
  const outcome = await ready;
  assert.notEqual(outcome, "timeout", `CEX order book did not synchronize; last error: ${errors.at(-1) ?? "none"}`);
  assert.equal(connector.isReady(), true, "CEX connector must report ready after its first synchronized book");
  const observedAtMs = connector.getLastUpdateAtMs();
  assert.equal(Number.isSafeInteger(observedAtMs), true, "CEX connector must expose a safe source event timestamp");
  const ageMs = Date.now() - observedAtMs;
  assert.equal(ageMs >= -1_000 && ageMs <= maxAgeMs, true, `CEX source event age ${ageMs}ms is outside bounds`);
  const metrics = connector.getOrderBook().getMetrics(50);
  assert.equal(metrics.bidLevels > 0 && metrics.askLevels > 0, true, "CEX order book must contain both sides");
  assert.equal(
    BigInt(metrics.liquidityUsd) > 0n,
    true,
    "CEX order book must expose positive near-mid executable bid liquidity",
  );
  assert.equal(
    parseCexDecimal(metrics.bestAsk, "CEX integration best ask", false) >
      parseCexDecimal(metrics.bestBid, "CEX integration best bid", false),
    true,
    "CEX order book must not be crossed",
  );

  process.stdout.write(`${JSON.stringify({
    status: "ok",
    exchange,
    symbol,
    ageMs,
    bidLevels: metrics.bidLevels,
    askLevels: metrics.askLevels,
    spreadBps: metrics.spreadBps,
    liquidityUsd: metrics.liquidityUsd,
    transientErrors: errors.length,
  }, null, 2)}\n`);
} finally {
  clearTimeout(timeout);
  connector.stop();
}

function readExchange(value) {
  if (value !== "binance" && value !== "coinbase") {
    throw new Error("RFQ_CEX_INTEGRATION_EXCHANGE must be binance or coinbase");
  }
  return value;
}

function readSymbol(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._-]{3,32}$/.test(value)) {
    throw new Error("RFQ_CEX_INTEGRATION_SYMBOL must contain 3-32 exchange symbol characters");
  }
  return value;
}

function readInteger(value, fallback, min, max) {
  if (value === undefined || value.length === 0) return fallback;
  if (!/^[0-9]+$/.test(value)) throw new Error(`CEX integration integer must be between ${min} and ${max}`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`CEX integration integer must be between ${min} and ${max}`);
  }
  return parsed;
}
