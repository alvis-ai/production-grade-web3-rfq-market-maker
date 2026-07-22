import assert from "node:assert/strict";
import test from "node:test";
import { RedisQuoteIssuanceStore } from "../dist/modules/quote/redis-quote-issuance.store.js";
import {
  admitQuoteIssuanceScript,
  authorizeQuoteIssuanceScript,
  finalizeQuoteIssuanceScript,
  initializeQuoteIssuanceLedgerScript,
  prepareQuoteIssuanceScript,
} from "../dist/modules/quote/redis-quote-issuance.scripts.js";

const quoteId = "q_minimal_evidence";
const principalId = "principal_minimal_evidence";
const snapshotId = "snapshot_minimal_evidence";
const tokenIn = "0x0000000000000000000000000000000000000011";
const tokenOut = "0x0000000000000000000000000000000000000022";
const request = {
  chainId: 1,
  user: "0x0000000000000000000000000000000000000033",
  tokenIn,
  tokenOut,
  amountIn: "1000000000000000000",
  slippageBps: 50,
};

test("RedisQuoteIssuanceStore rejects conflicting compact preparation evidence", async () => {
  const store = buildStore((script) => {
    if (script === prepareQuoteIssuanceScript) return [1, "f".repeat(64), 1, "1-0"];
    throw new Error("unexpected script");
  });
  await store.initialize();

  await assert.rejects(store.prepare(preparation()), /conflicting evidence/);
});

test("RedisQuoteIssuanceStore rejects malformed compact authorization evidence", async () => {
  const store = buildStore((script) => {
    if (script === authorizeQuoteIssuanceScript) return [1, "not-json", 2, "2-0"];
    throw new Error("unexpected script");
  });
  await store.initialize();

  await assert.rejects(store.authorize({
    quoteId,
    decision: { status: "approved", policyVersion: "risk-v1" },
  }), /malformed evidence/);
});

test("RedisQuoteIssuanceStore rejects malformed compact admission evidence", async () => {
  const store = buildStore((script) => {
    if (script === admitQuoteIssuanceScript) return [1, "not-json", 1, "1-0"];
    throw new Error("unexpected script");
  });
  await store.initialize();

  await assert.rejects(store.admit({
    preparation: preparation(),
    authorization: {
      quoteId,
      decision: { status: "approved", policyVersion: "risk-v1" },
    },
  }), /malformed evidence/);
});

test("RedisQuoteIssuanceStore rejects conflicting compact authorization evidence", async () => {
  const store = buildStore((script) => {
    if (script === authorizeQuoteIssuanceScript) {
      return [1, JSON.stringify({
        riskDecisionId: "rd_q_other",
        quoteId: "q_other",
        decision: "approved",
        policyVersion: "risk-v1",
        createdAt: "2026-07-19T00:00:00.000Z",
      }), 2, "2-0"];
    }
    throw new Error("unexpected script");
  });
  await store.initialize();

  await assert.rejects(store.authorize({
    quoteId,
    decision: { status: "approved", policyVersion: "risk-v1" },
  }), /does not match the persisted decision/);
});

test("RedisQuoteIssuanceStore rejects conflicting compact finalization evidence", async () => {
  const store = buildStore((script) => {
    if (script === finalizeQuoteIssuanceScript) return [1, "0".repeat(64), 3, "3-0"];
    throw new Error("unexpected script");
  });
  await store.initialize();

  await assert.rejects(store.finalize(finalization()), /conflicting evidence/);
});

function buildStore(mutation) {
  return new RedisQuoteIssuanceStore({
    status: "ready",
    async eval(script) {
      if (script === initializeQuoteIssuanceLedgerScript) return [1, "test_v1"];
      return mutation(script);
    },
    async get() { return null; },
    async ping() { return "PONG"; },
    async info() { return "aof_enabled:1\naof_last_write_status:ok\n"; },
    async xlen() { return 0; },
    async wait() { return 1; },
    async quit() {},
  }, {
    keyPrefix: "rfq:{issuance-test}:ledger",
    ledgerEpoch: "test_v1",
    allowEpochInitialization: true,
    maxBacklog: 100,
    leaseMs: 60_000,
    hotStateTtlMs: 60_000,
    idempotencyTtlMs: 60_000,
    minReplicaAcks: 0,
    replicaAckTimeoutMs: 10,
    requireAof: false,
    projectionWaitTimeoutMs: 100,
    projectionPollIntervalMs: 5,
  });
}

function preparation() {
  return {
    marketSnapshot: {
      request,
      snapshot: {
        snapshotId,
        midPrice: "1.000000000000000000",
        liquidityUsd: "10000000",
        marketSpreadBps: 10,
        volatilityBps: 20,
        observedAt: new Date().toISOString(),
      },
      source: "minimal-evidence-test",
    },
    requestedQuote: { quoteId, principalId, snapshotId, request },
    routeDecision: {
      quoteId,
      principalId,
      snapshotId,
      routePlan: {
        routeId: "route_minimal_evidence",
        venue: "internal_inventory",
        tokenIn,
        tokenOut,
        expectedLiquidityUsd: "10000000",
      },
    },
  };
}

function finalization() {
  const user = request.user;
  const quote = {
    user,
    tokenIn,
    tokenOut,
    amountIn: request.amountIn,
    amountOut: "999000000000000000",
    minAmountOut: "990000000000000000",
    nonce: "123456789",
    deadline: 1_900_000_000,
    chainId: request.chainId,
  };
  const signature = `0x${"11".repeat(64)}1b`;
  return {
    signedQuote: {
      quoteId,
      principalId,
      snapshotId,
      slippageBps: request.slippageBps,
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
    response: {
      quoteId,
      snapshotId,
      amountOut: quote.amountOut,
      minAmountOut: quote.minAmountOut,
      deadline: quote.deadline,
      nonce: quote.nonce,
      signature,
    },
  };
}
