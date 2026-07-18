import assert from "node:assert/strict";
import test from "node:test";
import { RefreshingInventoryView } from "../dist/modules/inventory/refreshing-inventory.view.js";
import { HotMarketSnapshotStore } from "../dist/modules/market-data/hot-market-snapshot.store.js";

const tokenA = "0x0000000000000000000000000000000000000011";
const tokenB = "0x0000000000000000000000000000000000000022";

test("HotMarketSnapshotStore preloads latest pair state and serves latest reads from memory", async () => {
  const latest = snapshot("snapshot_bootstrap", "2026-07-18T00:00:00.000Z");
  let latestReads = 0;
  const durable = {
    async saveSnapshot() { throw new Error("unused save"); },
    async findBySnapshotId() { return undefined; },
    async findLatestForPair() {
      latestReads += 1;
      return latest;
    },
  };
  const store = new HotMarketSnapshotStore(durable, { maxSnapshots: 100 });

  await store.initialize([
    { chainId: 1, tokenA, tokenB },
    { chainId: 1, tokenA: tokenB, tokenB: tokenA },
  ]);

  assert.equal(latestReads, 1);
  assert.deepEqual(await store.findLatestForPair(1, tokenA, tokenB), latest);
  assert.equal(latestReads, 1);
  assert.equal(store.hotSnapshotCount(), 1);
});

test("HotMarketSnapshotStore publishes a snapshot only after durable persistence succeeds", async () => {
  let fail = true;
  const record = snapshot("snapshot_write", "2026-07-18T00:00:01.000Z");
  const durable = {
    async saveSnapshot() {
      if (fail) throw new Error("durable unavailable");
      return record;
    },
    async findBySnapshotId() { return undefined; },
    async findLatestForPair() { return undefined; },
  };
  const store = new HotMarketSnapshotStore(durable, { maxSnapshots: 100 });

  await assert.rejects(store.saveSnapshot({}), /durable unavailable/);
  assert.equal(store.hotSnapshotCount(), 0);
  fail = false;
  await store.saveSnapshot({});
  assert.equal((await store.findLatestForPair(1, tokenA, tokenB)).snapshotId, record.snapshotId);
});

test("RefreshingInventoryView atomically replaces snapshots and fails closed when stale", async () => {
  let nowMs = 1_700_000_000_000;
  let balance = 10n;
  let listReads = 0;
  const source = {
    async checkHealth() {},
    async applySettlement(delta) { balance += BigInt(delta.amountIn); },
    async rebuildFromSettlements() { balance = 0n; },
    async projectSettlement() { throw new Error("quote path must not delegate"); },
    async calculateQuoteSkewBps() { throw new Error("quote path must not delegate"); },
    async getPosition() { throw new Error("quote path must not delegate"); },
    async listPositions(chainId) {
      listReads += 1;
      return [{ chainId, token: tokenA, balance }];
    },
  };
  const view = new RefreshingInventoryView(
    source,
    { chainIds: [1], refreshIntervalMs: 10, maxAgeMs: 20 },
    undefined,
    undefined,
    () => nowMs,
  );

  await view.refresh();
  assert.equal(view.getPosition(1, tokenA).balance, 10n);
  assert.equal(listReads, 1);
  balance = 25n;
  assert.equal(view.getPosition(1, tokenA).balance, 10n);
  await view.refresh();
  assert.equal(view.getPosition(1, tokenA).balance, 25n);
  nowMs += 21;
  assert.throws(() => view.getPosition(1, tokenA), /hot state is stale/);
});

function snapshot(snapshotId, observedAt) {
  return {
    snapshotId,
    chainId: 1,
    tokenIn: tokenA,
    tokenOut: tokenB,
    midPrice: "1.000000000000000000",
    liquidityUsd: "1000000",
    marketSpreadBps: 10,
    volatilityBps: 100,
    source: "test",
    observedAt,
    createdAt: observedAt,
  };
}
