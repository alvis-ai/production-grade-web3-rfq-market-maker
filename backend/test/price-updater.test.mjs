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
  assert.throws(() => updater.assertConfiguredCoverage(), /initial coverage is incomplete/);
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

test("BackgroundPriceUpdater logs only failure and recovery transitions", async () => {
  let failing = true;
  const records = [];
  const updater = new BackgroundPriceUpdater(
    {
      async getSnapshot() {
        if (failing) throw new Error("secret provider detail");
        return snapshot("snap_recovered");
      },
    },
    new SharedPriceCache(60_000),
    { pairs: [request], intervalMs: 250, maxAgeMs: 5_000 },
    undefined,
    transitionLogger(records),
  );

  await updater.refreshOnce();
  await updater.refreshOnce();
  failing = false;
  await updater.refreshOnce();
  failing = true;
  await updater.refreshOnce();

  assert.deepEqual(records.map(({ level, fields }) => [level, fields.errorCode]), [
    ["warn", "MARKET_DATA_REFRESH_FAILED"],
    ["info", "MARKET_DATA_REFRESH_RECOVERED"],
    ["warn", "MARKET_DATA_REFRESH_FAILED"],
  ]);
  assert.equal(JSON.stringify(records).includes("secret provider detail"), false);
});

test("BackgroundPriceUpdater isolates and validates its logger", async () => {
  const updater = new BackgroundPriceUpdater(
    { async getSnapshot() { throw new Error("provider failed"); } },
    new SharedPriceCache(60_000),
    { pairs: [request], intervalMs: 250, maxAgeMs: 5_000 },
    undefined,
    { info() { throw new Error("logger failed"); }, warn() { throw new Error("logger failed"); } },
  );
  await updater.refreshOnce();

  assert.throws(
    () => new BackgroundPriceUpdater(
      { async getSnapshot() { return snapshot("unused"); } },
      new SharedPriceCache(60_000),
      { pairs: [request], intervalMs: 250, maxAgeMs: 5_000 },
      undefined,
      { warn() {} },
    ),
    /logger must expose info and warn methods/,
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

function transitionLogger(records) {
  return {
    info(fields, message) { records.push({ level: "info", fields, message }); },
    warn(fields, message) { records.push({ level: "warn", fields, message }); },
  };
}
