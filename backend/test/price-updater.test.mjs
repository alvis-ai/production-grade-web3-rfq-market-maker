import assert from "node:assert/strict";
import test from "node:test";
import { BackgroundPriceUpdater } from "../dist/modules/market-data/price-updater.js";
import { SharedPriceCache, pairKey } from "../dist/modules/market-data/price-cache.js";

const request = {
  chainId: 1,
  user: "0x0000000000000000000000000000000000000001",
  tokenIn: "0x0000000000000000000000000000000000000002",
  tokenOut: "0x0000000000000000000000000000000000000003",
  amountIn: "1",
  slippageBps: 0,
};

test("BackgroundPriceUpdater coalesces overlapping refreshes", async () => {
  const gate = deferred();
  const cache = new SharedPriceCache(60_000);
  let requests = 0;
  const outcomes = [];
  const updater = new BackgroundPriceUpdater(
    {
      async getSnapshot() {
        requests += 1;
        await gate.promise;
        return snapshot("snap_refresh");
      },
    },
    cache,
    { pairs: [request], intervalMs: 250, maxAgeMs: 5_000 },
    { recordMarketDataRefresh(outcome) { outcomes.push(outcome); } },
  );

  const first = updater.refreshOnce();
  const overlapping = updater.refreshOnce();
  assert.equal(first, overlapping);
  assert.equal(requests, 1);

  gate.resolve();
  await Promise.all([first, overlapping]);
  assert.equal(requests, 1);
  assert.deepEqual(outcomes, ["success"]);
  assert.equal(cache.get(pairKey(1, request.tokenIn, request.tokenOut))?.snapshotId, "snap_refresh");
});

test("BackgroundPriceUpdater records failures without trusting observer side effects", async () => {
  const outcomes = [];
  const updater = new BackgroundPriceUpdater(
    { async getSnapshot() { throw new Error("RPC unavailable"); } },
    new SharedPriceCache(60_000),
    { pairs: [request], intervalMs: 250, maxAgeMs: 5_000 },
    {
      recordMarketDataRefresh(outcome) {
        outcomes.push(outcome);
        throw new Error("observer failed");
      },
    },
  );

  await updater.refreshOnce();
  assert.deepEqual(outcomes, ["failure"]);
});

test("BackgroundPriceUpdater validates its observer", () => {
  assert.throws(
    () => new BackgroundPriceUpdater(
      { async getSnapshot() { return snapshot("unused"); } },
      new SharedPriceCache(60_000),
      { pairs: [request], intervalMs: 250, maxAgeMs: 5_000 },
      {},
    ),
    /observer.recordMarketDataRefresh must be a function/,
  );
});

test("BackgroundPriceUpdater starts once and waits for an active refresh during stop", async () => {
  const gate = deferred();
  let requests = 0;
  const updater = new BackgroundPriceUpdater(
    {
      async getSnapshot() {
        requests += 1;
        await gate.promise;
        return snapshot("snap_stop");
      },
    },
    new SharedPriceCache(60_000),
    { pairs: [request], intervalMs: 250, maxAgeMs: 5_000 },
  );

  updater.start();
  updater.start();
  assert.equal(requests, 1);

  let stopped = false;
  const stopping = updater.stop().then(() => { stopped = true; });
  await Promise.resolve();
  assert.equal(stopped, false);

  gate.resolve();
  await stopping;
  assert.equal(stopped, true);
  assert.equal(requests, 1);
});

function snapshot(snapshotId) {
  return {
    snapshotId,
    midPrice: "1",
    liquidityUsd: "1000000",
    marketSpreadBps: 0,
    volatilityBps: 20,
    observedAt: new Date().toISOString(),
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
