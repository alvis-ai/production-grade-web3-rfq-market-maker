import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { ConfiguredTokenRegistry } from "../backend/dist/modules/pricing/token-registry.js";
import { RedisQuoteAdmissionStore } from "../backend/dist/modules/quote/redis-quote-admission.store.js";
import {
  createRedisQuoteIssuanceClient,
  RedisQuoteIssuanceStore,
} from "../backend/dist/modules/quote/redis-quote-issuance.store.js";
import {
  createRedisQuoteExposureClient,
  RedisQuoteExposureStore,
} from "../backend/dist/modules/risk/redis-quote-exposure.store.js";

const redisUrl = process.env.RFQ_QUOTE_ISSUANCE_REDIS_URL ?? "redis://127.0.0.1:6379/0";
const requireAof = process.env.RFQ_QUOTE_ISSUANCE_REQUIRE_AOF !== "false";
if (!requireAof && process.env.NODE_ENV !== "test") {
  throw new Error("RFQ_QUOTE_ISSUANCE_REQUIRE_AOF=false is allowed only with NODE_ENV=test");
}

const suffix = randomBytes(6).toString("hex");
const hashTag = `quote-admission-${suffix}`;
const exposurePrefix = `rfq:{${hashTag}}:exposure`;
const issuancePrefix = `rfq:{${hashTag}}:issuance`;
const tokenIn = "0x0000000000000000000000000000000000000011";
const tokenOut = "0x0000000000000000000000000000000000000022";
const user = "0x0000000000000000000000000000000000000033";
const admin = createRedisQuoteExposureClient(redisUrl);
const exposureStore = new RedisQuoteExposureStore(
  createRedisQuoteExposureClient(redisUrl),
  { maxUserOpenNotionalUsd: "1", maxPairOpenNotionalUsd: "10" },
  new ConfiguredTokenRegistry({
    tokens: [token(tokenIn, "USD_A"), token(tokenOut, "USD_B")],
  }),
  undefined,
  {
    keyPrefix: exposurePrefix,
    ledgerEpoch: "integration_v1",
    allowEpochInitialization: true,
    maxBacklog: 100,
    expiryGraceSeconds: 2,
    cleanupLimit: 10,
    lockTtlMs: 1_000,
    lockAcquireTimeoutMs: 100,
    minReplicaAcks: 0,
    replicaAckTimeoutMs: 20,
    requireAof,
  },
);
const issuanceStore = new RedisQuoteIssuanceStore(
  createRedisQuoteIssuanceClient(redisUrl),
  {
    keyPrefix: issuancePrefix,
    ledgerEpoch: "integration_v1",
    allowEpochInitialization: true,
    maxBacklog: 100,
    leaseMs: 60_000,
    hotStateTtlMs: 60_000,
    idempotencyTtlMs: 60_000,
    minReplicaAcks: 0,
    replicaAckTimeoutMs: 20,
    requireAof,
    projectionWaitTimeoutMs: 1_000,
    projectionPollIntervalMs: 5,
  },
);
const store = new RedisQuoteAdmissionStore(exposureStore, issuanceStore);
let adminConnected = false;

try {
  await admin.connect?.();
  adminConnected = true;
  await cleanup();
  await Promise.all([exposureStore.initialize(), issuanceStore.initialize()]);

  const first = await admission(`q_joint_${suffix}`, user, "risk-v1");
  const concurrent = await Promise.all(Array.from({ length: 8 }, () => store.admit(first)));
  assert.equal(concurrent.every((result) => result.exposure.status === "reserved"), true);
  assert.equal(concurrent.every((result) => result.riskDecision.decision === "approved"), true);
  assert.equal(Number(await admin.xlen(`${exposurePrefix}:events`)), 1);
  assert.equal(Number(await admin.xlen(`${issuancePrefix}:events`)), 1);

  const rejected = await admission(`q_joint_rejected_${suffix}`, user, "risk-v1");
  assert.deepEqual(await store.admit(rejected), {
    exposure: { status: "rejected", reasonCode: "USER_OPEN_NOTIONAL_LIMIT_EXCEEDED" },
  });
  assert.equal(Number(await admin.xlen(`${exposurePrefix}:events`)), 1);
  assert.equal(Number(await admin.xlen(`${issuancePrefix}:events`)), 1);

  const conflictQuoteId = `q_joint_conflict_${suffix}`;
  const conflict = await admission(
    conflictQuoteId,
    "0x0000000000000000000000000000000000000044",
    "risk-v1",
  );
  await issuanceStore.admit(conflict.issuance);
  const changed = {
    ...conflict,
    issuance: {
      ...conflict.issuance,
      authorization: {
        ...conflict.issuance.authorization,
        decision: { status: "approved", policyVersion: "risk-v2" },
        signingAuthorization: {
          ...conflict.issuance.authorization.signingAuthorization,
          commit: {
            ...conflict.issuance.authorization.signingAuthorization.commit,
            riskPolicyVersion: "risk-v2",
          },
        },
      },
    },
  };
  await assert.rejects(store.admit(changed), /quote_conflict/);
  assert.equal(await reservation(conflictQuoteId), "", "issuance conflict must not reserve exposure");
  assert.equal(Number(await admin.xlen(`${exposurePrefix}:events`)), 1);
  assert.equal(Number(await admin.xlen(`${issuancePrefix}:events`)), 2);

  process.stdout.write(`${JSON.stringify({
    status: "ok",
    concurrentReplayCount: concurrent.length,
    exposureEvents: 1,
    issuanceEvents: 2,
    rejectionWroteNoPartialState: true,
    issuanceConflictWroteNoExposure: true,
  }, null, 2)}\n`);
} finally {
  await Promise.allSettled([exposureStore.close(), issuanceStore.close()]);
  if (adminConnected) {
    try { await cleanup(); } finally {
      try { await admin.quit(); } catch { admin.disconnect?.(); }
    }
  } else {
    admin.disconnect?.();
  }
}

async function admission(quoteId, userAddress, policyVersion) {
  const principalId = `principal_${quoteId}`;
  const idempotencyKey = `idempotency-${quoteId}`;
  const requestHash = randomBytes(32).toString("hex");
  const claim = await issuanceStore.acquire(principalId, idempotencyKey, requestHash);
  assert.equal(claim.status, "acquired");
  const request = {
    chainId: 1,
    user: userAddress,
    tokenIn,
    tokenOut,
    amountIn: "1000000000000000000",
    slippageBps: 50,
  };
  const snapshotId = `snapshot_${quoteId}`;
  const deadline = Math.floor(Date.now() / 1_000) + 60;
  const pricing = {
    amountOut: "1000000000000000000",
    minAmountOut: "990000000000000000",
    spreadBps: 10,
    sizeImpactBps: 1,
    marketSpreadBps: 5,
    inventorySkewBps: 0,
    volatilityPremiumBps: 2,
    hedgeCostBps: 2,
    pricingVersion: "joint-admission-integration-v1",
  };
  const quote = {
    chainId: request.chainId,
    user: request.user,
    tokenIn: request.tokenIn,
    tokenOut: request.tokenOut,
    amountIn: request.amountIn,
    amountOut: pricing.amountOut,
    minAmountOut: pricing.minAmountOut,
    nonce: String(Date.now()),
    deadline,
  };
  return {
    exposure: { quoteId, request, pricing, deadline },
    issuance: {
      preparation: {
        marketSnapshot: {
          request,
          snapshot: {
            snapshotId,
            midPrice: "1.000000000000000000",
            liquidityUsd: "10000000",
            marketSpreadBps: 5,
            volatilityBps: 20,
            observedAt: new Date().toISOString(),
          },
          source: "quote-admission-integration-v1",
        },
        requestedQuote: { quoteId, principalId, request, snapshotId },
        routeDecision: {
          quoteId,
          principalId,
          snapshotId,
          routePlan: {
            routeId: `route_${quoteId}`,
            venue: "internal_inventory",
            tokenIn,
            tokenOut,
            expectedLiquidityUsd: "10000000",
          },
        },
        idempotency: claim.reservation,
      },
      authorization: {
        quoteId,
        decision: { status: "approved", policyVersion },
        signingAuthorization: {
          quote,
          quoteId,
          snapshotId,
          commit: {
            principalId,
            slippageBps: request.slippageBps,
            pricingVersion: pricing.pricingVersion,
            spreadBps: pricing.spreadBps,
            sizeImpactBps: pricing.sizeImpactBps,
            marketSpreadBps: pricing.marketSpreadBps,
            inventorySkewBps: pricing.inventorySkewBps,
            volatilityPremiumBps: pricing.volatilityPremiumBps,
            hedgeCostBps: pricing.hedgeCostBps,
            riskPolicyVersion: policyVersion,
            idempotency: claim.reservation,
          },
        },
      },
    },
  };
}

async function reservation(quoteId) {
  return admin.eval(
    "return redis.call('HGET', KEYS[1], ARGV[1]) or ''",
    1,
    `${exposurePrefix}:reservations`,
    quoteId,
  );
}

async function cleanup() {
  if (admin.status === "wait" || admin.status === "end") await admin.connect?.();
  await admin.eval(
    "local keys = redis.call('KEYS', ARGV[1]); if #keys > 0 then return redis.call('DEL', unpack(keys)) end; return 0",
    0,
    `rfq:{${hashTag}}:*`,
  );
}

function token(tokenAddress, symbol) {
  return {
    chainId: 1,
    tokenAddress,
    symbol,
    decimals: 18,
    isWhitelisted: true,
    riskTier: "low",
    usdReference: true,
  };
}
