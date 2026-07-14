import type { ReadinessComponentName, ReadinessResponse } from "../health/readiness.service.js";
import { quoteSnapshotPnlModelDescription } from "../../shared/types/rfq.js";
import type { Address, PnlTradeRecord } from "../../shared/types/rfq.js";
import { isCanonicalUtcIsoTimestamp } from "../../shared/validation/timestamp.js";
import { normalizeHumanPrice } from "../pricing/price-normalization.js";
import type { RateLimitedEndpoint } from "../rate-limit/rate-limit.service.js";
import type { ApiKeyRejectionReason } from "../auth/api-key-auth.service.js";
import type {
  CexOrderBookCycleObservation,
} from "../market-data/cex-orderbook/cex-orderbook-monitor.js";
import type { OrderBookPairConfig } from "../market-data/cex-orderbook/orderbook.js";

export interface InventoryMetricPosition {
  chainId: number;
  token: Address;
  balance: bigint;
}

export type SignerMetricOperation = "sign" | "verify";
type ReadinessMetricStatus = ReadinessResponse["status"];
type DependencyMetricStatus = "ok" | "degraded";
type CexSourceMetricState = "ready" | "stale" | "unavailable";
type CexPairMetricState = "usable" | "blocked";
type ApiAuthMetricRejectionReason = ApiKeyRejectionReason | "scope_denied";
type SubmitReservationMetricOperation = "acquire" | "release";
type QuoteControlMetricOperation = "read" | "update";

const latencyBucketsSeconds = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
const maxSafeIdentifierLength = 128;
const safeIdentifierPattern = /^[A-Za-z0-9_:-]+$/;
const readinessMetricInputFields = ["status", "components"] as const;
const inventoryMetricPositionFields = ["chainId", "token", "balance"] as const;
const pnlTradeMetricRecordFields = [
  "pnlId",
  "quoteId",
  "settlementEventId",
  "snapshotId",
  "chainId",
  "user",
  "tokenIn",
  "tokenOut",
  "amountIn",
  "amountOut",
  "minAmountOut",
  "nonce",
  "deadline",
  "midPrice",
  "tokenInDecimals",
  "tokenOutDecimals",
  "fairAmountOut",
  "valuationObservedAt",
  "grossPnlTokenOut",
  "grossPnlBps",
  "model",
  "modelDescription",
  "realizedAt",
] as const;

interface HistogramState {
  sum: number;
  count: number;
  buckets: number[];
}

export class MetricsService {
  private quoteRequests = 0;
  private quoteResponses = 0;
  private quoteErrors = 0;
  private quotePaused = 0;
  private quoteControlUpdates = 0;
  private readonly quoteControlErrors = new Map<QuoteControlMetricOperation, number>();
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
  private readonly submitLatency = createHistogramState();
  private readonly signerLatency = new Map<SignerMetricOperation, HistogramState>();
  private readinessStatus?: ReadinessMetricStatus;
  private readonly dependencyStatuses = new Map<string, DependencyMetricStatus>();
  private readonly quoteRejections = new Map<string, number>();
  private readonly inventoryBalances = new Map<string, InventoryMetricPosition>();
  private readonly realizedPnl = new Map<string, bigint>();
  private priceCacheHits = 0;
  private priceCacheMisses = 0;
  private cexOrderBookCycle: CexOrderBookCycleObservation = {
    configuredSources: 0,
    readySources: 0,
    staleSources: 0,
    unavailableSources: 0,
    usablePairs: 0,
    blockedPairs: 0,
    deviationRejectedSources: 0,
    maxUpdateAgeSeconds: 0,
  };
  private readonly cexOrderBookConnectorErrors = new Map<OrderBookPairConfig["exchange"], number>();

  recordMarketDataCacheHit(): void {
    this.priceCacheHits += 1;
  }

  recordMarketDataCacheMiss(): void {
    this.priceCacheMisses += 1;
  }

  recordCexOrderBookCycle(observation: CexOrderBookCycleObservation): void {
    assertCexOrderBookCycleObservation(observation);
    this.cexOrderBookCycle = { ...observation };
  }

  recordCexOrderBookConnectorError(exchange: OrderBookPairConfig["exchange"]): void {
    if (!cexOrderBookExchanges.includes(exchange)) {
      throw new Error("Metrics CEX order book exchange must be binance or coinbase");
    }
    this.cexOrderBookConnectorErrors.set(exchange, (this.cexOrderBookConnectorErrors.get(exchange) ?? 0) + 1);
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

  recordQuoteRejection(reasonCode: string): void {
    const reason = metricLabelValue(reasonCode);
    this.quoteRejections.set(reason, (this.quoteRejections.get(reason) ?? 0) + 1);
  }

  recordQuoteControlState(paused: boolean): void {
    if (typeof paused !== "boolean") throw new Error("Metrics quote control paused state must be a boolean");
    this.quotePaused = paused ? 1 : 0;
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
    const lines = [
      "# HELP rfq_quote_requests_total Total quote requests handled by the RFQ API.",
      "# TYPE rfq_quote_requests_total counter",
      `rfq_quote_requests_total ${this.quoteRequests}`,
      "# HELP rfq_quote_responses_total Total quote responses returned by the RFQ API.",
      "# TYPE rfq_quote_responses_total counter",
      `rfq_quote_responses_total ${this.quoteResponses}`,
      "# HELP rfq_quote_errors_total Total quote errors returned by the RFQ API.",
      "# TYPE rfq_quote_errors_total counter",
      `rfq_quote_errors_total ${this.quoteErrors}`,
      "# HELP rfq_quote_latency_seconds RFQ quote request latency in seconds.",
      "# TYPE rfq_quote_latency_seconds histogram",
      ...renderHistogram("rfq_quote_latency_seconds", this.quoteLatency),
      "# HELP rfq_quote_rejections_total Total risk-rejected quote requests by stable internal reason.",
      "# TYPE rfq_quote_rejections_total counter",
      ...this.renderQuoteRejections(),
      "# HELP rfq_quote_paused Whether quote creation is administratively paused (1) or enabled (0).",
      "# TYPE rfq_quote_paused gauge",
      `rfq_quote_paused ${this.quotePaused}`,
      "# HELP rfq_quote_control_updates_total Total successful administrative quote-control updates.",
      "# TYPE rfq_quote_control_updates_total counter",
      `rfq_quote_control_updates_total ${this.quoteControlUpdates}`,
      "# HELP rfq_quote_control_errors_total Total failed quote-control operations by bounded operation.",
      "# TYPE rfq_quote_control_errors_total counter",
      ...this.renderQuoteControlErrors(),
      "# HELP rfq_submit_requests_total Total submit requests handled by the RFQ API.",
      "# TYPE rfq_submit_requests_total counter",
      `rfq_submit_requests_total ${this.submitRequests}`,
      "# HELP rfq_submit_accepted_total Total submit requests accepted for execution.",
      "# TYPE rfq_submit_accepted_total counter",
      `rfq_submit_accepted_total ${this.submitAccepted}`,
      "# HELP rfq_submit_errors_total Total submit errors returned by the RFQ API.",
      "# TYPE rfq_submit_errors_total counter",
      `rfq_submit_errors_total ${this.submitErrors}`,
      "# HELP rfq_submit_latency_seconds RFQ submit request latency in seconds.",
      "# TYPE rfq_submit_latency_seconds histogram",
      ...renderHistogram("rfq_submit_latency_seconds", this.submitLatency),
      "# HELP rfq_submit_reservation_contention_total Total submit requests rejected because another replica owns the quote reservation.",
      "# TYPE rfq_submit_reservation_contention_total counter",
      `rfq_submit_reservation_contention_total ${this.submitReservationContention}`,
      "# HELP rfq_submit_reservation_errors_total Total submit reservation store errors by bounded operation.",
      "# TYPE rfq_submit_reservation_errors_total counter",
      ...this.renderSubmitReservationErrors(),
      "# HELP rfq_rate_limited_total Total rate-limited requests by stable endpoint group.",
      "# TYPE rfq_rate_limited_total counter",
      ...this.renderRateLimited(),
      "# HELP rfq_api_auth_rejections_total Total API authentication or scope rejections by bounded reason.",
      "# TYPE rfq_api_auth_rejections_total counter",
      ...this.renderApiAuthRejections(),
      "# HELP rfq_signer_requests_total Total signer operations by operation type.",
      "# TYPE rfq_signer_requests_total counter",
      ...this.renderSignerCounter("rfq_signer_requests_total", this.signerRequests),
      "# HELP rfq_signer_errors_total Total signer operation errors by operation type.",
      "# TYPE rfq_signer_errors_total counter",
      ...this.renderSignerCounter("rfq_signer_errors_total", this.signerErrors),
      "# HELP rfq_signer_latency_seconds Signer operation latency in seconds.",
      "# TYPE rfq_signer_latency_seconds histogram",
      ...this.renderSignerLatency(),
      "# HELP rfq_readiness_status Last readiness status reported by the readiness probe.",
      "# TYPE rfq_readiness_status gauge",
      ...this.renderReadinessStatus(),
      "# HELP rfq_dependency_status Last readiness dependency status by component.",
      "# TYPE rfq_dependency_status gauge",
      ...this.renderDependencyStatuses(),
      "# HELP rfq_settlements_total Total accepted settlements applied to inventory.",
      "# TYPE rfq_settlements_total counter",
      `rfq_settlements_total ${this.settlements}`,
      "# HELP rfq_hedge_intents_total Total hedge intents queued after settlement.",
      "# TYPE rfq_hedge_intents_total counter",
      `rfq_hedge_intents_total ${this.hedgeIntents}`,
      "# HELP rfq_hedge_intent_errors_total Total hedge intent creation errors after settlement by stable reason.",
      "# TYPE rfq_hedge_intent_errors_total counter",
      ...this.renderHedgeIntentErrors(),
      "# HELP rfq_hedge_lag_seconds Time from settlement acceptance to hedge intent queued in seconds.",
      "# TYPE rfq_hedge_lag_seconds histogram",
      ...renderHistogram("rfq_hedge_lag_seconds", this.hedgeLag),
      "# HELP rfq_quote_status_update_errors_total Total quote status persistence errors by target status.",
      "# TYPE rfq_quote_status_update_errors_total counter",
      ...this.renderQuoteStatusUpdateErrors(),
      "# HELP rfq_inventory_balance Current inventory balance by chain and token.",
      "# TYPE rfq_inventory_balance gauge",
      ...this.renderInventoryBalances(),
      "# HELP rfq_pnl_trades_total Total quote-snapshot PnL trade records produced after settlement.",
      "# TYPE rfq_pnl_trades_total counter",
      `rfq_pnl_trades_total ${this.pnlTrades}`,
      "# HELP rfq_pnl_record_errors_total Total quote-snapshot PnL record errors after settlement by stable reason.",
      "# TYPE rfq_pnl_record_errors_total counter",
      ...this.renderPnlRecordErrors(),
      "# HELP rfq_realized_pnl_token_out Gross settlement PnL versus quote-time mid price by chain and output token.",
      "# TYPE rfq_realized_pnl_token_out gauge",
      ...this.renderRealizedPnl(),
      "# HELP rfq_market_data_cache_hits_total Total cache hits for market data snapshots.",
      "# TYPE rfq_market_data_cache_hits_total counter",
      `rfq_market_data_cache_hits_total ${this.priceCacheHits}`,
      "# HELP rfq_market_data_cache_misses_total Total cache misses for market data snapshots.",
      "# TYPE rfq_market_data_cache_misses_total counter",
      `rfq_market_data_cache_misses_total ${this.priceCacheMisses}`,
      "# HELP rfq_cex_order_book_sources Current configured CEX order-book sources by bounded health state.",
      "# TYPE rfq_cex_order_book_sources gauge",
      ...this.renderCexOrderBookSources(),
      "# HELP rfq_cex_order_book_pairs Current configured CEX-backed token pairs by usability state.",
      "# TYPE rfq_cex_order_book_pairs gauge",
      ...this.renderCexOrderBookPairs(),
      "# HELP rfq_cex_order_book_deviation_rejected_sources Sources rejected by the cross-venue deviation guard in the latest cycle.",
      "# TYPE rfq_cex_order_book_deviation_rejected_sources gauge",
      `rfq_cex_order_book_deviation_rejected_sources ${this.cexOrderBookCycle.deviationRejectedSources}`,
      "# HELP rfq_cex_order_book_max_update_age_seconds Maximum observed source-event age in the latest monitor cycle.",
      "# TYPE rfq_cex_order_book_max_update_age_seconds gauge",
      `rfq_cex_order_book_max_update_age_seconds ${this.cexOrderBookCycle.maxUpdateAgeSeconds}`,
      "# HELP rfq_cex_order_book_connector_errors_total CEX order-book connector failures by bounded exchange.",
      "# TYPE rfq_cex_order_book_connector_errors_total counter",
      ...this.renderCexOrderBookConnectorErrors(),
      "",
    ];

    return lines.join("\n");
  }

  private renderInventoryBalances(): string[] {
    return [...this.inventoryBalances.values()]
      .sort((left, right) =>
        this.inventoryKey(left.chainId, left.token).localeCompare(this.inventoryKey(right.chainId, right.token)),
      )
      .map((position) => {
        return `rfq_inventory_balance{chain_id="${position.chainId}",token="${position.token.toLowerCase()}"} ${position.balance.toString()}`;
      });
  }

  private renderQuoteRejections(): string[] {
    return [...this.quoteRejections.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([reason, count]) => `rfq_quote_rejections_total{reason="${reason}"} ${count}`);
  }

  private renderQuoteControlErrors(): string[] {
    return quoteControlMetricOperations.map((operation) => {
      return `rfq_quote_control_errors_total{operation="${operation}"} ${this.quoteControlErrors.get(operation) ?? 0}`;
    });
  }

  private renderRateLimited(): string[] {
    return rateLimitedEndpoints.map((endpoint) => {
      return `rfq_rate_limited_total{endpoint="${endpoint}"} ${this.rateLimited.get(endpoint) ?? 0}`;
    });
  }

  private renderSubmitReservationErrors(): string[] {
    return submitReservationMetricOperations.map((operation) => {
      return `rfq_submit_reservation_errors_total{operation="${operation}"} ${this.submitReservationErrors.get(operation) ?? 0}`;
    });
  }

  private renderApiAuthRejections(): string[] {
    return apiAuthMetricRejectionReasons.map((reason) => {
      return `rfq_api_auth_rejections_total{reason="${reason}"} ${this.apiAuthRejections.get(reason) ?? 0}`;
    });
  }

  private renderHedgeIntentErrors(): string[] {
    return [...this.hedgeIntentErrors.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([reason, count]) => `rfq_hedge_intent_errors_total{reason="${reason}"} ${count}`);
  }

  private renderQuoteStatusUpdateErrors(): string[] {
    return [...this.quoteStatusUpdateErrors.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([status, count]) => `rfq_quote_status_update_errors_total{target_status="${status}"} ${count}`);
  }

  private renderRealizedPnl(): string[] {
    return [...this.realizedPnl.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => {
        const [chainId, token] = key.split(":");
        return `rfq_realized_pnl_token_out{chain_id="${chainId}",token="${token}"} ${value.toString()}`;
      });
  }

  private renderPnlRecordErrors(): string[] {
    return [...this.pnlRecordErrors.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([reason, count]) => `rfq_pnl_record_errors_total{reason="${reason}"} ${count}`);
  }

  private renderCexOrderBookSources(): string[] {
    const values: Record<CexSourceMetricState, number> = {
      ready: this.cexOrderBookCycle.readySources,
      stale: this.cexOrderBookCycle.staleSources,
      unavailable: this.cexOrderBookCycle.unavailableSources,
    };
    return cexSourceMetricStates.map((state) => `rfq_cex_order_book_sources{state="${state}"} ${values[state]}`);
  }

  private renderCexOrderBookPairs(): string[] {
    const values: Record<CexPairMetricState, number> = {
      usable: this.cexOrderBookCycle.usablePairs,
      blocked: this.cexOrderBookCycle.blockedPairs,
    };
    return cexPairMetricStates.map((state) => `rfq_cex_order_book_pairs{state="${state}"} ${values[state]}`);
  }

  private renderCexOrderBookConnectorErrors(): string[] {
    return cexOrderBookExchanges.map((exchange) => {
      return `rfq_cex_order_book_connector_errors_total{exchange="${exchange}"} ${this.cexOrderBookConnectorErrors.get(exchange) ?? 0}`;
    });
  }

  private renderSignerCounter(name: string, counter: ReadonlyMap<SignerMetricOperation, number>): string[] {
    return signerMetricOperations.map((operation) => {
      return `${name}{operation="${operation}"} ${counter.get(operation) ?? 0}`;
    });
  }

  private renderSignerLatency(): string[] {
    return signerMetricOperations.flatMap((operation) => {
      return renderLabeledHistogram("rfq_signer_latency_seconds", { operation }, this.getSignerLatency(operation));
    });
  }

  private renderReadinessStatus(): string[] {
    return readinessMetricStatuses.map((status) => {
      return `rfq_readiness_status{status="${status}"} ${this.readinessStatus === status ? 1 : 0}`;
    });
  }

  private renderDependencyStatuses(): string[] {
    return readinessDependencyComponents.flatMap((component) => {
      const currentStatus = this.dependencyStatuses.get(component);
      return dependencyMetricStatuses.map((status) => {
        return `rfq_dependency_status{component="${component}",status="${status}"} ${currentStatus === status ? 1 : 0}`;
      });
    });
  }

  private getSignerLatency(operation: SignerMetricOperation): HistogramState {
    const existing = this.signerLatency.get(operation);
    if (existing) {
      return existing;
    }

    const created = createHistogramState();
    this.signerLatency.set(operation, created);
    return created;
  }

  private inventoryKey(chainId: number, token: Address): string {
    return `${chainId}:${token.toLowerCase()}`;
  }
}

const signerMetricOperations: readonly SignerMetricOperation[] = ["sign", "verify"];
const rateLimitedEndpoints: readonly RateLimitedEndpoint[] = ["quote", "submit", "status"];
const apiAuthMetricRejectionReasons: readonly ApiAuthMetricRejectionReason[] = [
  "missing",
  "malformed",
  "invalid",
  "expired",
  "scope_denied",
];
const submitReservationMetricOperations: readonly SubmitReservationMetricOperation[] = ["acquire", "release"];
const quoteControlMetricOperations: readonly QuoteControlMetricOperation[] = ["read", "update"];
const readinessMetricStatuses: readonly ReadinessMetricStatus[] = ["ready", "degraded"];
const dependencyMetricStatuses: readonly DependencyMetricStatus[] = ["ok", "degraded"];
const cexSourceMetricStates: readonly CexSourceMetricState[] = ["ready", "stale", "unavailable"];
const cexPairMetricStates: readonly CexPairMetricState[] = ["usable", "blocked"];
const cexOrderBookExchanges: readonly OrderBookPairConfig["exchange"][] = ["binance", "coinbase"];
const readinessDependencyComponents: readonly ReadinessComponentName[] = [
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

function createHistogramState(): HistogramState {
  return {
    sum: 0,
    count: 0,
    buckets: latencyBucketsSeconds.map(() => 0),
  };
}

function assertCexOrderBookCycleObservation(value: unknown): asserts value is CexOrderBookCycleObservation {
  if (!isRecord(value)) throw new Error("Metrics CEX order book cycle must be an object");
  const observation = value as Record<string, unknown>;
  const integerFields = [
    "configuredSources",
    "readySources",
    "staleSources",
    "unavailableSources",
    "usablePairs",
    "blockedPairs",
    "deviationRejectedSources",
  ] as const;
  for (const field of [...integerFields, "maxUpdateAgeSeconds"] as const) {
    if (!Object.prototype.hasOwnProperty.call(observation, field)) {
      throw new Error(`Metrics CEX order book cycle.${field} must be an own field`);
    }
  }
  for (const field of integerFields) {
    if (!Number.isSafeInteger(observation[field]) || (observation[field] as number) < 0) {
      throw new Error(`Metrics CEX order book cycle.${field} must be a non-negative safe integer`);
    }
  }
  if (typeof observation.maxUpdateAgeSeconds !== "number" || !Number.isFinite(observation.maxUpdateAgeSeconds) ||
      observation.maxUpdateAgeSeconds < 0) {
    throw new Error("Metrics CEX order book cycle.maxUpdateAgeSeconds must be non-negative and finite");
  }
  if ((observation.configuredSources as number) !==
      (observation.readySources as number) + (observation.staleSources as number) +
      (observation.unavailableSources as number)) {
    throw new Error("Metrics CEX order book source states must sum to configuredSources");
  }
}

function cloneInventoryMetricPosition(position: InventoryMetricPosition): InventoryMetricPosition {
  return { ...position };
}

function assertRateLimitedEndpoint(endpoint: RateLimitedEndpoint): void {
  if (!rateLimitedEndpoints.includes(endpoint)) {
    throw new Error("Metrics rate-limited endpoint must be quote, submit, or status");
  }
}

function assertSignerMetricOperation(operation: SignerMetricOperation): void {
  if (!signerMetricOperations.includes(operation)) {
    throw new Error("Metrics signer operation must be sign or verify");
  }
}

function assertReadinessMetricInput(readiness: ReadinessResponse): void {
  if (!isRecord(readiness)) {
    throw new Error("Metrics readiness input must be an object");
  }
  assertOwnFields(readiness, readinessMetricInputFields, "readiness");
  if (!readinessMetricStatuses.includes(readiness.status)) {
    throw new Error("Metrics readiness status must be ready or degraded");
  }
  if (!isRecord(readiness.components)) {
    throw new Error("Metrics readiness components must be an object");
  }
  assertOwnFields(readiness.components, readinessDependencyComponents, "readiness components");

  const expectedComponents = new Set<string>(readinessDependencyComponents);
  for (const component of Object.keys(readiness.components)) {
    if (!expectedComponents.has(component)) {
      throw new Error(`Metrics readiness component ${component} is not supported`);
    }
  }
  for (const component of readinessDependencyComponents) {
    const status = readiness.components[component];
    if (!dependencyMetricStatuses.includes(status)) {
      throw new Error(`Metrics readiness component ${component} must be ok or degraded`);
    }
  }
}

function assertInventoryMetricPosition(position: InventoryMetricPosition): void {
  if (!isRecord(position)) {
    throw new Error("Metrics inventory position must be an object");
  }
  assertOwnFields(position, inventoryMetricPositionFields, "inventory position");
  assertPositiveSafeInteger(position.chainId, "inventory chainId");
  assertAddress(position.token, "inventory token");
  assertBigInt(position.balance, "inventory balance");
}

function assertPnlTradeMetricRecord(record: PnlTradeRecord): void {
  if (!isRecord(record)) {
    throw new Error("Metrics PnL trade record must be an object");
  }
  assertOwnFields(record, pnlTradeMetricRecordFields, "PnL trade record");

  assertSafeIdentifier(record.pnlId, "PnL trade pnlId");
  assertSafeIdentifier(record.quoteId, "PnL trade quoteId");
  assertSafeIdentifier(record.settlementEventId, "PnL trade settlementEventId");
  assertSafeIdentifier(record.snapshotId, "PnL trade snapshotId");
  assertPositiveSafeInteger(record.chainId, "PnL trade chainId");
  assertAddress(record.user, "PnL trade user");
  assertAddress(record.tokenIn, "PnL trade tokenIn");
  assertAddress(record.tokenOut, "PnL trade tokenOut");

  if (record.tokenIn.toLowerCase() === record.tokenOut.toLowerCase()) {
    throw new Error("Metrics PnL trade token pair must contain distinct tokens");
  }

  assertPositiveUIntString(record.amountIn, "PnL trade amountIn");
  assertPositiveUIntString(record.amountOut, "PnL trade amountOut");
  assertPositiveUIntString(record.minAmountOut, "PnL trade minAmountOut");
  assertPositiveUIntString(record.nonce, "PnL trade nonce");
  assertPositiveSafeInteger(record.deadline, "PnL trade deadline");

  if (BigInt(record.amountOut) < BigInt(record.minAmountOut)) {
    throw new Error("Metrics PnL trade amountOut must be greater than or equal to minAmountOut");
  }

  try {
    normalizeHumanPrice(record.midPrice);
  } catch {
    throw new Error("Metrics PnL trade midPrice must be a positive canonical decimal");
  }
  assertTokenDecimals(record.tokenInDecimals, "PnL trade tokenInDecimals");
  assertTokenDecimals(record.tokenOutDecimals, "PnL trade tokenOutDecimals");
  assertPositiveUIntString(record.fairAmountOut, "PnL trade fairAmountOut");
  if (!isCanonicalUtcIsoTimestamp(record.valuationObservedAt)) {
    throw new Error("Metrics PnL trade valuationObservedAt must be a canonical UTC ISO timestamp");
  }
  assertIntString(record.grossPnlTokenOut, "PnL trade grossPnlTokenOut");
  assertSafeInteger(record.grossPnlBps, "PnL trade grossPnlBps");

  if (record.model !== "quote_snapshot_edge_v1") {
    throw new Error("Metrics PnL trade model must be quote_snapshot_edge_v1");
  }
  if (record.modelDescription !== quoteSnapshotPnlModelDescription) {
    throw new Error("Metrics PnL trade modelDescription must describe quote_snapshot_edge_v1");
  }
  if (!isCanonicalUtcIsoTimestamp(record.realizedAt)) {
    throw new Error("Metrics PnL trade realizedAt must be a canonical UTC ISO timestamp");
  }
}

function assertPositiveSafeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Metrics ${field} must be a positive safe integer`);
  }
}

function assertSafeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`Metrics ${field} must be a safe integer`);
  }
}

function assertTokenDecimals(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 36) {
    throw new Error(`Metrics ${field} must be an integer between 0 and 36`);
  }
}

function assertAddress(value: unknown, field: string): void {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`Metrics ${field} must be a 20-byte hex address`);
  }
}

function assertBigInt(value: bigint, field: string): void {
  if (typeof value !== "bigint") {
    throw new Error(`Metrics ${field} must be a bigint`);
  }
}

function assertNonEmptyString(value: string, field: string): void {
  if (!isNonEmptyString(value)) {
    throw new Error(`Metrics ${field} must be a non-empty string`);
  }
}

function assertSafeIdentifier(value: unknown, field: string): void {
  if (typeof value !== "string") {
    throw new Error(`Metrics ${field} must be a primitive string`);
  }
  if (value.trim().length === 0) {
    throw new Error(`Metrics ${field} must be a non-empty string`);
  }
  if (value.length > maxSafeIdentifierLength) {
    throw new Error(`Metrics ${field} must be 128 characters or fewer`);
  }
  if (!safeIdentifierPattern.test(value)) {
    throw new Error(`Metrics ${field} must contain only letters, numbers, underscore, colon, or hyphen`);
  }
}

function assertPositiveUIntString(value: string, field: string): void {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`Metrics ${field} must be a positive uint string`);
  }
}

function assertIntString(value: unknown, field: string): void {
  if (typeof value !== "string" || !/^(0|-?[1-9][0-9]*)$/.test(value)) {
    throw new Error(`Metrics ${field} must be an int string`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function assertOwnFields(value: object, fields: readonly string[], path: string): void {
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      throw new Error(`Metrics ${path}.${field} must be an own field`);
    }
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function recordHistogram(state: HistogramState, value: number): void {
  assertFiniteHistogramObservation(value);
  const normalized = Math.max(0, value);
  state.count += 1;
  state.sum += normalized;

  for (let index = 0; index < latencyBucketsSeconds.length; index += 1) {
    if (normalized <= latencyBucketsSeconds[index]!) {
      state.buckets[index] += 1;
    }
  }
}

function assertFiniteHistogramObservation(value: number): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("Metrics histogram observation must be a finite number");
  }
}

function renderHistogram(name: string, state: HistogramState): string[] {
  const lines = latencyBucketsSeconds.map((bucket, index) => {
    return `${name}_bucket{le="${bucket}"} ${state.buckets[index]}`;
  });

  return [
    ...lines,
    `${name}_bucket{le="+Inf"} ${state.count}`,
    `${name}_sum ${formatMetricNumber(state.sum)}`,
    `${name}_count ${state.count}`,
  ];
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
  if (entries.length === 0 && !required) {
    return "";
  }

  return `{${entries.map(([key, value]) => `${key}="${metricLabelString(value)}"`).join(",")}}`;
}

function formatMetricNumber(value: number): string {
  if (Number.isInteger(value)) {
    return value.toString();
  }

  return value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

function metricLabelValue(value: string): string {
  assertMetricLabelValue(value);
  const normalized = value.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  return normalized.length > 0 ? normalized : "UNKNOWN";
}

function assertMetricLabelValue(value: string): void {
  if (typeof value !== "string") {
    throw new Error("Metrics label value must be a string");
  }
}

function metricLabelString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}
