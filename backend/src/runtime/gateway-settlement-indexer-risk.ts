import type pg from "pg";
import { parseReceiptExecutionConfig } from "../modules/execution/receipt-settlement-evidence.provider.js";
import {
  PostgresSettlementIndexerRiskGuard,
  type SettlementIndexerRiskGuardConfig,
  type SettlementIndexerRiskObserver,
} from "../modules/risk/settlement-indexer-risk.guard.js";
import type {
  RefreshingSnapshotLogger,
  RefreshingSnapshotObserver,
} from "../modules/hot-state/refreshing-snapshot.js";
import {
  readDecimalIntegerConfig,
  readOwnEnvValue,
  requiresExplicitRuntimeConfig,
  runtimeEnvironment,
} from "./environment.js";
import type { GatewayHotStateConfig } from "./gateway-hot-state.js";

export const defaultSettlementIndexerMaxCursorAgeMs = 60_000;
export const defaultSettlementIndexerMaxBlockLag = 2;

export function readGatewaySettlementIndexerRiskConfig(
  env: Record<string, string | undefined> | undefined = runtimeEnvironment(),
  hotStateConfig?: GatewayHotStateConfig,
): SettlementIndexerRiskGuardConfig | undefined {
  const nodeEnv = readOwnEnvValue(env, "NODE_ENV");
  const receiptConfig = parseReceiptExecutionConfig(
    readOwnEnvValue(env, "RFQ_RECEIPT_CONFIG_JSON"),
    { requireTls: requiresExplicitRuntimeConfig(nodeEnv) },
  );
  if (receiptConfig.chains.length === 0) return undefined;
  const refreshIntervalMs = hotStateConfig?.refreshIntervalMs ?? readDecimalIntegerConfig(
    readOwnEnvValue(env, "RFQ_HOT_STATE_REFRESH_INTERVAL_MS"),
    { defaultValue: 250, min: 10, max: 60_000, name: "RFQ_HOT_STATE_REFRESH_INTERVAL_MS" },
  );
  const maxSnapshotAgeMs = hotStateConfig?.maxAgeMs ?? readDecimalIntegerConfig(
    readOwnEnvValue(env, "RFQ_HOT_STATE_MAX_AGE_MS"),
    { defaultValue: 2_000, min: 20, max: 300_000, name: "RFQ_HOT_STATE_MAX_AGE_MS" },
  );
  if (maxSnapshotAgeMs < refreshIntervalMs * 2) {
    throw new Error("RFQ_HOT_STATE_MAX_AGE_MS must cover at least two refresh intervals");
  }
  return {
    receiptConfig,
    maxCursorAgeMs: readDecimalIntegerConfig(
      readOwnEnvValue(env, "RFQ_SETTLEMENT_INDEXER_MAX_CURSOR_AGE_MS"),
      {
        defaultValue: defaultSettlementIndexerMaxCursorAgeMs,
        min: 1_000,
        max: 600_000,
        name: "RFQ_SETTLEMENT_INDEXER_MAX_CURSOR_AGE_MS",
      },
    ),
    maxBlockLag: readDecimalIntegerConfig(
      readOwnEnvValue(env, "RFQ_SETTLEMENT_INDEXER_MAX_BLOCK_LAG"),
      {
        defaultValue: defaultSettlementIndexerMaxBlockLag,
        min: 0,
        max: 10_000,
        name: "RFQ_SETTLEMENT_INDEXER_MAX_BLOCK_LAG",
      },
    ),
    refreshIntervalMs,
    maxSnapshotAgeMs,
  };
}

export function buildRuntimeSettlementIndexerRiskGuard(
  pool: pg.Pool | undefined,
  observer?: SettlementIndexerRiskObserver & RefreshingSnapshotObserver,
  hotStateConfig?: GatewayHotStateConfig,
  logger?: RefreshingSnapshotLogger,
): PostgresSettlementIndexerRiskGuard | undefined {
  if (!pool) return undefined;
  const config = readGatewaySettlementIndexerRiskConfig(undefined, hotStateConfig);
  return config
    ? new PostgresSettlementIndexerRiskGuard(
        pool, config, undefined, observer, undefined, logger, observer,
      )
    : undefined;
}
