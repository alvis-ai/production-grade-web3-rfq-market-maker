import assert from "node:assert/strict";
import test from "node:test";
import { migrate, migrateUpTo } from "../dist/db/migrate.js";

test("database migration runner holds one session advisory lock across discovery", async () => {
  const { pool, client } = fakePool(async (sql) => {
    if (sql.includes("SELECT version, name")) {
      return { rows: [
        { version: "001", name: "base-schema", applied_at: "2026-07-11T00:00:00.000Z" },
        { version: "002", name: "settlement-canonical", applied_at: "2026-07-11T00:00:00.000Z" },
        { version: "003", name: "hedge-worker-queue", applied_at: "2026-07-11T00:00:00.000Z" },
        { version: "004", name: "analytics-outbox", applied_at: "2026-07-11T00:00:00.000Z" },
        { version: "005", name: "post-trade-reconciliation", applied_at: "2026-07-11T00:00:00.000Z" },
        { version: "006", name: "quote-snapshot-pnl", applied_at: "2026-07-11T00:00:00.000Z" },
        { version: "007", name: "settlement-indexer", applied_at: "2026-07-12T00:00:00.000Z" },
        { version: "008", name: "submit-reservations", applied_at: "2026-07-13T00:00:00.000Z" },
        { version: "009", name: "risk-notional-reasons", applied_at: "2026-07-14T00:00:00.000Z" },
        { version: "010", name: "risk-market-regime-reasons", applied_at: "2026-07-14T00:01:00.000Z" },
        { version: "011", name: "open-quote-exposure", applied_at: "2026-07-14T00:02:00.000Z" },
      ] };
    }
    return { rows: [] };
  });

  await migrate(pool);

  assert.match(client.queries[0].sql, /pg_advisory_lock/);
  assert.match(client.queries.at(-1).sql, /pg_advisory_unlock/);
  assert.equal(client.released, true);
  assert.equal(client.queries.filter(({ sql }) => sql === "BEGIN").length, 0);
});

test("database migration runner applies hedge queue migration transactionally under the lock", async () => {
  const { pool, client } = fakePool(async (sql) => {
    if (sql.includes("SELECT version, name")) {
      return { rows: [
        { version: "001", name: "base-schema", applied_at: "2026-07-11T00:00:00.000Z" },
        { version: "002", name: "settlement-canonical", applied_at: "2026-07-11T00:00:00.000Z" },
      ] };
    }
    return { rows: [] };
  });
  const originalLog = console.log;
  console.log = () => {};
  try {
    await migrateUpTo(pool, "003");
  } finally {
    console.log = originalLog;
  }

  assert.equal(client.queries.some(({ sql }) => sql.includes("ADD COLUMN attempt_count")), true);
  assert.equal(client.queries.some(({ sql, params }) => sql.includes("INSERT INTO _migrations") && params[0] === "003"), true);
  assert.deepEqual(
    client.queries.filter(({ sql }) => sql === "BEGIN" || sql === "COMMIT").map(({ sql }) => sql),
    ["BEGIN", "COMMIT"],
  );
  assert.match(client.queries.at(-1).sql, /pg_advisory_unlock/);
});

test("migrateUpTo does not apply migrations beyond an already-applied target", async () => {
  const { pool, client } = fakePool(async (sql) => {
    if (sql.includes("SELECT version, name")) {
      return { rows: [
        { version: "001", name: "base-schema", applied_at: "2026-07-11T00:00:00.000Z" },
        { version: "002", name: "settlement-canonical", applied_at: "2026-07-11T00:00:00.000Z" },
      ] };
    }
    return { rows: [] };
  });

  await migrateUpTo(pool, "002");

  assert.equal(client.queries.some(({ sql }) => sql.includes("ADD COLUMN attempt_count")), false);
  assert.equal(client.queries.some(({ sql }) => sql.includes("INSERT INTO _migrations")), false);
});

test("migrateUpTo rejects an unknown target without applying migrations", async () => {
  const { pool, client } = fakePool(async (sql) => {
    if (sql.includes("SELECT version, name")) return { rows: [] };
    return { rows: [] };
  });

  await assert.rejects(migrateUpTo(pool, "999"), /Target migration does not exist/);
  assert.equal(client.queries.some(({ sql }) => sql === "BEGIN"), false);
  assert.match(client.queries.at(-1).sql, /pg_advisory_unlock/);
});

test("database migration runner applies analytics outbox after hedge queue", async () => {
  const { pool, client } = fakePool(async (sql) => {
    if (sql.includes("SELECT version, name")) {
      return { rows: [
        { version: "001", name: "base-schema", applied_at: "2026-07-11T00:00:00.000Z" },
        { version: "002", name: "settlement-canonical", applied_at: "2026-07-11T00:00:00.000Z" },
        { version: "003", name: "hedge-worker-queue", applied_at: "2026-07-11T00:00:00.000Z" },
      ] };
    }
    return { rows: [] };
  });
  const originalLog = console.log;
  console.log = () => {};
  try {
    await migrateUpTo(pool, "004");
  } finally {
    console.log = originalLog;
  }

  assert.equal(client.queries.some(({ sql }) => sql.includes("CREATE TABLE analytics_outbox")), true);
  assert.equal(client.queries.some(({ sql }) => sql.includes("enqueue_rfq_analytics_event")), true);
  assert.equal(client.queries.some(({ sql, params }) => sql.includes("INSERT INTO _migrations") && params[0] === "004"), true);
});

test("database migration runner applies durable post-trade reconciliation after analytics", async () => {
  const { pool, client } = fakePool(async (sql) => {
    if (sql.includes("SELECT version, name")) {
      return { rows: [
        { version: "001", name: "base-schema", applied_at: "2026-07-11T00:00:00.000Z" },
        { version: "002", name: "settlement-canonical", applied_at: "2026-07-11T00:00:00.000Z" },
        { version: "003", name: "hedge-worker-queue", applied_at: "2026-07-11T00:00:00.000Z" },
        { version: "004", name: "analytics-outbox", applied_at: "2026-07-11T00:00:00.000Z" },
      ] };
    }
    return { rows: [] };
  });
  const originalLog = console.log;
  console.log = () => {};
  try {
    await migrateUpTo(pool, "005");
  } finally {
    console.log = originalLog;
  }

  assert.equal(client.queries.some(({ sql }) => sql.includes("CREATE TABLE post_trade_reconciliation_jobs")), true);
  assert.equal(client.queries.some(({ sql }) => sql.includes("enqueue_post_trade_reconciliation_job")), true);
  assert.equal(client.queries.some(({ sql }) => sql.includes("WHERE canonical = TRUE")), true);
  assert.equal(client.queries.some(({ sql, params }) => sql.includes("INSERT INTO _migrations") && params[0] === "005"), true);
});

test("database migration runner applies quote-snapshot PnL after reconciliation", async () => {
  const { pool, client } = fakePool(async (sql) => {
    if (sql.includes("SELECT version, name")) {
      return { rows: [
        { version: "001", name: "base-schema", applied_at: "2026-07-11T00:00:00.000Z" },
        { version: "002", name: "settlement-canonical", applied_at: "2026-07-11T00:00:00.000Z" },
        { version: "003", name: "hedge-worker-queue", applied_at: "2026-07-11T00:00:00.000Z" },
        { version: "004", name: "analytics-outbox", applied_at: "2026-07-11T00:00:00.000Z" },
        { version: "005", name: "post-trade-reconciliation", applied_at: "2026-07-11T00:00:00.000Z" },
      ] };
    }
    return { rows: [] };
  });
  const originalLog = console.log;
  console.log = () => {};
  try {
    await migrateUpTo(pool, "006");
  } finally {
    console.log = originalLog;
  }

  assert.equal(client.queries.some(({ sql }) => sql.includes("pnl_records_legacy_simulated_v1")), true);
  assert.equal(client.queries.some(({ sql }) => sql.includes("quote_snapshot_edge_v1")), true);
  assert.equal(client.queries.some(({ sql }) => sql.includes("pnl.attribution.v2")), true);
  assert.equal(client.queries.some(({ sql, params }) => sql.includes("INSERT INTO _migrations") && params[0] === "006"), true);
});

test("database migration runner applies durable settlement indexer state after PnL", async () => {
  const { pool, client } = fakePool(async (sql) => {
    if (sql.includes("SELECT version, name")) {
      return { rows: [
        { version: "001", name: "base-schema", applied_at: "2026-07-11T00:00:00.000Z" },
        { version: "002", name: "settlement-canonical", applied_at: "2026-07-11T00:00:00.000Z" },
        { version: "003", name: "hedge-worker-queue", applied_at: "2026-07-11T00:00:00.000Z" },
        { version: "004", name: "analytics-outbox", applied_at: "2026-07-11T00:00:00.000Z" },
        { version: "005", name: "post-trade-reconciliation", applied_at: "2026-07-11T00:00:00.000Z" },
        { version: "006", name: "quote-snapshot-pnl", applied_at: "2026-07-11T00:00:00.000Z" },
      ] };
    }
    return { rows: [] };
  });
  const originalLog = console.log;
  console.log = () => {};
  try {
    await migrateUpTo(pool, "007");
  } finally {
    console.log = originalLog;
  }

  assert.equal(client.queries.some(({ sql }) => sql.includes("CREATE TABLE settlement_indexer_cursors")), true);
  assert.equal(client.queries.some(({ sql }) => sql.includes("CREATE TABLE settlement_indexer_checkpoints")), true);
  assert.equal(client.queries.some(({ sql }) => sql.includes("idx_settlement_events_canonical_chain_block")), true);
  assert.equal(client.queries.some(({ sql, params }) => sql.includes("INSERT INTO _migrations") && params[0] === "007"), true);
});

test("database migration runner applies submit reservations after the settlement indexer", async () => {
  const { pool, client } = fakePool(async (sql) => {
    if (sql.includes("SELECT version, name")) {
      return { rows: [
        { version: "001", name: "base-schema", applied_at: "2026-07-13T00:00:00.000Z" },
        { version: "002", name: "settlement-canonical", applied_at: "2026-07-13T00:00:00.000Z" },
        { version: "003", name: "hedge-worker-queue", applied_at: "2026-07-13T00:00:00.000Z" },
        { version: "004", name: "analytics-outbox", applied_at: "2026-07-13T00:00:00.000Z" },
        { version: "005", name: "post-trade-reconciliation", applied_at: "2026-07-13T00:00:00.000Z" },
        { version: "006", name: "quote-snapshot-pnl", applied_at: "2026-07-13T00:00:00.000Z" },
        { version: "007", name: "settlement-indexer", applied_at: "2026-07-13T00:00:00.000Z" },
      ] };
    }
    return { rows: [] };
  });
  const originalLog = console.log;
  console.log = () => {};
  try {
    await migrateUpTo(pool, "008");
  } finally {
    console.log = originalLog;
  }

  assert.equal(client.queries.some(({ sql }) => sql.includes("CREATE TABLE quote_submit_reservations")), true);
  assert.equal(client.queries.some(({ sql }) => sql.includes("idx_quote_submit_reservations_expiry")), true);
  assert.equal(client.queries.some(({ sql, params }) => sql.includes("INSERT INTO _migrations") && params[0] === "008"), true);
});

test("database migration runner applies risk notional reasons after submit reservations", async () => {
  const { pool, client } = fakePool(async (sql) => {
    if (sql.includes("SELECT version, name")) {
      return { rows: [
        { version: "001", name: "base-schema", applied_at: "2026-07-13T00:00:00.000Z" },
        { version: "002", name: "settlement-canonical", applied_at: "2026-07-13T00:00:00.000Z" },
        { version: "003", name: "hedge-worker-queue", applied_at: "2026-07-13T00:00:00.000Z" },
        { version: "004", name: "analytics-outbox", applied_at: "2026-07-13T00:00:00.000Z" },
        { version: "005", name: "post-trade-reconciliation", applied_at: "2026-07-13T00:00:00.000Z" },
        { version: "006", name: "quote-snapshot-pnl", applied_at: "2026-07-13T00:00:00.000Z" },
        { version: "007", name: "settlement-indexer", applied_at: "2026-07-13T00:00:00.000Z" },
        { version: "008", name: "submit-reservations", applied_at: "2026-07-13T00:00:00.000Z" },
      ] };
    }
    return { rows: [] };
  });
  const originalLog = console.log;
  console.log = () => {};
  try {
    await migrateUpTo(pool, "009");
  } finally {
    console.log = originalLog;
  }

  assert.equal(client.queries.some(({ sql }) => sql.includes("DROP CONSTRAINT IF EXISTS chk_risk_decisions_reason_code_consistency")), true);
  assert.equal(client.queries.some(({ sql }) => sql.includes("QUOTE_NOTIONAL_LIMIT_EXCEEDED")), true);
  assert.equal(client.queries.some(({ sql }) => sql.includes("USD_REFERENCE_REQUIRED")), true);
  assert.equal(client.queries.some(({ sql, params }) => sql.includes("INSERT INTO _migrations") && params[0] === "009"), true);
});

test("database migration runner applies market-regime reasons after risk notional reasons", async () => {
  const { pool, client } = fakePool(async (sql) => {
    if (sql.includes("SELECT version, name")) {
      return { rows: [
        { version: "001", name: "base-schema", applied_at: "2026-07-13T00:00:00.000Z" },
        { version: "002", name: "settlement-canonical", applied_at: "2026-07-13T00:00:00.000Z" },
        { version: "003", name: "hedge-worker-queue", applied_at: "2026-07-13T00:00:00.000Z" },
        { version: "004", name: "analytics-outbox", applied_at: "2026-07-13T00:00:00.000Z" },
        { version: "005", name: "post-trade-reconciliation", applied_at: "2026-07-13T00:00:00.000Z" },
        { version: "006", name: "quote-snapshot-pnl", applied_at: "2026-07-13T00:00:00.000Z" },
        { version: "007", name: "settlement-indexer", applied_at: "2026-07-13T00:00:00.000Z" },
        { version: "008", name: "submit-reservations", applied_at: "2026-07-13T00:00:00.000Z" },
        { version: "009", name: "risk-notional-reasons", applied_at: "2026-07-14T00:00:00.000Z" },
      ] };
    }
    return { rows: [] };
  });
  const originalLog = console.log;
  console.log = () => {};
  try {
    await migrateUpTo(pool, "010");
  } finally {
    console.log = originalLog;
  }

  assert.equal(client.queries.some(({ sql }) => sql.includes("MARKET_LIQUIDITY_TOO_LOW")), true);
  assert.equal(client.queries.some(({ sql }) => sql.includes("MARKET_VOLATILITY_LIMIT_EXCEEDED")), true);
  assert.equal(client.queries.some(({ sql, params }) => sql.includes("INSERT INTO _migrations") && params[0] === "010"), true);
});

test("database migration runner applies open quote exposure after market-regime reasons", async () => {
  const { pool, client } = fakePool(async (sql) => {
    if (sql.includes("SELECT version, name")) {
      return { rows: [
        { version: "001", name: "base-schema", applied_at: "2026-07-13T00:00:00.000Z" },
        { version: "002", name: "settlement-canonical", applied_at: "2026-07-13T00:00:00.000Z" },
        { version: "003", name: "hedge-worker-queue", applied_at: "2026-07-13T00:00:00.000Z" },
        { version: "004", name: "analytics-outbox", applied_at: "2026-07-13T00:00:00.000Z" },
        { version: "005", name: "post-trade-reconciliation", applied_at: "2026-07-13T00:00:00.000Z" },
        { version: "006", name: "quote-snapshot-pnl", applied_at: "2026-07-13T00:00:00.000Z" },
        { version: "007", name: "settlement-indexer", applied_at: "2026-07-13T00:00:00.000Z" },
        { version: "008", name: "submit-reservations", applied_at: "2026-07-13T00:00:00.000Z" },
        { version: "009", name: "risk-notional-reasons", applied_at: "2026-07-14T00:00:00.000Z" },
        { version: "010", name: "risk-market-regime-reasons", applied_at: "2026-07-14T00:01:00.000Z" },
      ] };
    }
    return { rows: [] };
  });
  const originalLog = console.log;
  console.log = () => {};
  try {
    await migrateUpTo(pool, "011");
  } finally {
    console.log = originalLog;
  }

  assert.equal(client.queries.some(({ sql }) => sql.includes("CREATE TABLE IF NOT EXISTS quote_exposure_reservations")), true);
  assert.equal(client.queries.some(({ sql }) => sql.includes("USER_OPEN_NOTIONAL_LIMIT_EXCEEDED")), true);
  assert.equal(client.queries.some(({ sql }) => sql.includes("PAIR_OPEN_NOTIONAL_LIMIT_EXCEEDED")), true);
  assert.equal(client.queries.some(({ sql, params }) => sql.includes("INSERT INTO _migrations") && params[0] === "011"), true);
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
