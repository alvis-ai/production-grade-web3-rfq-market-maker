import type pg from "pg";
import {
  defaultReadinessServiceConfig,
  type ReadinessServiceConfig,
} from "../modules/health/readiness.service.js";
import { ChainlinkMarketDataService } from "../modules/market-data/chainlink-market-data.service.js";
import {
  chainlinkConfiguredPairs,
  parseChainlinkMarketDataConfig,
  type ChainlinkMarketDataConfig,
} from "../modules/market-data/chainlink-config.js";
import {
  defaultStaticMarketDataConfig,
  StaticMarketDataService,
  type MarketDataService,
} from "../modules/market-data/market-data.service.js";
import type { OrderBookPairConfig } from "../modules/market-data/cex-orderbook/orderbook.js";
import { pairKey } from "../modules/market-data/price-cache.js";
import {
  defaultFormulaPricingConfig,
  FormulaPricingEngine,
  type PricingEngine,
} from "../modules/pricing/pricing.engine.js";
import {
  ConfiguredTokenRegistry,
  defaultTokenRegistryConfig,
  parseTokenRegistryConfig,
  requireTokenMetadata,
  type TokenRegistry,
} from "../modules/pricing/token-registry.js";
import { defaultQuoteServiceConfig } from "../modules/quote/quote.service.js";
import {
  InMemoryQuoteExposureStore,
  type QuoteExposureStore,
} from "../modules/risk/quote-exposure.store.js";
import type { InMemoryPortfolioVarDependencies } from "../modules/risk/in-memory-portfolio-var.js";
import { PostgresQuoteExposureStore } from "../modules/risk/postgres-quote-exposure.store.js";
import {
  defaultTokenLimitRiskPolicy,
  parseTokenLimitRiskPolicy,
  TokenLimitRiskEngine,
  type TokenLimitRiskPolicy,
} from "../modules/risk/token-limit-risk.engine.js";
import {
  defaultDynamicToxicFlowRiskConfig,
  type DynamicToxicFlowRiskConfig,
} from "../modules/risk/dynamic-toxic-flow-risk.engine.js";
import {
  readDecimalIntegerConfig,
  readOptionalBoolean,
  readOwnEnvValue,
  requiresExplicitRuntimeConfig,
  runtimeEnvironment,
} from "./environment.js";

export interface DefaultMarketDataRuntime {
  service: MarketDataService;
  defaultPairs: ReturnType<typeof chainlinkConfiguredPairs>;
  maxSnapshotAgeMs: number;
}

interface PricingRuntime {
  engine: PricingEngine;
  tokenRegistry?: TokenRegistry;
}

export function readDefaultMarketDataRuntime(): DefaultMarketDataRuntime {
  const env = runtimeEnvironment();
  const configuredProvider = readOwnEnvValue(env, "RFQ_MARKET_DATA_PROVIDER");
  const provider = configuredProvider?.trim() || "static";
  if (provider === "static") {
    return {
      service: new StaticMarketDataService(),
      defaultPairs: defaultStaticMarketDataConfig.supportedPairs.map((pair) => ({
        ...pair,
        user: "0x0000000000000000000000000000000000000001" as const,
        amountIn: "1",
        slippageBps: 50,
      })),
      maxSnapshotAgeMs: defaultQuoteServiceConfig.maxSnapshotAgeMs,
    };
  }
  if (provider !== "chainlink") {
    throw new Error("RFQ_MARKET_DATA_PROVIDER must be static or chainlink");
  }

  const serializedConfig = readOwnEnvValue(env, "RFQ_CHAINLINK_CONFIG_JSON");
  if (!serializedConfig) throw new Error("RFQ_CHAINLINK_CONFIG_JSON is required when RFQ_MARKET_DATA_PROVIDER=chainlink");
  const config: ChainlinkMarketDataConfig = parseChainlinkMarketDataConfig(serializedConfig);
  return {
    service: new ChainlinkMarketDataService(config),
    defaultPairs: chainlinkConfiguredPairs(config),
    maxSnapshotAgeMs: config.maxPriceAgeMs,
  };
}

export function readTokenRegistry(): TokenRegistry {
  const env = runtimeEnvironment();
  const serializedConfig = readOwnEnvValue(env, "RFQ_TOKEN_REGISTRY_JSON");
  return new ConfiguredTokenRegistry(
    serializedConfig === undefined ? defaultTokenRegistryConfig : parseTokenRegistryConfig(serializedConfig),
  );
}

export function resolvePricingRuntime(
  configuredPricingEngine: PricingEngine | undefined,
  configuredTokenRegistry: TokenRegistry | undefined,
  pricingPairs: readonly { chainId: number; tokenIn: `0x${string}`; tokenOut: `0x${string}` }[],
  cexPairs: readonly OrderBookPairConfig[],
): PricingRuntime {
  if (configuredPricingEngine !== undefined && cexPairs.length === 0) return { engine: configuredPricingEngine };
  const tokenRegistry = configuredTokenRegistry ?? readTokenRegistry();
  assertCexPairsSupported(tokenRegistry, cexPairs);
  if (configuredPricingEngine !== undefined) {
    return { engine: configuredPricingEngine, tokenRegistry };
  }
  assertPricingPairsSupported(tokenRegistry, pricingPairs);
  return {
    engine: new FormulaPricingEngine(defaultFormulaPricingConfig, tokenRegistry),
    tokenRegistry,
  };
}

export function buildMarketReadinessConfig(
  pair: { chainId: number; tokenIn: `0x${string}`; tokenOut: `0x${string}`; user: `0x${string}` },
  tokenRegistry: TokenRegistry | undefined,
  maxSnapshotAgeMs: number,
): ReadinessServiceConfig {
  const amountIn = tokenRegistry
    ? (100n * 10n ** BigInt(
        requireTokenMetadata(tokenRegistry, pair.chainId, pair.tokenIn, "Readiness tokenIn").decimals,
      )).toString()
    : defaultReadinessServiceConfig.probeRequest.amountIn;
  return {
    ...defaultReadinessServiceConfig,
    maxSnapshotAgeMs,
    probeRequest: {
      chainId: pair.chainId,
      user: pair.user,
      tokenIn: pair.tokenIn,
      tokenOut: pair.tokenOut,
      amountIn,
      slippageBps: defaultReadinessServiceConfig.probeRequest.slippageBps,
    },
    probeRoutePlan: {
      ...defaultReadinessServiceConfig.probeRoutePlan,
      routeId: "readiness_route_runtime",
      tokenIn: pair.tokenIn,
      tokenOut: pair.tokenOut,
    },
  };
}

export function buildDefaultRiskEngine(
  tokenRegistry: TokenRegistry,
  managedPairs: readonly { chainId: number; tokenIn: `0x${string}`; tokenOut: `0x${string}` }[],
): TokenLimitRiskEngine {
  const env = runtimeEnvironment();
  const serializedPolicy = readOwnEnvValue(env, "RFQ_RISK_POLICY_JSON");
  const policy: TokenLimitRiskPolicy = serializedPolicy === undefined
    ? defaultTokenLimitRiskPolicy
    : parseTokenLimitRiskPolicy(serializedPolicy);

  for (const limit of policy.tokenLimits) {
    requireTokenMetadata(tokenRegistry, limit.chainId, limit.tokenAddress, "Risk policy");
  }

  const engine = new TokenLimitRiskEngine(policy, tokenRegistry);
  const inspected = new Set<string>();
  for (const pair of managedPairs) {
    const key = `${pair.chainId}:${pair.tokenIn.toLowerCase()}:${pair.tokenOut.toLowerCase()}`;
    if (inspected.has(key)) continue;
    inspected.add(key);
    if (!engine.getTokenLimit(pair.chainId, pair.tokenIn)) {
      throw new Error(`Risk policy has no tokenIn limit for managed pair ${key}`);
    }
    if (!engine.getTokenLimit(pair.chainId, pair.tokenOut)) {
      throw new Error(`Risk policy has no tokenOut limit for managed pair ${key}`);
    }
    const tokenIn = requireTokenMetadata(tokenRegistry, pair.chainId, pair.tokenIn, "Risk policy managed pair tokenIn");
    const tokenOut = requireTokenMetadata(tokenRegistry, pair.chainId, pair.tokenOut, "Risk policy managed pair tokenOut");
    if (!tokenIn.usdReference && !tokenOut.usdReference) {
      throw new Error(`Risk policy managed pair ${key} must include at least one USD-reference token`);
    }
  }
  return engine;
}

export function readDynamicToxicFlowRiskConfig(
  maxToxicScoreBps: number,
): DynamicToxicFlowRiskConfig {
  const env = runtimeEnvironment();
  return {
    maxScoreAgeMs: readDecimalIntegerConfig(readOwnEnvValue(env, "RFQ_TOXIC_FLOW_MAX_SCORE_AGE_MS"), {
      defaultValue: defaultDynamicToxicFlowRiskConfig.maxScoreAgeMs,
      min: 1_000,
      max: 604_800_000,
      name: "RFQ_TOXIC_FLOW_MAX_SCORE_AGE_MS",
    }),
    maxFutureSkewMs: readDecimalIntegerConfig(readOwnEnvValue(env, "RFQ_TOXIC_FLOW_MAX_FUTURE_SKEW_MS"), {
      defaultValue: defaultDynamicToxicFlowRiskConfig.maxFutureSkewMs,
      min: 0,
      max: 300_000,
      name: "RFQ_TOXIC_FLOW_MAX_FUTURE_SKEW_MS",
    }),
    minSampleSize: readDecimalIntegerConfig(readOwnEnvValue(env, "RFQ_TOXIC_FLOW_MIN_SAMPLE_SIZE"), {
      defaultValue: defaultDynamicToxicFlowRiskConfig.minSampleSize,
      min: 1,
      max: 1_000_000,
      name: "RFQ_TOXIC_FLOW_MIN_SAMPLE_SIZE",
    }),
    maxToxicScoreBps,
  };
}

export function resolveQuoteExposureStore(
  configuredStore: QuoteExposureStore | undefined,
  postgresPool: pg.Pool | undefined,
  defaultRiskEngine: TokenLimitRiskEngine | undefined,
  tokenRegistry: TokenRegistry,
  inMemoryPortfolioVarDependencies?: InMemoryPortfolioVarDependencies,
): QuoteExposureStore | undefined {
  if (configuredStore) return configuredStore;
  if (!defaultRiskEngine) return undefined;
  const policy = defaultRiskEngine.getQuoteExposurePolicy();
  return postgresPool
    ? new PostgresQuoteExposureStore(postgresPool, policy, tokenRegistry)
    : new InMemoryQuoteExposureStore(policy, tokenRegistry, undefined, inMemoryPortfolioVarDependencies);
}

export function readMarketDataPairs(
  defaultPairs: DefaultMarketDataRuntime["defaultPairs"],
): DefaultMarketDataRuntime["defaultPairs"] {
  const env = runtimeEnvironment();
  const configured = readOwnEnvValue(env, "RFQ_MARKET_PAIRS");

  if (configured && configured.trim().length > 0) {
    return configured.split(",").map((pairStr) => {
      const parts = pairStr.trim().split(":");
      if (parts.length !== 3) {
        throw new Error(`Invalid RFQ_MARKET_PAIRS entry: ${pairStr}. Expected format: chainId:tokenIn:tokenOut`);
      }
      const chainId = readPairChainId(parts[0], "RFQ_MARKET_PAIRS", pairStr);
      const tokenIn = readPairAddress(parts[1], "RFQ_MARKET_PAIRS", pairStr);
      const tokenOut = readPairAddress(parts[2], "RFQ_MARKET_PAIRS", pairStr);
      assertPairDistinctTokens(tokenIn, tokenOut, "RFQ_MARKET_PAIRS", pairStr);
      return {
        chainId,
        tokenIn,
        tokenOut,
        user: "0x0000000000000000000000000000000000000001" as `0x${string}`,
        amountIn: "1",
        slippageBps: 50,
      };
    });
  }

  return defaultPairs.map((pair) => ({ ...pair }));
}

export function readCexOrderBookPairs(): OrderBookPairConfig[] {
  const env = runtimeEnvironment();
  const configured = readOwnEnvValue(env, "RFQ_CEX_PAIRS");

  if (!configured || configured.trim().length === 0) return [];

  return configured.split(",").map((pairStr) => {
    const parts = pairStr.trim().split(":");
    if (parts.length !== 5) {
      throw new Error(
        `Invalid RFQ_CEX_PAIRS entry: ${pairStr}. Expected format: chainId:baseToken:usdQuoteToken:exchange:symbol`,
      );
    }
    const chainId = readPairChainId(parts[0], "RFQ_CEX_PAIRS", pairStr);
    const tokenIn = readPairAddress(parts[1], "RFQ_CEX_PAIRS", pairStr);
    const tokenOut = readPairAddress(parts[2], "RFQ_CEX_PAIRS", pairStr);
    assertPairDistinctTokens(tokenIn, tokenOut, "RFQ_CEX_PAIRS", pairStr);
    const exchange = parts[3].trim().toLowerCase();
    if (exchange !== "binance" && exchange !== "coinbase") {
      throw new Error(`Invalid RFQ_CEX_PAIRS entry: ${pairStr}. exchange must be binance or coinbase`);
    }
    const symbol = parts[4].trim().toUpperCase();
    if (!/^[A-Z0-9._-]{3,32}$/.test(symbol)) {
      throw new Error(`Invalid RFQ_CEX_PAIRS entry: ${pairStr}. symbol must be 3-32 exchange symbol characters`);
    }

    return {
      chainId,
      tokenIn,
      tokenOut,
      exchange,
      symbol,
    };
  });
}

export function readCexOrderBookConfig(pairs: OrderBookPairConfig[]) {
  const env = runtimeEnvironment();
  const nodeEnv = readOwnEnvValue(env, "NODE_ENV");
  const requireLiveBook = readOptionalBoolean(
    readOwnEnvValue(env, "RFQ_CEX_REQUIRE_LIVE_BOOK"),
    requiresExplicitRuntimeConfig(nodeEnv),
    "RFQ_CEX_REQUIRE_LIVE_BOOK",
  );
  if (pairs.length > 0 && requiresExplicitRuntimeConfig(nodeEnv) && !requireLiveBook &&
      readOwnEnvValue(env, "RFQ_MARKET_DATA_PROVIDER")?.trim() !== "chainlink") {
    throw new Error(
      "RFQ_CEX_REQUIRE_LIVE_BOOK=false requires RFQ_MARKET_DATA_PROVIDER=chainlink outside local environments",
    );
  }
  return {
    monitor: {
      pairs,
      depthRangeBps: readDecimalIntegerConfig(readOwnEnvValue(env, "RFQ_CEX_DEPTH_RANGE_BPS"), {
        defaultValue: 50,
        min: 1,
        max: 10_000,
        name: "RFQ_CEX_DEPTH_RANGE_BPS",
      }),
      flushIntervalMs: readDecimalIntegerConfig(readOwnEnvValue(env, "RFQ_CEX_FLUSH_INTERVAL_MS"), {
        defaultValue: 100,
        min: 50,
        max: 60_000,
        name: "RFQ_CEX_FLUSH_INTERVAL_MS",
      }),
      volatilitySampleSize: readDecimalIntegerConfig(readOwnEnvValue(env, "RFQ_CEX_VOLATILITY_SAMPLE_SIZE"), {
        defaultValue: 10,
        min: 3,
        max: 10_000,
        name: "RFQ_CEX_VOLATILITY_SAMPLE_SIZE",
      }),
      maxSourceAgeMs: readDecimalIntegerConfig(readOwnEnvValue(env, "RFQ_CEX_MAX_SOURCE_AGE_MS"), {
        defaultValue: 2_000,
        min: 100,
        max: 60_000,
        name: "RFQ_CEX_MAX_SOURCE_AGE_MS",
      }),
      maxFutureSkewMs: readDecimalIntegerConfig(readOwnEnvValue(env, "RFQ_CEX_MAX_FUTURE_SKEW_MS"), {
        defaultValue: 1_000,
        min: 0,
        max: 60_000,
        name: "RFQ_CEX_MAX_FUTURE_SKEW_MS",
      }),
      minSources: readDecimalIntegerConfig(readOwnEnvValue(env, "RFQ_CEX_MIN_SOURCES"), {
        defaultValue: requiresExplicitRuntimeConfig(nodeEnv) ? 2 : 1,
        min: 1,
        max: 10,
        name: "RFQ_CEX_MIN_SOURCES",
      }),
      maxSourceDeviationBps: readDecimalIntegerConfig(readOwnEnvValue(env, "RFQ_CEX_MAX_SOURCE_DEVIATION_BPS"), {
        defaultValue: 100,
        min: 1,
        max: 10_000,
        name: "RFQ_CEX_MAX_SOURCE_DEVIATION_BPS",
      }),
      maxSpreadBps: readDecimalIntegerConfig(readOwnEnvValue(env, "RFQ_CEX_MAX_SPREAD_BPS"), {
        defaultValue: 100,
        min: 1,
        max: 10_000,
        name: "RFQ_CEX_MAX_SPREAD_BPS",
      }),
    },
    requireLiveBook,
  };
}

export function buildRequiredCexCacheKeys(
  pairs: readonly OrderBookPairConfig[],
  requireLiveBook: boolean,
): string[] {
  if (!requireLiveBook) return [];
  const keys = new Set<string>();
  for (const pair of pairs) {
    keys.add(pairKey(pair.chainId, pair.tokenIn, pair.tokenOut));
    keys.add(pairKey(pair.chainId, pair.tokenOut, pair.tokenIn));
  }
  return [...keys];
}

function assertPricingPairsSupported(
  tokenRegistry: TokenRegistry,
  pricingPairs: readonly { chainId: number; tokenIn: `0x${string}`; tokenOut: `0x${string}` }[],
): void {
  const inspected = new Set<string>();
  for (const pair of pricingPairs) {
    const key = `${pair.chainId}:${pair.tokenIn.toLowerCase()}:${pair.tokenOut.toLowerCase()}`;
    if (inspected.has(key)) continue;
    inspected.add(key);
    const tokenIn = requireTokenMetadata(tokenRegistry, pair.chainId, pair.tokenIn, "Pricing tokenIn");
    const tokenOut = requireTokenMetadata(tokenRegistry, pair.chainId, pair.tokenOut, "Pricing tokenOut");
    if (!tokenIn.usdReference && !tokenOut.usdReference) {
      throw new Error(`Pricing pair ${key} requires at least one approved USD reference token`);
    }
  }
}

function assertCexPairsSupported(tokenRegistry: TokenRegistry, cexPairs: readonly OrderBookPairConfig[]): void {
  for (const pair of cexPairs) {
    requireTokenMetadata(tokenRegistry, pair.chainId, pair.tokenIn, "CEX base token");
    const quoteToken = requireTokenMetadata(tokenRegistry, pair.chainId, pair.tokenOut, "CEX quote token");
    if (!quoteToken.usdReference) {
      throw new Error(
        `CEX pair ${pair.chainId}:${pair.tokenIn.toLowerCase()}:${pair.tokenOut.toLowerCase()} ` +
          "requires the exchange quote token to be an approved USD reference token because order-book depth is expressed in USD",
      );
    }
  }
}

function readPairChainId(value: string, envName: "RFQ_MARKET_PAIRS" | "RFQ_CEX_PAIRS", entry: string): number {
  if (!/^[1-9][0-9]*$/.test(value.trim())) {
    throw new Error(`Invalid ${envName} entry: ${entry}. chainId must be a positive base-10 integer`);
  }

  const chainId = Number(value);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new Error(`Invalid ${envName} entry: ${entry}. chainId must be a positive safe integer`);
  }

  return chainId;
}

function readPairAddress(
  value: string,
  envName: "RFQ_MARKET_PAIRS" | "RFQ_CEX_PAIRS",
  entry: string,
): `0x${string}` {
  const normalized = value.trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(normalized)) {
    throw new Error(`Invalid ${envName} entry: ${entry}. token addresses must be 20-byte hex addresses`);
  }

  return normalized as `0x${string}`;
}

function assertPairDistinctTokens(
  tokenIn: `0x${string}`,
  tokenOut: `0x${string}`,
  envName: "RFQ_MARKET_PAIRS" | "RFQ_CEX_PAIRS",
  entry: string,
): void {
  if (tokenIn === tokenOut) {
    throw new Error(`Invalid ${envName} entry: ${entry}. tokenIn and tokenOut must be distinct`);
  }
}
