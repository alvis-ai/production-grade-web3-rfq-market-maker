import { rfqErrorCodes } from "./types.js";
import { RFQClientError } from "./client-error.js";
import type { HealthResponse, ReadinessResponse, RFQErrorResponse } from "./types.js";

const SECP256K1N_HALF = BigInt("0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0");
const maxTraceIdLength = 128;
const traceIdPattern = /^tr_[A-Za-z0-9._:-]+$/;
const maxStatusIdentifierLength = 128;
const statusIdentifierPattern = /^[A-Za-z0-9_:-]+$/;
const retryAfterSecondsPattern = /^[1-9][0-9]*$/;
const isoUtcTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const errorResponseFields = ["code", "message", "traceId"] as const;
const healthResponseFields = ["status"] as const;
const readinessResponseFields = ["status", "components"] as const;
const rfqErrorCodeSet: ReadonlySet<string> = new Set(rfqErrorCodes);
const readinessDependencyComponents = [
  "marketData",
  "marketSnapshotStore",
  "routing",
  "pricing",
  "risk",
  "signer",
  "quoteRepository",
  "quoteControl",
  "riskDecisionStore",
  "rateLimitStore",
  "inventory",
  "execution",
  "settlementEventStore",
  "pnl",
  "metrics",
] as const;

export async function readJsonResponse(response: Response, label: string): Promise<unknown> {
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

export function assertResponsePayload<T>(
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

export async function assertOk(response: Response, fallbackMessage: string): Promise<void> {
  if (response.ok) return;

  let error: RFQErrorResponse | undefined;
  try {
    error = (await response.json()) as RFQErrorResponse;
  } catch {
    error = undefined;
  }

  throw clientErrorFromResponse(response, error, fallbackMessage);
}

export function clientErrorFromResponse(
  response: Response,
  payload: unknown,
  fallbackMessage: string,
): RFQClientError {
  const error = isRFQErrorResponse(payload) ? payload : undefined;
  return new RFQClientError(
    error?.message ?? fallbackMessage,
    response.status,
    error?.code,
    normalizeTraceId(error?.traceId) ?? traceIdFromResponse(response),
    retryAfterSeconds(response),
  );
}

export function malformedFieldError(status: number, label: string, field: string): RFQClientError {
  return new RFQClientError(`${label} returned malformed ${field}`, status);
}

export function assertOwnResponseFields(
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

export function assertOptionalOwnResponseField(
  payload: Record<string, unknown>,
  field: string,
  status: number,
  label: string,
): void {
  if (field in payload && !hasOwnField(payload, field)) {
    throw malformedFieldError(status, label, field);
  }
}

export function assertOptionalBytes32Field(payload: unknown, field: string, status: number, label: string): void {
  if (!isRecord(payload)) {
    throw malformedFieldError(status, label, field);
  }
  assertOptionalOwnResponseField(payload, field, status, label);
  const value = payload[field];
  if (value !== undefined && !isBytes32Hex(value)) {
    throw malformedFieldError(status, label, field);
  }
}

export function assertRequiredBytes32Field(payload: unknown, field: string, status: number, label: string): void {
  if (!isRecord(payload) || !hasOwnField(payload, field) || !isBytes32Hex(payload[field])) {
    throw malformedFieldError(status, label, field);
  }
}

export function assertRequiredSignatureField(payload: unknown, field: string, status: number, label: string): void {
  if (!isRecord(payload) || !hasOwnField(payload, field) || !isSignatureHex(payload[field])) {
    throw malformedFieldError(status, label, field);
  }
}

export function assertRequiredEnumField(
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

export function assertRequiredNonNegativeIntegerField(
  payload: unknown,
  field: string,
  status: number,
  label: string,
): void {
  if (!isRecord(payload) || !hasOwnField(payload, field) || !isNonNegativeSafeInteger(payload[field])) {
    throw malformedFieldError(status, label, field);
  }
}

export function traceIdFromResponse(response: Response): string | undefined {
  return normalizeTraceId(response.headers.get("x-trace-id"));
}

export function isHealthResponse(value: unknown): value is HealthResponse {
  return isRecord(value) && hasExactOwnFields(value, healthResponseFields) && value.status === "ok";
}

export function isReadinessResponse(value: unknown): value is ReadinessResponse {
  if (!isRecord(value) || !hasExactOwnFields(value, readinessResponseFields)) return false;
  return (value.status === "ready" || value.status === "degraded") && isReadinessComponents(value.components);
}

export function hasOwnField(payload: object, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(payload, field);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function isBytes32Hex(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

export function isAddressHex(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isSafeIdentifier(value: unknown): value is string {
  return isNonEmptyString(value) && value.length <= maxStatusIdentifierLength && statusIdentifierPattern.test(value);
}

export function isIsoUtcTimestampString(value: unknown): value is string {
  if (typeof value !== "string" || !isoUtcTimestampPattern.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

export function isPositiveUIntString(value: unknown): value is string {
  return typeof value === "string" && /^[1-9][0-9]*$/.test(value);
}

export function isPositiveDecimalString(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 96 || !/^(0|[1-9][0-9]*)(\.[0-9]{1,18})?$/.test(value)) {
    return false;
  }
  return BigInt(value.replace(".", "")) > 0n;
}

export function isCommissionTotals(value: unknown): value is Array<{ asset: string; quantity: string }> {
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

export function isIntString(value: unknown): value is string {
  return typeof value === "string" && /^(0|-?[1-9][0-9]*)$/.test(value);
}

export function isSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value);
}

export function isPositiveSafeInteger(value: unknown): value is number {
  return isSafeInteger(value) && value > 0;
}

export function isNonNegativeSafeInteger(value: unknown): value is number {
  return isSafeInteger(value) && value >= 0;
}

export function isTokenDecimals(value: unknown): value is number {
  return isSafeInteger(value) && value >= 0 && value <= 36;
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

function isSignatureHex(value: unknown): value is `0x${string}` {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(value)) return false;
  const s = BigInt(`0x${value.slice(66, 130)}`);
  if (s > SECP256K1N_HALF) return false;
  const v = Number.parseInt(value.slice(130, 132), 16);
  const normalizedV = v < 27 ? v + 27 : v;
  return normalizedV === 27 || normalizedV === 28;
}

function retryAfterSeconds(response: Response): number | undefined {
  const value = response.headers.get("retry-after");
  if (!value || !retryAfterSecondsPattern.test(value)) return undefined;
  const seconds = Number(value);
  return Number.isSafeInteger(seconds) ? seconds : undefined;
}

function normalizeTraceId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maxTraceIdLength || !traceIdPattern.test(normalized)) {
    return undefined;
  }
  return normalized;
}

function isRFQErrorResponse(value: unknown): value is RFQErrorResponse {
  return isRecord(value) && hasExactOwnFields(value, errorResponseFields) &&
    typeof value.code === "string" && rfqErrorCodeSet.has(value.code) &&
    typeof value.message === "string" && typeof value.traceId === "string";
}

function hasExactOwnFields(value: Record<string, unknown>, expectedFields: readonly string[]): boolean {
  const keys = Object.keys(value);
  if (keys.length !== expectedFields.length) return false;
  const expected = new Set<string>(expectedFields);
  return keys.every((key) => expected.has(key)) && expectedFields.every((field) => hasOwnField(value, field));
}

function isReadinessComponents(value: unknown): value is ReadinessResponse["components"] {
  if (!isRecord(value) || Object.keys(value).length !== readinessDependencyComponents.length) return false;
  const expectedComponents = new Set<string>(readinessDependencyComponents);
  if (!Object.keys(value).every((key) => expectedComponents.has(key))) return false;
  return readinessDependencyComponents.every((component) => {
    const status = value[component];
    return status === "ok" || status === "degraded";
  });
}
