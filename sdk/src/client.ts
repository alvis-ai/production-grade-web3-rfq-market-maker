import { rfqErrorCodes } from "./types.js";
import type {
  HedgeIntentStatus,
  HealthResponse,
  PnlSummary,
  PnlTradeRecord,
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
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
  }

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
    assertQuoteResponse(payload, response.status);
    return payload;
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
    assertSubmitQuoteResponse(payload, response.status);
    return payload;
  }

  async getQuote(quoteId: string): Promise<QuoteStatus> {
    const safeQuoteId = assertNonEmptyIdentifier(quoteId, "quoteId");
    const response = await fetch(`${this.baseUrl}/quote/${encodeURIComponent(safeQuoteId)}`);

    await assertOk(response, "RFQ quote status failed");

    const payload = await readJsonResponse(response, "RFQ quote status response");
    assertQuoteStatus(payload, response.status);
    return payload;
  }

  async getHedge(hedgeOrderId: string): Promise<HedgeIntentStatus> {
    const safeHedgeOrderId = assertNonEmptyIdentifier(hedgeOrderId, "hedgeOrderId");
    const response = await fetch(`${this.baseUrl}/hedges/${encodeURIComponent(safeHedgeOrderId)}`);

    await assertOk(response, "RFQ hedge status failed");

    const payload = await readJsonResponse(response, "RFQ hedge status response");
    assertHedgeIntentStatus(payload, response.status);

    return payload;
  }

  async getSettlement(settlementEventId: string): Promise<SettlementEventStatus> {
    const safeSettlementEventId = assertNonEmptyIdentifier(settlementEventId, "settlementEventId");
    const response = await fetch(`${this.baseUrl}/settlements/${encodeURIComponent(safeSettlementEventId)}`);

    await assertOk(response, "RFQ settlement event status failed");

    const payload = await readJsonResponse(response, "RFQ settlement event status response");
    assertSettlementEventStatus(payload, response.status);
    return payload;
  }

  async pnl(): Promise<PnlSummary> {
    const response = await fetch(`${this.baseUrl}/pnl`);

    await assertOk(response, "RFQ PnL summary failed");

    const payload = await readJsonResponse(response, "RFQ PnL summary response");
    assertPnlSummary(payload, response.status);

    return payload;
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

function assertQuoteResponse(payload: unknown, status: number): asserts payload is QuoteResponse {
  const label = "RFQ quote response";
  if (!isRecord(payload)) {
    throw malformedFieldError(status, label, "quoteId");
  }

  for (const field of ["quoteId", "snapshotId"] as const) {
    if (!isNonEmptyString(payload[field])) {
      throw malformedFieldError(status, label, field);
    }
  }
  for (const field of ["amountOut", "minAmountOut", "nonce"] as const) {
    if (!isPositiveUIntString(payload[field])) {
      throw malformedFieldError(status, label, field);
    }
  }
  const amountOut = payload.amountOut;
  const minAmountOut = payload.minAmountOut;
  if (!isPositiveUIntString(amountOut) || !isPositiveUIntString(minAmountOut)) {
    throw malformedFieldError(status, label, "amountOut");
  }
  if (BigInt(amountOut) < BigInt(minAmountOut)) {
    throw malformedFieldError(status, label, "minAmountOut");
  }
  if (!Number.isSafeInteger(payload.deadline) || Number(payload.deadline) <= 0) {
    throw malformedFieldError(status, label, "deadline");
  }
  assertRequiredSignatureField(payload, "signature", status, label);
}

function assertSubmitQuoteResponse(payload: unknown, status: number): asserts payload is SubmitQuoteResponse {
  const label = "RFQ submit response";
  if (!isRecord(payload)) {
    throw malformedFieldError(status, label, "status");
  }

  assertRequiredEnumField(payload, "status", ["accepted"], status, label);
  assertOptionalBytes32Field(payload, "txHash", status, label);
  for (const field of ["settlementEventId", "hedgeOrderId", "pnlId"] as const) {
    if (payload[field] !== undefined && !isNonEmptyString(payload[field])) {
      throw malformedFieldError(status, label, field);
    }
  }
}

function assertQuoteStatus(payload: unknown, status: number): asserts payload is QuoteStatus {
  const label = "RFQ quote status response";
  if (!isRecord(payload)) {
    throw malformedFieldError(status, label, "status");
  }

  if (!isNonEmptyString(payload.quoteId)) {
    throw malformedFieldError(status, label, "quoteId");
  }
  assertRequiredEnumField(
    payload,
    "status",
    ["requested", "rejected", "signed", "expired", "submitted", "settled", "failed"],
    status,
    label,
  );
  for (const field of ["snapshotId", "settlementEventId", "hedgeOrderId", "pnlId", "errorCode"] as const) {
    if (payload[field] !== undefined && !isNonEmptyString(payload[field])) {
      throw malformedFieldError(status, label, field);
    }
  }
  if (payload.deadline !== undefined && (!Number.isSafeInteger(payload.deadline) || Number(payload.deadline) <= 0)) {
    throw malformedFieldError(status, label, "deadline");
  }
  assertOptionalBytes32Field(payload, "txHash", status, label);
}

function assertHedgeIntentStatus(payload: unknown, status: number): asserts payload is HedgeIntentStatus {
  const label = "RFQ hedge status response";
  if (!isRecord(payload)) {
    throw malformedFieldError(status, label, "status");
  }

  for (const field of ["hedgeOrderId", "settlementEventId", "quoteId", "createdAt"] as const) {
    if (!isNonEmptyString(payload[field])) {
      throw malformedFieldError(status, label, field);
    }
  }
  const createdAt = payload.createdAt;
  if (!isNonEmptyString(createdAt) || Number.isNaN(Date.parse(createdAt))) {
    throw malformedFieldError(status, label, "createdAt");
  }
  if (payload.status !== "queued") {
    throw malformedFieldError(status, label, "status");
  }
  if (!Number.isSafeInteger(payload.chainId) || Number(payload.chainId) <= 0) {
    throw malformedFieldError(status, label, "chainId");
  }
  if (!isAddressHex(payload.token)) {
    throw malformedFieldError(status, label, "token");
  }
  if (payload.side !== "buy" && payload.side !== "sell") {
    throw malformedFieldError(status, label, "side");
  }
  if (!isPositiveUIntString(payload.amount)) {
    throw malformedFieldError(status, label, "amount");
  }
  if (payload.reason !== "inventory_rebalance" && payload.reason !== "risk_reduction") {
    throw malformedFieldError(status, label, "reason");
  }
}

function assertSettlementEventStatus(payload: unknown, status: number): asserts payload is SettlementEventStatus {
  const label = "RFQ settlement event status response";
  if (!isRecord(payload)) {
    throw malformedFieldError(status, label, "status");
  }

  for (const field of ["settlementEventId", "quoteId", "observedAt"] as const) {
    if (!isNonEmptyString(payload[field])) {
      throw malformedFieldError(status, label, field);
    }
  }
  const observedAt = payload.observedAt;
  if (!isNonEmptyString(observedAt) || Number.isNaN(Date.parse(observedAt))) {
    throw malformedFieldError(status, label, "observedAt");
  }
  assertRequiredEnumField(payload, "status", ["applied"], status, label);
  if (!Number.isSafeInteger(payload.chainId) || Number(payload.chainId) <= 0) {
    throw malformedFieldError(status, label, "chainId");
  }
  assertRequiredBytes32Field(payload, "txHash", status, label);
  assertRequiredBytes32Field(payload, "quoteHash", status, label);
  assertRequiredNonNegativeIntegerField(payload, "blockNumber", status, label);
  assertRequiredNonNegativeIntegerField(payload, "logIndex", status, label);
  for (const field of ["user", "tokenIn", "tokenOut"] as const) {
    if (!isAddressHex(payload[field])) {
      throw malformedFieldError(status, label, field);
    }
  }
  const tokenIn = payload.tokenIn;
  const tokenOut = payload.tokenOut;
  if (!isAddressHex(tokenIn) || !isAddressHex(tokenOut)) {
    throw malformedFieldError(status, label, "tokenOut");
  }
  if (tokenIn.toLowerCase() === tokenOut.toLowerCase()) {
    throw malformedFieldError(status, label, "tokenOut");
  }
  for (const field of ["amountIn", "amountOut"] as const) {
    if (!isPositiveUIntString(payload[field])) {
      throw malformedFieldError(status, label, field);
    }
  }
}

function assertPnlSummary(payload: unknown, status: number): asserts payload is PnlSummary {
  const label = "RFQ PnL summary response";
  if (!isRecord(payload)) {
    throw malformedFieldError(status, label, "status");
  }

  if (payload.status !== "ok") {
    throw malformedFieldError(status, label, "status");
  }
  if (!Number.isSafeInteger(payload.totalTrades) || Number(payload.totalTrades) < 0) {
    throw malformedFieldError(status, label, "totalTrades");
  }
  if (!isIntString(payload.grossPnlTokenOut)) {
    throw malformedFieldError(status, label, "grossPnlTokenOut");
  }
  if (!Array.isArray(payload.trades)) {
    throw malformedFieldError(status, label, "trades");
  }
  if (payload.totalTrades !== payload.trades.length) {
    throw malformedFieldError(status, label, "totalTrades");
  }

  let grossPnl = 0n;
  for (const trade of payload.trades) {
    assertPnlTradeRecord(trade, status);
    grossPnl += BigInt(trade.grossPnlTokenOut);
  }

  if (BigInt(payload.grossPnlTokenOut) !== grossPnl) {
    throw malformedFieldError(status, label, "grossPnlTokenOut");
  }
}

function assertPnlTradeRecord(payload: unknown, status: number): asserts payload is PnlTradeRecord {
  const label = "RFQ PnL summary response trade";
  if (!isRecord(payload)) {
    throw malformedFieldError(status, label, "pnlId");
  }

  for (const field of ["pnlId", "quoteId", "realizedAt"] as const) {
    if (!isNonEmptyString(payload[field])) {
      throw malformedFieldError(status, label, field);
    }
  }
  const realizedAt = payload.realizedAt;
  if (!isNonEmptyString(realizedAt) || Number.isNaN(Date.parse(realizedAt))) {
    throw malformedFieldError(status, label, "realizedAt");
  }
  if (!Number.isSafeInteger(payload.chainId) || Number(payload.chainId) <= 0) {
    throw malformedFieldError(status, label, "chainId");
  }
  for (const field of ["tokenIn", "tokenOut"] as const) {
    if (!isAddressHex(payload[field])) {
      throw malformedFieldError(status, label, field);
    }
  }
  const tokenIn = payload.tokenIn;
  const tokenOut = payload.tokenOut;
  if (!isAddressHex(tokenIn) || !isAddressHex(tokenOut)) {
    throw malformedFieldError(status, label, "tokenOut");
  }
  if (tokenIn.toLowerCase() === tokenOut.toLowerCase()) {
    throw malformedFieldError(status, label, "tokenOut");
  }
  for (const field of ["amountIn", "amountOut"] as const) {
    if (!isPositiveUIntString(payload[field])) {
      throw malformedFieldError(status, label, field);
    }
  }
  if (!isIntString(payload.grossPnlTokenOut)) {
    throw malformedFieldError(status, label, "grossPnlTokenOut");
  }
  if (!Number.isSafeInteger(payload.grossPnlBps)) {
    throw malformedFieldError(status, label, "grossPnlBps");
  }
  if (payload.model !== "simulated_mid_price_v1") {
    throw malformedFieldError(status, label, "model");
  }
}

function malformedFieldError(status: number, label: string, field: string): RFQClientError {
  return new RFQClientError(`${label} returned malformed ${field}`, status);
}

function isBytes32Hex(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

function isAddressHex(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
}

function isSignatureHex(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-fA-F]{130}$/.test(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveUIntString(value: unknown): value is string {
  return typeof value === "string" && /^[0-9]+$/.test(value) && BigInt(value) > 0n;
}

function isIntString(value: unknown): value is string {
  return typeof value === "string" && /^-?[0-9]+$/.test(value);
}

function retryAfterSeconds(response: Response): number | undefined {
  const value = response.headers.get("retry-after");
  if (!value) return undefined;

  const seconds = Number(value);
  return Number.isInteger(seconds) && seconds > 0 ? seconds : undefined;
}

function normalizeBaseUrl(baseUrl: string): string {
  const normalized = baseUrl.trim();
  if (normalized.length === 0) {
    throw new RFQClientError("RFQClient baseUrl must be a non-empty absolute http(s) URL", 0);
  }

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new RFQClientError("RFQClient baseUrl must be an absolute http(s) URL", 0);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new RFQClientError("RFQClient baseUrl must use http or https", 0);
  }

  return parsed.toString().replace(/\/+$/, "");
}

function assertNonEmptyIdentifier(value: string, field: "quoteId" | "hedgeOrderId" | "settlementEventId"): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new RFQClientError(`${field} must be a non-empty string`, 0);
  }

  return value;
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
