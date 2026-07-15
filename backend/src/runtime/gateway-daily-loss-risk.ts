import type pg from "pg";
import type { Address } from "../shared/types/rfq.js";
import {
  DailyLossRiskEngine,
  parseDailyLossRiskConfig,
  type DailyLossRiskConfig,
  type DailyLossRiskObserver,
} from "../modules/risk/daily-loss-risk.engine.js";
import { PostgresDailyLossEvidenceProvider } from "../modules/risk/postgres-daily-loss-evidence.provider.js";
import type { RiskEngine } from "../modules/risk/risk.engine.js";
import { requireTokenMetadata, type TokenRegistry } from "../modules/pricing/token-registry.js";
import {
  readOwnEnvValue,
  requiresExplicitRuntimeConfig,
  runtimeEnvironment,
} from "./environment.js";

export interface DailyLossManagedPair {
  chainId: number;
  tokenIn: Address;
  tokenOut: Address;
}

export function buildDailyLossRiskEngine(
  baseEngine: RiskEngine,
  tokenRegistry: TokenRegistry,
  managedPairs: readonly DailyLossManagedPair[],
  postgresPool: pg.Pool | undefined,
  env: Record<string, string | undefined> | undefined = runtimeEnvironment(),
  observer?: DailyLossRiskObserver,
): RiskEngine {
  const serialized = readOwnEnvValue(env, "RFQ_DAILY_LOSS_CONFIG_JSON");
  if (!serialized) return baseEngine;
  if (!postgresPool) throw new Error("RFQ_DAILY_LOSS_CONFIG_JSON requires PostgreSQL");
  const config = parseDailyLossRiskConfig(serialized);
  assertDailyLossLimitCoverage(config, tokenRegistry, managedPairs);
  return new DailyLossRiskEngine(
    baseEngine,
    tokenRegistry,
    new PostgresDailyLossEvidenceProvider(postgresPool),
    config,
    observer,
  );
}

export function assertProductionDailyLossRiskPolicy(
  usingDefaultRiskEngine: boolean,
  postgresPool: pg.Pool | undefined,
  env: Record<string, string | undefined> | undefined = runtimeEnvironment(),
): void {
  if (!usingDefaultRiskEngine ||
      !requiresExplicitRuntimeConfig(readOwnEnvValue(env, "NODE_ENV"))) return;
  if (!postgresPool) throw new Error("Daily loss risk requires PostgreSQL outside local environments");
  const serialized = readOwnEnvValue(env, "RFQ_DAILY_LOSS_CONFIG_JSON");
  if (!serialized) {
    throw new Error("RFQ_DAILY_LOSS_CONFIG_JSON is required outside local environments");
  }
  parseDailyLossRiskConfig(serialized);
}

export function assertDailyLossLimitCoverage(
  config: DailyLossRiskConfig,
  tokenRegistry: TokenRegistry,
  managedPairs: readonly DailyLossManagedPair[],
): void {
  if (!Array.isArray(managedPairs)) throw new Error("Daily loss managedPairs must be an array");
  const configured = new Set(config.limits.map(({ chainId, tokenAddress }) =>
    `${chainId}:${tokenAddress.toLowerCase()}`));
  for (const limit of config.limits) {
    const metadata = requireTokenMetadata(
      tokenRegistry,
      limit.chainId,
      limit.tokenAddress,
      "Daily loss limit",
    );
    if (!metadata.isWhitelisted || !metadata.usdReference) {
      throw new Error(`Daily loss limit ${limit.chainId}:${limit.tokenAddress} is not a whitelisted USD reference`);
    }
  }
  for (const pair of managedPairs) {
    assertManagedPair(pair);
    for (const tokenAddress of [pair.tokenIn, pair.tokenOut]) {
      const metadata = requireTokenMetadata(tokenRegistry, pair.chainId, tokenAddress, "Daily loss managed pair");
      if (metadata.usdReference && !configured.has(`${pair.chainId}:${tokenAddress.toLowerCase()}`)) {
        throw new Error(`Daily loss config has no limit for managed USD reference ${pair.chainId}:${tokenAddress}`);
      }
    }
  }
}

function assertManagedPair(pair: DailyLossManagedPair): void {
  if (typeof pair !== "object" || pair === null || Array.isArray(pair)) {
    throw new Error("Daily loss managed pair must be an object");
  }
  if (!Number.isSafeInteger(pair.chainId) || pair.chainId <= 0) {
    throw new Error("Daily loss managed pair chainId must be a positive safe integer");
  }
  for (const [field, value] of [["tokenIn", pair.tokenIn], ["tokenOut", pair.tokenOut]] as const) {
    if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
      throw new Error(`Daily loss managed pair ${field} must be a 20-byte hex address`);
    }
  }
  if (pair.tokenIn.toLowerCase() === pair.tokenOut.toLowerCase()) {
    throw new Error("Daily loss managed pair tokens must be distinct");
  }
}
