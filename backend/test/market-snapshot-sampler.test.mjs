import assert from "node:assert/strict";
import test from "node:test";
import {
  BackgroundMarketSnapshotSampler,
  buildMarketSnapshotSamplingPairs,
} from "../dist/modules/market-data/market-snapshot-sampler.js";
import { tagMarketDataSnapshot } from "../dist/modules/market-data/market-data.service.js";
import { SharedPriceCache, pairKey } from "../dist/modules/market-data/price-cache.js";

const tokenA = "0x0000000000000000000000000000000000000002";
const tokenB = "0x0000000000000000000000000000000000000003";
const request = buildMarketSnapshotSamplingPairs(
  [{ chainId: 1, tokenIn: tokenA, tokenOut: tokenB }],
  [],
)[0];

test("BackgroundMarketSnapshotSampler persists each fresh cache snapshot once", async () => {
  const cache = new SharedPriceCache(60_000);
  const writes = [];
  const store = { async saveSnapshot(input) { writes.push(input); return {}; } };
  const sampler = new BackgroundMarketSnapshotSampler(store, {
    pairs: [request], caches: [cache], requiredPrimaryCacheKeys: [], intervalMs: 5_000,
  });
  cache.set(pairKey(1, tokenA, tokenB), snapshot("snap_1", "cex:binance"));

  assert.deepEqual(await sampler.sampleOnce(), { saved: 1, unchanged: 0, unavailable: 0, failed: 0 });
  assert.deepEqual(await sampler.sampleOnce(), { saved: 0, unchanged: 1, unavailable: 0, failed: 0 });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].source, "cex:binance");

  cache.set(pairKey(1, tokenA, tokenB), snapshot("snap_2", "cex:coinbase"));
  assert.equal((await sampler.sampleOnce()).saved, 1);
  assert.equal(writes.length, 2);
});

test("BackgroundMarketSnapshotSampler never falls back for live-book-required pairs", async () => {
  const primary = new SharedPriceCache(60_000);
  const fallback = new SharedPriceCache(60_000);
  const writes = [];
  const key = pairKey(1, tokenA, tokenB);
  fallback.set(key, snapshot("fallback_1", "chainlink"));
  const sampler = new BackgroundMarketSnapshotSampler(
    { async saveSnapshot(input) { writes.push(input); return {}; } },
    { pairs: [request], caches: [primary, fallback], requiredPrimaryCacheKeys: [key], intervalMs: 5_000 },
  );

  assert.deepEqual(await sampler.sampleOnce(), { saved: 0, unchanged: 0, unavailable: 1, failed: 0 });
  assert.equal(writes.length, 0);
  primary.set(key, snapshot("cex_1", "cex:binance+coinbase"));
  assert.equal((await sampler.sampleOnce()).saved, 1);
});

test("BackgroundMarketSnapshotSampler retries failed persistence and builds both CEX directions", async () => {
  const pairs = buildMarketSnapshotSamplingPairs([], [
    { chainId: 1, tokenIn: tokenA, tokenOut: tokenB },
    { chainId: 1, tokenIn: tokenA, tokenOut: tokenB },
  ]);
  assert.equal(pairs.length, 2);
  assert.equal(pairs.some((pair) => pair.tokenIn === tokenB && pair.tokenOut === tokenA), true);

  const cache = new SharedPriceCache(60_000);
  cache.set(pairKey(1, tokenA, tokenB), snapshot("snap_retry", "static"));
  let attempts = 0;
  const sampler = new BackgroundMarketSnapshotSampler(
    { async saveSnapshot() { attempts += 1; if (attempts === 1) throw new Error("db down"); return {}; } },
    { pairs: [request], caches: [cache], requiredPrimaryCacheKeys: [], intervalMs: 5_000 },
  );
  assert.equal((await sampler.sampleOnce()).failed, 1);
  assert.equal((await sampler.sampleOnce()).saved, 1);
  assert.equal(attempts, 2);
});

function snapshot(snapshotId, source) {
  return tagMarketDataSnapshot({
    snapshotId,
    midPrice: "1",
    liquidityUsd: "1000000",
    marketSpreadBps: 10,
    volatilityBps: 20,
    observedAt: "2026-07-14T00:00:00.000Z",
  }, source);
}
