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

test("InMemoryMarketSnapshotRepository rejects malformed snapshot payload envelopes before storing", async () => {
  const repository = new InMemoryMarketSnapshotRepository();

  await assert.rejects(
    repository.saveSnapshot(undefined),
    /Market snapshot input must be an object/,
  );

  await assert.rejects(
    repository.saveSnapshot({
      snapshot,
    }),
    /Market snapshot request must be an object/,
  );

  await assert.rejects(
    repository.saveSnapshot({
      request,
      snapshot: null,
    }),
    /Market snapshot snapshot must be an object/,
  );

  assert.equal(await repository.findBySnapshotId(snapshot.snapshotId), undefined);
});

test("InMemoryMarketSnapshotRepository rejects inherited snapshot payload fields before storing", async () => {
  const repository = new InMemoryMarketSnapshotRepository();

  await assert.rejects(
    repository.saveSnapshot(Object.create({ request, snapshot })),
    /Market snapshot input.request must be an own field/,
  );

  await assert.rejects(
    repository.saveSnapshot({
      request,
      snapshot: Object.create(snapshot),
    }),
    /Market snapshot snapshot.snapshotId must be an own field/,
  );

  const inheritedSourceInput = Object.create({ source: "inherited-source" });
  Object.assign(inheritedSourceInput, { request, snapshot });
  await assert.rejects(
    repository.saveSnapshot(inheritedSourceInput),
    /Market snapshot input.source must be an own field when provided/,
  );

  assert.equal(await repository.findBySnapshotId(snapshot.snapshotId), undefined);
});

test("InMemoryMarketSnapshotRepository rejects conflicts and unsafe snapshots", async () => {
  const repository = new InMemoryMarketSnapshotRepository();

  await assert.rejects(
    repository.saveSnapshot({
      request,
      snapshot: { ...snapshot, snapshotId: " " },
    }),
    /Market snapshot snapshotId must be a non-empty string/,
  );
  await assert.rejects(
    repository.saveSnapshot({
      request,
      snapshot: { ...snapshot, snapshotId: new String("snapshot_1") },
    }),
    /Market snapshot snapshotId must be a primitive string/,
  );
  await assert.rejects(
    repository.saveSnapshot({
      request,
      snapshot: { ...snapshot, snapshotId: "snapshot.bad" },
    }),
    /Market snapshot snapshotId must contain only letters, numbers, underscore, colon, or hyphen/,
  );
  await assert.rejects(
    repository.saveSnapshot({
      request,
      snapshot: { ...snapshot, snapshotId: "s".repeat(129) },
    }),
    /Market snapshot snapshotId must be 128 characters or fewer/,
  );

  await assert.rejects(
    repository.saveSnapshot({
      request,
      snapshot: { ...snapshot, midPrice: "0" },
    }),
    /Market snapshot midPrice must be a positive decimal/,
  );
  await assert.rejects(
    repository.saveSnapshot({
      request,
      snapshot: { ...snapshot, midPrice: "01.25" },
    }),
    /Market snapshot midPrice must be a positive decimal/,
  );

  await assert.rejects(
    repository.saveSnapshot({
      request,
      snapshot: { ...snapshot, liquidityUsd: "0" },
    }),
    /Market snapshot liquidityUsd must be a positive uint string/,
  );
  await assert.rejects(
    repository.saveSnapshot({
      request,
      snapshot: { ...snapshot, liquidityUsd: "01000000000000" },
    }),
    /Market snapshot liquidityUsd must be a positive uint string/,
  );

  await assert.rejects(
    repository.saveSnapshot({
      request,
      snapshot: { ...snapshot, volatilityBps: 10001 },
    }),
    /Market snapshot volatilityBps must be an integer from 0 to 10000/,
  );

  await assert.rejects(
    repository.saveSnapshot({
      request,
      snapshot: { ...snapshot, observedAt: "not-a-date" },
    }),
    /Market snapshot observedAt must be a canonical UTC ISO timestamp/,
  );
  await assert.rejects(
    repository.saveSnapshot({
      request,
      snapshot: { ...snapshot, observedAt: "2026-06-29" },
    }),
    /Market snapshot observedAt must be a canonical UTC ISO timestamp/,
  );
  await assert.rejects(
    repository.saveSnapshot({
      request,
      snapshot: { ...snapshot, observedAt: "2026-02-31T00:00:00.000Z" },
    }),
    /Market snapshot observedAt must be a canonical UTC ISO timestamp/,
  );

  await assert.rejects(
    repository.saveSnapshot({
      request,
      snapshot,
      source: " ",
    }),
    /Market snapshot source must be a non-empty string/,
  );

  await repository.saveSnapshot({ request, snapshot });

  await assert.rejects(
    repository.saveSnapshot({
      request,
      snapshot: { ...snapshot, midPrice: "1.26" },
    }),
    /Market snapshot conflict for snapshot_1/,
  );
});

test("InMemoryMarketSnapshotRepository returns defensive copies", async () => {
  const repository = new InMemoryMarketSnapshotRepository();
  const stored = await repository.saveSnapshot({ request, snapshot });

  stored.midPrice = "999";
  const reloaded = await repository.findBySnapshotId(snapshot.snapshotId);

  assert.notEqual(reloaded, stored);
  assert.equal(reloaded.midPrice, snapshot.midPrice);
});

test("InMemoryMarketSnapshotRepository rejects unsafe snapshot lookup identifiers", async () => {
  const repository = new InMemoryMarketSnapshotRepository();

  await assert.rejects(
    repository.findBySnapshotId(" "),
    /Market snapshot snapshotId must be a non-empty string/,
  );
  await assert.rejects(
    repository.findBySnapshotId(new String("snapshot_1")),
    /Market snapshot snapshotId must be a primitive string/,
  );
  await assert.rejects(
    repository.findBySnapshotId("snapshot/bad"),
    /Market snapshot snapshotId must contain only letters, numbers, underscore, colon, or hyphen/,
  );
  await assert.rejects(
    repository.findBySnapshotId("s".repeat(129)),
    /Market snapshot snapshotId must be 128 characters or fewer/,
  );

  const stored = await repository.saveSnapshot({ request, snapshot });
  assert.deepEqual(await repository.findBySnapshotId(snapshot.snapshotId), stored);
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
