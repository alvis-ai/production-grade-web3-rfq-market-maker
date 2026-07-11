import { createHash } from "node:crypto";
import { hostname } from "node:os";
import Fastify from "fastify";
import { checkPoolHealth, endPool, getPool } from "./db/pool.js";
import { BinanceSpotAdapter, type BinanceSpotAdapterConfig } from "./modules/hedge/binance-spot.adapter.js";
import { HedgeWorker, HedgeWorkerMetrics, type HedgeWorkerConfig } from "./modules/hedge/hedge-worker.js";
import { parseHedgeRoutesJson, type HedgeRouteTable } from "./modules/hedge/hedge-route.js";
import { PostgresHedgeJobStore } from "./modules/hedge/postgres-hedge-job.store.js";

export interface HedgeWorkerRuntimeConfig {
  worker: HedgeWorkerConfig;
  routes: HedgeRouteTable;
  binance: BinanceSpotAdapterConfig;
  listenHost: string;
  listenPort: number;
}

export function readHedgeWorkerRuntimeConfig(
  env: Record<string, string | undefined> | undefined = process.env,
): HedgeWorkerRuntimeConfig {
  const databaseUrl = readRequired(env, "DATABASE_URL");
  if (!/^postgres(?:ql)?:\/\//.test(databaseUrl)) {
    throw new Error("DATABASE_URL must use postgres:// or postgresql:// protocol");
  }
  const routes = parseHedgeRoutesJson(readRequired(env, "RFQ_HEDGE_ROUTES_JSON"));
  const workerId = readOptional(env, "RFQ_HEDGE_WORKER_ID") ?? defaultWorkerId();
  const baseUrl = readOptional(env, "RFQ_BINANCE_BASE_URL");
  const leaseMs = readInteger(env, "RFQ_HEDGE_LEASE_MS", 30_000, 1_000, 300_000);
  const requestTimeoutMs = readInteger(env, "RFQ_BINANCE_REQUEST_TIMEOUT_MS", 10_000, 100, 60_000);
  if (leaseMs <= requestTimeoutMs * 2 + 1_000) {
    throw new Error("RFQ_HEDGE_LEASE_MS must exceed two RFQ_BINANCE_REQUEST_TIMEOUT_MS windows plus 1000ms");
  }
  return {
    worker: {
      workerId,
      leaseMs,
      pollIntervalMs: readInteger(env, "RFQ_HEDGE_POLL_INTERVAL_MS", 250, 10, 60_000),
      retryDelayMs: readInteger(env, "RFQ_HEDGE_RETRY_DELAY_MS", 1_000, 1, 3_600_000),
    },
    routes,
    binance: {
      apiKey: readCredential(env, "RFQ_BINANCE_API_KEY"),
      apiSecret: readCredential(env, "RFQ_BINANCE_API_SECRET"),
      ...(baseUrl ? { baseUrl } : {}),
      recvWindowMs: readInteger(env, "RFQ_BINANCE_RECV_WINDOW_MS", 5_000, 1, 5_000),
      requestTimeoutMs,
    },
    listenHost: readListenHost(env),
    listenPort: readInteger(env, "RFQ_HEDGE_WORKER_PORT", 3001, 1, 65_535),
  };
}

export async function startHedgeWorker(): Promise<void> {
  const config = readHedgeWorkerRuntimeConfig();
  const pool = getPool();
  await checkPoolHealth(pool);
  const store = new PostgresHedgeJobStore(pool);
  await store.checkHealth();
  const adapter = new BinanceSpotAdapter(config.binance);
  const metrics = new HedgeWorkerMetrics();
  const worker = new HedgeWorker(
    store,
    config.routes,
    new Map([["binance", adapter]]),
    config.worker,
    undefined,
    metrics,
  );
  const server = Fastify({ logger: false });
  server.get("/health", async () => ({ status: "ok" }));
  server.get("/ready", async (_request, reply) => {
    try {
      await store.checkHealth();
      return { status: "ok" };
    } catch {
      return reply.code(503).send({ status: "degraded" });
    }
  });
  server.get("/metrics", async (_request, reply) => reply.type("text/plain").send(metrics.renderPrometheus()));
  await server.listen({ host: config.listenHost, port: config.listenPort });
  const stop = () => worker.stop();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    await worker.run();
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    await server.close();
    await endPool();
  }
}

function readRequired(env: Record<string, string | undefined> | undefined, name: string): string {
  const value = readOptional(env, name);
  if (!value) throw new Error(`${name} is required for the hedge worker`);
  return value;
}

function readOptional(env: Record<string, string | undefined> | undefined, name: string): string | undefined {
  if (!env || !Object.prototype.hasOwnProperty.call(env, name)) return undefined;
  const value = env[name];
  if (value === undefined || value.trim().length === 0) return undefined;
  return value.trim();
}

function readCredential(env: Record<string, string | undefined> | undefined, name: string): string {
  const value = readRequired(env, name);
  if (value.startsWith("replace-with-")) throw new Error(`${name} placeholder must be replaced`);
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
    throw new Error(`${name} must be a base-10 integer between ${min} and ${max}`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be a base-10 integer between ${min} and ${max}`);
  }
  return parsed;
}

function readListenHost(env: Record<string, string | undefined> | undefined): string {
  const value = readOptional(env, "RFQ_HEDGE_WORKER_HOST") ?? "0.0.0.0";
  if (value.length > 255 || /\s/.test(value)) {
    throw new Error("RFQ_HEDGE_WORKER_HOST must be a non-empty host without whitespace");
  }
  return value;
}

function defaultWorkerId(): string {
  const digest = createHash("sha256").update(`${hostname()}:${process.pid}`).digest("hex").slice(0, 16);
  return `hedge_worker_${digest}`;
}

const processLike = globalThis.process;
if (processLike?.argv?.[1] && import.meta.url.endsWith(processLike.argv[1])) {
  startHedgeWorker().catch((error: unknown) => {
    console.error(error);
    processLike.exitCode = 1;
  });
}
