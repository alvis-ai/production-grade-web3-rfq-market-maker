import assert from "node:assert/strict";
import test from "node:test";
import { CEXOrderBookMonitor } from "../dist/modules/market-data/cex-orderbook/cex-orderbook-monitor.js";
import { BinanceConnector } from "../dist/modules/market-data/cex-orderbook/binance-connector.js";
import { OrderBook } from "../dist/modules/market-data/cex-orderbook/orderbook.js";
import { SharedPriceCache, pairKey } from "../dist/modules/market-data/price-cache.js";

const tokenIn = "0x0000000000000000000000000000000000000002";
const tokenOut = "0x0000000000000000000000000000000000000003";

test("OrderBook validates levels, crossed books, and depth-specific metric caches", () => {
  const book = new OrderBook();
  book.applySnapshot({
    bids: [["99", "1"], ["90", "100"], ["invalid", "1"]],
    asks: [["101", "1"], ["110", "100"], ["102", "-1"]],
  });

  assert.equal(book.bids.size, 2);
  assert.equal(book.asks.size, 2);
  assert.equal(book.getMetrics(100).midPrice, "100");
  assert.equal(book.getMetrics(100).liquidityUsd, "200");
  assert.equal(book.getMetrics(2_000).liquidityUsd, "20200");

  book.applySnapshot({ bids: [["101", "1"]], asks: [["100", "1"]] });
  assert.equal(book.getMetrics().midPrice, "0");
  assert.equal(book.getMetrics().liquidityUsd, "0");
  assert.throws(() => book.getMetrics(0), /depthRangeBps/);
});

test("CEXOrderBookMonitor aggregates synchronized exchange sources by pair", () => {
  const cache = new SharedPriceCache();
  const connectors = new Map();
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
  }, factory);

  monitor.start();
  try {
    connectors.get("binance:ETHUSDT").setSnapshot([["99.75", "1"]], [["100.25", "1"]]);
    connectors.get("coinbase:ETH-USDT").setSnapshot([["103.75", "2"]], [["104.25", "2"]]);
    monitor.flushOnce();

    const snapshot = cache.get(pairKey(1, tokenIn, tokenOut));
    assert.equal(snapshot.midPrice, "102");
    assert.equal(snapshot.liquidityUsd, "616");
    assert.equal(snapshot.volatilityBps, 10);
    assert.match(snapshot.snapshotId, /_cex$/);

    connectors.get("coinbase:ETH-USDT").ready = false;
    monitor.flushOnce();
    const fallback = cache.get(pairKey(1, tokenIn, tokenOut));
    assert.equal(fallback.midPrice, "100");
    assert.equal(fallback.liquidityUsd, "200");
  } finally {
    monitor.stop();
  }

  assert.equal(connectors.get("binance:ETHUSDT").stopped, true);
  assert.equal(connectors.get("coinbase:ETH-USDT").stopped, true);
});

test("CEXOrderBookMonitor rejects duplicate and malformed source configuration", () => {
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
    () => new CEXOrderBookMonitor(new SharedPriceCache(), { pairs: [pair], flushIntervalMs: 1 }),
    /flushIntervalMs/,
  );
});

test("BinanceConnector bridges buffered updates to REST snapshots and drops stale books on gaps", async () => {
  const OriginalWebSocket = globalThis.WebSocket;
  const originalFetch = globalThis.fetch;
  const firstResponse = deferred();
  const secondResponse = deferred();
  const responses = [firstResponse, secondResponse];
  const errors = [];
  globalThis.WebSocket = FakeWebSocket;
  globalThis.fetch = async () => responses.shift().promise;

  const connector = new BinanceConnector("ETHUSDT", () => {}, (error) => errors.push(error.message));
  try {
    connector.start();
    const socket = FakeWebSocket.instances.at(-1);
    socket.open();
    socket.message(depthUpdate(101, 101, [["100", "2"]], []));
    firstResponse.resolve(jsonResponse({
      lastUpdateId: 100,
      bids: [["99", "1"]],
      asks: [["101", "1"]],
    }));
    await settle();

    assert.equal(connector.isReady(), true);
    assert.equal(connector.getOrderBook().bids.get("100"), "2");

    socket.message(depthUpdate(103, 103, [], [["101", "0"]]));
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

    socket.close();
    assert.equal(connector.isReady(), false);
    assert.equal(connector.getOrderBook().asks.size, 0);
  } finally {
    connector.stop();
    globalThis.WebSocket = OriginalWebSocket;
    globalThis.fetch = originalFetch;
    FakeWebSocket.instances.length = 0;
  }
});

class FakeConnector {
  name;
  ready = false;
  stopped = false;
  #book = new OrderBook();

  constructor(exchange, symbol) {
    this.name = `${exchange}:${symbol}`;
  }

  start() {}

  stop() {
    this.stopped = true;
  }

  getOrderBook() {
    return this.#book;
  }

  isReady() {
    return this.ready;
  }

  setSnapshot(bids, asks) {
    this.#book.applySnapshot({ bids, asks });
    this.ready = true;
  }
}

class FakeWebSocket {
  static OPEN = 1;
  static instances = [];
  readyState = 0;
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

  message(payload) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }

  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.();
  }
}

function depthUpdate(first, last, bids, asks) {
  return { e: "depthUpdate", U: first, u: last, b: bids, a: asks };
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
