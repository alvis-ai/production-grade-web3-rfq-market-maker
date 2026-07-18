import {
  type HedgeIntentService,
  type HedgeRiskPenaltyProvider,
  defaultHedgeServiceConfig,
  type HedgeServiceConfig,
} from "../modules/hedge/hedge.service.js";
import type pg from "pg";
import { HedgeService } from "../modules/hedge/hedge.service.js";
import { PostgresHedgeService } from "../modules/hedge/postgres-hedge.service.js";
import { RefreshingHedgeRiskPenaltyView } from "../modules/hedge/refreshing-hedge-risk-penalty.view.js";
import type { Address } from "../shared/types/rfq.js";
import type {
  RefreshingSnapshotLogger,
  RefreshingSnapshotObserver,
} from "../modules/hot-state/refreshing-snapshot.js";
import type { GatewayHotStateConfig, GatewayHotStateLifecycle } from "./gateway-hot-state.js";
import {
  readDecimalIntegerConfig,
  readOwnEnvValue,
  runtimeEnvironment,
} from "./environment.js";

export function readGatewayHedgeServiceConfig(
  env = runtimeEnvironment(),
): HedgeServiceConfig {
  return {
    failurePenaltyBps: readDecimalIntegerConfig(
      readOwnEnvValue(env, "RFQ_HEDGE_FAILURE_PENALTY_BPS"),
      {
        defaultValue: defaultHedgeServiceConfig.failurePenaltyBps,
        max: 10_000,
        min: 1,
        name: "RFQ_HEDGE_FAILURE_PENALTY_BPS",
      },
    ),
    maxFailurePenaltyBps: readDecimalIntegerConfig(
      readOwnEnvValue(env, "RFQ_HEDGE_MAX_FAILURE_PENALTY_BPS"),
      {
        defaultValue: defaultHedgeServiceConfig.maxFailurePenaltyBps,
        max: 10_000,
        min: 1,
        name: "RFQ_HEDGE_MAX_FAILURE_PENALTY_BPS",
      },
    ),
    failureLookbackMs: readDecimalIntegerConfig(
      readOwnEnvValue(env, "RFQ_HEDGE_FAILURE_LOOKBACK_MS"),
      {
        defaultValue: defaultHedgeServiceConfig.failureLookbackMs,
        max: 86_400_000,
        min: 1_000,
        name: "RFQ_HEDGE_FAILURE_LOOKBACK_MS",
      },
    ),
  };
}

export interface GatewayHedgeRiskRuntime {
  service: HedgeIntentService;
  quoteRiskProvider: HedgeRiskPenaltyProvider;
  lifecycle?: GatewayHotStateLifecycle;
}

export function buildGatewayHedgeRiskRuntime(
  configured: HedgeIntentService | undefined,
  pool: pg.Pool | undefined,
  targets: readonly { chainId: number; tokenIn: Address; tokenOut: Address }[],
  hotStateConfig: GatewayHotStateConfig,
  logger?: RefreshingSnapshotLogger,
  observer?: RefreshingSnapshotObserver,
): GatewayHedgeRiskRuntime {
  if (configured) return {
    service: configured,
    quoteRiskProvider: configured.quoteRiskPenaltyBps
      ? { quoteRiskPenaltyBps: configured.quoteRiskPenaltyBps.bind(configured) }
      : { quoteRiskPenaltyBps: () => 0 },
  };
  const config = readGatewayHedgeServiceConfig();
  const service = pool ? new PostgresHedgeService(pool, config) : new HedgeService(config);
  if (!pool) return { service, quoteRiskProvider: service as HedgeRiskPenaltyProvider };
  const uniqueTargets = new Map<string, { chainId: number; token: Address }>();
  for (const pair of targets) {
    for (const token of [pair.tokenIn, pair.tokenOut]) {
      uniqueTargets.set(`${pair.chainId}:${token.toLowerCase()}`, {
        chainId: pair.chainId,
        token: token.toLowerCase() as Address,
      });
    }
  }
  if (uniqueTargets.size === 0) {
    return { service, quoteRiskProvider: { quoteRiskPenaltyBps: () => 0 } };
  }
  const quoteRiskProvider = new RefreshingHedgeRiskPenaltyView(
    service as HedgeRiskPenaltyProvider,
    {
      targets: [...uniqueTargets.values()],
      refreshIntervalMs: hotStateConfig.refreshIntervalMs,
      maxAgeMs: hotStateConfig.maxAgeMs,
    },
    logger,
    undefined,
    observer,
  );
  return { service, quoteRiskProvider, lifecycle: quoteRiskProvider };
}
