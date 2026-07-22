import type pg from "pg";
import type { MetricsService } from "../modules/metrics/metrics.service.js";
import { PostgresQuoteIssuanceJournalSink } from "../modules/quote/postgres-quote-issuance-journal.sink.js";
import { PostgresQuoteIssuanceStore } from "../modules/quote/postgres-quote-issuance.store.js";
import { QuoteIssuanceJournalMirror } from "../modules/quote/quote-issuance-journal.mirror.js";
import type { QuoteIssuanceStore } from "../modules/quote/quote-issuance.store.js";
import {
  createRedisQuoteIssuanceClient,
  RedisQuoteIssuanceStore,
} from "../modules/quote/redis-quote-issuance.store.js";
import type { QuoteIdempotencyStore } from "../modules/quote/quote-idempotency.store.js";
import {
  readDecimalIntegerConfig,
  readOptionalBoolean,
  readOwnEnvValue,
  requiresExplicitRuntimeConfig,
} from "./environment.js";
import {
  resolveQuoteIdempotencyStore,
  type BuildServerOptions,
} from "./gateway-runtime.js";

export type QuoteIssuanceRuntimeBackend = "postgres" | "redis-stream";

export interface QuoteIssuanceRuntimeConfig {
  backend: QuoteIssuanceRuntimeBackend;
  redisUrl?: string;
  keyPrefix: string;
  ledgerEpoch: string;
  allowEpochInitialization: boolean;
  maxBacklog: number;
  leaseMs: number;
  hotStateTtlMs: number;
  idempotencyTtlMs: number;
  minReplicaAcks: number;
  replicaAckTimeoutMs: number;
  requireAof: boolean;
  projectionWaitTimeoutMs: number;
  projectionPollIntervalMs: number;
  mirrorGroup: string;
  mirrorConsumer: string;
  mirrorBatchSize: number;
  mirrorBlockMs: number;
  mirrorClaimIdleMs: number;
  mirrorRetryDelayMs: number;
  postgresQueryTimeoutMs: number;
  requireTls: boolean;
}

export interface GatewayQuoteIssuanceRuntime {
  quoteIssuanceStore: QuoteIssuanceStore;
  quoteIdempotencyStore: QuoteIdempotencyStore;
  redisStore: RedisQuoteIssuanceStore;
  redisUrl: string;
  asynchronousProjection: true;
  awaitPreparedQuoteProjection(quoteId: string): Promise<void>;
  start(): Promise<void>;
  close(): Promise<void>;
}

export interface GatewayQuoteIssuanceResolution {
  quoteIdempotencyStore: QuoteIdempotencyStore;
  quoteIssuanceStore?: QuoteIssuanceStore;
  runtime?: GatewayQuoteIssuanceRuntime;
}

export interface QuoteIssuanceRuntimeLogger {
  warn(fields: Readonly<Record<string, unknown>>, message: string): void;
}

export function resolveGatewayQuoteIssuance(
  options: BuildServerOptions,
  pool: pg.Pool | undefined,
  quoteIdempotencyLeaseMs: number,
  metrics: MetricsService,
  logger: QuoteIssuanceRuntimeLogger,
): GatewayQuoteIssuanceResolution {
  const runtime = resolveGatewayQuoteIssuanceRuntime(
    options,
    pool,
    quoteIdempotencyLeaseMs,
    metrics,
    logger,
  );
  const quoteIdempotencyStore = runtime?.quoteIdempotencyStore ?? resolveQuoteIdempotencyStore(
    options.quoteIdempotencyStore,
    pool,
    quoteIdempotencyLeaseMs,
  );
  const quoteIssuanceStore = runtime?.quoteIssuanceStore ?? resolveQuoteIssuanceStore(options, pool);
  return {
    quoteIdempotencyStore,
    ...(quoteIssuanceStore ? { quoteIssuanceStore } : {}),
    ...(runtime ? { runtime } : {}),
  };
}

export function resolveGatewayQuoteIssuanceRuntime(
  options: BuildServerOptions,
  pool: pg.Pool | undefined,
  quoteIdempotencyLeaseMs: number,
  metrics: MetricsService,
  logger: QuoteIssuanceRuntimeLogger,
): GatewayQuoteIssuanceRuntime | undefined {
  if (!pool || typeof pool.query !== "function" || hasCustomQuotePersistence(options)) return undefined;
  const config = readQuoteIssuanceRuntimeConfig(undefined, quoteIdempotencyLeaseMs);
  if (config.backend !== "redis-stream") return undefined;
  return createRedisQuoteIssuanceRuntime(pool, config, metrics, logger);
}

export function resolveQuoteIssuanceStore(
  options: BuildServerOptions,
  pool: pg.Pool | undefined,
): QuoteIssuanceStore | undefined {
  if (!pool || typeof pool.query !== "function" || hasCustomQuotePersistence(options)) return undefined;
  return new PostgresQuoteIssuanceStore(pool);
}

export function readQuoteIssuanceRuntimeConfig(
  env: Record<string, string | undefined> = process.env,
  quoteIdempotencyLeaseMs = 60_000,
): QuoteIssuanceRuntimeConfig {
  const nodeEnv = readOwnEnvValue(env, "NODE_ENV");
  const production = requiresExplicitRuntimeConfig(nodeEnv);
  const configuredBackend = readOwnEnvValue(env, "RFQ_QUOTE_ISSUANCE_BACKEND");
  const backend = (configuredBackend?.trim().toLowerCase() || (production ? "redis-stream" : "postgres")) as
    QuoteIssuanceRuntimeBackend;
  if (backend !== "postgres" && backend !== "redis-stream") {
    throw new Error("RFQ_QUOTE_ISSUANCE_BACKEND must be postgres or redis-stream");
  }
  if (production && backend !== "redis-stream") {
    throw new Error(`RFQ_QUOTE_ISSUANCE_BACKEND must be redis-stream when NODE_ENV=${nodeEnv}`);
  }
  const redisUrl = readOwnEnvValue(env, "RFQ_QUOTE_ISSUANCE_REDIS_URL") ??
    readOwnEnvValue(env, "RFQ_REDIS_URL");
  if (backend === "redis-stream" && (!redisUrl || redisUrl.trim().length === 0)) {
    throw new Error("RFQ_QUOTE_ISSUANCE_REDIS_URL or RFQ_REDIS_URL is required for redis-stream");
  }
  const allowEpochInitialization = readOptionalBoolean(
    readOwnEnvValue(env, "RFQ_QUOTE_ISSUANCE_ALLOW_EPOCH_INITIALIZATION"),
    !production,
    "RFQ_QUOTE_ISSUANCE_ALLOW_EPOCH_INITIALIZATION",
  );
  if (production && allowEpochInitialization) {
    throw new Error("RFQ_QUOTE_ISSUANCE_ALLOW_EPOCH_INITIALIZATION cannot be enabled in production");
  }
  const minReplicaAcks = integer(
    env,
    "RFQ_QUOTE_ISSUANCE_MIN_REPLICA_ACKS",
    production ? 1 : 0,
    0,
    5,
  );
  if (production && minReplicaAcks < 1) {
    throw new Error("RFQ_QUOTE_ISSUANCE_MIN_REPLICA_ACKS must be at least 1 in production");
  }
  const requireAof = readOptionalBoolean(
    readOwnEnvValue(env, "RFQ_QUOTE_ISSUANCE_REQUIRE_AOF"),
    backend === "redis-stream",
    "RFQ_QUOTE_ISSUANCE_REQUIRE_AOF",
  );
  if (production && !requireAof) {
    throw new Error("RFQ_QUOTE_ISSUANCE_REQUIRE_AOF cannot be disabled in production");
  }
  const hotStateTtlMs = integer(env, "RFQ_QUOTE_ISSUANCE_HOT_STATE_TTL_MS", 3_600_000, 60_000, 604_800_000);
  const idempotencyTtlMs = integer(
    env,
    "RFQ_QUOTE_ISSUANCE_IDEMPOTENCY_TTL_MS",
    86_400_000,
    hotStateTtlMs,
    2_592_000_000,
  );
  return {
    backend,
    ...(redisUrl ? { redisUrl } : {}),
    keyPrefix: readKeyPrefix(env),
    ledgerEpoch: readSafeIdentifier(
      env,
      "RFQ_QUOTE_ISSUANCE_LEDGER_EPOCH",
      production ? undefined : "local_v1",
      64,
    ),
    allowEpochInitialization,
    maxBacklog: integer(env, "RFQ_QUOTE_ISSUANCE_MAX_BACKLOG", 10_000, 1, 1_000_000),
    leaseMs: quoteIdempotencyLeaseMs,
    hotStateTtlMs,
    idempotencyTtlMs,
    minReplicaAcks,
    replicaAckTimeoutMs: integer(env, "RFQ_QUOTE_ISSUANCE_REPLICA_ACK_TIMEOUT_MS", 20, 1, 5_000),
    requireAof,
    projectionWaitTimeoutMs: integer(
      env,
      "RFQ_QUOTE_ISSUANCE_PROJECTION_WAIT_TIMEOUT_MS",
      1_000,
      1,
      30_000,
    ),
    projectionPollIntervalMs: integer(
      env,
      "RFQ_QUOTE_ISSUANCE_PROJECTION_POLL_INTERVAL_MS",
      5,
      1,
      1_000,
    ),
    mirrorGroup: readSafeIdentifier(env, "RFQ_QUOTE_ISSUANCE_MIRROR_GROUP", "quote_issuance_pg_v1", 128),
    mirrorConsumer: readSafeIdentifier(
      env,
      "RFQ_QUOTE_ISSUANCE_MIRROR_CONSUMER",
      defaultMirrorConsumer(env),
      128,
    ),
    mirrorBatchSize: integer(env, "RFQ_QUOTE_ISSUANCE_MIRROR_BATCH_SIZE", 100, 1, 1_000),
    mirrorBlockMs: integer(env, "RFQ_QUOTE_ISSUANCE_MIRROR_BLOCK_MS", 100, 0, 5_000),
    mirrorClaimIdleMs: integer(env, "RFQ_QUOTE_ISSUANCE_MIRROR_CLAIM_IDLE_MS", 30_000, 1_000, 3_600_000),
    mirrorRetryDelayMs: integer(env, "RFQ_QUOTE_ISSUANCE_MIRROR_RETRY_DELAY_MS", 100, 10, 60_000),
    postgresQueryTimeoutMs: integer(env, "RFQ_QUOTE_ISSUANCE_POSTGRES_TIMEOUT_MS", 2_000, 100, 10_000),
    requireTls: production,
  };
}

function createRedisQuoteIssuanceRuntime(
  pool: pg.Pool,
  config: QuoteIssuanceRuntimeConfig,
  metrics: MetricsService,
  logger: QuoteIssuanceRuntimeLogger,
): GatewayQuoteIssuanceRuntime {
  if (!config.redisUrl) throw new Error("Redis quote issuance runtime requires a Redis URL");
  const producer = createRedisQuoteIssuanceClient(config.redisUrl, { requireTls: config.requireTls });
  const consumer = createRedisQuoteIssuanceClient(config.redisUrl, { requireTls: config.requireTls });
  const store = new RedisQuoteIssuanceStore(producer, {
    keyPrefix: config.keyPrefix,
    ledgerEpoch: config.ledgerEpoch,
    allowEpochInitialization: config.allowEpochInitialization,
    maxBacklog: config.maxBacklog,
    leaseMs: config.leaseMs,
    hotStateTtlMs: config.hotStateTtlMs,
    idempotencyTtlMs: config.idempotencyTtlMs,
    minReplicaAcks: config.minReplicaAcks,
    replicaAckTimeoutMs: config.replicaAckTimeoutMs,
    requireAof: config.requireAof,
    projectionWaitTimeoutMs: config.projectionWaitTimeoutMs,
    projectionPollIntervalMs: config.projectionPollIntervalMs,
  }, metrics);
  const sink = new PostgresQuoteIssuanceJournalSink(pool, config.postgresQueryTimeoutMs);
  const mirror = new QuoteIssuanceJournalMirror(
    consumer as unknown as ConstructorParameters<typeof QuoteIssuanceJournalMirror>[0],
    sink,
    {
      streamKey: store.streamKey(),
      projectedKeyPrefix: `${config.keyPrefix}:projected`,
      projectionTtlMs: config.hotStateTtlMs,
      sourceEpoch: config.ledgerEpoch,
      group: config.mirrorGroup,
      consumer: config.mirrorConsumer,
      batchSize: config.mirrorBatchSize,
      blockMs: config.mirrorBlockMs,
      claimIdleMs: config.mirrorClaimIdleMs,
      retryDelayMs: config.mirrorRetryDelayMs,
    },
    metrics,
    logger,
  );
  let started = false;
  return {
    quoteIssuanceStore: store,
    quoteIdempotencyStore: store,
    redisStore: store,
    redisUrl: config.redisUrl,
    asynchronousProjection: true,
    awaitPreparedQuoteProjection(quoteId) {
      return store.awaitQuoteProjection(quoteId, "prepared");
    },
    async start() {
      if (started) return;
      try {
        await store.initialize();
        await mirror.start();
        await store.checkHealth();
        started = true;
      } catch (error) {
        await closeBestEffort(mirror);
        await closeBestEffort(store);
        throw error;
      }
    },
    async close() {
      await closeAll([mirror, store]);
      started = false;
    },
  };
}

function hasCustomQuotePersistence(options: BuildServerOptions): boolean {
  return options.marketSnapshotStore !== undefined ||
    options.quoteRepository !== undefined ||
    options.riskDecisionStore !== undefined ||
    options.quoteIdempotencyStore !== undefined;
}

function integer(
  env: Record<string, string | undefined>,
  name: string,
  defaultValue: number,
  min: number,
  max: number,
): number {
  return readDecimalIntegerConfig(readOwnEnvValue(env, name), { defaultValue, min, max, name });
}

function readSafeIdentifier(
  env: Record<string, string | undefined>,
  name: string,
  defaultValue: string | undefined,
  maxLength: number,
): string {
  const value = readOwnEnvValue(env, name) ?? defaultValue;
  if (!value || value.length > maxLength || !/^[A-Za-z][A-Za-z0-9_:-]*$/.test(value)) {
    throw new Error(`${name} must be a safe identifier with at most ${maxLength} characters`);
  }
  return value;
}

function readKeyPrefix(env: Record<string, string | undefined>): string {
  const value = readOwnEnvValue(env, "RFQ_QUOTE_ISSUANCE_KEY_PREFIX") ?? "rfq:{quote-state}:issuance";
  if (!/^rfq:\{[a-z0-9_-]{1,32}\}:[a-z0-9:_-]{1,48}$/.test(value)) {
    throw new Error("RFQ_QUOTE_ISSUANCE_KEY_PREFIX must use a bounded rfq:{hash-tag}: key");
  }
  return value;
}

function defaultMirrorConsumer(env: Record<string, string | undefined>): string {
  const hostname = readOwnEnvValue(env, "HOSTNAME");
  const normalized = hostname?.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 96);
  return `gateway_${normalized || "local"}_${process.pid}`;
}

async function closeBestEffort(resource: { close(): Promise<void> }): Promise<void> {
  try { await resource.close(); } catch {}
}

async function closeAll(resources: readonly { close(): Promise<void> }[]): Promise<void> {
  const results = await Promise.allSettled(resources.map((resource) => resource.close()));
  const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failure) throw failure.reason;
}
