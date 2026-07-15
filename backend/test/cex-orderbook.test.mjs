import assert from "node:assert/strict";
import test from "node:test";
import { buildServer } from "../dist/main.js";
import { CachedMarketDataService } from "../dist/modules/market-data/cached-market-data.service.js";
import { CEXOrderBookMonitor } from "../dist/modules/market-data/cex-orderbook/cex-orderbook-monitor.js";
import { BinanceConnector } from "../dist/modules/market-data/cex-orderbook/binance-connector.js";
import { CoinbaseConnector } from "../dist/modules/market-data/cex-orderbook/coinbase-connector.js";
import {
  exponentialReconnectDelayMs,
  MAX_CEX_SNAPSHOT_BYTES,
  MAX_CEX_WS_MESSAGE_BYTES,
  parseBoundedJsonMessage,
  readBoundedJsonResponse,
} from "../dist/modules/market-data/cex-orderbook/connector-safety.js";
import { OrderBook } from "../dist/modules/market-data/cex-orderbook/orderbook.js";
import { getMarketDataSnapshotSource } from "../dist/modules/market-data/market-data.service.js";
import { SharedPriceCache, pairKey } from "../dist/modules/market-data/price-cache.js";
import { ConfiguredTokenRegistry } from "../dist/modules/pricing/token-registry.js";

const tokenIn = "0x0000000000000000000000000000000000000002";
const tokenOut = "0x0000000000000000000000000000000000000003";

test("OrderBook uses exact fixed decimals and applies each message atomically", () => {
  const book = new OrderBook();
  book.applySnapshot({
    bids: [["99.00", "1"], ["90", "100"]],
    asks: [["101.0", "1"], ["110", "100"]],
  });

  assert.equal(book.bids.has("99"), true);
  assert.equal(book.asks.has("101"), true);
  assert.equal(book.getMetrics(100).midPrice, "100");
  assert.equal(book.getMetrics(100).marketSpreadBps, 100);
  assert.equal(book.getMetrics(100).askMarketSpreadBps, 100);
  assert.equal(book.getMetrics(100).liquidityUsd, "99");
  assert.equal(book.getMetrics(100).askLiquidityUsd, "101");
  assert.equal(book.getMetrics(2_000).liquidityUsd, "9099");
  assert.equal(book.getMetrics(2_000).askLiquidityUsd, "11101");

  book.applyDelta({ bids: [], asks: [["101", "1000"]] });
  assert.equal(book.getMetrics(100).liquidityUsd, "99");
  assert.equal(book.getMetrics(100).askLiquidityUsd, "101000");

  assert.throws(
    () => book.applyDelta({ bids: [["100", "2"], ["invalid", "1"]], asks: [] }),
    /must use at most 40 integer and 18 fractional digits/,
  );
  assert.equal(book.bids.has("100"), false);
  assert.equal(book.bids.get("99"), "1");

  book.applyDelta({ bids: [["99.000", "0.000"]], asks: [] });
  assert.equal(book.bids.has("99"), false);

  book.applySnapshot({
    bids: [["9007199254740992.000000000000000001", "1"]],
    asks: [["9007199254740992.000000000000000003", "1"]],
  });
  assert.equal(book.getMetrics().midPrice, "9007199254740992.000000000000000002");
  assert.equal(book.getMetrics().marketSpreadBps, 1);
  assert.equal(book.getMetrics().askMarketSpreadBps, 1);

  book.applySnapshot({ bids: [["101", "1"]], asks: [["100", "1"]] });
  assert.equal(book.getMetrics().midPrice, "0");
  assert.equal(book.getMetrics().liquidityUsd, "0");
  assert.equal(book.getMetrics().askLiquidityUsd, "0");
  assert.throws(() => book.getMetrics(0), /depthRangeBps/);
});

test("CEXOrderBookMonitor publishes only changed fresh source events", () => {
  const cache = new SharedPriceCache(60_000);
  const connectors = new Map();
  const observer = new FakeObserver();
  const factory = (exchange, symbol) => {
    const connector = new FakeConnector(exchange, symbol);
    connectors.set(`${exchange}:${symbol}`, connector);
    return connector;
  };
  const monitor = new CEXOrderBookMonitor(cache, {
    pairs: [
      { chainId: 1, tokenIn, tokenOut, exchange: "binance", symbol: "ETHUSDT", role: "hedge" },
      { chainId: 1, tokenIn, tokenOut, exchange: "coinbase", symbol: "ETH-USDT", role: "reference" },
    ],
    depthRangeBps: 50,
    flushIntervalMs: 60_000,
    volatilitySampleSize: 3,
    maxSourceAgeMs: 2_000,
    maxFutureSkewMs: 1_000,
    minSources: 1,
    maxSourceDeviationBps: 500,
    maxSpreadBps: 100,
  }, observer, factory);
  const now = Date.now();

  monitor.start();
  try {
    connectors.get("binance:ETHUSDT").setSnapshot([["99.75", "1"]], [["100.25", "1"]], now - 100);
    connectors.get("coinbase:ETH-USDT").setSnapshot([["103.75", "2"]], [["104.25", "2"]], now - 50);
    monitor.flushOnce(now);

    const snapshot = cache.get(pairKey(1, tokenIn, tokenOut));
    const inverseSnapshot = cache.get(pairKey(1, tokenOut, tokenIn));
    assert.equal(snapshot.midPrice, "102");
    assert.equal(snapshot.liquidityUsd, "99");
    assert.equal(snapshot.marketSpreadBps, 221);
    assert.equal(snapshot.volatilityBps, 10);
    assert.equal(snapshot.observedAt, new Date(now - 100).toISOString());
    assert.equal(getMarketDataSnapshotSource(snapshot), "cex:binance+coinbase");
    assert.match(snapshot.snapshotId, /_cex$/);
    assert.equal(inverseSnapshot.liquidityUsd, "100");
    assert.equal(getMarketDataSnapshotSource(inverseSnapshot), "cex:binance+coinbase");
    assert.match(inverseSnapshot.snapshotId, /_cex$/);

    monitor.flushOnce(now + 10);
    assert.equal(cache.get(pairKey(1, tokenIn, tokenOut)), snapshot);
    assert.equal(cache.get(pairKey(1, tokenOut, tokenIn)), inverseSnapshot);

    connectors.get("coinbase:ETH-USDT").ready = false;
    connectors.get("binance:ETHUSDT").setSnapshot([["99.75", "1"]], [["100.25", "1"]], now + 20);
    monitor.flushOnce(now + 20);
    const fallback = cache.get(pairKey(1, tokenIn, tokenOut));
    assert.equal(fallback.midPrice, "100");
    assert.equal(fallback.liquidityUsd, "99");
    assert.equal(fallback.marketSpreadBps, 25);
    const inverseFallback = cache.get(pairKey(1, tokenOut, tokenIn));
    assert.equal(inverseFallback.midPrice, "0.01");
    assert.equal(inverseFallback.liquidityUsd, "100");
    assert.equal(inverseFallback.marketSpreadBps, 25);
    assert.equal(observer.cycles.at(-1).readySources, 1);
    assert.equal(observer.cycles.at(-1).unavailableSources, 1);
    assert.equal(observer.cycles.at(-1).usablePairs, 2);

    connectors.get("binance:ETHUSDT").ready = false;
    connectors.get("coinbase:ETH-USDT").ready = true;
    connectors.get("coinbase:ETH-USDT").setSnapshot([["99.8", "10"]], [["100.2", "10"]], now + 30);
    monitor.flushOnce(now + 30);
    assert.equal(cache.get(pairKey(1, tokenIn, tokenOut)), undefined);
    assert.equal(cache.get(pairKey(1, tokenOut, tokenIn)), undefined);
    assert.equal(observer.cycles.at(-1).blockedPairs, 2);
  } finally {
    monitor.stop();
  }

  assert.equal(cache.get(pairKey(1, tokenIn, tokenOut)), undefined);
  assert.equal(cache.get(pairKey(1, tokenOut, tokenIn)), undefined);
  assert.equal(connectors.get("binance:ETHUSDT").stopped, true);
  assert.equal(connectors.get("coinbase:ETH-USDT").stopped, true);
});

test("CEXOrderBookMonitor logs connector failures without raw exception text", () => {
  const warnings = [];
  const observer = new FakeObserver();
  let reportError;
  const monitor = new CEXOrderBookMonitor(
    new SharedPriceCache(),
    { pairs: [{ chainId: 1, tokenIn, tokenOut, exchange: "binance", symbol: "ETHUSDT", role: "hedge" }] },
    observer,
    (exchange, symbol, onError) => {
      reportError = onError;
      return new FakeConnector(exchange, symbol);
    },
    { warn(fields, message) { warnings.push([fields, message]); } },
  );

  monitor.start();
  try {
    reportError(new Error("wss://api-key:raw-secret@stream.example.invalid"));
  } finally {
    monitor.stop();
  }

  assert.deepEqual(observer.connectorErrors, ["binance"]);
  assert.deepEqual(warnings, [[{
    exchange: "binance",
    symbol: "ETHUSDT",
    errorCode: "CEX_ORDER_BOOK_CONNECTOR_ERROR",
  }, "CEX order book connector failed"]]);
  assert.ok(!JSON.stringify(warnings).includes("raw-secret"));
});

test("RFQ API prices the inverse USD-to-base direction from executable asks", async () => {
  const cache = new SharedPriceCache(60_000);
  let connector;
  const monitor = new CEXOrderBookMonitor(cache, {
    pairs: [{ chainId: 1, tokenIn, tokenOut, exchange: "binance", symbol: "ETHUSDT", role: "hedge" }],
    flushIntervalMs: 60_000,
    minSources: 1,
  }, new FakeObserver(), (exchange, symbol) => {
    connector = new FakeConnector(exchange, symbol);
    return connector;
  });
  monitor.start();
  connector.setSnapshot([["99.75", "20000"]], [["100.25", "20000"]], Date.now());
  monitor.flushOnce();
  const inverseSnapshot = cache.get(pairKey(1, tokenOut, tokenIn));
  const marketDataService = new CachedMarketDataService({
    async getSnapshot() {
      throw new Error("inverse CEX cache miss");
    },
  }, cache);
  const server = buildServer({
    logger: false,
    marketDataService,
    tokenRegistry: new ConfiguredTokenRegistry(),
    riskEngine: {
      async evaluate() {
        return { status: "approved", policyVersion: "inverse-cex-risk-v1" };
      },
    },
  });

  try {
    await server.ready();
    const response = await server.inject({
      method: "POST",
      url: "/quote",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        chainId: 1,
        user: "0x0000000000000000000000000000000000000001",
        tokenIn: tokenOut,
        tokenOut: tokenIn,
        amountIn: "1000000000000000000",
        slippageBps: 50,
      }),
    });

    assert.equal(response.statusCode, 200, response.payload);
    const quote = JSON.parse(response.payload);
    assert.equal(quote.snapshotId, inverseSnapshot.snapshotId);
    assert.equal(BigInt(quote.amountOut) > 0n && BigInt(quote.amountOut) < 10n ** 16n, true);
    assert.match(quote.signature, /^0x[0-9a-f]{130}$/);
  } finally {
    await server.close();
    monitor.stop();
  }
});

test("CEXOrderBookMonitor invalidates stale and cross-venue divergent books", () => {
  const cache = new SharedPriceCache(60_000);
  const connectors = new Map();
  const observer = new FakeObserver();
  const factory = (exchange, symbol) => {
    const connector = new FakeConnector(exchange, symbol);
    connectors.set(`${exchange}:${symbol}`, connector);
    return connector;
  };
  const monitor = new CEXOrderBookMonitor(cache, {
    pairs: [
      { chainId: 1, tokenIn, tokenOut, exchange: "binance", symbol: "ETHUSDT", role: "hedge" },
      { chainId: 1, tokenIn, tokenOut, exchange: "coinbase", symbol: "ETH-USDT", role: "reference" },
    ],
    maxSourceAgeMs: 2_000,
    minSources: 2,
    maxSourceDeviationBps: 100,
  }, observer, factory);
  const key = pairKey(1, tokenIn, tokenOut);
  const inverseKey = pairKey(1, tokenOut, tokenIn);
  const now = Date.now();

  monitor.start();
  try {
    connectors.get("binance:ETHUSDT").setSnapshot([["99.9", "10"]], [["100.1", "10"]], now);
    connectors.get("coinbase:ETH-USDT").setSnapshot([["103.9", "10"]], [["104.1", "10"]], now);
    monitor.flushOnce(now);
    assert.equal(cache.get(key), undefined);
    assert.equal(cache.get(inverseKey), undefined);
    assert.equal(observer.cycles.at(-1).blockedPairs, 2);
    assert.equal(observer.cycles.at(-1).deviationRejectedSources, 4);

    connectors.get("coinbase:ETH-USDT").setSnapshot([["100.1", "10"]], [["100.3", "10"]], now + 10);
    monitor.flushOnce(now + 10);
    assert.equal(cache.get(key).midPrice, "100.1");
    assert.ok(cache.get(inverseKey));
    assert.equal(observer.cycles.at(-1).usablePairs, 2);

    monitor.flushOnce(now + 2_500);
    assert.equal(cache.get(key), undefined);
    assert.equal(cache.get(inverseKey), undefined);
    assert.equal(observer.cycles.at(-1).staleSources, 2);
    assert.equal(connectors.get("binance:ETHUSDT").restartCount, 1);
    assert.equal(connectors.get("coinbase:ETH-USDT").restartCount, 1);
  } finally {
    monitor.stop();
  }
});

test("CEXOrderBookMonitor rejects unsafe quorum and dependency configuration", () => {
  const pair = { chainId: 1, tokenIn, tokenOut, exchange: "binance", symbol: "ETHUSDT", role: "hedge" };
  assert.throws(
    () => new CEXOrderBookMonitor(new SharedPriceCache(), null),
    /config must be an object/,
  );
  assert.throws(
    () => new CEXOrderBookMonitor(new SharedPriceCache(), { pairs: [Object.create(pair)] }),
    /must be an own field/,
  );
  assert.throws(
    () => new CEXOrderBookMonitor(new SharedPriceCache(), { pairs: [pair, { ...pair }] }),
    /duplicate sources/,
  );
  assert.throws(
    () => new CEXOrderBookMonitor(new SharedPriceCache(), {
      pairs: [pair, { ...pair, tokenIn: tokenOut, tokenOut: tokenIn }],
    }),
    /derived directions must not contain duplicate sources/,
  );
  assert.throws(
    () => new CEXOrderBookMonitor(new SharedPriceCache(), { pairs: [pair], minSources: 2 }),
    /at least minSources/,
  );
  assert.throws(
    () => new CEXOrderBookMonitor(new SharedPriceCache(), {
      pairs: [{ ...pair, role: "reference" }],
    }),
    /at least one hedge source/,
  );
  assert.throws(
    () => new CEXOrderBookMonitor(new SharedPriceCache(), {
      pairs: [{ ...pair, exchange: "coinbase", symbol: "ETH-USD" }],
    }),
    /hedge source exchange must be binance/,
  );
  assert.throws(
    () => new CEXOrderBookMonitor(new SharedPriceCache(), { pairs: [pair], flushIntervalMs: 1 }),
    /flushIntervalMs/,
  );
  assert.throws(
    () => new CEXOrderBookMonitor(new SharedPriceCache(), { pairs: [pair] }, {}),
    /observer.recordCexOrderBookCycle/,
  );
  assert.throws(
    () => new CEXOrderBookMonitor(
      new SharedPriceCache(),
      { pairs: [pair] },
      new FakeObserver(),
      () => new FakeConnector("binance", "ETHUSDT"),
      {},
    ),
    /logger.warn/,
  );
});

test("BinanceConnector bridges buffered updates and resynchronizes sequence gaps", async () => {
  const OriginalWebSocket = globalThis.WebSocket;
  const originalFetch = globalThis.fetch;
  const firstResponse = deferred();
  const secondResponse = deferred();
  const responses = [firstResponse, secondResponse];
  let fetchCalls = 0;
  const errors = [];
  globalThis.WebSocket = FakeWebSocket;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return responses.shift().promise;
  };
  const eventTime = Date.now();

  const connector = new BinanceConnector("ETHUSDT", undefined, (error) => errors.push(error.message));
  try {
    connector.start();
    const socket = FakeWebSocket.instances.at(-1);
    socket.open();
    socket.message(depthUpdate(101, 101, [["100", "2"]], [], eventTime));
    firstResponse.resolve(jsonResponse({
      lastUpdateId: 100,
      bids: [["99", "1"]],
      asks: [["101", "1"]],
    }));
    await settle();

    assert.equal(connector.isReady(), true);
    assert.equal(connector.getLastUpdateAtMs(), eventTime);
    assert.equal(connector.getOrderBook().bids.get("100"), "2");

    socket.message(depthUpdate(103, 103, [], [["101", "0"]], eventTime + 10));
    assert.equal(connector.isReady(), false);
    assert.equal(connector.getOrderBook().bids.size, 0);

    secondResponse.resolve(jsonResponse({
      lastUpdateId: 102,
      bids: [["100", "1"]],
      asks: [["102", "1"]],
    }));
    await settle();

    assert.equal(connector.isReady(), true);
    assert.equal(connector.getOrderBook().asks.has("101"), false);
    assert.equal(errors.includes("Binance depth update sequence gap"), true);

    socket.message(depthUpdate(104, 104, [], [], eventTime + 20, "BTCUSDT"));
    assert.equal(connector.isReady(), false);
    assert.equal(errors.includes("Binance depth update symbol does not match subscription"), true);

    socket.open();
    socket.message(depthUpdate(104, 104, [["101", "9"]], [], eventTime + 30));
    await settle();
    assert.equal(fetchCalls, 2);
    assert.equal(connector.getOrderBook().bids.size, 0);
  } finally {
    connector.stop();
    globalThis.WebSocket = OriginalWebSocket;
    globalThis.fetch = originalFetch;
    FakeWebSocket.instances.length = 0;
  }
});

test("CoinbaseConnector accepts official snapshots without time and validates update event time", () => {
  const OriginalWebSocket = globalThis.WebSocket;
  const errors = [];
  globalThis.WebSocket = FakeWebSocket;
  const connector = new CoinbaseConnector("ETH-USD", undefined, (error) => errors.push(error.message));
  const updateTime = "2026-07-11T01:02:03.223456Z";

  try {
    connector.start();
    const socket = FakeWebSocket.instances.at(-1);
    socket.open();
    assert.deepEqual(JSON.parse(socket.sent[0]), {
      type: "subscribe",
      channels: [{ name: "level2", product_ids: ["ETH-USD"] }],
    });
    const snapshotReceivedAfterMs = Date.now();
    socket.message({
      type: "snapshot",
      product_id: "ETH-USD",
      bids: [["99.00", "2"]],
      asks: [["101.00", "2"]],
    });
    assert.equal(connector.isReady(), true);
    assert.equal(connector.getLastUpdateAtMs() >= snapshotReceivedAfterMs, true);
    assert.equal(connector.getLastUpdateAtMs() <= Date.now(), true);
    assert.equal(connector.getOrderBook().bids.get("99"), "2");

    socket.message({
      type: "l2update",
      product_id: "ETH-USD",
      time: updateTime,
      changes: [["buy", "99.0", "0.000"], ["sell", "100.5", "3"]],
    });
    assert.equal(connector.getOrderBook().bids.has("99"), false);
    assert.equal(connector.getOrderBook().asks.get("100.5"), "3");
    assert.equal(connector.getLastUpdateAtMs(), Date.parse(updateTime));

    socket.message({
      type: "l2update",
      product_id: "ETH-USD",
      time: "not-a-time",
      changes: [],
    });
    assert.equal(connector.isReady(), false);
    assert.equal(errors.includes("Coinbase order book timestamp is invalid"), true);
  } finally {
    connector.stop();
    globalThis.WebSocket = OriginalWebSocket;
    FakeWebSocket.instances.length = 0;
  }
});

test("CEX connectors reject oversized WebSocket messages before parsing", () => {
  const OriginalWebSocket = globalThis.WebSocket;
  const errors = [];
  globalThis.WebSocket = FakeWebSocket;
  const binance = new BinanceConnector("ETHUSDT", undefined, (error) => errors.push(error.message));
  const coinbase = new CoinbaseConnector("ETH-USD", undefined, (error) => errors.push(error.message));

  try {
    binance.start();
    const binanceSocket = FakeWebSocket.instances.at(-1);
    coinbase.start();
    const coinbaseSocket = FakeWebSocket.instances.at(-1);

    const oversizedMessage = "x".repeat(MAX_CEX_WS_MESSAGE_BYTES + 1);
    binanceSocket.rawMessage(oversizedMessage);
    coinbaseSocket.rawMessage(oversizedMessage);

    assert.equal(binanceSocket.readyState, FakeWebSocket.CLOSED);
    assert.equal(coinbaseSocket.readyState, FakeWebSocket.CLOSED);
    assert.equal(errors.includes(`Binance WebSocket message exceeds ${MAX_CEX_WS_MESSAGE_BYTES} bytes`), true);
    assert.equal(errors.includes(`Coinbase WebSocket message exceeds ${MAX_CEX_WS_MESSAGE_BYTES} bytes`), true);
  } finally {
    binance.stop();
    coinbase.stop();
    globalThis.WebSocket = OriginalWebSocket;
    FakeWebSocket.instances.length = 0;
  }
});

test("CEX connectors fail closed when exchange event time regresses", async () => {
  const OriginalWebSocket = globalThis.WebSocket;
  const originalFetch = globalThis.fetch;
  const errors = [];
  const eventTime = Date.now();
  globalThis.WebSocket = FakeWebSocket;
  globalThis.fetch = async () => jsonResponse({
    lastUpdateId: 100,
    bids: [["99", "1"]],
    asks: [["101", "1"]],
  });
  const binance = new BinanceConnector("ETHUSDT", undefined, (error) => errors.push(error.message));
  const coinbase = new CoinbaseConnector("ETH-USD", undefined, (error) => errors.push(error.message));

  try {
    binance.start();
    const binanceSocket = FakeWebSocket.instances.at(-1);
    binanceSocket.open();
    await settle();
    binanceSocket.message(depthUpdate(101, 101, [["100", "2"]], [], eventTime));
    binanceSocket.message(depthUpdate(102, 102, [["100", "3"]], [], eventTime - 1));

    coinbase.start();
    const coinbaseSocket = FakeWebSocket.instances.at(-1);
    coinbaseSocket.open();
    coinbaseSocket.message(coinbaseSnapshot());
    coinbaseSocket.message({
      type: "l2update",
      product_id: "ETH-USD",
      time: "2026-07-11T01:02:03.223Z",
      changes: [["buy", "99", "4"]],
    });
    assert.equal(coinbase.isReady(), true);
    coinbaseSocket.message({
      type: "l2update",
      product_id: "ETH-USD",
      time: "2026-07-11T01:02:03.123Z",
      changes: [["buy", "99", "3"]],
    });

    assert.equal(binance.isReady(), false);
    assert.equal(coinbase.isReady(), false);
    assert.equal(binance.getOrderBook().bids.size, 0);
    assert.equal(coinbase.getOrderBook().bids.size, 0);
    assert.equal(errors.includes("Binance depth update event time regressed"), true);
    assert.equal(errors.includes("Coinbase order book event time regressed"), true);
  } finally {
    binance.stop();
    coinbase.stop();
    globalThis.WebSocket = OriginalWebSocket;
    globalThis.fetch = originalFetch;
    FakeWebSocket.instances.length = 0;
  }
});

test("CEX connector resource limits and reconnect jitter are bounded", async () => {
  const oversizedResponse = new Response("x".repeat(MAX_CEX_SNAPSHOT_BYTES + 1), {
    headers: { "content-length": String(MAX_CEX_SNAPSHOT_BYTES + 1) },
  });
  await assert.rejects(
    () => readBoundedJsonResponse(oversizedResponse, "Binance depth snapshot"),
    new RegExp(`Binance depth snapshot exceeds ${MAX_CEX_SNAPSHOT_BYTES} bytes`),
  );
  const chunkedOversizedResponse = new Response("x".repeat(MAX_CEX_SNAPSHOT_BYTES + 1));
  await assert.rejects(
    () => readBoundedJsonResponse(chunkedOversizedResponse, "Binance depth snapshot"),
    new RegExp(`Binance depth snapshot exceeds ${MAX_CEX_SNAPSHOT_BYTES} bytes`),
  );
  const multibyteJson = `"${String.fromCodePoint(0xe9)}"`;
  assert.throws(
    () => parseBoundedJsonMessage(multibyteJson, "CEX message", 3),
    /CEX message exceeds 3 bytes/,
  );

  assert.equal(exponentialReconnectDelayMs(0, 1_000, 30_000, 0), 500);
  assert.equal(exponentialReconnectDelayMs(0, 1_000, 30_000, 0.999_999), 1_500);
  assert.equal(exponentialReconnectDelayMs(20, 1_000, 30_000, 0), 15_000);
  assert.equal(exponentialReconnectDelayMs(20, 1_000, 30_000, 0.999_999), 30_000);
});

test("CoinbaseConnector reconnects when the initial snapshot times out", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const OriginalWebSocket = globalThis.WebSocket;
  const errors = [];
  globalThis.WebSocket = FakeWebSocket;
  const connector = new CoinbaseConnector("ETH-USD", undefined, (error) => errors.push(error.message));

  try {
    connector.start();
    const expiredSocket = FakeWebSocket.instances.at(-1);
    expiredSocket.open();

    context.mock.timers.tick(10_000);
    assert.equal(connector.isReady(), false);
    assert.equal(expiredSocket.readyState, FakeWebSocket.CLOSED);
    assert.equal(errors.includes("Coinbase initial order book snapshot timed out"), true);

    context.mock.timers.tick(1_500);
    const replacementSocket = FakeWebSocket.instances.at(-1);
    assert.notEqual(replacementSocket, expiredSocket);
    replacementSocket.open();

    expiredSocket.message(coinbaseSnapshot());
    assert.equal(connector.isReady(), false);
    assert.equal(connector.getOrderBook().bids.size, 0);

    replacementSocket.message(coinbaseSnapshot());
    assert.equal(connector.isReady(), true);
    assert.equal(connector.getOrderBook().bids.get("99"), "2");

    context.mock.timers.tick(10_000);
    assert.equal(connector.isReady(), true);
    assert.equal(replacementSocket.readyState, FakeWebSocket.OPEN);
  } finally {
    connector.stop();
    globalThis.WebSocket = OriginalWebSocket;
    FakeWebSocket.instances.length = 0;
  }
});

test("CEX connectors reconnect when WebSocket handshakes stall", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const OriginalWebSocket = globalThis.WebSocket;
  const binanceErrors = [];
  const coinbaseErrors = [];
  globalThis.WebSocket = FakeWebSocket;
  const binance = new BinanceConnector("ETHUSDT", undefined, (error) => binanceErrors.push(error.message));
  const coinbase = new CoinbaseConnector("ETH-USD", undefined, (error) => coinbaseErrors.push(error.message));

  try {
    binance.start();
    const stalledBinanceSocket = FakeWebSocket.instances.at(-1);
    coinbase.start();
    const stalledCoinbaseSocket = FakeWebSocket.instances.at(-1);

    context.mock.timers.tick(10_000);
    assert.equal(stalledBinanceSocket.readyState, FakeWebSocket.CLOSED);
    assert.equal(stalledCoinbaseSocket.readyState, FakeWebSocket.CLOSED);
    assert.equal(binanceErrors.includes("Binance WebSocket connection timed out"), true);
    assert.equal(coinbaseErrors.includes("Coinbase WebSocket connection timed out"), true);

    context.mock.timers.tick(1_500);
    assert.notEqual(FakeWebSocket.instances.at(-2), stalledBinanceSocket);
    assert.notEqual(FakeWebSocket.instances.at(-1), stalledCoinbaseSocket);
  } finally {
    binance.stop();
    coinbase.stop();
    globalThis.WebSocket = OriginalWebSocket;
    FakeWebSocket.instances.length = 0;
  }
});

test("CEX connectors close errored sockets before backoff", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const OriginalWebSocket = globalThis.WebSocket;
  const errors = [];
  globalThis.WebSocket = FakeWebSocket;
  const binance = new BinanceConnector("ETHUSDT", undefined, (error) => errors.push(error.message));
  const coinbase = new CoinbaseConnector("ETH-USD", undefined, (error) => errors.push(error.message));

  try {
    binance.start();
    const failedBinanceSocket = FakeWebSocket.instances.at(-1);
    coinbase.start();
    const failedCoinbaseSocket = FakeWebSocket.instances.at(-1);

    failedBinanceSocket.error();
    failedCoinbaseSocket.error();
    assert.equal(failedBinanceSocket.readyState, FakeWebSocket.CLOSED);
    assert.equal(failedCoinbaseSocket.readyState, FakeWebSocket.CLOSED);
    assert.equal(errors.includes("Binance WebSocket error"), true);
    assert.equal(errors.includes("Coinbase WebSocket error"), true);

    context.mock.timers.tick(1_500);
    assert.notEqual(FakeWebSocket.instances.at(-2), failedBinanceSocket);
    assert.notEqual(FakeWebSocket.instances.at(-1), failedCoinbaseSocket);
  } finally {
    binance.stop();
    coinbase.stop();
    globalThis.WebSocket = OriginalWebSocket;
    FakeWebSocket.instances.length = 0;
  }
});

test("CoinbaseConnector reconnects when subscription send fails", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const OriginalWebSocket = globalThis.WebSocket;
  const errors = [];
  globalThis.WebSocket = FakeWebSocket;
  const connector = new CoinbaseConnector("ETH-USD", undefined, (error) => errors.push(error.message));

  try {
    connector.start();
    const failedSocket = FakeWebSocket.instances.at(-1);
    failedSocket.sendError = new Error("subscription write failed");
    failedSocket.open();

    assert.equal(failedSocket.readyState, FakeWebSocket.CLOSED);
    assert.deepEqual(errors, ["subscription write failed"]);

    context.mock.timers.tick(1_500);
    assert.notEqual(FakeWebSocket.instances.at(-1), failedSocket);
  } finally {
    connector.stop();
    globalThis.WebSocket = OriginalWebSocket;
    FakeWebSocket.instances.length = 0;
  }
});

class FakeObserver {
  cycles = [];
  connectorErrors = [];

  recordCexOrderBookCycle(observation) {
    this.cycles.push({ ...observation });
  }

  recordCexOrderBookConnectorError(exchange) {
    this.connectorErrors.push(exchange);
  }
}

class FakeConnector {
  name;
  ready = false;
  stopped = false;
  restartCount = 0;
  lastUpdateAtMs;
  #book = new OrderBook();

  constructor(exchange, symbol) {
    this.name = `${exchange}:${symbol}`;
  }

  start() {}

  stop() {
    this.stopped = true;
  }

  restart() {
    this.restartCount += 1;
    this.ready = false;
    this.lastUpdateAtMs = undefined;
    this.#book.clear();
  }

  getOrderBook() {
    return this.#book;
  }

  getLastUpdateAtMs() {
    return this.lastUpdateAtMs;
  }

  isReady() {
    return this.ready;
  }

  setSnapshot(bids, asks, observedAtMs) {
    this.#book.applySnapshot({ bids, asks });
    this.lastUpdateAtMs = observedAtMs;
    this.ready = true;
  }
}

class FakeWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  static instances = [];
  readyState = 0;
  sent = [];
  sendError;
  onopen;
  onmessage;
  onclose;
  onerror;

  constructor() {
    FakeWebSocket.instances.push(this);
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  send(payload) {
    if (this.sendError) throw this.sendError;
    this.sent.push(payload);
  }

  message(payload) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }

  rawMessage(payload) {
    this.onmessage?.({ data: payload });
  }

  error() {
    this.onerror?.();
  }

  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.();
  }
}

function depthUpdate(first, last, bids, asks, eventTime, symbol = "ETHUSDT") {
  return { e: "depthUpdate", E: eventTime, s: symbol, U: first, u: last, b: bids, a: asks };
}

function coinbaseSnapshot() {
  return {
    type: "snapshot",
    product_id: "ETH-USD",
    bids: [["99", "2"]],
    asks: [["101", "2"]],
  };
}

function jsonResponse(payload) {
  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json" },
  });
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}
