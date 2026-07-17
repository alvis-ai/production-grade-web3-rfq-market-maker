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
const principalId = "institution_a";

test("PostgresQuoteRepository rejects requested quote rewrites when upsert conflict skips update", async () => {
  const { pool, client } = fakePool([
    { rowCount: 0, rows: [] },
    { rowCount: 1, rows: [quoteRow({ snapshot_id: "snapshot_1" })] },
  ]);
  const repository = new PostgresQuoteRepository(pool);

  await assert.rejects(
    repository.saveRequested({
      quoteId: "q_requested_payload",
      principalId,
      request,
      snapshotId: "snapshot_2",
    }),
    /Requested quote payload cannot be changed/,
  );

  assert.equal(client.released, true);
});

test("PostgresQuoteRepository records a route decision with one atomic update", async () => {
  const fixture = fakePool([{ rowCount: 1, rows: [] }]);
  const repository = new PostgresQuoteRepository(fixture.pool);

  await repository.saveRouteDecision(routeDecisionInput());

  assert.equal(fixture.connectCount, 1);
  assert.equal(fixture.client.released, true);
  assert.match(fixture.client.queries[0].sql, /route_decided_at = now\(\)/);
  assert.match(fixture.client.queries[0].sql, /AND status = 'requested'/);
  assert.match(fixture.client.queries[0].sql, /AND route_id IS NULL/);
  assert.deepEqual(fixture.client.queries[0].params, [
    "q_1",
    principalId,
    "snapshot_1",
    routeDecisionInput().routePlan.routeId,
    "internal_inventory",
    "1000000",
    request.tokenIn,
    request.tokenOut,
  ]);
});

test("PostgresQuoteRepository rejects route decision rewrites after a concurrent write", async () => {
  const fixture = fakePool([
    { rowCount: 0, rows: [] },
    {
      rowCount: 1,
      rows: [quoteRow({
        route_id: routeDecisionInput().routePlan.routeId,
        route_venue: "internal_inventory",
        route_expected_liquidity_usd: "2000000",
        route_decided_at: "2026-07-16T00:00:00.000Z",
      })],
    },
  ]);
  const repository = new PostgresQuoteRepository(fixture.pool);

  await assert.rejects(
    repository.saveRouteDecision(routeDecisionInput()),
    /Route decision cannot be changed/,
  );
  assert.equal(fixture.connectCount, 1);
  assert.equal(fixture.client.queries.length, 2);
});

test("PostgresQuoteRepository rejects inherited and extended route decision envelopes before SQL", async () => {
  const fixture = fakePool([]);
  const repository = new PostgresQuoteRepository(fixture.pool);

  await assert.rejects(
    repository.saveRouteDecision({
      ...routeDecisionInput(),
      routePlan: Object.create(routeDecisionInput().routePlan),
    }),
    /Route decision routePlan.routeId must be an own field/,
  );
  await assert.rejects(
    repository.saveRouteDecision({
      ...routeDecisionInput(),
      routePlan: { ...routeDecisionInput().routePlan, fallbackVenue: "external" },
    }),
    /Route decision routePlan contains unknown field fallbackVenue/,
  );
  assert.equal(fixture.connectCount, 0);
});

test("PostgresQuoteRepository rejects extended persistence envelopes before SQL", async () => {
  const fixture = fakePool([]);
  const repository = new PostgresQuoteRepository(fixture.pool);

  await assert.rejects(
    repository.saveRequested({
      quoteId: "q_1",
      principalId,
      request,
      snapshotId: "snapshot_1",
      auditContext: "unexpected",
    }),
    /Requested quote input contains unknown field auditContext/,
  );
  await assert.rejects(
    repository.saveRejected({
      quoteId: "q_1",
      principalId,
      request: { ...request, source: "unexpected" },
      snapshotId: "snapshot_1",
      rejectCode: "RISK_REJECTED",
    }),
    /Rejected quote request contains unknown field source/,
  );
  await assert.rejects(
    repository.saveSigned({
      ...signedInput(),
      quote: { ...signedInput().quote, routingHint: "unexpected" },
    }),
    /Signed quote quote contains unknown field routingHint/,
  );
  assert.equal(fixture.connectCount, 0);
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
      principalId,
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

test("PostgresQuoteRepository rejects malformed status metadata before SQL", async () => {
  const fixture = fakePool([]);
  const repository = new PostgresQuoteRepository(fixture.pool);

  await assert.rejects(
    repository.markStatus("q_1", "submitted", {
      txHash: "0x1234",
      settlementEventId: "se_1",
    }),
    /Quote status txHash must be a 32-byte hex string/,
  );
  assert.equal(fixture.connectCount, 0);
});

test("PostgresQuoteRepository rejects requested status bypasses", async () => {
  const fixture = fakePool([
    { rowCount: 1, rows: [quoteRow()] },
  ]);
  const repository = new PostgresQuoteRepository(fixture.pool);

  await assert.rejects(
    repository.markStatus("q_1", "submitted", {
      txHash: `0x${"aa".repeat(32)}`,
      settlementEventId: "se_1",
    }),
    /cannot transition from requested to submitted through markStatus/,
  );
  assert.equal(fixture.client.queries.length, 1);
  assert.equal(fixture.client.released, true);
});

test("PostgresQuoteRepository updates status with state and pointer CAS", async () => {
  const fixture = fakePool([
    { rowCount: 1, rows: [signedQuoteRow()] },
    { rowCount: 1, rows: [] },
  ]);
  const repository = new PostgresQuoteRepository(fixture.pool);
  const txHash = `0x${"aa".repeat(32)}`;

  await repository.markStatus("q_1", "submitted", {
    txHash,
    settlementEventId: "se_1",
  });

  assert.match(fixture.client.queries[1].sql, /AND status = \$5/);
  assert.match(fixture.client.queries[1].sql, /tx_hash IS NOT DISTINCT FROM \$6/);
  assert.match(fixture.client.queries[1].sql, /pnl_id IS NOT DISTINCT FROM \$9/);
  assert.deepEqual(fixture.client.queries[1].params, [
    "q_1",
    "submitted",
    txHash,
    "se_1",
    "signed",
    null,
    null,
    null,
    null,
  ]);
});

test("PostgresQuoteRepository surfaces concurrent status update conflicts", async () => {
  const fixture = fakePool([
    { rowCount: 1, rows: [signedQuoteRow()] },
    { rowCount: 0, rows: [] },
  ]);
  const repository = new PostgresQuoteRepository(fixture.pool);

  await assert.rejects(
    repository.markStatus("q_1", "submitted", {
      txHash: `0x${"aa".repeat(32)}`,
      settlementEventId: "se_1",
    }),
    /Quote q_1 status update conflict/,
  );
});

test("PostgresQuoteRepository marks failures with one conditional update", async () => {
  const fixture = fakePool([{ rowCount: 1, rows: [] }]);
  const repository = new PostgresQuoteRepository(fixture.pool);

  await repository.markFailed("q_1", "SIGNER_UNAVAILABLE");

  assert.equal(fixture.client.queries.length, 1);
  assert.match(fixture.client.queries[0].sql, /status IN \('requested', 'signed'\)/);
  assert.deepEqual(fixture.client.queries[0].params, ["q_1", "SIGNER_UNAVAILABLE"]);
});

test("PostgresQuoteRepository rejects failure regressions after a conditional write miss", async () => {
  const fixture = fakePool([
    { rowCount: 0, rows: [] },
    { rowCount: 1, rows: [signedQuoteRow({ status: "settled" })] },
  ]);
  const repository = new PostgresQuoteRepository(fixture.pool);

  await assert.rejects(
    repository.markFailed("q_1", "SIGNER_UNAVAILABLE"),
    /cannot transition from settled to failed/,
  );
  assert.equal(fixture.client.queries.length, 2);
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
    principal_id: principalId,
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
    route_id: null,
    route_venue: null,
    route_expected_liquidity_usd: null,
    route_decided_at: null,
    pricing_version: null,
    spread_bps: null,
    size_impact_bps: null,
    market_spread_bps: null,
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

function routeDecisionInput() {
  return {
    quoteId: "q_1",
    principalId,
    snapshotId: "snapshot_1",
    routePlan: {
      routeId: "route_1_0000000000000000000000000000000000000002_0000000000000000000000000000000000000003",
      venue: "internal_inventory",
      tokenIn: request.tokenIn,
      tokenOut: request.tokenOut,
      expectedLiquidityUsd: "1000000",
    },
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
    market_spread_bps: 0,
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
    principalId,
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
    marketSpreadBps: 0,
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
