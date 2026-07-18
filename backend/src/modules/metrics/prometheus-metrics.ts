import type { Address } from "../../shared/types/rfq.js";
import type { ReadinessComponentName } from "../health/readiness.service.js";
import type { CexOrderBookCycleObservation } from "../market-data/cex-orderbook/cex-orderbook-monitor.js";
import type { OrderBookPairConfig } from "../market-data/cex-orderbook/orderbook.js";
import type { MarketSnapshotSampleResult } from "../market-data/market-snapshot-sampler.js";
import type { MarketDataRefreshOutcome } from "../market-data/price-updater.js";
import {
  quoteLatencyStages,
  type QuoteLatencyStage,
} from "../quote/quote-service-observability.js";
import type { RateLimitedEndpoint } from "../rate-limit/rate-limit.service.js";
import {
  apiAuthMetricRejectionReasons,
  cexOrderBookExchanges,
  cexPairMetricStates,
  cexSourceMetricStates,
  dependencyMetricStatuses,
  latencyBucketsSeconds,
  marketDataRefreshOutcomes,
  marketSnapshotSampleOutcomes,
  quoteControlMetricOperations,
  rateLimitedEndpoints,
  readinessDependencyComponents,
  readinessMetricStatuses,
  signerMetricOperations,
  submitReservationMetricOperations,
  toxicFlowScoreMetricOperations,
  type ApiAuthMetricRejectionReason,
  type CexPairMetricState,
  type CexSourceMetricState,
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
import { createHistogramState, renderHistogram } from "./histogram.js";
import type { CexOrderBookMetricsState } from "./cex-order-book-metrics.js";
import {
  renderHotStateMetrics,
  type HotStateMetricsState,
} from "./hot-state-metrics.js";
import {
  renderQuoteExposureMetrics,
  type QuoteExposureMetricsState,
} from "./quote-exposure-metrics.js";
import {
  renderQuoteIssuanceMetrics,
  type QuoteIssuanceMetricsState,
} from "./quote-issuance-metrics.js";

export interface PrometheusMetricsState
  extends QuoteExposureMetricsState,
    QuoteIssuanceMetricsState,
    HotStateMetricsState,
    CexOrderBookMetricsState {
  quoteRequests: number;
  quoteResponses: number;
  quoteErrors: number;
  quoteLatency: HistogramState;
  quoteStageLatency: ReadonlyMap<QuoteLatencyStage, HistogramState>;
  quoteRejections: ReadonlyMap<string, number>;
  portfolioDeltaSoftBreaches: number;
  quotePaused: number;
  quotePairsPaused: number;
  quoteControlUpdates: number;
  quoteControlErrors: ReadonlyMap<QuoteControlMetricOperation, number>;
  toxicFlowScoreUpdates: number;
  toxicFlowScoreErrors: ReadonlyMap<ToxicFlowScoreMetricOperation, number>;
  submitRequests: number;
  submitAccepted: number;
  submitErrors: number;
  submitLatency: HistogramState;
  submitReservationContention: number;
  submitReservationErrors: ReadonlyMap<SubmitReservationMetricOperation, number>;
  rateLimited: ReadonlyMap<RateLimitedEndpoint, number>;
  apiAuthRejections: ReadonlyMap<ApiAuthMetricRejectionReason, number>;
  signerRequests: ReadonlyMap<SignerMetricOperation, number>;
  signerErrors: ReadonlyMap<SignerMetricOperation, number>;
  signerLatency: ReadonlyMap<SignerMetricOperation, HistogramState>;
  readinessStatus?: ReadinessMetricStatus;
  dependencyStatuses: ReadonlyMap<ReadinessComponentName, DependencyMetricStatus>;
  settlements: number;
  hedgeIntents: number;
  hedgeIntentErrors: ReadonlyMap<string, number>;
  hedgeLag: HistogramState;
  quoteStatusUpdateErrors: ReadonlyMap<string, number>;
  inventoryBalances: ReadonlyMap<string, InventoryMetricPosition>;
  pnlTrades: number;
  pnlRecordErrors: ReadonlyMap<string, number>;
  realizedPnl: ReadonlyMap<string, bigint>;
  priceCacheHits: number;
  priceCacheMisses: number;
  pricingCacheHits: number;
  pricingCacheMisses: number;
  marketDataRefreshes: ReadonlyMap<MarketDataRefreshOutcome, number>;
  marketSnapshotSamples: ReadonlyMap<keyof MarketSnapshotSampleResult, number>;
  settlementIndexerRiskGuardSafe: ReadonlyMap<number, boolean>;
  settlementIndexerRiskGuardFailures: ReadonlyMap<string, number>;
  usdReferenceHealthSafe: ReadonlyMap<string, boolean>;
  usdReferenceHealthFailures: ReadonlyMap<string, number>;
  dailyLossRiskObservations: ReadonlyMap<string, DailyLossMetricObservation>;
  dailyLossRiskSafe: ReadonlyMap<string, boolean>;
  dailyLossRiskFailures: ReadonlyMap<string, number>;
}

export function renderPrometheusMetrics(state: PrometheusMetricsState): string {
  const lines = [
    "# HELP rfq_quote_requests_total Total quote requests handled by the RFQ API.",
    "# TYPE rfq_quote_requests_total counter",
    `rfq_quote_requests_total ${state.quoteRequests}`,
    "# HELP rfq_quote_responses_total Total quote responses returned by the RFQ API.",
    `rfq_quote_responses_total ${state.quoteResponses}`,
    "# HELP rfq_quote_errors_total Total quote errors returned by the RFQ API.",
    "# TYPE rfq_quote_errors_total counter",
    `rfq_quote_errors_total ${state.quoteErrors}`,
    "# HELP rfq_quote_latency_seconds RFQ quote request latency in seconds.",
    "# TYPE rfq_quote_latency_seconds histogram",
    ...renderHistogram("rfq_quote_latency_seconds", state.quoteLatency),
    "# HELP rfq_quote_stage_latency_seconds RFQ quote dependency latency by bounded stage in seconds.",
    "# TYPE rfq_quote_stage_latency_seconds histogram",
    ...quoteLatencyStages.flatMap((stage) => {
      return renderLabeledHistogram(
        "rfq_quote_stage_latency_seconds",
        { stage },
        state.quoteStageLatency.get(stage) ?? createHistogramState(),
      );
    }),
    "# HELP rfq_quote_rejections_total Total risk-rejected quote requests by stable internal reason.",
    "# TYPE rfq_quote_rejections_total counter",
    ...renderStringCounter("rfq_quote_rejections_total", "reason", state.quoteRejections),
    "# HELP rfq_portfolio_delta_soft_breaches_total Total accepted reservations above a portfolio delta soft limit.",
    "# TYPE rfq_portfolio_delta_soft_breaches_total counter",
    `rfq_portfolio_delta_soft_breaches_total ${state.portfolioDeltaSoftBreaches}`,
    ...renderQuoteExposureMetrics(state),
    ...renderQuoteIssuanceMetrics(state),
    "# HELP rfq_quote_paused Whether quote creation is administratively paused (1) or enabled (0).",
    "# TYPE rfq_quote_paused gauge",
    `rfq_quote_paused ${state.quotePaused}`,
    "# HELP rfq_quote_pairs_paused Number of normalized chain and token pairs with quote creation paused.",
    "# TYPE rfq_quote_pairs_paused gauge",
    `rfq_quote_pairs_paused ${state.quotePairsPaused}`,
    "# HELP rfq_quote_control_updates_total Total successful administrative quote-control updates.",
    "# TYPE rfq_quote_control_updates_total counter",
    `rfq_quote_control_updates_total ${state.quoteControlUpdates}`,
    "# HELP rfq_quote_control_errors_total Total failed quote-control operations by bounded operation.",
    "# TYPE rfq_quote_control_errors_total counter",
    ...quoteControlMetricOperations.map((operation) => {
      return `rfq_quote_control_errors_total{operation="${operation}"} ${state.quoteControlErrors.get(operation) ?? 0}`;
    }),
    "# HELP rfq_toxic_flow_score_updates_total Total successful administrative toxic-flow score updates.",
    "# TYPE rfq_toxic_flow_score_updates_total counter",
    `rfq_toxic_flow_score_updates_total ${state.toxicFlowScoreUpdates}`,
    "# HELP rfq_toxic_flow_score_errors_total Total failed toxic-flow score operations by bounded operation.",
    "# TYPE rfq_toxic_flow_score_errors_total counter",
    ...toxicFlowScoreMetricOperations.map((operation) => {
      return `rfq_toxic_flow_score_errors_total{operation="${operation}"} ${state.toxicFlowScoreErrors.get(operation) ?? 0}`;
    }),
    "# HELP rfq_submit_requests_total Total submit requests handled by the RFQ API.",
    "# TYPE rfq_submit_requests_total counter",
    `rfq_submit_requests_total ${state.submitRequests}`,
    "# HELP rfq_submit_accepted_total Total submit requests accepted for execution.",
    "# TYPE rfq_submit_accepted_total counter",
    `rfq_submit_accepted_total ${state.submitAccepted}`,
    "# HELP rfq_submit_errors_total Total submit errors returned by the RFQ API.",
    "# TYPE rfq_submit_errors_total counter",
    `rfq_submit_errors_total ${state.submitErrors}`,
    "# HELP rfq_submit_latency_seconds RFQ submit request latency in seconds.",
    "# TYPE rfq_submit_latency_seconds histogram",
    ...renderHistogram("rfq_submit_latency_seconds", state.submitLatency),
    "# HELP rfq_submit_reservation_contention_total Total submit requests rejected because another replica owns the quote reservation.",
    "# TYPE rfq_submit_reservation_contention_total counter",
    `rfq_submit_reservation_contention_total ${state.submitReservationContention}`,
    "# HELP rfq_submit_reservation_errors_total Total submit reservation store errors by bounded operation.",
    "# TYPE rfq_submit_reservation_errors_total counter",
    ...submitReservationMetricOperations.map((operation) => {
      return `rfq_submit_reservation_errors_total{operation="${operation}"} ${state.submitReservationErrors.get(operation) ?? 0}`;
    }),
    "# HELP rfq_rate_limited_total Total rate-limited requests by stable endpoint group.",
    "# TYPE rfq_rate_limited_total counter",
    ...rateLimitedEndpoints.map((endpoint) => {
      return `rfq_rate_limited_total{endpoint="${endpoint}"} ${state.rateLimited.get(endpoint) ?? 0}`;
    }),
    "# HELP rfq_api_auth_rejections_total Total API authentication or scope rejections by bounded reason.",
    "# TYPE rfq_api_auth_rejections_total counter",
    ...apiAuthMetricRejectionReasons.map((reason) => {
      return `rfq_api_auth_rejections_total{reason="${reason}"} ${state.apiAuthRejections.get(reason) ?? 0}`;
    }),
    "# HELP rfq_signer_requests_total Total signer operations by operation type.",
    "# TYPE rfq_signer_requests_total counter",
    ...renderSignerCounter("rfq_signer_requests_total", state.signerRequests),
    "# HELP rfq_signer_errors_total Total signer operation errors by operation type.",
    "# TYPE rfq_signer_errors_total counter",
    ...renderSignerCounter("rfq_signer_errors_total", state.signerErrors),
    "# HELP rfq_signer_latency_seconds Signer operation latency in seconds.",
    "# TYPE rfq_signer_latency_seconds histogram",
    ...signerMetricOperations.flatMap((operation) => {
      return renderLabeledHistogram(
        "rfq_signer_latency_seconds",
        { operation },
        state.signerLatency.get(operation) ?? createHistogramState(),
      );
    }),
    "# HELP rfq_readiness_status Last readiness status reported by the readiness probe.",
    "# TYPE rfq_readiness_status gauge",
    ...readinessMetricStatuses.map((status) => {
      return `rfq_readiness_status{status="${status}"} ${state.readinessStatus === status ? 1 : 0}`;
    }),
    "# HELP rfq_dependency_status Last readiness dependency status by component.",
    "# TYPE rfq_dependency_status gauge",
    ...renderDependencyStatuses(state),
    "# HELP rfq_settlements_total Total accepted settlements applied to inventory.",
    "# TYPE rfq_settlements_total counter",
    `rfq_settlements_total ${state.settlements}`,
    "# HELP rfq_hedge_intents_total Total hedge intents queued after settlement.",
    "# TYPE rfq_hedge_intents_total counter",
    `rfq_hedge_intents_total ${state.hedgeIntents}`,
    "# HELP rfq_hedge_intent_errors_total Total hedge intent creation errors after settlement by stable reason.",
    "# TYPE rfq_hedge_intent_errors_total counter",
    ...renderStringCounter("rfq_hedge_intent_errors_total", "reason", state.hedgeIntentErrors),
    "# HELP rfq_hedge_lag_seconds Time from settlement acceptance to hedge intent queued in seconds.",
    "# TYPE rfq_hedge_lag_seconds histogram",
    ...renderHistogram("rfq_hedge_lag_seconds", state.hedgeLag),
    "# HELP rfq_quote_status_update_errors_total Total quote status persistence errors by target status.",
    "# TYPE rfq_quote_status_update_errors_total counter",
    ...renderStringCounter(
      "rfq_quote_status_update_errors_total",
      "target_status",
      state.quoteStatusUpdateErrors,
    ),
    "# HELP rfq_inventory_balance Current inventory balance by chain and token.",
    "# TYPE rfq_inventory_balance gauge",
    ...renderInventoryBalances(state.inventoryBalances),
    "# HELP rfq_pnl_trades_total Total quote-snapshot PnL trade records produced after settlement.",
    "# TYPE rfq_pnl_trades_total counter",
    `rfq_pnl_trades_total ${state.pnlTrades}`,
    "# HELP rfq_pnl_record_errors_total Total quote-snapshot PnL record errors after settlement by stable reason.",
    "# TYPE rfq_pnl_record_errors_total counter",
    ...renderStringCounter("rfq_pnl_record_errors_total", "reason", state.pnlRecordErrors),
    "# HELP rfq_realized_pnl_token_out Gross settlement PnL versus quote-time mid price by chain and output token.",
    "# TYPE rfq_realized_pnl_token_out gauge",
    ...renderRealizedPnl(state.realizedPnl),
    "# HELP rfq_market_data_cache_hits_total Total cache hits for market data snapshots.",
    "# TYPE rfq_market_data_cache_hits_total counter",
    `rfq_market_data_cache_hits_total ${state.priceCacheHits}`,
    "# HELP rfq_market_data_cache_misses_total Total cache misses for market data snapshots.",
    "# TYPE rfq_market_data_cache_misses_total counter",
    `rfq_market_data_cache_misses_total ${state.priceCacheMisses}`,
    "# HELP rfq_pricing_cache_hits_total Total exact pricing-result cache hits.",
    "# TYPE rfq_pricing_cache_hits_total counter",
    `rfq_pricing_cache_hits_total ${state.pricingCacheHits}`,
    "# HELP rfq_pricing_cache_misses_total Total exact pricing-result cache misses.",
    "# TYPE rfq_pricing_cache_misses_total counter",
    `rfq_pricing_cache_misses_total ${state.pricingCacheMisses}`,
    "# HELP rfq_market_data_refreshes_total Background base-market-data pair refreshes by bounded outcome.",
    "# TYPE rfq_market_data_refreshes_total counter",
    ...marketDataRefreshOutcomes.map((outcome) => {
      return `rfq_market_data_refreshes_total{outcome="${outcome}"} ${state.marketDataRefreshes.get(outcome) ?? 0}`;
    }),
    ...renderHotStateMetrics(state),
    "# HELP rfq_market_snapshot_samples_total Background audit snapshot samples by bounded outcome.",
    "# TYPE rfq_market_snapshot_samples_total counter",
    ...marketSnapshotSampleOutcomes.map((outcome) => {
      return `rfq_market_snapshot_samples_total{outcome="${outcome}"} ${state.marketSnapshotSamples.get(outcome) ?? 0}`;
    }),
    "# HELP rfq_cex_order_book_sources Current configured CEX order-book sources by bounded health state.",
    "# TYPE rfq_cex_order_book_sources gauge",
    ...renderCexOrderBookSources(state.cexOrderBookCycle),
    "# HELP rfq_cex_order_book_pairs Current configured CEX-backed token pairs by usability state.",
    "# TYPE rfq_cex_order_book_pairs gauge",
    ...renderCexOrderBookPairs(state.cexOrderBookCycle),
    "# HELP rfq_cex_order_book_deviation_rejected_sources Sources rejected by the cross-venue deviation guard in the latest cycle.",
    "# TYPE rfq_cex_order_book_deviation_rejected_sources gauge",
    `rfq_cex_order_book_deviation_rejected_sources ${state.cexOrderBookCycle.deviationRejectedSources}`,
    "# HELP rfq_cex_order_book_max_update_age_seconds Maximum observed source-event age in the latest monitor cycle.",
    "# TYPE rfq_cex_order_book_max_update_age_seconds gauge",
    `rfq_cex_order_book_max_update_age_seconds ${state.cexOrderBookCycle.maxUpdateAgeSeconds}`,
    "# HELP rfq_cex_order_book_connector_errors_total CEX order-book connector failures by bounded exchange.",
    "# TYPE rfq_cex_order_book_connector_errors_total counter",
    ...cexOrderBookExchanges.map((exchange) => {
      return `rfq_cex_order_book_connector_errors_total{exchange="${exchange}"} ${state.cexOrderBookConnectorErrors.get(exchange) ?? 0}`;
    }),
    "# HELP rfq_settlement_indexer_risk_guard_safe Whether the latest API pre-sign indexer check passed by chain.",
    "# TYPE rfq_settlement_indexer_risk_guard_safe gauge",
    ...renderChainSafeGauge("rfq_settlement_indexer_risk_guard_safe", state.settlementIndexerRiskGuardSafe),
    "# HELP rfq_settlement_indexer_risk_guard_failures_total API pre-sign indexer guard failures by chain and bounded reason.",
    "# TYPE rfq_settlement_indexer_risk_guard_failures_total counter",
    ...renderChainReasonCounter(
      "rfq_settlement_indexer_risk_guard_failures_total",
      state.settlementIndexerRiskGuardFailures,
    ),
    "# HELP rfq_usd_reference_health_safe Whether the latest dedicated token/USD oracle check passed by configured token.",
    "# TYPE rfq_usd_reference_health_safe gauge",
    ...renderTokenSafeGauge("rfq_usd_reference_health_safe", state.usdReferenceHealthSafe),
    "# HELP rfq_usd_reference_health_failures_total Dedicated token/USD oracle failures by configured token and bounded reason.",
    "# TYPE rfq_usd_reference_health_failures_total counter",
    ...renderTokenReasonCounter("rfq_usd_reference_health_failures_total", state.usdReferenceHealthFailures),
    "# HELP rfq_daily_realized_pnl_usd Current UTC-day realized hedge-net PnL in USD-reference units by configured token.",
    "# TYPE rfq_daily_realized_pnl_usd gauge",
    ...renderDailyLossObservation(state.dailyLossRiskObservations),
    "# HELP rfq_daily_loss_limit_remaining_usd Current UTC-day realized-loss budget remaining by configured token.",
    "# TYPE rfq_daily_loss_limit_remaining_usd gauge",
    ...renderDailyLossRemaining(state.dailyLossRiskObservations),
    "# HELP rfq_daily_loss_risk_safe Whether the latest pre-sign UTC-day realized-loss check passed by configured token.",
    "# TYPE rfq_daily_loss_risk_safe gauge",
    ...renderTokenSafeGauge("rfq_daily_loss_risk_safe", state.dailyLossRiskSafe),
    "# HELP rfq_daily_loss_risk_failures_total Daily realized-loss evidence failures by configured token and bounded reason.",
    "# TYPE rfq_daily_loss_risk_failures_total counter",
    ...renderTokenReasonCounter("rfq_daily_loss_risk_failures_total", state.dailyLossRiskFailures),
    "",
  ];

  return lines.join("\n");
}

function renderStringCounter(name: string, label: string, values: ReadonlyMap<string, number>): string[] {
  return [...values.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([value, count]) => `${name}{${label}="${value}"} ${count}`);
}

function renderCompositeCounter(
  name: string,
  labels: readonly [string, string],
  values: ReadonlyMap<string, number>,
): string[] {
  return [...values.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, count]) => {
      const parts = key.split(":");
      if (parts.length !== labels.length) {
        throw new Error(`Metrics composite counter ${name} has an invalid key`);
      }
      return `${name}{${labels.map((label, index) => `${label}="${parts[index]}"`).join(",")}} ${count}`;
    });
}

function renderInventoryBalances(values: ReadonlyMap<string, InventoryMetricPosition>): string[] {
  return [...values.values()]
    .sort((left, right) => inventoryKey(left.chainId, left.token).localeCompare(inventoryKey(right.chainId, right.token)))
    .map((position) => {
      return `rfq_inventory_balance{chain_id="${position.chainId}",token="${position.token.toLowerCase()}"} ${position.balance.toString()}`;
    });
}

function renderRealizedPnl(values: ReadonlyMap<string, bigint>): string[] {
  return [...values.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => {
      const [chainId, token] = key.split(":");
      return `rfq_realized_pnl_token_out{chain_id="${chainId}",token="${token}"} ${value.toString()}`;
    });
}

function renderCexOrderBookSources(observation: CexOrderBookCycleObservation): string[] {
  const values: Record<CexSourceMetricState, number> = {
    ready: observation.readySources,
    stale: observation.staleSources,
    unavailable: observation.unavailableSources,
  };
  return cexSourceMetricStates.map((status) => `rfq_cex_order_book_sources{state="${status}"} ${values[status]}`);
}

function renderCexOrderBookPairs(observation: CexOrderBookCycleObservation): string[] {
  const values: Record<CexPairMetricState, number> = {
    usable: observation.usablePairs,
    blocked: observation.blockedPairs,
  };
  return cexPairMetricStates.map((status) => `rfq_cex_order_book_pairs{state="${status}"} ${values[status]}`);
}

function renderChainSafeGauge(name: string, values: ReadonlyMap<number, boolean>): string[] {
  return [...values.entries()]
    .sort(([left], [right]) => left - right)
    .map(([chainId, safe]) => `${name}{chain_id="${chainId}"} ${safe ? 1 : 0}`);
}

function renderChainReasonCounter(name: string, values: ReadonlyMap<string, number>): string[] {
  return [...values.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, count]) => {
      const [chainId, reason] = key.split(":");
      return `${name}{chain_id="${chainId}",reason="${reason}"} ${count}`;
    });
}

function renderTokenSafeGauge(name: string, values: ReadonlyMap<string, boolean>): string[] {
  return [...values.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, safe]) => {
      const [chainId, token] = key.split(":");
      return `${name}{chain_id="${chainId}",token="${token}"} ${safe ? 1 : 0}`;
    });
}

function renderTokenReasonCounter(name: string, values: ReadonlyMap<string, number>): string[] {
  return [...values.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, count]) => {
      const [chainId, token, reason] = key.split(":");
      return `${name}{chain_id="${chainId}",token="${token}",reason="${reason}"} ${count}`;
    });
}

function renderDailyLossObservation(values: ReadonlyMap<string, DailyLossMetricObservation>): string[] {
  return [...values.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, observation]) => {
      const [chainId, token] = key.split(":");
      return `rfq_daily_realized_pnl_usd{chain_id="${chainId}",token="${token}"} ${formatE18(observation.netPnlUsdE18)}`;
    });
}

function renderDailyLossRemaining(values: ReadonlyMap<string, DailyLossMetricObservation>): string[] {
  return [...values.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, observation]) => {
      const [chainId, token] = key.split(":");
      const remaining = observation.maxLossUsdE18 + observation.netPnlUsdE18;
      return `rfq_daily_loss_limit_remaining_usd{chain_id="${chainId}",token="${token}"} ${formatE18(remaining)}`;
    });
}

function renderSignerCounter(name: string, counter: ReadonlyMap<SignerMetricOperation, number>): string[] {
  return signerMetricOperations.map((operation) => {
    return `${name}{operation="${operation}"} ${counter.get(operation) ?? 0}`;
  });
}

function renderDependencyStatuses(state: PrometheusMetricsState): string[] {
  return readinessDependencyComponents.flatMap((component) => {
    const currentStatus = state.dependencyStatuses.get(component);
    return dependencyMetricStatuses.map((status) => {
      return `rfq_dependency_status{component="${component}",status="${status}"} ${currentStatus === status ? 1 : 0}`;
    });
  });
}

function renderLabeledHistogram(
  name: string,
  labels: Readonly<Record<string, string>>,
  state: HistogramState,
): string[] {
  const labelPrefix = renderMetricLabels(labels, false);
  const bucketLines = latencyBucketsSeconds.map((bucket, index) => {
    return `${name}_bucket${renderMetricLabels({ ...labels, le: bucket.toString() })} ${state.buckets[index]}`;
  });

  return [
    ...bucketLines,
    `${name}_bucket${renderMetricLabels({ ...labels, le: "+Inf" })} ${state.count}`,
    `${name}_sum${labelPrefix} ${formatMetricNumber(state.sum)}`,
    `${name}_count${labelPrefix} ${state.count}`,
  ];
}

function renderMetricLabels(labels: Readonly<Record<string, string>>, required = true): string {
  const entries = Object.entries(labels);
  if (entries.length === 0 && !required) return "";
  return `{${entries.map(([key, value]) => `${key}="${metricLabelString(value)}"`).join(",")}}`;
}

function formatMetricNumber(value: number): string {
  if (Number.isInteger(value)) return value.toString();
  return value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

function formatE18(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / 1_000_000_000_000_000_000n;
  const fraction = (absolute % 1_000_000_000_000_000_000n)
    .toString()
    .padStart(18, "0")
    .replace(/0+$/, "");
  const formatted = `${whole}${fraction.length === 0 ? "" : `.${fraction}`}`;
  return negative && absolute !== 0n ? `-${formatted}` : formatted;
}

function metricLabelString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function inventoryKey(chainId: number, token: Address): string {
  return `${chainId}:${token.toLowerCase()}`;
}
