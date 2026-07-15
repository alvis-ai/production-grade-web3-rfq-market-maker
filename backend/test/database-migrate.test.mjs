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
        { version: "012", name: "pricing-attribution", applied_at: "2026-07-14T00:03:00.000Z" },
        { version: "013", name: "market-spread-attribution", applied_at: "2026-07-14T00:04:00.000Z" },
        { version: "014", name: "hedge-execution-evidence", applied_at: "2026-07-14T00:05:00.000Z" },
        { version: "015", name: "hedge-fee-reconciliation", applied_at: "2026-07-14T00:06:00.000Z" },
        { version: "016", name: "treasury-liquidity-reservations", applied_at: "2026-07-14T00:07:00.000Z" },
        { version: "017", name: "quote-principal-ownership", applied_at: "2026-07-14T00:08:00.000Z" },
        { version: "018", name: "quote-control", applied_at: "2026-07-14T00:09:00.000Z" },
        { version: "019", name: "pair-quote-control", applied_at: "2026-07-14T00:10:00.000Z" },
        { version: "020", name: "toxic-flow-scores", applied_at: "2026-07-14T00:11:00.000Z" },
        { version: "021", name: "toxic-flow-markouts", applied_at: "2026-07-14T00:12:00.000Z" },
        { version: "022", name: "portfolio-var-reservations", applied_at: "2026-07-14T00:13:00.000Z" },
        { version: "023", name: "quote-idempotency", applied_at: "2026-07-15T00:00:00.000Z" },
        { version: "024", name: "hedge-net-pnl", applied_at: "2026-07-15T00:01:00.000Z" },
        { version: "025", name: "bounded-hedge-limit", applied_at: "2026-07-15T00:02:00.000Z" },
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

test("database migration runner applies pricing attribution after open quote exposure", async () => {
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
        { version: "011", name: "open-quote-exposure", applied_at: "2026-07-14T00:02:00.000Z" },
      ] };
    }
    return { rows: [] };
  });
  const originalLog = console.log;
  console.log = () => {};
  try {
    await migrateUpTo(pool, "012");
  } finally {
    console.log = originalLog;
  }

  assert.equal(client.queries.some(({ sql }) => sql.includes("ADD COLUMN volatility_premium_bps")), true);
  assert.equal(client.queries.some(({ sql }) => sql.includes("ADD COLUMN hedge_cost_bps")), true);
  assert.equal(client.queries.some(({ sql }) => (
    sql.includes("SET volatility_premium_bps = 0") &&
    sql.includes("hedge_cost_bps = 0") &&
    sql.includes("WHERE amount_out IS NOT NULL")
  )), true);
  assert.equal(client.queries.some(({ sql }) => sql.includes("'volatilityPremiumBps'")), true);
  assert.equal(client.queries.some(({ sql }) => sql.includes("'hedgeCostBps'")), true);
  assert.equal(client.queries.some(({ sql, params }) => sql.includes("INSERT INTO _migrations") && params[0] === "012"), true);
});

test("database migration runner applies market spread attribution after pricing attribution", async () => {
  const { pool, client } = fakePool(async (sql) => {
    if (sql.includes("SELECT version, name")) {
      return { rows: [
        ["001", "base-schema"],
        ["002", "settlement-canonical"],
        ["003", "hedge-worker-queue"],
        ["004", "analytics-outbox"],
        ["005", "post-trade-reconciliation"],
        ["006", "quote-snapshot-pnl"],
        ["007", "settlement-indexer"],
        ["008", "submit-reservations"],
        ["009", "risk-notional-reasons"],
        ["010", "risk-market-regime-reasons"],
        ["011", "open-quote-exposure"],
        ["012", "pricing-attribution"],
      ].map(([version, name]) => ({ version, name, applied_at: "2026-07-14T00:00:00.000Z" })) };
    }
    return { rows: [] };
  });
  const originalLog = console.log;
  console.log = () => {};
  try {
    await migrateUpTo(pool, "013");
  } finally {
    console.log = originalLog;
  }

  assert.equal(client.queries.some(({ sql }) => sql.includes("ALTER TABLE market_snapshots") && sql.includes("ADD COLUMN market_spread_bps")), true);
  assert.equal(client.queries.some(({ sql }) => sql.includes("ALTER TABLE quotes") && sql.includes("ADD COLUMN market_spread_bps")), true);
  assert.equal(client.queries.some(({ sql }) => sql.includes("chk_market_snapshots_market_spread_bps")), true);
  assert.equal(client.queries.some(({ sql }) => sql.includes("'marketSpreadBps', source_row.market_spread_bps")), true);
  assert.equal(client.queries.some(({ sql }) => sql.includes("DROP TRIGGER trg_market_snapshots_analytics_update")), true);
  assert.equal(client.queries.some(({ sql, params }) => sql.includes("INSERT INTO _migrations") && params[0] === "013"), true);
});

test("database migration runner adds versioned cumulative hedge execution evidence", async () => {
  const { pool, client } = fakePool(async (sql) => {
    if (sql.includes("SELECT version, name")) {
      return { rows: [
        ["001", "base-schema"],
        ["002", "settlement-canonical"],
        ["003", "hedge-worker-queue"],
        ["004", "analytics-outbox"],
        ["005", "post-trade-reconciliation"],
        ["006", "quote-snapshot-pnl"],
        ["007", "settlement-indexer"],
        ["008", "submit-reservations"],
        ["009", "risk-notional-reasons"],
        ["010", "risk-market-regime-reasons"],
        ["011", "open-quote-exposure"],
        ["012", "pricing-attribution"],
        ["013", "market-spread-attribution"],
      ].map(([version, name]) => ({ version, name, applied_at: "2026-07-14T00:00:00.000Z" })) };
    }
    return { rows: [] };
  });
  const originalLog = console.log;
  console.log = () => {};
  try {
    await migrateUpTo(pool, "014");
  } finally {
    console.log = originalLog;
  }

  assert.equal(client.queries.some(({ sql }) => sql.includes("ADD COLUMN execution_evidence_version")), true);
  assert.equal(client.queries.some(({ sql }) => sql.includes("ADD COLUMN executed_quote_quantity")), true);
  assert.equal(client.queries.some(({ sql }) => sql.includes("base-only-v1")), true);
  assert.equal(client.queries.some(({ sql }) => sql.includes("hedge.lifecycle.v2")), true);
  assert.equal(client.queries.some(({ sql, params }) =>
    sql.includes("INSERT INTO _migrations") && params[0] === "014"), true);
});

test("database migration runner adds durable hedge fee reconciliation", async () => {
  const { pool, client } = fakePool(async (sql) => {
    if (sql.includes("SELECT version, name")) {
      return { rows: [
        ["001", "base-schema"],
        ["002", "settlement-canonical"],
        ["003", "hedge-worker-queue"],
        ["004", "analytics-outbox"],
        ["005", "post-trade-reconciliation"],
        ["006", "quote-snapshot-pnl"],
        ["007", "settlement-indexer"],
        ["008", "submit-reservations"],
        ["009", "risk-notional-reasons"],
        ["010", "risk-market-regime-reasons"],
        ["011", "open-quote-exposure"],
        ["012", "pricing-attribution"],
        ["013", "market-spread-attribution"],
        ["014", "hedge-execution-evidence"],
      ].map(([version, name]) => ({ version, name, applied_at: "2026-07-14T00:00:00.000Z" })) };
    }
    return { rows: [] };
  });
  const originalLog = console.log;
  console.log = () => {};
  try {
    await migrateUpTo(pool, "015");
  } finally {
    console.log = originalLog;
  }

  assert.equal(client.queries.some(({ sql }) => sql.includes("ADD COLUMN venue_order_id")), true);
  assert.equal(client.queries.some(({ sql }) => sql.includes("CREATE TABLE hedge_execution_fills")), true);
  assert.equal(client.queries.some(({ sql }) => sql.includes("hedge.execution-fill.v1")), true);
  assert.equal(client.queries.some(({ sql }) => sql.includes("hedge.lifecycle.v3")), true);
  assert.equal(client.queries.some(({ sql, params }) =>
    sql.includes("INSERT INTO _migrations") && params[0] === "015"), true);
});

test("database migration runner adds treasury output liquidity reservations", async () => {
  const { pool, client } = fakePool(async (sql) => {
    if (sql.includes("SELECT version, name")) {
      return { rows: [
        ["001", "base-schema"],
        ["002", "settlement-canonical"],
        ["003", "hedge-worker-queue"],
        ["004", "analytics-outbox"],
        ["005", "post-trade-reconciliation"],
        ["006", "quote-snapshot-pnl"],
        ["007", "settlement-indexer"],
        ["008", "submit-reservations"],
        ["009", "risk-notional-reasons"],
        ["010", "risk-market-regime-reasons"],
        ["011", "open-quote-exposure"],
        ["012", "pricing-attribution"],
        ["013", "market-spread-attribution"],
        ["014", "hedge-execution-evidence"],
        ["015", "hedge-fee-reconciliation"],
      ].map(([version, name]) => ({ version, name, applied_at: "2026-07-14T00:00:00.000Z" })) };
    }
    return { rows: [] };
  });
  const originalLog = console.log;
  console.log = () => {};
  try {
    await migrateUpTo(pool, "016");
  } finally {
    console.log = originalLog;
  }

  assert.equal(client.queries.some(({ sql }) => sql.includes("ADD COLUMN IF NOT EXISTS token_out")), true);
  assert.equal(client.queries.some(({ sql }) => sql.includes("treasury_available_balance")), true);
  assert.equal(client.queries.some(({ sql }) =>
    sql.includes("settlement_address IS NOT NULL") &&
    sql.includes("treasury_address IS NOT NULL") &&
    sql.includes("treasury_available_balance IS NOT NULL") &&
    sql.includes("treasury_block_number IS NOT NULL")), true);
  assert.equal(client.queries.some(({ sql }) => sql.includes("idx_quote_exposure_output_active")), true);
  assert.equal(client.queries.some(({ sql }) => sql.includes("TREASURY_LIQUIDITY_INSUFFICIENT")), true);
  assert.equal(client.queries.some(({ sql, params }) =>
    sql.includes("INSERT INTO _migrations") && params[0] === "016"), true);
});

test("database migration runner adds fail-closed quote principal ownership", async () => {
  const { pool, client } = fakePool(async (sql) => {
    if (sql.includes("SELECT version, name")) {
      return { rows: [
        ["001", "base-schema"], ["002", "settlement-canonical"], ["003", "hedge-worker-queue"],
        ["004", "analytics-outbox"], ["005", "post-trade-reconciliation"], ["006", "quote-snapshot-pnl"],
        ["007", "settlement-indexer"], ["008", "submit-reservations"], ["009", "risk-notional-reasons"],
        ["010", "risk-market-regime-reasons"], ["011", "open-quote-exposure"], ["012", "pricing-attribution"],
        ["013", "market-spread-attribution"], ["014", "hedge-execution-evidence"],
        ["015", "hedge-fee-reconciliation"], ["016", "treasury-liquidity-reservations"],
      ].map(([version, name]) => ({ version, name, applied_at: "2026-07-14T00:00:00.000Z" })) };
    }
    return { rows: [] };
  });
  const originalLog = console.log;
  console.log = () => {};
  try {
    await migrateUpTo(pool, "017");
  } finally {
    console.log = originalLog;
  }

  assert.equal(client.queries.some(({ sql }) => sql.includes("ADD COLUMN IF NOT EXISTS principal_id")), true);
  assert.equal(client.queries.some(({ sql }) => sql.includes("'legacy:' || md5(id)")), true);
  assert.equal(client.queries.some(({ sql }) => sql.includes("ALTER COLUMN principal_id SET NOT NULL")), true);
  assert.equal(client.queries.some(({ sql }) => sql.includes("idx_quotes_principal_created_at")), true);
  assert.equal(client.queries.some(({ sql, params }) =>
    sql.includes("INSERT INTO _migrations") && params[0] === "017"), true);
});

test("database migration runner adds auditable quote control state", async () => {
  const { pool, client } = fakePool(async (sql) => {
    if (sql.includes("SELECT version, name")) {
      return { rows: [
        ["001", "base-schema"], ["002", "settlement-canonical"], ["003", "hedge-worker-queue"],
        ["004", "analytics-outbox"], ["005", "post-trade-reconciliation"], ["006", "quote-snapshot-pnl"],
        ["007", "settlement-indexer"], ["008", "submit-reservations"], ["009", "risk-notional-reasons"],
        ["010", "risk-market-regime-reasons"], ["011", "open-quote-exposure"], ["012", "pricing-attribution"],
        ["013", "market-spread-attribution"], ["014", "hedge-execution-evidence"],
        ["015", "hedge-fee-reconciliation"], ["016", "treasury-liquidity-reservations"],
        ["017", "quote-principal-ownership"],
      ].map(([version, name]) => ({ version, name, applied_at: "2026-07-14T00:00:00.000Z" })) };
    }
    return { rows: [] };
  });
  const originalLog = console.log;
  console.log = () => {};
  try {
    await migrateUpTo(pool, "018");
  } finally {
    console.log = originalLog;
  }

  assert.equal(client.queries.some(({ sql }) => sql.includes("CREATE TABLE quote_control")), true);
  assert.equal(client.queries.some(({ sql }) => sql.includes("CREATE TABLE quote_control_audit")), true);
  assert.equal(client.queries.some(({ sql }) => sql.includes("chk_quote_control_version")), true);
  assert.equal(client.queries.some(({ sql }) => sql.includes("chk_quote_control_audit_version")), true);
  assert.equal(client.queries.some(({ sql }) => sql.includes("chk_quote_control_paused_reason")), true);
  assert.equal(client.queries.some(({ sql, params }) =>
    sql.includes("INSERT INTO _migrations") && params[0] === "018"), true);
});

test("database migration runner adds auditable pair quote control state", async () => {
  const { pool, client } = fakePool(async (sql) => {
    if (sql.includes("SELECT version, name")) {
      return { rows: [
        ["001", "base-schema"], ["002", "settlement-canonical"], ["003", "hedge-worker-queue"],
        ["004", "analytics-outbox"], ["005", "post-trade-reconciliation"], ["006", "quote-snapshot-pnl"],
        ["007", "settlement-indexer"], ["008", "submit-reservations"], ["009", "risk-notional-reasons"],
        ["010", "risk-market-regime-reasons"], ["011", "open-quote-exposure"], ["012", "pricing-attribution"],
        ["013", "market-spread-attribution"], ["014", "hedge-execution-evidence"],
        ["015", "hedge-fee-reconciliation"], ["016", "treasury-liquidity-reservations"],
        ["017", "quote-principal-ownership"], ["018", "quote-control"],
      ].map(([version, name]) => ({ version, name, applied_at: "2026-07-14T00:00:00.000Z" })) };
    }
    return { rows: [] };
  });
  const originalLog = console.log;
  console.log = () => {};
  try {
    await migrateUpTo(pool, "019");
  } finally {
    console.log = originalLog;
  }

  assert.equal(client.queries.some(({ sql }) => sql.includes("CREATE TABLE quote_pair_control")), true);
  assert.equal(client.queries.some(({ sql }) => sql.includes("CREATE TABLE quote_pair_control_audit")), true);
  assert.equal(client.queries.some(({ sql }) => sql.includes("chk_quote_pair_control_order")), true);
  assert.equal(client.queries.some(({ sql }) => sql.includes("chk_quote_pair_control_audit_version")), true);
  assert.equal(client.queries.some(({ sql }) => sql.includes("idx_quote_pair_control_paused")), true);
  assert.equal(client.queries.some(({ sql, params }) =>
    sql.includes("INSERT INTO _migrations") && params[0] === "019"), true);
});

test("database migration runner adds auditable toxic-flow score state", async () => {
  const { pool, client } = fakePool(async (sql) => {
    if (sql.includes("SELECT version, name")) {
      return { rows: [
        ["001", "base-schema"], ["002", "settlement-canonical"], ["003", "hedge-worker-queue"],
        ["004", "analytics-outbox"], ["005", "post-trade-reconciliation"], ["006", "quote-snapshot-pnl"],
        ["007", "settlement-indexer"], ["008", "submit-reservations"], ["009", "risk-notional-reasons"],
        ["010", "risk-market-regime-reasons"], ["011", "open-quote-exposure"], ["012", "pricing-attribution"],
        ["013", "market-spread-attribution"], ["014", "hedge-execution-evidence"],
        ["015", "hedge-fee-reconciliation"], ["016", "treasury-liquidity-reservations"],
        ["017", "quote-principal-ownership"], ["018", "quote-control"], ["019", "pair-quote-control"],
      ].map(([version, name]) => ({ version, name, applied_at: "2026-07-14T00:00:00.000Z" })) };
    }
    return { rows: [] };
  });
  const originalLog = console.log;
  console.log = () => {};
  try {
    await migrateUpTo(pool, "020");
  } finally {
    console.log = originalLog;
  }

  assert.equal(client.queries.some(({ sql }) => sql.includes("CREATE TABLE toxic_flow_scores")), true);
  assert.equal(client.queries.some(({ sql }) => sql.includes("CREATE TABLE toxic_flow_score_audit")), true);
  assert.equal(client.queries.some(({ sql }) => sql.includes("chk_toxic_flow_scores_score")), true);
  assert.equal(client.queries.some(({ sql }) => sql.includes("idx_toxic_flow_scores_observed_at")), true);
  assert.equal(client.queries.some(({ sql, params }) =>
    sql.includes("INSERT INTO _migrations") && params[0] === "020"), true);
});

test("database migration runner adds durable toxic-flow markout analysis", async () => {
  const { pool, client } = fakePool(async (sql) => {
    if (sql.includes("SELECT version, name")) {
      return { rows: [
        ["001", "base-schema"], ["002", "settlement-canonical"], ["003", "hedge-worker-queue"],
        ["004", "analytics-outbox"], ["005", "post-trade-reconciliation"], ["006", "quote-snapshot-pnl"],
        ["007", "settlement-indexer"], ["008", "submit-reservations"], ["009", "risk-notional-reasons"],
        ["010", "risk-market-regime-reasons"], ["011", "open-quote-exposure"], ["012", "pricing-attribution"],
        ["013", "market-spread-attribution"], ["014", "hedge-execution-evidence"],
        ["015", "hedge-fee-reconciliation"], ["016", "treasury-liquidity-reservations"],
        ["017", "quote-principal-ownership"], ["018", "quote-control"], ["019", "pair-quote-control"],
        ["020", "toxic-flow-scores"],
      ].map(([version, name]) => ({ version, name, applied_at: "2026-07-14T00:00:00.000Z" })) };
    }
    return { rows: [] };
  });
  const originalLog = console.log;
  console.log = () => {};
  try {
    await migrateUpTo(pool, "021");
  } finally {
    console.log = originalLog;
  }

  assert.equal(client.queries.some(({ sql }) => sql.includes("CREATE TABLE toxic_flow_markout_jobs")), true);
  assert.equal(client.queries.some(({ sql }) => sql.includes("CREATE TABLE toxic_flow_markouts")), true);
  assert.equal(client.queries.some(({ sql }) => sql.includes("ADD COLUMN settled_at TIMESTAMPTZ")), true);
  assert.equal(client.queries.some(({ sql }) => sql.includes("enqueue_toxic_flow_markout_job")), true);
  assert.equal(client.queries.some(({ sql }) => sql.includes("NEW.settled_at")), true);
  assert.equal(client.queries.some(({ sql }) => sql.includes("WHERE settled_at IS NOT NULL")), true);
  assert.equal(client.queries.some(({ sql }) => sql.includes("trg_settlement_events_toxic_flow_markout")), true);
  assert.equal(client.queries.some(({ sql }) => sql.includes("chk_toxic_flow_scores_empty_sample")), true);
  assert.equal(client.queries.some(({ sql, params }) =>
    sql.includes("INSERT INTO _migrations") && params[0] === "021"), true);
});

test("database migration runner adds replayable portfolio VaR reservations", async () => {
  const { pool, client } = fakePool(async (sql) => {
    if (sql.includes("SELECT version, name")) {
      return { rows: [
        ["001", "base-schema"], ["002", "settlement-canonical"], ["003", "hedge-worker-queue"],
        ["004", "analytics-outbox"], ["005", "post-trade-reconciliation"], ["006", "quote-snapshot-pnl"],
        ["007", "settlement-indexer"], ["008", "submit-reservations"], ["009", "risk-notional-reasons"],
        ["010", "risk-market-regime-reasons"], ["011", "open-quote-exposure"], ["012", "pricing-attribution"],
        ["013", "market-spread-attribution"], ["014", "hedge-execution-evidence"],
        ["015", "hedge-fee-reconciliation"], ["016", "treasury-liquidity-reservations"],
        ["017", "quote-principal-ownership"], ["018", "quote-control"], ["019", "pair-quote-control"],
        ["020", "toxic-flow-scores"], ["021", "toxic-flow-markouts"],
      ].map(([version, name]) => ({ version, name, applied_at: "2026-07-14T00:00:00.000Z" })) };
    }
    return { rows: [] };
  });
  const originalLog = console.log;
  console.log = () => {};
  try {
    await migrateUpTo(pool, "022");
  } finally {
    console.log = originalLog;
  }

  assert.equal(client.queries.some(({ sql }) => sql.includes("ADD COLUMN IF NOT EXISTS token_in")), true);
  assert.equal(client.queries.some(({ sql }) => sql.includes("ADD COLUMN IF NOT EXISTS amount_in")), true);
  assert.equal(client.queries.some(({ sql }) => sql.includes("ADD COLUMN IF NOT EXISTS var_evaluation JSONB")), true);
  assert.equal(client.queries.some(({ sql }) => sql.includes("PORTFOLIO_VAR_LIMIT_EXCEEDED")), true);
  assert.equal(client.queries.some(({ sql, params }) =>
    sql.includes("INSERT INTO _migrations") && params[0] === "022"), true);
});

test("database migration runner adds principal-scoped quote idempotency", async () => {
  const { pool, client } = fakePool(async (sql) => {
    if (sql.includes("SELECT version, name")) {
      return { rows: [
        ["001", "base-schema"], ["002", "settlement-canonical"], ["003", "hedge-worker-queue"],
        ["004", "analytics-outbox"], ["005", "post-trade-reconciliation"], ["006", "quote-snapshot-pnl"],
        ["007", "settlement-indexer"], ["008", "submit-reservations"], ["009", "risk-notional-reasons"],
        ["010", "risk-market-regime-reasons"], ["011", "open-quote-exposure"], ["012", "pricing-attribution"],
        ["013", "market-spread-attribution"], ["014", "hedge-execution-evidence"],
        ["015", "hedge-fee-reconciliation"], ["016", "treasury-liquidity-reservations"],
        ["017", "quote-principal-ownership"], ["018", "quote-control"], ["019", "pair-quote-control"],
        ["020", "toxic-flow-scores"], ["021", "toxic-flow-markouts"],
        ["022", "portfolio-var-reservations"],
      ].map(([version, name]) => ({ version, name, applied_at: "2026-07-15T00:00:00.000Z" })) };
    }
    return { rows: [] };
  });
  const originalLog = console.log;
  console.log = () => {};
  try {
    await migrateUpTo(pool, "023");
  } finally {
    console.log = originalLog;
  }

  assert.equal(client.queries.some(({ sql }) => sql.includes("CREATE TABLE quote_idempotency_requests")), true);
  assert.equal(client.queries.some(({ sql }) => sql.includes("PRIMARY KEY (principal_id, idempotency_key)")), true);
  assert.equal(client.queries.some(({ sql }) => sql.includes("trg_quote_idempotency_requests_set_updated_at")), true);
  assert.equal(client.queries.some(({ sql, params }) =>
    sql.includes("INSERT INTO _migrations") && params[0] === "023"), true);
});

test("database migration runner adds hedge net PnL accounting", async () => {
  const { pool, client } = fakePool(async (sql) => {
    if (sql.includes("SELECT version, name")) {
      return { rows: [
        ["001", "base-schema"], ["002", "settlement-canonical"], ["003", "hedge-worker-queue"],
        ["004", "analytics-outbox"], ["005", "post-trade-reconciliation"], ["006", "quote-snapshot-pnl"],
        ["007", "settlement-indexer"], ["008", "submit-reservations"], ["009", "risk-notional-reasons"],
        ["010", "risk-market-regime-reasons"], ["011", "open-quote-exposure"], ["012", "pricing-attribution"],
        ["013", "market-spread-attribution"], ["014", "hedge-execution-evidence"],
        ["015", "hedge-fee-reconciliation"], ["016", "treasury-liquidity-reservations"],
        ["017", "quote-principal-ownership"], ["018", "quote-control"], ["019", "pair-quote-control"],
        ["020", "toxic-flow-scores"], ["021", "toxic-flow-markouts"],
        ["022", "portfolio-var-reservations"], ["023", "quote-idempotency"],
      ].map(([version, name]) => ({ version, name, applied_at: "2026-07-15T00:00:00.000Z" })) };
    }
    return { rows: [] };
  });
  const originalLog = console.log;
  console.log = () => {};
  try {
    await migrateUpTo(pool, "024");
  } finally {
    console.log = originalLog;
  }

  assert.equal(client.queries.some(({ sql }) => sql.includes("ADD COLUMN route_accounting_version")), true);
  assert.equal(client.queries.some(({ sql }) => sql.includes("hedge_fill_net_v1")), true);
  assert.equal(client.queries.some(({ sql }) => sql.includes("UNVALUED_COMMISSION_ASSET")), true);
  assert.equal(client.queries.some(({ sql }) => sql.includes("PARTIAL_HEDGE_UNCLOSED")), true);
  assert.equal(client.queries.some(({ sql, params }) =>
    sql.includes("INSERT INTO _migrations") && params[0] === "024"), true);
});

test("database migration runner adds bounded hedge limit execution", async () => {
  const { pool, client } = fakePool(async (sql) => {
    if (sql.includes("SELECT version, name")) {
      return { rows: [
        ["001", "base-schema"], ["002", "settlement-canonical"], ["003", "hedge-worker-queue"],
        ["004", "analytics-outbox"], ["005", "post-trade-reconciliation"], ["006", "quote-snapshot-pnl"],
        ["007", "settlement-indexer"], ["008", "submit-reservations"], ["009", "risk-notional-reasons"],
        ["010", "risk-market-regime-reasons"], ["011", "open-quote-exposure"], ["012", "pricing-attribution"],
        ["013", "market-spread-attribution"], ["014", "hedge-execution-evidence"],
        ["015", "hedge-fee-reconciliation"], ["016", "treasury-liquidity-reservations"],
        ["017", "quote-principal-ownership"], ["018", "quote-control"], ["019", "pair-quote-control"],
        ["020", "toxic-flow-scores"], ["021", "toxic-flow-markouts"],
        ["022", "portfolio-var-reservations"], ["023", "quote-idempotency"],
        ["024", "hedge-net-pnl"],
      ].map(([version, name]) => ({ version, name, applied_at: "2026-07-15T00:00:00.000Z" })) };
    }
    return { rows: [] };
  });
  const originalLog = console.log;
  console.log = () => {};
  try {
    await migrateUpTo(pool, "025");
  } finally {
    console.log = originalLog;
  }

  assert.equal(client.queries.some(({ sql }) => sql.includes("ADD COLUMN execution_order_type")), true);
  assert.equal(client.queries.some(({ sql }) => sql.includes("execution_policy_version = 'bounded-limit-v1'")), true);
  assert.equal(client.queries.some(({ sql }) => sql.includes("mod(execution_limit_price, execution_price_tick) = 0")), true);
  assert.equal(client.queries.some(({ sql, params }) =>
    sql.includes("INSERT INTO _migrations") && params[0] === "025"), true);
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
