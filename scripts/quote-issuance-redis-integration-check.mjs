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
import {
  createRedisSignerQuoteCommitClient,
  RedisSignerQuoteCommitStore,
} from "../backend/dist/modules/signer/redis-signer-quote-commit.store.js";
import { PostgresSignerAuditStore } from "../backend/dist/modules/signer/signer-audit.store.js";
import { SignerAuditMirror } from "../backend/dist/modules/signer/signer-audit-mirror.js";
import {
  buildSignerQuoteFinalization,
  quoteFinalizationHash,
} from "../backend/dist/modules/signer/signer-quote-commit.js";
import {
  buildQuoteTypedData,
  LocalEIP712SignerService,
} from "../backend/dist/modules/signer/signer.service.js";

const require = createRequire(new URL("../backend/package.json", import.meta.url));
const pg = require("pg");
const { Redis } = require("ioredis");
const { hashTypedData, keccak256 } = require("viem");

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
const privateKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const signerAddress = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
const settlementAddress = "0x0000000000000000000000000000000000000004";
const requireAof = process.env.RFQ_QUOTE_ISSUANCE_REQUIRE_AOF !== "false";
if (!requireAof && process.env.NODE_ENV !== "test") {
  throw new Error("RFQ_QUOTE_ISSUANCE_REQUIRE_AOF=false is allowed only with NODE_ENV=test");
}
const pool = new pg.Pool({ connectionString: databaseUrl, max: 3 });
const adminRedis = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
const producer = createRedisQuoteIssuanceClient(redisUrl);
const consumer = createRedisQuoteIssuanceClient(redisUrl);
const commitProducer = createRedisSignerQuoteCommitClient(redisUrl);
const auditConsumer = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
const auditStreamKey = "rfq:{quote-issuance-it}:signer-audit-events:v1";
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
  requireAof,
  projectionWaitTimeoutMs: 1_000,
  projectionPollIntervalMs: 5,
});
const commitStore = new RedisSignerQuoteCommitStore(commitProducer, {
  quoteKeyPrefix: keyPrefix,
  ledgerEpoch: "integration_v1",
  issuanceMaxBacklog: 100,
  hotStateTtlMs: 60_000,
  idempotencyTtlMs: 60_000,
  auditStreamKey,
  auditMaxBacklog: 100,
  auditDedupeTtlMs: 60_000,
  minReplicaAcks: 0,
  replicaAckTimeoutMs: 20,
  requireAof,
});

try {
  await adminRedis.connect();
  await deletePrefix(adminRedis, "rfq:{quote-issuance-it}:*");
  await cleanupPostgres();
  await store.initialize();

  const claim = await store.acquire(principalId, idempotencyKey, requestHash);
  assert.equal(claim.status, "acquired");
  const reservation = claim.reservation;
  const request = { chainId: 1, user, tokenIn, tokenOut, amountIn: "1000000000000000000", slippageBps: 50 };
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
  const commit = {
    principalId,
    slippageBps: request.slippageBps,
    pricingVersion: "pricing-integration-v1",
    spreadBps: 10,
    sizeImpactBps: 1,
    marketSpreadBps: 5,
    inventorySkewBps: -2,
    volatilityPremiumBps: 3,
    hedgeCostBps: 4,
    riskPolicyVersion: "risk-integration-v1",
    idempotency: reservation,
  };
  const admission = {
    preparation: {
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
    },
    authorization: {
      quoteId,
      decision: { status: "approved", policyVersion: "risk-integration-v1" },
      signingAuthorization: { quote, quoteId, snapshotId, commit },
    },
  };
  const admissions = await Promise.all(Array.from({ length: 8 }, () => store.admit(admission)));
  const risk = admissions[0];
  assert.equal(admissions.every((candidate) => candidate.riskDecisionId === risk.riskDecisionId), true);
  assert.equal(Number(await adminRedis.xlen(`${keyPrefix}:events`)), 1);
  await assert.rejects(store.admit({
    ...admission,
    authorization: {
      ...admission.authorization,
      decision: { status: "approved", policyVersion: "risk-integration-v2" },
      signingAuthorization: {
        ...admission.authorization.signingAuthorization,
        commit: {
          ...admission.authorization.signingAuthorization.commit,
          riskPolicyVersion: "risk-integration-v2",
        },
      },
    },
  }), /quote_conflict/);
  assert.equal(Number(await adminRedis.xlen(`${keyPrefix}:events`)), 1);
  assert.equal(risk.riskDecisionId, `rd_${quoteId}`);
  const signInput = {
    quote,
    quoteId,
    snapshotId,
    riskDecisionId: risk.riskDecisionId,
    riskPolicyVersion: risk.policyVersion,
    traceId: `tr_${quoteId}`,
    commit,
  };
  await commitStore.assertAuthorized(signInput);
  await assert.rejects(commitStore.assertAuthorized({
    ...signInput,
    quote: { ...quote, amountOut: String(BigInt(quote.amountOut) - 1n) },
  }), /does not match the signing request/);
  const signer = new LocalEIP712SignerService({ privateKey, settlementAddress });
  const signature = await signer.signQuote(signInput);
  const finalization = buildSignerQuoteFinalization(signInput, commit, signature);
  const event = {
    quoteId,
    snapshotId,
    riskDecisionId: risk.riskDecisionId,
    riskPolicyVersion: risk.policyVersion,
    traceId: signInput.traceId,
    quoteDigest: hashTypedData(buildQuoteTypedData(quote, settlementAddress)),
    signatureHash: keccak256(signature),
    signerAddress,
    settlementAddress,
    chainId: quote.chainId,
    deadline: quote.deadline,
    outcome: "success",
    occurredAt: new Date().toISOString(),
  };
  assert.deepEqual(await commitStore.commit(event, finalization), {
    finalizationHash: quoteFinalizationHash(finalization),
    duplicate: false,
  });
  const response = finalization.response;

  const beforeProjection = await pool.query("SELECT status FROM quotes WHERE id = $1", [quoteId]);
  assert.equal(beforeProjection.rowCount, 0, "PostgreSQL must not be required for synchronous issuance");
  assert.equal(Number(await adminRedis.xlen(`${keyPrefix}:events`)), 2);
  assert.equal(Number(await adminRedis.xlen(auditStreamKey)), 1);
  assert.deepEqual(await store.recoverFinalizedResponse(quoteId, principalId), response);

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
  assert.equal(await mirror.runOnce(), 2);

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
    event_count: 2,
  });
  assert.equal(Number(await adminRedis.xlen(`${keyPrefix}:events`)), 0);
  assert.equal(await adminRedis.get(`${keyPrefix}:projected:${quoteId}`), "finalized");
  await store.awaitSignedQuoteProjection(quote, principalId);
  const signerAudit = new PostgresSignerAuditStore(pool, 2_000);
  const auditMirror = new SignerAuditMirror(auditConsumer, signerAudit, {
    streamKey: auditStreamKey,
    sourceEpoch: "integration_atomic_v1",
    group: "signer_quote_commit_it_pg_v1",
    consumer: `integration_${suffix}`,
    batchSize: 10,
    blockMs: 0,
    claimIdleMs: 1_000,
    retryDelayMs: 10,
  });
  await auditMirror.initialize();
  assert.equal(await auditMirror.runOnce(), 1);
  assert.equal(Number(await adminRedis.xlen(auditStreamKey)), 0);
  assert.equal(Number((await pool.query(
    "SELECT count(*)::integer AS count FROM signer_audit_events WHERE quote_id = $1",
    [quoteId],
  )).rows[0].count), 1);
  const replay = await store.acquire(principalId, idempotencyKey, requestHash);
  assert.equal(replay.status, "replay");
  assert.deepEqual(replay.response, response);
  assert.equal((await store.acquire(principalId, idempotencyKey, "f".repeat(64))).status, "conflict");
  await auditMirror.close();
  await mirror.close();
  console.log(JSON.stringify({ ok: true, quoteId, projectedEvents: 2, signerAuditEvents: 1 }));
} finally {
  await Promise.allSettled([store.close(), commitStore.close(), adminRedis.quit(), auditConsumer.quit(), pool.end()]);
}

async function cleanupPostgres() {
  await pool.query("DELETE FROM signer_audit_events WHERE quote_id = $1", [quoteId]);
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
