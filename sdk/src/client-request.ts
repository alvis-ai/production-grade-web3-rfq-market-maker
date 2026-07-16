import { RFQClientError } from "./client-error.js";
import { buildSubmitQuoteArgs } from "./settlement.js";
import type { QuoteRequest, SubmitQuoteRequest } from "./types.js";

export type RFQClientFetch = (input: string, init?: RequestInit) => Promise<Response>;
export type RFQClientTraceIdProvider = () => string | undefined;
export type RFQClientApiKeyProvider = () => string | undefined;

export interface QuoteRequestOptions {
  readonly idempotencyKey: string;
}

export interface PnlRequestOptions {
  readonly limit?: number;
  readonly cursor?: string;
}

export interface RFQClientOptions {
  readonly fetch?: RFQClientFetch;
  readonly traceId?: string | RFQClientTraceIdProvider;
  readonly apiKey?: string | RFQClientApiKeyProvider;
  readonly requestTimeoutMs?: number;
  readonly maxResponseBytes?: number;
}

export interface NormalizedRFQClientConfig {
  readonly apiKeyProvider?: RFQClientApiKeyProvider;
  readonly baseUrl: string;
  readonly fetchImpl: RFQClientFetch;
  readonly maxResponseBytes: number;
  readonly requestTimeoutMs: number;
  readonly traceIdProvider?: RFQClientTraceIdProvider;
}

const maxTraceIdLength = 128;
const traceIdPattern = /^tr_[A-Za-z0-9._:-]+$/;
const maxStatusIdentifierLength = 128;
const statusIdentifierPattern = /^[A-Za-z0-9_:-]+$/;
const apiKeyPattern = /^[A-Za-z0-9_-]{3,64}\.[A-Za-z0-9_-]{32,128}$/;
const idempotencyKeyPattern = /^[A-Za-z0-9._:-]{16,128}$/;
const pnlCursorPattern = /^pnl1_[A-Za-z0-9_-]+$/;
const clientOptionFields = ["fetch", "traceId", "apiKey", "requestTimeoutMs", "maxResponseBytes"] as const;
const defaultRequestTimeoutMs = 15_000;
const defaultMaxResponseBytes = 8 * 1_024 * 1_024;
const quoteRequestFields = ["chainId", "user", "tokenIn", "tokenOut", "amountIn", "slippageBps"] as const;
const submitRequestFields = ["quote", "signature"] as const;
const submitRequestOptionalFields = ["txHash"] as const;

export function normalizeClientConfig(baseUrl: string, options: unknown): NormalizedRFQClientConfig {
  const clientOptions = assertClientOptions(options);
  return {
    baseUrl: normalizeBaseUrl(baseUrl),
    fetchImpl: resolveFetch(clientOptions),
    requestTimeoutMs: normalizeBoundedInteger(
      clientOptions.requestTimeoutMs,
      defaultRequestTimeoutMs,
      100,
      120_000,
      "requestTimeoutMs",
    ),
    maxResponseBytes: normalizeBoundedInteger(
      clientOptions.maxResponseBytes,
      defaultMaxResponseBytes,
      1_024,
      16 * 1_024 * 1_024,
      "maxResponseBytes",
    ),
    traceIdProvider: resolveTraceIdProvider(clientOptions),
    apiKeyProvider: resolveApiKeyProvider(clientOptions),
  };
}

function normalizeBoundedInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
  field: "requestTimeoutMs" | "maxResponseBytes",
): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new RFQClientError(`RFQClient ${field} must be an integer from ${minimum} to ${maximum}`, 0);
  }
  return value as number;
}

export function assertQuoteRequestOptions(options: unknown): QuoteRequestOptions | undefined {
  if (options === undefined) return undefined;
  if (!isRecord(options)) {
    throw new RFQClientError("RFQ quote options must be an object", 0);
  }
  const keys = Object.keys(options);
  if (
    keys.length !== 1 ||
    keys[0] !== "idempotencyKey" ||
    !Object.prototype.hasOwnProperty.call(options, "idempotencyKey")
  ) {
    throw new RFQClientError("RFQ quote options must contain only idempotencyKey", 0);
  }
  if (typeof options.idempotencyKey !== "string" || !idempotencyKeyPattern.test(options.idempotencyKey)) {
    throw new RFQClientError("RFQ quote idempotencyKey must contain 16-128 safe ASCII characters", 0);
  }
  return { idempotencyKey: options.idempotencyKey };
}

export function assertPnlRequestOptions(options: unknown): PnlRequestOptions | undefined {
  if (options === undefined) return undefined;
  if (!isRecord(options)) throw new RFQClientError("RFQ PnL options must be an object", 0);
  const keys = Object.keys(options);
  if (keys.some((key) => key !== "limit" && key !== "cursor") ||
      ("limit" in options && !Object.prototype.hasOwnProperty.call(options, "limit")) ||
      ("cursor" in options && !Object.prototype.hasOwnProperty.call(options, "cursor"))) {
    throw new RFQClientError("RFQ PnL options may contain only limit and cursor", 0);
  }
  if (options.limit !== undefined &&
      (!Number.isSafeInteger(options.limit) || Number(options.limit) < 1 || Number(options.limit) > 100)) {
    throw new RFQClientError("RFQ PnL limit must be an integer from 1 to 100", 0);
  }
  if (options.cursor !== undefined &&
      (typeof options.cursor !== "string" || options.cursor.length > 512 || !pnlCursorPattern.test(options.cursor))) {
    throw new RFQClientError("RFQ PnL cursor is invalid", 0);
  }
  return {
    ...(options.limit === undefined ? {} : { limit: Number(options.limit) }),
    ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
  };
}

export function assertQuoteRequest(request: QuoteRequest): void {
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

export function assertSubmitQuoteRequest(request: SubmitQuoteRequest): void {
  if (!isRecord(request)) {
    throw new RFQClientError("RFQ submit request must be an object", 0);
  }
  assertExactFields(request, submitRequestFields, "RFQ submit request", submitRequestOptionalFields);
  assertOptionalOwnField(request, "txHash", "RFQ submit request");
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

export function assertNonEmptyIdentifier(value: unknown, field: "quoteId" | "hedgeOrderId" | "settlementEventId"): string {
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
  if (traceId === undefined) return undefined;
  if (typeof traceId === "string") {
    const normalized = assertClientTraceId(traceId, "RFQClient traceId");
    return () => normalized;
  }
  if (typeof traceId === "function") {
    return () => {
      const nextTraceId = traceId();
      if (nextTraceId === undefined) return undefined;
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

function assertOptionalOwnField(payload: Record<string, unknown>, field: string, label: string): void {
  if (field in payload && !Object.prototype.hasOwnProperty.call(payload, field)) {
    throw new RFQClientError(`${label} returned malformed ${field}`, 0);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isAddressHex(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
}

function isBytes32Hex(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

function isPositiveUIntString(value: unknown): value is string {
  return typeof value === "string" && /^[1-9][0-9]*$/.test(value);
}
