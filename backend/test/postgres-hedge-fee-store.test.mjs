import assert from "node:assert/strict";
import test from "node:test";
import { PostgresHedgeFeeStore } from "../dist/modules/hedge/postgres-hedge-fee.store.js";

const hedgeOrderId = "h_11111111111111111111111111111111";
const feeJobRow = {
  id: hedgeOrderId,
  chain_id: "1",
  token_address: "0x0000000000000000000000000000000000000003",
  side: "buy",
  amount: "1250000000000000000",
  filled_amount: "1250000000000000000",
  executed_quote_quantity: "3125.500000000000000000",
  venue_symbol: "ETHUSDT",
  client_order_id: "rfq_11111111111111111111111111111111",
  venue_order_id: "100234",
  fee_attempt_count: 2,
  created_at: "2026-07-14T00:00:00.000Z",
};

test("PostgresHedgeFeeStore reports pending fee depth and oldest due time", async () => {
  const { pool, client } = fakePool(async (sql) => {
    if (sql.includes("COUNT(*)::text AS pending_count")) {
      return {
        rows: [{ pending_count: "3", oldest_due_at: new Date("2026-07-14T00:00:00.000Z") }],
        rowCount: 1,
      };
    }
    return { rows: [], rowCount: 0 };
  });

  assert.deepEqual(await new PostgresHedgeFeeStore(pool).stats(), {
    pendingCount: 3,
    oldestDueAt: "2026-07-14T00:00:00.000Z",
  });
  assert.match(client.queries[0].sql, /fee_reconciliation_status = 'pending'/);
  assert.equal(client.released, true);
});

test("PostgresHedgeFeeStore claims due fee work with an independent lease", async () => {
  const { pool, client } = fakePool(async (sql) => {
    if (sql.includes("UPDATE hedge_orders AS hedge")) return { rows: [feeJobRow], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  const store = new PostgresHedgeFeeStore(pool);

  const job = await store.claimNext("worker_1", 30000);

  assert.equal(job.hedgeOrderId, hedgeOrderId);
  assert.equal(job.filledAmount, "1250000000000000000");
  assert.equal(job.venueOrderId, "100234");
  assert.equal(job.attemptCount, 2);
  assert.match(client.queries[0].sql, /fee_reconciliation_status = 'pending'/);
  assert.match(client.queries[0].sql, /FOR UPDATE SKIP LOCKED/);
  assert.match(client.queries[0].sql, /fee_lease_expires_at IS NULL OR fee_lease_expires_at <= now\(\)/);
});

test("PostgresHedgeFeeStore idempotently persists fills and completes reconciliation atomically", async () => {
  const fills = tradeFills();
  const { pool, client } = fakePool(async (sql, params) => {
    if (sql.includes("SELECT venue, venue_symbol")) {
      return { rows: [{
        venue: "binance",
        venue_symbol: "ETHUSDT",
        venue_order_id: "100234",
        filled_amount: "1250000000000000000",
        executed_quote_quantity: "3125.500000000000000000",
      }], rowCount: 1 };
    }
    if (sql.includes("INSERT INTO hedge_execution_fills")) {
      return { rows: [{ venue_trade_id: "28457" }, { venue_trade_id: "28458" }], rowCount: params.length / 13 };
    }
    if (sql.includes("SUM(base_quantity)")) {
      return { rows: [{ fill_count: "2", base_quantity: "1.250000000000000000", quote_quantity: "3125.500000000000000000" }], rowCount: 1 };
    }
    if (sql.includes("SET venue_order_id = $3")) return { rows: [], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  const store = new PostgresHedgeFeeStore(pool);

  await store.completeReconciliation(
    hedgeOrderId,
    "worker_1",
    "1250000000000000000",
    "100234",
    "3125.5",
    fills,
  );

  assert.equal(client.queries[0].sql, "BEGIN");
  const fillInsert = client.queries.find(({ sql }) => sql.includes("INSERT INTO hedge_execution_fills"));
  assert.match(fillInsert.sql, /ON CONFLICT \(hedge_order_id, venue_trade_id\) DO UPDATE/);
  assert.equal(fillInsert.params[8], "0.0001");
  const completion = client.queries.find(({ sql }) => sql.includes("fee_reconciliation_status = 'complete'"));
  assert.deepEqual(completion.params, [
    hedgeOrderId,
    "worker_1",
    "100234",
    "3125.5",
    "1250000000000000000",
  ]);
  assert.equal(client.queries.at(-1).sql, "COMMIT");
});

test("PostgresHedgeFeeStore rejects incomplete or conflicting fill evidence", async () => {
  const fills = tradeFills();
  const { pool, client } = fakePool(async (sql, params) => {
    if (sql.includes("SELECT venue, venue_symbol")) {
      return { rows: [{
        venue: "binance",
        venue_symbol: "ETHUSDT",
        venue_order_id: "100234",
        filled_amount: "1250000000000000000",
        executed_quote_quantity: "3125.5",
      }], rowCount: 1 };
    }
    if (sql.includes("INSERT INTO hedge_execution_fills")) return { rows: [], rowCount: params.length / 13 - 1 };
    return { rows: [], rowCount: 0 };
  });
  const store = new PostgresHedgeFeeStore(pool);

  await assert.rejects(
    store.completeReconciliation(hedgeOrderId, "worker_1", "1250000000000000000", "100234", "3000", fills),
    /HEDGE_TRADE_FILLS_INCOMPLETE/,
  );
  assert.equal(client.queries.length, 0);

  await assert.rejects(
    store.completeReconciliation(hedgeOrderId, "worker_1", "1250000000000000000", "100234", "3125.5", fills),
    /fill conflict/,
  );
  assert.equal(client.queries.at(-1).sql, "ROLLBACK");
});

test("PostgresHedgeFeeStore releases only the owned pending fee lease", async () => {
  const { pool, client } = fakePool(async (sql) => ({ rows: [], rowCount: sql.startsWith("UPDATE") ? 1 : 0 }));
  const store = new PostgresHedgeFeeStore(pool);

  await store.releaseForRetry(hedgeOrderId, "worker_1", "HEDGE_TRADE_FILLS_INCOMPLETE", 7000);

  assert.match(client.queries[0].sql, /fee_next_attempt_at = now\(\) \+ \$4/);
  assert.match(client.queries[0].sql, /fee_lease_owner = NULL/);
  assert.deepEqual(client.queries[0].params, [hedgeOrderId, "worker_1", "HEDGE_TRADE_FILLS_INCOMPLETE", 7000]);
});

function tradeFills() {
  return [{
    venueTradeId: "28457",
    venueOrderId: "100234",
    price: "2500",
    quantity: "0.5",
    quoteQuantity: "1250",
    commissionQuantity: "0.0001",
    commissionAsset: "BNB",
    executedAt: "2026-07-14T00:00:01.000Z",
    isBuyer: true,
    isMaker: false,
  }, {
    venueTradeId: "28458",
    venueOrderId: "100234",
    price: "2500.666666666666666667",
    quantity: "0.75",
    quoteQuantity: "1875.5",
    commissionQuantity: "1.8755",
    commissionAsset: "USDT",
    executedAt: "2026-07-14T00:00:02.000Z",
    isBuyer: true,
    isMaker: false,
  }];
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
