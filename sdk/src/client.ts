import { assertPnlSummary } from "./client-accounting-responses.js";
import { RFQClientError } from "./client-error.js";
import {
  assertQuoteRequest,
  assertQuoteRequestOptions,
  assertSubmitQuoteRequest,
  assertNonEmptyIdentifier,
  normalizeClientConfig,
} from "./client-request.js";
import {
  assertOk,
  assertResponsePayload,
  clientErrorFromResponse,
  isHealthResponse,
  isReadinessResponse,
  readJsonResponse,
  traceIdFromResponse,
} from "./client-response-validation.js";
import {
  assertHedgeIntentStatus,
  assertQuoteResponse,
  assertQuoteStatus,
  assertSettlementEventStatus,
  assertSubmitQuoteResponse,
} from "./client-trading-responses.js";
import type {
  NormalizedRFQClientConfig,
  QuoteRequestOptions,
  RFQClientApiKeyProvider,
  RFQClientFetch,
  RFQClientOptions,
  RFQClientTraceIdProvider,
} from "./client-request.js";
import type {
  HedgeIntentStatus,
  HealthResponse,
  PnlSummary,
  QuoteRequest,
  QuoteResponse,
  QuoteStatus,
  ReadinessResponse,
  SettlementEventStatus,
  SubmitQuoteRequest,
  SubmitQuoteResponse,
} from "./types.js";

export { RFQClientError } from "./client-error.js";
export type { RFQClientErrorCode } from "./client-error.js";
export type {
  QuoteRequestOptions,
  RFQClientApiKeyProvider,
  RFQClientFetch,
  RFQClientOptions,
  RFQClientTraceIdProvider,
} from "./client-request.js";

export class RFQClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: RFQClientFetch;
  private readonly traceIdProvider?: RFQClientTraceIdProvider;
  private readonly apiKeyProvider?: RFQClientApiKeyProvider;

  constructor(baseUrl: string, options: RFQClientOptions = {}) {
    const config: NormalizedRFQClientConfig = normalizeClientConfig(baseUrl, options);
    this.baseUrl = config.baseUrl;
    this.fetchImpl = config.fetchImpl;
    this.traceIdProvider = config.traceIdProvider;
    this.apiKeyProvider = config.apiKeyProvider;
  }

  async quote(request: QuoteRequest, options?: QuoteRequestOptions): Promise<QuoteResponse> {
    assertQuoteRequest(request);
    const quoteOptions = assertQuoteRequestOptions(options);
    const response = await this.fetchImpl(`${this.baseUrl}/quote`, {
      method: "POST",
      headers: this.requestHeaders({
        "content-type": "application/json",
        ...(quoteOptions ? { "Idempotency-Key": quoteOptions.idempotencyKey } : {}),
      }),
      body: JSON.stringify(request),
    });
    await assertOk(response, "RFQ quote failed");
    const payload = await readJsonResponse(response, "RFQ quote response");
    return assertResponsePayload(payload, response, assertQuoteResponse);
  }

  async submit(request: SubmitQuoteRequest): Promise<SubmitQuoteResponse> {
    assertSubmitQuoteRequest(request);
    const response = await this.fetchImpl(`${this.baseUrl}/submit`, {
      method: "POST",
      headers: this.requestHeaders({ "content-type": "application/json" }),
      body: JSON.stringify(request),
    });
    await assertOk(response, "RFQ submit failed");
    const payload = await readJsonResponse(response, "RFQ submit response");
    return assertResponsePayload(payload, response, assertSubmitQuoteResponse);
  }

  async getQuote(quoteId: string): Promise<QuoteStatus> {
    const safeQuoteId = assertNonEmptyIdentifier(quoteId, "quoteId");
    const response = await this.fetchImpl(
      `${this.baseUrl}/quote/${encodeURIComponent(safeQuoteId)}`,
      this.requestInit(),
    );
    await assertOk(response, "RFQ quote status failed");
    const payload = await readJsonResponse(response, "RFQ quote status response");
    return assertResponsePayload(payload, response, assertQuoteStatus);
  }

  async getHedge(hedgeOrderId: string): Promise<HedgeIntentStatus> {
    const safeHedgeOrderId = assertNonEmptyIdentifier(hedgeOrderId, "hedgeOrderId");
    const response = await this.fetchImpl(
      `${this.baseUrl}/hedges/${encodeURIComponent(safeHedgeOrderId)}`,
      this.requestInit(),
    );
    await assertOk(response, "RFQ hedge status failed");
    const payload = await readJsonResponse(response, "RFQ hedge status response");
    return assertResponsePayload(payload, response, assertHedgeIntentStatus);
  }

  async getSettlement(settlementEventId: string): Promise<SettlementEventStatus> {
    const safeSettlementEventId = assertNonEmptyIdentifier(settlementEventId, "settlementEventId");
    const response = await this.fetchImpl(
      `${this.baseUrl}/settlements/${encodeURIComponent(safeSettlementEventId)}`,
      this.requestInit(),
    );
    await assertOk(response, "RFQ settlement event status failed");
    const payload = await readJsonResponse(response, "RFQ settlement event status response");
    return assertResponsePayload(payload, response, assertSettlementEventStatus);
  }

  async pnl(): Promise<PnlSummary> {
    const response = await this.fetchImpl(`${this.baseUrl}/pnl`, this.requestInit());
    await assertOk(response, "RFQ PnL summary failed");
    const payload = await readJsonResponse(response, "RFQ PnL summary response");
    return assertResponsePayload(payload, response, assertPnlSummary);
  }

  async health(): Promise<HealthResponse> {
    const response = await this.fetchImpl(`${this.baseUrl}/health`, this.requestInit({}, false));
    await assertOk(response, "RFQ health check failed");
    const payload = await readJsonResponse(response, "RFQ health response");
    if (!isHealthResponse(payload)) {
      throw new RFQClientError(
        "RFQ health response returned malformed status",
        response.status,
        "RFQ_CLIENT_ERROR",
        traceIdFromResponse(response),
      );
    }
    return payload;
  }

  async ready(): Promise<ReadinessResponse> {
    const response = await this.fetchImpl(`${this.baseUrl}/ready`, this.requestInit({}, false));
    if (!response.ok) {
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        payload = undefined;
      }
      if (isReadinessResponse(payload)) return payload;
      throw clientErrorFromResponse(response, payload, "RFQ readiness check failed");
    }

    const payload = await readJsonResponse(response, "RFQ readiness response");
    if (!isReadinessResponse(payload)) {
      throw new RFQClientError(
        "RFQ readiness response returned malformed status",
        response.status,
        "RFQ_CLIENT_ERROR",
        traceIdFromResponse(response),
      );
    }
    return payload;
  }

  async metrics(): Promise<string> {
    const response = await this.fetchImpl(`${this.baseUrl}/metrics`, this.requestInit({}, false));
    await assertOk(response, "RFQ metrics request failed");
    return response.text();
  }

  private requestInit(headers: Record<string, string> = {}, authenticated = true): RequestInit | undefined {
    const requestHeaders = this.requestHeaders(headers, authenticated);
    return Object.keys(requestHeaders).length > 0 ? { headers: requestHeaders } : undefined;
  }

  private requestHeaders(headers: Record<string, string>, authenticated = true): Record<string, string> {
    const traceId = this.traceIdProvider?.();
    const apiKey = authenticated ? this.apiKeyProvider?.() : undefined;
    return {
      ...headers,
      ...(apiKey ? { "x-api-key": apiKey } : {}),
      ...(traceId ? { "x-trace-id": traceId } : {}),
    };
  }
}
