import assert from "node:assert/strict";
import test from "node:test";
import {
  getMarketSnapshotIssue,
  StaticMarketDataService,
} from "../dist/modules/market-data/market-data.service.js";
import { InMemoryMarketSnapshotRepository } from "../dist/modules/market-data/market-snapshot.repository.js";

const request = {
  chainId: 1,
  user: "0x0000000000000000000000000000000000000001",
  tokenIn: "0x0000000000000000000000000000000000000002",
  tokenOut: "0x0000000000000000000000000000000000000003",
  amountIn: "1000000000",
  slippageBps: 50,
};

const snapshot = {
  snapshotId: "snapshot_1",
  midPrice: "1.25",
  liquidityUsd: "10000000000000",
  marketSpreadBps: 0,
  volatilityBps: 25,
  observedAt: "2026-06-29T00:00:00.000Z",
};

test("StaticMarketDataService returns unique pair snapshots", async () => {
  const service = new StaticMarketDataService();
  const result = await service.getSnapshot(request);
  const second = await service.getSnapshot(request);

  assert.match(result.snapshotId, /^snapshot_1_00000000_00000000_[0-9a-z]+_[0-9a-z]+$/);
  assert.match(second.snapshotId, /^snapshot_1_00000000_00000000_[0-9a-z]+_[0-9a-z]+$/);
  assert.notEqual(result.snapshotId, second.snapshotId);
  assert.equal(result.midPrice, "1");
  assert.equal(result.liquidityUsd, "10000000000000");
  assert.equal(result.volatilityBps, 25);
  assert.match(result.observedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.equal(new Date(result.observedAt).toISOString(), result.observedAt);
});

test("StaticMarketDataService rejects unconfigured token pairs", async () => {
  const service = new StaticMarketDataService();

  await assert.rejects(
    service.getSnapshot({
      ...request,
      tokenOut: "0x0000000000000000000000000000000000000004",
    }),
    /Market data pair is not configured/,
  );
});

test("StaticMarketDataService snapshots supported pairs at construction", async () => {
  const mutablePair = {
    chainId: 1,
    tokenIn: "0x0000000000000000000000000000000000000002",
    tokenOut: "0x0000000000000000000000000000000000000003",
  };
  const mutableConfig = {
    supportedPairs: [mutablePair],
  };
  const service = new StaticMarketDataService(mutableConfig);

  mutablePair.tokenOut = "0x0000000000000000000000000000000000000004";
  mutableConfig.supportedPairs.push({
    chainId: 1,
    tokenIn: "0x0000000000000000000000000000000000000002",
    tokenOut: "0x0000000000000000000000000000000000000005",
  });

  const result = await service.getSnapshot(request);
  assert.match(result.snapshotId, /^snapshot_1_00000000_00000000_[0-9a-z]+_[0-9a-z]+$/);

  await assert.rejects(
    service.getSnapshot({
      ...request,
      tokenOut: "0x0000000000000000000000000000000000000005",
    }),
    /Market data pair is not configured/,
  );
});

test("getMarketSnapshotIssue accepts fresh positive market snapshots", () => {
  withFixedNow("2026-06-29T00:00:02.000Z", () => {
    assert.equal(getMarketSnapshotIssue(snapshot, 5_000), undefined);
  });
});

test("InMemoryMarketSnapshotRepository stores idempotent market snapshots", async () => {
  const repository = new InMemoryMarketSnapshotRepository();
  const stored = await repository.saveSnapshot({ request, snapshot });
  const replayed = await repository.saveSnapshot({ request, snapshot });
  const reloaded = await repository.findBySnapshotId(snapshot.snapshotId);

  assert.equal(stored.snapshotId, snapshot.snapshotId);
  assert.equal(stored.chainId, request.chainId);
  assert.equal(stored.tokenIn, request.tokenIn);
  assert.equal(stored.tokenOut, request.tokenOut);
  assert.equal(stored.midPrice, snapshot.midPrice);
  assert.equal(stored.liquidityUsd, snapshot.liquidityUsd);
  assert.equal(stored.volatilityBps, snapshot.volatilityBps);
  assert.equal(stored.source, "static-market-data-v1");
  assert.equal(stored.observedAt, snapshot.observedAt);
  assert.equal(replayed.createdAt, stored.createdAt);
  assert.deepEqual(reloaded, stored);
});

test("InMemoryMarketSnapshotRepository returns defensive copies", async () => {
  const repository = new InMemoryMarketSnapshotRepository();
  const stored = await repository.saveSnapshot({ request, snapshot });

  stored.midPrice = "999";
  const reloaded = await repository.findBySnapshotId(snapshot.snapshotId);

  assert.notEqual(reloaded, stored);
  assert.equal(reloaded.midPrice, snapshot.midPrice);
});

function withFixedNow(isoTimestamp, callback) {
  const originalDateNow = Date.now;
  Date.now = () => new Date(isoTimestamp).getTime();
  try {
    callback();
  } finally {
    Date.now = originalDateNow;
  }
}
