import { Redis } from "ioredis";
import type { DatabaseConfig } from "../../db/config.js";
import { readDatabaseConfig } from "../../db/config.js";
import { getPool } from "../../db/pool.js";
import { readDecimalIntegerConfig, readOwnEnvValue } from "../../runtime/environment.js";
import { normalizeRedisUrl } from "../../shared/redis/redis-url.js";
import type { StructuredLogger } from "../../shared/logger/structured-logger.js";
import {
  InMemorySignerAuditStore,
  PostgresSignerAuditStore,
  type SignerAuditStore,
} from "./signer-audit.store.js";
import {
  RedisSignerAuditStore,
  type RedisSignerAuditClient,
} from "./redis-signer-audit.store.js";
import {
  SignerAuditMirror,
  type RedisSignerAuditConsumerClient,
} from "./signer-audit-mirror.js";
import { SignerAuditStreamMetrics } from "./signer-audit-stream.metrics.js";
import type { SignerAuditMetricsProvider } from "./signer-server.js";
import type { SignerQuoteCommitObserver } from "./redis-signer-quote-commit.store.js";

const redisAuditFields = [
  "RFQ_SIGNER_AUDIT_REDIS_URL",
  "RFQ_SIGNER_AUDIT_STREAM_KEY",
  "RFQ_SIGNER_AUDIT_STREAM_EPOCH",
  "RFQ_SIGNER_AUDIT_MAX_BACKLOG",
  "RFQ_SIGNER_AUDIT_DEDUPE_TTL_MS",
  "RFQ_SIGNER_AUDIT_MIN_REPLICA_ACKS",
  "RFQ_SIGNER_AUDIT_REPLICA_ACK_TIMEOUT_MS",
  "RFQ_SIGNER_AUDIT_GROUP",
  "RFQ_SIGNER_AUDIT_CONSUMER_ID",
  "RFQ_SIGNER_AUDIT_BATCH_SIZE",
  "RFQ_SIGNER_AUDIT_BLOCK_MS",
  "RFQ_SIGNER_AUDIT_CLAIM_IDLE_MS",
  "RFQ_SIGNER_AUDIT_RETRY_DELAY_MS",
] as const;

export type SignerAuditProcessConfig =
  | { backend: "memory" }
  | { backend: "postgres"; database: DatabaseConfig; queryTimeoutMs: number }
  | {
      backend: "redis-stream";
      database: DatabaseConfig;
      queryTimeoutMs: number;
      redisUrl: string;
      streamKey: string;
      sourceEpoch: string;
      maxBacklog: number;
      dedupeTtlMs: number;
      minReplicaAcks: number;
      replicaAckTimeoutMs: number;
      requireAof: true;
      group: string;
      consumer: string;
      batchSize: number;
      blockMs: number;
      claimIdleMs: number;
      retryDelayMs: number;
    };

export interface SignerAuditRuntime {
  store: SignerAuditStore;
  metrics?: SignerAuditMetricsProvider;
  quoteCommitObserver?: SignerQuoteCommitObserver;
  usesPostgres: boolean;
  start(): Promise<void>;
  close(): Promise<void>;
}

export function readSignerAuditProcessConfig(
  env: Record<string, string | undefined> | undefined,
): SignerAuditProcessConfig {
  const nodeEnv = readOwnEnvValue(env, "NODE_ENV");
  const localEnvironment = isLocalEnvironment(nodeEnv);
  const backend = readOwnEnvValue(env, "RFQ_SIGNER_AUDIT_BACKEND") ?? (localEnvironment ? "memory" : undefined);
  const databaseUrl = readOwnEnvValue(env, "RFQ_SIGNER_AUDIT_DATABASE_URL");
  const timeoutValue = readOwnEnvValue(env, "RFQ_SIGNER_AUDIT_TIMEOUT_MS");
  if (backend !== "memory" && backend !== "postgres" && backend !== "redis-stream") {
    throw new Error("RFQ_SIGNER_AUDIT_BACKEND must be memory, postgres, or redis-stream");
  }
  if (backend === "memory") {
    if (!localEnvironment) {
      throw new Error(`RFQ_SIGNER_AUDIT_BACKEND=memory is not allowed when NODE_ENV=${nodeEnv}`);
    }
    rejectConfigured(env, ["RFQ_SIGNER_AUDIT_DATABASE_URL", "RFQ_SIGNER_AUDIT_TIMEOUT_MS", ...redisAuditFields],
      "Signer audit persistence settings require a durable backend");
    return { backend };
  }

  const database = readAuditDatabase(nodeEnv, databaseUrl);
  const queryTimeoutMs = readInteger(timeoutValue, "RFQ_SIGNER_AUDIT_TIMEOUT_MS", 2_000, 100, 10_000);
  if (backend === "postgres") {
    rejectConfigured(env, redisAuditFields, "Signer audit Redis settings require RFQ_SIGNER_AUDIT_BACKEND=redis-stream");
    return { backend, database, queryTimeoutMs };
  }

  const minReplicaAcksValue = readOwnEnvValue(env, "RFQ_SIGNER_AUDIT_MIN_REPLICA_ACKS");
  if (!localEnvironment && minReplicaAcksValue === undefined) {
    throw new Error("RFQ_SIGNER_AUDIT_MIN_REPLICA_ACKS is required outside local environments");
  }
  const minReplicaAcks = readInteger(
    minReplicaAcksValue,
    "RFQ_SIGNER_AUDIT_MIN_REPLICA_ACKS",
    0,
    0,
    5,
  );
  if (!localEnvironment && minReplicaAcks < 1) {
    throw new Error("RFQ_SIGNER_AUDIT_MIN_REPLICA_ACKS must be at least 1 outside local environments");
  }
  const sourceEpochValue = readOwnEnvValue(env, "RFQ_SIGNER_AUDIT_STREAM_EPOCH");
  if (!localEnvironment && sourceEpochValue === undefined) {
    throw new Error("RFQ_SIGNER_AUDIT_STREAM_EPOCH is required outside local environments");
  }
  return {
    backend,
    database,
    queryTimeoutMs,
    redisUrl: readAuditRedisUrl(env, !localEnvironment),
    streamKey: readSafeKey(env, "RFQ_SIGNER_AUDIT_STREAM_KEY", "rfq:{signer-audit}:events:v1"),
    sourceEpoch: readSafeEpoch(sourceEpochValue ?? "local_v1"),
    maxBacklog: readInteger(
      readOwnEnvValue(env, "RFQ_SIGNER_AUDIT_MAX_BACKLOG"),
      "RFQ_SIGNER_AUDIT_MAX_BACKLOG",
      10_000,
      1,
      1_000_000,
    ),
    dedupeTtlMs: readInteger(
      readOwnEnvValue(env, "RFQ_SIGNER_AUDIT_DEDUPE_TTL_MS"),
      "RFQ_SIGNER_AUDIT_DEDUPE_TTL_MS",
      86_400_000,
      60_000,
      604_800_000,
    ),
    minReplicaAcks,
    replicaAckTimeoutMs: readInteger(
      readOwnEnvValue(env, "RFQ_SIGNER_AUDIT_REPLICA_ACK_TIMEOUT_MS"),
      "RFQ_SIGNER_AUDIT_REPLICA_ACK_TIMEOUT_MS",
      50,
      1,
      5_000,
    ),
    requireAof: true,
    group: readSafeIdentifier(env, "RFQ_SIGNER_AUDIT_GROUP", "rfq_signer_audit_pg_v1"),
    consumer: readConsumerId(env),
    batchSize: readInteger(
      readOwnEnvValue(env, "RFQ_SIGNER_AUDIT_BATCH_SIZE"),
      "RFQ_SIGNER_AUDIT_BATCH_SIZE",
      100,
      1,
      1_000,
    ),
    blockMs: readInteger(
      readOwnEnvValue(env, "RFQ_SIGNER_AUDIT_BLOCK_MS"),
      "RFQ_SIGNER_AUDIT_BLOCK_MS",
      500,
      0,
      5_000,
    ),
    claimIdleMs: readInteger(
      readOwnEnvValue(env, "RFQ_SIGNER_AUDIT_CLAIM_IDLE_MS"),
      "RFQ_SIGNER_AUDIT_CLAIM_IDLE_MS",
      5_000,
      1_000,
      3_600_000,
    ),
    retryDelayMs: readInteger(
      readOwnEnvValue(env, "RFQ_SIGNER_AUDIT_RETRY_DELAY_MS"),
      "RFQ_SIGNER_AUDIT_RETRY_DELAY_MS",
      100,
      10,
      60_000,
    ),
  };
}

export function createSignerAuditRuntime(
  config: SignerAuditProcessConfig,
  logger: StructuredLogger,
): SignerAuditRuntime {
  if (config.backend === "memory") {
    return staticRuntime(new InMemorySignerAuditStore(), false);
  }
  const pool = getPool(config.database, logger);
  const postgres = new PostgresSignerAuditStore(pool, config.queryTimeoutMs);
  if (config.backend === "postgres") return staticRuntime(postgres, true);

  const metrics = new SignerAuditStreamMetrics();
  const producer = createRedisClient(config.redisUrl) as unknown as RedisSignerAuditClient;
  const consumer = createRedisClient(config.redisUrl) as unknown as RedisSignerAuditConsumerClient;
  const store = new RedisSignerAuditStore(producer, {
    streamKey: config.streamKey,
    maxBacklog: config.maxBacklog,
    dedupeTtlMs: config.dedupeTtlMs,
    minReplicaAcks: config.minReplicaAcks,
    replicaAckTimeoutMs: config.replicaAckTimeoutMs,
    requireAof: config.requireAof,
  }, metrics);
  const mirror = new SignerAuditMirror(consumer, postgres, {
    streamKey: config.streamKey,
    sourceEpoch: config.sourceEpoch,
    group: config.group,
    consumer: config.consumer,
    batchSize: config.batchSize,
    blockMs: config.blockMs,
    claimIdleMs: config.claimIdleMs,
    retryDelayMs: config.retryDelayMs,
  }, metrics, logger);
  return {
    store,
    metrics,
    quoteCommitObserver: metrics,
    usesPostgres: true,
    start: () => mirror.start(),
    close: async () => {
      await mirror.close();
      await store.close();
    },
  };
}

function staticRuntime(store: SignerAuditStore, usesPostgres: boolean): SignerAuditRuntime {
  return {
    store,
    usesPostgres,
    async start() {
      await store.checkHealth();
    },
    async close() {},
  };
}

function createRedisClient(redisUrl: string): Redis {
  return new Redis(redisUrl, {
    connectTimeout: 2_000,
    enableOfflineQueue: false,
    enableReadyCheck: true,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy(attempt: number) {
      return attempt <= 3 ? Math.min(100 * 2 ** (attempt - 1), 1_000) : null;
    },
  });
}

function readAuditDatabase(nodeEnv: string | undefined, databaseUrl: string | undefined): DatabaseConfig {
  if (databaseUrl === undefined || databaseUrl.length === 0 || databaseUrl.trim() !== databaseUrl ||
      databaseUrl.startsWith("replace-with-")) {
    throw new Error("RFQ_SIGNER_AUDIT_DATABASE_URL is required for durable signer audit backends");
  }
  return readDatabaseConfig({ NODE_ENV: nodeEnv, DATABASE_URL: databaseUrl });
}

function readAuditRedisUrl(
  env: Record<string, string | undefined> | undefined,
  requireTls: boolean,
): string {
  const value = readOwnEnvValue(env, "RFQ_SIGNER_AUDIT_REDIS_URL");
  if (value === undefined) throw new Error("RFQ_SIGNER_AUDIT_REDIS_URL is required for redis-stream audit");
  try {
    return normalizeRedisUrl(value, { requireTls });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Redis URL is invalid";
    throw new Error(message.replace(/^Redis URL/, "RFQ_SIGNER_AUDIT_REDIS_URL"));
  }
}

function readSafeKey(
  env: Record<string, string | undefined> | undefined,
  field: string,
  fallback: string,
): string {
  const value = readOwnEnvValue(env, field) ?? fallback;
  if (!/^rfq:\{[a-z0-9_-]{1,32}\}:[a-z0-9:_-]{1,64}$/.test(value)) {
    throw new Error(`${field} must use a bounded rfq:{hash-tag}: key`);
  }
  return value;
}

function readSafeIdentifier(
  env: Record<string, string | undefined> | undefined,
  field: string,
  fallback: string,
): string {
  const value = readOwnEnvValue(env, field) ?? fallback;
  if (!/^[A-Za-z0-9_:-]{1,128}$/.test(value)) {
    throw new Error(`${field} must be a safe identifier`);
  }
  return value;
}

function readSafeEpoch(value: string): string {
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value)) {
    throw new Error("RFQ_SIGNER_AUDIT_STREAM_EPOCH must be a safe epoch identifier");
  }
  return value;
}

function readConsumerId(env: Record<string, string | undefined> | undefined): string {
  const configured = readOwnEnvValue(env, "RFQ_SIGNER_AUDIT_CONSUMER_ID") ?? readOwnEnvValue(env, "HOSTNAME");
  return readSafeIdentifier(
    configured === undefined ? { RFQ_SIGNER_AUDIT_CONSUMER_ID: "signer_process" } :
      { RFQ_SIGNER_AUDIT_CONSUMER_ID: configured },
    "RFQ_SIGNER_AUDIT_CONSUMER_ID",
    "signer_process",
  );
}

function readInteger(value: string | undefined, name: string, defaultValue: number, min: number, max: number): number {
  if (value !== undefined && !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`${name} must be a base-10 integer between ${min} and ${max}`);
  }
  return readDecimalIntegerConfig(value, { defaultValue, min, max, name });
}

function rejectConfigured(
  env: Record<string, string | undefined> | undefined,
  fields: readonly string[],
  message: string,
): void {
  if (fields.some((field) => readOwnEnvValue(env, field) !== undefined)) throw new Error(message);
}

function isLocalEnvironment(nodeEnv: string | undefined): boolean {
  return nodeEnv === undefined || nodeEnv === "development" || nodeEnv === "test";
}
