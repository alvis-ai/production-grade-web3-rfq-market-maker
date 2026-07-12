import assert from "node:assert/strict";
import test from "node:test";
import { PostgresSettlementIndexerStore } from "../dist/modules/indexer/postgres-settlement-indexer.store.js";

test("PostgresSettlementIndexerStore claims an immutable cursor under a renewable lease", async () => {
  const row = cursorRow();
  const { pool, client } = fakePool(async (sql) => {
    if (sql.includes("SELECT") && sql.includes("FOR UPDATE")) return { rows: [{ ...row, lease_owner: null, lease_expires_at: null }] };
    if (sql.startsWith("UPDATE settlement_indexer_cursors") && sql.includes("lease_owner = $2")) return { rows: [row] };
    return { rows: [], rowCount: 1 };
  });
  const store = new PostgresSettlementIndexerStore(pool);

  const cursor = await store.claimCursor(claimInput());

  assert.equal(cursor.nextBlock, 100);
  assert.equal(cursor.leaseOwner, "indexer_store_1");
  assert.deepEqual(
    client.queries.filter(({ sql }) => sql === "BEGIN" || sql === "COMMIT").map(({ sql }) => sql),
    ["BEGIN", "COMMIT"],
  );
  assert.equal(client.released, true);
});

test("PostgresSettlementIndexerStore advances checkpoint and cursor in one CAS transaction", async () => {
  const { pool, client } = fakePool(async (sql) => {
    if (sql.startsWith("INSERT INTO settlement_indexer_checkpoints")) return { rows: [{ block_hash: hash(104) }] };
    if (sql.startsWith("UPDATE settlement_indexer_cursors")) {
      return { rows: [{ ...cursorRow(), next_block: "105", revision: "1" }] };
    }
    return { rows: [], rowCount: 1 };
  });
  const store = new PostgresSettlementIndexerStore(pool);

  const cursor = await store.advanceCursor({
    chainId: 1,
    workerId: "indexer_store_1",
    leaseMs: 30_000,
    expectedRevision: 0,
    expectedNextBlock: 100,
    nextBlock: 105,
    checkpoint: { chainId: 1, blockNumber: 104, blockHash: hash(104) },
  });

  assert.equal(cursor.nextBlock, 105);
  assert.equal(cursor.revision, 1);
  assert.equal(client.queries.some(({ sql }) => sql.includes("lease_expires_at > now()")), true);
  assert.equal(client.queries.some(({ sql }) => sql.includes("revision = $4") && sql.includes("next_block = $5")), true);
});

test("PostgresSettlementIndexerStore rolls back checkpoints and lists orphan refs in reverse chain order", async () => {
  const { pool, client } = fakePool(async (sql) => {
    if (sql.startsWith("UPDATE settlement_indexer_cursors")) {
      return { rows: [{ ...cursorRow(), next_block: "95", revision: "2" }] };
    }
    if (sql.startsWith("SELECT chain_id, tx_hash")) {
      return { rows: [
        { chain_id: "1", tx_hash: hash(2), block_number: "99", log_index: "2" },
        { chain_id: "1", tx_hash: hash(1), block_number: "98", log_index: "1" },
      ] };
    }
    return { rows: [], rowCount: 1 };
  });
  const store = new PostgresSettlementIndexerStore(pool);

  const refs = await store.listCanonicalEventRefs(1, 95, 99);
  const cursor = await store.rollbackCursor({
    chainId: 1,
    workerId: "indexer_store_1",
    leaseMs: 30_000,
    expectedRevision: 1,
    expectedNextBlock: 100,
    nextBlock: 95,
  });

  assert.deepEqual(refs.map(({ blockNumber }) => blockNumber), [99, 98]);
  assert.equal(cursor.nextBlock, 95);
  assert.equal(client.queries.some(({ sql }) => sql.startsWith("DELETE FROM settlement_indexer_checkpoints")), true);
});

test("PostgresSettlementIndexerStore fails closed when cursor CAS loses the lease", async () => {
  const { pool } = fakePool(async (sql) => {
    if (sql.startsWith("INSERT INTO settlement_indexer_checkpoints")) return { rows: [{ block_hash: hash(104) }] };
    if (sql.startsWith("UPDATE settlement_indexer_cursors")) return { rows: [] };
    return { rows: [], rowCount: 1 };
  });
  const store = new PostgresSettlementIndexerStore(pool);
  await assert.rejects(
    store.advanceCursor({
      chainId: 1,
      workerId: "indexer_store_1",
      leaseMs: 30_000,
      expectedRevision: 0,
      expectedNextBlock: 100,
      nextBlock: 105,
      checkpoint: { chainId: 1, blockNumber: 104, blockHash: hash(104) },
    }),
    (error) => error.code === "SETTLEMENT_INDEXER_LEASE_LOST",
  );
});

function claimInput() {
  return {
    chainId: 1,
    settlementAddress: "0x0000000000000000000000000000000000000004",
    startBlock: 100,
    workerId: "indexer_store_1",
    leaseMs: 30_000,
  };
}

function cursorRow() {
  return {
    chain_id: "1",
    settlement_address: "0x0000000000000000000000000000000000000004",
    start_block: "100",
    next_block: "100",
    revision: "0",
    lease_owner: "indexer_store_1",
    lease_expires_at: "2026-07-12T00:01:00.000Z",
    updated_at: "2026-07-12T00:00:00.000Z",
  };
}

function fakePool(handler) {
  const client = {
    queries: [],
    released: false,
    async query(sql, params = []) {
      const normalized = sql.trim();
      this.queries.push({ sql: normalized, params });
      return handler(normalized, params);
    },
    release() { this.released = true; },
  };
  return { pool: { async connect() { return client; } }, client };
}

function hash(value) {
  return `0x${BigInt(value).toString(16).padStart(64, "0")}`;
}
