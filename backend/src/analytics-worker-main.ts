import { createHash } from "node:crypto";
import { hostname } from "node:os";
import Fastify from "fastify";
import { assertDatabaseUrlForEnvironment } from "./db/config.js";
import { checkPoolHealth, endPool, getPool } from "./db/pool.js";
import {
  AnalyticsOutboxPublisher,
  assertAnalyticsOutboxPublisherConfig,
  type AnalyticsOutboxPublisherConfig,
} from "./modules/analytics/analytics-outbox.publisher.js";
import { AnalyticsWorkerMetrics } from "./modules/analytics/analytics-worker.metrics.js";
import {
  assertClickHouseAnalyticsConfig,
  ClickHouseAnalyticsSink,
  type ClickHouseAnalyticsConfig,
} from "./modules/analytics/clickhouse-analytics.sink.js";
import {
  assertAnalyticsKafkaConsumerConfig,
  KafkaAnalyticsConsumer,
  type AnalyticsKafkaConsumerConfig,
} from "./modules/analytics/kafka-analytics.consumer.js";
import {
  assertAnalyticsKafkaConfig,
  KafkaAnalyticsProducer,
  type AnalyticsKafkaConfig,
  type AnalyticsKafkaSaslConfig,
} from "./modules/analytics/kafka-analytics.producer.js";
import { PostgresAnalyticsOutboxStore } from "./modules/analytics/postgres-analytics-outbox.store.js";
import { requiresExplicitRuntimeConfig } from "./runtime/environment.js";
import { createStructuredLogger, logProcessFailure } from "./shared/logger/structured-logger.js";

export interface AnalyticsWorkerRuntimeConfig {
  publisher: AnalyticsOutboxPublisherConfig;
  kafka: AnalyticsKafkaConfig;
  consumer: AnalyticsKafkaConsumerConfig;
  clickhouse: ClickHouseAnalyticsConfig;
  listenHost: string;
  listenPort: number;
}

const analyticsTopic = "rfq.analytics.v1";

export function readAnalyticsWorkerRuntimeConfig(
  env: Record<string, string | undefined> | undefined = process.env,
): AnalyticsWorkerRuntimeConfig {
  const nodeEnv = readOptional(env, "NODE_ENV");
  const databaseUrl = readRequired(env, "DATABASE_URL");
  assertDatabaseUrlForEnvironment(databaseUrl, nodeEnv);
  const brokers = readCsv(env, "RFQ_ANALYTICS_KAFKA_BROKERS");
  const clientId = readOptional(env, "RFQ_ANALYTICS_KAFKA_CLIENT_ID") ?? "rfq-analytics";
  const connectionTimeoutMs = readInteger(env, "RFQ_ANALYTICS_KAFKA_CONNECTION_TIMEOUT_MS", 10_000, 100, 60_000);
  const requestTimeoutMs = readInteger(env, "RFQ_ANALYTICS_KAFKA_REQUEST_TIMEOUT_MS", 10_000, 100, 120_000);
  const sasl = readKafkaSasl(env);
  const kafka: AnalyticsKafkaConfig = {
    brokers,
    clientId,
    ssl: readBoolean(env, "RFQ_ANALYTICS_KAFKA_SSL", false),
    ...(sasl ? { sasl } : {}),
    connectionTimeoutMs,
    requestTimeoutMs,
  };
  const batchSize = readInteger(env, "RFQ_ANALYTICS_BATCH_SIZE", 10, 1, 500);
  const leaseMs = readInteger(env, "RFQ_ANALYTICS_LEASE_MS", 120_000, 1_000, 300_000);
  if (leaseMs <= batchSize * requestTimeoutMs + 1_000) {
    throw new Error("RFQ_ANALYTICS_LEASE_MS must exceed batch size times Kafka request timeout plus 1000ms");
  }
  const configuredTopic = readOptional(env, "RFQ_ANALYTICS_KAFKA_TOPIC") ?? analyticsTopic;
  if (configuredTopic !== analyticsTopic) {
    throw new Error(`RFQ_ANALYTICS_KAFKA_TOPIC must be ${analyticsTopic}`);
  }
  const config: AnalyticsWorkerRuntimeConfig = {
    publisher: {
      workerId: readOptional(env, "RFQ_ANALYTICS_WORKER_ID") ?? defaultWorkerId(),
      leaseMs,
      batchSize,
      pollIntervalMs: readInteger(env, "RFQ_ANALYTICS_POLL_INTERVAL_MS", 250, 10, 60_000),
      retryDelayMs: readInteger(env, "RFQ_ANALYTICS_RETRY_DELAY_MS", 1_000, 1, 3_600_000),
      retentionMs: readInteger(env, "RFQ_ANALYTICS_OUTBOX_RETENTION_MS", 604_800_000, 3_600_000, 2_592_000_000),
      cleanupIntervalMs: readInteger(env, "RFQ_ANALYTICS_CLEANUP_INTERVAL_MS", 3_600_000, 1_000, 86_400_000),
      cleanupBatchSize: readInteger(env, "RFQ_ANALYTICS_CLEANUP_BATCH_SIZE", 1_000, 1, 10_000),
    },
    kafka,
    consumer: {
      ...kafka,
      topic: configuredTopic,
      groupId: readOptional(env, "RFQ_ANALYTICS_KAFKA_GROUP_ID") ?? "rfq-clickhouse-v1",
      sessionTimeoutMs: readInteger(env, "RFQ_ANALYTICS_KAFKA_SESSION_TIMEOUT_MS", 30_000, 1_000, 300_000),
      heartbeatIntervalMs: readInteger(env, "RFQ_ANALYTICS_KAFKA_HEARTBEAT_INTERVAL_MS", 3_000, 100, 100_000),
    },
    clickhouse: {
      url: readRequired(env, "RFQ_CLICKHOUSE_URL"),
      username: readOptional(env, "RFQ_CLICKHOUSE_USERNAME") ?? "default",
      password: readSecret(env, "RFQ_CLICKHOUSE_PASSWORD", true),
      database: readOptional(env, "RFQ_CLICKHOUSE_DATABASE") ?? "default",
      table: readOptional(env, "RFQ_CLICKHOUSE_ANALYTICS_TABLE") ?? "rfq_analytics_events",
      requestTimeoutMs: readInteger(env, "RFQ_CLICKHOUSE_REQUEST_TIMEOUT_MS", 10_000, 100, 120_000),
    },
    listenHost: readHost(env),
    listenPort: readInteger(env, "RFQ_ANALYTICS_WORKER_PORT", 3002, 1, 65_535),
  };
  assertAnalyticsOutboxPublisherConfig(config.publisher);
  assertAnalyticsKafkaConfig(config.kafka);
  assertAnalyticsKafkaConsumerConfig(config.consumer);
  assertClickHouseAnalyticsConfig(config.clickhouse);
  assertProductionAnalyticsTransportSecurity(config, nodeEnv);
  return config;
}

function assertProductionAnalyticsTransportSecurity(
  config: AnalyticsWorkerRuntimeConfig,
  nodeEnv: string | undefined,
): void {
  if (!requiresExplicitRuntimeConfig(nodeEnv)) return;
  if (!config.kafka.ssl) {
    throw new Error(`RFQ_ANALYTICS_KAFKA_SSL must be true when NODE_ENV=${nodeEnv}`);
  }
  if (!config.kafka.sasl) {
    throw new Error(`Analytics Kafka SASL credentials are required when NODE_ENV=${nodeEnv}`);
  }
  if (new URL(config.clickhouse.url).protocol !== "https:") {
    throw new Error(`RFQ_CLICKHOUSE_URL must use https:// when NODE_ENV=${nodeEnv}`);
  }
}

export async function startAnalyticsWorker(): Promise<void> {
  const config = readAnalyticsWorkerRuntimeConfig();
  const logger = createStructuredLogger("analytics-worker");
  const pool = getPool(undefined, logger);
  const store = new PostgresAnalyticsOutboxStore(pool);
  const sink = new ClickHouseAnalyticsSink(config.clickhouse);
  const producer = new KafkaAnalyticsProducer(config.kafka);
  const metrics = new AnalyticsWorkerMetrics();
  const publisher = new AnalyticsOutboxPublisher(store, producer, config.publisher, metrics, logger);
  const consumer = new KafkaAnalyticsConsumer(config.consumer, sink, metrics);
  const server = Fastify({ logger, disableRequestLogging: true });
  server.get("/health", async () => ({ status: "ok" }));
  server.get("/ready", async (_request, reply) => {
    try {
      await Promise.all([store.checkHealth(), sink.checkHealth()]);
      if (!producer.isConnected() || !consumer.isReady()) throw new Error("Analytics Kafka client is not ready");
      return { status: "ok" };
    } catch {
      return reply.code(503).send({ status: "degraded" });
    }
  });
  server.get("/metrics", async (_request, reply) => {
    let stats;
    try {
      const retentionCutoff = new Date(Date.now() - config.publisher.retentionMs).toISOString();
      stats = await store.stats(retentionCutoff);
    } catch {}
    return reply.type("text/plain").send(metrics.renderPrometheus(stats));
  });

  let stopping = false;
  let signalHandlersRegistered = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    publisher.stop();
    void consumer.stop().catch(() => {});
  };
  try {
    await checkPoolHealth(pool);
    await store.checkHealth();
    await sink.initialize();
    await sink.checkHealth();
    await producer.connect();
    await consumer.connect();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    signalHandlersRegistered = true;
    await consumer.run();
    const fatalConsumerTask = consumer.waitForFatal();
    await server.listen({ host: config.listenHost, port: config.listenPort });
    await Promise.race([publisher.run(), fatalConsumerTask]);
  } finally {
    stop();
    if (signalHandlersRegistered) {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
    }
    await Promise.allSettled([server.close(), consumer.disconnect(), producer.disconnect(), sink.close()]);
    await endPool();
  }
}

function readKafkaSasl(env: Record<string, string | undefined> | undefined): AnalyticsKafkaSaslConfig | undefined {
  const mechanism = readOptional(env, "RFQ_ANALYTICS_KAFKA_SASL_MECHANISM");
  const username = readRawOptional(env, "RFQ_ANALYTICS_KAFKA_SASL_USERNAME");
  const password = readRawOptional(env, "RFQ_ANALYTICS_KAFKA_SASL_PASSWORD");
  if (!mechanism && !username && !password) return undefined;
  if (mechanism !== "plain" && mechanism !== "scram-sha-256" && mechanism !== "scram-sha-512") {
    throw new Error("RFQ_ANALYTICS_KAFKA_SASL_MECHANISM is invalid");
  }
  if (!username || !password) throw new Error("Kafka SASL username and password are required together");
  rejectPlaceholder(username, "RFQ_ANALYTICS_KAFKA_SASL_USERNAME");
  rejectPlaceholder(password, "RFQ_ANALYTICS_KAFKA_SASL_PASSWORD");
  return { mechanism, username, password };
}

function readCsv(env: Record<string, string | undefined> | undefined, name: string): string[] {
  const value = readRequired(env, name);
  const entries = value.split(",").map((entry) => entry.trim());
  if (entries.some((entry) => entry.length === 0)) throw new Error(`${name} must be a comma-separated non-empty list`);
  return entries;
}

function readRequired(env: Record<string, string | undefined> | undefined, name: string): string {
  const value = readOptional(env, name);
  if (!value) throw new Error(`${name} is required for the analytics worker`);
  return value;
}

function readSecret(
  env: Record<string, string | undefined> | undefined,
  name: string,
  allowEmpty: boolean,
): string {
  const raw = env && Object.hasOwn(env, name) ? env[name] : undefined;
  if (raw === undefined || raw === "") {
    if (allowEmpty) return "";
    throw new Error(`${name} is required for the analytics worker`);
  }
  const value = raw;
  rejectPlaceholder(value, name);
  return value;
}

function rejectPlaceholder(value: string, name: string): void {
  if (value.trim().startsWith("replace-with-")) throw new Error(`${name} placeholder must be replaced`);
}

function readRawOptional(env: Record<string, string | undefined> | undefined, name: string): string | undefined {
  if (!env || !Object.hasOwn(env, name)) return undefined;
  const value = env[name];
  if (value === undefined || value.length === 0) return undefined;
  return value;
}

function readOptional(env: Record<string, string | undefined> | undefined, name: string): string | undefined {
  if (!env || !Object.hasOwn(env, name)) return undefined;
  const value = env[name];
  if (value === undefined || value.trim().length === 0) return undefined;
  return value.trim();
}

function readInteger(
  env: Record<string, string | undefined> | undefined,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = readOptional(env, name);
  if (value === undefined) return fallback;
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error(`${name} must be an integer between ${min} and ${max}`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

function readBoolean(
  env: Record<string, string | undefined> | undefined,
  name: string,
  fallback: boolean,
): boolean {
  const value = readOptional(env, name);
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false`);
}

function readHost(env: Record<string, string | undefined> | undefined): string {
  const value = readOptional(env, "RFQ_ANALYTICS_WORKER_HOST") ?? "0.0.0.0";
  if (value.length > 255 || /\s/.test(value)) throw new Error("RFQ_ANALYTICS_WORKER_HOST is invalid");
  return value;
}

function defaultWorkerId(): string {
  const digest = createHash("sha256").update(`${hostname()}:${process.pid}`).digest("hex").slice(0, 16);
  return `analytics_worker_${digest}`;
}

const processLike = globalThis.process;
if (processLike?.argv?.[1] && import.meta.url.endsWith(processLike.argv[1])) {
  startAnalyticsWorker().catch((error: unknown) => {
    logProcessFailure("analytics-worker", error);
    processLike.exitCode = 1;
  });
}
