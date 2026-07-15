import { createHmac } from "node:crypto";
import {
  BinanceSymbolRulesError,
  type BinanceLimitOrderInput,
} from "./binance-symbol-rules.js";

export interface SubmitLimitOrderInput {
  symbol: string;
  side: "buy" | "sell";
  quantity: string;
  price: string;
  clientOrderId: string;
}

export interface QueryOrderInput {
  symbol: string;
  clientOrderId: string;
}

export type CancelOrderInput = QueryOrderInput;

export interface QueryOrderTradesInput {
  symbol: string;
  venueOrderId: string;
}

export interface CexOrderResult {
  state: "pending" | "filled" | "failed";
  externalOrderId: string;
  venueOrderId: string;
  executedQuantity: string;
  executedQuoteQuantity: string;
  failureCode?: string;
}

export interface CexTradeFill {
  venueTradeId: string;
  venueOrderId: string;
  price: string;
  quantity: string;
  quoteQuantity: string;
  commissionQuantity: string;
  commissionAsset: string;
  executedAt: string;
  isBuyer: boolean;
  isMaker: boolean;
}

export interface CexExecutionAdapter {
  queryOrder(input: QueryOrderInput): Promise<CexOrderResult | undefined>;
  queryOrderTrades(input: QueryOrderTradesInput): Promise<CexTradeFill[]>;
  validateLimitOrder(input: BinanceLimitOrderInput): Promise<void>;
  submitLimitOrder(input: SubmitLimitOrderInput): Promise<CexOrderResult>;
  cancelOrder(input: CancelOrderInput): Promise<CexOrderResult>;
}

export interface BinanceSpotAdapterConfig {
  apiKey: string;
  apiSecret: string;
  baseUrl?: string;
  recvWindowMs?: number;
  requestTimeoutMs?: number;
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type LimitOrderRulesValidator = {
  validateLimitOrder(input: BinanceLimitOrderInput): Promise<void>;
};

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
const maxClockOffsetMs = 86_400_000;
const terminalFailedStatuses = new Set(["CANCELED", "EXPIRED", "EXPIRED_IN_MATCH", "REJECTED"]);
const pendingStatuses = new Set(["NEW", "PENDING_NEW", "PARTIALLY_FILLED"]);
const retryableVenueCodes = new Set([-1000, -1001, -1003, -1006, -1007, -1008, -1015, -1016, -1021, -1034]);
const tradePageSize = 1_000;
const maxTradePages = 100;

export class BinanceSpotAdapter implements CexExecutionAdapter {
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly baseUrl: string;
  private readonly recvWindowMs: number;
  private readonly requestTimeoutMs: number;
  private clockOffsetMs = 0;
  private clockSyncPromise: Promise<void> | undefined;

  constructor(
    config: BinanceSpotAdapterConfig,
    private readonly rulesValidator: LimitOrderRulesValidator,
    private readonly fetchFn: FetchLike = fetch,
    private readonly now: () => number = Date.now,
  ) {
    assertConfig(config);
    if (typeof fetchFn !== "function") throw new Error("Binance fetch dependency must be a function");
    if (typeof now !== "function") throw new Error("Binance clock dependency must be a function");
    if (typeof rulesValidator !== "object" || rulesValidator === null ||
        typeof rulesValidator.validateLimitOrder !== "function") {
      throw new Error("Binance rules validator must expose validateLimitOrder");
    }
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

  async submitLimitOrder(input: SubmitLimitOrderInput): Promise<CexOrderResult> {
    assertSubmitInput(input);
    const response = await this.signedRequest("POST", "/api/v3/order", {
      symbol: input.symbol,
      side: input.side.toUpperCase(),
      type: "LIMIT",
      timeInForce: "GTC",
      quantity: input.quantity,
      price: input.price,
      newClientOrderId: input.clientOrderId,
      newOrderRespType: "FULL",
    });
    if (!response.ok) {
      const error = await parseErrorResponse(response);
      throw venueErrorForResponse(response.status, error.code, error.message, parseRetryAfterMs(response));
    }
    return parseOrderResponse(await parseJson(response), input.symbol, input.clientOrderId);
  }

  async validateLimitOrder(input: BinanceLimitOrderInput): Promise<void> {
    try {
      await this.rulesValidator.validateLimitOrder(input);
    } catch (error) {
      if (error instanceof BinanceSymbolRulesError) {
        throw new CexVenueError(error.errorCode, error.retryable);
      }
      throw error;
    }
  }

  async cancelOrder(input: CancelOrderInput): Promise<CexOrderResult> {
    assertQueryInput(input);
    const response = await this.signedRequest("DELETE", "/api/v3/order", {
      symbol: input.symbol,
      origClientOrderId: input.clientOrderId,
    });
    if (!response.ok) {
      const error = await parseErrorResponse(response);
      throw venueErrorForResponse(response.status, error.code, error.message, parseRetryAfterMs(response));
    }
    return parseOrderResponse(await parseJson(response), input.symbol, input.clientOrderId);
  }

  async queryOrderTrades(input: QueryOrderTradesInput): Promise<CexTradeFill[]> {
    assertQueryOrderTradesInput(input);
    const fills: CexTradeFill[] = [];
    let fromId: string | undefined;
    for (let pageNumber = 0; pageNumber < maxTradePages; pageNumber += 1) {
      const response = await this.signedRequest("GET", "/api/v3/myTrades", {
        symbol: input.symbol,
        orderId: input.venueOrderId,
        limit: String(tradePageSize),
        ...(fromId === undefined ? {} : { fromId }),
      });
      if (!response.ok) {
        const error = await parseErrorResponse(response);
        throw venueErrorForResponse(response.status, error.code, error.message, parseRetryAfterMs(response));
      }
      const page = parseTradeResponse(await parseJson(response), input.symbol, input.venueOrderId);
      const previousTradeId = fills[fills.length - 1]?.venueTradeId;
      if (previousTradeId !== undefined && page[0] !== undefined &&
          Number(page[0].venueTradeId) <= Number(previousTradeId)) {
        throw new CexVenueError("BINANCE_RESPONSE_INVALID", true);
      }
      fills.push(...page);
      if (page.length < tradePageSize) return fills;
      fromId = incrementSafeVenueId(page[page.length - 1]!.venueTradeId);
    }
    throw new CexVenueError("BINANCE_TRADE_PAGE_LIMIT_EXCEEDED", true);
  }

  private async signedRequest(
    method: "GET" | "POST" | "DELETE",
    path: string,
    requestParams: Record<string, string>,
  ): Promise<Response> {
    const response = await this.sendSignedRequest(method, path, requestParams);
    if (!await hasVenueErrorCode(response, -1021)) return response;
    await this.synchronizeClock();
    return this.sendSignedRequest(method, path, requestParams);
  }

  private async sendSignedRequest(
    method: "GET" | "POST" | "DELETE",
    path: string,
    requestParams: Record<string, string>,
  ): Promise<Response> {
    const timestamp = this.now() + this.clockOffsetMs;
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
    return this.fetchWithTimeout(`${this.baseUrl}${path}?${params.toString()}`, {
      method,
      headers: { "X-MBX-APIKEY": this.apiKey },
    }, "BINANCE_REQUEST_FAILED");
  }

  private async synchronizeClock(): Promise<void> {
    if (this.clockSyncPromise) return this.clockSyncPromise;
    const pending = this.fetchClockOffset();
    this.clockSyncPromise = pending;
    try {
      await pending;
    } finally {
      if (this.clockSyncPromise === pending) this.clockSyncPromise = undefined;
    }
  }

  private async fetchClockOffset(): Promise<void> {
    const startedAt = this.now();
    if (!Number.isSafeInteger(startedAt) || startedAt <= 0) {
      throw new CexVenueError("BINANCE_CLOCK_INVALID", false);
    }
    const response = await this.fetchWithTimeout(
      `${this.baseUrl}/api/v3/time`,
      { method: "GET" },
      "BINANCE_TIME_SYNC_FAILED",
    );
    const completedAt = this.now();
    if (!response.ok) {
      throw new CexVenueError(
        "BINANCE_TIME_SYNC_FAILED",
        true,
        undefined,
        parseRetryAfterMs(response),
      );
    }
    if (!Number.isSafeInteger(completedAt) || completedAt < startedAt) {
      throw new CexVenueError("BINANCE_TIME_SYNC_FAILED", true);
    }
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      throw new CexVenueError("BINANCE_TIME_SYNC_FAILED", true);
    }
    if (typeof value !== "object" || value === null || Array.isArray(value) ||
        !Number.isSafeInteger((value as Record<string, unknown>).serverTime) ||
        Number((value as Record<string, unknown>).serverTime) <= 0) {
      throw new CexVenueError("BINANCE_TIME_SYNC_FAILED", true);
    }
    const midpoint = startedAt + Math.floor((completedAt - startedAt) / 2);
    const offset = Number((value as Record<string, unknown>).serverTime) - midpoint;
    const adjustedNow = this.now() + offset;
    if (!Number.isSafeInteger(offset) || Math.abs(offset) > maxClockOffsetMs ||
        !Number.isSafeInteger(adjustedNow) || adjustedNow <= 0) {
      throw new CexVenueError("BINANCE_TIME_SYNC_FAILED", true);
    }
    this.clockOffsetMs = offset;
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    failureCode: "BINANCE_REQUEST_FAILED" | "BINANCE_TIME_SYNC_FAILED",
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    timeout.unref();
    try {
      return await this.fetchFn(url, { ...init, signal: controller.signal });
    } catch {
      throw new CexVenueError(failureCode, true);
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function hasVenueErrorCode(response: Response, expectedCode: number): Promise<boolean> {
  if (response.ok) return false;
  try {
    const value = await response.clone().json() as unknown;
    return typeof value === "object" && value !== null && !Array.isArray(value) &&
      (value as Record<string, unknown>).code === expectedCode;
  } catch {
    return false;
  }
}

function parseOrderResponse(value: unknown, expectedSymbol: string, expectedClientOrderId: string): CexOrderResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CexVenueError("BINANCE_RESPONSE_INVALID", true);
  }
  const record = value as Record<string, unknown>;
  if (record.symbol !== expectedSymbol ||
      (record.clientOrderId !== expectedClientOrderId && record.origClientOrderId !== expectedClientOrderId) ||
      !isPositiveSafeVenueId(record.orderId) ||
      typeof record.status !== "string" || typeof record.executedQty !== "string" ||
      !isVenueDecimal(record.executedQty, 36) ||
      typeof record.cummulativeQuoteQty !== "string" || !isVenueDecimal(record.cummulativeQuoteQty, 18)) {
    throw new CexVenueError("BINANCE_RESPONSE_INVALID", true);
  }
  const result = {
    externalOrderId: expectedClientOrderId,
    venueOrderId: String(record.orderId),
    executedQuantity: record.executedQty,
    executedQuoteQuantity: record.cummulativeQuoteQty,
  };
  if (record.status === "FILLED") {
    return { state: "filled", ...result };
  }
  if (pendingStatuses.has(record.status)) {
    return { state: "pending", ...result };
  }
  if (terminalFailedStatuses.has(record.status)) {
    return {
      state: "failed",
      ...result,
      failureCode: `BINANCE_ORDER_${record.status}`,
    };
  }
  throw new CexVenueError("BINANCE_STATUS_UNKNOWN", true);
}

function parseTradeResponse(value: unknown, expectedSymbol: string, expectedOrderId: string): CexTradeFill[] {
  if (!Array.isArray(value)) throw new CexVenueError("BINANCE_RESPONSE_INVALID", true);
  let previousTradeId = 0;
  return value.map((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new CexVenueError("BINANCE_RESPONSE_INVALID", true);
    }
    const record = entry as Record<string, unknown>;
    if (record.symbol !== expectedSymbol || !isPositiveSafeVenueId(record.id) ||
        !isPositiveSafeVenueId(record.orderId) || String(record.orderId) !== expectedOrderId ||
        typeof record.price !== "string" || !isPositiveVenueDecimal(record.price, 18) ||
        typeof record.qty !== "string" || !isPositiveVenueDecimal(record.qty, 36) ||
        typeof record.quoteQty !== "string" || !isPositiveVenueDecimal(record.quoteQty, 18) ||
        typeof record.commission !== "string" || !isVenueDecimal(record.commission, 36) ||
        typeof record.commissionAsset !== "string" || !isCommissionAsset(record.commissionAsset) ||
        !isPositiveSafeVenueId(record.time) || typeof record.isBuyer !== "boolean" ||
        typeof record.isMaker !== "boolean") {
      throw new CexVenueError("BINANCE_RESPONSE_INVALID", true);
    }
    const tradeId = record.id as number;
    if (tradeId <= previousTradeId) throw new CexVenueError("BINANCE_RESPONSE_INVALID", true);
    previousTradeId = tradeId;
    return {
      venueTradeId: String(tradeId),
      venueOrderId: String(record.orderId),
      price: record.price,
      quantity: record.qty,
      quoteQuantity: record.quoteQty,
      commissionQuantity: record.commission,
      commissionAsset: record.commissionAsset,
      executedAt: new Date(record.time as number).toISOString(),
      isBuyer: record.isBuyer,
      isMaker: record.isMaker,
    };
  });
}

function isVenueDecimal(value: string, maxFractionDigits: number): boolean {
  const match = value.match(/^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/);
  return match !== null && match[1].length <= 60 && (match[2]?.length ?? 0) <= maxFractionDigits;
}

function isPositiveVenueDecimal(value: string, maxFractionDigits: number): boolean {
  return isVenueDecimal(value, maxFractionDigits) && !/^0(?:\.0+)?$/.test(value);
}

function isPositiveSafeVenueId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function incrementSafeVenueId(value: string): string {
  const next = Number(value) + 1;
  if (!Number.isSafeInteger(next)) throw new CexVenueError("BINANCE_RESPONSE_INVALID", true);
  return String(next);
}

function isCommissionAsset(value: string): boolean {
  return value.length >= 1 && value.length <= 64 && !/[\s\p{Cc}]/u.test(value);
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
    venueCode === -2011 ||
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

function assertQueryOrderTradesInput(input: QueryOrderTradesInput): void {
  assertClosedInput(input, ["symbol", "venueOrderId"], "trade query input");
  assertSymbol(input.symbol);
  if (typeof input.venueOrderId !== "string" || !/^[1-9][0-9]{0,15}$/.test(input.venueOrderId) ||
      !Number.isSafeInteger(Number(input.venueOrderId))) {
    throw new Error("Binance venueOrderId must be a positive safe integer string");
  }
}

function assertSubmitInput(input: SubmitLimitOrderInput): void {
  assertClosedInput(input, ["symbol", "side", "quantity", "price", "clientOrderId"], "submit input");
  assertSymbol(input.symbol);
  if (input.side !== "buy" && input.side !== "sell") throw new Error("Binance order side must be buy or sell");
  if (typeof input.quantity !== "string" || !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(input.quantity) ||
      Number(input.quantity) <= 0) {
    throw new Error("Binance order quantity must be a positive canonical decimal string");
  }
  if (typeof input.price !== "string" || !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(input.price) ||
      Number(input.price) <= 0) {
    throw new Error("Binance order price must be a positive canonical decimal string");
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
