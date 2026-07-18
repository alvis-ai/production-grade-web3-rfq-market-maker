import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { ConfiguredTokenRegistry } from "../backend/dist/modules/pricing/token-registry.js";
import {
  createRedisQuoteExposureClient,
  RedisQuoteExposureStore,
} from "../backend/dist/modules/risk/redis-quote-exposure.store.js";

if (process.env.RFQ_QUOTE_EXPOSURE_REDIS_INTEGRATION_CONFIRM !== "yes") {
  throw new Error(
    "RFQ_QUOTE_EXPOSURE_REDIS_INTEGRATION_CONFIRM=yes is required because this check writes Redis state",
  );
}

const redisUrl = process.env.RFQ_QUOTE_EXPOSURE_REDIS_URL ?? "redis://127.0.0.1:6379";
const requireAof = process.env.RFQ_QUOTE_EXPOSURE_REQUIRE_AOF !== "false";
const runId = randomBytes(6).toString("hex");
const keyPrefix = `rfq:{qe_${runId}}:v1`;
const tokenIn = "0x0000000000000000000000000000000000000011";
const tokenOut = "0x0000000000000000000000000000000000000022";
const admin = createRedisQuoteExposureClient(redisUrl);
const client = createRedisQuoteExposureClient(redisUrl);
const registry = new ConfiguredTokenRegistry({
  tokens: [
    token(tokenIn, "USD_A"),
    token(tokenOut, "USD_B"),
  ],
});
const observations = [];
const failures = [];
const store = new RedisQuoteExposureStore(
  client,
  { maxUserOpenNotionalUsd: "15000000", maxPairOpenNotionalUsd: "15000000" },
  registry,
  undefined,
  {
    keyPrefix,
    ledgerEpoch: "integration_v1",
    allowEpochInitialization: true,
    maxBacklog: 100,
    expiryGraceSeconds: 2,
    cleanupLimit: 10,
    lockTtlMs: 1_000,
    lockAcquireTimeoutMs: 100,
    minReplicaAcks: 0,
    replicaAckTimeoutMs: 10,
    requireAof,
  },
  {
    recordLedgerMutation(value) { observations.push(value); },
    recordLedgerFailure(value) { failures.push(value); },
    recordLedgerLockWait() {},
    recordLedgerBacklog() {},
    recordPortfolioDeltaSoftBreach() {},
  },
);

try {
  await admin.connect?.();
  await store.initialize();
  await store.checkHealth();
  const now = Math.floor(Date.now() / 1_000);
  const amount = "9007199254740993123456789";
  const first = reserveInput(`q_redis_exposure_a_${runId}`, user("a1"), amount, now + 30);
  const second = reserveInput(`q_redis_exposure_b_${runId}`, first.request.user, amount, now + 30);

  const accepted = await store.reserve(first);
  assert.equal(accepted.status, "reserved");
  assert.equal(accepted.notionalUsdE18, amount);
  assert.deepEqual(await store.reserve(first), accepted, "replay must return identical evidence");
  assert.deepEqual(await store.reserve(second), {
    status: "rejected",
    reasonCode: "USER_OPEN_NOTIONAL_LIMIT_EXCEEDED",
  });

  await store.release(first.quoteId);
  assert.equal((await store.reserve(second)).status, "reserved", "release must restore exact capacity");
  await store.release(second.quoteId);

  const treasuryStore = new RedisQuoteExposureStore(
    createRedisQuoteExposureClient(redisUrl),
    { maxUserOpenNotionalUsd: "50000000", maxPairOpenNotionalUsd: "50000000" },
    registry,
    undefined,
    {
      keyPrefix,
      ledgerEpoch: "integration_v1",
      allowEpochInitialization: false,
      maxBacklog: 100,
      expiryGraceSeconds: 2,
      cleanupLimit: 10,
      lockTtlMs: 1_000,
      lockAcquireTimeoutMs: 100,
      minReplicaAcks: 0,
      replicaAckTimeoutMs: 10,
      requireAof,
    },
  );
  try {
    const treasuryLimit = (BigInt(amount) * 2n - 1n).toString();
    const treasuryA = reserveInput(
      `q_redis_exposure_treasury_a_${runId}`,
      user("b1"),
      amount,
      now + 30,
      treasuryLimit,
    );
    const treasuryB = reserveInput(
      `q_redis_exposure_treasury_b_${runId}`,
      user("b2"),
      amount,
      now + 30,
      treasuryLimit,
    );
    assert.equal((await treasuryStore.reserve(treasuryA)).status, "reserved");
    assert.deepEqual(await treasuryStore.reserve(treasuryB), {
      status: "rejected",
      reasonCode: "TREASURY_LIQUIDITY_INSUFFICIENT",
    });
  } finally {
    await treasuryStore.close();
  }

  assert.equal(failures.length, 0);
  assert.equal(observations.filter((value) => value.operation === "reserve").length, 3);
  assert.equal(observations.some((value) => value.duplicate), true);
  const streamLength = await admin.xlen(`${keyPrefix}:events`);
  assert.equal(streamLength, 5, "three accepted reserves and two releases must be audited");
  const storedDelta = await admin.eval(
    "return redis.call('HGET', KEYS[1], ARGV[1]) or ''",
    1,
    `${keyPrefix}:token-deltas`,
    `1:${tokenIn}`,
  );
  assert.equal(storedDelta, amount);

  process.stdout.write(`${JSON.stringify({
    status: "ok",
    exactIntegerBeyondIeee754: true,
    idempotentReplay: true,
    releaseRestoresCapacity: true,
    treasuryLimitAtomic: true,
    streamLength,
  }, null, 2)}\n`);
} finally {
  await store.close();
  try { await admin.quit(); } catch { admin.disconnect?.(); }
  const cleanup = createRedisQuoteExposureClient(redisUrl);
  await cleanup.connect?.();
  await cleanup.eval(
    "local keys = redis.call('KEYS', ARGV[1]); if #keys > 0 then return redis.call('DEL', unpack(keys)) end; return 0",
    0,
    `${keyPrefix}:*`,
  );
  await cleanup.quit();
}

function reserveInput(quoteId, userAddress, amountIn, deadline, availableBalance) {
  return {
    quoteId,
    request: {
      chainId: 1,
      user: userAddress,
      tokenIn,
      tokenOut,
      amountIn,
      slippageBps: 50,
    },
    pricing: {
      amountOut: amountIn,
      minAmountOut: (BigInt(amountIn) - 1n).toString(),
      spreadBps: 1,
      sizeImpactBps: 0,
      marketSpreadBps: 1,
      inventorySkewBps: 0,
      volatilityPremiumBps: 0,
      hedgeCostBps: 0,
      pricingVersion: "redis-exposure-integration-v1",
    },
    deadline,
    ...(availableBalance ? {
      treasuryLiquidity: {
        chainId: 1,
        settlementAddress: "0x0000000000000000000000000000000000000033",
        treasuryAddress: "0x0000000000000000000000000000000000000044",
        token: tokenOut,
        availableBalance,
        blockNumber: 123n,
      },
    } : {}),
  };
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

function user(suffix) {
  return `0x${suffix.padStart(40, "0")}`;
}
