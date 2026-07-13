import assert from "node:assert/strict";
import test from "node:test";
import { CEXOrderBookMonitor } from "../dist/modules/market-data/cex-orderbook/cex-orderbook-monitor.js";
import { BinanceConnector } from "../dist/modules/market-data/cex-orderbook/binance-connector.js";
import { CoinbaseConnector } from "../dist/modules/market-data/cex-orderbook/coinbase-connector.js";
import { OrderBook } from "../dist/modules/market-data/cex-orderbook/orderbook.js";
import { getMarketDataSnapshotSource } from "../dist/modules/market-data/market-data.service.js";
import { SharedPriceCache, pairKey } from "../dist/modules/market-data/price-cache.js";

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
  assert.equal(book.getMetrics(100).liquidityUsd, "99");
  assert.equal(book.getMetrics(2_000).liquidityUsd, "9099");

  book.applyDelta({ bids: [], asks: [["101", "1000"]] });
  assert.equal(book.getMetrics(100).liquidityUsd, "99");

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

  book.applySnapshot({ bids: [["101", "1"]], asks: [["100", "1"]] });
  assert.equal(book.getMetrics().midPrice, "0");
  assert.equal(book.getMetrics().liquidityUsd, "0");
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
      { chainId: 1, tokenIn, tokenOut, exchange: "binance", symbol: "ETHUSDT" },
      { chainId: 1, tokenIn, tokenOut, exchange: "coinbase", symbol: "ETH-USDT" },
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
    assert.equal(snapshot.midPrice, "102");
    assert.equal(snapshot.liquidityUsd, "306");
    assert.equal(snapshot.volatilityBps, 10);
    assert.equal(snapshot.observedAt, new Date(now - 100).toISOString());
    assert.equal(getMarketDataSnapshotSource(snapshot), "cex:binance+coinbase");
    assert.match(snapshot.snapshotId, /_cex$/);

    monitor.flushOnce(now + 10);
    assert.equal(cache.get(pairKey(1, tokenIn, tokenOut)), snapshot);

    connectors.get("coinbase:ETH-USDT").ready = false;
    connectors.get("binance:ETHUSDT").setSnapshot([["99.75", "1"]], [["100.25", "1"]], now + 20);
    monitor.flushOnce(now + 20);
    const fallback = cache.get(pairKey(1, tokenIn, tokenOut));
    assert.equal(fallback.midPrice, "100");
    assert.equal(fallback.liquidityUsd, "99");
    assert.equal(observer.cycles.at(-1).readySources, 1);
    assert.equal(observer.cycles.at(-1).unavailableSources, 1);
  } finally {
    monitor.stop();
  }

  assert.equal(cache.get(pairKey(1, tokenIn, tokenOut)), undefined);
  assert.equal(connectors.get("binance:ETHUSDT").stopped, true);
  assert.equal(connectors.get("coinbase:ETH-USDT").stopped, true);
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
      { chainId: 1, tokenIn, tokenOut, exchange: "binance", symbol: "ETHUSDT" },
      { chainId: 1, tokenIn, tokenOut, exchange: "coinbase", symbol: "ETH-USDT" },
    ],
    maxSourceAgeMs: 2_000,
    minSources: 2,
    maxSourceDeviationBps: 100,
  }, observer, factory);
  const key = pairKey(1, tokenIn, tokenOut);
  const now = Date.now();

  monitor.start();
  try {
    connectors.get("binance:ETHUSDT").setSnapshot([["99.9", "10"]], [["100.1", "10"]], now);
    connectors.get("coinbase:ETH-USDT").setSnapshot([["103.9", "10"]], [["104.1", "10"]], now);
    monitor.flushOnce(now);
    assert.equal(cache.get(key), undefined);
    assert.equal(observer.cycles.at(-1).blockedPairs, 1);
    assert.equal(observer.cycles.at(-1).deviationRejectedSources, 2);

    connectors.get("coinbase:ETH-USDT").setSnapshot([["100.1", "10"]], [["100.3", "10"]], now + 10);
    monitor.flushOnce(now + 10);
    assert.equal(cache.get(key).midPrice, "100.1");
    assert.equal(observer.cycles.at(-1).usablePairs, 1);

    monitor.flushOnce(now + 2_500);
    assert.equal(cache.get(key), undefined);
    assert.equal(observer.cycles.at(-1).staleSources, 2);
    assert.equal(connectors.get("binance:ETHUSDT").restartCount, 1);
    assert.equal(connectors.get("coinbase:ETH-USDT").restartCount, 1);
  } finally {
    monitor.stop();
  }
});

test("CEXOrderBookMonitor rejects unsafe quorum and dependency configuration", () => {
  const pair = { chainId: 1, tokenIn, tokenOut, exchange: "binance", symbol: "ETHUSDT" };
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
    () => new CEXOrderBookMonitor(new SharedPriceCache(), { pairs: [pair], minSources: 2 }),
    /at least minSources/,
  );
  assert.throws(
    () => new CEXOrderBookMonitor(new SharedPriceCache(), { pairs: [pair], flushIntervalMs: 1 }),
    /flushIntervalMs/,
  );
  assert.throws(
    () => new CEXOrderBookMonitor(new SharedPriceCache(), { pairs: [pair] }, {}),
    /observer.recordCexOrderBookCycle/,
  );
});

test("BinanceConnector bridges buffered updates and resynchronizes sequence gaps", async () => {
  const OriginalWebSocket = globalThis.WebSocket;
  const originalFetch = globalThis.fetch;
  const firstResponse = deferred();
  const secondResponse = deferred();
  const responses = [firstResponse, secondResponse];
  const errors = [];
  globalThis.WebSocket = FakeWebSocket;
  globalThis.fetch = async () => responses.shift().promise;
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
  } finally {
    connector.stop();
    globalThis.WebSocket = OriginalWebSocket;
    globalThis.fetch = originalFetch;
    FakeWebSocket.instances.length = 0;
  }
});

test("CoinbaseConnector validates snapshots, event time, and level updates", () => {
  const OriginalWebSocket = globalThis.WebSocket;
  const errors = [];
  globalThis.WebSocket = FakeWebSocket;
  const connector = new CoinbaseConnector("ETH-USD", undefined, (error) => errors.push(error.message));
  const snapshotTime = "2026-07-11T01:02:03.123456Z";
  const updateTime = "2026-07-11T01:02:03.223456Z";

  try {
    connector.start();
    const socket = FakeWebSocket.instances.at(-1);
    socket.open();
    assert.deepEqual(JSON.parse(socket.sent[0]), {
      type: "subscribe",
      channels: [{ name: "level2", product_ids: ["ETH-USD"] }],
    });
    socket.message({
      type: "snapshot",
      product_id: "ETH-USD",
      time: snapshotTime,
      bids: [["99.00", "2"]],
      asks: [["101.00", "2"]],
    });
    assert.equal(connector.isReady(), true);
    assert.equal(connector.getLastUpdateAtMs(), Date.parse(snapshotTime));
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
  static instances = [];
  readyState = 0;
  sent = [];
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
    this.sent.push(payload);
  }

  message(payload) {
    this.onmessage?.({ data: JSON.stringify(payload) });
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

function jsonResponse(payload) {
  return { ok: true, json: async () => payload };
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
