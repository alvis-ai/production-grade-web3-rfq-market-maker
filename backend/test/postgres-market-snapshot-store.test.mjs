import assert from "node:assert/strict";
import test from "node:test";
import { PostgresMarketSnapshotStore } from "../dist/modules/market-data/postgres-market-snapshot.repository.js";

const input = {
  request: {
    chainId: 1,
    user: "0x0000000000000000000000000000000000000001",
    tokenIn: "0x0000000000000000000000000000000000000002",
    tokenOut: "0x0000000000000000000000000000000000000003",
    amountIn: "1000",
    slippageBps: 50,
  },
  snapshot: {
    snapshotId: "snapshot_immutable",
    midPrice: "1",
    liquidityUsd: "1000000",
    marketSpreadBps: 0,
    volatilityBps: 25,
    observedAt: "2026-07-11T00:00:00.000Z",
  },
  source: "test-source",
};

test("PostgresMarketSnapshotStore inserts immutable snapshots", async () => {
  const { pool, queries } = fakePool(async (sql) => {
    assert.match(sql, /ON CONFLICT \(id\) DO NOTHING/);
    assert.doesNotMatch(sql, /DO UPDATE/);
    return { rows: [snapshotRow()], rowCount: 1 };
  });
  const store = new PostgresMarketSnapshotStore(pool);

  const record = await store.saveSnapshot(input);

  assert.equal(record.snapshotId, input.snapshot.snapshotId);
  assert.equal(record.midPrice, "1.000000000000000000");
  assert.equal(queries.length, 1);
});

test("PostgresMarketSnapshotStore accepts exact retries without rewriting rows", async () => {
  let call = 0;
  const { pool } = fakePool(async () => {
    call += 1;
    return call === 1
      ? { rows: [], rowCount: 0 }
      : { rows: [snapshotRow()], rowCount: 1 };
  });

  const record = await new PostgresMarketSnapshotStore(pool).saveSnapshot(input);

  assert.equal(call, 2);
  assert.equal(record.source, input.source);
});

test("PostgresMarketSnapshotStore rejects attempts to mutate an existing snapshot id", async () => {
  let call = 0;
  const { pool } = fakePool(async () => {
    call += 1;
    return call === 1
      ? { rows: [], rowCount: 0 }
      : { rows: [snapshotRow({ mid_price: "2.000000000000000000" })], rowCount: 1 };
  });

  await assert.rejects(
    new PostgresMarketSnapshotStore(pool).saveSnapshot(input),
    /market snapshot conflict/,
  );
});

test("PostgresMarketSnapshotStore validates snapshots before opening a database connection", async () => {
  const { pool, queries } = fakePool(async () => {
    throw new Error("database must not be queried");
  });
  const store = new PostgresMarketSnapshotStore(pool);

  await assert.rejects(
    store.saveSnapshot({
      ...input,
      snapshot: { ...input.snapshot, midPrice: "1.0000000000000000001" },
    }),
    /midPrice must be a positive decimal/,
  );
  await assert.rejects(
    store.findBySnapshotId("../unsafe"),
    /only letters, numbers, underscore, colon, or hyphen/,
  );
  assert.equal(queries.length, 0);
});

test("PostgresMarketSnapshotStore reads the latest snapshot across pair directions", async () => {
  const { pool, queries } = fakePool(async (sql, params) => {
    assert.match(sql, /ORDER BY observed_at DESC, id DESC/);
    assert.match(sql, /lower\(token_in\)/);
    assert.deepEqual(params, [1, input.request.tokenIn, input.request.tokenOut]);
    return { rows: [snapshotRow()], rowCount: 1 };
  });

  const latest = await new PostgresMarketSnapshotStore(pool).findLatestForPair(
    1,
    input.request.tokenIn,
    input.request.tokenOut,
  );
  assert.equal(latest.snapshotId, input.snapshot.snapshotId);
  assert.equal(queries.length, 1);
});

function snapshotRow(overrides = {}) {
  return {
    id: input.snapshot.snapshotId,
    chain_id: "1",
    token_in: input.request.tokenIn,
    token_out: input.request.tokenOut,
    mid_price: "1.000000000000000000",
    liquidity_usd: input.snapshot.liquidityUsd,
    market_spread_bps: String(input.snapshot.marketSpreadBps),
    volatility_bps: String(input.snapshot.volatilityBps),
    source: input.source,
    observed_at: input.snapshot.observedAt,
    created_at: "2026-07-11T00:00:00.001Z",
    ...overrides,
  };
}

function fakePool(handler) {
  const queries = [];
  const client = {
    async query(sql, params = []) {
      const normalized = sql.trim();
      queries.push({ sql: normalized, params });
      return handler(normalized, params);
    },
    release() {},
  };
  return {
    queries,
    pool: {
      async connect() {
        return client;
      },
    },
  };
}
