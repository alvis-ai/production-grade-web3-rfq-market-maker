import { rfqErrorCodes } from "./types.js";
import { buildSubmitQuoteArgs } from "./settlement.js";
import type {
  HedgeIntentStatus,
  HealthResponse,
  PnlSummary,
  PnlTokenTotal,
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
export type RFQClientFetch = (input: string, init?: RequestInit) => Promise<Response>;
export type RFQClientTraceIdProvider = () => string | undefined;
export type RFQClientApiKeyProvider = () => string | undefined;

export interface RFQClientOptions {
  readonly fetch?: RFQClientFetch;
  readonly traceId?: string | RFQClientTraceIdProvider;
  readonly apiKey?: string | RFQClientApiKeyProvider;
}

const SECP256K1N_HALF = BigInt("0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0");
const maxTraceIdLength = 128;
const traceIdPattern = /^tr_[A-Za-z0-9._:-]+$/;
const maxStatusIdentifierLength = 128;
const statusIdentifierPattern = /^[A-Za-z0-9_:-]+$/;
const retryAfterSecondsPattern = /^[1-9][0-9]*$/;
const isoUtcTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const apiKeyPattern = /^[A-Za-z0-9_-]{3,64}\.[A-Za-z0-9_-]{32,128}$/;
const clientOptionFields = ["fetch", "traceId", "apiKey"] as const;
const quoteRequestFields = ["chainId", "user", "tokenIn", "tokenOut", "amountIn", "slippageBps"] as const;
const submitRequestFields = ["quote", "signature"] as const;
const submitRequestOptionalFields = ["txHash"] as const;
const quoteResponseFields = ["quoteId", "snapshotId", "amountOut", "minAmountOut", "deadline", "nonce", "signature"] as const;
const errorResponseFields = ["code", "message", "traceId"] as const;
const healthResponseFields = ["status"] as const;
const readinessResponseFields = ["status", "components"] as const;
const submitResponseRequiredFields = ["status"] as const;
const submitResponseOptionalFields = ["txHash", "settlementEventId", "hedgeOrderId", "pnlId"] as const;
const quoteStatusRequiredFields = ["quoteId", "status"] as const;
const quoteStatusOptionalFields = [
  "snapshotId",
  "deadline",
  "txHash",
  "settlementEventId",
  "hedgeOrderId",
  "pnlId",
  "errorCode",
] as const;
const hedgeStatusRequiredFields = [
  "hedgeOrderId",
  "status",
  "settlementEventId",
  "quoteId",
  "chainId",
  "token",
  "side",
  "amount",
  "reason",
  "createdAt",
] as const;
const hedgeStatusOptionalFields = [
  "externalOrderId",
  "filledAmount",
  "venue",
  "venueSymbol",
  "venueOrderId",
  "executionEvidenceVersion",
  "executedQuoteQuantity",
  "feeReconciliationStatus",
  "feeLastErrorCode",
  "feeReconciledAt",
  "commissionTotals",
  "failureCode",
  "updatedAt",
] as const;
const settlementEventStatusFields = [
  "settlementEventId",
  "status",
  "quoteId",
  "chainId",
  "txHash",
  "quoteHash",
  "blockNumber",
  "logIndex",
  "user",
  "tokenIn",
  "tokenOut",
  "amountIn",
  "amountOut",
  "nonce",
  "observedAt",
] as const;
const pnlSummaryFields = ["status", "totalTrades", "totals", "trades"] as const;
const pnlTokenTotalFields = ["chainId", "tokenOut", "totalTrades", "grossPnlTokenOut"] as const;
const pnlTradeRecordFields = [
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
const rfqErrorCodeSet: ReadonlySet<string> = new Set(rfqErrorCodes);
const readinessDependencyComponents = [
  "marketData",
  "marketSnapshotStore",
  "routing",
  "pricing",
  "risk",
  "signer",
  "quoteRepository",
  "riskDecisionStore",
  "rateLimitStore",
  "inventory",
  "execution",
  "settlementEventStore",
  "pnl",
  "metrics",
] as const;

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
  private readonly fetchImpl: RFQClientFetch;
  private readonly traceIdProvider?: RFQClientTraceIdProvider;
  private readonly apiKeyProvider?: RFQClientApiKeyProvider;

  constructor(baseUrl: string, options: RFQClientOptions = {}) {
    const clientOptions = assertClientOptions(options);

    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.fetchImpl = resolveFetch(clientOptions);
    this.traceIdProvider = resolveTraceIdProvider(clientOptions);
    this.apiKeyProvider = resolveApiKeyProvider(clientOptions);
  }

  async quote(request: QuoteRequest): Promise<QuoteResponse> {
    assertQuoteRequest(request);
    const response = await this.fetchImpl(`${this.baseUrl}/quote`, {
      method: "POST",
      headers: this.requestHeaders({
        "content-type": "application/json",
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
      headers: this.requestHeaders({
        "content-type": "application/json",
      }),
      body: JSON.stringify(request),
    });

    await assertOk(response, "RFQ submit failed");

    const payload = await readJsonResponse(response, "RFQ submit response");
    return assertResponsePayload(payload, response, assertSubmitQuoteResponse);
  }

  async getQuote(quoteId: string): Promise<QuoteStatus> {
    const safeQuoteId = assertNonEmptyIdentifier(quoteId, "quoteId");
    const response = await this.fetchImpl(`${this.baseUrl}/quote/${encodeURIComponent(safeQuoteId)}`, this.requestInit());

    await assertOk(response, "RFQ quote status failed");

    const payload = await readJsonResponse(response, "RFQ quote status response");
    return assertResponsePayload(payload, response, assertQuoteStatus);
  }

  async getHedge(hedgeOrderId: string): Promise<HedgeIntentStatus> {
    const safeHedgeOrderId = assertNonEmptyIdentifier(hedgeOrderId, "hedgeOrderId");
    const response = await this.fetchImpl(`${this.baseUrl}/hedges/${encodeURIComponent(safeHedgeOrderId)}`, this.requestInit());

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

      if (isReadinessResponse(payload)) {
        return payload;
      }

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

function assertClientOptions(options: unknown): RFQClientOptions {
  if (!isRecord(options)) {
    throw new RFQClientError("RFQClient options must be an object", 0);
  }

  const allowed = new Set<string>(clientOptionFields);
  for (const key of Object.keys(options)) {
    if (!allowed.has(key)) {
      throw new RFQClientError(`RFQClient options must not include unknown field ${key}`, 0);
    }
  }

  for (const field of clientOptionFields) {
    if (field in options && !Object.prototype.hasOwnProperty.call(options, field)) {
      throw new RFQClientError(`RFQClient options.${field} must be an own field when provided`, 0);
    }
  }

  return options as RFQClientOptions;
}

function resolveFetch(options: RFQClientOptions): RFQClientFetch {
  if (options.fetch !== undefined) {
    if (typeof options.fetch !== "function") {
      throw new RFQClientError("RFQClient fetch option must be a function", 0);
    }

    return options.fetch as RFQClientFetch;
  }

  if (typeof globalThis.fetch !== "function") {
    throw new RFQClientError("RFQClient fetch implementation must be available or provided", 0);
  }

  return globalThis.fetch.bind(globalThis);
}

function resolveTraceIdProvider(options: RFQClientOptions): RFQClientTraceIdProvider | undefined {
  const traceId = options.traceId;
  if (traceId === undefined) {
    return undefined;
  }

  if (typeof traceId === "string") {
    const normalized = assertClientTraceId(traceId, "RFQClient traceId");
    return () => normalized;
  }

  if (typeof traceId === "function") {
    return () => {
      const nextTraceId = traceId();
      if (nextTraceId === undefined) {
        return undefined;
      }

      return assertClientTraceId(nextTraceId, "RFQClient traceId provider result");
    };
  }

  throw new RFQClientError("RFQClient traceId option must be a primitive string or function", 0);
}

function resolveApiKeyProvider(options: RFQClientOptions): RFQClientApiKeyProvider | undefined {
  const apiKey = options.apiKey;
  if (apiKey === undefined) return undefined;
  if (typeof apiKey === "string") {
    const normalized = assertClientApiKey(apiKey, "RFQClient apiKey");
    return () => normalized;
  }
  if (typeof apiKey === "function") {
    return () => {
      const nextApiKey = apiKey();
      if (nextApiKey === undefined) return undefined;
      return assertClientApiKey(nextApiKey, "RFQClient apiKey provider result");
    };
  }
  throw new RFQClientError("RFQClient apiKey option must be a primitive string or function", 0);
}

function assertClientApiKey(value: unknown, label: string): string {
  if (typeof value !== "string") throw new RFQClientError(`${label} must be a primitive string`, 0);
  if (!apiKeyPattern.test(value)) {
    throw new RFQClientError(`${label} must use keyId.secret format with a 32-128 character secret`, 0);
  }
  return value;
}

function assertClientTraceId(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new RFQClientError(`${label} must be a primitive string`, 0);
  }

  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maxTraceIdLength || !traceIdPattern.test(normalized)) {
    throw new RFQClientError(`${label} must match tr_[A-Za-z0-9._:-]+ and be 128 characters or fewer`, 0);
  }

  return normalized;
}

async function readJsonResponse(response: Response, label: string): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new RFQClientError(
      `${label} returned malformed JSON`,
      response.status,
      "RFQ_CLIENT_ERROR",
      traceIdFromResponse(response),
    );
  }
}

function assertResponsePayload<T>(
  payload: unknown,
  response: Response,
  assertion: (payload: unknown, status: number) => asserts payload is T,
): T {
  try {
    assertion(payload, response.status);
    return payload;
  } catch (error) {
    throw withResponseTrace(error, response);
  }
}

function withResponseTrace(error: unknown, response: Response): unknown {
  if (error instanceof RFQClientError && !error.traceId) {
    return new RFQClientError(
      error.message,
      error.status,
      error.code,
      traceIdFromResponse(response),
      error.retryAfterSeconds,
    );
  }

  return error;
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
    normalizeTraceId(error?.traceId) ?? traceIdFromResponse(response),
    retryAfterSeconds(response),
  );
}

function assertQuoteRequest(request: QuoteRequest): void {
  if (!isRecord(request)) {
    throw new RFQClientError("RFQ quote request must be an object", 0);
  }
  assertExactFields(request, quoteRequestFields, "RFQ quote request");

  if (!Number.isSafeInteger(request.chainId) || request.chainId <= 0) {
    throw new RFQClientError("RFQ quote request chainId must be a positive safe integer", 0);
  }
  if (!isAddressHex(request.user)) {
    throw new RFQClientError("RFQ quote request user must be a 20-byte hex address", 0);
  }
  if (!isAddressHex(request.tokenIn)) {
    throw new RFQClientError("RFQ quote request tokenIn must be a 20-byte hex address", 0);
  }
  if (!isAddressHex(request.tokenOut)) {
    throw new RFQClientError("RFQ quote request tokenOut must be a 20-byte hex address", 0);
  }
  if (request.tokenIn.toLowerCase() === request.tokenOut.toLowerCase()) {
    throw new RFQClientError("RFQ quote request tokenIn and tokenOut must be different", 0);
  }
  if (!isPositiveUIntString(request.amountIn)) {
    throw new RFQClientError("RFQ quote request amountIn must be a positive uint string", 0);
  }
  if (!Number.isInteger(request.slippageBps) || request.slippageBps < 0 || request.slippageBps > 10_000) {
    throw new RFQClientError("RFQ quote request slippageBps must be an integer from 0 to 10000", 0);
  }
}

function assertSubmitQuoteRequest(request: SubmitQuoteRequest): void {
  if (!isRecord(request)) {
    throw new RFQClientError("RFQ submit request must be an object", 0);
  }
  assertExactFields(request, submitRequestFields, "RFQ submit request", submitRequestOptionalFields);
  assertOptionalOwnResponseField(request, "txHash", 0, "RFQ submit request");
  if (request.txHash !== undefined && !isBytes32Hex(request.txHash)) {
    throw new RFQClientError("RFQ submit request txHash must be a 32-byte hex string", 0);
  }

  try {
    buildSubmitQuoteArgs(request.quote, request.signature);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "is invalid";
    throw new RFQClientError(`RFQ submit request ${detail}`, 0);
  }
}

function assertExactFields(
  payload: Record<string, unknown>,
  expectedFields: readonly string[],
  label: string,
  optionalFields: readonly string[] = [],
): void {
  const expected = new Set([...expectedFields, ...optionalFields]);
  for (const key of Object.keys(payload)) {
    if (!expected.has(key)) {
      throw new RFQClientError(`${label} must not include unknown field ${key}`, 0);
    }
  }

  for (const field of expectedFields) {
    if (!Object.prototype.hasOwnProperty.call(payload, field)) {
      throw new RFQClientError(`${label} missing required field ${field}`, 0);
    }
  }
}

function assertOptionalBytes32Field(payload: unknown, field: string, status: number, label: string): void {
  if (!isRecord(payload)) {
    throw malformedFieldError(status, label, field);
  }

  assertOptionalOwnResponseField(payload, field, status, label);
  const value = payload[field];
  if (value === undefined) return;

  if (!isBytes32Hex(value)) {
    throw malformedFieldError(status, label, field);
  }
}

function assertRequiredBytes32Field(payload: unknown, field: string, status: number, label: string): void {
  if (!isRecord(payload) || !hasOwnField(payload, field) || !isBytes32Hex(payload[field])) {
    throw malformedFieldError(status, label, field);
  }
}

function assertRequiredSignatureField(payload: unknown, field: string, status: number, label: string): void {
  if (!isRecord(payload) || !hasOwnField(payload, field) || !isSignatureHex(payload[field])) {
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
  if (
    !isRecord(payload) ||
    !hasOwnField(payload, field) ||
    typeof payload[field] !== "string" ||
    !allowedValues.includes(payload[field])
  ) {
    throw malformedFieldError(status, label, field);
  }
}

function assertRequiredNonNegativeIntegerField(payload: unknown, field: string, status: number, label: string): void {
  if (!isRecord(payload) || !hasOwnField(payload, field) || !isNonNegativeSafeInteger(payload[field])) {
    throw malformedFieldError(status, label, field);
  }
}

function assertQuoteResponse(payload: unknown, status: number): asserts payload is QuoteResponse {
  const label = "RFQ quote response";
  if (!isRecord(payload)) {
    throw malformedFieldError(status, label, "quoteId");
  }
  assertOwnResponseFields(payload, quoteResponseFields, [], status, label);

  for (const field of ["quoteId", "snapshotId"] as const) {
    if (!isSafeIdentifier(payload[field])) {
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
  if (!isPositiveSafeInteger(payload.deadline)) {
    throw malformedFieldError(status, label, "deadline");
  }
  assertRequiredSignatureField(payload, "signature", status, label);
}

function assertSubmitQuoteResponse(payload: unknown, status: number): asserts payload is SubmitQuoteResponse {
  const label = "RFQ submit response";
  if (!isRecord(payload)) {
    throw malformedFieldError(status, label, "status");
  }
  assertOwnResponseFields(payload, submitResponseRequiredFields, submitResponseOptionalFields, status, label);

  assertRequiredEnumField(payload, "status", ["accepted"], status, label);
  assertOptionalBytes32Field(payload, "txHash", status, label);
  for (const field of ["settlementEventId", "hedgeOrderId", "pnlId"] as const) {
    if (payload[field] !== undefined && !isSafeIdentifier(payload[field])) {
      throw malformedFieldError(status, label, field);
    }
  }
}

function assertQuoteStatus(payload: unknown, status: number): asserts payload is QuoteStatus {
  const label = "RFQ quote status response";
  if (!isRecord(payload)) {
    throw malformedFieldError(status, label, "status");
  }
  assertOwnResponseFields(payload, quoteStatusRequiredFields, quoteStatusOptionalFields, status, label);

  if (!isSafeIdentifier(payload.quoteId)) {
    throw malformedFieldError(status, label, "quoteId");
  }
  assertRequiredEnumField(
    payload,
    "status",
    ["requested", "rejected", "signed", "expired", "submitted", "settled", "failed"],
    status,
    label,
  );
  for (const field of ["snapshotId", "settlementEventId", "hedgeOrderId", "pnlId"] as const) {
    if (payload[field] !== undefined && !isSafeIdentifier(payload[field])) {
      throw malformedFieldError(status, label, field);
    }
  }
  if (payload.errorCode !== undefined && !isNonEmptyString(payload.errorCode)) {
    throw malformedFieldError(status, label, "errorCode");
  }
  if (payload.deadline !== undefined && !isPositiveSafeInteger(payload.deadline)) {
    throw malformedFieldError(status, label, "deadline");
  }
  assertOptionalBytes32Field(payload, "txHash", status, label);
  assertQuoteStatusPayloadConsistency(payload, status, label);
}

function assertQuoteStatusPayloadConsistency(
  payload: Record<string, unknown>,
  status: number,
  label: string,
): void {
  const quoteStatus = payload.status;
  const isSettlementStatus = quoteStatus === "submitted" || quoteStatus === "settled";
  if (isSettlementStatus) {
    if (!isBytes32Hex(payload.txHash)) {
      throw malformedFieldError(status, label, "txHash");
    }
    if (!isSafeIdentifier(payload.settlementEventId)) {
      throw malformedFieldError(status, label, "settlementEventId");
    }
    return;
  }

  if (
    payload.txHash !== undefined ||
    payload.settlementEventId !== undefined ||
    payload.hedgeOrderId !== undefined ||
    payload.pnlId !== undefined
  ) {
    throw malformedFieldError(status, label, "status");
  }

  if ((quoteStatus === "rejected" || quoteStatus === "failed") && !isNonEmptyString(payload.errorCode)) {
    throw malformedFieldError(status, label, "errorCode");
  }
}

function assertHedgeIntentStatus(payload: unknown, status: number): asserts payload is HedgeIntentStatus {
  const label = "RFQ hedge status response";
  if (!isRecord(payload)) {
    throw malformedFieldError(status, label, "status");
  }
  assertOwnResponseFields(payload, hedgeStatusRequiredFields, hedgeStatusOptionalFields, status, label);

  for (const field of ["hedgeOrderId", "settlementEventId", "quoteId"] as const) {
    if (!isSafeIdentifier(payload[field])) {
      throw malformedFieldError(status, label, field);
    }
  }
  const createdAt = payload.createdAt;
  if (!isIsoUtcTimestampString(createdAt)) {
    throw malformedFieldError(status, label, "createdAt");
  }
  if (payload.status !== "queued" && payload.status !== "filled" && payload.status !== "failed") {
    throw malformedFieldError(status, label, "status");
  }
  if (!isPositiveSafeInteger(payload.chainId)) {
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
  if (payload.externalOrderId !== undefined && !isNonEmptyString(payload.externalOrderId)) {
    throw malformedFieldError(status, label, "externalOrderId");
  }
  if (payload.filledAmount !== undefined && !isPositiveUIntString(payload.filledAmount)) {
    throw malformedFieldError(status, label, "filledAmount");
  }
  if (payload.venue !== undefined && (!isNonEmptyString(payload.venue) || payload.venue.length > 128)) {
    throw malformedFieldError(status, label, "venue");
  }
  if (payload.venueSymbol !== undefined &&
      (typeof payload.venueSymbol !== "string" || !/^[A-Z0-9._-]{3,32}$/.test(payload.venueSymbol))) {
    throw malformedFieldError(status, label, "venueSymbol");
  }
  if (payload.venueOrderId !== undefined &&
      (typeof payload.venueOrderId !== "string" || !/^[1-9][0-9]{0,15}$/.test(payload.venueOrderId) ||
        !Number.isSafeInteger(Number(payload.venueOrderId)))) {
    throw malformedFieldError(status, label, "venueOrderId");
  }
  if (payload.executionEvidenceVersion !== undefined &&
      payload.executionEvidenceVersion !== "base-only-v1" &&
      payload.executionEvidenceVersion !== "base-and-quote-v2") {
    throw malformedFieldError(status, label, "executionEvidenceVersion");
  }
  if (payload.executedQuoteQuantity !== undefined && !isPositiveDecimalString(payload.executedQuoteQuantity)) {
    throw malformedFieldError(status, label, "executedQuoteQuantity");
  }
  if ((payload.executionEvidenceVersion === "base-and-quote-v2") !==
      (payload.executedQuoteQuantity !== undefined)) {
    throw malformedFieldError(status, label, "executionEvidenceVersion");
  }
  if (payload.executionEvidenceVersion !== undefined && payload.filledAmount === undefined) {
    throw malformedFieldError(status, label, "executionEvidenceVersion");
  }
  if (payload.feeReconciliationStatus !== undefined &&
      payload.feeReconciliationStatus !== "pending" && payload.feeReconciliationStatus !== "complete") {
    throw malformedFieldError(status, label, "feeReconciliationStatus");
  }
  if (payload.feeLastErrorCode !== undefined &&
      (typeof payload.feeLastErrorCode !== "string" || !/^[A-Z0-9_:-]{1,128}$/.test(payload.feeLastErrorCode))) {
    throw malformedFieldError(status, label, "feeLastErrorCode");
  }
  if (payload.feeReconciledAt !== undefined && !isIsoUtcTimestampString(payload.feeReconciledAt)) {
    throw malformedFieldError(status, label, "feeReconciledAt");
  }
  if (payload.commissionTotals !== undefined && !isCommissionTotals(payload.commissionTotals)) {
    throw malformedFieldError(status, label, "commissionTotals");
  }
  if (payload.feeReconciliationStatus === "complete" &&
      (payload.venueOrderId === undefined || payload.executionEvidenceVersion !== "base-and-quote-v2" ||
        payload.feeReconciledAt === undefined || payload.commissionTotals === undefined)) {
    throw malformedFieldError(status, label, "feeReconciliationStatus");
  }
  if (payload.feeReconciliationStatus === "pending" && payload.feeReconciledAt !== undefined) {
    throw malformedFieldError(status, label, "feeReconciliationStatus");
  }
  if (payload.feeLastErrorCode !== undefined && payload.feeReconciliationStatus !== "pending") {
    throw malformedFieldError(status, label, "feeLastErrorCode");
  }
  if (payload.commissionTotals !== undefined && payload.feeReconciliationStatus === undefined) {
    throw malformedFieldError(status, label, "commissionTotals");
  }
  if (payload.failureCode !== undefined &&
      (typeof payload.failureCode !== "string" || !/^[A-Z0-9_:-]{1,128}$/.test(payload.failureCode))) {
    throw malformedFieldError(status, label, "failureCode");
  }
  if (payload.updatedAt !== undefined && !isIsoUtcTimestampString(payload.updatedAt)) {
    throw malformedFieldError(status, label, "updatedAt");
  }
}

function assertSettlementEventStatus(payload: unknown, status: number): asserts payload is SettlementEventStatus {
  const label = "RFQ settlement event status response";
  if (!isRecord(payload)) {
    throw malformedFieldError(status, label, "status");
  }
  assertOwnResponseFields(payload, settlementEventStatusFields, [], status, label);

  for (const field of ["settlementEventId", "quoteId"] as const) {
    if (!isSafeIdentifier(payload[field])) {
      throw malformedFieldError(status, label, field);
    }
  }
  const observedAt = payload.observedAt;
  if (!isIsoUtcTimestampString(observedAt)) {
    throw malformedFieldError(status, label, "observedAt");
  }
  assertRequiredEnumField(payload, "status", ["applied"], status, label);
  if (!isPositiveSafeInteger(payload.chainId)) {
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
  for (const field of ["amountIn", "amountOut", "nonce"] as const) {
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
  assertOwnResponseFields(payload, pnlSummaryFields, [], status, label);

  if (payload.status !== "ok") {
    throw malformedFieldError(status, label, "status");
  }
  if (!isNonNegativeSafeInteger(payload.totalTrades)) {
    throw malformedFieldError(status, label, "totalTrades");
  }
  if (!Array.isArray(payload.totals)) {
    throw malformedFieldError(status, label, "totals");
  }
  if (!Array.isArray(payload.trades)) {
    throw malformedFieldError(status, label, "trades");
  }
  if (payload.totalTrades !== payload.trades.length) {
    throw malformedFieldError(status, label, "totalTrades");
  }

  const expectedTotals = new Map<string, { totalTrades: number; grossPnl: bigint }>();
  for (const trade of payload.trades) {
    assertPnlTradeRecord(trade, status);
    const key = pnlTokenKey(trade.chainId, trade.tokenOut);
    const current = expectedTotals.get(key) ?? { totalTrades: 0, grossPnl: 0n };
    current.totalTrades += 1;
    current.grossPnl += BigInt(trade.grossPnlTokenOut);
    expectedTotals.set(key, current);
  }

  if (payload.totals.length !== expectedTotals.size) {
    throw malformedFieldError(status, label, "totals");
  }
  const seenTotals = new Set<string>();
  for (const total of payload.totals) {
    assertPnlTokenTotal(total, status);
    const key = pnlTokenKey(total.chainId, total.tokenOut);
    if (seenTotals.has(key)) throw malformedFieldError(status, label, "totals");
    seenTotals.add(key);
    const expected = expectedTotals.get(key);
    if (
      !expected ||
      total.totalTrades !== expected.totalTrades ||
      BigInt(total.grossPnlTokenOut) !== expected.grossPnl
    ) {
      throw malformedFieldError(status, label, "totals");
    }
  }
}

function assertPnlTokenTotal(payload: unknown, status: number): asserts payload is PnlTokenTotal {
  const label = "RFQ PnL summary response total";
  if (!isRecord(payload)) throw malformedFieldError(status, label, "chainId");
  assertOwnResponseFields(payload, pnlTokenTotalFields, [], status, label);
  if (!isPositiveSafeInteger(payload.chainId)) throw malformedFieldError(status, label, "chainId");
  if (!isAddressHex(payload.tokenOut)) throw malformedFieldError(status, label, "tokenOut");
  if (!isPositiveSafeInteger(payload.totalTrades)) throw malformedFieldError(status, label, "totalTrades");
  if (!isIntString(payload.grossPnlTokenOut)) throw malformedFieldError(status, label, "grossPnlTokenOut");
}

function assertPnlTradeRecord(payload: unknown, status: number): asserts payload is PnlTradeRecord {
  const label = "RFQ PnL summary response trade";
  if (!isRecord(payload)) {
    throw malformedFieldError(status, label, "pnlId");
  }
  assertOwnResponseFields(payload, pnlTradeRecordFields, [], status, label);

  for (const field of ["pnlId", "quoteId", "settlementEventId", "snapshotId"] as const) {
    if (!isSafeIdentifier(payload[field])) {
      throw malformedFieldError(status, label, field);
    }
  }
  const realizedAt = payload.realizedAt;
  if (!isIsoUtcTimestampString(realizedAt)) {
    throw malformedFieldError(status, label, "realizedAt");
  }
  if (!isPositiveSafeInteger(payload.chainId)) {
    throw malformedFieldError(status, label, "chainId");
  }
  if (!isAddressHex(payload.user)) {
    throw malformedFieldError(status, label, "user");
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
  for (const field of ["amountIn", "amountOut", "minAmountOut", "nonce"] as const) {
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
    throw malformedFieldError(status, label, "amountOut");
  }
  if (!isPositiveSafeInteger(payload.deadline)) {
    throw malformedFieldError(status, label, "deadline");
  }
  if (!isPositiveDecimalString(payload.midPrice)) {
    throw malformedFieldError(status, label, "midPrice");
  }
  if (!isTokenDecimals(payload.tokenInDecimals)) {
    throw malformedFieldError(status, label, "tokenInDecimals");
  }
  if (!isTokenDecimals(payload.tokenOutDecimals)) {
    throw malformedFieldError(status, label, "tokenOutDecimals");
  }
  if (!isPositiveUIntString(payload.fairAmountOut)) {
    throw malformedFieldError(status, label, "fairAmountOut");
  }
  if (!isIsoUtcTimestampString(payload.valuationObservedAt)) {
    throw malformedFieldError(status, label, "valuationObservedAt");
  }
  if (!isIntString(payload.grossPnlTokenOut)) {
    throw malformedFieldError(status, label, "grossPnlTokenOut");
  }
  if (!isSafeInteger(payload.grossPnlBps)) {
    throw malformedFieldError(status, label, "grossPnlBps");
  }
  const amountIn = payload.amountIn;
  const fairAmountOut = payload.fairAmountOut;
  const grossPnlTokenOut = payload.grossPnlTokenOut;
  if (
    !isPositiveUIntString(amountIn) ||
    !isPositiveUIntString(fairAmountOut) ||
    !isIntString(grossPnlTokenOut) ||
    !isPositiveDecimalString(payload.midPrice) ||
    !isTokenDecimals(payload.tokenInDecimals) ||
    !isTokenDecimals(payload.tokenOutDecimals)
  ) {
    throw malformedFieldError(status, label, "fairAmountOut");
  }
  const expectedFairAmountOut = calculateFairAmountOut(
    BigInt(amountIn),
    payload.midPrice,
    payload.tokenInDecimals,
    payload.tokenOutDecimals,
  );
  if (BigInt(fairAmountOut) !== expectedFairAmountOut) {
    throw malformedFieldError(status, label, "fairAmountOut");
  }
  const expectedGrossPnl = expectedFairAmountOut - BigInt(amountOut);
  if (BigInt(grossPnlTokenOut) !== expectedGrossPnl) {
    throw malformedFieldError(status, label, "grossPnlTokenOut");
  }
  const expectedGrossPnlBps = (expectedGrossPnl * 10_000n) / expectedFairAmountOut;
  if (
    expectedGrossPnlBps < BigInt(Number.MIN_SAFE_INTEGER) ||
    expectedGrossPnlBps > BigInt(Number.MAX_SAFE_INTEGER) ||
    payload.grossPnlBps !== Number(expectedGrossPnlBps)
  ) {
    throw malformedFieldError(status, label, "grossPnlBps");
  }
  if (payload.model !== "quote_snapshot_edge_v1") {
    throw malformedFieldError(status, label, "model");
  }
  if (
    payload.modelDescription !==
      "Gross settlement PnL in tokenOut base units versus the persisted quote-time mid price, excluding fees, gas, and hedge execution"
  ) {
    throw malformedFieldError(status, label, "modelDescription");
  }
}

function pnlTokenKey(chainId: number, tokenOut: string): string {
  return `${chainId}:${tokenOut.toLowerCase()}`;
}

function calculateFairAmountOut(
  amountIn: bigint,
  midPrice: string,
  tokenInDecimals: number,
  tokenOutDecimals: number,
): bigint {
  const [whole, fraction = ""] = midPrice.split(".");
  const denominator = 10n ** BigInt(fraction.length);
  const numerator = BigInt(whole) * denominator + BigInt(fraction || "0");
  return (amountIn * numerator * 10n ** BigInt(tokenOutDecimals)) /
    (denominator * 10n ** BigInt(tokenInDecimals));
}

function malformedFieldError(status: number, label: string, field: string): RFQClientError {
  return new RFQClientError(`${label} returned malformed ${field}`, status);
}

function assertOwnResponseFields(
  payload: Record<string, unknown>,
  requiredFields: readonly string[],
  optionalFields: readonly string[],
  status: number,
  label: string,
): void {
  assertNoUnknownResponseFields(payload, requiredFields, optionalFields, status, label);

  for (const field of requiredFields) {
    if (!hasOwnField(payload, field)) {
      throw malformedFieldError(status, label, field);
    }
  }

  for (const field of optionalFields) {
    assertOptionalOwnResponseField(payload, field, status, label);
  }
}

function assertNoUnknownResponseFields(
  payload: Record<string, unknown>,
  requiredFields: readonly string[],
  optionalFields: readonly string[],
  status: number,
  label: string,
): void {
  const allowed = new Set<string>([...requiredFields, ...optionalFields]);
  for (const key of Object.keys(payload)) {
    if (!allowed.has(key)) {
      throw malformedFieldError(status, label, key);
    }
  }
}

function assertOptionalOwnResponseField(
  payload: Record<string, unknown>,
  field: string,
  status: number,
  label: string,
): void {
  if (field in payload && !hasOwnField(payload, field)) {
    throw malformedFieldError(status, label, field);
  }
}

function hasOwnField(payload: object, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(payload, field);
}

function isBytes32Hex(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

function isAddressHex(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
}

function isSignatureHex(value: unknown): value is `0x${string}` {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(value)) {
    return false;
  }

  const s = BigInt(`0x${value.slice(66, 130)}`);
  if (s > SECP256K1N_HALF) {
    return false;
  }

  const v = Number.parseInt(value.slice(130, 132), 16);
  const normalizedV = v < 27 ? v + 27 : v;
  return normalizedV === 27 || normalizedV === 28;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isSafeIdentifier(value: unknown): value is string {
  return isNonEmptyString(value) && value.length <= maxStatusIdentifierLength && statusIdentifierPattern.test(value);
}

function isIsoUtcTimestampString(value: unknown): value is string {
  if (typeof value !== "string" || !isoUtcTimestampPattern.test(value)) {
    return false;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function isPositiveUIntString(value: unknown): value is string {
  return typeof value === "string" && /^[1-9][0-9]*$/.test(value);
}

function isPositiveDecimalString(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 96 || !/^(0|[1-9][0-9]*)(\.[0-9]{1,18})?$/.test(value)) {
    return false;
  }
  const digits = value.replace(".", "");
  return BigInt(digits) > 0n;
}

function isCommissionTotals(value: unknown): value is Array<{ asset: string; quantity: string }> {
  if (!Array.isArray(value)) return false;
  let previousAsset = "";
  for (const entry of value) {
    if (!isRecord(entry) || Object.keys(entry).length !== 2 ||
        typeof entry.asset !== "string" || entry.asset.length < 1 || entry.asset.length > 64 ||
        /[\s\p{Cc}]/u.test(entry.asset) || entry.asset <= previousAsset ||
        typeof entry.quantity !== "string" || entry.quantity.length > 96 ||
        !/^(0|[1-9][0-9]*)(?:\.[0-9]{1,36})?$/.test(entry.quantity)) {
      return false;
    }
    previousAsset = entry.asset;
  }
  return true;
}

function isIntString(value: unknown): value is string {
  return typeof value === "string" && /^(0|-?[1-9][0-9]*)$/.test(value);
}

function isSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return isSafeInteger(value) && value > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return isSafeInteger(value) && value >= 0;
}

function isTokenDecimals(value: unknown): value is number {
  return isSafeInteger(value) && value >= 0 && value <= 36;
}

function retryAfterSeconds(response: Response): number | undefined {
  const value = response.headers.get("retry-after");
  if (!value || !retryAfterSecondsPattern.test(value)) return undefined;

  const seconds = Number(value);
  return Number.isSafeInteger(seconds) ? seconds : undefined;
}

function traceIdFromResponse(response: Response): string | undefined {
  const value = response.headers.get("x-trace-id");
  return normalizeTraceId(value);
}

function normalizeTraceId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;

  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maxTraceIdLength || !traceIdPattern.test(normalized)) {
    return undefined;
  }

  return normalized;
}

function normalizeBaseUrl(baseUrl: string): string {
  if (typeof baseUrl !== "string") {
    throw new RFQClientError("RFQClient baseUrl must be a string", 0);
  }

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

  if (parsed.username || parsed.password) {
    throw new RFQClientError("RFQClient baseUrl must not include credentials", 0);
  }
  if (parsed.hostname.includes("*")) {
    throw new RFQClientError("RFQClient baseUrl host must not contain wildcards", 0);
  }
  if (parsed.search || parsed.hash || normalized.includes("?") || normalized.includes("#")) {
    throw new RFQClientError("RFQClient baseUrl must not include query strings or fragments", 0);
  }

  const pathname = parsed.pathname.replace(/\/+$/, "");
  return `${parsed.origin}${pathname}`;
}

function assertNonEmptyIdentifier(value: unknown, field: "quoteId" | "hedgeOrderId" | "settlementEventId"): string {
  if (typeof value !== "string") {
    throw new RFQClientError(`${field} must be a primitive string`, 0);
  }
  if (value.trim().length === 0) {
    throw new RFQClientError(`${field} must be a non-empty string`, 0);
  }
  if (value.length > maxStatusIdentifierLength) {
    throw new RFQClientError(`${field} must be 128 characters or fewer`, 0);
  }
  if (!statusIdentifierPattern.test(value)) {
    throw new RFQClientError(`${field} must contain only letters, numbers, underscore, colon, or hyphen`, 0);
  }

  return value;
}

function isRFQErrorResponse(value: unknown): value is RFQErrorResponse {
  if (!isRecord(value)) return false;
  if (!hasExactOwnFields(value, errorResponseFields)) return false;

  return (
    typeof value.code === "string" &&
    rfqErrorCodeSet.has(value.code) &&
    typeof value.message === "string" &&
    typeof value.traceId === "string"
  );
}

function isHealthResponse(value: unknown): value is HealthResponse {
  return isRecord(value) && hasExactOwnFields(value, healthResponseFields) && value.status === "ok";
}

function isReadinessResponse(value: unknown): value is ReadinessResponse {
  if (!isRecord(value)) return false;
  if (!hasExactOwnFields(value, readinessResponseFields)) return false;

  return (
    (value.status === "ready" || value.status === "degraded") &&
    isReadinessComponents(value.components)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasExactOwnFields(value: Record<string, unknown>, expectedFields: readonly string[]): boolean {
  const keys = Object.keys(value);
  if (keys.length !== expectedFields.length) return false;

  const expected = new Set<string>(expectedFields);
  for (const key of keys) {
    if (!expected.has(key)) return false;
  }

  return expectedFields.every((field) => hasOwnField(value, field));
}

function isReadinessComponents(value: unknown): value is ReadinessResponse["components"] {
  if (!isRecord(value)) return false;

  const keys = Object.keys(value);
  if (keys.length !== readinessDependencyComponents.length) {
    return false;
  }

  const expectedComponents = new Set<string>(readinessDependencyComponents);
  for (const key of keys) {
    if (!expectedComponents.has(key)) {
      return false;
    }
  }

  return readinessDependencyComponents.every((component) => {
    const status = value[component];
    return status === "ok" || status === "degraded";
  });
}
