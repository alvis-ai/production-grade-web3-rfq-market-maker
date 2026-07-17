import type { ApiKeyRejectionReason } from "../auth/api-key-auth.service.js";
import type { ReadinessComponentName, ReadinessResponse } from "../health/readiness.service.js";
import type { OrderBookPairConfig } from "../market-data/cex-orderbook/orderbook.js";
import type { MarketSnapshotSampleResult } from "../market-data/market-snapshot-sampler.js";
import type { MarketDataRefreshOutcome } from "../market-data/price-updater.js";
import type { RateLimitedEndpoint } from "../rate-limit/rate-limit.service.js";
import type { DailyLossRiskFailureCode } from "../risk/daily-loss-risk.engine.js";
import type { SettlementIndexerRiskFailureCode } from "../risk/settlement-indexer-risk.guard.js";
import type { UsdReferenceHealthFailureCode } from "../market-data/chainlink-usd-reference.provider.js";
import type { Address } from "../../shared/types/rfq.js";

export interface InventoryMetricPosition {
  chainId: number;
  token: Address;
  balance: bigint;
}

export type SignerMetricOperation = "sign" | "verify";
export type ReadinessMetricStatus = ReadinessResponse["status"];
export type DependencyMetricStatus = "ok" | "degraded";
export type CexSourceMetricState = "ready" | "stale" | "unavailable";
export type CexPairMetricState = "usable" | "blocked";
export type ApiAuthMetricRejectionReason = ApiKeyRejectionReason | "scope_denied";
export type SubmitReservationMetricOperation = "acquire" | "release";
export type QuoteControlMetricOperation = "read" | "update";
export type ToxicFlowScoreMetricOperation = "read" | "update";

export interface HistogramState {
  sum: number;
  count: number;
  buckets: number[];
}

export interface DailyLossMetricObservation {
  netPnlUsdE18: bigint;
  maxLossUsdE18: bigint;
}

export const latencyBucketsSeconds = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10] as const;
export const signerMetricOperations: readonly SignerMetricOperation[] = ["sign", "verify"];
export const rateLimitedEndpoints: readonly RateLimitedEndpoint[] = ["quote", "submit", "status"];
export const apiAuthMetricRejectionReasons: readonly ApiAuthMetricRejectionReason[] = [
  "missing",
  "malformed",
  "invalid",
  "expired",
  "scope_denied",
];
export const submitReservationMetricOperations: readonly SubmitReservationMetricOperation[] = ["acquire", "release"];
export const quoteControlMetricOperations: readonly QuoteControlMetricOperation[] = ["read", "update"];
export const toxicFlowScoreMetricOperations: readonly ToxicFlowScoreMetricOperation[] = ["read", "update"];
export const readinessMetricStatuses: readonly ReadinessMetricStatus[] = ["ready", "degraded"];
export const dependencyMetricStatuses: readonly DependencyMetricStatus[] = ["ok", "degraded"];
export const cexSourceMetricStates: readonly CexSourceMetricState[] = ["ready", "stale", "unavailable"];
export const cexPairMetricStates: readonly CexPairMetricState[] = ["usable", "blocked"];
export const cexOrderBookExchanges: readonly OrderBookPairConfig["exchange"][] = ["binance", "coinbase"];
export const marketDataRefreshOutcomes: readonly MarketDataRefreshOutcome[] = ["success", "failure"];
export const marketSnapshotSampleOutcomes: readonly (keyof MarketSnapshotSampleResult)[] = [
  "saved",
  "unchanged",
  "unavailable",
  "failed",
];
export const settlementIndexerRiskFailureCodes: readonly SettlementIndexerRiskFailureCode[] = [
  "RPC_UNAVAILABLE",
  "CURSOR_STORE_UNAVAILABLE",
  "CURSOR_MISSING",
  "CURSOR_INVALID",
  "CONTRACT_MISMATCH",
  "CURSOR_STALE",
  "BLOCK_LAG",
];
export const usdReferenceHealthFailureCodes: readonly UsdReferenceHealthFailureCode[] = [
  "RPC_UNAVAILABLE",
  "RPC_CHAIN_MISMATCH",
  "SEQUENCER_UNAVAILABLE",
  "METADATA_MISMATCH",
  "FEED_UNAVAILABLE",
  "ROUND_INVALID",
  "ROUND_STALE",
  "ROUND_FUTURE",
  "ANSWER_OUT_OF_BOUNDS",
  "DEPEG",
];
export const dailyLossRiskFailureCodes: readonly DailyLossRiskFailureCode[] = ["STORE_UNAVAILABLE", "EVIDENCE_INVALID"];
export const readinessDependencyComponents: readonly ReadinessComponentName[] = [
  "marketData",
  "marketSnapshotStore",
  "routing",
  "pricing",
  "risk",
  "signer",
  "quoteRepository",
  "quoteControl",
  "riskDecisionStore",
  "rateLimitStore",
  "inventory",
  "execution",
  "settlementEventStore",
  "pnl",
  "metrics",
] as const;
