import { createHash, randomUUID } from "node:crypto";
import type { QuoteRequest, QuoteResponse } from "../../shared/types/rfq.js";
import { isRFQErrorCode, type RFQErrorCode } from "../../shared/errors/api-error.js";
import { assertPrincipalId } from "../../shared/validation/principal-id.js";
import { isCanonicalUtcIsoTimestamp } from "../../shared/validation/timestamp.js";

export const defaultQuoteIdempotencyLeaseMs = 60_000;
export const minQuoteIdempotencyLeaseMs = 10_000;
export const maxQuoteIdempotencyLeaseMs = 3_900_000;
export const quoteIdempotencyKeyPattern = /^[A-Za-z0-9._:-]{16,128}$/;

export interface QuoteIdempotencyReservation {
  principalId: string;
  key: string;
  requestHash: string;
  ownerToken: string;
  expiresAt: string;
}

export interface QuoteIdempotencyFailure {
  code: RFQErrorCode;
  message: string;
  statusCode: number;
}

export type QuoteIdempotencyClaimResult =
  | { status: "acquired"; reservation: QuoteIdempotencyReservation }
  | { status: "replay"; response: QuoteResponse }
  | { status: "failed"; error: QuoteIdempotencyFailure }
  | { status: "conflict" }
  | { status: "in_progress" };

export interface QuoteIdempotencyStore {
  acquire(principalId: string, key: string, requestHash: string): Promise<QuoteIdempotencyClaimResult>;
  bindQuote(reservation: QuoteIdempotencyReservation, quoteId: string): Promise<void>;
  complete(reservation: QuoteIdempotencyReservation, response: QuoteResponse): Promise<void>;
  fail(reservation: QuoteIdempotencyReservation, error: QuoteIdempotencyFailure): Promise<void>;
  checkHealth(): Promise<void> | void;
}

export interface QuoteIdempotencyStoreConfig {
  leaseMs: number;
}

interface InMemoryEntry {
  reservation: QuoteIdempotencyReservation;
  quoteId?: string;
  response?: QuoteResponse;
  error?: QuoteIdempotencyFailure;
}

interface InMemoryDependencies {
  now?: () => number;
  ownerToken?: () => string;
}

export class InMemoryQuoteIdempotencyStore implements QuoteIdempotencyStore {
  private readonly entries = new Map<string, InMemoryEntry>();
  private readonly config: QuoteIdempotencyStoreConfig;
  private readonly now: () => number;
  private readonly ownerToken: () => string;

  constructor(
    config: QuoteIdempotencyStoreConfig = { leaseMs: defaultQuoteIdempotencyLeaseMs },
    dependencies: InMemoryDependencies = {},
  ) {
    assertQuoteIdempotencyStoreConfig(config);
    assertDependencies(dependencies);
    this.config = { ...config };
    this.now = dependencies.now ?? Date.now;
    this.ownerToken = dependencies.ownerToken ?? (() => `quote_idem_${randomUUID()}`);
  }

  checkHealth(): void {
    readNow(this.now);
  }

  async acquire(principalId: string, key: string, requestHash: string): Promise<QuoteIdempotencyClaimResult> {
    assertPrincipalId(principalId, "Quote idempotency principalId");
    assertQuoteIdempotencyKey(key);
    assertRequestHash(requestHash);
    const mapKey = entryKey(principalId, key);
    const nowMs = readNow(this.now);
    const current = this.entries.get(mapKey);
    if (current) {
      if (current.reservation.requestHash !== requestHash) return { status: "conflict" };
      if (current.response) return { status: "replay", response: cloneQuoteResponse(current.response) };
      if (current.error) return { status: "failed", error: { ...current.error } };
      if (current.quoteId || Date.parse(current.reservation.expiresAt) > nowMs) return { status: "in_progress" };
    }

    const reservation = buildReservation(principalId, key, requestHash, this.ownerToken(), nowMs, this.config.leaseMs);
    this.entries.set(mapKey, { reservation });
    return { status: "acquired", reservation: { ...reservation } };
  }

  async bindQuote(reservation: QuoteIdempotencyReservation, quoteId: string): Promise<void> {
    assertQuoteIdempotencyReservation(reservation);
    assertSafeIdentifier(quoteId, "Quote idempotency quoteId");
    const current = this.requireOwnedProcessing(reservation);
    if (current.quoteId !== undefined && current.quoteId !== quoteId) {
      throw new Error("Quote idempotency reservation is already bound to another quote");
    }
    current.quoteId = quoteId;
  }

  async complete(reservation: QuoteIdempotencyReservation, response: QuoteResponse): Promise<void> {
    assertQuoteIdempotencyReservation(reservation);
    assertQuoteResponse(response);
    const current = this.requireOwnedProcessing(reservation);
    if (current.quoteId !== response.quoteId) {
      throw new Error("Quote idempotency response quoteId does not match the bound quote");
    }
    current.response = cloneQuoteResponse(response);
  }

  async fail(reservation: QuoteIdempotencyReservation, error: QuoteIdempotencyFailure): Promise<void> {
    assertQuoteIdempotencyReservation(reservation);
    assertQuoteIdempotencyFailure(error);
    const current = this.requireOwnedProcessing(reservation);
    current.error = { ...error };
  }

  private requireOwnedProcessing(reservation: QuoteIdempotencyReservation): InMemoryEntry {
    const current = this.entries.get(entryKey(reservation.principalId, reservation.key));
    if (!current || current.response || current.error ||
        current.reservation.ownerToken !== reservation.ownerToken ||
        current.reservation.requestHash !== reservation.requestHash) {
      throw new Error("Quote idempotency reservation is no longer owned by this request");
    }
    return current;
  }
}

export function quoteRequestHash(request: QuoteRequest): string {
  const canonical = JSON.stringify({
    chainId: request.chainId,
    user: request.user.toLowerCase(),
    tokenIn: request.tokenIn.toLowerCase(),
    tokenOut: request.tokenOut.toLowerCase(),
    amountIn: request.amountIn,
    slippageBps: request.slippageBps,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export function assertQuoteIdempotencyKey(value: unknown): asserts value is string {
  if (typeof value !== "string" || !quoteIdempotencyKeyPattern.test(value)) {
    throw new Error("Idempotency-Key must contain 16-128 safe ASCII characters");
  }
}

export function assertQuoteIdempotencyReservation(value: unknown): asserts value is QuoteIdempotencyReservation {
  assertRecord(value, "Quote idempotency reservation");
  assertExactFields(value, ["principalId", "key", "requestHash", "ownerToken", "expiresAt"], "Quote idempotency reservation");
  assertPrincipalId(value.principalId, "Quote idempotency reservation principalId");
  assertQuoteIdempotencyKey(value.key);
  assertRequestHash(value.requestHash);
  assertSafeIdentifier(value.ownerToken, "Quote idempotency ownerToken");
  if (typeof value.expiresAt !== "string" || !isCanonicalUtcIsoTimestamp(value.expiresAt)) {
    throw new Error("Quote idempotency reservation expiresAt must be a canonical UTC timestamp");
  }
}

export function assertQuoteIdempotencyFailure(value: unknown): asserts value is QuoteIdempotencyFailure {
  assertRecord(value, "Quote idempotency failure");
  assertExactFields(value, ["code", "message", "statusCode"], "Quote idempotency failure");
  if (!isRFQErrorCode(value.code)) {
    throw new Error("Quote idempotency failure code is invalid");
  }
  if (typeof value.message !== "string" || value.message.length === 0 || value.message.length > 256) {
    throw new Error("Quote idempotency failure message is invalid");
  }
  if (
    typeof value.statusCode !== "number" ||
    !Number.isSafeInteger(value.statusCode) ||
    value.statusCode < 400 ||
    value.statusCode > 599
  ) {
    throw new Error("Quote idempotency failure statusCode is invalid");
  }
}

export function assertQuoteIdempotencyStoreConfig(value: unknown): asserts value is QuoteIdempotencyStoreConfig {
  assertRecord(value, "Quote idempotency store config");
  assertExactFields(value, ["leaseMs"], "Quote idempotency store config");
  if (typeof value.leaseMs !== "number" || !Number.isSafeInteger(value.leaseMs) ||
      value.leaseMs < minQuoteIdempotencyLeaseMs || value.leaseMs > maxQuoteIdempotencyLeaseMs) {
    throw new Error(
      `Quote idempotency leaseMs must be between ${minQuoteIdempotencyLeaseMs} and ${maxQuoteIdempotencyLeaseMs}`,
    );
  }
}

export function assertQuoteIdempotencyStore(value: unknown): asserts value is QuoteIdempotencyStore {
  assertRecord(value, "Quote idempotency store");
  for (const method of ["acquire", "bindQuote", "complete", "fail", "checkHealth"] as const) {
    if (typeof value[method] !== "function") throw new Error(`Quote idempotency store.${method} must be a function`);
  }
}

export function assertQuoteResponse(value: unknown): asserts value is QuoteResponse {
  assertRecord(value, "Quote idempotency response");
  assertExactFields(
    value,
    ["quoteId", "snapshotId", "amountOut", "minAmountOut", "deadline", "nonce", "signature"],
    "Quote idempotency response",
  );
  assertSafeIdentifier(value.quoteId, "Quote idempotency response quoteId");
  assertSafeIdentifier(value.snapshotId, "Quote idempotency response snapshotId");
  for (const field of ["amountOut", "minAmountOut", "nonce"] as const) {
    if (typeof value[field] !== "string" || !/^[1-9][0-9]*$/.test(value[field])) {
      throw new Error(`Quote idempotency response ${field} must be a canonical positive uint string`);
    }
  }
  if (typeof value.deadline !== "number" || !Number.isSafeInteger(value.deadline) || value.deadline <= 0) {
    throw new Error("Quote idempotency response deadline must be a positive safe integer");
  }
  if (typeof value.signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(value.signature)) {
    throw new Error("Quote idempotency response signature must be a 65-byte hex value");
  }
}

function buildReservation(
  principalId: string,
  key: string,
  requestHash: string,
  ownerToken: string,
  nowMs: number,
  leaseMs: number,
): QuoteIdempotencyReservation {
  const reservation = {
    principalId,
    key,
    requestHash,
    ownerToken,
    expiresAt: new Date(nowMs + leaseMs).toISOString(),
  };
  assertQuoteIdempotencyReservation(reservation);
  return reservation;
}

function cloneQuoteResponse(response: QuoteResponse): QuoteResponse {
  return { ...response };
}

function entryKey(principalId: string, key: string): string {
  return `${principalId}:${key}`;
}

function assertRequestHash(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error("Quote idempotency requestHash must be a lowercase SHA-256 digest");
  }
}

function assertSafeIdentifier(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 128 || !/^[A-Za-z0-9_:-]+$/.test(value)) {
    throw new Error(`${label} must be a safe identifier`);
  }
}

function readNow(now: () => number): number {
  const value = now();
  if (!Number.isFinite(value) || value < 0) throw new Error("Quote idempotency clock must return a non-negative timestamp");
  return value;
}

function assertDependencies(value: unknown): asserts value is InMemoryDependencies {
  assertRecord(value, "Quote idempotency dependencies");
  const allowed = new Set(["now", "ownerToken"]);
  if (Object.keys(value).some((field) => !allowed.has(field))) {
    throw new Error("Quote idempotency dependencies fields are invalid");
  }
  for (const field of allowed) {
    if (value[field] !== undefined && typeof value[field] !== "function") {
      throw new Error(`Quote idempotency dependencies.${field} must be a function when provided`);
    }
  }
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`);
}

function assertExactFields(value: Record<string, unknown>, fields: readonly string[], label: string): void {
  if (Object.keys(value).length !== fields.length || fields.some((field) => !Object.hasOwn(value, field))) {
    throw new Error(`${label} fields are invalid`);
  }
}
