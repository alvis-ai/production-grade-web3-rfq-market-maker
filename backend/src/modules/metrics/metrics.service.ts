import type { Address, IntString, PnlTradeRecord, UIntString } from "../../shared/types/rfq.js";
import type { ReadinessComponentName, ReadinessResponse } from "../health/readiness.service.js";
import type { OrderBookPairConfig } from "../market-data/cex-orderbook/orderbook.js";
import type { MarketSnapshotSampleResult } from "../market-data/market-snapshot-sampler.js";
import type { MarketDataRefreshOutcome } from "../market-data/price-updater.js";
import type {
  RefreshingSnapshotMetricName,
  RefreshingSnapshotObserver,
  RefreshingSnapshotRefreshOutcome,
} from "../hot-state/refreshing-snapshot.js";
import {
  quoteLatencyStages,
  type QuoteLatencyStage,
} from "../quote/quote-service-observability.js";
import type { RateLimitedEndpoint } from "../rate-limit/rate-limit.service.js";
import type { DailyLossRiskFailureCode } from "../risk/daily-loss-risk.engine.js";
import type { SettlementIndexerRiskFailureCode } from "../risk/settlement-indexer-risk.guard.js";
import type { UsdReferenceHealthFailureCode } from "../market-data/chainlink-usd-reference.provider.js";
import {
  apiAuthMetricRejectionReasons,
  dailyLossRiskFailureCodes,
  marketDataRefreshOutcomes,
  marketSnapshotSampleOutcomes,
  quoteControlMetricOperations,
  readinessDependencyComponents,
  settlementIndexerRiskFailureCodes,
  submitReservationMetricOperations,
  toxicFlowScoreMetricOperations,
  usdReferenceHealthFailureCodes,
  type ApiAuthMetricRejectionReason,
  type DailyLossMetricObservation,
  type DependencyMetricStatus,
  type HistogramState,
  type InventoryMetricPosition,
  type QuoteControlMetricOperation,
  type ReadinessMetricStatus,
  type SignerMetricOperation,
  type SubmitReservationMetricOperation,
  type ToxicFlowScoreMetricOperation,
} from "./metrics-contract.js";
import {
  assertAddress,
  assertInventoryMetricPosition,
  assertMarketSnapshotSampleResult,
  assertPnlTradeMetricRecord,
  assertPositiveSafeInteger,
  assertRateLimitedEndpoint,
  assertReadinessMetricInput,
  assertSignerMetricOperation,
  cloneInventoryMetricPosition,
  metricLabelValue,
  parseBoundedPositiveInteger,
  parseBoundedSignedInteger,
  usdReferenceMetricKey,
} from "./metrics-validation.js";
import { createHistogramState, recordHistogram } from "./histogram.js";
import { HotStateMetrics } from "./hot-state-metrics.js";
import { CexOrderBookMetrics } from "./cex-order-book-metrics.js";
import { QuoteExposureMetrics } from "./quote-exposure-metrics.js";
import { QuoteIssuanceMetrics } from "./quote-issuance-metrics.js";
import { renderPrometheusMetrics } from "./prometheus-metrics.js";

export type { InventoryMetricPosition, SignerMetricOperation } from "./metrics-contract.js";

export class MetricsService implements RefreshingSnapshotObserver {
  private quoteRequests = 0;
  private quoteResponses = 0;
  private quoteErrors = 0;
  private quotePaused = 0;
  private quotePairsPaused = 0;
  private quoteControlUpdates = 0;
  private readonly quoteControlErrors = new Map<QuoteControlMetricOperation, number>();
  private toxicFlowScoreUpdates = 0;
  private readonly toxicFlowScoreErrors = new Map<ToxicFlowScoreMetricOperation, number>();
  private submitRequests = 0;
  private submitAccepted = 0;
  private submitErrors = 0;
  private submitReservationContention = 0;
  private readonly submitReservationErrors = new Map<SubmitReservationMetricOperation, number>();
  private readonly rateLimited = new Map<RateLimitedEndpoint, number>();
  private readonly apiAuthRejections = new Map<ApiAuthMetricRejectionReason, number>();
  private readonly signerRequests = new Map<SignerMetricOperation, number>();
  private readonly signerErrors = new Map<SignerMetricOperation, number>();
  private settlements = 0;
  private hedgeIntents = 0;
  private readonly hedgeIntentErrors = new Map<string, number>();
  private readonly hedgeLag = createHistogramState();
  private readonly quoteStatusUpdateErrors = new Map<string, number>();
  private readonly pnlRecordErrors = new Map<string, number>();
  private pnlTrades = 0;
  private readonly quoteLatency = createHistogramState();
  private readonly quoteStageLatency = new Map<QuoteLatencyStage, HistogramState>();
  private readonly submitLatency = createHistogramState();
  private readonly signerLatency = new Map<SignerMetricOperation, HistogramState>();
  private readinessStatus?: ReadinessMetricStatus;
  private readonly dependencyStatuses = new Map<ReadinessComponentName, DependencyMetricStatus>();
  private readonly quoteRejections = new Map<string, number>();
  private portfolioDeltaSoftBreaches = 0;
  private readonly inventoryBalances = new Map<string, InventoryMetricPosition>();
  private readonly realizedPnl = new Map<string, bigint>();
  private priceCacheHits = 0;
  private priceCacheMisses = 0;
  private pricingCacheHits = 0;
  private pricingCacheMisses = 0;
  private readonly marketDataRefreshes = new Map<MarketDataRefreshOutcome, number>();
  private readonly hotState = new HotStateMetrics();
  private readonly marketSnapshotSamples = new Map<keyof MarketSnapshotSampleResult, number>();
  private readonly cexOrderBook = new CexOrderBookMetrics();
  private readonly settlementIndexerRiskGuardSafe = new Map<number, boolean>();
  private readonly settlementIndexerRiskGuardFailures = new Map<string, number>();
  private readonly usdReferenceHealthSafe = new Map<string, boolean>();
  private readonly usdReferenceHealthFailures = new Map<string, number>();
  private readonly dailyLossRiskObservations = new Map<string, DailyLossMetricObservation>();
  private readonly dailyLossRiskSafe = new Map<string, boolean>();
  private readonly dailyLossRiskFailures = new Map<string, number>();
  private readonly quoteExposure = new QuoteExposureMetrics();
  private readonly quoteIssuance = new QuoteIssuanceMetrics();

  recordMarketDataCacheHit(): void {
    this.priceCacheHits += 1;
  }

  recordMarketDataCacheMiss(): void {
    this.priceCacheMisses += 1;
  }

  recordPricingCacheHit(): void {
    this.pricingCacheHits += 1;
  }

  recordPricingCacheMiss(): void {
    this.pricingCacheMisses += 1;
  }

  recordMarketDataRefresh(outcome: MarketDataRefreshOutcome): void {
    if (!marketDataRefreshOutcomes.includes(outcome)) {
      throw new Error("Metrics market data refresh outcome must be success or failure");
    }
    this.marketDataRefreshes.set(outcome, (this.marketDataRefreshes.get(outcome) ?? 0) + 1);
  }

  recordHotStateRefresh(
    name: RefreshingSnapshotMetricName,
    outcome: RefreshingSnapshotRefreshOutcome,
    refreshedAtMs?: number,
  ): void {
    this.hotState.record(name, outcome, refreshedAtMs);
  }

  recordMarketSnapshotSampleCycle(result: Readonly<MarketSnapshotSampleResult>): void {
    assertMarketSnapshotSampleResult(result);
    for (const outcome of marketSnapshotSampleOutcomes) {
      this.marketSnapshotSamples.set(
        outcome,
        (this.marketSnapshotSamples.get(outcome) ?? 0) + result[outcome],
      );
    }
  }

  recordCexOrderBookCycle(observation: Parameters<CexOrderBookMetrics["recordCycle"]>[0]): void {
    this.cexOrderBook.recordCycle(observation);
  }

  recordCexOrderBookConnectorError(exchange: OrderBookPairConfig["exchange"]): void {
    this.cexOrderBook.recordConnectorError(exchange);
  }

  recordSettlementIndexerRiskGuardSuccess(chainId: number): void {
    assertPositiveSafeInteger(chainId, "settlement indexer risk guard chainId");
    this.settlementIndexerRiskGuardSafe.set(chainId, true);
  }

  recordSettlementIndexerRiskGuardFailure(chainId: number, reason: SettlementIndexerRiskFailureCode): void {
    assertPositiveSafeInteger(chainId, "settlement indexer risk guard chainId");
    if (!settlementIndexerRiskFailureCodes.includes(reason)) {
      throw new Error("Metrics settlement indexer risk guard reason is invalid");
    }
    this.settlementIndexerRiskGuardSafe.set(chainId, false);
    const key = `${chainId}:${reason}`;
    this.settlementIndexerRiskGuardFailures.set(
      key,
      (this.settlementIndexerRiskGuardFailures.get(key) ?? 0) + 1,
    );
  }

  recordUsdReferenceHealthSuccess(chainId: number, tokenAddress: Address): void {
    assertPositiveSafeInteger(chainId, "USD-reference health chainId");
    assertAddress(tokenAddress, "USD-reference health tokenAddress");
    this.usdReferenceHealthSafe.set(usdReferenceMetricKey(chainId, tokenAddress), true);
  }

  recordUsdReferenceHealthFailure(
    chainId: number,
    tokenAddress: Address,
    reason: UsdReferenceHealthFailureCode,
  ): void {
    assertPositiveSafeInteger(chainId, "USD-reference health chainId");
    assertAddress(tokenAddress, "USD-reference health tokenAddress");
    if (!usdReferenceHealthFailureCodes.includes(reason)) {
      throw new Error("Metrics USD-reference health reason is invalid");
    }
    const feedKey = usdReferenceMetricKey(chainId, tokenAddress);
    this.usdReferenceHealthSafe.set(feedKey, false);
    const failureKey = `${feedKey}:${reason}`;
    this.usdReferenceHealthFailures.set(
      failureKey,
      (this.usdReferenceHealthFailures.get(failureKey) ?? 0) + 1,
    );
  }

  recordDailyLossRiskObservation(
    chainId: number,
    tokenAddress: Address,
    netPnlUsdE18: IntString,
    maxLossUsdE18: UIntString,
  ): void {
    assertPositiveSafeInteger(chainId, "daily loss risk chainId");
    assertAddress(tokenAddress, "daily loss risk tokenAddress");
    const netPnl = parseBoundedSignedInteger(netPnlUsdE18, "daily loss risk netPnlUsdE18");
    const maxLoss = parseBoundedPositiveInteger(maxLossUsdE18, "daily loss risk maxLossUsdE18");
    const key = usdReferenceMetricKey(chainId, tokenAddress);
    this.dailyLossRiskObservations.set(key, { netPnlUsdE18: netPnl, maxLossUsdE18: maxLoss });
    this.dailyLossRiskSafe.set(key, netPnl > -maxLoss);
  }

  recordDailyLossRiskFailure(
    chainId: number,
    tokenAddress: Address,
    reason: DailyLossRiskFailureCode,
  ): void {
    assertPositiveSafeInteger(chainId, "daily loss risk chainId");
    assertAddress(tokenAddress, "daily loss risk tokenAddress");
    if (!dailyLossRiskFailureCodes.includes(reason)) {
      throw new Error("Metrics daily loss risk reason is invalid");
    }
    const key = usdReferenceMetricKey(chainId, tokenAddress);
    this.dailyLossRiskSafe.set(key, false);
    const failureKey = `${key}:${reason}`;
    this.dailyLossRiskFailures.set(failureKey, (this.dailyLossRiskFailures.get(failureKey) ?? 0) + 1);
  }

  checkHealth(): void {
    this.renderPrometheus();
  }

  recordQuoteRequest(): void {
    this.quoteRequests += 1;
  }

  recordQuoteResponse(): void {
    this.quoteResponses += 1;
  }

  recordQuoteError(): void {
    this.quoteErrors += 1;
  }

  recordQuoteLatency(seconds: number): void {
    recordHistogram(this.quoteLatency, seconds);
  }

  recordQuoteStageLatency(stage: QuoteLatencyStage, seconds: number): void {
    if (!quoteLatencyStages.includes(stage)) throw new Error("Metrics quote latency stage is invalid");
    recordHistogram(this.getQuoteStageLatency(stage), seconds);
  }

  recordQuoteRejection(reasonCode: string): void {
    const reason = metricLabelValue(reasonCode);
    this.quoteRejections.set(reason, (this.quoteRejections.get(reason) ?? 0) + 1);
  }

  recordPortfolioDeltaSoftBreach(): void { this.portfolioDeltaSoftBreaches += 1; }
  recordLedgerMutation(observation: Parameters<QuoteExposureMetrics["recordMutation"]>[0]): void { this.quoteExposure.recordMutation(observation); }
  recordLedgerFailure(reason: Parameters<QuoteExposureMetrics["recordFailure"]>[0]): void { this.quoteExposure.recordFailure(reason); }
  recordLedgerVersionConflict(): void { this.quoteExposure.recordVersionConflict(); }
  recordLedgerLockWait(seconds: number): void { this.quoteExposure.recordLockWait(seconds); }
  recordLedgerBacklog(backlog: number): void { this.quoteExposure.recordBacklog(backlog); }
  recordLedgerMirrored(observation: Parameters<QuoteExposureMetrics["recordMirrored"]>[0]): void { this.quoteExposure.recordMirrored(observation); }
  recordLedgerMirrorError(): void { this.quoteExposure.recordMirrorError(); }
  recordIssuanceMutation(observation: Parameters<QuoteIssuanceMetrics["recordMutation"]>[0]): void { this.quoteIssuance.recordMutation(observation); }
  recordIssuanceFailure(reason: Parameters<QuoteIssuanceMetrics["recordFailure"]>[0]): void { this.quoteIssuance.recordFailure(reason); }
  recordIssuanceBacklog(backlog: number): void { this.quoteIssuance.recordBacklog(backlog); }
  recordIssuanceMirrored(observation: Parameters<QuoteIssuanceMetrics["recordMirrored"]>[0]): void { this.quoteIssuance.recordMirrored(observation); }
  recordIssuanceMirrorError(): void { this.quoteIssuance.recordMirrorError(); }
  recordQuoteControlState(paused: boolean): void {
    if (typeof paused !== "boolean") throw new Error("Metrics quote control paused state must be a boolean");
    this.quotePaused = paused ? 1 : 0;
  }

  recordPausedQuotePairCount(count: number): void {
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error("Metrics paused quote pair count must be a non-negative safe integer");
    }
    this.quotePairsPaused = count;
  }

  recordQuoteControlUpdate(): void {
    this.quoteControlUpdates += 1;
  }

  recordQuoteControlError(operation: QuoteControlMetricOperation): void {
    if (!quoteControlMetricOperations.includes(operation)) {
      throw new Error("Metrics quote control operation must be read or update");
    }
    this.quoteControlErrors.set(operation, (this.quoteControlErrors.get(operation) ?? 0) + 1);
  }

  recordToxicFlowScoreUpdate(): void {
    this.toxicFlowScoreUpdates += 1;
  }

  recordToxicFlowScoreError(operation: ToxicFlowScoreMetricOperation): void {
    if (!toxicFlowScoreMetricOperations.includes(operation)) {
      throw new Error("Metrics toxic flow score operation must be read or update");
    }
    this.toxicFlowScoreErrors.set(operation, (this.toxicFlowScoreErrors.get(operation) ?? 0) + 1);
  }

  recordSubmitRequest(): void {
    this.submitRequests += 1;
  }

  recordSubmitAccepted(): void {
    this.submitAccepted += 1;
  }

  recordSubmitError(): void {
    this.submitErrors += 1;
  }

  recordSubmitLatency(seconds: number): void {
    recordHistogram(this.submitLatency, seconds);
  }

  recordSubmitReservationContention(): void {
    this.submitReservationContention += 1;
  }

  recordSubmitReservationError(operation: SubmitReservationMetricOperation): void {
    if (!submitReservationMetricOperations.includes(operation)) {
      throw new Error("Metrics submit reservation operation is invalid");
    }
    this.submitReservationErrors.set(operation, (this.submitReservationErrors.get(operation) ?? 0) + 1);
  }

  recordRateLimited(endpoint: RateLimitedEndpoint): void {
    assertRateLimitedEndpoint(endpoint);
    this.rateLimited.set(endpoint, (this.rateLimited.get(endpoint) ?? 0) + 1);
  }

  recordApiAuthRejection(reason: ApiAuthMetricRejectionReason): void {
    if (!apiAuthMetricRejectionReasons.includes(reason)) {
      throw new Error("Metrics API auth rejection reason is invalid");
    }
    this.apiAuthRejections.set(reason, (this.apiAuthRejections.get(reason) ?? 0) + 1);
  }

  recordSignerRequest(operation: SignerMetricOperation): void {
    assertSignerMetricOperation(operation);
    this.signerRequests.set(operation, (this.signerRequests.get(operation) ?? 0) + 1);
  }

  recordSignerError(operation: SignerMetricOperation): void {
    assertSignerMetricOperation(operation);
    this.signerErrors.set(operation, (this.signerErrors.get(operation) ?? 0) + 1);
  }

  recordSignerLatency(operation: SignerMetricOperation, seconds: number): void {
    assertSignerMetricOperation(operation);
    recordHistogram(this.getSignerLatency(operation), seconds);
  }

  recordReadiness(readiness: ReadinessResponse): void {
    assertReadinessMetricInput(readiness);
    this.readinessStatus = readiness.status;
    for (const component of readinessDependencyComponents) {
      this.dependencyStatuses.set(component, readiness.components[component]);
    }
  }

  recordSettlement(): void {
    this.settlements += 1;
  }

  recordHedgeIntent(): void {
    this.hedgeIntents += 1;
  }

  recordHedgeLag(seconds: number): void {
    recordHistogram(this.hedgeLag, seconds);
  }

  recordHedgeIntentError(reasonCode: string): void {
    const reason = metricLabelValue(reasonCode);
    this.hedgeIntentErrors.set(reason, (this.hedgeIntentErrors.get(reason) ?? 0) + 1);
  }

  recordQuoteStatusUpdateError(targetStatus: string): void {
    const status = metricLabelValue(targetStatus);
    this.quoteStatusUpdateErrors.set(status, (this.quoteStatusUpdateErrors.get(status) ?? 0) + 1);
  }

  recordInventoryPosition(position: InventoryMetricPosition): void {
    assertInventoryMetricPosition(position);
    const safePosition = cloneInventoryMetricPosition(position);
    this.inventoryBalances.set(this.inventoryKey(safePosition.chainId, safePosition.token), safePosition);
  }

  recordPnlTrade(record: PnlTradeRecord): void {
    assertPnlTradeMetricRecord(record);
    const realizedPnl = BigInt(record.grossPnlTokenOut);
    const key = this.inventoryKey(record.chainId, record.tokenOut);
    this.pnlTrades += 1;
    this.realizedPnl.set(key, (this.realizedPnl.get(key) ?? 0n) + realizedPnl);
  }

  recordPnlRecordError(reasonCode: string): void {
    const reason = metricLabelValue(reasonCode);
    this.pnlRecordErrors.set(reason, (this.pnlRecordErrors.get(reason) ?? 0) + 1);
  }

  renderPrometheus(): string {
    return renderPrometheusMetrics({
      quoteRequests: this.quoteRequests,
      quoteResponses: this.quoteResponses,
      quoteErrors: this.quoteErrors,
      quoteLatency: this.quoteLatency,
      quoteStageLatency: this.quoteStageLatency,
      quoteRejections: this.quoteRejections,
      portfolioDeltaSoftBreaches: this.portfolioDeltaSoftBreaches,
      quotePaused: this.quotePaused,
      quotePairsPaused: this.quotePairsPaused,
      quoteControlUpdates: this.quoteControlUpdates,
      quoteControlErrors: this.quoteControlErrors,
      toxicFlowScoreUpdates: this.toxicFlowScoreUpdates,
      toxicFlowScoreErrors: this.toxicFlowScoreErrors,
      submitRequests: this.submitRequests,
      submitAccepted: this.submitAccepted,
      submitErrors: this.submitErrors,
      submitLatency: this.submitLatency,
      submitReservationContention: this.submitReservationContention,
      submitReservationErrors: this.submitReservationErrors,
      rateLimited: this.rateLimited,
      apiAuthRejections: this.apiAuthRejections,
      signerRequests: this.signerRequests,
      signerErrors: this.signerErrors,
      signerLatency: this.signerLatency,
      readinessStatus: this.readinessStatus,
      dependencyStatuses: this.dependencyStatuses,
      settlements: this.settlements,
      hedgeIntents: this.hedgeIntents,
      hedgeIntentErrors: this.hedgeIntentErrors,
      hedgeLag: this.hedgeLag,
      quoteStatusUpdateErrors: this.quoteStatusUpdateErrors,
      inventoryBalances: this.inventoryBalances,
      pnlTrades: this.pnlTrades,
      pnlRecordErrors: this.pnlRecordErrors,
      realizedPnl: this.realizedPnl,
      priceCacheHits: this.priceCacheHits,
      priceCacheMisses: this.priceCacheMisses,
      pricingCacheHits: this.pricingCacheHits,
      pricingCacheMisses: this.pricingCacheMisses,
      marketDataRefreshes: this.marketDataRefreshes,
      ...this.hotState.snapshot(),
      marketSnapshotSamples: this.marketSnapshotSamples,
      ...this.cexOrderBook.snapshot(),
      settlementIndexerRiskGuardSafe: this.settlementIndexerRiskGuardSafe,
      settlementIndexerRiskGuardFailures: this.settlementIndexerRiskGuardFailures,
      usdReferenceHealthSafe: this.usdReferenceHealthSafe,
      usdReferenceHealthFailures: this.usdReferenceHealthFailures,
      dailyLossRiskObservations: this.dailyLossRiskObservations,
      dailyLossRiskSafe: this.dailyLossRiskSafe,
      dailyLossRiskFailures: this.dailyLossRiskFailures,
      ...this.quoteExposure.snapshot(),
      ...this.quoteIssuance.snapshot(),
    });
  }

  private getSignerLatency(operation: SignerMetricOperation): HistogramState {
    const existing = this.signerLatency.get(operation);
    if (existing) return existing;
    const created = createHistogramState();
    this.signerLatency.set(operation, created);
    return created;
  }

  private getQuoteStageLatency(stage: QuoteLatencyStage): HistogramState {
    const existing = this.quoteStageLatency.get(stage);
    if (existing) return existing;
    const created = createHistogramState();
    this.quoteStageLatency.set(stage, created);
    return created;
  }

  private inventoryKey(chainId: number, token: Address): string {
    return `${chainId}:${token.toLowerCase()}`;
  }
}
