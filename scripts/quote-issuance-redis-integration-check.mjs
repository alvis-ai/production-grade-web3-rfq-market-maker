import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import process from "node:process";
import { PostgresQuoteIssuanceJournalSink } from "../backend/dist/modules/quote/postgres-quote-issuance-journal.sink.js";
import { QuoteIssuanceJournalMirror } from "../backend/dist/modules/quote/quote-issuance-journal.mirror.js";
import {
  createRedisQuoteIssuanceClient,
  RedisQuoteIssuanceStore,
} from "../backend/dist/modules/quote/redis-quote-issuance.store.js";

const require = createRequire(new URL("../backend/package.json", import.meta.url));
const pg = require("pg");
const { Redis } = require("ioredis");

const redisUrl = requiredEnv("RFQ_QUOTE_ISSUANCE_REDIS_URL");
const databaseUrl = requiredEnv("DATABASE_URL");
const keyPrefix = "rfq:{quote-issuance-it}:ledger";
const suffix = randomBytes(6).toString("hex");
const quoteId = `q_issuance_it_${suffix}`;
const principalId = `principal_issuance_it_${suffix}`;
const snapshotId = `snapshot_issuance_it_${suffix}`;
const idempotencyKey = `issuance-it-key-${suffix}`;
const requestHash = randomBytes(32).toString("hex");
const user = "0x0000000000000000000000000000000000000033";
const tokenIn = "0x0000000000000000000000000000000000000011";
const tokenOut = "0x0000000000000000000000000000000000000022";
const now = Date.now();
const deadline = Math.floor(now / 1_000) + 60;
const nonce = String(now);
const signature = `0x${"11".repeat(64)}1b`;
const pool = new pg.Pool({ connectionString: databaseUrl, max: 3 });
const adminRedis = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
const producer = createRedisQuoteIssuanceClient(redisUrl);
const consumer = createRedisQuoteIssuanceClient(redisUrl);
const store = new RedisQuoteIssuanceStore(producer, {
  keyPrefix,
  ledgerEpoch: "integration_v1",
  allowEpochInitialization: true,
  maxBacklog: 100,
  leaseMs: 60_000,
  hotStateTtlMs: 60_000,
  idempotencyTtlMs: 60_000,
  minReplicaAcks: 0,
  replicaAckTimeoutMs: 20,
  requireAof: true,
  projectionWaitTimeoutMs: 1_000,
  projectionPollIntervalMs: 5,
});

try {
  await adminRedis.connect();
  await deletePrefix(adminRedis, `${keyPrefix}:*`);
  await cleanupPostgres();
  await store.initialize();

  const claim = await store.acquire(principalId, idempotencyKey, requestHash);
  assert.equal(claim.status, "acquired");
  const reservation = claim.reservation;
  const request = { chainId: 1, user, tokenIn, tokenOut, amountIn: "1000000000000000000", slippageBps: 50 };
  await store.prepare({
    marketSnapshot: {
      request,
      snapshot: {
        snapshotId,
        midPrice: "1.000000000000000000",
        liquidityUsd: "10000000",
        marketSpreadBps: 10,
        volatilityBps: 20,
        observedAt: new Date(now).toISOString(),
      },
      source: "quote-issuance-integration-v1",
    },
    requestedQuote: { quoteId, principalId, request, snapshotId },
    routeDecision: {
      quoteId,
      principalId,
      snapshotId,
      routePlan: {
        routeId: `route_${suffix}`,
        venue: "internal_inventory",
        tokenIn,
        tokenOut,
        expectedLiquidityUsd: "10000000",
      },
    },
    idempotency: reservation,
  });
  const risk = await store.authorize({
    quoteId,
    decision: { status: "approved", policyVersion: "risk-integration-v1" },
  });
  assert.equal(risk.riskDecisionId, `rd_${quoteId}`);
  const quote = {
    user,
    tokenIn,
    tokenOut,
    amountIn: request.amountIn,
    amountOut: "999000000000000000",
    minAmountOut: "990000000000000000",
    nonce,
    deadline,
    chainId: 1,
  };
  const response = {
    quoteId,
    snapshotId,
    amountOut: quote.amountOut,
    minAmountOut: quote.minAmountOut,
    nonce,
    deadline,
    signature,
  };
  await store.finalize({
    signedQuote: {
      quoteId,
      principalId,
      snapshotId,
      slippageBps: request.slippageBps,
      quote,
      pricingVersion: "pricing-integration-v1",
      spreadBps: 10,
      sizeImpactBps: 1,
      marketSpreadBps: 5,
      inventorySkewBps: -2,
      volatilityPremiumBps: 3,
      hedgeCostBps: 4,
      riskPolicyVersion: "risk-integration-v1",
      signature,
    },
    response,
    idempotency: reservation,
  });

  const beforeProjection = await pool.query("SELECT status FROM quotes WHERE id = $1", [quoteId]);
  assert.equal(beforeProjection.rowCount, 0, "PostgreSQL must not be required for synchronous issuance");
  assert.equal(Number(await adminRedis.xlen(`${keyPrefix}:events`)), 3);

  const sink = new PostgresQuoteIssuanceJournalSink(pool, 2_000);
  const mirror = new QuoteIssuanceJournalMirror(consumer, sink, {
    streamKey: `${keyPrefix}:events`,
    projectedKeyPrefix: `${keyPrefix}:projected`,
    projectionTtlMs: 60_000,
    sourceEpoch: "integration_v1",
    group: "quote_issuance_it_pg_v1",
    consumer: `integration_${suffix}`,
    batchSize: 10,
    blockMs: 0,
    claimIdleMs: 1_000,
    retryDelayMs: 10,
  });
  await mirror.initialize();
  assert.equal(await mirror.runOnce(), 3);

  const projected = await pool.query(
    `SELECT q.status, q.signature, r.decision, i.state,
            (SELECT count(*)::int FROM quote_issuance_journal_events WHERE quote_id = q.id) AS event_count
     FROM quotes q
     JOIN risk_decisions r ON r.quote_id = q.id
     JOIN quote_idempotency_requests i ON i.quote_id = q.id
     WHERE q.id = $1`,
    [quoteId],
  );
  assert.equal(projected.rowCount, 1);
  assert.deepEqual(projected.rows[0], {
    status: "signed",
    signature,
    decision: "approved",
    state: "succeeded",
    event_count: 3,
  });
  assert.equal(Number(await adminRedis.xlen(`${keyPrefix}:events`)), 0);
  assert.equal(await adminRedis.get(`${keyPrefix}:projected:${quoteId}`), "finalized");
  await store.awaitSignedQuoteProjection(quote, principalId);
  const replay = await store.acquire(principalId, idempotencyKey, requestHash);
  assert.equal(replay.status, "replay");
  assert.deepEqual(replay.response, response);
  assert.equal((await store.acquire(principalId, idempotencyKey, "f".repeat(64))).status, "conflict");
  await mirror.close();
  console.log(JSON.stringify({ ok: true, quoteId, projectedEvents: 3 }));
} finally {
  await Promise.allSettled([store.close(), adminRedis.quit(), pool.end()]);
}

async function cleanupPostgres() {
  await pool.query("DELETE FROM quote_idempotency_requests WHERE principal_id = $1", [principalId]);
  await pool.query("DELETE FROM quotes WHERE id = $1", [quoteId]);
  await pool.query("DELETE FROM market_snapshots WHERE id = $1", [snapshotId]);
}

async function deletePrefix(redis, pattern) {
  let cursor = "0";
  do {
    const [next, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
    cursor = next;
    if (keys.length > 0) await redis.unlink(...keys);
  } while (cursor !== "0");
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
