import type { Address } from "../../shared/types/rfq.js";

export interface InventoryMetricPosition {
  chainId: number;
  token: Address;
  balance: bigint;
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
  private readonly inventoryBalances = new Map<string, InventoryMetricPosition>();

  recordQuoteRequest(): void {
    this.quoteRequests += 1;
  }

  recordQuoteResponse(): void {
    this.quoteResponses += 1;
  }

  recordQuoteError(): void {
    this.quoteErrors += 1;
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

  recordSettlement(): void {
    this.settlements += 1;
  }

  recordHedgeIntent(): void {
    this.hedgeIntents += 1;
  }

  recordInventoryPosition(position: InventoryMetricPosition): void {
    this.inventoryBalances.set(this.inventoryKey(position.chainId, position.token), position);
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
      "# HELP rfq_submit_requests_total Total submit requests accepted by the skeleton API.",
      "# TYPE rfq_submit_requests_total counter",
      `rfq_submit_requests_total ${this.submitRequests}`,
      "# HELP rfq_submit_accepted_total Total submit requests accepted for execution.",
      "# TYPE rfq_submit_accepted_total counter",
      `rfq_submit_accepted_total ${this.submitAccepted}`,
      "# HELP rfq_submit_errors_total Total submit errors returned by the skeleton API.",
      "# TYPE rfq_submit_errors_total counter",
      `rfq_submit_errors_total ${this.submitErrors}`,
      "# HELP rfq_settlements_total Total simulated settlements applied to inventory.",
      "# TYPE rfq_settlements_total counter",
      `rfq_settlements_total ${this.settlements}`,
      "# HELP rfq_hedge_intents_total Total hedge intents queued after settlement.",
      "# TYPE rfq_hedge_intents_total counter",
      `rfq_hedge_intents_total ${this.hedgeIntents}`,
      "# HELP rfq_inventory_balance Current simulated inventory balance by chain and token.",
      "# TYPE rfq_inventory_balance gauge",
      ...this.renderInventoryBalances(),
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

  private inventoryKey(chainId: number, token: Address): string {
    return `${chainId}:${token.toLowerCase()}`;
  }
}
