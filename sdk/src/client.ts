import { rfqErrorCodes } from "./types.js";
import type {
  HedgeIntentStatus,
  HealthResponse,
  PnlSummary,
  QuoteRequest,
  QuoteResponse,
  QuoteStatus,
  ReadinessResponse,
  RFQErrorCode,
  RFQErrorResponse,
  SettlementEventStatus,
  SubmitQuoteRequest,
  SubmitQuoteResponse,
} from "./types.js";

export type RFQClientErrorCode = RFQErrorCode | "RFQ_CLIENT_ERROR";

const rfqErrorCodeSet: ReadonlySet<string> = new Set(rfqErrorCodes);

export class RFQClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: RFQClientErrorCode = "RFQ_CLIENT_ERROR",
    readonly traceId?: string,
    readonly retryAfterSeconds?: number,
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

    const payload = await readJsonResponse(response, "RFQ quote response");
    assertRequiredSignatureField(payload, "signature", response.status, "RFQ quote response");
    return payload as QuoteResponse;
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

    const payload = await readJsonResponse(response, "RFQ submit response");
    assertRequiredEnumField(payload, "status", ["accepted"], response.status, "RFQ submit response");
    assertOptionalBytes32Field(payload, "txHash", response.status, "RFQ submit response");
    return payload as SubmitQuoteResponse;
  }

  async getQuote(quoteId: string): Promise<QuoteStatus> {
    const response = await fetch(`${this.baseUrl}/quote/${encodeURIComponent(quoteId)}`);

    await assertOk(response, "RFQ quote status failed");

    const payload = await readJsonResponse(response, "RFQ quote status response");
    assertRequiredEnumField(
      payload,
      "status",
      ["requested", "rejected", "signed", "expired", "submitted", "settled", "failed"],
      response.status,
      "RFQ quote status response",
    );
    assertOptionalBytes32Field(payload, "txHash", response.status, "RFQ quote status response");
    return payload as QuoteStatus;
  }

  async getHedge(hedgeOrderId: string): Promise<HedgeIntentStatus> {
    const response = await fetch(`${this.baseUrl}/hedges/${encodeURIComponent(hedgeOrderId)}`);

    await assertOk(response, "RFQ hedge status failed");

    const payload = await readJsonResponse(response, "RFQ hedge status response");
    if (!isHedgeIntentStatus(payload)) {
      throw new RFQClientError("RFQ hedge status response returned malformed status", response.status);
    }

    return payload;
  }

  async getSettlement(settlementEventId: string): Promise<SettlementEventStatus> {
    const response = await fetch(`${this.baseUrl}/settlements/${encodeURIComponent(settlementEventId)}`);

    await assertOk(response, "RFQ settlement event status failed");

    const payload = await readJsonResponse(response, "RFQ settlement event status response");
    assertRequiredEnumField(payload, "status", ["applied"], response.status, "RFQ settlement event status response");
    assertRequiredBytes32Field(payload, "txHash", response.status, "RFQ settlement event status response");
    assertRequiredBytes32Field(payload, "quoteHash", response.status, "RFQ settlement event status response");
    assertRequiredNonNegativeIntegerField(payload, "blockNumber", response.status, "RFQ settlement event status response");
    assertRequiredNonNegativeIntegerField(payload, "logIndex", response.status, "RFQ settlement event status response");
    return payload as SettlementEventStatus;
  }

  async pnl(): Promise<PnlSummary> {
    const response = await fetch(`${this.baseUrl}/pnl`);

    await assertOk(response, "RFQ PnL summary failed");

    return (await readJsonResponse(response, "RFQ PnL summary response")) as PnlSummary;
  }

  async health(): Promise<HealthResponse> {
    const response = await fetch(`${this.baseUrl}/health`);

    await assertOk(response, "RFQ health check failed");

    const payload = await readJsonResponse(response, "RFQ health response");
    if (!isHealthResponse(payload)) {
      throw new RFQClientError("RFQ health response returned malformed status", response.status);
    }

    return payload;
  }

  async ready(): Promise<ReadinessResponse> {
    const response = await fetch(`${this.baseUrl}/ready`);

    if (!response.ok) {
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        payload = undefined;
      }

      if (isReadinessResponse(payload)) {
        return payload;
      }

      throw clientErrorFromResponse(response, payload, "RFQ readiness check failed");
    }

    const payload = await readJsonResponse(response, "RFQ readiness response");
    if (!isReadinessResponse(payload)) {
      throw new RFQClientError("RFQ readiness response returned malformed status", response.status);
    }

    return payload;
  }

  async metrics(): Promise<string> {
    const response = await fetch(`${this.baseUrl}/metrics`);

    await assertOk(response, "RFQ metrics request failed");

    return response.text();
  }
}

async function readJsonResponse(response: Response, label: string): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new RFQClientError(`${label} returned malformed JSON`, response.status);
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

  throw clientErrorFromResponse(response, error, fallbackMessage);
}

function clientErrorFromResponse(response: Response, payload: unknown, fallbackMessage: string): RFQClientError {
  const error = isRFQErrorResponse(payload) ? payload : undefined;
  return new RFQClientError(
    error?.message ?? fallbackMessage,
    response.status,
    error?.code,
    error?.traceId,
    retryAfterSeconds(response),
  );
}

function assertOptionalBytes32Field(payload: unknown, field: string, status: number, label: string): void {
  if (!isRecord(payload)) {
    throw malformedFieldError(status, label, field);
  }

  const value = payload[field];
  if (value === undefined) return;

  if (!isBytes32Hex(value)) {
    throw malformedFieldError(status, label, field);
  }
}

function assertRequiredBytes32Field(payload: unknown, field: string, status: number, label: string): void {
  if (!isRecord(payload) || !isBytes32Hex(payload[field])) {
    throw malformedFieldError(status, label, field);
  }
}

function assertRequiredSignatureField(payload: unknown, field: string, status: number, label: string): void {
  if (!isRecord(payload) || !isSignatureHex(payload[field])) {
    throw malformedFieldError(status, label, field);
  }
}

function assertRequiredEnumField(
  payload: unknown,
  field: string,
  allowedValues: readonly string[],
  status: number,
  label: string,
): void {
  if (!isRecord(payload) || typeof payload[field] !== "string" || !allowedValues.includes(payload[field])) {
    throw malformedFieldError(status, label, field);
  }
}

function assertRequiredNonNegativeIntegerField(payload: unknown, field: string, status: number, label: string): void {
  if (!isRecord(payload) || !Number.isSafeInteger(payload[field]) || Number(payload[field]) < 0) {
    throw malformedFieldError(status, label, field);
  }
}

function malformedFieldError(status: number, label: string, field: string): RFQClientError {
  return new RFQClientError(`${label} returned malformed ${field}`, status);
}

function isBytes32Hex(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

function isSignatureHex(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-fA-F]{130}$/.test(value);
}

function retryAfterSeconds(response: Response): number | undefined {
  const value = response.headers.get("retry-after");
  if (!value) return undefined;

  const seconds = Number(value);
  return Number.isInteger(seconds) && seconds > 0 ? seconds : undefined;
}

function isRFQErrorResponse(value: unknown): value is RFQErrorResponse {
  if (!isRecord(value)) return false;

  return (
    typeof value.code === "string" &&
    rfqErrorCodeSet.has(value.code) &&
    typeof value.message === "string" &&
    typeof value.traceId === "string"
  );
}

function isHealthResponse(value: unknown): value is HealthResponse {
  return isRecord(value) && value.status === "ok";
}

function isHedgeIntentStatus(value: unknown): value is HedgeIntentStatus {
  return (
    isRecord(value) &&
    value.status === "queued" &&
    (value.side === "buy" || value.side === "sell") &&
    (value.reason === "inventory_rebalance" || value.reason === "risk_reduction")
  );
}

function isReadinessResponse(value: unknown): value is ReadinessResponse {
  if (!isRecord(value)) return false;

  return (
    (value.status === "ready" || value.status === "degraded") &&
    isReadinessComponents(value.components)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isReadinessComponents(value: unknown): value is ReadinessResponse["components"] {
  return isRecord(value) && Object.values(value).every((status) => status === "ok" || status === "degraded");
}
