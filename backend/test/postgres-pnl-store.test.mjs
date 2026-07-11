import assert from "node:assert/strict";
import test from "node:test";
import { PostgresPnlStore } from "../dist/modules/pnl/postgres-pnl.store.js";

const input = {
  quoteId: "q_postgres_pnl",
  quote: {
    user: "0x0000000000000000000000000000000000000001",
    tokenIn: "0x0000000000000000000000000000000000000002",
    tokenOut: "0x0000000000000000000000000000000000000003",
    amountIn: "1000",
    amountOut: "990",
    minAmountOut: "980",
    nonce: "1",
    deadline: 4_102_444_800,
    chainId: 1,
  },
};

test("PostgresPnlStore persists and returns deterministic PnL attribution", async () => {
  const { pool, client } = fakePool(async (sql, params) => {
    if (sql.includes("INSERT INTO pnl_records")) return { rows: [pnlRowFromParams(params)], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  const store = new PostgresPnlStore(pool);

  const record = await store.recordSettlement(input);

  assert.equal(record.pnlId, `pnl_${input.quoteId}`);
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
  const store = new PostgresPnlStore(pool);

  assert.equal((await store.recordSettlement(input)).grossPnlTokenOut, "10");
  conflict = true;
  await assert.rejects(store.recordSettlement(input), /attribution is inconsistent|record conflict/);
});

test("PostgresPnlStore summarizes durable rows and removes reorged attribution", async () => {
  const rows = [pnlRow(), pnlRow({
    id: "pnl_q_second",
    quote_id: "q_second",
    nonce: "2",
    gross_pnl_token_out: "-5",
    gross_pnl_bps: "-50",
    amount_out: "1005",
    min_amount_out: "980",
  })];
  const { pool } = fakePool(async (sql) => {
    if (sql.startsWith("SELECT")) return { rows, rowCount: rows.length };
    if (sql.startsWith("DELETE")) return { rows: [rows[0]], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  const store = new PostgresPnlStore(pool);

  const summary = await store.summary();
  assert.equal(summary.totalTrades, 2);
  assert.equal(summary.grossPnlTokenOut, "5");
  const removed = await store.removePnlRecord({ quoteId: input.quoteId });
  assert.equal(removed.removed, true);
  assert.equal(removed.record.pnlId, pnlRow().id);
});

test("PostgresPnlStore rejects malformed dependencies and rows", async () => {
  assert.throws(() => new PostgresPnlStore(null), /pool\.connect must be a function/);
  const { pool } = fakePool(async () => ({ rows: [pnlRow({ amount_in: "01000" })], rowCount: 1 }));
  const store = new PostgresPnlStore(pool);
  await assert.rejects(store.summary(), /canonical positive uint string/);
});

function pnlRow(overrides = {}) {
  return {
    id: `pnl_${input.quoteId}`,
    quote_id: input.quoteId,
    chain_id: "1",
    user_address: input.quote.user,
    token_in: input.quote.tokenIn,
    token_out: input.quote.tokenOut,
    amount_in: input.quote.amountIn,
    amount_out: input.quote.amountOut,
    min_amount_out: input.quote.minAmountOut,
    nonce: input.quote.nonce,
    deadline: String(input.quote.deadline),
    gross_pnl_token_out: "10",
    gross_pnl_bps: "100",
    model: "simulated_mid_price_v1",
    model_description: "Simulated same-decimal quote attribution where grossPnlTokenOut equals amountIn minus amountOut and is not cross-token accounting PnL",
    realized_at: "2026-07-11T00:00:00.000Z",
    ...overrides,
  };
}

function pnlRowFromParams(params) {
  return pnlRow({
    id: params[0],
    quote_id: params[1],
    chain_id: String(params[2]),
    user_address: params[3],
    token_in: params[4],
    token_out: params[5],
    amount_in: params[6],
    amount_out: params[7],
    min_amount_out: params[8],
    nonce: params[9],
    deadline: String(params[10]),
    gross_pnl_token_out: params[11],
    gross_pnl_bps: String(params[12]),
    model: params[13],
    model_description: params[14],
    realized_at: params[15],
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
