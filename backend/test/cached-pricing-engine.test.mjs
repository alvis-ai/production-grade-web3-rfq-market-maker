import assert from "node:assert/strict";
import test from "node:test";
import {
  CachedPricingEngine,
  defaultPricingCacheConfig,
} from "../dist/modules/pricing/cached-pricing.engine.js";

test("CachedPricingEngine caches exact pricing state and returns defensive copies", async () => {
  const calls = [];
  const observations = { hits: 0, misses: 0 };
  const engine = new CachedPricingEngine({
    async price(input) {
      calls.push(input);
      return pricingResult();
    },
  }, defaultPricingCacheConfig, observer(observations), () => 1_000);

  const first = await engine.price(pricingInput());
  first.amountOut = "1";
  const second = await engine.price(pricingInput());

  assert.equal(calls.length, 1);
  assert.equal(second.amountOut, "998");
  assert.deepEqual(observations, { hits: 1, misses: 1 });
});

test("CachedPricingEngine keys every state input that changes a quote", async () => {
  let calls = 0;
  const engine = new CachedPricingEngine({
    async price() {
      calls += 1;
      return pricingResult();
    },
  }, defaultPricingCacheConfig, undefined, () => 1_000);

  await engine.price(pricingInput());
  await engine.price({
    ...pricingInput(),
    request: { ...pricingInput().request, amountIn: "1001" },
  });
  await engine.price({
    ...pricingInput(),
    snapshot: { ...pricingInput().snapshot, snapshotId: "snapshot_2" },
  });
  await engine.price({ ...pricingInput(), inventorySkewBps: 1 });
  await engine.price({ ...pricingInput(), hedgeCostBps: 1 });

  assert.equal(calls, 5);
});

test("CachedPricingEngine expires entries and enforces its LRU capacity", async () => {
  let nowMs = 1_000;
  let calls = 0;
  const engine = new CachedPricingEngine({
    async price() {
      calls += 1;
      return pricingResult();
    },
  }, { ttlMs: 10, maxEntries: 1 }, undefined, () => nowMs);

  await engine.price(pricingInput());
  nowMs = 1_011;
  await engine.price(pricingInput());
  await engine.price({ ...pricingInput(), inventorySkewBps: 1 });
  await engine.price(pricingInput());

  assert.equal(calls, 4);
});

test("CachedPricingEngine coalesces concurrent identical calculations", async () => {
  let calls = 0;
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const engine = new CachedPricingEngine({
    async price() {
      calls += 1;
      await pending;
      return pricingResult();
    },
  });

  const first = engine.price(pricingInput());
  const second = engine.price(pricingInput());
  release();

  assert.deepEqual(await Promise.all([first, second]), [pricingResult(), pricingResult()]);
  assert.equal(calls, 1);
});

test("CachedPricingEngine does not cache failures and rejects unsafe construction", async () => {
  let calls = 0;
  const engine = new CachedPricingEngine({
    async price() {
      calls += 1;
      if (calls === 1) throw new Error("pricing unavailable");
      return pricingResult();
    },
  });

  await assert.rejects(engine.price(pricingInput()), /pricing unavailable/);
  assert.deepEqual(await engine.price(pricingInput()), pricingResult());
  assert.equal(calls, 2);

  assert.throws(
    () => new CachedPricingEngine({ price() {} }, { ...defaultPricingCacheConfig, ttlMs: 0 }),
    /ttlMs must be a positive safe integer/,
  );
  assert.throws(
    () => new CachedPricingEngine({ price() {} }, { ...defaultPricingCacheConfig, unexpected: true }),
    /contains unknown field unexpected/,
  );
});

function observer(observations) {
  return {
    recordPricingCacheHit() {
      observations.hits += 1;
    },
    recordPricingCacheMiss() {
      observations.misses += 1;
    },
  };
}

function pricingInput() {
  return {
    request: {
      chainId: 1,
      user: "0x0000000000000000000000000000000000000001",
      tokenIn: "0x0000000000000000000000000000000000000002",
      tokenOut: "0x0000000000000000000000000000000000000003",
      amountIn: "1000",
      slippageBps: 50,
    },
    snapshot: {
      snapshotId: "snapshot_1",
      midPrice: "1",
      liquidityUsd: "1000000",
      marketSpreadBps: 1,
      volatilityBps: 2,
      observedAt: "2026-07-17T00:00:00.000Z",
    },
    routePlan: {
      routeId: "route_1",
      venue: "internal_inventory",
      tokenIn: "0x0000000000000000000000000000000000000002",
      tokenOut: "0x0000000000000000000000000000000000000003",
      expectedLiquidityUsd: "1000000",
    },
    inventorySkewBps: 0,
    hedgeCostBps: 0,
  };
}

function pricingResult() {
  return {
    amountOut: "998",
    minAmountOut: "990",
    spreadBps: 8,
    sizeImpactBps: 1,
    marketSpreadBps: 1,
    inventorySkewBps: 0,
    volatilityPremiumBps: 0,
    hedgeCostBps: 0,
    pricingVersion: "formula-v4:internal_inventory",
  };
}
