import type { Address, PnlTradeRecord } from "../../shared/types/rfq.js";

export interface InventoryMetricPosition {
  chainId: number;
  token: Address;
  balance: bigint;
}

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
  private settlements = 0;
  private hedgeIntents = 0;
  private pnlTrades = 0;
  private readonly quoteLatency = createHistogramState();
  private readonly submitLatency = createHistogramState();
  private readonly quoteRejections = new Map<string, number>();
  private readonly inventoryBalances = new Map<string, InventoryMetricPosition>();
  private readonly realizedPnl = new Map<string, bigint>();

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

  recordSettlement(): void {
    this.settlements += 1;
  }

  recordHedgeIntent(): void {
    this.hedgeIntents += 1;
  }

  recordInventoryPosition(position: InventoryMetricPosition): void {
    this.inventoryBalances.set(this.inventoryKey(position.chainId, position.token), position);
  }

  recordPnlTrade(record: PnlTradeRecord): void {
    this.pnlTrades += 1;
    const key = this.inventoryKey(record.chainId, record.tokenOut);
    this.realizedPnl.set(key, (this.realizedPnl.get(key) ?? 0n) + BigInt(record.grossPnlTokenOut));
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
      "# HELP rfq_settlements_total Total simulated settlements applied to inventory.",
      "# TYPE rfq_settlements_total counter",
      `rfq_settlements_total ${this.settlements}`,
      "# HELP rfq_hedge_intents_total Total hedge intents queued after settlement.",
      "# TYPE rfq_hedge_intents_total counter",
      `rfq_hedge_intents_total ${this.hedgeIntents}`,
      "# HELP rfq_inventory_balance Current simulated inventory balance by chain and token.",
      "# TYPE rfq_inventory_balance gauge",
      ...this.renderInventoryBalances(),
      "# HELP rfq_pnl_trades_total Total realized PnL trade records produced by the skeleton API.",
      "# TYPE rfq_pnl_trades_total counter",
      `rfq_pnl_trades_total ${this.pnlTrades}`,
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

  private renderRealizedPnl(): string[] {
    return [...this.realizedPnl.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => {
        const [chainId, token] = key.split(":");
        return `rfq_realized_pnl_token_out{chain_id="${chainId}",token="${token}"} ${value.toString()}`;
      });
  }

  private inventoryKey(chainId: number, token: Address): string {
    return `${chainId}:${token.toLowerCase()}`;
  }
}

function createHistogramState(): HistogramState {
  return {
    sum: 0,
    count: 0,
    buckets: latencyBucketsSeconds.map(() => 0),
  };
}

function recordHistogram(state: HistogramState, value: number): void {
  const normalized = Math.max(0, value);
  state.count += 1;
  state.sum += normalized;

  for (let index = 0; index < latencyBucketsSeconds.length; index += 1) {
    if (normalized <= latencyBucketsSeconds[index]!) {
      state.buckets[index] += 1;
    }
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

function formatMetricNumber(value: number): string {
  if (Number.isInteger(value)) {
    return value.toString();
  }

  return value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

function metricLabelValue(value: string): string {
  const normalized = value.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  return normalized.length > 0 ? normalized : "UNKNOWN";
}
