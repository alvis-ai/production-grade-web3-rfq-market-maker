import assert from "node:assert/strict";
import test from "node:test";
import { PostgresPostTradeReconciliationStore } from "../dist/modules/reconciliation/postgres-post-trade-reconciliation.store.js";

const quoteId = "q_reconciliation_store";
const settlementEventId = `se_1_${"11".repeat(32)}_2`;

test("PostgresPostTradeReconciliationStore claims due revisions with an expiring lease", async () => {
  const { pool, client } = fakePool(async (sql) => {
    if (sql.includes("UPDATE post_trade_reconciliation_jobs AS job")) {
      return { rows: [jobRow()], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
  const store = new PostgresPostTradeReconciliationStore(pool);

  const job = await store.claimNext("reconciliation_worker_1", 30_000);

  assert.deepEqual(job, {
    quoteId,
    desiredSettlementEventId: settlementEventId,
    revision: 3,
    attemptCount: 1,
    requestedAt: "2026-07-11T00:00:00.000Z",
  });
  const claim = client.queries.find(({ sql }) => sql.includes("FOR UPDATE SKIP LOCKED"));
  assert.ok(claim);
  assert.deepEqual(claim.params, ["reconciliation_worker_1", 30_000]);
  assert.equal(client.queries.at(-1).sql, "COMMIT");
  assert.equal(client.released, true);
});

test("PostgresPostTradeReconciliationStore returns canonical and historical settlement rows", async () => {
  const rows = [settlementRow({ canonical: false }), settlementRow({
    id: `se_1_${"22".repeat(32)}_3`,
    tx_hash: `0x${"22".repeat(32)}`,
    block_number: "101",
    log_index: "3",
    canonical: true,
  })];
  const { pool } = fakePool(async (sql) => {
    if (sql.includes("FROM settlement_events AS settlement")) return { rows, rowCount: rows.length };
    return { rows: [], rowCount: 0 };
  });
  const store = new PostgresPostTradeReconciliationStore(pool);

  const events = await store.listSettlementEvents(quoteId);

  assert.equal(events.length, 2);
  assert.equal(events[0].canonical, false);
  assert.equal(events[1].canonical, true);
  assert.equal(events[1].event.blockNumber, 101);
  assert.equal(events[1].event.txHash, `0x${"22".repeat(32)}`);
  assert.equal(events[1].event.observedAt, "2026-07-10T23:59:00.000Z");
});

test("PostgresPostTradeReconciliationStore completes only the claimed desired revision", async () => {
  let completed = true;
  const { pool, client } = fakePool(async (sql) => {
    if (sql.includes("RETURNING desired_revision = $3 AS completed")) {
      return { rows: [{ completed }], rowCount: 1 };
    }
    if (sql.includes("RETURNING desired_revision = $3 AS retry_scheduled")) {
      return { rows: [{ retry_scheduled: false }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
  const store = new PostgresPostTradeReconciliationStore(pool);
  const job = parsedJob();

  assert.equal(await store.markProcessed(job, "reconciliation_worker_1"), true);
  completed = false;
  assert.equal(await store.markProcessed(job, "reconciliation_worker_1"), false);
  assert.equal(await store.releaseForRetry(
    job,
    "reconciliation_worker_1",
    "RECONCILIATION_PNL_FAILED",
    1_000,
  ), false);
  assert.equal(client.queries.some(({ sql }) => sql.includes("processed_revision = CASE")), true);
  assert.equal(client.queries.some(({ sql }) => sql.includes("ELSE now()")), true);
});

test("PostgresPostTradeReconciliationStore reports durable pending backlog", async () => {
  const { pool } = fakePool(async (sql) => {
    if (sql.includes("COUNT(*)::text AS pending_count")) {
      return {
        rows: [{ pending_count: "4", oldest_requested_at: new Date("2026-07-11T00:00:00.000Z") }],
        rowCount: 1,
      };
    }
    return { rows: [], rowCount: 0 };
  });
  const stats = await new PostgresPostTradeReconciliationStore(pool).stats();
  assert.deepEqual(stats, {
    pendingCount: 4,
    oldestPendingRequestedAt: "2026-07-11T00:00:00.000Z",
  });
});

function parsedJob() {
  return {
    quoteId,
    desiredSettlementEventId: settlementEventId,
    revision: 3,
    attemptCount: 1,
    requestedAt: "2026-07-11T00:00:00.000Z",
  };
}

function jobRow(overrides = {}) {
  return {
    quote_id: quoteId,
    desired_settlement_event_id: settlementEventId,
    desired_revision: "3",
    attempt_count: "1",
    requested_at: "2026-07-11T00:00:00.000Z",
    ...overrides,
  };
}

function settlementRow(overrides = {}) {
  return {
    id: settlementEventId,
    quote_id: quoteId,
    chain_id: "1",
    tx_hash: `0x${"11".repeat(32)}`,
    quote_hash: `0x${"33".repeat(32)}`,
    log_index: "2",
    block_number: "100",
    user_address: "0x0000000000000000000000000000000000000001",
    token_in: "0x0000000000000000000000000000000000000002",
    token_out: "0x0000000000000000000000000000000000000003",
    amount_in: "1000",
    amount_out: "990",
    nonce: "1",
    settled_at: "2026-07-10T23:59:00.000Z",
    created_at: "2026-07-11T00:00:00.000Z",
    canonical: true,
    ...overrides,
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
