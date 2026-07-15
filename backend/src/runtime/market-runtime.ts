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
  ChainlinkUsdReferenceHealthProvider,
} from "../modules/market-data/chainlink-usd-reference.provider.js";
import {
  parseChainlinkUsdReferenceConfig,
  usdReferenceFeedKey,
  type ChainlinkUsdReferenceConfig,
} from "../modules/market-data/chainlink-usd-reference-config.js";
import { parseHedgeRoutesJson } from "../modules/hedge/hedge-route.js";
import {
  BinanceSymbolRulesService,
  type BinanceSymbolRulesHealth,
} from "../modules/hedge/binance-symbol-rules.js";
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
import type { RiskEngine } from "../modules/risk/risk.engine.js";
import { UsdReferenceRiskEngine } from "../modules/risk/usd-reference-risk.engine.js";
import {
  readDecimalIntegerConfig,
  readOptionalBoolean,
  readOwnEnvValue,
  requiresExplicitRuntimeConfig,
  runtimeEnvironment,
} from "./environment.js";

export interface DefaultMarketDataRuntime {
  provider: "static" | "chainlink";
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
    const configuredPairs = readMarketDataPairs(
      defaultStaticMarketDataConfig.supportedPairs.map((pair) => ({
        ...pair,
        user: "0x0000000000000000000000000000000000000001" as const,
        amountIn: "1",
        slippageBps: 50,
      })),
    );
    return {
      provider: "static",
      service: new StaticMarketDataService({
        supportedPairs: configuredPairs.map(({ chainId, tokenIn, tokenOut }) => ({
          chainId,
          tokenIn,
          tokenOut,
        })),
      }),
      defaultPairs: configuredPairs,
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
    provider: "chainlink",
    service: new ChainlinkMarketDataService(config),
    defaultPairs: chainlinkConfiguredPairs(config),
    maxSnapshotAgeMs: config.maxPriceAgeMs,
  };
}

export function assertProductionMarketDataPolicy(
  provider: DefaultMarketDataRuntime["provider"],
  cexPairs: readonly OrderBookPairConfig[],
  requireLiveBook: boolean,
  env: Record<string, string | undefined> | undefined = runtimeEnvironment(),
): void {
  const nodeEnv = readOwnEnvValue(env, "NODE_ENV");
  if (!requiresExplicitRuntimeConfig(nodeEnv) || provider === "chainlink") return;
  if (cexPairs.length === 0 || !requireLiveBook) {
    throw new Error(
      "Non-local static market data requires non-empty RFQ_CEX_PAIRS and RFQ_CEX_REQUIRE_LIVE_BOOK=true",
    );
  }
}

export function assertProductionCexSourcePolicy(
  pairs: readonly OrderBookPairConfig[],
  minSources: number,
  env: Record<string, string | undefined> | undefined = runtimeEnvironment(),
): void {
  if (!requiresExplicitRuntimeConfig(readOwnEnvValue(env, "NODE_ENV"))) return;
  if (!Number.isSafeInteger(minSources) || minSources < 2) {
    throw new Error("Non-local CEX market data requires RFQ_CEX_MIN_SOURCES to be at least 2");
  }

  const groups = new Map<string, OrderBookPairConfig[]>();
  for (const pair of pairs) {
    const key = pairKey(pair.chainId, pair.tokenIn, pair.tokenOut);
    const group = groups.get(key) ?? [];
    group.push(pair);
    groups.set(key, group);
  }

  for (const [key, sources] of groups) {
    const uniqueConnectors = new Set(sources.map(({ exchange, symbol }) => `${exchange}:${symbol.toUpperCase()}`));
    if (uniqueConnectors.size < minSources) {
      throw new Error(`Non-local CEX market ${key} must configure at least RFQ_CEX_MIN_SOURCES distinct sources`);
    }
    const hedgeSources = sources.filter(({ role }) => role === "hedge");
    const referenceSources = sources.filter(({ role }) => role === "reference");
    if (hedgeSources.length === 0 || referenceSources.length === 0) {
      throw new Error(`Non-local CEX market ${key} requires both hedge and reference sources`);
    }
    if (!referenceSources.some((reference) =>
      hedgeSources.some((hedge) => hedge.exchange !== reference.exchange))) {
      throw new Error(`Non-local CEX market ${key} requires a reference source from an independent exchange`);
    }
  }
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
  assertCexHedgeSourcesRoutable(tokenRegistry, cexPairs);
  if (configuredPricingEngine !== undefined) {
    return { engine: configuredPricingEngine, tokenRegistry };
  }
  assertPricingPairsSupported(tokenRegistry, pricingPairs);
  return {
    engine: new FormulaPricingEngine(defaultFormulaPricingConfig, tokenRegistry),
    tokenRegistry,
  };
}

export function assertCexHedgeSourcesRoutable(
  tokenRegistry: TokenRegistry,
  cexPairs: readonly OrderBookPairConfig[],
  env: Record<string, string | undefined> | undefined = runtimeEnvironment(),
): void {
  const hedgeSources = cexPairs.filter(({ role }) => role === "hedge");
  if (hedgeSources.length === 0) return;

  const serializedRoutes = readOwnEnvValue(env, "RFQ_HEDGE_ROUTES_JSON");
  if (!serializedRoutes) {
    throw new Error("RFQ_HEDGE_ROUTES_JSON is required when RFQ_CEX_PAIRS contains hedge sources");
  }
  const routes = parseHedgeRoutesJson(serializedRoutes);
  routes.validateTokenRegistry(tokenRegistry);

  for (const source of hedgeSources) {
    const route = routes.find(source.chainId, source.tokenIn);
    const sourceId = `${source.chainId}:${source.tokenIn.toLowerCase()}:${source.tokenOut.toLowerCase()}:` +
      `${source.exchange}:${source.symbol.toUpperCase()}`;
    if (!route) throw new Error(`CEX hedge source ${sourceId} has no configured hedge route`);
    if (route.venue !== source.exchange || route.symbol.toUpperCase() !== source.symbol.toUpperCase() ||
        route.quoteToken.toLowerCase() !== source.tokenOut.toLowerCase()) {
      throw new Error(`CEX hedge source ${sourceId} does not match its configured hedge route`);
    }
  }
}

export function buildRuntimeBinanceSymbolRulesHealth(
  cexPairs: readonly OrderBookPairConfig[],
  env: Record<string, string | undefined> | undefined = runtimeEnvironment(),
  fetchFn: typeof fetch = fetch,
): BinanceSymbolRulesHealth | undefined {
  if (!cexPairs.some(({ role }) => role === "hedge")) return undefined;
  const serializedRoutes = readOwnEnvValue(env, "RFQ_HEDGE_ROUTES_JSON");
  if (!serializedRoutes) {
    throw new Error("RFQ_HEDGE_ROUTES_JSON is required when RFQ_CEX_PAIRS contains hedge sources");
  }
  const baseUrl = readOwnEnvValue(env, "RFQ_BINANCE_BASE_URL");
  return new BinanceSymbolRulesService({
    ...(baseUrl ? { baseUrl } : {}),
    requestTimeoutMs: readDecimalIntegerConfig(readOwnEnvValue(env, "RFQ_BINANCE_REQUEST_TIMEOUT_MS"), {
      defaultValue: 10_000,
      min: 100,
      max: 60_000,
      name: "RFQ_BINANCE_REQUEST_TIMEOUT_MS",
    }),
    maxAgeMs: readDecimalIntegerConfig(readOwnEnvValue(env, "RFQ_BINANCE_SYMBOL_RULES_MAX_AGE_MS"), {
      defaultValue: 300_000,
      min: 10_000,
      max: 3_600_000,
      name: "RFQ_BINANCE_SYMBOL_RULES_MAX_AGE_MS",
    }),
  }, parseHedgeRoutesJson(serializedRoutes), fetchFn);
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

export function buildUsdReferenceRiskEngine(
  baseEngine: RiskEngine,
  tokenRegistry: TokenRegistry,
  managedPairs: readonly { chainId: number; tokenIn: `0x${string}`; tokenOut: `0x${string}` }[],
  env: Record<string, string | undefined> | undefined = runtimeEnvironment(),
): RiskEngine {
  const serializedConfig = readOwnEnvValue(env, "RFQ_USD_REFERENCE_CONFIG_JSON");
  if (!serializedConfig) return baseEngine;
  const config = parseChainlinkUsdReferenceConfig(serializedConfig);
  assertUsdReferenceFeedCoverage(config, tokenRegistry, managedPairs);
  return new UsdReferenceRiskEngine(
    baseEngine,
    tokenRegistry,
    new ChainlinkUsdReferenceHealthProvider(config),
    config.policyVersion,
  );
}

export function assertProductionUsdReferenceRiskPolicy(
  usingDefaultRiskEngine: boolean,
  env: Record<string, string | undefined> | undefined = runtimeEnvironment(),
): void {
  if (!usingDefaultRiskEngine || !requiresExplicitRuntimeConfig(readOwnEnvValue(env, "NODE_ENV"))) return;
  if (!readOwnEnvValue(env, "RFQ_USD_REFERENCE_CONFIG_JSON")) {
    throw new Error("RFQ_USD_REFERENCE_CONFIG_JSON is required outside local environments");
  }
}

export function assertUsdReferenceFeedCoverage(
  config: ChainlinkUsdReferenceConfig,
  tokenRegistry: TokenRegistry,
  managedPairs: readonly { chainId: number; tokenIn: `0x${string}`; tokenOut: `0x${string}` }[],
): void {
  const configuredFeeds = new Map<string, string>();
  for (const network of config.networks) {
    for (const feed of network.feeds) {
      const metadata = requireTokenMetadata(
        tokenRegistry,
        network.chainId,
        feed.tokenAddress,
        "USD-reference feed",
      );
      if (!metadata.usdReference) {
        throw new Error(`USD-reference feed token ${network.chainId}:${feed.tokenAddress.toLowerCase()} is not marked usdReference`);
      }
      if (feed.description !== `${metadata.symbol} / USD`) {
        throw new Error(`USD-reference feed description must match token symbol ${metadata.symbol} / USD`);
      }
      configuredFeeds.set(usdReferenceFeedKey(network.chainId, feed.tokenAddress), feed.description);
    }
  }

  const requiredFeeds = new Set<string>();
  for (const pair of managedPairs) {
    for (const tokenAddress of [pair.tokenIn, pair.tokenOut]) {
      const metadata = requireTokenMetadata(tokenRegistry, pair.chainId, tokenAddress, "USD-reference managed pair");
      if (metadata.usdReference) requiredFeeds.add(usdReferenceFeedKey(pair.chainId, tokenAddress));
    }
  }
  for (const key of requiredFeeds) {
    if (!configuredFeeds.has(key)) throw new Error(`USD-reference config has no feed for managed token ${key}`);
  }
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
    if (parts.length !== 6) {
      throw new Error(
        `Invalid RFQ_CEX_PAIRS entry: ${pairStr}. Expected format: chainId:baseToken:usdQuoteToken:exchange:symbol:role`,
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
    const role = parts[5].trim().toLowerCase();
    if (role !== "hedge" && role !== "reference") {
      throw new Error(`Invalid RFQ_CEX_PAIRS entry: ${pairStr}. role must be hedge or reference`);
    }
    if (role === "hedge" && exchange !== "binance") {
      throw new Error(`Invalid RFQ_CEX_PAIRS entry: ${pairStr}. hedge role requires the supported binance execution venue`);
    }

    return {
      chainId,
      tokenIn,
      tokenOut,
      exchange,
      symbol,
      role,
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
  const minSources = readDecimalIntegerConfig(readOwnEnvValue(env, "RFQ_CEX_MIN_SOURCES"), {
    defaultValue: requiresExplicitRuntimeConfig(nodeEnv) ? 2 : 1,
    min: 1,
    max: 10,
    name: "RFQ_CEX_MIN_SOURCES",
  });
  assertProductionCexSourcePolicy(pairs, minSources, env);
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
      minSources,
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
