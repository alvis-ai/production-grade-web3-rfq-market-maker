import {
  defaultHedgeServiceConfig,
  type HedgeServiceConfig,
} from "../modules/hedge/hedge.service.js";
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
