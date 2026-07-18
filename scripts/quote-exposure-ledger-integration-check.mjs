import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { endPool, getPool } from "../backend/dist/db/pool.js";
import { ConfiguredTokenRegistry } from "../backend/dist/modules/pricing/token-registry.js";
import { PostgresQuoteRepository } from "../backend/dist/modules/quote/postgres-quote.repository.js";
import { PostgresQuoteExposureLedgerSink } from "../backend/dist/modules/risk/postgres-quote-exposure-ledger.sink.js";
import { QuoteExposureLedgerMirror } from "../backend/dist/modules/risk/quote-exposure-ledger.mirror.js";
import {
  createRedisQuoteExposureClient,
  RedisQuoteExposureStore,
} from "../backend/dist/modules/risk/redis-quote-exposure.store.js";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
if (!process.env.RFQ_QUOTE_EXPOSURE_REDIS_URL) {
  throw new Error("RFQ_QUOTE_EXPOSURE_REDIS_URL is required");
}
if (process.env.RFQ_QUOTE_EXPOSURE_LEDGER_INTEGRATION_CONFIRM !== "yes") {
  throw new Error(
    "RFQ_QUOTE_EXPOSURE_LEDGER_INTEGRATION_CONFIRM=yes is required because this check writes synthetic data",
  );
}

const runId = randomBytes(6).toString("hex");
const requireAof = process.env.RFQ_QUOTE_EXPOSURE_REQUIRE_AOF !== "false";
const pool = getPool();
const quoteRepository = new PostgresQuoteRepository(pool);
const producer = createRedisQuoteExposureClient(process.env.RFQ_QUOTE_EXPOSURE_REDIS_URL);
const consumer = createRedisQuoteExposureClient(process.env.RFQ_QUOTE_EXPOSURE_REDIS_URL);
const cleanupClient = createRedisQuoteExposureClient(process.env.RFQ_QUOTE_EXPOSURE_REDIS_URL);
const keyPrefix = `rfq:{quote-exposure-test}:ledger:${runId}`;
const epoch = "integration_v1";
const quoteId = `q_ledger_${runId}`;
const snapshotId = `s_ledger_${runId}`;
const principalId = `principal_ledger_${runId}`;
const tokenIn = randomAddress();
const tokenOut = randomAddress();
const user = randomAddress();
const nowSeconds = Math.floor(Date.now() / 1_000);
const request = { chainId: 1, user, tokenIn, tokenOut, amountIn: "1000000000000000000", slippageBps: 50 };
const pricing = {
  amountOut: "1000000000000000000",
  minAmountOut: "990000000000000000",
  spreadBps: 10,
  sizeImpactBps: 0,
  marketSpreadBps: 10,
  inventorySkewBps: 0,
  volatilityPremiumBps: 0,
  hedgeCostBps: 0,
  pricingVersion: "exposure-ledger-integration-v1",
};
const registry = new ConfiguredTokenRegistry({
  tokens: [
    token(tokenIn, "USD_IN"),
    token(tokenOut, "USD_OUT"),
  ],
});
const store = new RedisQuoteExposureStore(
  producer,
  { maxUserOpenNotionalUsd: "10", maxPairOpenNotionalUsd: "10" },
  registry,
  undefined,
  {
    keyPrefix,
    ledgerEpoch: epoch,
    allowEpochInitialization: true,
    maxBacklog: 100,
    expiryGraceSeconds: 2,
    cleanupLimit: 100,
    lockTtlMs: 500,
    lockAcquireTimeoutMs: 100,
    minReplicaAcks: 0,
    replicaAckTimeoutMs: 20,
    requireAof,
  },
);
const sink = new PostgresQuoteExposureLedgerSink(pool, 2_000);
const mirror = new QuoteExposureLedgerMirror(consumer, sink, {
  streamKey: `${keyPrefix}:events`,
  sourceEpoch: epoch,
  group: `ledger_integration_${runId}`,
  consumer: `gateway_integration_${runId}`,
  batchSize: 10,
  blockMs: 0,
  claimIdleMs: 1_000,
  retryDelayMs: 10,
  cleanupLimit: 100,
  cleanupIntervalMs: 1_000,
});
let fixtureStarted = false;

try {
  await assertMigration();
  await pool.query(
    `INSERT INTO market_snapshots (
       id, chain_id, token_in, token_out, mid_price, bid_price, ask_price,
       liquidity_usd, market_spread_bps, volatility_bps, source, observed_at
     ) VALUES (
       $1, 1, $2, $3, '1.000000000000000000', '0.999000000000000000',
       '1.001000000000000000', 1000000, 20, 25, 'exposure-ledger-integration', now()
     )`,
    [snapshotId, tokenIn, tokenOut],
  );
  fixtureStarted = true;
  await quoteRepository.saveRequested({ quoteId, principalId, request, snapshotId });

  await store.initialize();
  await store.checkHealth();
  await mirror.initialize();
  const reserved = await store.reserve({ quoteId, request, pricing, deadline: nowSeconds + 30 });
  assert.equal(reserved.status, "reserved");
  assert.equal(await mirror.runOnce(), 1);
  await assertProjection("reserve", 1, 1);

  await store.release(quoteId);
  assert.equal(await mirror.runOnce(), 1);
  await assertProjection("release", 0, 2);

  process.stdout.write(`${JSON.stringify({
    status: "ok",
    checks: {
      redisAdmission: true,
      reserveProjection: true,
      releaseProjection: true,
      appendOnlyAuditEvents: 2,
    },
  }, null, 2)}\n`);
} finally {
  await mirror.close().catch(() => {});
  await store.close().catch(() => {});
  await cleanupRedis().catch(() => {});
  if (fixtureStarted) await cleanupPostgres();
  await endPool();
}

async function assertMigration() {
  const result = await pool.query("SELECT name FROM _migrations WHERE version = '037'");
  assert.equal(result.rows[0]?.name, "quote-exposure-ledger", "migration 037 must be applied");
}

async function assertProjection(expectedOperation, activeCount, eventCount) {
  const [active, events, projection] = await Promise.all([
    pool.query("SELECT count(*)::text AS count FROM quote_exposure_reservations WHERE quote_id = $1", [quoteId]),
    pool.query("SELECT operation FROM quote_exposure_ledger_events WHERE quote_id = $1 ORDER BY source_stream_id", [quoteId]),
    pool.query("SELECT operation FROM quote_exposure_ledger_projection_versions WHERE quote_id = $1", [quoteId]),
  ]);
  assert.equal(Number(active.rows[0].count), activeCount);
  assert.equal(events.rowCount, eventCount);
  assert.equal(projection.rows[0]?.operation, expectedOperation);
}

async function cleanupRedis() {
  await cleanupClient.connect?.();
  const keys = await cleanupClient.call("KEYS", `${keyPrefix}:*`);
  if (Array.isArray(keys) && keys.length > 0) await cleanupClient.call("DEL", ...keys);
  await cleanupClient.quit();
}

async function cleanupPostgres() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM quotes WHERE id = $1", [quoteId]);
    await client.query("DELETE FROM market_snapshots WHERE id = $1", [snapshotId]);
    await client.query(
      "DELETE FROM analytics_outbox WHERE aggregate_id = ANY($1::text[]) OR payload->>'quoteId' = $2",
      [[quoteId, snapshotId], quoteId],
    );
    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
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

function randomAddress() {
  return `0x${randomBytes(20).toString("hex")}`;
}
