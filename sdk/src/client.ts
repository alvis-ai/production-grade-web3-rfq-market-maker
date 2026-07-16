import { assertPnlSummary } from "./client-accounting-responses.js";
import { RFQClientError } from "./client-error.js";
import { RFQClientTransport } from "./client-transport.js";
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
  readTextResponse,
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
  private readonly transport: RFQClientTransport;
  private readonly traceIdProvider?: RFQClientTraceIdProvider;
  private readonly apiKeyProvider?: RFQClientApiKeyProvider;

  constructor(baseUrl: string, options: RFQClientOptions = {}) {
    const config: NormalizedRFQClientConfig = normalizeClientConfig(baseUrl, options);
    this.baseUrl = config.baseUrl;
    this.transport = new RFQClientTransport(
      config.fetchImpl,
      config.requestTimeoutMs,
      config.maxResponseBytes,
    );
    this.traceIdProvider = config.traceIdProvider;
    this.apiKeyProvider = config.apiKeyProvider;
  }

  async quote(request: QuoteRequest, options?: QuoteRequestOptions): Promise<QuoteResponse> {
    assertQuoteRequest(request);
    const quoteOptions = assertQuoteRequestOptions(options);
    return this.transport.request(`${this.baseUrl}/quote`, {
      method: "POST",
      headers: this.requestHeaders({
        "content-type": "application/json",
        ...(quoteOptions ? { "Idempotency-Key": quoteOptions.idempotencyKey } : {}),
      }),
      body: JSON.stringify(request),
    }, "RFQ quote request", async (boundedResponse) => {
      await assertOk(boundedResponse, "RFQ quote failed");
      const payload = await readJsonResponse(boundedResponse, "RFQ quote response");
      return assertResponsePayload(payload, boundedResponse.response, assertQuoteResponse);
    });
  }

  async submit(request: SubmitQuoteRequest): Promise<SubmitQuoteResponse> {
    assertSubmitQuoteRequest(request);
    return this.transport.request(`${this.baseUrl}/submit`, {
      method: "POST",
      headers: this.requestHeaders({ "content-type": "application/json" }),
      body: JSON.stringify(request),
    }, "RFQ submit request", async (boundedResponse) => {
      await assertOk(boundedResponse, "RFQ submit failed");
      const payload = await readJsonResponse(boundedResponse, "RFQ submit response");
      return assertResponsePayload(payload, boundedResponse.response, assertSubmitQuoteResponse);
    });
  }

  async getQuote(quoteId: string): Promise<QuoteStatus> {
    const safeQuoteId = assertNonEmptyIdentifier(quoteId, "quoteId");
    return this.transport.request(
      `${this.baseUrl}/quote/${encodeURIComponent(safeQuoteId)}`,
      this.requestInit(),
      "RFQ quote status request",
      async (boundedResponse) => {
        await assertOk(boundedResponse, "RFQ quote status failed");
        const payload = await readJsonResponse(boundedResponse, "RFQ quote status response");
        return assertResponsePayload(payload, boundedResponse.response, assertQuoteStatus);
      },
    );
  }

  async getHedge(hedgeOrderId: string): Promise<HedgeIntentStatus> {
    const safeHedgeOrderId = assertNonEmptyIdentifier(hedgeOrderId, "hedgeOrderId");
    return this.transport.request(
      `${this.baseUrl}/hedges/${encodeURIComponent(safeHedgeOrderId)}`,
      this.requestInit(),
      "RFQ hedge status request",
      async (boundedResponse) => {
        await assertOk(boundedResponse, "RFQ hedge status failed");
        const payload = await readJsonResponse(boundedResponse, "RFQ hedge status response");
        return assertResponsePayload(payload, boundedResponse.response, assertHedgeIntentStatus);
      },
    );
  }

  async getSettlement(settlementEventId: string): Promise<SettlementEventStatus> {
    const safeSettlementEventId = assertNonEmptyIdentifier(settlementEventId, "settlementEventId");
    return this.transport.request(
      `${this.baseUrl}/settlements/${encodeURIComponent(safeSettlementEventId)}`,
      this.requestInit(),
      "RFQ settlement status request",
      async (boundedResponse) => {
        await assertOk(boundedResponse, "RFQ settlement event status failed");
        const payload = await readJsonResponse(boundedResponse, "RFQ settlement event status response");
        return assertResponsePayload(payload, boundedResponse.response, assertSettlementEventStatus);
      },
    );
  }

  async pnl(): Promise<PnlSummary> {
    return this.transport.request(`${this.baseUrl}/pnl`, this.requestInit(), "RFQ PnL request", async (boundedResponse) => {
      await assertOk(boundedResponse, "RFQ PnL summary failed");
      const payload = await readJsonResponse(boundedResponse, "RFQ PnL summary response");
      return assertResponsePayload(payload, boundedResponse.response, assertPnlSummary);
    });
  }

  async health(): Promise<HealthResponse> {
    return this.transport.request(`${this.baseUrl}/health`, this.requestInit({}, false), "RFQ health request", async (boundedResponse) => {
      const { response } = boundedResponse;
      await assertOk(boundedResponse, "RFQ health check failed");
      const payload = await readJsonResponse(boundedResponse, "RFQ health response");
      if (!isHealthResponse(payload)) {
        throw new RFQClientError(
          "RFQ health response returned malformed status",
          response.status,
          "RFQ_CLIENT_ERROR",
          traceIdFromResponse(response),
        );
      }
      return payload;
    });
  }

  async ready(): Promise<ReadinessResponse> {
    return this.transport.request(`${this.baseUrl}/ready`, this.requestInit({}, false), "RFQ readiness request", async (boundedResponse) => {
      const { response } = boundedResponse;
      if (!response.ok) {
        let payload: unknown;
        try {
          payload = await readJsonResponse(boundedResponse, "RFQ readiness response");
        } catch (error) {
          if (error instanceof RFQClientError && error.status === 0) throw error;
          payload = undefined;
        }
        if (isReadinessResponse(payload)) return payload;
        throw clientErrorFromResponse(response, payload, "RFQ readiness check failed");
      }

      const payload = await readJsonResponse(boundedResponse, "RFQ readiness response");
      if (!isReadinessResponse(payload)) {
        throw new RFQClientError(
          "RFQ readiness response returned malformed status",
          response.status,
          "RFQ_CLIENT_ERROR",
          traceIdFromResponse(response),
        );
      }
      return payload;
    });
  }

  async metrics(): Promise<string> {
    return this.transport.request(`${this.baseUrl}/metrics`, this.requestInit({}, false), "RFQ metrics request", async (boundedResponse) => {
      await assertOk(boundedResponse, "RFQ metrics request failed");
      return readTextResponse(boundedResponse, "RFQ metrics response");
    });
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
