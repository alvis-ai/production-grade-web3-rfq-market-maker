import assert from "node:assert/strict";
import { getMarketDataSnapshotSource } from "../backend/dist/modules/market-data/market-data.service.js";
import { SharedPriceCache, pairKey } from "../backend/dist/modules/market-data/price-cache.js";
import { BinanceConnector } from "../backend/dist/modules/market-data/cex-orderbook/binance-connector.js";
import { CEXOrderBookMonitor } from "../backend/dist/modules/market-data/cex-orderbook/cex-orderbook-monitor.js";
import { CoinbaseConnector } from "../backend/dist/modules/market-data/cex-orderbook/coinbase-connector.js";
import {
  cexDecimalScale,
  cexDeviationBps,
  medianCexDecimal,
  parseCexDecimal,
} from "../backend/dist/modules/market-data/cex-orderbook/decimal.js";

if (process.env.RFQ_CEX_INTEGRATION_CONFIRM !== "yes") {
  throw new Error("RFQ_CEX_INTEGRATION_CONFIRM=yes is required because this check opens live exchange streams");
}

const chainId = 1;
const baseToken = "0x0000000000000000000000000000000000000002";
const usdQuoteToken = "0x0000000000000000000000000000000000000003";
const binanceSymbol = readSymbol(
  process.env.RFQ_CEX_INTEGRATION_BINANCE_SYMBOL,
  "ETHUSDT",
  "RFQ_CEX_INTEGRATION_BINANCE_SYMBOL",
);
const coinbaseSymbol = readSymbol(
  process.env.RFQ_CEX_INTEGRATION_COINBASE_SYMBOL,
  "ETH-USD",
  "RFQ_CEX_INTEGRATION_COINBASE_SYMBOL",
);
const timeoutMs = readInteger("RFQ_CEX_INTEGRATION_TIMEOUT_MS", 45_000, 1_000, 120_000);
const maxAgeMs = readInteger("RFQ_CEX_INTEGRATION_MAX_AGE_MS", 10_000, 100, 60_000);
const maxDeviationBps = readInteger("RFQ_CEX_INTEGRATION_MAX_DEVIATION_BPS", 100, 1, 10_000);
const maxSpreadBps = readInteger("RFQ_CEX_INTEGRATION_MAX_SPREAD_BPS", 100, 1, 10_000);
const depthRangeBps = readInteger("RFQ_CEX_INTEGRATION_DEPTH_RANGE_BPS", 50, 1, 10_000);
const connectors = new Map();
const connectorErrors = [];
const warnings = [];
let latestObservation;

const cache = new SharedPriceCache(maxAgeMs);
const monitor = new CEXOrderBookMonitor(
  cache,
  {
    pairs: [
      {
        chainId,
        tokenIn: baseToken,
        tokenOut: usdQuoteToken,
        exchange: "binance",
        symbol: binanceSymbol,
        role: "hedge",
      },
      {
        chainId,
        tokenIn: baseToken,
        tokenOut: usdQuoteToken,
        exchange: "coinbase",
        symbol: coinbaseSymbol,
        role: "reference",
      },
    ],
    depthRangeBps,
    flushIntervalMs: 100,
    volatilitySampleSize: 10,
    maxSourceAgeMs: maxAgeMs,
    maxFutureSkewMs: 1_000,
    minSources: 2,
    maxSourceDeviationBps: maxDeviationBps,
    maxSpreadBps,
  },
  {
    recordCexOrderBookCycle(observation) {
      latestObservation = observation;
    },
    recordCexOrderBookConnectorError() {},
  },
  (exchange, symbol, onError) => {
    const connector = exchange === "binance"
      ? new BinanceConnector(symbol, undefined, captureConnectorError(exchange, onError))
      : new CoinbaseConnector(symbol, undefined, captureConnectorError(exchange, onError));
    connectors.set(exchange, connector);
    return connector;
  },
  {
    warn(fields, message) {
      warnings.push({ fields, message });
      while (warnings.length > 100) warnings.shift();
    },
  },
);

try {
  monitor.start();
  const result = await waitForQuorum();
  process.stdout.write(`${JSON.stringify({
    status: "ok",
    symbols: {
      binance: binanceSymbol,
      coinbase: coinbaseSymbol,
    },
    quorum: result.observation,
    sources: result.sources,
    aggregate: result.aggregate,
    connectorErrors: connectorErrors.length,
    monitorWarnings: warnings.length,
  }, null, 2)}\n`);
} finally {
  monitor.stop();
}

async function waitForQuorum() {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    monitor.flushOnce();
    const result = inspectQuorum();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const lastError = connectorErrors.at(-1);
  const detail = JSON.stringify({
    observation: latestObservation,
    lastConnectorError: lastError,
    lastWarning: warnings.at(-1),
  });
  throw new Error(`CEX dual-source quorum did not become usable within ${timeoutMs}ms: ${detail}`);
}

function inspectQuorum() {
  const observation = latestObservation;
  if (!observation ||
      observation.configuredSources !== 2 ||
      observation.readySources !== 2 ||
      observation.staleSources !== 0 ||
      observation.unavailableSources !== 0 ||
      observation.usablePairs !== 2 ||
      observation.blockedPairs !== 0 ||
      observation.deviationRejectedSources !== 0 ||
      observation.maxUpdateAgeSeconds * 1_000 > maxAgeMs) return undefined;

  const forwardSnapshot = cache.get(pairKey(chainId, baseToken, usdQuoteToken));
  const reverseSnapshot = cache.get(pairKey(chainId, usdQuoteToken, baseToken));
  if (!forwardSnapshot || !reverseSnapshot) return undefined;
  if (getMarketDataSnapshotSource(forwardSnapshot) !== "cex:binance+coinbase" ||
      getMarketDataSnapshotSource(reverseSnapshot) !== "cex:binance+coinbase") return undefined;

  const binance = readSource("binance", binanceSymbol);
  const coinbase = readSource("coinbase", coinbaseSymbol);
  if (!binance || !coinbase) return undefined;
  const sourceMidValues = [binance.midPriceValue, coinbase.midPriceValue];
  const sourceMedian = medianCexDecimal(sourceMidValues);
  if (sourceMidValues.some((value) => cexDeviationBps(value, sourceMedian) > maxDeviationBps)) return undefined;

  assert.equal(
    forwardSnapshot.liquidityUsd,
    binance.bidLiquidityUsd,
    "CEX forward aggregate must contain only Binance hedge bid liquidity",
  );
  assert.equal(
    reverseSnapshot.liquidityUsd,
    binance.askLiquidityUsd,
    "CEX reverse aggregate must contain only Binance hedge ask liquidity",
  );
  assert.equal(BigInt(forwardSnapshot.liquidityUsd) > 0n, true, "CEX aggregate must expose executable bid liquidity");
  assert.equal(BigInt(reverseSnapshot.liquidityUsd) > 0n, true, "CEX aggregate must expose executable ask liquidity");

  const forwardMid = parseCexDecimal(forwardSnapshot.midPrice, "CEX forward aggregate mid", false);
  const reverseMid = parseCexDecimal(reverseSnapshot.midPrice, "CEX reverse aggregate mid", false);
  const reciprocalMid = forwardMid * reverseMid / cexDecimalScale;
  const reciprocalDeviationBps = cexDeviationBps(reciprocalMid, cexDecimalScale);
  assert.equal(reciprocalDeviationBps <= 1, true, "CEX directional aggregate mid prices must be reciprocal");
  assertFreshSnapshot(forwardSnapshot, "forward");
  assertFreshSnapshot(reverseSnapshot, "reverse");

  return {
    observation,
    sources: {
      binance: presentSource(binance, sourceMedian),
      coinbase: presentSource(coinbase, sourceMedian),
    },
    aggregate: {
      source: "cex:binance+coinbase",
      forward: presentSnapshot(forwardSnapshot),
      reverse: presentSnapshot(reverseSnapshot),
      reciprocalDeviationBps,
    },
  };
}

function readSource(exchange, symbol) {
  const connector = connectors.get(exchange);
  const book = monitor.getOrderBook(exchange, symbol);
  if (!connector?.isReady() || !book) return undefined;
  const observedAtMs = connector.getLastUpdateAtMs();
  if (!Number.isSafeInteger(observedAtMs)) return undefined;
  const ageMs = Date.now() - observedAtMs;
  if (ageMs < -1_000 || ageMs > maxAgeMs) return undefined;
  const metrics = book.getMetrics(depthRangeBps);
  const bestBid = parseCexDecimal(metrics.bestBid, `${exchange} integration best bid`, false);
  const bestAsk = parseCexDecimal(metrics.bestAsk, `${exchange} integration best ask`, false);
  const midPriceValue = parseCexDecimal(metrics.midPrice, `${exchange} integration mid`, false);
  if (bestAsk <= bestBid || metrics.bidLevels <= 0 || metrics.askLevels <= 0 ||
      metrics.spreadBps > maxSpreadBps || BigInt(metrics.liquidityUsd) <= 0n ||
      BigInt(metrics.askLiquidityUsd) <= 0n) return undefined;
  return {
    exchange,
    symbol,
    ageMs,
    midPrice: metrics.midPrice,
    midPriceValue,
    spreadBps: metrics.spreadBps,
    bidLevels: metrics.bidLevels,
    askLevels: metrics.askLevels,
    bidLiquidityUsd: metrics.liquidityUsd,
    askLiquidityUsd: metrics.askLiquidityUsd,
  };
}

function presentSource(source, median) {
  const { midPriceValue, ...result } = source;
  return {
    ...result,
    deviationBps: cexDeviationBps(midPriceValue, median),
  };
}

function presentSnapshot(snapshot) {
  return {
    snapshotId: snapshot.snapshotId,
    midPrice: snapshot.midPrice,
    liquidityUsd: snapshot.liquidityUsd,
    marketSpreadBps: snapshot.marketSpreadBps,
    observedAt: snapshot.observedAt,
    ageMs: Date.now() - Date.parse(snapshot.observedAt),
  };
}

function assertFreshSnapshot(snapshot, direction) {
  const ageMs = Date.now() - Date.parse(snapshot.observedAt);
  assert.equal(
    Number.isFinite(ageMs) && ageMs >= -1_000 && ageMs <= maxAgeMs,
    true,
    `CEX ${direction} aggregate event age ${ageMs}ms is outside bounds`,
  );
}

function captureConnectorError(exchange, onError) {
  return (error) => {
    connectorErrors.push({ exchange, message: error.message });
    while (connectorErrors.length > 100) connectorErrors.shift();
    onError(error);
  };
}

function readSymbol(value, fallback, field) {
  const symbol = value === undefined || value.length === 0 ? fallback : value;
  if (!/^[A-Za-z0-9._-]{3,32}$/.test(symbol)) {
    throw new Error(`${field} must contain 3-32 exchange symbol characters`);
  }
  return symbol;
}

function readInteger(field, fallback, min, max) {
  const value = process.env[field];
  if (value === undefined || value.length === 0) return fallback;
  if (!/^[0-9]+$/.test(value)) throw new Error(`${field} must be an integer between ${min} and ${max}`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${field} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}
