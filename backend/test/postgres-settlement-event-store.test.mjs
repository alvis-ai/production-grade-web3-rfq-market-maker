import assert from "node:assert/strict";
import test from "node:test";
import { PostgresInventoryService } from "../dist/modules/inventory/postgres-inventory.service.js";
import { PostgresSettlementEventStore } from "../dist/modules/settlement/postgres-settlement-event.store.js";
import { hashSettlementQuote } from "../dist/modules/settlement/settlement-event.service.js";

const quote = {
  user: "0x0000000000000000000000000000000000000001",
  tokenIn: "0x0000000000000000000000000000000000000002",
  tokenOut: "0x0000000000000000000000000000000000000003",
  amountIn: "1000",
  amountOut: "990",
  minAmountOut: "980",
  nonce: "1",
  deadline: 4_102_444_800,
  chainId: 1,
};
const txHash = `0x${"31".repeat(32)}`;

test("PostgresSettlementEventStore commits event and inventory deltas atomically", async () => {
  let candidateRow;
  const { pool, client } = fakePool(async (sql, params) => {
    if (sql.includes("INSERT INTO settlement_events")) {
      candidateRow = settlementRowFromParams(params);
      return { rows: [candidateRow], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  });
  const inventory = new PostgresInventoryService(pool);
  const store = new PostgresSettlementEventStore(pool, inventory);

  const result = await store.applySettlementEvent(settlementInput());

  assert.equal(result.duplicate, false);
  assert.equal(result.event.txHash, txHash);
  assert.deepEqual(client.queries.map(({ sql }) => transactionLabel(sql)), [
    "BEGIN",
    "INSERT_SETTLEMENT",
    "UPSERT_INVENTORY",
    "UPSERT_INVENTORY",
    "COMMIT",
  ]);
  assert.equal(client.released, true);
});

test("PostgresSettlementEventStore treats matching chain events as idempotent", async () => {
  const existing = settlementRow();
  const { pool, client } = fakePool(async (sql) => {
    if (sql.includes("INSERT INTO settlement_events")) return { rows: [], rowCount: 0 };
    if (sql.includes("FROM settlement_events") && sql.includes("FOR UPDATE")) {
      return { rows: [existing], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  });
  const store = new PostgresSettlementEventStore(pool, new PostgresInventoryService(pool));

  const result = await store.applySettlementEvent(settlementInput());

  assert.equal(result.duplicate, true);
  assert.equal(client.queries.filter(({ sql }) => sql.includes("inventory_positions")).length, 0);
  assert.equal(client.queries.at(-1).sql, "COMMIT");
});

test("PostgresSettlementEventStore reactivates exact non-canonical events", async () => {
  const removed = settlementRow({ canonical: false });
  const { pool, client } = fakePool(async (sql) => {
    if (sql.includes("INSERT INTO settlement_events")) return { rows: [], rowCount: 0 };
    if (sql.includes("FROM settlement_events") && sql.includes("FOR UPDATE")) {
      return { rows: [removed], rowCount: 1 };
    }
    if (sql.includes("SET canonical = TRUE")) return { rows: [settlementRow()], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  });
  const store = new PostgresSettlementEventStore(pool, new PostgresInventoryService(pool));

  const result = await store.applySettlementEvent(settlementInput());

  assert.equal(result.duplicate, false);
  assert.equal(client.queries.some(({ sql }) => sql.includes("SET canonical = TRUE")), true);
  assert.equal(client.queries.some(({ sql }) => sql.includes("LOCK TABLE inventory_positions")), true);
  assert.equal(client.queries.some(({ sql }) => sql.includes("FROM hedge_orders AS hedge")), true);
});

test("PostgresSettlementEventStore rolls back conflicting duplicate payloads", async () => {
  const { pool, client } = fakePool(async (sql) => {
    if (sql.includes("INSERT INTO settlement_events")) return { rows: [], rowCount: 0 };
    if (sql.includes("FROM settlement_events") && sql.includes("FOR UPDATE")) {
      return { rows: [settlementRow({ amount_out: "991" })], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  });
  const store = new PostgresSettlementEventStore(pool, new PostgresInventoryService(pool));

  await assert.rejects(store.applySettlementEvent(settlementInput()), /event conflict/);
  assert.equal(client.queries.at(-1).sql, "ROLLBACK");
});

test("PostgresSettlementEventStore marks reorgs non-canonical and rebuilds inventory in the transaction", async () => {
  const { pool, client } = fakePool(async (sql) => {
    if (sql.includes("FROM settlement_events") && sql.includes("canonical = TRUE") && sql.includes("FOR UPDATE")) {
      return { rows: [settlementRow()], rowCount: 1 };
    }
    if (sql.includes("SET canonical = FALSE")) return { rows: [], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  });
  const store = new PostgresSettlementEventStore(pool, new PostgresInventoryService(pool));

  const removed = await store.removeSettlementEvent({
    chainId: 1,
    txHash,
    blockNumber: 100,
    logIndex: 2,
  });

  assert.equal(removed.removed, true);
  assert.deepEqual(client.queries.map(({ sql }) => transactionLabel(sql)), [
    "BEGIN",
    "SELECT_SETTLEMENT_FOR_UPDATE",
    "MARK_NON_CANONICAL",
    "LOCK_INVENTORY",
    "DELETE_INVENTORY",
    "REBUILD_INVENTORY",
    "COMMIT",
  ]);
});

test("PostgresSettlementEventStore startup repair serializes and rebuilds canonical inventory", async () => {
  const { pool, client } = fakePool(async () => ({ rows: [], rowCount: 1 }));
  const store = new PostgresSettlementEventStore(pool, new PostgresInventoryService(pool));

  await store.initialize();

  assert.deepEqual(client.queries.map(({ sql }) => transactionLabel(sql)), [
    "BEGIN",
    "ADVISORY_LOCK",
    "LOCK_SETTLEMENTS",
    "LOCK_INVENTORY",
    "DELETE_INVENTORY",
    "REBUILD_INVENTORY",
    "COMMIT",
  ]);
});

test("PostgresSettlementEventStore filters non-canonical rows from status and reconciliation reads", async () => {
  const { pool, client } = fakePool(async (sql) => {
    assert.match(sql, /canonical = TRUE/);
    return { rows: [settlementRow()], rowCount: 1 };
  });
  const store = new PostgresSettlementEventStore(pool, new PostgresInventoryService(pool));

  assert.equal((await store.getSettlementEvent(settlementRow().id)).txHash, txHash);
  assert.equal((await store.getSettlementEventsByQuoteHash({ chainId: 1, quoteHash: settlementRow().quote_hash })).length, 1);
  assert.equal((await store.listSettlementEvents()).length, 1);
  assert.equal(client.queries.every(({ sql }) => sql.includes("canonical = TRUE")), true);
});

function settlementInput() {
  return { quoteId: "q_postgres_settlement", quote, txHash, blockNumber: 100, logIndex: 2 };
}

function settlementRow(overrides = {}) {
  return {
    id: `se_1_${txHash.slice(2)}_2`,
    quote_id: "q_postgres_settlement",
    chain_id: "1",
    tx_hash: txHash,
    quote_hash: hashSettlementQuote(quote),
    log_index: "2",
    block_number: "100",
    user_address: quote.user,
    token_in: quote.tokenIn,
    token_out: quote.tokenOut,
    amount_in: quote.amountIn,
    amount_out: quote.amountOut,
    nonce: quote.nonce,
    created_at: "2026-07-11T00:00:00.000Z",
    canonical: true,
    ...overrides,
  };
}

function settlementRowFromParams(params) {
  return settlementRow({
    id: params[0],
    quote_id: params[1],
    chain_id: String(params[2]),
    tx_hash: params[3],
    quote_hash: params[4],
    log_index: String(params[5]),
    block_number: String(params[6]),
    user_address: params[7],
    token_in: params[8],
    token_out: params[9],
    amount_in: params[10],
    amount_out: params[11],
    nonce: params[12],
  });
}

function transactionLabel(sql) {
  if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return sql;
  if (sql.includes("pg_advisory_xact_lock")) return "ADVISORY_LOCK";
  if (sql.includes("LOCK TABLE settlement_events")) return "LOCK_SETTLEMENTS";
  if (sql.includes("INSERT INTO settlement_events")) return "INSERT_SETTLEMENT";
  if (sql.includes("SET canonical = FALSE")) return "MARK_NON_CANONICAL";
  if (sql.includes("FROM settlement_events") && sql.includes("FOR UPDATE")) return "SELECT_SETTLEMENT_FOR_UPDATE";
  if (sql === "LOCK TABLE inventory_positions IN EXCLUSIVE MODE") return "LOCK_INVENTORY";
  if (sql === "DELETE FROM inventory_positions") return "DELETE_INVENTORY";
  if (sql.includes("SUM(delta)")) return "REBUILD_INVENTORY";
  if (sql.includes("INSERT INTO inventory_positions")) return "UPSERT_INVENTORY";
  return sql;
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
    release() {
      this.released = true;
    },
  };
  return {
    client,
    pool: {
      async connect() {
        return client;
      },
    },
  };
}
