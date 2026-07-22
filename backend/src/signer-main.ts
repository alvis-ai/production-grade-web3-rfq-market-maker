import { readFile } from "node:fs/promises";
import { endPool } from "./db/pool.js";
import { parseTokenRegistryConfig, ConfiguredTokenRegistry } from "./modules/pricing/token-registry.js";
import { parseTokenLimitRiskPolicy } from "./modules/risk/token-limit-risk.engine.js";
import {
  createSignerAuditRuntime,
  readSignerAuditProcessConfig,
  type SignerAuditProcessConfig,
} from "./modules/signer/signer-audit-runtime.js";
import { buildSignerServer } from "./modules/signer/signer-server.js";
import {
  createSignerRuntime,
  readSignerRuntimeConfig,
  type SignerRuntimeConfig,
} from "./modules/signer/signer-runtime.js";
import {
  createRedisSignerQuoteCommitClient,
  normalizeRedisSignerQuoteCommitConfig,
  RedisSignerQuoteCommitStore,
  type RedisSignerQuoteCommitConfig,
  type SignerQuoteCommitObserver,
} from "./modules/signer/redis-signer-quote-commit.store.js";
import { readShutdownTimeoutMs, installBoundedShutdown } from "./runtime/process-shutdown.js";
import { readDecimalIntegerConfig, readOwnEnvValue } from "./runtime/environment.js";
import { createStructuredLogger, logProcessFailure } from "./shared/logger/structured-logger.js";

export interface SignerProcessConfig {
  signer: Extract<SignerRuntimeConfig, { mode: "local" | "aws-kms" }>;
  authToken: string;
  tokenRegistry: ConfiguredTokenRegistry;
  riskPolicy: ReturnType<typeof parseTokenLimitRiskPolicy>;
  quoteTtlSeconds: number;
  maxClockSkewSeconds: number;
  bodyLimitBytes: number;
  listenHost: string;
  listenPort: number;
  shutdownTimeoutMs: number;
  audit: SignerAuditProcessConfig;
  quoteCommit?: RedisSignerQuoteCommitConfig & { redisUrl: string; requireTls: boolean };
  tlsCertPath?: string;
  tlsKeyPath?: string;
}

export type { SignerAuditProcessConfig } from "./modules/signer/signer-audit-runtime.js";

export function readSignerProcessConfig(
  env: Record<string, string | undefined> | undefined = process.env,
): SignerProcessConfig {
  const requestedMode = readOwnEnvValue(env, "RFQ_SIGNER_MODE");
  if (requestedMode === "remote" || requestedMode === "external") {
    throw new Error("Signer process requires RFQ_SIGNER_MODE=local or aws-kms");
  }
  const signerEnv = env === undefined ? undefined : { ...env };
  if (signerEnv) {
    delete signerEnv.RFQ_SIGNER_SERVICE_URL;
    delete signerEnv.RFQ_SIGNER_SERVICE_TOKEN;
    delete signerEnv.RFQ_SIGNER_SERVICE_REQUEST_TIMEOUT_MS;
    delete signerEnv.RFQ_SIGNER_SERVICE_MAX_CONNECTIONS;
    delete signerEnv.RFQ_SIGNER_SERVICE_ALLOW_INSECURE_HTTP;
    delete signerEnv.RFQ_SIGNER_ATOMIC_QUOTE_COMMIT;
  }
  const signer = readSignerRuntimeConfig(signerEnv);
  if (signer.mode === "remote" || signer.mode === "external") {
    throw new Error("Signer process requires RFQ_SIGNER_MODE=local or aws-kms");
  }
  const registryJson = readRequired(env, "RFQ_TOKEN_REGISTRY_JSON");
  const riskPolicyJson = readRequired(env, "RFQ_RISK_POLICY_JSON");
  const tls = readTlsPaths(
    env,
    !isLocalEnvironment(readOwnEnvValue(env, "NODE_ENV")),
  );
  const audit = readSignerAuditProcessConfig(env);
  const quoteCommit = readSignerQuoteCommitConfig(env, audit);
  return {
    signer,
    authToken: readAuthToken(env),
    tokenRegistry: new ConfiguredTokenRegistry(parseTokenRegistryConfig(registryJson)),
    riskPolicy: parseTokenLimitRiskPolicy(riskPolicyJson),
    quoteTtlSeconds: readInteger(env, "RFQ_QUOTE_TTL_SECONDS", 30, 1, 3_600),
    maxClockSkewSeconds: readInteger(env, "RFQ_SIGNER_SERVICE_MAX_CLOCK_SKEW_SECONDS", 5, 0, 60),
    bodyLimitBytes: readInteger(env, "RFQ_SIGNER_SERVICE_BODY_LIMIT_BYTES", 32_768, 1_024, 1_048_576),
    listenHost: readListenHost(env),
    listenPort: readInteger(env, "RFQ_SIGNER_SERVICE_PORT", 3_006, 1, 65_535),
    shutdownTimeoutMs: readShutdownTimeoutMs(env),
    audit,
    ...(quoteCommit ? { quoteCommit } : {}),
    ...tls,
  };
}

export async function startSignerProcess(): Promise<void> {
  const config = readSignerProcessConfig();
  const logger = createStructuredLogger("signer-service");
  const runtime = createSignerRuntime(config.signer);
  const auditRuntime = createSignerAuditRuntime(config.audit, logger);
  await auditRuntime.start();
  const quoteCommitStore = createSignerQuoteCommitStore(
    config.quoteCommit,
    auditRuntime.quoteCommitObserver,
  );
  const https = config.tlsCertPath && config.tlsKeyPath ? {
    cert: await readFile(config.tlsCertPath),
    key: await readFile(config.tlsKeyPath),
  } : undefined;
  const server = buildSignerServer({
    signerService: runtime.service,
    auditStore: auditRuntime.store,
    ...(quoteCommitStore ? { quoteCommitStore } : {}),
    ...(auditRuntime.metrics ? { auditMetrics: auditRuntime.metrics } : {}),
    tokenRegistry: config.tokenRegistry,
    riskPolicy: config.riskPolicy,
    config: {
      authToken: config.authToken,
      settlementAddress: config.signer.settlementAddress,
      trustedSignerAddress: config.signer.trustedSignerAddress,
      maxQuoteTtlSeconds: config.quoteTtlSeconds,
      maxClockSkewSeconds: config.maxClockSkewSeconds,
      bodyLimitBytes: config.bodyLimitBytes,
    },
    logger,
    https,
  });
  await server.listen({ host: config.listenHost, port: config.listenPort });
  let controller: ReturnType<typeof installBoundedShutdown>;
  controller = installBoundedShutdown({
    component: "signer-service",
    logger,
    processLike: process,
    timeoutMs: config.shutdownTimeoutMs,
    onShutdown: () => {
      Promise.resolve(server.close())
        .then(() => runtime.close?.())
        .then(() => auditRuntime.close())
        .then(() => quoteCommitStore?.close())
        .then(() => auditRuntime.usesPostgres ? endPool() : undefined)
        .then(() => {
          controller.complete();
          process.exitCode = 0;
        })
        .catch(() => {
          controller.complete();
          process.exitCode = 1;
          process.exit(1);
        });
    },
  });
}

export function createSignerQuoteCommitStore(
  config: SignerProcessConfig["quoteCommit"],
  observer?: SignerQuoteCommitObserver,
): RedisSignerQuoteCommitStore | undefined {
  if (!config) return undefined;
  const { redisUrl, requireTls, ...storeConfig } = config;
  return new RedisSignerQuoteCommitStore(
    createRedisSignerQuoteCommitClient(redisUrl, { requireTls }),
    storeConfig,
    observer,
  );
}

function readSignerQuoteCommitConfig(
  env: Record<string, string | undefined> | undefined,
  audit: SignerAuditProcessConfig,
): SignerProcessConfig["quoteCommit"] {
  if (!readBoolean(env, "RFQ_SIGNER_ATOMIC_QUOTE_COMMIT", false)) return undefined;
  if (audit.backend !== "redis-stream") {
    throw new Error("RFQ_SIGNER_ATOMIC_QUOTE_COMMIT requires RFQ_SIGNER_AUDIT_BACKEND=redis-stream");
  }
  const nodeEnv = readOwnEnvValue(env, "NODE_ENV");
  const production = !isLocalEnvironment(nodeEnv);
  const hotStateTtlMs = readInteger(env, "RFQ_QUOTE_ISSUANCE_HOT_STATE_TTL_MS", 3_600_000, 60_000, 604_800_000);
  const minReplicaAcks = readInteger(
    env,
    "RFQ_QUOTE_ISSUANCE_MIN_REPLICA_ACKS",
    audit.minReplicaAcks,
    0,
    5,
  );
  if (production && minReplicaAcks < 1) {
    throw new Error("RFQ_QUOTE_ISSUANCE_MIN_REPLICA_ACKS must be at least 1 for atomic signer commit");
  }
  if (!readBoolean(env, "RFQ_QUOTE_ISSUANCE_REQUIRE_AOF", true)) {
    throw new Error("RFQ_QUOTE_ISSUANCE_REQUIRE_AOF cannot be disabled for atomic signer commit");
  }
  const ledgerEpoch = readOwnEnvValue(env, "RFQ_QUOTE_ISSUANCE_LEDGER_EPOCH") ??
    (production ? undefined : "local_v1");
  if (!ledgerEpoch || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(ledgerEpoch)) {
    throw new Error("RFQ_QUOTE_ISSUANCE_LEDGER_EPOCH is required for atomic signer commit");
  }
  const quoteCommitConfig = normalizeRedisSignerQuoteCommitConfig({
    quoteKeyPrefix: readOwnEnvValue(env, "RFQ_QUOTE_ISSUANCE_KEY_PREFIX") ?? "rfq:{quote-issuance}:ledger",
    ledgerEpoch,
    issuanceMaxBacklog: readInteger(
      env,
      "RFQ_QUOTE_ISSUANCE_MAX_BACKLOG",
      10_000,
      1,
      1_000_000,
    ),
    hotStateTtlMs,
    idempotencyTtlMs: readInteger(
      env,
      "RFQ_QUOTE_ISSUANCE_IDEMPOTENCY_TTL_MS",
      86_400_000,
      hotStateTtlMs,
      2_592_000_000,
    ),
    auditStreamKey: audit.streamKey,
    auditMaxBacklog: audit.maxBacklog,
    auditDedupeTtlMs: audit.dedupeTtlMs,
    minReplicaAcks: Math.max(minReplicaAcks, audit.minReplicaAcks),
    replicaAckTimeoutMs: Math.min(
      readInteger(env, "RFQ_QUOTE_ISSUANCE_REPLICA_ACK_TIMEOUT_MS", 20, 1, 5_000),
      audit.replicaAckTimeoutMs,
    ),
    requireAof: true,
  });
  return {
    redisUrl: audit.redisUrl,
    requireTls: production,
    ...quoteCommitConfig,
  };
}

function readAuthToken(env: Record<string, string | undefined> | undefined): string {
  const value = readRequired(env, "RFQ_SIGNER_SERVICE_TOKEN");
  if (!/^[A-Za-z0-9._~-]{43,256}$/.test(value)) {
    throw new Error("RFQ_SIGNER_SERVICE_TOKEN must be 43-256 URL-safe characters");
  }
  return value;
}

function readRequired(env: Record<string, string | undefined> | undefined, name: string): string {
  const value = readOwnEnvValue(env, name);
  if (value === undefined || value.length === 0 || value.trim() !== value || value.startsWith("replace-with-")) {
    throw new Error(`${name} is required for the signer process without surrounding whitespace`);
  }
  return value;
}

function readInteger(
  env: Record<string, string | undefined> | undefined,
  name: string,
  defaultValue: number,
  min: number,
  max: number,
): number {
  const value = readOwnEnvValue(env, name);
  if (value !== undefined && !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`${name} must be a base-10 integer between ${min} and ${max}`);
  }
  return readDecimalIntegerConfig(value, { defaultValue, min, max, name });
}

function readBoolean(
  env: Record<string, string | undefined> | undefined,
  name: string,
  defaultValue: boolean,
): boolean {
  const value = readOwnEnvValue(env, name);
  if (value === undefined) return defaultValue;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false`);
}

function readListenHost(env: Record<string, string | undefined> | undefined): string {
  const value = readOwnEnvValue(env, "RFQ_SIGNER_SERVICE_HOST") ?? "127.0.0.1";
  if (value.length === 0 || value.trim() !== value || /\s/.test(value)) {
    throw new Error("RFQ_SIGNER_SERVICE_HOST must be a hostname or IP address without whitespace");
  }
  return value;
}

function readTlsPaths(
  env: Record<string, string | undefined> | undefined,
  required: boolean,
): Pick<SignerProcessConfig, "tlsCertPath" | "tlsKeyPath"> {
  const certPath = readOwnEnvValue(env, "RFQ_SIGNER_TLS_CERT_PATH");
  const keyPath = readOwnEnvValue(env, "RFQ_SIGNER_TLS_KEY_PATH");
  if ((certPath === undefined) !== (keyPath === undefined)) {
    throw new Error("RFQ_SIGNER_TLS_CERT_PATH and RFQ_SIGNER_TLS_KEY_PATH must be configured together");
  }
  if (certPath === undefined || keyPath === undefined) {
    if (required) throw new Error("Signer TLS certificate and key paths are required outside local environments");
    return {};
  }
  if (!certPath.startsWith("/") || !keyPath.startsWith("/") || certPath.trim() !== certPath || keyPath.trim() !== keyPath) {
    throw new Error("Signer TLS certificate and key paths must be absolute paths without surrounding whitespace");
  }
  return { tlsCertPath: certPath, tlsKeyPath: keyPath };
}

function isLocalEnvironment(nodeEnv: string | undefined): boolean {
  return nodeEnv === undefined || nodeEnv === "development" || nodeEnv === "test";
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1])) {
  startSignerProcess().catch((error: unknown) => {
    logProcessFailure("signer-service", error);
    process.exitCode = 1;
  });
}
