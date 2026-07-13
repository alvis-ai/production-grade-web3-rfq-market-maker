import assert from "node:assert/strict";
import test from "node:test";
import { PostgresHedgeJobStore } from "../dist/modules/hedge/postgres-hedge-job.store.js";

const row = {
  id: "h_11111111111111111111111111111111",
  chain_id: "1",
  token_address: "0x0000000000000000000000000000000000000003",
  side: "buy",
  amount: "990",
  attempt_count: 2,
  submission_attempted: false,
  created_at: "2026-07-11T00:00:00.000Z",
};

test("PostgresHedgeJobStore claims one due job with transaction and SKIP LOCKED", async () => {
  const { pool, client } = fakePool(async (sql) => {
    if (sql.includes("FROM settlement_events AS settlement")) {
      return { rows: [{ id: "se_1_test_0", canonical: true }], rowCount: 1 };
    }
    if (sql.includes("UPDATE hedge_orders AS hedge")) return { rows: [row], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  const store = new PostgresHedgeJobStore(pool);

  const job = await store.claimNext("worker_1", 30000);
  assert.equal(job.attemptCount, 2);
  assert.equal(job.submissionAttempted, false);
  assert.equal(client.queries[0].sql, "BEGIN");
  assert.match(client.queries[1].sql, /FOR UPDATE SKIP LOCKED/);
  assert.match(client.queries[1].sql, /hedge\.lease_expires_at IS NULL OR hedge\.lease_expires_at <= now\(\)/);
  assert.match(client.queries[1].sql, /settlement\.canonical = TRUE/);
  assert.equal(client.queries[2].sql, "COMMIT");
  assert.equal(client.released, true);
});

test("PostgresHedgeJobStore persists route and lease-owned terminal or retry transitions", async () => {
  let currentFilledAmount = null;
  let currentQuoteQuantity = null;
  const { pool, client } = fakePool(async (sql, params) => {
    if (sql.includes("FROM settlement_events AS settlement")) {
      return { rows: [{ id: "se_1_test_0", canonical: true }], rowCount: 1 };
    }
    if (sql.includes("SELECT chain_id") && sql.includes("FOR UPDATE")) {
      return {
        rows: [{
          chain_id: "1",
          token_address: row.token_address,
          side: "buy",
          amount: "990",
          filled_amount: currentFilledAmount,
          executed_quote_quantity: currentQuoteQuantity,
          external_order_id: null,
          venue_order_id: null,
        }],
        rowCount: 1,
      };
    }
    if (sql.includes("external_order_id = $3, venue_order_id = $4")) {
      currentFilledAmount = params[4];
      currentQuoteQuantity = params[5];
    }
    return { rows: [], rowCount: 1 };
  });
  const store = new PostgresHedgeJobStore(pool);
  const route = { venue: "binance", symbol: "ETHUSDT", clientOrderId: "rfq_11111111111111111111111111111111" };

  await store.prepareRoute(row.id, "worker_1", route);
  await store.authorizeSubmission(row.id, "worker_1");
  await store.recordExternalOrderObserved(row.id, "worker_1");
  await store.recordExecutionProgress(row.id, "worker_1", route.clientOrderId, "100234", "400", "1000.25");
  await store.releaseForRetry(row.id, "worker_1", "BINANCE_REQUEST_FAILED", 1000);
  await store.completeFilled(row.id, "worker_1", route.clientOrderId, "100234", "900", "2251.5");

  assert.match(client.queries[0].sql, /client_order_id = \$5/);
  assert.match(client.queries[0].sql, /venue = 'internal'/);
  assert.match(client.queries[0].sql, /venue = \$3 AND venue_symbol = \$4 AND client_order_id = \$5/);
  assert.equal(client.queries.some(({ sql }) => sql.includes("submission_attempted_at = COALESCE")), true);
  assert.match(client.queries.find(({ sql }) => sql.includes("last_error_code = $3") &&
    sql.includes("next_attempt_at = now()")).sql, /lease_owner = NULL/);
  assert.match(client.queries.find(({ sql }) => sql.includes("SET status = $3")).sql, /filled_amount = COALESCE\(\$6/);
  assert.match(client.queries.find(({ sql }) => sql.includes("SET status = $3")).sql, /executed_quote_quantity/);
  assert.equal(client.queries.some(({ sql }) => sql.includes("INSERT INTO inventory_positions")), true);
  assert.deepEqual(
    client.queries.filter(({ sql }) => sql.includes("INSERT INTO inventory_positions")).map(({ params }) => params[3]),
    ["400", "500"],
  );
  assert.equal(client.queries.filter(({ sql }) => sql === "COMMIT").length, 3);
});

test("PostgresHedgeJobStore persists terminal partial failure economics atomically", async () => {
  const externalOrderId = "rfq_11111111111111111111111111111111";
  const { pool, client } = fakePool(async (sql) => {
    if (sql.includes("FROM settlement_events AS settlement")) {
      return { rows: [{ canonical: true }], rowCount: 1 };
    }
    if (sql.includes("SELECT chain_id") && sql.includes("FOR UPDATE")) {
      return { rows: [{
        chain_id: "1",
        token_address: row.token_address,
        side: "buy",
        amount: "990",
        filled_amount: null,
        executed_quote_quantity: null,
        external_order_id: null,
        venue_order_id: null,
      }], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  });
  const store = new PostgresHedgeJobStore(pool);

  await store.completeFailed(
    row.id,
    "worker_1",
    "BINANCE_ORDER_EXPIRED",
    externalOrderId,
    "100234",
    "400",
    "1000.25",
  );

  const terminalUpdate = client.queries.find(({ sql }) => sql.includes("SET status = $3"));
  assert.equal(terminalUpdate.params[2], "failed");
  assert.equal(terminalUpdate.params[7], "1000.25");
  assert.equal(client.queries.find(({ sql }) => sql.includes("INSERT INTO inventory_positions")).params[3], "400");
  assert.equal(client.queries.at(-1).sql, "COMMIT");
});

test("PostgresHedgeJobStore rejects stale lease mutation and rolls back failed claims", async () => {
  let failClaim = true;
  const { pool, client } = fakePool(async (sql) => {
    if (sql.includes("UPDATE hedge_orders AS hedge") && failClaim) throw new Error("database unavailable");
    if (sql.includes("FROM settlement_events AS settlement")) {
      return { rows: [{ id: "se_1_test_0", canonical: true }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
  const store = new PostgresHedgeJobStore(pool);
  await assert.rejects(store.claimNext("worker_1", 30000), /database unavailable/);
  assert.equal(client.queries.at(-1).sql, "ROLLBACK");

  failClaim = false;
  await assert.rejects(
    store.completeFailed(row.id, "worker_1", "BINANCE_ORDER_REJECTED"),
    /lease conflict/,
  );
});

test("PostgresHedgeJobStore preserves external hedge fills after settlement reorg", async () => {
  const { pool, client } = fakePool(async (sql) => {
    if (sql.includes("FROM settlement_events AS settlement")) {
      return { rows: [{ id: "se_1_test_0", canonical: false }], rowCount: 1 };
    }
    if (sql.includes("SELECT chain_id") && sql.includes("FOR UPDATE")) {
      return {
        rows: [{
          chain_id: "1",
          token_address: row.token_address,
          side: "buy",
          amount: "990",
          filled_amount: null,
          executed_quote_quantity: null,
          external_order_id: null,
          venue_order_id: null,
        }],
        rowCount: 1,
      };
    }
    return { rows: [], rowCount: 1 };
  });
  const store = new PostgresHedgeJobStore(pool);

  await store.completeFilled(
    row.id,
    "worker_1",
    "rfq_11111111111111111111111111111111",
    "100234",
    "900",
    "2250",
  );
  assert.equal(client.queries.some(({ sql }) => sql.includes("INSERT INTO inventory_positions")), true);
  assert.equal(client.queries.at(-1).sql, "COMMIT");
});

test("PostgresHedgeJobStore rejects regressing or unpaired cumulative quote evidence", async () => {
  const { pool } = fakePool(async (sql) => {
    if (sql.includes("FROM settlement_events AS settlement")) {
      return { rows: [{ canonical: true }], rowCount: 1 };
    }
    if (sql.includes("SELECT chain_id") && sql.includes("FOR UPDATE")) {
      return { rows: [{
        chain_id: "1",
        token_address: row.token_address,
        side: "buy",
        amount: "990",
        filled_amount: "400",
        executed_quote_quantity: "1000.250000000000000000",
        external_order_id: "rfq_11111111111111111111111111111111",
        venue_order_id: "100234",
      }], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  });
  const store = new PostgresHedgeJobStore(pool);
  await assert.rejects(
    store.recordExecutionProgress(
      row.id,
      "worker_1",
      "rfq_11111111111111111111111111111111",
      "100234",
      "500",
      "999",
    ),
    /cumulative execution evidence is inconsistent/,
  );
  await assert.rejects(
    store.completeFailed(
      row.id,
      "worker_1",
      "BINANCE_ORDER_EXPIRED",
      "rfq_11111111111111111111111111111111",
      "100234",
      "500",
    ),
    /paired quote quantity evidence/,
  );
  await assert.rejects(
    store.completeFailed(
      row.id,
      "worker_1",
      "BINANCE_ORDER_EXPIRED",
      "rfq_22222222222222222222222222222222",
      "100234",
      "500",
      "1250",
    ),
    /external order conflict/,
  );
  await assert.rejects(
    store.completeFailed(
      row.id,
      "worker_1",
      "BINANCE_ORDER_EXPIRED",
      "rfq_11111111111111111111111111111111",
    ),
    /cumulative execution evidence disappeared/,
  );
});

test("PostgresHedgeJobStore blocks new submission authorization after settlement reorg", async () => {
  const { pool, client } = fakePool(async (sql) => {
    if (sql.includes("FROM settlement_events AS settlement")) {
      return { rows: [{ canonical: false }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
  const store = new PostgresHedgeJobStore(pool);
  await assert.rejects(store.authorizeSubmission(row.id, "worker_1"), /HEDGE_SETTLEMENT_NON_CANONICAL/);
  assert.equal(client.queries.some(({ sql }) => sql.includes("submission_attempted_at = COALESCE")), false);
  assert.equal(client.queries.at(-1).sql, "ROLLBACK");
});

test("PostgresHedgeJobStore validates worker, route, delay, and database rows", async () => {
  const { pool } = fakePool(async (sql) => {
    if (sql.includes("UPDATE hedge_orders AS hedge")) return { rows: [{ ...row, amount: "0990" }], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  });
  const store = new PostgresHedgeJobStore(pool);
  await assert.rejects(store.claimNext("bad/worker", 30000), /safe identifier/);
  await assert.rejects(store.claimNext("worker_1", 999), /leaseMs/);
  await assert.rejects(store.claimNext("worker_1", 30000), /canonical positive uint/);
  await assert.rejects(
    store.prepareRoute(row.id, "worker_1", { venue: "binance", symbol: "bad symbol", clientOrderId: "id" }),
    /symbol/,
  );
});

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
