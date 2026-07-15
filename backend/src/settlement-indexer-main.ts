import { createHash } from "node:crypto";
import { hostname } from "node:os";
import Fastify from "fastify";
import { assertDatabaseUrlForEnvironment } from "./db/config.js";
import { checkPoolHealth, endPool, getPool } from "./db/pool.js";
import { PostgresInventoryService } from "./modules/inventory/postgres-inventory.service.js";
import { PostgresSettlementIndexerStore } from "./modules/indexer/postgres-settlement-indexer.store.js";
import {
  parseSettlementIndexerConfig,
  type SettlementIndexerConfig,
} from "./modules/indexer/settlement-indexer.reader.js";
import { SettlementIndexerMetrics } from "./modules/indexer/settlement-indexer.metrics.js";
import {
  SettlementIndexerWorker,
  type SettlementIndexerWorkerConfig,
} from "./modules/indexer/settlement-indexer.worker.js";
import { PostgresQuoteRepository } from "./modules/quote/postgres-quote.repository.js";
import { PostgresSettlementEventStore } from "./modules/settlement/postgres-settlement-event.store.js";
import { installBoundedShutdown, readShutdownTimeoutMs, type BoundedShutdownController } from "./runtime/process-shutdown.js";
import { createStructuredLogger, logProcessFailure } from "./shared/logger/structured-logger.js";

export interface SettlementIndexerRuntimeConfig {
  indexer: SettlementIndexerConfig;
  worker: SettlementIndexerWorkerConfig;
  listenHost: string;
  listenPort: number;
  shutdownTimeoutMs: number;
}

export function readSettlementIndexerRuntimeConfig(
  env: Record<string, string | undefined> | undefined = process.env,
): SettlementIndexerRuntimeConfig {
  const nodeEnv = readOptional(env, "NODE_ENV");
  const databaseUrl = readRequired(env, "DATABASE_URL");
  assertDatabaseUrlForEnvironment(databaseUrl, nodeEnv);
  const indexer = parseSettlementIndexerConfig(readRequired(env, "RFQ_SETTLEMENT_INDEXER_CONFIG_JSON"));
  const worker = {
    workerId: readOptional(env, "RFQ_SETTLEMENT_INDEXER_WORKER_ID") ?? defaultWorkerId(),
    leaseMs: readInteger(env, "RFQ_SETTLEMENT_INDEXER_LEASE_MS", 30_000, 1_000, 300_000),
    pollIntervalMs: readInteger(env, "RFQ_SETTLEMENT_INDEXER_POLL_INTERVAL_MS", 1_000, 10, 60_000),
    readinessStaleMs: readInteger(env, "RFQ_SETTLEMENT_INDEXER_READINESS_STALE_MS", 60_000, 1_000, 600_000),
  };
  for (const chain of indexer.chains) {
    if (worker.leaseMs < chain.requestTimeoutMs * 2) {
      throw new Error("RFQ_SETTLEMENT_INDEXER_LEASE_MS must be at least twice every chain requestTimeoutMs");
    }
  }
  return {
    indexer,
    worker,
    listenHost: readHost(env),
    listenPort: readInteger(env, "RFQ_SETTLEMENT_INDEXER_PORT", 3004, 1, 65_535),
    shutdownTimeoutMs: readShutdownTimeoutMs(env),
  };
}

export async function startSettlementIndexer(): Promise<void> {
  const config = readSettlementIndexerRuntimeConfig();
  const logger = createStructuredLogger("settlement-indexer");
  const pool = getPool(undefined, logger);
  const inventory = new PostgresInventoryService(pool);
  const settlementEvents = new PostgresSettlementEventStore(pool, inventory);
  const quoteRepository = new PostgresQuoteRepository(pool);
  const store = new PostgresSettlementIndexerStore(pool);
  const metrics = new SettlementIndexerMetrics(config.indexer.chains.map(({ chainId }) => chainId));
  const worker = new SettlementIndexerWorker(
    config.indexer.chains,
    store,
    quoteRepository,
    settlementEvents,
    config.worker,
    metrics,
    logger,
  );
  const server = Fastify({ logger, disableRequestLogging: true });
  server.get("/health", async () => ({ status: "ok" }));
  server.get("/ready", async (_request, reply) => {
    try {
      await Promise.all([
        store.checkHealth(),
        quoteRepository.checkHealth(),
        settlementEvents.checkHealth(),
      ]);
      if (!worker.isReady()) throw new Error("Settlement indexer poll is stale");
      return { status: "ok" };
    } catch {
      return reply.code(503).send({ status: "degraded" });
    }
  });
  server.get("/metrics", async (_request, reply) => {
    let stats;
    try {
      stats = await store.stats();
    } catch {}
    return reply.type("text/plain").send(metrics.renderPrometheus(stats));
  });

  let shutdownController: BoundedShutdownController | undefined;
  const stop = () => worker.stop();
  try {
    await checkPoolHealth(pool);
    await settlementEvents.initialize();
    await worker.checkDependencies();
    await server.listen({ host: config.listenHost, port: config.listenPort });
    shutdownController = installBoundedShutdown({
      component: "settlement-indexer",
      logger,
      onShutdown: stop,
      processLike: process,
      timeoutMs: config.shutdownTimeoutMs,
    });
    await worker.run();
  } finally {
    worker.stop();
    await server.close();
    await endPool();
    shutdownController?.complete();
  }
}

function readRequired(env: Record<string, string | undefined> | undefined, name: string): string {
  const value = readOptional(env, name);
  if (!value) throw new Error(`${name} is required for the settlement indexer`);
  return value;
}

function readOptional(env: Record<string, string | undefined> | undefined, name: string): string | undefined {
  if (!env || !Object.hasOwn(env, name)) return undefined;
  const value = env[name];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`${name} must be a primitive string`);
  if (value.length === 0) return undefined;
  if (value.trim() !== value) throw new Error(`${name} must not contain surrounding whitespace`);
  return value;
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
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

function readHost(env: Record<string, string | undefined> | undefined): string {
  const value = readOptional(env, "RFQ_SETTLEMENT_INDEXER_HOST") ?? "0.0.0.0";
  if (value.length > 255 || /\s/.test(value)) {
    throw new Error("RFQ_SETTLEMENT_INDEXER_HOST is invalid");
  }
  return value;
}

function defaultWorkerId(): string {
  const digest = createHash("sha256").update(`${hostname()}:${process.pid}`).digest("hex").slice(0, 16);
  return `settlement_indexer_${digest}`;
}

const processLike = globalThis.process;
if (processLike?.argv?.[1] && import.meta.url.endsWith(processLike.argv[1])) {
  startSettlementIndexer().catch((error: unknown) => {
    logProcessFailure("settlement-indexer", error);
    processLike.exitCode = 1;
  });
}
