import type pg from "pg";
import type { IInventoryService } from "../modules/inventory/inventory.service.js";
import { RefreshingInventoryView } from "../modules/inventory/refreshing-inventory.view.js";
import { HotMarketSnapshotStore } from "../modules/market-data/hot-market-snapshot.store.js";
import type { MarketSnapshotStore } from "../modules/market-data/market-snapshot.repository.js";
import type { MetricsService } from "../modules/metrics/metrics.service.js";
import type { TokenRegistry } from "../modules/pricing/token-registry.js";
import { InMemoryPortfolioVarEvaluator } from "../modules/risk/in-memory-portfolio-var.js";
import { HealthGatedQuoteExposureStore } from "../modules/risk/health-gated-quote-exposure.store.js";
import { PostgresQuoteExposureLedgerSink } from "../modules/risk/postgres-quote-exposure-ledger.sink.js";
import {
  QuoteExposureLedgerMirror,
  type QuoteExposureProjectionBarrier,
} from "../modules/risk/quote-exposure-ledger.mirror.js";
import type { QuoteExposurePolicy, QuoteExposureStore } from "../modules/risk/quote-exposure.store.js";
import {
  createRedisQuoteExposureClient,
  RedisQuoteExposureStore,
  type RedisQuoteExposureClient,
} from "../modules/risk/redis-quote-exposure.store.js";
import {
  readDecimalIntegerConfig,
  readOptionalBoolean,
  readOwnEnvValue,
  requiresExplicitRuntimeConfig,
} from "./environment.js";

export type QuoteExposureRuntimeBackend = "postgres" | "redis-stream";

export interface QuoteExposureRuntimeConfig {
  backend: QuoteExposureRuntimeBackend;
  redisUrl?: string;
  keyPrefix: string;
  ledgerEpoch: string;
  allowEpochInitialization: boolean;
  maxBacklog: number;
  expiryGraceSeconds: number;
  cleanupLimit: number;
  lockTtlMs: number;
  lockAcquireTimeoutMs: number;
  minReplicaAcks: number;
  replicaAckTimeoutMs: number;
  requireAof: boolean;
  inventoryRefreshIntervalMs: number;
  inventoryMaxAgeMs: number;
  maxHotSnapshots: number;
  mirrorGroup: string;
  mirrorConsumer: string;
  mirrorBatchSize: number;
  mirrorBlockMs: number;
  mirrorClaimIdleMs: number;
  mirrorRetryDelayMs: number;
  mirrorCleanupLimit: number;
  mirrorCleanupIntervalMs: number;
  postgresQueryTimeoutMs: number;
  requireTls: boolean;
}

export interface RedisQuoteExposureRuntime {
  quoteExposureStore: QuoteExposureStore;
  inventoryService: IInventoryService;
  marketSnapshotStore: MarketSnapshotStore;
  start(): Promise<void>;
  close(): Promise<void>;
}

export interface GatewayQuoteExposureResolution {
  quoteExposureStore?: QuoteExposureStore;
  inventoryService: IInventoryService;
  marketSnapshotStore: MarketSnapshotStore;
  runtime?: RedisQuoteExposureRuntime;
}

export interface QuoteExposureRuntimeLogger {
  warn(fields: Readonly<Record<string, unknown>>, message: string): void;
}

export function resolveGatewayQuoteExposureRuntime(input: {
  configuredStore?: QuoteExposureStore;
  pool?: pg.Pool;
  policy?: QuoteExposurePolicy;
  tokenRegistry: TokenRegistry;
  canonicalInventoryService: IInventoryService;
  durableMarketSnapshotStore: MarketSnapshotStore;
  managedPairs: readonly { chainId: number }[];
  metrics: MetricsService;
  logger: QuoteExposureRuntimeLogger;
  asynchronousQuoteIssuance?: boolean;
  quoteProjectionBarrier?: QuoteExposureProjectionBarrier;
  resolveFallback(state: {
    inventoryService: IInventoryService;
    marketSnapshotStore: MarketSnapshotStore;
  }): QuoteExposureStore | undefined;
}): GatewayQuoteExposureResolution {
  const config = !input.configuredStore && input.pool && input.policy
    ? readQuoteExposureRuntimeConfig()
    : undefined;
  const runtime = config?.backend === "redis-stream"
    ? createRedisQuoteExposureRuntime({
        pool: input.pool!,
        policy: input.policy!,
        tokenRegistry: input.tokenRegistry,
        canonicalInventoryService: input.canonicalInventoryService,
        durableMarketSnapshotStore: input.durableMarketSnapshotStore,
        managedPairs: input.managedPairs,
        metrics: input.metrics,
        logger: input.logger,
        asynchronousQuoteIssuance: input.asynchronousQuoteIssuance === true,
        quoteProjectionBarrier: input.quoteProjectionBarrier,
        config,
      })
    : undefined;
  const inventoryService = runtime?.inventoryService ?? input.canonicalInventoryService;
  const marketSnapshotStore = runtime?.marketSnapshotStore ?? input.durableMarketSnapshotStore;
  const quoteExposureStore = runtime?.quoteExposureStore ?? input.configuredStore ??
    input.resolveFallback({ inventoryService, marketSnapshotStore });
  return {
    ...(quoteExposureStore ? { quoteExposureStore } : {}),
    inventoryService,
    marketSnapshotStore,
    ...(runtime ? { runtime } : {}),
  };
}

export function readQuoteExposureRuntimeConfig(
  env: Record<string, string | undefined> = process.env,
): QuoteExposureRuntimeConfig {
  const nodeEnv = readOwnEnvValue(env, "NODE_ENV");
  const production = requiresExplicitRuntimeConfig(nodeEnv);
  const configuredBackend = readOwnEnvValue(env, "RFQ_QUOTE_EXPOSURE_BACKEND");
  const backend = (configuredBackend?.trim().toLowerCase() || (production ? "redis-stream" : "postgres")) as
    QuoteExposureRuntimeBackend;
  if (backend !== "postgres" && backend !== "redis-stream") {
    throw new Error("RFQ_QUOTE_EXPOSURE_BACKEND must be postgres or redis-stream");
  }
  if (production && backend !== "redis-stream") {
    throw new Error(`RFQ_QUOTE_EXPOSURE_BACKEND must be redis-stream when NODE_ENV=${nodeEnv}`);
  }

  const inventoryRefreshIntervalMs = integer(env, "RFQ_QUOTE_INVENTORY_REFRESH_INTERVAL_MS", 100, 10, 60_000);
  const inventoryMaxAgeMs = integer(env, "RFQ_QUOTE_INVENTORY_MAX_AGE_MS", 1_000, 20, 300_000);
  if (inventoryMaxAgeMs < inventoryRefreshIntervalMs * 2) {
    throw new Error("RFQ_QUOTE_INVENTORY_MAX_AGE_MS must cover at least two refresh intervals");
  }
  const expiryGraceSeconds = integer(
    env,
    "RFQ_QUOTE_EXPOSURE_EXPIRY_GRACE_SECONDS",
    Math.max(2, Math.ceil(inventoryMaxAgeMs / 1_000) + 1),
    1,
    300,
  );
  if (expiryGraceSeconds * 1_000 <= inventoryMaxAgeMs) {
    throw new Error("RFQ_QUOTE_EXPOSURE_EXPIRY_GRACE_SECONDS must exceed quote inventory max age");
  }

  const allowEpochInitialization = readOptionalBoolean(
    readOwnEnvValue(env, "RFQ_QUOTE_EXPOSURE_ALLOW_EPOCH_INITIALIZATION"),
    !production,
    "RFQ_QUOTE_EXPOSURE_ALLOW_EPOCH_INITIALIZATION",
  );
  if (production && allowEpochInitialization) {
    throw new Error("RFQ_QUOTE_EXPOSURE_ALLOW_EPOCH_INITIALIZATION cannot be enabled in production");
  }
  const minReplicaAcks = integer(
    env,
    "RFQ_QUOTE_EXPOSURE_MIN_REPLICA_ACKS",
    production ? 1 : 0,
    0,
    5,
  );
  if (production && minReplicaAcks < 1) {
    throw new Error("RFQ_QUOTE_EXPOSURE_MIN_REPLICA_ACKS must be at least 1 in production");
  }
  const requireAof = readOptionalBoolean(
    readOwnEnvValue(env, "RFQ_QUOTE_EXPOSURE_REQUIRE_AOF"),
    backend === "redis-stream",
    "RFQ_QUOTE_EXPOSURE_REQUIRE_AOF",
  );
  if (production && !requireAof) {
    throw new Error("RFQ_QUOTE_EXPOSURE_REQUIRE_AOF cannot be disabled in production");
  }

  const redisUrl = readOwnEnvValue(env, "RFQ_QUOTE_EXPOSURE_REDIS_URL") ??
    readOwnEnvValue(env, "RFQ_REDIS_URL");
  if (backend === "redis-stream" && (!redisUrl || redisUrl.trim().length === 0)) {
    throw new Error("RFQ_QUOTE_EXPOSURE_REDIS_URL or RFQ_REDIS_URL is required for redis-stream");
  }
  const ledgerEpoch = readSafeIdentifier(
    env,
    "RFQ_QUOTE_EXPOSURE_LEDGER_EPOCH",
    production ? undefined : "local_v1",
    64,
  );
  const lockTtlMs = integer(env, "RFQ_QUOTE_EXPOSURE_LOCK_TTL_MS", 500, 10, 10_000);
  const lockAcquireTimeoutMs = integer(env, "RFQ_QUOTE_EXPOSURE_LOCK_ACQUIRE_TIMEOUT_MS", 100, 1, 5_000);
  if (lockAcquireTimeoutMs >= lockTtlMs) {
    throw new Error("RFQ_QUOTE_EXPOSURE_LOCK_ACQUIRE_TIMEOUT_MS must be less than lock TTL");
  }

  return {
    backend,
    ...(redisUrl ? { redisUrl } : {}),
    keyPrefix: readKeyPrefix(env),
    ledgerEpoch,
    allowEpochInitialization,
    maxBacklog: integer(env, "RFQ_QUOTE_EXPOSURE_MAX_BACKLOG", 10_000, 1, 1_000_000),
    expiryGraceSeconds,
    cleanupLimit: integer(env, "RFQ_QUOTE_EXPOSURE_CLEANUP_LIMIT", 1_000, 1, 10_000),
    lockTtlMs,
    lockAcquireTimeoutMs,
    minReplicaAcks,
    replicaAckTimeoutMs: integer(env, "RFQ_QUOTE_EXPOSURE_REPLICA_ACK_TIMEOUT_MS", 20, 1, 5_000),
    requireAof,
    inventoryRefreshIntervalMs,
    inventoryMaxAgeMs,
    maxHotSnapshots: integer(env, "RFQ_QUOTE_HOT_SNAPSHOT_MAX_ENTRIES", 10_000, 100, 1_000_000),
    mirrorGroup: readSafeIdentifier(env, "RFQ_QUOTE_EXPOSURE_MIRROR_GROUP", "quote_exposure_pg_v1", 128),
    mirrorConsumer: readSafeIdentifier(
      env,
      "RFQ_QUOTE_EXPOSURE_MIRROR_CONSUMER",
      defaultMirrorConsumer(env),
      128,
    ),
    mirrorBatchSize: integer(env, "RFQ_QUOTE_EXPOSURE_MIRROR_BATCH_SIZE", 100, 1, 1_000),
    mirrorBlockMs: integer(env, "RFQ_QUOTE_EXPOSURE_MIRROR_BLOCK_MS", 250, 0, 5_000),
    mirrorClaimIdleMs: integer(env, "RFQ_QUOTE_EXPOSURE_MIRROR_CLAIM_IDLE_MS", 30_000, 1_000, 3_600_000),
    mirrorRetryDelayMs: integer(env, "RFQ_QUOTE_EXPOSURE_MIRROR_RETRY_DELAY_MS", 100, 10, 60_000),
    mirrorCleanupLimit: integer(env, "RFQ_QUOTE_EXPOSURE_MIRROR_CLEANUP_LIMIT", 1_000, 1, 10_000),
    mirrorCleanupIntervalMs: integer(
      env,
      "RFQ_QUOTE_EXPOSURE_MIRROR_CLEANUP_INTERVAL_MS",
      10_000,
      1_000,
      600_000,
    ),
    postgresQueryTimeoutMs: integer(env, "RFQ_QUOTE_EXPOSURE_POSTGRES_TIMEOUT_MS", 2_000, 100, 10_000),
    requireTls: production,
  };
}

export function createRedisQuoteExposureRuntime(input: {
  pool: pg.Pool;
  policy: QuoteExposurePolicy;
  tokenRegistry: TokenRegistry;
  canonicalInventoryService: IInventoryService;
  durableMarketSnapshotStore: MarketSnapshotStore;
  managedPairs: readonly { chainId: number }[];
  metrics: MetricsService;
  logger: QuoteExposureRuntimeLogger;
  asynchronousQuoteIssuance?: boolean;
  quoteProjectionBarrier?: QuoteExposureProjectionBarrier;
  config: QuoteExposureRuntimeConfig;
}): RedisQuoteExposureRuntime {
  if (input.config.backend !== "redis-stream" || !input.config.redisUrl) {
    throw new Error("Redis quote exposure runtime requires redis-stream configuration");
  }
  const chainIds = managedChainIds(input.policy, input.managedPairs);
  const inventoryService = new RefreshingInventoryView(input.canonicalInventoryService, {
    chainIds,
    refreshIntervalMs: input.config.inventoryRefreshIntervalMs,
    maxAgeMs: input.config.inventoryMaxAgeMs,
  }, undefined, input.logger);
  const marketSnapshotStore = new HotMarketSnapshotStore(input.durableMarketSnapshotStore, {
    maxSnapshots: input.config.maxHotSnapshots,
  });
  const portfolioVarEvaluator = input.policy.portfolioVar
    ? new InMemoryPortfolioVarEvaluator(input.policy.portfolioVar, input.tokenRegistry, {
        inventoryService,
        marketSnapshotStore,
      })
    : undefined;
  const producer = createRedisQuoteExposureClient(input.config.redisUrl, {
    requireTls: input.config.requireTls,
  });
  const consumer = createRedisQuoteExposureClient(input.config.redisUrl, {
    requireTls: input.config.requireTls,
  });
  const store = new RedisQuoteExposureStore(
    producer,
    input.policy,
    input.tokenRegistry,
    portfolioVarEvaluator,
    {
      keyPrefix: input.config.keyPrefix,
      ledgerEpoch: input.config.ledgerEpoch,
      allowEpochInitialization: input.config.allowEpochInitialization,
      maxBacklog: input.config.maxBacklog,
      expiryGraceSeconds: input.config.expiryGraceSeconds,
      cleanupLimit: input.config.cleanupLimit,
      lockTtlMs: input.config.lockTtlMs,
      lockAcquireTimeoutMs: input.config.lockAcquireTimeoutMs,
      minReplicaAcks: input.config.minReplicaAcks,
      replicaAckTimeoutMs: input.config.replicaAckTimeoutMs,
      requireAof: input.config.requireAof,
    },
    input.metrics,
  );
  const sink = new PostgresQuoteExposureLedgerSink(input.pool, input.config.postgresQueryTimeoutMs);
  const mirror = new QuoteExposureLedgerMirror(
    consumer,
    sink,
    {
      streamKey: `${input.config.keyPrefix}:events`,
      sourceEpoch: input.config.ledgerEpoch,
      group: input.config.mirrorGroup,
      consumer: input.config.mirrorConsumer,
      batchSize: input.config.mirrorBatchSize,
      blockMs: input.config.mirrorBlockMs,
      claimIdleMs: input.config.mirrorClaimIdleMs,
      retryDelayMs: input.config.mirrorRetryDelayMs,
      cleanupLimit: input.config.mirrorCleanupLimit,
      cleanupIntervalMs: input.config.mirrorCleanupIntervalMs,
    },
    input.metrics,
    input.logger,
    Date.now,
    input.quoteProjectionBarrier,
  );
  let started = false;

  return {
    quoteExposureStore: input.asynchronousQuoteIssuance
      ? store
      : new HealthGatedQuoteExposureStore(store, mirror),
    inventoryService,
    marketSnapshotStore,
    async start() {
      if (started) return;
      try {
        await marketSnapshotStore.initialize(valuationPairs(input.policy));
        await inventoryService.start();
        await mirror.start();
        await store.initialize();
        await store.checkHealth();
        started = true;
      } catch (error) {
        inventoryService.stop();
        await closeBestEffort(mirror);
        await closeBestEffort(store);
        throw error;
      }
    },
    async close() {
      inventoryService.stop();
      await closeAll([mirror, store]);
      started = false;
    },
  };
}

function managedChainIds(
  policy: QuoteExposurePolicy,
  managedPairs: readonly { chainId: number }[],
): number[] {
  const ids = new Set(managedPairs.map((pair) => pair.chainId));
  for (const pair of policy.portfolioVar?.valuationPairs ?? []) ids.add(pair.chainId);
  if (ids.size === 0) {
    throw new Error("Redis quote exposure runtime requires at least one portfolio valuation chain");
  }
  return [...ids].sort((left, right) => left - right);
}

function valuationPairs(policy: QuoteExposurePolicy) {
  return (policy.portfolioVar?.valuationPairs ?? []).map((pair) => ({
    chainId: pair.chainId,
    tokenA: pair.tokenAddress,
    tokenB: pair.usdReferenceTokenAddress,
  }));
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
  const value = readOwnEnvValue(env, "RFQ_QUOTE_EXPOSURE_KEY_PREFIX") ?? "rfq:{quote-exposure}:ledger";
  if (!/^rfq:\{[a-z0-9_-]{1,32}\}:[a-z0-9:_-]{1,48}$/.test(value)) {
    throw new Error("RFQ_QUOTE_EXPOSURE_KEY_PREFIX must use a bounded rfq:{hash-tag}: key");
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
