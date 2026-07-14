import { createHash } from "node:crypto";
import { hostname } from "node:os";
import Fastify from "fastify";
import { checkPoolHealth, endPool, getPool } from "./db/pool.js";
import {
  ConfiguredTokenRegistry,
  parseTokenRegistryConfig,
  type TokenRegistry,
} from "./modules/pricing/token-registry.js";
import { PostgresToxicFlowMarkoutStore } from "./modules/risk/postgres-toxic-flow-markout.store.js";
import { PostgresToxicFlowScoreStore } from "./modules/risk/postgres-toxic-flow-score.store.js";
import {
  ToxicFlowAnalyzerMetrics,
  ToxicFlowAnalyzerWorker,
  type ToxicFlowAnalyzerConfig,
} from "./modules/risk/toxic-flow-analyzer.worker.js";
import { createStructuredLogger, logProcessFailure } from "./shared/logger/structured-logger.js";

export interface ToxicFlowAnalyzerRuntimeConfig {
  worker: ToxicFlowAnalyzerConfig;
  tokenRegistry: TokenRegistry;
  listenHost: string;
  listenPort: number;
}

export function readToxicFlowAnalyzerRuntimeConfig(
  env: Record<string, string | undefined> | undefined = process.env,
): ToxicFlowAnalyzerRuntimeConfig {
  const databaseUrl = readRequired(env, "DATABASE_URL");
  if (!/^postgres(?:ql)?:\/\//.test(databaseUrl)) {
    throw new Error("DATABASE_URL must use postgres:// or postgresql:// protocol");
  }
  const tokenRegistry = new ConfiguredTokenRegistry(
    parseTokenRegistryConfig(readRequired(env, "RFQ_TOKEN_REGISTRY_JSON")),
  );
  const horizonSeconds = readInteger(
    env,
    "RFQ_TOXIC_FLOW_MARKOUT_HORIZON_SECONDS",
    300,
    1,
    604_800,
  );
  const maxSnapshotLagSeconds = readInteger(
    env,
    "RFQ_TOXIC_FLOW_MARKOUT_MAX_SNAPSHOT_LAG_SECONDS",
    900,
    0,
    604_800,
  );
  const windowSeconds = readInteger(
    env,
    "RFQ_TOXIC_FLOW_SCORE_WINDOW_SECONDS",
    86_400,
    1,
    604_800,
  );
  if (horizonSeconds + maxSnapshotLagSeconds > 604_800 ||
      windowSeconds < horizonSeconds) {
    throw new Error("Toxic-flow analyzer horizon, lag, and window are inconsistent");
  }
  return {
    worker: {
      workerId: readOptional(env, "RFQ_TOXIC_FLOW_ANALYZER_WORKER_ID") ?? defaultWorkerId(),
      leaseMs: readInteger(env, "RFQ_TOXIC_FLOW_ANALYZER_LEASE_MS", 30_000, 1_000, 300_000),
      pollIntervalMs: readInteger(
        env,
        "RFQ_TOXIC_FLOW_ANALYZER_POLL_INTERVAL_MS",
        250,
        10,
        60_000,
      ),
      retryDelayMs: readInteger(
        env,
        "RFQ_TOXIC_FLOW_ANALYZER_RETRY_DELAY_MS",
        1_000,
        1,
        3_600_000,
      ),
      horizonSeconds,
      maxSnapshotLagSeconds,
      windowSeconds,
      scoreScale: readInteger(env, "RFQ_TOXIC_FLOW_SCORE_SCALE", 100, 1, 10_000),
      policyVersion: readOptional(env, "RFQ_TOXIC_FLOW_ANALYZER_POLICY_VERSION") ?? "markout-v1",
    },
    tokenRegistry,
    listenHost: readHost(env),
    listenPort: readInteger(env, "RFQ_TOXIC_FLOW_ANALYZER_PORT", 3_005, 1, 65_535),
  };
}

export async function startToxicFlowAnalyzer(): Promise<void> {
  const config = readToxicFlowAnalyzerRuntimeConfig();
  const logger = createStructuredLogger("toxic-flow-analyzer");
  const pool = getPool(undefined, logger);
  const markouts = new PostgresToxicFlowMarkoutStore(pool);
  const scores = new PostgresToxicFlowScoreStore(pool);
  const metrics = new ToxicFlowAnalyzerMetrics();
  const worker = new ToxicFlowAnalyzerWorker(
    markouts,
    scores,
    config.tokenRegistry,
    config.worker,
    metrics,
    logger,
  );
  const server = Fastify({ logger, disableRequestLogging: true });
  server.get("/health", async () => ({ status: "ok" }));
  server.get("/ready", async (_request, reply) => {
    try {
      await Promise.all([markouts.checkHealth(), scores.checkHealth()]);
      return { status: "ok" };
    } catch {
      return reply.code(503).send({ status: "degraded" });
    }
  });
  server.get("/metrics", async (_request, reply) => {
    let stats;
    try {
      stats = await markouts.stats(config.worker.horizonSeconds);
    } catch {}
    return reply.type("text/plain").send(metrics.renderPrometheus(stats));
  });

  let signalHandlersRegistered = false;
  const stop = () => worker.stop();
  try {
    await checkPoolHealth(pool);
    await markouts.checkHealth();
    await scores.checkHealth();
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

function readRequired(
  env: Record<string, string | undefined> | undefined,
  name: string,
): string {
  const value = readOptional(env, name);
  if (!value) throw new Error(`${name} is required for the toxic-flow analyzer`);
  return value;
}

function readOptional(
  env: Record<string, string | undefined> | undefined,
  name: string,
): string | undefined {
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
  const value = readOptional(env, "RFQ_TOXIC_FLOW_ANALYZER_HOST") ?? "0.0.0.0";
  if (value.length > 255 || /\s/.test(value)) {
    throw new Error("RFQ_TOXIC_FLOW_ANALYZER_HOST is invalid");
  }
  return value;
}

function defaultWorkerId(): string {
  const digest = createHash("sha256")
    .update(`${hostname()}:${process.pid}`)
    .digest("hex")
    .slice(0, 16);
  return `toxic_analyzer_${digest}`;
}

const processLike = globalThis.process;
if (processLike?.argv?.[1] && import.meta.url.endsWith(processLike.argv[1])) {
  startToxicFlowAnalyzer().catch((error: unknown) => {
    logProcessFailure("toxic-flow-analyzer", error);
    processLike.exitCode = 1;
  });
}
