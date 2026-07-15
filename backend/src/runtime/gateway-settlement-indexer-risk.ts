import type pg from "pg";
import { parseReceiptExecutionConfig } from "../modules/execution/receipt-settlement-evidence.provider.js";
import {
  PostgresSettlementIndexerRiskGuard,
  type SettlementIndexerRiskGuard,
  type SettlementIndexerRiskGuardConfig,
} from "../modules/risk/settlement-indexer-risk.guard.js";
import {
  readDecimalIntegerConfig,
  readOwnEnvValue,
  requiresExplicitRuntimeConfig,
  runtimeEnvironment,
} from "./environment.js";

export const defaultSettlementIndexerMaxCursorAgeMs = 60_000;
export const defaultSettlementIndexerMaxBlockLag = 2;

export function readGatewaySettlementIndexerRiskConfig(
  env: Record<string, string | undefined> | undefined = runtimeEnvironment(),
): SettlementIndexerRiskGuardConfig | undefined {
  const nodeEnv = readOwnEnvValue(env, "NODE_ENV");
  const receiptConfig = parseReceiptExecutionConfig(
    readOwnEnvValue(env, "RFQ_RECEIPT_CONFIG_JSON"),
    { requireTls: requiresExplicitRuntimeConfig(nodeEnv) },
  );
  if (receiptConfig.chains.length === 0) return undefined;
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
  };
}

export function buildRuntimeSettlementIndexerRiskGuard(
  pool: pg.Pool | undefined,
): SettlementIndexerRiskGuard | undefined {
  if (!pool) return undefined;
  const config = readGatewaySettlementIndexerRiskConfig();
  return config ? new PostgresSettlementIndexerRiskGuard(pool, config) : undefined;
}
