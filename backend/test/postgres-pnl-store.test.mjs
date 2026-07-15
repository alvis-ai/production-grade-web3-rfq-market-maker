import assert from "node:assert/strict";
import test from "node:test";
import { PostgresPnlStore } from "../dist/modules/pnl/postgres-pnl.store.js";
import {
  createTestPnlValuationProvider,
  pnlInput,
  quoteSnapshotPnlModelDescription,
} from "./helpers/pnl-fixtures.mjs";

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
const input = pnlInput("q_postgres_pnl", quote);
const valuationProvider = createTestPnlValuationProvider();

test("PostgresPnlStore persists deterministic quote-snapshot PnL attribution", async () => {
  const { pool, client } = fakePool(async (sql, params) => {
    if (sql.includes("INSERT INTO pnl_records")) return { rows: [pnlRowFromParams(params)], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  const store = new PostgresPnlStore(pool, valuationProvider);

  const record = await store.recordSettlement(input);

  assert.equal(record.pnlId, `pnl_${input.quoteId}`);
  assert.equal(record.settlementEventId, input.settlementEventId);
  assert.equal(record.snapshotId, input.snapshotId);
  assert.equal(record.fairAmountOut, "1000");
  assert.equal(record.grossPnlTokenOut, "10");
  assert.equal(record.grossPnlBps, 100);
  assert.equal(client.released, true);
});

test("PostgresPnlStore returns matching idempotent records and rejects conflicts", async () => {
  let conflict = false;
  const { pool } = fakePool(async (sql) => {
    if (sql.includes("INSERT INTO pnl_records")) return { rows: [], rowCount: 0 };
    if (sql.includes("FROM pnl_records")) {
      return { rows: [pnlRow({ gross_pnl_token_out: conflict ? "11" : "10" })], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
  const store = new PostgresPnlStore(pool, valuationProvider);

  assert.equal((await store.recordSettlement(input)).grossPnlTokenOut, "10");
  conflict = true;
  await assert.rejects(store.recordSettlement(input), /attribution is inconsistent|record conflict/);
});

test("PostgresPnlStore summarizes durable rows by output token and removes reorged attribution", async () => {
  const rows = [pnlRow(), pnlRow({
    id: "pnl_q_second",
    quote_id: "q_second",
    settlement_event_id: "se_q_second",
    snapshot_id: "snapshot_q_second",
    nonce: "2",
    gross_pnl_token_out: "-5",
    gross_pnl_bps: "-50",
    amount_out: "1005",
    min_amount_out: "980",
  })];
  const { pool } = fakePool(async (sql) => {
    if (sql.includes("WHERE quote_id = $1 AND model = $2")) return { rows: [rows[0]], rowCount: 1 };
    if (sql.startsWith("SELECT")) return { rows, rowCount: rows.length };
    if (sql.startsWith("DELETE")) return { rows: [rows[0]], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  const store = new PostgresPnlStore(pool, valuationProvider);

  const found = await store.getPnlRecordByQuoteId(input.quoteId);
  assert.equal(found.pnlId, pnlRow().id);
  const summary = await store.summary();
  assert.equal(summary.totalTrades, 2);
  assert.deepEqual(summary.totals, [{
    chainId: 1,
    tokenOut: quote.tokenOut,
    totalTrades: 2,
    grossPnlTokenOut: "5",
  }]);
  const removed = await store.removePnlRecord({ quoteId: input.quoteId });
  assert.equal(removed.removed, true);
  assert.equal(removed.record.pnlId, pnlRow().id);
});

test("PostgresPnlStore scopes summary rows by quote principal", async () => {
  const { pool, client } = fakePool(async () => ({ rows: [pnlRow()], rowCount: 1 }));
  const store = new PostgresPnlStore(pool, valuationProvider);

  const summary = await store.summary("institution_a");

  assert.equal(summary.totalTrades, 1);
  assert.match(client.queries[0].sql, /JOIN quotes quote ON quote\.id = pnl\.quote_id/);
  assert.match(client.queries[0].sql, /WHERE quote\.principal_id = \$1/);
  assert.deepEqual(client.queries[0].params, ["institution_a"]);
});

test("PostgresPnlStore aggregates completed hedge-fill net PnL without treating unavailable rows as zero", async () => {
  const complete = pnlRow({
    hedge_order_id: "h_q_postgres_pnl",
    hedge_status: "filled",
    hedge_filled_amount: "1000",
    hedge_fee_reconciliation_status: "complete",
    hedge_route_accounting_version: "venue-assets-v1",
    hedge_valuation_asset: "USDT",
    hedge_valuation_token: quote.tokenOut,
    hedge_net_model: "hedge_fill_net_v1",
    hedge_net_model_description:
      "Net hedge execution PnL in the route quote asset using exact fills, quote/base commissions, and conservatively marked sub-step residual; third-asset commissions are unavailable",
    hedge_net_status: "complete",
    hedge_net_quantity: "2.650000000000000000",
    hedge_net_reason_code: null,
    hedge_unvalued_commission_assets: null,
    hedge_net_realized_at: new Date("2026-07-11T00:01:00.000Z"),
  });
  const unavailable = pnlRow({
    id: "pnl_q_legacy",
    quote_id: "q_legacy",
    settlement_event_id: "se_q_legacy",
    snapshot_id: "snapshot_q_legacy",
    nonce: "2",
    hedge_order_id: "h_q_legacy",
    hedge_route_accounting_version: null,
  });
  const partial = pnlRow({
    id: "pnl_q_partial",
    quote_id: "q_partial",
    settlement_event_id: "se_q_partial",
    snapshot_id: "snapshot_q_partial",
    nonce: "3",
    hedge_order_id: "h_q_partial",
    hedge_status: "failed",
    hedge_filled_amount: "500",
    hedge_fee_reconciliation_status: "complete",
    hedge_route_accounting_version: "venue-assets-v1",
    hedge_valuation_asset: "USDT",
    hedge_valuation_token: quote.tokenOut,
    hedge_net_model: "hedge_fill_net_v1",
    hedge_net_model_description:
      "Net hedge execution PnL in the route quote asset using exact fills, quote/base commissions, and conservatively marked sub-step residual; third-asset commissions are unavailable",
    hedge_net_status: "unavailable",
    hedge_net_quantity: null,
    hedge_net_reason_code: "PARTIAL_HEDGE_UNCLOSED",
    hedge_unvalued_commission_assets: [],
    hedge_net_realized_at: new Date("2026-07-11T00:02:00.000Z"),
  });
  const { pool } = fakePool(async () => ({ rows: [complete, unavailable, partial], rowCount: 3 }));

  const summary = await new PostgresPnlStore(pool, valuationProvider).summary();

  assert.equal(summary.hedgeNet.completeTrades, 1);
  assert.equal(summary.hedgeNet.unavailableTrades, 2);
  assert.equal(summary.hedgeNet.pendingTrades, 0);
  assert.deepEqual(summary.hedgeNet.totals, [{
    chainId: 1,
    valuationToken: quote.tokenOut,
    valuationAsset: "USDT",
    totalTrades: 1,
    netPnlQuoteQuantity: "2.65",
  }]);
  assert.equal(
    summary.hedgeNet.records.find(({ quoteId }) => quoteId === "q_legacy").reasonCode,
    "LEGACY_ROUTE_ACCOUNTING_UNAVAILABLE",
  );
  assert.equal(
    summary.hedgeNet.records.find(({ quoteId }) => quoteId === "q_partial").reasonCode,
    "PARTIAL_HEDGE_UNCLOSED",
  );
});

test("PostgresPnlStore rejects malformed dependencies and rows", async () => {
  assert.throws(() => new PostgresPnlStore(null, valuationProvider), /pool\.connect must be a function/);
  const { pool } = fakePool(async () => ({ rows: [pnlRow({ amount_in: "01000" })], rowCount: 1 }));
  const store = new PostgresPnlStore(pool, valuationProvider);
  await assert.rejects(store.summary(), /canonical positive uint string/);
});

function pnlRow(overrides = {}) {
  return {
    id: `pnl_${input.quoteId}`,
    quote_id: input.quoteId,
    settlement_event_id: input.settlementEventId,
    snapshot_id: input.snapshotId,
    chain_id: "1",
    user_address: quote.user,
    token_in: quote.tokenIn,
    token_out: quote.tokenOut,
    amount_in: quote.amountIn,
    amount_out: quote.amountOut,
    min_amount_out: quote.minAmountOut,
    nonce: quote.nonce,
    deadline: String(quote.deadline),
    mid_price: "1",
    token_in_decimals: "18",
    token_out_decimals: "18",
    fair_amount_out: "1000",
    valuation_observed_at: "2026-07-11T00:00:00.000Z",
    gross_pnl_token_out: "10",
    gross_pnl_bps: "100",
    model: "quote_snapshot_edge_v1",
    model_description: quoteSnapshotPnlModelDescription,
    realized_at: input.realizedAt,
    ...overrides,
  };
}

function pnlRowFromParams(params) {
  return pnlRow({
    id: params[0],
    quote_id: params[1],
    settlement_event_id: params[2],
    snapshot_id: params[3],
    chain_id: String(params[4]),
    user_address: params[5],
    token_in: params[6],
    token_out: params[7],
    amount_in: params[8],
    amount_out: params[9],
    min_amount_out: params[10],
    nonce: params[11],
    deadline: String(params[12]),
    mid_price: params[13],
    token_in_decimals: String(params[14]),
    token_out_decimals: String(params[15]),
    fair_amount_out: params[16],
    valuation_observed_at: params[17],
    gross_pnl_token_out: params[18],
    gross_pnl_bps: String(params[19]),
    model: params[20],
    model_description: params[21],
    realized_at: params[22],
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
