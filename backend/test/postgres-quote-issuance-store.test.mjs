import assert from "node:assert/strict";
import test from "node:test";
import { PostgresQuoteIssuanceStore } from "../dist/modules/quote/postgres-quote-issuance.store.js";

const now = "2026-07-18T00:00:00.000Z";
const tokenIn = "0x0000000000000000000000000000000000000011";
const tokenOut = "0x0000000000000000000000000000000000000022";
const user = "0x0000000000000000000000000000000000000033";
const quoteId = "q_fused_issuance";
const snapshotId = "snapshot_fused_issuance";
const principalId = "principal_fused_issuance";

test("PostgresQuoteIssuanceStore prepares, authorizes, and finalizes in one query each", async () => {
  const queries = [];
  const pool = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.includes("risk_write")) {
        return {
          rows: [{
            risk_decision_id: `rd_${quoteId}`,
            quote_id: quoteId,
            decision: "approved",
            reason_code: null,
            policy_version: "risk-v1",
            created_at: new Date(now),
          }],
        };
      }
      return { rows: [{ quote_id: quoteId }] };
    },
  };
  const store = new PostgresQuoteIssuanceStore(pool);
  const preparation = prepareInput();
  await store.prepare(preparation);
  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /WITH snapshot_write AS/);
  assert.match(queries[0].sql, /quote_write AS/);
  assert.match(queries[0].sql, /idempotency_write AS/);
  assert.equal(queries[0].params.length, 21);

  const decision = await store.authorize(riskDecisionInput());
  assert.equal(decision.riskDecisionId, `rd_${quoteId}`);
  assert.equal(queries.length, 2);
  assert.match(queries[1].sql, /WITH quote_write AS/);
  assert.match(queries[1].sql, /risk_write AS/);
  assert.doesNotMatch(queries[1].sql, /snapshot_write/);
  assert.equal(queries[1].params.length, 7);

  await store.finalize(finalizeInput());
  assert.equal(queries.length, 3);
  assert.match(queries[2].sql, /WITH quote_write AS/);
  assert.match(queries[2].sql, /idempotency_write AS/);
  assert.match(queries[2].sql, /state = 'succeeded'/);
  assert.equal(queries[2].params.length, 26);
});

test("PostgresQuoteIssuanceStore rejects cross-quote bundles before querying Postgres", async () => {
  let queries = 0;
  const store = new PostgresQuoteIssuanceStore({
    async query() {
      queries += 1;
      throw new Error("must not query");
    },
  });
  const invalidPreparation = prepareInput();
  invalidPreparation.routeDecision = {
    ...invalidPreparation.routeDecision,
    quoteId: "q_other",
  };
  await assert.rejects(store.prepare(invalidPreparation), /must describe one quote/);

  const invalidFinalization = finalizeInput();
  invalidFinalization.response = {
    ...invalidFinalization.response,
    nonce: "999",
  };
  await assert.rejects(store.finalize(invalidFinalization), /must match signed quote/);
  assert.equal(queries, 0);
});

function prepareInput() {
  const request = {
    chainId: 1,
    user,
    tokenIn,
    tokenOut,
    amountIn: "1000000000000000000",
    slippageBps: 50,
  };
  return {
    marketSnapshot: {
      request,
      snapshot: {
        snapshotId,
        midPrice: "1.0",
        liquidityUsd: "10000000",
        marketSpreadBps: 10,
        volatilityBps: 20,
        observedAt: now,
      },
      source: "fused-test-v1",
    },
    requestedQuote: { quoteId, principalId, request, snapshotId },
    routeDecision: {
      quoteId,
      principalId,
      snapshotId,
      routePlan: {
        routeId: "route_fused",
        venue: "internal_inventory",
        tokenIn,
        tokenOut,
        expectedLiquidityUsd: "10000000",
      },
    },
    idempotency: {
      principalId,
      key: "fused-idempotency-key-0001",
      requestHash: "a".repeat(64),
      ownerToken: "owner_fused_issuance",
      expiresAt: "2026-07-18T00:01:00.000Z",
    },
  };
}

function riskDecisionInput() {
  return {
    quoteId,
    decision: { status: "approved", policyVersion: "risk-v1" },
  };
}

function finalizeInput() {
  const quote = {
    user,
    tokenIn,
    tokenOut,
    amountIn: "1000000000000000000",
    amountOut: "999000000000000000",
    minAmountOut: "990000000000000000",
    nonce: "123456789",
    deadline: 1_900_000_000,
    chainId: 1,
  };
  const signature = `0x${"11".repeat(64)}1b`;
  const response = {
    quoteId,
    snapshotId,
    amountOut: quote.amountOut,
    minAmountOut: quote.minAmountOut,
    deadline: quote.deadline,
    nonce: quote.nonce,
    signature,
  };
  return {
    signedQuote: {
      quoteId,
      principalId,
      snapshotId,
      slippageBps: 50,
      quote,
      pricingVersion: "pricing-v1",
      spreadBps: 10,
      sizeImpactBps: 1,
      marketSpreadBps: 5,
      inventorySkewBps: -2,
      volatilityPremiumBps: 3,
      hedgeCostBps: 4,
      riskPolicyVersion: "risk-v1",
      signature,
    },
    response,
    idempotency: prepareInput().idempotency,
  };
}
