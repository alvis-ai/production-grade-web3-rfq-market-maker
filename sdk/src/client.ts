import type {
  HedgeIntentStatus,
  HealthResponse,
  PnlSummary,
  QuoteRequest,
  QuoteResponse,
  QuoteStatus,
  ReadinessResponse,
  RFQErrorResponse,
  SettlementEventStatus,
  SubmitQuoteRequest,
  SubmitQuoteResponse,
} from "./types.js";

export class RFQClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code = "RFQ_CLIENT_ERROR",
    readonly traceId?: string,
  ) {
    super(message);
    this.name = "RFQClientError";
  }
}

export class RFQClient {
  constructor(private readonly baseUrl: string) {}

  async quote(request: QuoteRequest): Promise<QuoteResponse> {
    const response = await fetch(`${this.baseUrl}/quote`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(request),
    });

    await assertOk(response, "RFQ quote failed");

    return (await response.json()) as QuoteResponse;
  }

  async submit(request: SubmitQuoteRequest): Promise<SubmitQuoteResponse> {
    const response = await fetch(`${this.baseUrl}/submit`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(request),
    });

    await assertOk(response, "RFQ submit failed");

    return (await response.json()) as SubmitQuoteResponse;
  }

  async getQuote(quoteId: string): Promise<QuoteStatus> {
    const response = await fetch(`${this.baseUrl}/quote/${encodeURIComponent(quoteId)}`);

    await assertOk(response, "RFQ quote status failed");

    return (await response.json()) as QuoteStatus;
  }

  async getHedge(hedgeOrderId: string): Promise<HedgeIntentStatus> {
    const response = await fetch(`${this.baseUrl}/hedges/${encodeURIComponent(hedgeOrderId)}`);

    await assertOk(response, "RFQ hedge status failed");

    return (await response.json()) as HedgeIntentStatus;
  }

  async getSettlement(settlementEventId: string): Promise<SettlementEventStatus> {
    const response = await fetch(`${this.baseUrl}/settlements/${encodeURIComponent(settlementEventId)}`);

    await assertOk(response, "RFQ settlement event status failed");

    return (await response.json()) as SettlementEventStatus;
  }

  async pnl(): Promise<PnlSummary> {
    const response = await fetch(`${this.baseUrl}/pnl`);

    await assertOk(response, "RFQ PnL summary failed");

    return (await response.json()) as PnlSummary;
  }

  async health(): Promise<HealthResponse> {
    const response = await fetch(`${this.baseUrl}/health`);

    await assertOk(response, "RFQ health check failed");

    return (await response.json()) as HealthResponse;
  }

  async ready(): Promise<ReadinessResponse> {
    const response = await fetch(`${this.baseUrl}/ready`);

    await assertOk(response, "RFQ readiness check failed");

    return (await response.json()) as ReadinessResponse;
  }

  async metrics(): Promise<string> {
    const response = await fetch(`${this.baseUrl}/metrics`);

    await assertOk(response, "RFQ metrics request failed");

    return response.text();
  }
}

async function assertOk(response: Response, fallbackMessage: string): Promise<void> {
  if (response.ok) return;

  let error: RFQErrorResponse | undefined;
  try {
    error = (await response.json()) as RFQErrorResponse;
  } catch {
    error = undefined;
  }

  throw new RFQClientError(
    error?.message ?? fallbackMessage,
    response.status,
    error?.code,
    error?.traceId,
  );
}
