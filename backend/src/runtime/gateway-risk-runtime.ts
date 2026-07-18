import type pg from "pg";
import type {
  RefreshingSnapshotLogger,
  RefreshingSnapshotObserver,
} from "../modules/hot-state/refreshing-snapshot.js";
import {
  ChainlinkUsdReferenceHealthProvider,
  type UsdReferenceHealthObserver,
} from "../modules/market-data/chainlink-usd-reference.provider.js";
import { parseChainlinkUsdReferenceConfig } from "../modules/market-data/chainlink-usd-reference-config.js";
import { RefreshingUsdReferenceHealthProvider } from "../modules/market-data/refreshing-usd-reference-health.provider.js";
import type { TokenRegistry } from "../modules/pricing/token-registry.js";
import { DynamicToxicFlowRiskEngine } from "../modules/risk/dynamic-toxic-flow-risk.engine.js";
import type { DailyLossRiskObserver } from "../modules/risk/daily-loss-risk.engine.js";
import type { RiskEngine } from "../modules/risk/risk.engine.js";
import { UsdReferenceRiskEngine } from "../modules/risk/usd-reference-risk.engine.js";
import type { ToxicFlowScoreStore } from "../modules/risk/toxic-flow-score.store.js";
import {
  buildDailyLossRiskRuntime,
  type DailyLossManagedPair,
} from "./gateway-daily-loss-risk.js";
import type { GatewayHotStateConfig, GatewayHotStateLifecycle } from "./gateway-hot-state.js";
import { readOwnEnvValue, runtimeEnvironment } from "./environment.js";
import {
  assertUsdReferenceFeedCoverage,
  readDynamicToxicFlowRiskConfig,
  type buildDefaultRiskEngine,
} from "./market-runtime.js";

export interface GatewayRiskRuntime {
  engine: RiskEngine;
  lifecycle?: GatewayHotStateLifecycle;
}

export function buildGatewayRiskRuntime(input: {
  configured?: RiskEngine;
  defaultEngine?: ReturnType<typeof buildDefaultRiskEngine>;
  toxicFlowScoreStore: ToxicFlowScoreStore;
  tokenRegistry: TokenRegistry;
  managedPairs: readonly DailyLossManagedPair[];
  pool?: pg.Pool;
  hotStateConfig: GatewayHotStateConfig;
  observer?: DailyLossRiskObserver & UsdReferenceHealthObserver & RefreshingSnapshotObserver;
  logger?: RefreshingSnapshotLogger;
}): GatewayRiskRuntime {
  if (input.configured) return { engine: input.configured };
  if (!input.defaultEngine) throw new Error("Gateway default risk engine is required");
  let composed: RiskEngine = new DynamicToxicFlowRiskEngine(
    input.defaultEngine,
    input.toxicFlowScoreStore,
    readDynamicToxicFlowRiskConfig(input.defaultEngine.getMaxToxicScoreBps()),
  );
  let usdReferenceLifecycle: GatewayHotStateLifecycle | undefined;
  const serializedUsdConfig = readOwnEnvValue(runtimeEnvironment(), "RFQ_USD_REFERENCE_CONFIG_JSON");
  if (serializedUsdConfig) {
    const config = parseChainlinkUsdReferenceConfig(serializedUsdConfig);
    assertUsdReferenceFeedCoverage(config, input.tokenRegistry, input.managedPairs);
    const health = new RefreshingUsdReferenceHealthProvider(
      new ChainlinkUsdReferenceHealthProvider(config, undefined, undefined, input.observer),
      {
        targets: config.networks.flatMap(({ chainId, feeds }) =>
          feeds.map(({ tokenAddress }) => ({ chainId, tokenAddress }))),
        refreshIntervalMs: input.hotStateConfig.refreshIntervalMs,
        maxAgeMs: input.hotStateConfig.maxAgeMs,
      },
      input.logger,
      undefined,
      input.observer,
    );
    composed = new UsdReferenceRiskEngine(composed, input.tokenRegistry, health, config.policyVersion);
    usdReferenceLifecycle = health;
  }
  const dailyLoss = buildDailyLossRiskRuntime(
    composed,
    input.tokenRegistry,
    input.managedPairs,
    input.pool,
    input.hotStateConfig,
    undefined,
    input.observer,
    input.logger,
    input.observer,
  );
  const lifecycles = [usdReferenceLifecycle, dailyLoss.lifecycle].filter(
    (lifecycle): lifecycle is GatewayHotStateLifecycle => lifecycle !== undefined,
  );
  return {
    engine: dailyLoss.engine,
    ...(lifecycles.length === 0 ? {} : { lifecycle: combineLifecycles(lifecycles) }),
  };
}

function combineLifecycles(lifecycles: readonly GatewayHotStateLifecycle[]): GatewayHotStateLifecycle {
  return {
    async start() {
      await Promise.all(lifecycles.map((lifecycle) => lifecycle.start()));
    },
    stop() {
      for (const lifecycle of lifecycles) lifecycle.stop();
    },
  };
}
