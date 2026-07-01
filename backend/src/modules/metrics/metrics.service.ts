import type { ReadinessComponentName, ReadinessResponse } from "../health/readiness.service.js";
import type { Address, PnlTradeRecord } from "../../shared/types/rfq.js";
import type { RateLimitedEndpoint } from "../rate-limit/rate-limit.service.js";

export interface InventoryMetricPosition {
  chainId: number;
  token: Address;
  balance: bigint;
}

export type SignerMetricOperation = "sign" | "verify";
type ReadinessMetricStatus = ReadinessResponse["status"];
type DependencyMetricStatus = "ok" | "degraded";

const latencyBucketsSeconds = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

interface HistogramState {
  sum: number;
  count: number;
  buckets: number[];
}

export class MetricsService {
  private quoteRequests = 0;
  private quoteResponses = 0;
  private quoteErrors = 0;
  private submitRequests = 0;
  private submitAccepted = 0;
  private submitErrors = 0;
  private readonly rateLimited = new Map<RateLimitedEndpoint, number>();
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

  recordRateLimited(endpoint: RateLimitedEndpoint): void {
    assertRateLimitedEndpoint(endpoint);
    this.rateLimited.set(endpoint, (this.rateLimited.get(endpoint) ?? 0) + 1);
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
      "# HELP rfq_quote_requests_total Total quote requests handled by the skeleton API.",
      "# TYPE rfq_quote_requests_total counter",
      `rfq_quote_requests_total ${this.quoteRequests}`,
      "# HELP rfq_quote_responses_total Total quote responses returned by the skeleton API.",
      "# TYPE rfq_quote_responses_total counter",
      `rfq_quote_responses_total ${this.quoteResponses}`,
      "# HELP rfq_quote_errors_total Total quote errors returned by the skeleton API.",
      "# TYPE rfq_quote_errors_total counter",
      `rfq_quote_errors_total ${this.quoteErrors}`,
      "# HELP rfq_quote_latency_seconds RFQ quote request latency in seconds.",
      "# TYPE rfq_quote_latency_seconds histogram",
      ...renderHistogram("rfq_quote_latency_seconds", this.quoteLatency),
      "# HELP rfq_quote_rejections_total Total risk-rejected quote requests by stable internal reason.",
      "# TYPE rfq_quote_rejections_total counter",
      ...this.renderQuoteRejections(),
      "# HELP rfq_submit_requests_total Total submit requests accepted by the skeleton API.",
      "# TYPE rfq_submit_requests_total counter",
      `rfq_submit_requests_total ${this.submitRequests}`,
      "# HELP rfq_submit_accepted_total Total submit requests accepted for execution.",
      "# TYPE rfq_submit_accepted_total counter",
      `rfq_submit_accepted_total ${this.submitAccepted}`,
      "# HELP rfq_submit_errors_total Total submit errors returned by the skeleton API.",
      "# TYPE rfq_submit_errors_total counter",
      `rfq_submit_errors_total ${this.submitErrors}`,
      "# HELP rfq_submit_latency_seconds RFQ submit request latency in seconds.",
      "# TYPE rfq_submit_latency_seconds histogram",
      ...renderHistogram("rfq_submit_latency_seconds", this.submitLatency),
      "# HELP rfq_rate_limited_total Total rate-limited requests by stable endpoint group.",
      "# TYPE rfq_rate_limited_total counter",
      ...this.renderRateLimited(),
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
      "# HELP rfq_settlements_total Total simulated settlements applied to inventory.",
      "# TYPE rfq_settlements_total counter",
      `rfq_settlements_total ${this.settlements}`,
      "# HELP rfq_hedge_intents_total Total hedge intents queued after settlement.",
      "# TYPE rfq_hedge_intents_total counter",
      `rfq_hedge_intents_total ${this.hedgeIntents}`,
      "# HELP rfq_hedge_intent_errors_total Total hedge intent creation errors after settlement by stable reason.",
      "# TYPE rfq_hedge_intent_errors_total counter",
      ...this.renderHedgeIntentErrors(),
      "# HELP rfq_hedge_lag_seconds Time from simulated settlement acceptance to hedge intent queued in seconds.",
      "# TYPE rfq_hedge_lag_seconds histogram",
      ...renderHistogram("rfq_hedge_lag_seconds", this.hedgeLag),
      "# HELP rfq_quote_status_update_errors_total Total quote status persistence errors by target status.",
      "# TYPE rfq_quote_status_update_errors_total counter",
      ...this.renderQuoteStatusUpdateErrors(),
      "# HELP rfq_inventory_balance Current simulated inventory balance by chain and token.",
      "# TYPE rfq_inventory_balance gauge",
      ...this.renderInventoryBalances(),
      "# HELP rfq_pnl_trades_total Total realized PnL trade records produced by the skeleton API.",
      "# TYPE rfq_pnl_trades_total counter",
      `rfq_pnl_trades_total ${this.pnlTrades}`,
      "# HELP rfq_pnl_record_errors_total Total realized PnL record errors after settlement by stable reason.",
      "# TYPE rfq_pnl_record_errors_total counter",
      ...this.renderPnlRecordErrors(),
      "# HELP rfq_realized_pnl_token_out Total realized spread PnL by chain and output token.",
      "# TYPE rfq_realized_pnl_token_out gauge",
      ...this.renderRealizedPnl(),
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

  private renderRateLimited(): string[] {
    return rateLimitedEndpoints.map((endpoint) => {
      return `rfq_rate_limited_total{endpoint="${endpoint}"} ${this.rateLimited.get(endpoint) ?? 0}`;
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
const readinessMetricStatuses: readonly ReadinessMetricStatus[] = ["ready", "degraded"];
const dependencyMetricStatuses: readonly DependencyMetricStatus[] = ["ok", "degraded"];
const readinessDependencyComponents: readonly ReadinessComponentName[] = [
  "marketData",
  "marketSnapshotStore",
  "routing",
  "pricing",
  "risk",
  "signer",
  "quoteRepository",
  "riskDecisionStore",
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
  if (!readinessMetricStatuses.includes(readiness.status)) {
    throw new Error("Metrics readiness status must be ready or degraded");
  }
  if (!isRecord(readiness.components)) {
    throw new Error("Metrics readiness components must be an object");
  }

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
  assertPositiveSafeInteger(position.chainId, "inventory chainId");
  assertAddress(position.token, "inventory token");
  assertBigInt(position.balance, "inventory balance");
}

function assertPnlTradeMetricRecord(record: PnlTradeRecord): void {
  if (!isRecord(record)) {
    throw new Error("Metrics PnL trade record must be an object");
  }

  assertNonEmptyString(record.pnlId, "PnL trade pnlId");
  assertNonEmptyString(record.quoteId, "PnL trade quoteId");
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

  assertIntString(record.grossPnlTokenOut, "PnL trade grossPnlTokenOut");
  assertSafeInteger(record.grossPnlBps, "PnL trade grossPnlBps");

  if (record.model !== "simulated_mid_price_v1") {
    throw new Error("Metrics PnL trade model must be simulated_mid_price_v1");
  }
  if (!isNonEmptyString(record.realizedAt) || Number.isNaN(Date.parse(record.realizedAt))) {
    throw new Error("Metrics PnL trade realizedAt must be a parseable timestamp");
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

function assertAddress(value: Address, field: string): void {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
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

function assertPositiveUIntString(value: string, field: string): void {
  if (!/^[0-9]+$/.test(value) || BigInt(value) <= 0n) {
    throw new Error(`Metrics ${field} must be a positive uint string`);
  }
}

function assertIntString(value: string, field: string): void {
  if (!/^-?[0-9]+$/.test(value)) {
    throw new Error(`Metrics ${field} must be an int string`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
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
