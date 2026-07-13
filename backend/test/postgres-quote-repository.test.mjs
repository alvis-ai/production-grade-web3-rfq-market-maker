import assert from "node:assert/strict";
import test from "node:test";
import { PostgresQuoteRepository } from "../dist/modules/quote/postgres-quote.repository.js";

const request = {
  chainId: 1,
  user: "0x0000000000000000000000000000000000000001",
  tokenIn: "0x0000000000000000000000000000000000000002",
  tokenOut: "0x0000000000000000000000000000000000000003",
  amountIn: "1000000000",
  slippageBps: 50,
};

test("PostgresQuoteRepository rejects requested quote rewrites when upsert conflict skips update", async () => {
  const { pool, client } = fakePool([
    { rowCount: 0, rows: [] },
    { rowCount: 1, rows: [quoteRow({ snapshot_id: "snapshot_1" })] },
  ]);
  const repository = new PostgresQuoteRepository(pool);

  await assert.rejects(
    repository.saveRequested({
      quoteId: "q_requested_payload",
      request,
      snapshotId: "snapshot_2",
    }),
    /Requested quote payload cannot be changed/,
  );

  assert.equal(client.released, true);
});

test("PostgresQuoteRepository rejects rejected quote payload rewrites", async () => {
  const { pool } = fakePool([
    {
      rowCount: 1,
      rows: [
        quoteRow({
          status: "rejected",
          reject_code: "RISK_REJECTED",
          risk_policy_version: "risk-v1",
        }),
      ],
    },
  ]);
  const repository = new PostgresQuoteRepository(pool);

  await assert.rejects(
    repository.saveRejected({
      quoteId: "q_1",
      request,
      snapshotId: "snapshot_1",
      rejectCode: "DIFFERENT_REJECT",
      riskPolicyVersion: "risk-v1",
    }),
    /Rejected quote payload cannot be changed/,
  );
});

test("PostgresQuoteRepository rejects signed quote payload rewrites", async () => {
  const { pool } = fakePool([
    { rowCount: 1, rows: [signedQuoteRow()] },
    { rowCount: 0, rows: [] },
  ]);
  const repository = new PostgresQuoteRepository(pool);

  await assert.rejects(
    repository.saveSigned({
      ...signedInput(),
      quote: {
        ...signedInput().quote,
        amountOut: "999",
      },
    }),
    /Signed quote payload cannot be changed/,
  );
});

test("PostgresQuoteRepository restores canonical settlement with one pooled connection", async () => {
  const fixture = fakePool([
    { rowCount: 1, rows: [signedQuoteRow()] },
    { rowCount: 1, rows: [] },
  ]);
  const repository = new PostgresQuoteRepository(fixture.pool);

  await repository.restoreSettlementStatus("q_1", {
    txHash: `0x${"aa".repeat(32)}`,
    settlementEventId: "se_restore",
  });

  assert.equal(fixture.connectCount, 1);
  assert.equal(fixture.client.released, true);
  assert.match(fixture.client.queries[1].sql, /WHERE id = \$1\s+AND status = \$4/);
  assert.deepEqual(fixture.client.queries[1].params, [
    "q_1",
    `0x${"aa".repeat(32)}`,
    "se_restore",
    "signed",
    null,
    null,
    null,
    null,
  ]);
});

test("PostgresQuoteRepository clears matching settlement pointers atomically", async () => {
  const fixture = fakePool([
    {
      rowCount: 1,
      rows: [signedQuoteRow({
        status: "signed",
        tx_hash: null,
        settlement_event_id: null,
        hedge_order_id: null,
        pnl_id: null,
      })],
    },
  ]);
  const repository = new PostgresQuoteRepository(fixture.pool);

  const result = await repository.clearSettlementStatus({
    quoteId: "q_1",
    txHash: `0x${"aa".repeat(32)}`,
    settlementEventId: "se_old",
    nowSeconds: 1_900_000_000,
  });

  assert.equal(fixture.connectCount, 1);
  assert.equal(result.cleared, true);
  assert.equal(result.status.status, "signed");
  assert.match(fixture.client.queries[0].sql, /status IN \('submitted', 'settled'\)/);
  assert.match(fixture.client.queries[0].sql, /lower\(tx_hash\) = \$2/);
  assert.deepEqual(fixture.client.queries[0].params, [
    "q_1",
    `0x${"aa".repeat(32)}`,
    "se_old",
    1_900_000_000,
  ]);
});

test("PostgresQuoteRepository does not clear a replacement settlement after a stale update", async () => {
  const fixture = fakePool([
    { rowCount: 0, rows: [] },
    {
      rowCount: 1,
      rows: [signedQuoteRow({
        status: "settled",
        tx_hash: `0x${"bb".repeat(32)}`,
        settlement_event_id: "se_replacement",
      })],
    },
  ]);
  const repository = new PostgresQuoteRepository(fixture.pool);

  await assert.rejects(
    repository.clearSettlementStatus({
      quoteId: "q_1",
      txHash: `0x${"aa".repeat(32)}`,
      settlementEventId: "se_old",
      nowSeconds: 1_900_000_000,
    }),
    /settlement status removal conflict/,
  );

  assert.equal(fixture.connectCount, 1);
  assert.equal(fixture.client.queries.length, 2);
});

function fakePool(results) {
  const remaining = [...results];
  let connectCount = 0;
  const client = {
    queries: [],
    released: false,
    async query(sql, params) {
      this.queries.push({ sql, params });
      if (remaining.length === 0) {
        throw new Error(`Unexpected query: ${sql}`);
      }

      const next = remaining.shift();
      return typeof next === "function" ? next(sql, params) : next;
    },
    release() {
      this.released = true;
    },
  };

  return {
    client,
    get connectCount() {
      return connectCount;
    },
    pool: {
      async connect() {
        connectCount += 1;
        return client;
      },
    },
  };
}

function quoteRow(overrides = {}) {
  return {
    quote_id: "q_1",
    chain_id: request.chainId,
    user: request.user,
    token_in: request.tokenIn,
    token_out: request.tokenOut,
    amount_in: request.amountIn,
    slippage_bps: request.slippageBps,
    amount_out: null,
    min_amount_out: null,
    nonce: null,
    deadline: null,
    snapshot_id: "snapshot_1",
    pricing_version: null,
    spread_bps: null,
    size_impact_bps: null,
    inventory_skew_bps: null,
    volatility_premium_bps: null,
    hedge_cost_bps: null,
    risk_policy_version: null,
    status: "requested",
    signature: null,
    reject_code: null,
    tx_hash: null,
    settlement_event_id: null,
    hedge_order_id: null,
    pnl_id: null,
    ...overrides,
  };
}

function signedQuoteRow(overrides = {}) {
  return quoteRow({
    status: "signed",
    amount_out: "998",
    min_amount_out: "990",
    nonce: "42",
    deadline: 4_102_444_800,
    pricing_version: "test-pricing",
    spread_bps: 8,
    size_impact_bps: 1,
    inventory_skew_bps: 0,
    volatility_premium_bps: 0,
    hedge_cost_bps: 0,
    risk_policy_version: "test-risk",
    signature: fixedSignature(),
    ...overrides,
  });
}

function signedInput() {
  return {
    quoteId: "q_1",
    snapshotId: "snapshot_1",
    slippageBps: request.slippageBps,
    quote: {
      user: request.user,
      tokenIn: request.tokenIn,
      tokenOut: request.tokenOut,
      amountIn: request.amountIn,
      amountOut: "998",
      minAmountOut: "990",
      nonce: "42",
      deadline: 4_102_444_800,
      chainId: request.chainId,
    },
    pricingVersion: "test-pricing",
    spreadBps: 8,
    sizeImpactBps: 1,
    inventorySkewBps: 0,
    volatilityPremiumBps: 0,
    hedgeCostBps: 0,
    riskPolicyVersion: "test-risk",
    signature: fixedSignature(),
  };
}

function fixedSignature() {
  return `0x${"11".repeat(64)}1b`;
}
