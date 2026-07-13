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
  marketSpreadBps: 0,
  volatilityBps: 25,
  observedAt: "2026-06-29T00:00:00.000Z",
};

test("StaticMarketDataService rejects unsafe static market data config", () => {
  const validPair = {
    chainId: 1,
    tokenIn: "0x0000000000000000000000000000000000000002",
    tokenOut: "0x0000000000000000000000000000000000000003",
  };

  assert.throws(
    () => new StaticMarketDataService(null),
    /Static market data config must be an object/,
  );

  assert.throws(
    () => new StaticMarketDataService([]),
    /Static market data config must be an object/,
  );

  assert.throws(
    () => new StaticMarketDataService(Object.create({ supportedPairs: [validPair] })),
    /Static market data config.supportedPairs must be an own field/,
  );

  assert.throws(
    () => new StaticMarketDataService({ supportedPairs: [] }),
    /Static market data supportedPairs must contain at least one pair/,
  );

  assert.throws(
    () => new StaticMarketDataService({ supportedPairs: undefined }),
    /Static market data supportedPairs must contain at least one pair/,
  );

  assert.throws(
    () =>
      new StaticMarketDataService({
        supportedPairs: [null],
      }),
    /Static market data supportedPairs entry must be an object/,
  );

  assert.throws(
    () =>
      new StaticMarketDataService({
        supportedPairs: [[]],
      }),
    /Static market data supportedPairs entry must be an object/,
  );

  assert.throws(
    () =>
      new StaticMarketDataService({
        supportedPairs: [Object.create(validPair)],
      }),
    /Static market data supportedPairs entry.chainId must be an own field/,
  );

  assert.throws(
    () =>
      new StaticMarketDataService({
        supportedPairs: [{ ...validPair, chainId: Number.MAX_SAFE_INTEGER + 1 }],
      }),
    /Static market data supportedPairs.chainId must be a positive safe integer/,
  );

  assert.throws(
    () =>
      new StaticMarketDataService({
        supportedPairs: [{ ...validPair, tokenIn: "0x1234" }],
      }),
    /Static market data supportedPairs.tokenIn must be a 20-byte hex address/,
  );

  assert.throws(
    () =>
      new StaticMarketDataService({
        supportedPairs: [{ ...validPair, tokenOut: validPair.tokenIn }],
      }),
    /Static market data supportedPairs must contain distinct tokens/,
  );

  assert.throws(
    () =>
      new StaticMarketDataService({
        supportedPairs: [validPair, { ...validPair }],
      }),
    /Static market data supportedPairs must not contain duplicate pairs/,
  );
});

test("StaticMarketDataService rejects unsafe snapshot requests before lookup", async () => {
  const service = new StaticMarketDataService();

  await assert.rejects(
    service.getSnapshot(undefined),
    /Static market data request must be an object/,
  );

  await assert.rejects(
    service.getSnapshot(Object.create(request)),
    /Static market data request.chainId must be an own field/,
  );

  await assert.rejects(
    service.getSnapshot({
      ...request,
      tokenOut: request.tokenIn,
    }),
    /Static market data request token pair must contain distinct tokens/,
  );

  await assert.rejects(
    service.getSnapshot({
      ...request,
      amountIn: "01000000000",
    }),
    /Static market data request.amountIn must be a positive uint string/,
  );

  await assert.rejects(
    service.getSnapshot({
      ...request,
      slippageBps: 10_001,
    }),
    /Static market data request.slippageBps must be less than or equal to 10000 bps/,
  );
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
    [undefined, "snapshot is invalid"],
    [null, "snapshot is invalid"],
    [[], "snapshot is invalid"],
    [Object.create(snapshot), "snapshot is invalid"],
    [{ ...snapshot, snapshotId: undefined }, "snapshot id is missing"],
    [withoutField(snapshot, "midPrice"), "snapshot is invalid"],
    [{ ...snapshot, snapshotId: " " }, "snapshot id is missing"],
    [{ ...snapshot, midPrice: "0" }, "mid price is invalid"],
    [{ ...snapshot, midPrice: "01.25" }, "mid price is invalid"],
    [{ ...snapshot, midPrice: "1." }, "mid price is invalid"],
    [{ ...snapshot, liquidityUsd: "0" }, "liquidity is invalid"],
    [{ ...snapshot, liquidityUsd: "01000000000000" }, "liquidity is invalid"],
    [{ ...snapshot, volatilityBps: -1 }, "volatility is invalid"],
    [{ ...snapshot, volatilityBps: 10001 }, "volatility is invalid"],
    [{ ...snapshot, observedAt: "not-a-date" }, "snapshot timestamp is invalid"],
    [{ ...snapshot, observedAt: "2026-06-29" }, "snapshot timestamp is invalid"],
    [{ ...snapshot, observedAt: "June 29, 2026" }, "snapshot timestamp is invalid"],
    [{ ...snapshot, observedAt: "2026-02-31T00:00:00.000Z" }, "snapshot timestamp is invalid"],
  ];

  withFixedNow("2026-06-29T00:00:02.000Z", () => {
    for (const [invalidSnapshot, expectedIssue] of invalidSnapshots) {
      assert.equal(getMarketSnapshotIssue(invalidSnapshot, 5_000), expectedIssue);
    }
  });
});

test("getMarketSnapshotIssue rejects unsafe freshness windows", () => {
  assert.equal(getMarketSnapshotIssue(snapshot, -1), "snapshot freshness window is invalid");
  assert.equal(getMarketSnapshotIssue(snapshot, 1.5), "snapshot freshness window is invalid");
  assert.equal(getMarketSnapshotIssue(snapshot, 5_000, -1), "snapshot future skew window is invalid");
  assert.equal(getMarketSnapshotIssue(snapshot, 5_000, Number.MAX_SAFE_INTEGER + 1), "snapshot future skew window is invalid");
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

function withoutField(source, field) {
  const copy = { ...source };
  delete copy[field];
  return copy;
}
