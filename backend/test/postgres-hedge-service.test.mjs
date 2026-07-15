import assert from "node:assert/strict";
import test from "node:test";
import { PostgresHedgeService } from "../dist/modules/hedge/postgres-hedge.service.js";

const intent = {
  settlementEventId: "se_1_test_0",
  quoteId: "q_postgres_hedge",
  chainId: 1,
  token: "0x0000000000000000000000000000000000000003",
  side: "buy",
  amount: "990",
  reason: "inventory_rebalance",
};

test("PostgresHedgeService creates deterministic idempotent hedge intents", async () => {
  let insertedRow;
  const { pool, client } = fakePool(async (sql, params) => {
    if (sql.includes("FROM settlement_events AS settlement")) {
      return { rows: [{ id: intent.settlementEventId, canonical: true }], rowCount: 1 };
    }
    if (sql.includes("INSERT INTO hedge_orders")) {
      insertedRow = hedgeRowFromParams(params);
      return { rows: [insertedRow], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
  const service = new PostgresHedgeService(pool);

  const result = await service.createHedgeIntent(intent);

  assert.match(result.hedgeOrderId, /^h_[a-f0-9]{32}$/);
  assert.equal(result.record.settlementEventId, intent.settlementEventId);
  assert.equal(client.released, true);
});

test("PostgresHedgeService returns matching existing intents and rejects conflicts", async () => {
  let conflict = false;
  const { pool } = fakePool(async (sql) => {
    if (sql.includes("FROM settlement_events AS settlement")) {
      return { rows: [{ id: intent.settlementEventId, canonical: true }], rowCount: 1 };
    }
    if (sql.includes("INSERT INTO hedge_orders")) return { rows: [], rowCount: 0 };
    if (sql.includes("WHERE settlement_event_id")) {
      return { rows: [hedgeRow({ amount: conflict ? "991" : intent.amount })], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
  const service = new PostgresHedgeService(pool);

  assert.equal((await service.createHedgeIntent(intent)).record.amount, intent.amount);
  conflict = true;
  await assert.rejects(service.createHedgeIntent(intent), /intent conflict/);
});

test("PostgresHedgeService persists terminal state and durable failure pressure", async () => {
  const { pool, client } = fakePool(async (sql, params) => {
    if (sql.includes("FROM settlement_events AS settlement")) {
      return { rows: [{ id: intent.settlementEventId, canonical: true }], rowCount: 1 };
    }
    if (sql.includes("SELECT") && sql.includes("FOR UPDATE")) {
      return { rows: [hedgeRow()], rowCount: 1 };
    }
    if (sql.includes("UPDATE hedge_orders") && sql.includes("RETURNING")) {
      return {
        rows: [hedgeRow({
          id: params[0],
          status: params[1],
          external_order_id: params[2],
          filled_amount: params[1] === "filled" ? intent.amount : null,
          execution_evidence_version: params[1] === "filled" ? "base-only-v1" : null,
        })],
        rowCount: 1,
      };
    }
    if (sql.includes("INSERT INTO hedge_orders")) {
      return { rows: [hedgeRowFromParams(params, { status: "failed", last_error_code: "HEDGE_INTENT_FAILED" })], rowCount: 1 };
    }
    if (sql.includes("COUNT(*)")) return { rows: [{ failures: "3" }], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  });
  const service = new PostgresHedgeService(pool, {
    failurePenaltyBps: 25,
    maxFailurePenaltyBps: 60,
    failureLookbackMs: 300_000,
  });

  const filled = await service.markHedgeIntentFilled({ hedgeOrderId: hedgeRow().id, externalOrderId: "cex-1" });
  assert.equal(filled.updated, true);
  assert.equal(filled.record.status, "filled");
  assert.equal(filled.record.externalOrderId, "cex-1");
  assert.equal(filled.record.filledAmount, intent.amount);
  assert.equal(filled.record.executionEvidenceVersion, "base-only-v1");
  await service.recordHedgeFailure(intent, "HEDGE_INTENT_FAILED");
  assert.equal(await service.quoteRiskPenaltyBps({ chainId: 1, token: intent.token }), 60);
  assert.equal(client.queries.some(({ sql }) => sql.includes("ON CONFLICT (settlement_event_id)")), true);
  assert.equal(client.queries.some(({ sql }) => sql.includes("settlement.canonical = TRUE")), true);
  assert.equal(client.queries.some(({ sql }) => sql.includes("hedge.risk_failure_at >= now()")), true);
  assert.equal(client.queries.some(({ params }) => params[2] === 300_000), true);
  assert.equal(client.queries.some(({ sql }) => sql.includes("INSERT INTO inventory_positions")), true);
});

test("PostgresHedgeService preserves terminal transition and failure conflict rules", async () => {
  let existing = hedgeRow({ status: "filled", external_order_id: "cex-1", filled_amount: intent.amount });
  const { pool } = fakePool(async (sql) => {
    if (sql.includes("FROM settlement_events AS settlement")) {
      return { rows: [{ id: intent.settlementEventId, canonical: true }], rowCount: 1 };
    }
    if (sql.includes("UPDATE hedge_orders")) return { rows: [], rowCount: 0 };
    if (sql.includes("SELECT") && sql.includes("WHERE id")) return { rows: [existing], rowCount: 1 };
    if (sql.includes("INSERT INTO hedge_orders")) return { rows: [], rowCount: 0 };
    return { rows: [], rowCount: 0 };
  });
  const service = new PostgresHedgeService(pool);

  await assert.rejects(service.markHedgeIntentFailed(existing.id), /cannot transition from filled to failed/);
  await assert.rejects(
    service.markHedgeIntentFilled({ hedgeOrderId: existing.id, externalOrderId: "cex-2" }),
    /externalOrderId conflict/,
  );
  existing = hedgeRow({ status: "failed" });
  await assert.rejects(
    service.markHedgeIntentFilled({ hedgeOrderId: existing.id, externalOrderId: "cex-1" }),
    /cannot transition from failed to filled/,
  );
  await assert.rejects(service.recordHedgeFailure(intent, "HEDGE_INTENT_FAILED"), /failure conflict/);
});

test("PostgresHedgeService removes intents for reorg reconciliation", async () => {
  const { pool } = fakePool(async (sql) => {
    if (sql.includes("DELETE FROM hedge_orders")) return { rows: [hedgeRow()], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  const service = new PostgresHedgeService(pool);

  const removed = await service.removeHedgeIntentBySettlementEvent(intent.settlementEventId);
  assert.equal(removed.removed, true);
  assert.equal(removed.record.quoteId, intent.quoteId);
});

test("PostgresHedgeService preserves submission-attempted and terminal CEX evidence during reorg reconciliation", async () => {
  const filled = hedgeRow({
    venue: "binance",
    venue_symbol: "ETHUSDT",
    status: "filled",
    external_order_id: "rfq_11111111111111111111111111111111",
    filled_amount: intent.amount,
    execution_evidence_version: "base-and-quote-v2",
    executed_quote_quantity: "2500.500000000000000000",
  });
  const { pool } = fakePool(async (sql) => {
    if (sql.includes("DELETE FROM hedge_orders")) return { rows: [], rowCount: 0 };
    if (sql.includes("SELECT") && sql.includes("settlement_event_id")) return { rows: [filled], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  const service = new PostgresHedgeService(pool);

  const result = await service.removeHedgeIntentBySettlementEvent(intent.settlementEventId);
  assert.equal(result.removed, false);
  assert.equal(result.record.status, "filled");
  assert.equal(result.record.filledAmount, intent.amount);
  assert.equal(result.record.venue, "binance");
  assert.equal(result.record.venueSymbol, "ETHUSDT");
  assert.equal(result.record.executionEvidenceVersion, "base-and-quote-v2");
  assert.equal(result.record.executedQuoteQuantity, "2500.500000000000000000");
});

test("PostgresHedgeService exposes reconciled commission totals without cross-asset conversion", async () => {
  const completed = hedgeRow({
    venue: "binance",
    venue_symbol: "ETHUSDT",
    status: "filled",
    external_order_id: "rfq_11111111111111111111111111111111",
    venue_order_id: "100234",
    filled_amount: intent.amount,
    execution_evidence_version: "base-and-quote-v2",
    executed_quote_quantity: "2500.500000000000000000",
    fee_reconciliation_status: "complete",
    fee_reconciled_at: "2026-07-14T00:00:03.000Z",
    commission_totals: [
      { asset: "BNB", quantity: "0.000100000000000000000000000000000000" },
      { asset: "USDT", quantity: "1.250000000000000000000000000000000000" },
    ],
  });
  const { pool, client } = fakePool(async (sql) => {
    if (sql.includes("WHERE id = $1")) return { rows: [completed], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  const service = new PostgresHedgeService(pool);

  const result = await service.getHedgeIntent(completed.id);

  assert.equal(result.feeReconciliationStatus, "complete");
  assert.equal(result.venueOrderId, "100234");
  assert.deepEqual(result.commissionTotals, completed.commission_totals.map((total) => ({
    asset: total.asset,
    quantity: total.quantity,
  })));
  assert.match(client.queries[0].sql, /SUM\(commission_quantity\)/);
});

test("PostgresHedgeService rejects malformed dependencies and database rows", async () => {
  assert.throws(() => new PostgresHedgeService(null), /pool\.connect must be a function/);
  const { pool } = fakePool(async () => ({ rows: [hedgeRow({ amount: "0990" })], rowCount: 1 }));
  const service = new PostgresHedgeService(pool);
  await assert.rejects(service.getHedgeIntent(hedgeRow().id), /canonical positive uint string/);
});

function hedgeRow(overrides = {}) {
  return {
    id: "h_11111111111111111111111111111111",
    settlement_event_id: intent.settlementEventId,
    quote_id: intent.quoteId,
    chain_id: "1",
    token_address: intent.token,
    side: intent.side,
    amount: intent.amount,
    status: "queued",
    reason: intent.reason,
    external_order_id: null,
    filled_amount: null,
    venue: "internal",
    venue_symbol: null,
    venue_order_id: null,
    execution_evidence_version: null,
    executed_quote_quantity: null,
    fee_reconciliation_status: null,
    fee_last_error_code: null,
    fee_reconciled_at: null,
    last_error_code: null,
    created_at: "2026-07-11T00:00:00.000Z",
    updated_at: "2026-07-11T00:00:00.000Z",
    ...overrides,
  };
}

function hedgeRowFromParams(params, overrides = {}) {
  return hedgeRow({
    id: params[0],
    settlement_event_id: params[1],
    quote_id: params[2],
    chain_id: String(params[3]),
    token_address: params[4],
    side: params[5],
    amount: params[6],
    reason: params[7],
    ...overrides,
  });
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
