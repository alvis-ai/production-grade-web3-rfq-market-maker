import assert from "node:assert/strict";
import test from "node:test";
import {
  getMarketSnapshotIssue,
  StaticMarketDataService,
} from "../dist/modules/market-data/market-data.service.js";

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
  volatilityBps: 25,
  observedAt: "2026-06-29T00:00:00.000Z",
};

test("StaticMarketDataService returns deterministic pair snapshots", async () => {
  const service = new StaticMarketDataService();
  const result = await service.getSnapshot(request);

  assert.equal(result.snapshotId, "snapshot_1_00000000_00000000");
  assert.equal(result.midPrice, "1");
  assert.equal(result.liquidityUsd, "10000000000000");
  assert.equal(result.volatilityBps, 25);
  assert.doesNotThrow(() => new Date(result.observedAt).toISOString());
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

test("getMarketSnapshotIssue accepts fresh positive market snapshots", () => {
  withFixedNow("2026-06-29T00:00:02.000Z", () => {
    assert.equal(getMarketSnapshotIssue(snapshot, 5_000), undefined);
  });
});

test("getMarketSnapshotIssue rejects stale or future-skewed market snapshots", () => {
  withFixedNow("2026-06-29T00:00:10.001Z", () => {
    assert.equal(getMarketSnapshotIssue(snapshot, 10_000), "snapshot is stale");
  });

  withFixedNow("2026-06-28T23:59:58.999Z", () => {
    assert.equal(getMarketSnapshotIssue(snapshot, 5_000, 1_000), "snapshot timestamp is too far in the future");
  });
});

test("getMarketSnapshotIssue rejects invalid market snapshot shape", () => {
  const invalidSnapshots = [
    [{ ...snapshot, snapshotId: " " }, "snapshot id is missing"],
    [{ ...snapshot, midPrice: "0" }, "mid price is invalid"],
    [{ ...snapshot, midPrice: "1." }, "mid price is invalid"],
    [{ ...snapshot, liquidityUsd: "0" }, "liquidity is invalid"],
    [{ ...snapshot, volatilityBps: -1 }, "volatility is invalid"],
    [{ ...snapshot, observedAt: "not-a-date" }, "snapshot timestamp is invalid"],
  ];

  withFixedNow("2026-06-29T00:00:02.000Z", () => {
    for (const [invalidSnapshot, expectedIssue] of invalidSnapshots) {
      assert.equal(getMarketSnapshotIssue(invalidSnapshot, 5_000), expectedIssue);
    }
  });
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
