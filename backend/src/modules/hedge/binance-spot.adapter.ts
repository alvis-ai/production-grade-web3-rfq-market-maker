import { createHmac } from "node:crypto";

export interface SubmitMarketOrderInput {
  symbol: string;
  side: "buy" | "sell";
  quantity: string;
  clientOrderId: string;
}

export interface QueryOrderInput {
  symbol: string;
  clientOrderId: string;
}

export interface CexOrderResult {
  state: "pending" | "filled" | "failed";
  externalOrderId: string;
  executedQuantity: string;
  failureCode?: string;
}

export interface CexExecutionAdapter {
  queryOrder(input: QueryOrderInput): Promise<CexOrderResult | undefined>;
  submitMarketOrder(input: SubmitMarketOrderInput): Promise<CexOrderResult>;
}

export interface BinanceSpotAdapterConfig {
  apiKey: string;
  apiSecret: string;
  baseUrl?: string;
  recvWindowMs?: number;
  requestTimeoutMs?: number;
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class CexVenueError extends Error {
  constructor(
    readonly errorCode: string,
    readonly retryable: boolean,
    message = errorCode,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "CexVenueError";
  }
}

const defaultBaseUrl = "https://api.binance.com";
const defaultRecvWindowMs = 5_000;
const defaultRequestTimeoutMs = 10_000;
const terminalFailedStatuses = new Set(["CANCELED", "EXPIRED", "EXPIRED_IN_MATCH", "REJECTED"]);
const pendingStatuses = new Set(["NEW", "PENDING_NEW", "PARTIALLY_FILLED"]);
const retryableVenueCodes = new Set([-1000, -1001, -1003, -1006, -1007, -1008, -1015, -1016, -1021, -1034]);

export class BinanceSpotAdapter implements CexExecutionAdapter {
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly baseUrl: string;
  private readonly recvWindowMs: number;
  private readonly requestTimeoutMs: number;

  constructor(
    config: BinanceSpotAdapterConfig,
    private readonly fetchFn: FetchLike = fetch,
    private readonly now: () => number = Date.now,
  ) {
    assertConfig(config);
    if (typeof fetchFn !== "function") throw new Error("Binance fetch dependency must be a function");
    if (typeof now !== "function") throw new Error("Binance clock dependency must be a function");
    this.apiKey = config.apiKey;
    this.apiSecret = config.apiSecret;
    this.baseUrl = normalizeBaseUrl(config.baseUrl ?? defaultBaseUrl);
    this.recvWindowMs = config.recvWindowMs ?? defaultRecvWindowMs;
    this.requestTimeoutMs = config.requestTimeoutMs ?? defaultRequestTimeoutMs;
  }

  async queryOrder(input: QueryOrderInput): Promise<CexOrderResult | undefined> {
    assertQueryInput(input);
    const response = await this.signedRequest("GET", "/api/v3/order", {
      symbol: input.symbol,
      origClientOrderId: input.clientOrderId,
    });
    if (!response.ok) {
      const error = await parseErrorResponse(response);
      if (error.code === -2013) return undefined;
      throw venueErrorForResponse(response.status, error.code, error.message, parseRetryAfterMs(response));
    }
    return parseOrderResponse(await parseJson(response), input.symbol, input.clientOrderId);
  }

  async submitMarketOrder(input: SubmitMarketOrderInput): Promise<CexOrderResult> {
    assertSubmitInput(input);
    const response = await this.signedRequest("POST", "/api/v3/order", {
      symbol: input.symbol,
      side: input.side.toUpperCase(),
      type: "MARKET",
      quantity: input.quantity,
      newClientOrderId: input.clientOrderId,
      newOrderRespType: "FULL",
    });
    if (!response.ok) {
      const error = await parseErrorResponse(response);
      throw venueErrorForResponse(response.status, error.code, error.message, parseRetryAfterMs(response));
    }
    return parseOrderResponse(await parseJson(response), input.symbol, input.clientOrderId);
  }

  private async signedRequest(
    method: "GET" | "POST",
    path: string,
    requestParams: Record<string, string>,
  ): Promise<Response> {
    const timestamp = this.now();
    if (!Number.isSafeInteger(timestamp) || timestamp <= 0) {
      throw new CexVenueError("BINANCE_CLOCK_INVALID", false);
    }
    const params = new URLSearchParams({
      ...requestParams,
      recvWindow: String(this.recvWindowMs),
      timestamp: String(timestamp),
    });
    const signature = createHmac("sha256", this.apiSecret).update(params.toString()).digest("hex");
    params.set("signature", signature);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    timeout.unref();
    try {
      return await this.fetchFn(`${this.baseUrl}${path}?${params.toString()}`, {
        method,
        headers: { "X-MBX-APIKEY": this.apiKey },
        signal: controller.signal,
      });
    } catch {
      throw new CexVenueError("BINANCE_REQUEST_FAILED", true);
    } finally {
      clearTimeout(timeout);
    }
  }
}

function parseOrderResponse(value: unknown, expectedSymbol: string, expectedClientOrderId: string): CexOrderResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CexVenueError("BINANCE_RESPONSE_INVALID", true);
  }
  const record = value as Record<string, unknown>;
  if (record.symbol !== expectedSymbol || record.clientOrderId !== expectedClientOrderId ||
      typeof record.status !== "string" || typeof record.executedQty !== "string" ||
      !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(record.executedQty)) {
    throw new CexVenueError("BINANCE_RESPONSE_INVALID", true);
  }
  if (record.status === "FILLED") {
    return { state: "filled", externalOrderId: expectedClientOrderId, executedQuantity: record.executedQty };
  }
  if (pendingStatuses.has(record.status)) {
    return { state: "pending", externalOrderId: expectedClientOrderId, executedQuantity: record.executedQty };
  }
  if (terminalFailedStatuses.has(record.status)) {
    return {
      state: "failed",
      externalOrderId: expectedClientOrderId,
      executedQuantity: record.executedQty,
      failureCode: `BINANCE_ORDER_${record.status}`,
    };
  }
  throw new CexVenueError("BINANCE_STATUS_UNKNOWN", true);
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new CexVenueError("BINANCE_RESPONSE_INVALID", true);
  }
}

async function parseErrorResponse(response: Response): Promise<{ code?: number; message?: string }> {
  const value = await parseJson(response);
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const code = (value as Record<string, unknown>).code;
  const message = (value as Record<string, unknown>).msg;
  return {
    ...(typeof code === "number" && Number.isSafeInteger(code) ? { code } : {}),
    ...(typeof message === "string" && message.length <= 256 ? { message } : {}),
  };
}

function venueErrorForResponse(
  httpStatus: number,
  venueCode?: number,
  venueMessage?: string,
  retryAfterMs?: number,
): CexVenueError {
  const retryable = httpStatus === 403 || httpStatus === 418 || httpStatus === 429 || httpStatus >= 500 ||
    (venueCode !== undefined && retryableVenueCodes.has(venueCode)) ||
    (venueCode === -2010 && venueMessage === "Duplicate order sent.");
  const suffix = venueCode === undefined ? `HTTP_${httpStatus}` : `CODE_${Math.abs(venueCode)}`;
  return new CexVenueError(`BINANCE_${suffix}`, retryable, undefined, retryable ? retryAfterMs : undefined);
}

function parseRetryAfterMs(response: Response): number | undefined {
  const value = response.headers.get("retry-after");
  if (value === null || !/^[1-9][0-9]*$/.test(value)) return undefined;
  const seconds = Number(value);
  if (!Number.isSafeInteger(seconds) || seconds > 604_800) return undefined;
  return seconds * 1_000;
}

function assertConfig(config: BinanceSpotAdapterConfig): void {
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    throw new Error("Binance config must be an object");
  }
  const allowed = new Set(["apiKey", "apiSecret", "baseUrl", "recvWindowMs", "requestTimeoutMs"]);
  if (Object.keys(config).some((field) => !allowed.has(field)) ||
      !Object.prototype.hasOwnProperty.call(config, "apiKey") ||
      !Object.prototype.hasOwnProperty.call(config, "apiSecret")) {
    throw new Error("Binance config fields are invalid");
  }
  assertCredential(config.apiKey, "apiKey");
  assertCredential(config.apiSecret, "apiSecret");
  if (config.baseUrl !== undefined) normalizeBaseUrl(config.baseUrl);
  if (config.recvWindowMs !== undefined) assertBoundedInteger(config.recvWindowMs, "recvWindowMs", 1, 5_000);
  if (config.requestTimeoutMs !== undefined) {
    assertBoundedInteger(config.requestTimeoutMs, "requestTimeoutMs", 100, 60_000);
  }
}

function assertQueryInput(input: QueryOrderInput): void {
  assertClosedInput(input, ["symbol", "clientOrderId"], "query input");
  assertSymbol(input.symbol);
  assertClientOrderId(input.clientOrderId);
}

function assertSubmitInput(input: SubmitMarketOrderInput): void {
  assertClosedInput(input, ["symbol", "side", "quantity", "clientOrderId"], "submit input");
  assertSymbol(input.symbol);
  if (input.side !== "buy" && input.side !== "sell") throw new Error("Binance order side must be buy or sell");
  if (typeof input.quantity !== "string" || !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(input.quantity) ||
      Number(input.quantity) <= 0) {
    throw new Error("Binance order quantity must be a positive canonical decimal string");
  }
  assertClientOrderId(input.clientOrderId);
}

function assertClosedInput(value: unknown, fields: readonly string[], label: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Binance ${label} must be an object`);
  }
  const keys = Object.keys(value);
  if (keys.length !== fields.length || fields.some((field) => !Object.prototype.hasOwnProperty.call(value, field))) {
    throw new Error(`Binance ${label} fields are invalid`);
  }
}

function assertSymbol(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[A-Z0-9._-]{3,32}$/.test(value)) {
    throw new Error("Binance symbol is invalid");
  }
}

function assertClientOrderId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[A-Za-z0-9._-]{1,36}$/.test(value)) {
    throw new Error("Binance clientOrderId is invalid");
  }
}

function assertCredential(value: unknown, field: string): void {
  if (typeof value !== "string" || value.length === 0 || value.length > 256 || /\s/.test(value)) {
    throw new Error(`Binance ${field} must be a non-empty whitespace-free string no longer than 256 characters`);
  }
}

function normalizeBaseUrl(value: unknown): string {
  if (typeof value !== "string") throw new Error("Binance baseUrl must be a string");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Binance baseUrl must be an absolute URL");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Binance baseUrl must be an HTTPS origin without credentials, path, query, or fragment");
  }
  return url.origin;
}

function assertBoundedInteger(value: unknown, field: string, min: number, max: number): void {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`Binance ${field} must be a safe integer between ${min} and ${max}`);
  }
}
