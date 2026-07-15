import type pg from "pg";
import { getPool, type DatabasePoolLogger } from "../db/pool.js";
import {
  Sha256ApiKeyAuthenticator,
  parseApiKeyAuthConfig,
  type ApiKeyAuthenticator,
} from "../modules/auth/api-key-auth.service.js";
import type { SettlementEvidenceProvider } from "../modules/execution/execution.service.js";
import {
  parseReceiptExecutionConfig,
  RuntimeSettlementEvidenceProvider,
} from "../modules/execution/receipt-settlement-evidence.provider.js";
import { PostgresSubmitReservationStore } from "../modules/execution/postgres-submit-reservation.store.js";
import {
  InMemorySubmitReservationStore,
  assertSubmitReservationStore,
  defaultSubmitReservationLeaseMs,
  maxSubmitReservationLeaseMs,
  minSubmitReservationLeaseMs,
  type SubmitReservationStore,
} from "../modules/execution/submit-reservation.store.js";
import type { HedgeIntentService } from "../modules/hedge/hedge.service.js";
import type { BinanceSymbolRulesHealth } from "../modules/hedge/binance-symbol-rules.js";
import type { MarketDataService } from "../modules/market-data/market-data.service.js";
import type { MarketSnapshotStore } from "../modules/market-data/market-snapshot.repository.js";
import type { PnlStore } from "../modules/pnl/pnl.service.js";
import type { PricingEngine } from "../modules/pricing/pricing.engine.js";
import type { TokenRegistry } from "../modules/pricing/token-registry.js";
import type { QuoteRepository } from "../modules/quote/quote.repository.js";
import {
  InMemoryQuoteIdempotencyStore,
  assertQuoteIdempotencyStore,
  defaultQuoteIdempotencyLeaseMs,
  maxQuoteIdempotencyLeaseMs,
  minQuoteIdempotencyLeaseMs,
  type QuoteIdempotencyStore,
} from "../modules/quote/quote-idempotency.store.js";
import { PostgresQuoteIdempotencyStore } from "../modules/quote/postgres-quote-idempotency.store.js";
import {
  InMemoryQuoteControlStore,
  assertQuoteControlStore,
  type QuoteControlStore,
} from "../modules/quote-control/quote-control.store.js";
import { PostgresQuoteControlStore } from "../modules/quote-control/postgres-quote-control.store.js";
import { defaultQuoteServiceConfig } from "../modules/quote/quote.service.js";
import {
  InMemoryRateLimiter,
  type RateLimitConfig,
  type RateLimiter,
} from "../modules/rate-limit/rate-limit.service.js";
import {
  createRedisRateLimitClient,
  RedisRateLimiter,
} from "../modules/rate-limit/redis-rate-limit.service.js";
import type { RiskDecisionStore } from "../modules/risk/risk-decision.repository.js";
import type { RiskEngine } from "../modules/risk/risk.engine.js";
import {
  InMemoryToxicFlowScoreStore,
  assertToxicFlowScoreStore,
  type ToxicFlowScoreStore,
} from "../modules/risk/toxic-flow-score.store.js";
import { PostgresToxicFlowScoreStore } from "../modules/risk/postgres-toxic-flow-score.store.js";
import type { QuoteExposureStore } from "../modules/risk/quote-exposure.store.js";
import {
  OnchainTreasuryLiquidityProvider,
  type TreasuryLiquidityProvider,
} from "../modules/risk/treasury-liquidity.provider.js";
import type { RoutingEngine } from "../modules/routing/routing.engine.js";
import type { SettlementEventStore } from "../modules/settlement/settlement-event.service.js";
import {
  defaultLocalSettlementVerifierPolicy,
  type LocalSettlementVerifierPolicy,
  type SettlementVerifier,
} from "../modules/settlement/settlement-verifier.service.js";
import type { SignerService } from "../modules/signer/signer.service.js";
import type { SignerRuntimeConfig } from "../modules/signer/signer-runtime.js";
import type { Address } from "../shared/types/rfq.js";
import {
  assertBooleanOption,
  assertIntegerOption,
  isRecord,
  readDecimalIntegerConfig,
  readOptionalBoolean,
  readOwnEnvValue,
  requiresExplicitRuntimeConfig,
  runtimeEnvironment,
} from "./environment.js";

const defaultBodyLimitBytes = 32_768;
const defaultCorsAllowedOrigins = ["http://localhost:5173"];
const defaultEnableHsts = false;
const defaultTrustProxy = false;
const buildServerOptionFields = [
  "apiKeyAuthenticator",
  "bodyLimitBytes",
  "corsAllowedOrigins",
  "databasePool",
  "enableHsts",
  "hedgeService",
  "hedgeRouteRulesHealth",
  "logger",
  "marketDataService",
  "marketSnapshotStore",
  "pnlService",
  "pricingEngine",
  "quoteRepository",
  "quoteIdempotencyLeaseMs",
  "quoteIdempotencyStore",
  "quoteControlStore",
  "quoteExposureStore",
  "quoteTtlSeconds",
  "rateLimit",
  "rateLimiter",
  "riskDecisionStore",
  "riskEngine",
  "routingEngine",
  "settlementEvidenceProvider",
  "settlementEventService",
  "settlementVerifier",
  "signerService",
  "submitReservationLeaseMs",
  "submitReservationStore",
  "tokenRegistry",
  "toxicFlowScoreStore",
  "treasuryLiquidityProvider",
  "trustProxy",
] as const;
const rateLimitOptionFields = ["windowMs", "maxQuoteRequests", "maxSubmitRequests", "maxStatusRequests"] as const;

export interface BuildServerOptions {
  apiKeyAuthenticator?: ApiKeyAuthenticator | false;
  logger?: boolean;
  databasePool?: pg.Pool;
  marketDataService?: MarketDataService;
  marketSnapshotStore?: MarketSnapshotStore;
  pricingEngine?: PricingEngine;
  quoteRepository?: QuoteRepository;
  quoteIdempotencyLeaseMs?: number;
  quoteIdempotencyStore?: QuoteIdempotencyStore;
  quoteControlStore?: QuoteControlStore;
  quoteExposureStore?: QuoteExposureStore;
  riskDecisionStore?: RiskDecisionStore;
  riskEngine?: RiskEngine;
  routingEngine?: RoutingEngine;
  settlementEvidenceProvider?: SettlementEvidenceProvider;
  hedgeService?: HedgeIntentService;
  hedgeRouteRulesHealth?: BinanceSymbolRulesHealth;
  pnlService?: PnlStore;
  settlementEventService?: SettlementEventStore;
  settlementVerifier?: SettlementVerifier;
  signerService?: SignerService;
  submitReservationLeaseMs?: number;
  submitReservationStore?: SubmitReservationStore;
  tokenRegistry?: TokenRegistry;
  toxicFlowScoreStore?: ToxicFlowScoreStore;
  treasuryLiquidityProvider?: TreasuryLiquidityProvider;
  rateLimit?: Partial<RateLimitConfig> | false;
  rateLimiter?: RateLimiter;
  quoteTtlSeconds?: number;
  bodyLimitBytes?: number;
  corsAllowedOrigins?: readonly string[] | false;
  enableHsts?: boolean;
  trustProxy?: boolean;
}

export interface GatewayServerSettings {
  bodyLimitBytes: number;
  corsAllowedOrigins: string[];
  enableHsts: boolean;
  logger: boolean;
  quoteTtlSeconds: number;
  quoteIdempotencyLeaseMs: number;
  requireQuoteIdempotencyKey: boolean;
  submitReservationLeaseMs: number;
  trustProxy: boolean;
}

export function resolveToxicFlowScoreStore(
  configuredStore: ToxicFlowScoreStore | undefined,
  postgresPool: pg.Pool | undefined,
): ToxicFlowScoreStore {
  if (configuredStore !== undefined) {
    assertToxicFlowScoreStore(configuredStore);
    return configuredStore;
  }
  return postgresPool
    ? new PostgresToxicFlowScoreStore(postgresPool)
    : new InMemoryToxicFlowScoreStore();
}

export function readGatewayServerSettings(options: BuildServerOptions): GatewayServerSettings {
  assertBuildServerOptions(options);
  const quoteTtlSeconds = options.quoteTtlSeconds === undefined
    ? readQuoteTtlSeconds()
    : assertIntegerOption(options.quoteTtlSeconds, "quoteTtlSeconds", 1, 3600);
  const quoteIdempotencyLeaseMs = options.quoteIdempotencyLeaseMs === undefined
    ? readQuoteIdempotencyLeaseMs(quoteTtlSeconds)
    : assertIntegerOption(
        options.quoteIdempotencyLeaseMs,
        "quoteIdempotencyLeaseMs",
        minQuoteIdempotencyLeaseMs,
        maxQuoteIdempotencyLeaseMs,
      );
  if (quoteIdempotencyLeaseMs <= quoteTtlSeconds * 1_000) {
    throw new Error("quoteIdempotencyLeaseMs must exceed quoteTtlSeconds in milliseconds");
  }
  const nodeEnv = readOwnEnvValue(runtimeEnvironment(), "NODE_ENV");
  return {
    logger: options.logger === undefined ? true : assertBooleanOption(options.logger, "logger"),
    bodyLimitBytes: options.bodyLimitBytes === undefined
      ? readBodyLimitBytes()
      : assertIntegerOption(options.bodyLimitBytes, "bodyLimitBytes", 1024, 1_048_576),
    enableHsts: options.enableHsts === undefined
      ? readEnableHsts()
      : assertBooleanOption(options.enableHsts, "enableHsts"),
    trustProxy: options.trustProxy === undefined
      ? readTrustProxy()
      : assertBooleanOption(options.trustProxy, "trustProxy"),
    quoteTtlSeconds,
    quoteIdempotencyLeaseMs,
    requireQuoteIdempotencyKey: requiresExplicitRuntimeConfig(nodeEnv),
    submitReservationLeaseMs: options.submitReservationLeaseMs === undefined
      ? readSubmitReservationLeaseMs()
      : assertIntegerOption(
          options.submitReservationLeaseMs,
          "submitReservationLeaseMs",
          minSubmitReservationLeaseMs,
          maxSubmitReservationLeaseMs,
        ),
    corsAllowedOrigins: options.corsAllowedOrigins === false
      ? []
      : normalizeCorsAllowedOrigins(options.corsAllowedOrigins ?? readCorsAllowedOrigins()),
  };
}

export function buildDefaultSettlementVerifierPolicy(
  signerConfig: SignerRuntimeConfig,
  managedPairs: readonly SettlementPolicyPair[] = [],
): LocalSettlementVerifierPolicy {
  const configuredPolicy = settlementPolicyFromManagedPairs(managedPairs);
  return {
    ...defaultLocalSettlementVerifierPolicy,
    ...configuredPolicy,
    settlementAddress: signerConfig.settlementAddress,
    trustedSignerAddress: signerConfig.trustedSignerAddress,
    trustedSignerOverlapAddresses: signerConfig.trustedSignerOverlapAddresses,
  };
}

export interface SettlementPolicyPair {
  chainId: number;
  tokenIn: Address;
  tokenOut: Address;
}

function settlementPolicyFromManagedPairs(
  managedPairs: readonly SettlementPolicyPair[],
): Pick<LocalSettlementVerifierPolicy, "enabledChainIds" | "tokenWhitelist"> | undefined {
  if (!Array.isArray(managedPairs)) {
    throw new Error("Settlement policy managedPairs must be an array");
  }
  if (managedPairs.length === 0) return undefined;

  const enabledChainIds = new Set<number>();
  const tokenWhitelist = new Map<string, Address>();
  for (const pair of managedPairs) {
    if (typeof pair !== "object" || pair === null || Array.isArray(pair)) {
      throw new Error("Settlement policy managed pair must be an object");
    }
    if (!Number.isSafeInteger(pair.chainId) || pair.chainId <= 0) {
      throw new Error("Settlement policy managed pair chainId must be a positive safe integer");
    }
    assertSettlementPolicyAddress(pair.tokenIn, "tokenIn");
    assertSettlementPolicyAddress(pair.tokenOut, "tokenOut");
    if (pair.tokenIn.toLowerCase() === pair.tokenOut.toLowerCase()) {
      throw new Error("Settlement policy managed pair must contain distinct tokens");
    }
    enabledChainIds.add(pair.chainId);
    tokenWhitelist.set(pair.tokenIn.toLowerCase(), pair.tokenIn.toLowerCase() as Address);
    tokenWhitelist.set(pair.tokenOut.toLowerCase(), pair.tokenOut.toLowerCase() as Address);
  }

  return {
    enabledChainIds: [...enabledChainIds],
    tokenWhitelist: [...tokenWhitelist.values()],
  };
}

function assertSettlementPolicyAddress(value: unknown, field: "tokenIn" | "tokenOut"): asserts value is Address {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`Settlement policy managed pair ${field} must be a 20-byte hex address`);
  }
}

export function buildRuntimeSettlementEvidenceProvider(
  settlementAddress: `0x${string}`,
): RuntimeSettlementEvidenceProvider {
  const env = runtimeEnvironment();
  const nodeEnv = readOwnEnvValue(env, "NODE_ENV");
  const allowSimulatedSettlement = readOptionalBoolean(
    readOwnEnvValue(env, "RFQ_ALLOW_SIMULATED_SETTLEMENT"),
    !requiresExplicitRuntimeConfig(nodeEnv),
    "RFQ_ALLOW_SIMULATED_SETTLEMENT",
  );
  const config = parseReceiptExecutionConfig(
    readOwnEnvValue(env, "RFQ_RECEIPT_CONFIG_JSON"),
    { requireTls: requiresExplicitRuntimeConfig(nodeEnv) },
  );
  if (!allowSimulatedSettlement && config.chains.length === 0) {
    throw new Error("RFQ_RECEIPT_CONFIG_JSON must configure at least one chain when simulated settlement is disabled");
  }
  for (const chain of config.chains) {
    if (chain.settlementAddress.toLowerCase() !== settlementAddress.toLowerCase()) {
      throw new Error("Receipt settlement address must match RFQ_SETTLEMENT_ADDRESS used for EIP-712 signing");
    }
  }
  return new RuntimeSettlementEvidenceProvider(config, allowSimulatedSettlement);
}

export function buildRuntimeTreasuryLiquidityProvider(): TreasuryLiquidityProvider | undefined {
  const env = runtimeEnvironment();
  const nodeEnv = readOwnEnvValue(env, "NODE_ENV");
  const config = parseReceiptExecutionConfig(
    readOwnEnvValue(env, "RFQ_RECEIPT_CONFIG_JSON"),
    { requireTls: requiresExplicitRuntimeConfig(nodeEnv) },
  );
  return config.chains.length === 0 ? undefined : new OnchainTreasuryLiquidityProvider(config);
}

export function resolveApiKeyAuthenticator(options: BuildServerOptions): ApiKeyAuthenticator | undefined {
  const env = runtimeEnvironment();
  const nodeEnv = readOwnEnvValue(env, "NODE_ENV");
  if (options.apiKeyAuthenticator === false) {
    if (requiresExplicitRuntimeConfig(nodeEnv)) {
      throw new Error(`apiKeyAuthenticator cannot be disabled when NODE_ENV=${nodeEnv}`);
    }
    return undefined;
  }
  if (options.apiKeyAuthenticator !== undefined) {
    if (!isRecord(options.apiKeyAuthenticator) || typeof options.apiKeyAuthenticator.authenticate !== "function") {
      throw new Error("buildServer apiKeyAuthenticator.authenticate must be a function");
    }
    return options.apiKeyAuthenticator;
  }

  const serialized = readOwnEnvValue(env, "RFQ_API_KEY_CONFIG_JSON");
  if (!serialized || serialized.trim().length === 0) {
    if (requiresExplicitRuntimeConfig(nodeEnv)) {
      throw new Error(`RFQ_API_KEY_CONFIG_JSON is required when NODE_ENV=${nodeEnv}`);
    }
    return undefined;
  }
  return new Sha256ApiKeyAuthenticator(parseApiKeyAuthConfig(serialized));
}

export function resolvePostgresPool(
  options: BuildServerOptions,
  logger?: DatabasePoolLogger,
): pg.Pool | undefined {
  if (options.databasePool !== undefined) {
    if (!isRecord(options.databasePool) || typeof options.databasePool.connect !== "function") {
      throw new Error("buildServer databasePool.connect must be a function");
    }
    return options.databasePool;
  }

  const env = runtimeEnvironment();
  const nodeEnv = readOwnEnvValue(env, "NODE_ENV");
  const databaseUrl = readOwnEnvValue(env, "DATABASE_URL");
  if (!databaseUrl || databaseUrl.trim().length === 0) {
    if (requiresExplicitRuntimeConfig(nodeEnv)) {
      throw new Error(`DATABASE_URL is required when NODE_ENV=${nodeEnv}`);
    }
    return undefined;
  }
  return getPool(undefined, logger);
}

export function resolveSubmitReservationStore(
  configured: SubmitReservationStore | undefined,
  postgresPool: pg.Pool | undefined,
  leaseMs: number,
): SubmitReservationStore {
  if (configured !== undefined) {
    assertSubmitReservationStore(configured);
    return configured;
  }
  const config = { leaseMs };
  return postgresPool
    ? new PostgresSubmitReservationStore(postgresPool, config)
    : new InMemorySubmitReservationStore(config);
}

export function resolveQuoteIdempotencyStore(
  configured: QuoteIdempotencyStore | undefined,
  postgresPool: pg.Pool | undefined,
  leaseMs: number,
): QuoteIdempotencyStore {
  if (configured !== undefined) {
    assertQuoteIdempotencyStore(configured);
    return configured;
  }
  const config = { leaseMs };
  return postgresPool
    ? new PostgresQuoteIdempotencyStore(postgresPool, config)
    : new InMemoryQuoteIdempotencyStore(config);
}

export function resolveQuoteControlStore(
  configured: QuoteControlStore | undefined,
  postgresPool: pg.Pool | undefined,
): QuoteControlStore {
  if (configured !== undefined) {
    assertQuoteControlStore(configured);
    return configured;
  }
  return postgresPool ? new PostgresQuoteControlStore(postgresPool) : new InMemoryQuoteControlStore();
}

export function resolveRateLimiter(options: BuildServerOptions): RateLimiter | undefined {
  if (options.rateLimiter !== undefined) {
    if (options.rateLimit !== undefined) {
      throw new Error("buildServer rateLimiter and rateLimit cannot both be provided");
    }
    assertRateLimiterOption(options.rateLimiter);
    return options.rateLimiter;
  }

  const config = normalizeRateLimitOption(options.rateLimit);
  if (config === false) return undefined;

  const env = runtimeEnvironment();
  const nodeEnv = readOwnEnvValue(env, "NODE_ENV");
  const configuredBackend = readOwnEnvValue(env, "RFQ_RATE_LIMIT_BACKEND");
  const backend = configuredBackend?.trim().toLowerCase() ||
    (requiresExplicitRuntimeConfig(nodeEnv) ? "redis" : "memory");
  if (backend !== "memory" && backend !== "redis") {
    throw new Error("RFQ_RATE_LIMIT_BACKEND must be memory or redis");
  }
  if (backend === "memory") {
    if (requiresExplicitRuntimeConfig(nodeEnv)) {
      throw new Error(`RFQ_RATE_LIMIT_BACKEND must be redis when NODE_ENV=${nodeEnv}`);
    }
    return new InMemoryRateLimiter(config);
  }

  const redisUrl = readOwnEnvValue(env, "RFQ_REDIS_URL");
  if (!redisUrl || redisUrl.trim().length === 0) {
    throw new Error("RFQ_REDIS_URL is required when RFQ_RATE_LIMIT_BACKEND=redis");
  }
  return new RedisRateLimiter(createRedisRateLimitClient(redisUrl, {
    requireTls: requiresExplicitRuntimeConfig(nodeEnv),
  }), config);
}

function readQuoteTtlSeconds(): number {
  const env = runtimeEnvironment();
  return readDecimalIntegerConfig(readOwnEnvValue(env, "RFQ_QUOTE_TTL_SECONDS"), {
    defaultValue: defaultQuoteServiceConfig.quoteTtlSeconds,
    max: 3600,
    min: 1,
    name: "RFQ_QUOTE_TTL_SECONDS",
  });
}

function readSubmitReservationLeaseMs(): number {
  const env = runtimeEnvironment();
  return readDecimalIntegerConfig(readOwnEnvValue(env, "RFQ_SUBMIT_RESERVATION_LEASE_MS"), {
    defaultValue: defaultSubmitReservationLeaseMs,
    max: maxSubmitReservationLeaseMs,
    min: minSubmitReservationLeaseMs,
    name: "RFQ_SUBMIT_RESERVATION_LEASE_MS",
  });
}

function readQuoteIdempotencyLeaseMs(quoteTtlSeconds: number): number {
  const env = runtimeEnvironment();
  return readDecimalIntegerConfig(readOwnEnvValue(env, "RFQ_QUOTE_IDEMPOTENCY_LEASE_MS"), {
    defaultValue: Math.max(defaultQuoteIdempotencyLeaseMs, (quoteTtlSeconds + 30) * 1_000),
    max: maxQuoteIdempotencyLeaseMs,
    min: minQuoteIdempotencyLeaseMs,
    name: "RFQ_QUOTE_IDEMPOTENCY_LEASE_MS",
  });
}

function readBodyLimitBytes(): number {
  const env = runtimeEnvironment();
  return readDecimalIntegerConfig(readOwnEnvValue(env, "RFQ_BODY_LIMIT_BYTES"), {
    defaultValue: defaultBodyLimitBytes,
    max: 1_048_576,
    min: 1024,
    name: "RFQ_BODY_LIMIT_BYTES",
  });
}

function assertBuildServerOptions(options: unknown): asserts options is BuildServerOptions {
  if (!isRecord(options)) throw new Error("buildServer options must be an object");
  assertOptionalOwnFields(options, buildServerOptionFields, "options");
}

function assertRateLimiterOption(rateLimiter: unknown): asserts rateLimiter is RateLimiter {
  if (!isRecord(rateLimiter)) throw new Error("buildServer rateLimiter must be an object");
  for (const method of ["check", "checkHealth"] as const) {
    if (typeof rateLimiter[method] !== "function") {
      throw new Error(`buildServer rateLimiter.${method} must be a function`);
    }
  }
  if (rateLimiter.close !== undefined && typeof rateLimiter.close !== "function") {
    throw new Error("buildServer rateLimiter.close must be a function when provided");
  }
}

function normalizeRateLimitOption(rateLimit: BuildServerOptions["rateLimit"]): RateLimitConfig | false {
  if (rateLimit === false) return false;
  if (rateLimit === undefined) {
    return {
      windowMs: 60_000,
      maxQuoteRequests: 120,
      maxSubmitRequests: 60,
      maxStatusRequests: 300,
    };
  }
  if (!isRecord(rateLimit)) throw new Error("buildServer rateLimit must be an object or false");
  assertOptionalOwnFields(rateLimit, rateLimitOptionFields, "rateLimit");
  return {
    windowMs: rateLimit.windowMs ?? 60_000,
    maxQuoteRequests: rateLimit.maxQuoteRequests ?? 120,
    maxSubmitRequests: rateLimit.maxSubmitRequests ?? 60,
    maxStatusRequests: rateLimit.maxStatusRequests ?? 300,
  };
}

function assertOptionalOwnFields(value: object, fields: readonly string[], path: string): void {
  for (const field of fields) {
    if (field in value && !Object.prototype.hasOwnProperty.call(value, field)) {
      throw new Error(`buildServer ${path}.${field} must be an own field when provided`);
    }
  }
}

function readCorsAllowedOrigins(): string[] {
  const env = runtimeEnvironment();
  const configured = readOwnEnvValue(env, "RFQ_CORS_ALLOWED_ORIGINS");
  if (!configured || configured.trim().length === 0) return defaultCorsAllowedOrigins;

  const origins = configured.split(",").map((origin) => origin.trim()).filter((origin) => origin.length > 0);
  if (origins.length === 0) throw invalidCorsAllowedOriginsError();
  return normalizeCorsAllowedOrigins(origins);
}

function normalizeCorsAllowedOrigins(origins: readonly string[]): string[] {
  if (!Array.isArray(origins)) throw invalidCorsAllowedOriginsError();
  return Array.from(new Set(origins.map(normalizeCorsOrigin)));
}

function normalizeCorsOrigin(origin: string): string {
  if (typeof origin !== "string" || origin.trim().length === 0) throw invalidCorsAllowedOriginsError();

  const trimmed = origin.trim();
  if (trimmed.includes("*")) throw invalidCorsAllowedOriginsError();
  const schemeSeparatorIndex = trimmed.indexOf("://");
  if (schemeSeparatorIndex <= 0 || /[/?#]/.test(trimmed.slice(schemeSeparatorIndex + 3))) {
    throw invalidCorsAllowedOriginsError();
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw invalidCorsAllowedOriginsError();
  }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username.length > 0 ||
      parsed.password.length > 0 || parsed.pathname !== "/" || parsed.search.length > 0 || parsed.hash.length > 0) {
    throw invalidCorsAllowedOriginsError();
  }
  return parsed.origin;
}

function invalidCorsAllowedOriginsError(): Error {
  return new Error(
    "RFQ_CORS_ALLOWED_ORIGINS must be a comma-separated list of HTTP(S) URL origins without path, query, fragment, credentials, or wildcards",
  );
}

function readEnableHsts(): boolean {
  const configured = readOwnEnvValue(runtimeEnvironment(), "RFQ_ENABLE_HSTS");
  if (!configured || configured.trim().length === 0) return defaultEnableHsts;
  const normalized = configured.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error("RFQ_ENABLE_HSTS must be true or false");
}

function readTrustProxy(): boolean {
  const configured = readOwnEnvValue(runtimeEnvironment(), "RFQ_TRUST_PROXY");
  if (!configured || configured.trim().length === 0) return defaultTrustProxy;
  const normalized = configured.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error("RFQ_TRUST_PROXY must be true or false");
}
