import type { MarketSnapshotSamplingPair } from "../modules/market-data/market-snapshot-sampler.js";
import {
  RefreshingTreasuryLiquidityView,
  type RefreshingTreasuryLiquidityLogger,
} from "../modules/risk/refreshing-treasury-liquidity.view.js";
import type {
  TreasuryLiquidityProvider,
  TreasuryLiquidityRequest,
} from "../modules/risk/treasury-liquidity.provider.js";
import {
  readDecimalIntegerConfig,
  readOwnEnvValue,
  runtimeEnvironment,
} from "./environment.js";
import { buildRuntimeTreasuryLiquidityProvider } from "./gateway-runtime.js";

export interface GatewayTreasuryLiquidityRuntime {
  provider?: TreasuryLiquidityProvider;
  start?: () => Promise<void>;
  stop?: () => void;
}

export const defaultTreasuryLiquidityRefreshIntervalMs = 100;
export const defaultTreasuryLiquidityMaxAgeMs = 1_000;

export function buildGatewayTreasuryLiquidityRuntime(
  configuredProvider: TreasuryLiquidityProvider | undefined,
  managedPairs: readonly MarketSnapshotSamplingPair[],
  logger: RefreshingTreasuryLiquidityLogger,
): GatewayTreasuryLiquidityRuntime {
  const source = configuredProvider === undefined ? buildRuntimeTreasuryLiquidityProvider() : undefined;
  return resolveGatewayTreasuryLiquidityRuntime({
    configuredProvider,
    source,
    managedPairs,
    logger,
  });
}

export function resolveGatewayTreasuryLiquidityRuntime(input: {
  configuredProvider?: TreasuryLiquidityProvider;
  source?: TreasuryLiquidityProvider;
  managedPairs: readonly MarketSnapshotSamplingPair[];
  logger: RefreshingTreasuryLiquidityLogger;
  env?: Record<string, string | undefined>;
}): GatewayTreasuryLiquidityRuntime {
  assertInput(input);
  if (input.configuredProvider) return { provider: input.configuredProvider };
  if (!input.source) return {};

  const targets = buildTreasuryLiquidityTargets(input.managedPairs);
  if (targets.length === 0) {
    throw new Error("Treasury liquidity hot state requires at least one managed chain/token target");
  }
  const env = input.env ?? runtimeEnvironment();
  const refreshIntervalMs = readDecimalIntegerConfig(
    readOwnEnvValue(env, "RFQ_TREASURY_LIQUIDITY_REFRESH_INTERVAL_MS"),
    {
      defaultValue: defaultTreasuryLiquidityRefreshIntervalMs,
      min: 10,
      max: 60_000,
      name: "RFQ_TREASURY_LIQUIDITY_REFRESH_INTERVAL_MS",
    },
  );
  const maxAgeMs = readDecimalIntegerConfig(
    readOwnEnvValue(env, "RFQ_TREASURY_LIQUIDITY_MAX_AGE_MS"),
    {
      defaultValue: defaultTreasuryLiquidityMaxAgeMs,
      min: 20,
      max: 300_000,
      name: "RFQ_TREASURY_LIQUIDITY_MAX_AGE_MS",
    },
  );
  if (maxAgeMs < refreshIntervalMs * 2) {
    throw new Error("RFQ_TREASURY_LIQUIDITY_MAX_AGE_MS must cover at least two refresh intervals");
  }
  const expiryGraceSeconds = readDecimalIntegerConfig(
    readOwnEnvValue(env, "RFQ_QUOTE_EXPOSURE_EXPIRY_GRACE_SECONDS"),
    {
      defaultValue: 5,
      min: 1,
      max: 300,
      name: "RFQ_QUOTE_EXPOSURE_EXPIRY_GRACE_SECONDS",
    },
  );
  if (expiryGraceSeconds * 1_000 <= maxAgeMs) {
    throw new Error("RFQ_QUOTE_EXPOSURE_EXPIRY_GRACE_SECONDS must exceed Treasury hot-state max age");
  }

  const view = new RefreshingTreasuryLiquidityView(input.source, {
    targets,
    refreshIntervalMs,
    maxAgeMs,
  }, input.logger);
  return {
    provider: view,
    start: () => view.start(),
    stop: () => view.stop(),
  };
}

export function buildTreasuryLiquidityTargets(
  pairs: readonly MarketSnapshotSamplingPair[],
): TreasuryLiquidityRequest[] {
  if (!Array.isArray(pairs)) throw new Error("Treasury liquidity managed pairs must be an array");
  const targets = new Map<string, TreasuryLiquidityRequest>();
  for (const pair of pairs) {
    if (typeof pair !== "object" || pair === null || Array.isArray(pair) ||
        !Number.isSafeInteger(pair.chainId) || pair.chainId <= 0) {
      throw new Error("Treasury liquidity managed pair is invalid");
    }
    for (const token of [pair.tokenIn, pair.tokenOut]) {
      if (typeof token !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(token)) {
        throw new Error("Treasury liquidity managed pair token is invalid");
      }
      const normalized = token.toLowerCase() as `0x${string}`;
      targets.set(`${pair.chainId}:${normalized}`, { chainId: pair.chainId, token: normalized });
    }
  }
  return [...targets.values()].sort((left, right) =>
    `${left.chainId}:${left.token}`.localeCompare(`${right.chainId}:${right.token}`));
}

function assertInput(value: unknown): asserts value is {
  configuredProvider?: TreasuryLiquidityProvider;
  source?: TreasuryLiquidityProvider;
  managedPairs: readonly MarketSnapshotSamplingPair[];
  logger: RefreshingTreasuryLiquidityLogger;
  env?: Record<string, string | undefined>;
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Gateway Treasury liquidity runtime input must be an object");
  }
  const input = value as Record<string, unknown>;
  const allowed = new Set(["configuredProvider", "source", "managedPairs", "logger", "env"]);
  if (Object.keys(input).some((field) => !allowed.has(field)) ||
      !Object.prototype.hasOwnProperty.call(input, "managedPairs") ||
      !Object.prototype.hasOwnProperty.call(input, "logger")) {
    throw new Error("Gateway Treasury liquidity runtime input fields are invalid");
  }
}
