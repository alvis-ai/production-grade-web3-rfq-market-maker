import { createHash } from "node:crypto";
import { hostname } from "node:os";
import Fastify from "fastify";
import { checkPoolHealth, endPool, getPool } from "./db/pool.js";
import { PostgresHedgeService } from "./modules/hedge/postgres-hedge.service.js";
import { DeltaNeutralHedgePlanner } from "./modules/hedge/hedge-intent-planner.js";
import { PostgresInventoryService } from "./modules/inventory/postgres-inventory.service.js";
import { PostgresMarketSnapshotStore } from "./modules/market-data/postgres-market-snapshot.repository.js";
import { PostgresPnlStore } from "./modules/pnl/postgres-pnl.store.js";
import { QuoteSnapshotPnlValuationProvider } from "./modules/pnl/quote-snapshot-valuation.provider.js";
import {
  ConfiguredTokenRegistry,
  defaultTokenRegistryConfig,
  parseTokenRegistryConfig,
  type TokenRegistry,
} from "./modules/pricing/token-registry.js";
import { PostgresQuoteRepository } from "./modules/quote/postgres-quote.repository.js";
import { PostTradeReconciliationMetrics } from "./modules/reconciliation/post-trade-reconciliation.metrics.js";
import {
  PostTradeReconciliationWorker,
  type PostTradeReconciliationWorkerConfig,
} from "./modules/reconciliation/post-trade-reconciliation.worker.js";
import { PostgresPostTradeReconciliationStore } from "./modules/reconciliation/postgres-post-trade-reconciliation.store.js";
import { ReconciliationService } from "./modules/reconciliation/reconciliation.service.js";
import { PostgresSettlementEventStore } from "./modules/settlement/postgres-settlement-event.store.js";
import { createStructuredLogger, logProcessFailure } from "./shared/logger/structured-logger.js";

export interface ReconciliationWorkerRuntimeConfig {
  worker: PostTradeReconciliationWorkerConfig;
  listenHost: string;
  listenPort: number;
}

export function readReconciliationWorkerRuntimeConfig(
  env: Record<string, string | undefined> | undefined = process.env,
): ReconciliationWorkerRuntimeConfig {
  const databaseUrl = readRequired(env, "DATABASE_URL");
  if (!/^postgres(?:ql)?:\/\//.test(databaseUrl)) {
    throw new Error("DATABASE_URL must use postgres:// or postgresql:// protocol");
  }
  return {
    worker: {
      workerId: readOptional(env, "RFQ_RECONCILIATION_WORKER_ID") ?? defaultWorkerId(),
      leaseMs: readInteger(env, "RFQ_RECONCILIATION_LEASE_MS", 30_000, 1_000, 300_000),
      pollIntervalMs: readInteger(env, "RFQ_RECONCILIATION_POLL_INTERVAL_MS", 250, 10, 60_000),
      retryDelayMs: readInteger(env, "RFQ_RECONCILIATION_RETRY_DELAY_MS", 1_000, 1, 3_600_000),
    },
    listenHost: readHost(env),
    listenPort: readInteger(env, "RFQ_RECONCILIATION_WORKER_PORT", 3003, 1, 65_535),
  };
}

export function readReconciliationTokenRegistry(
  env: Record<string, string | undefined> | undefined = process.env,
): TokenRegistry {
  const serialized = readOptional(env, "RFQ_TOKEN_REGISTRY_JSON");
  return new ConfiguredTokenRegistry(
    serialized === undefined ? defaultTokenRegistryConfig : parseTokenRegistryConfig(serialized),
  );
}

export async function startReconciliationWorker(): Promise<void> {
  const config = readReconciliationWorkerRuntimeConfig();
  const logger = createStructuredLogger("reconciliation-worker");
  const pool = getPool(undefined, logger);
  const inventory = new PostgresInventoryService(pool);
  const settlementEvents = new PostgresSettlementEventStore(pool, inventory);
  const quoteRepository = new PostgresQuoteRepository(pool);
  const hedgeService = new PostgresHedgeService(pool);
  const marketSnapshots = new PostgresMarketSnapshotStore(pool);
  const tokenRegistry = readReconciliationTokenRegistry();
  const pnlValuationProvider = new QuoteSnapshotPnlValuationProvider(
    marketSnapshots,
    tokenRegistry,
  );
  const pnlService = new PostgresPnlStore(pool, pnlValuationProvider);
  const store = new PostgresPostTradeReconciliationStore(pool);
  const reconciliation = new ReconciliationService({
    quoteRepository,
    settlementEventService: settlementEvents,
    hedgeService,
    pnlService,
  }, new DeltaNeutralHedgePlanner(tokenRegistry));
  const metrics = new PostTradeReconciliationMetrics();
  const worker = new PostTradeReconciliationWorker(store, reconciliation, config.worker, metrics, logger);
  const server = Fastify({ logger, disableRequestLogging: true });
  server.get("/health", async () => ({ status: "ok" }));
  server.get("/ready", async (_request, reply) => {
    try {
      await Promise.all([
        store.checkHealth(),
        quoteRepository.checkHealth(),
        hedgeService.checkHealth(),
        marketSnapshots.checkHealth(),
        pnlService.checkHealth(),
        settlementEvents.checkHealth(),
      ]);
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

  let signalHandlersRegistered = false;
  const stop = () => worker.stop();
  try {
    await checkPoolHealth(pool);
    await store.checkHealth();
    await server.listen({ host: config.listenHost, port: config.listenPort });
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    signalHandlersRegistered = true;
    await worker.run();
  } finally {
    worker.stop();
    if (signalHandlersRegistered) {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
    }
    await server.close();
    await endPool();
  }
}

function readRequired(env: Record<string, string | undefined> | undefined, name: string): string {
  const value = readOptional(env, name);
  if (!value) throw new Error(`${name} is required for the reconciliation worker`);
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
  const value = readOptional(env, "RFQ_RECONCILIATION_WORKER_HOST") ?? "0.0.0.0";
  if (value.length > 255 || /\s/.test(value)) {
    throw new Error("RFQ_RECONCILIATION_WORKER_HOST is invalid");
  }
  return value;
}

function defaultWorkerId(): string {
  const digest = createHash("sha256").update(`${hostname()}:${process.pid}`).digest("hex").slice(0, 16);
  return `reconciliation_worker_${digest}`;
}

const processLike = globalThis.process;
if (processLike?.argv?.[1] && import.meta.url.endsWith(processLike.argv[1])) {
  startReconciliationWorker().catch((error: unknown) => {
    logProcessFailure("reconciliation-worker", error);
    processLike.exitCode = 1;
  });
}
