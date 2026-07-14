import assert from "node:assert/strict";
import test from "node:test";
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

test("InMemoryMarketSnapshotRepository finds the newest snapshot in either pair direction", async () => {
  const repository = new InMemoryMarketSnapshotRepository();
  await repository.saveSnapshot({ request, snapshot });
  const reverseRequest = {
    ...request,
    tokenIn: request.tokenOut,
    tokenOut: request.tokenIn,
  };
  await repository.saveSnapshot({
    request: reverseRequest,
    snapshot: {
      ...snapshot,
      snapshotId: "snapshot_2_reverse",
      midPrice: "0.8",
      observedAt: "2026-06-29T00:00:01.000Z",
    },
  });

  const latest = await repository.findLatestForPair(1, request.tokenIn, request.tokenOut);
  assert.equal(latest.snapshotId, "snapshot_2_reverse");
  assert.equal(latest.tokenIn, request.tokenOut);
  await assert.rejects(
    repository.findLatestForPair(1, request.tokenIn, request.tokenIn),
    /tokens must be distinct/,
  );
});
