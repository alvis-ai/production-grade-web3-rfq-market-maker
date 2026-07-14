import { isCanonicalUtcIsoTimestamp } from "../../shared/validation/timestamp.js";
import type { Address } from "../../shared/types/rfq.js";

export interface QuoteControlState {
  paused: boolean;
  version: number;
  reason: string | null;
  updatedBy: string;
  updatedAt: string;
}

export interface UpdateQuoteControlInput {
  paused: boolean;
  reason: string;
  expectedVersion: number;
}

export interface PairQuoteControlScope {
  chainId: number;
  tokenLow: Address;
  tokenHigh: Address;
}

export interface PairQuoteControlState extends QuoteControlState, PairQuoteControlScope {}

export interface QuoteControlStore {
  checkHealth(): Promise<void> | void;
  getState(): Promise<QuoteControlState>;
  updateState(input: UpdateQuoteControlInput, actor: string): Promise<QuoteControlState>;
  getPairState(scope: PairQuoteControlScope): Promise<PairQuoteControlState | null>;
  getPausedPairCount(): Promise<number>;
  updatePairState(
    scope: PairQuoteControlScope,
    input: UpdateQuoteControlInput,
    actor: string,
  ): Promise<PairQuoteControlState>;
}

export class QuoteControlConflictError extends Error {
  constructor() {
    super("Quote control version conflict");
    this.name = "QuoteControlConflictError";
  }
}

const stateFields = ["paused", "version", "reason", "updatedBy", "updatedAt"] as const;
const pairStateFields = ["chainId", "tokenLow", "tokenHigh", ...stateFields] as const;
const pairScopeFields = ["chainId", "tokenLow", "tokenHigh"] as const;
const updateFields = ["paused", "reason", "expectedVersion"] as const;
const addressPattern = /^0x[a-fA-F0-9]{40}$/;
const actorPattern = /^[A-Za-z0-9_:-]+$/;
const maxActorLength = 256;
const maxReasonLength = 256;

export class InMemoryQuoteControlStore implements QuoteControlStore {
  private state: QuoteControlState;
  private readonly pairStates = new Map<string, PairQuoteControlState>();

  constructor(private readonly now: () => number = Date.now) {
    if (typeof now !== "function") throw new Error("Quote control clock dependency must be a function");
    this.state = {
      paused: false,
      version: 0,
      reason: null,
      updatedBy: "system",
      updatedAt: timestampFromClock(this.now),
    };
  }

  checkHealth(): void {
    timestampFromClock(this.now);
  }

  async getState(): Promise<QuoteControlState> {
    return { ...this.state };
  }

  async updateState(input: UpdateQuoteControlInput, actor: string): Promise<QuoteControlState> {
    const normalized = normalizeQuoteControlUpdate(input);
    assertQuoteControlActor(actor);
    if (normalized.expectedVersion !== this.state.version) throw new QuoteControlConflictError();
    this.state = {
      paused: normalized.paused,
      version: this.state.version + 1,
      reason: normalized.reason,
      updatedBy: actor,
      updatedAt: timestampFromClock(this.now),
    };
    return { ...this.state };
  }

  async getPairState(scope: PairQuoteControlScope): Promise<PairQuoteControlState | null> {
    const normalizedScope = normalizePairQuoteControlScope(scope);
    const state = this.pairStates.get(pairScopeKey(normalizedScope));
    return state ? { ...state } : null;
  }

  async getPausedPairCount(): Promise<number> {
    let count = 0;
    for (const state of this.pairStates.values()) {
      if (state.paused) count += 1;
    }
    return count;
  }

  async updatePairState(
    scope: PairQuoteControlScope,
    input: UpdateQuoteControlInput,
    actor: string,
  ): Promise<PairQuoteControlState> {
    const normalizedScope = normalizePairQuoteControlScope(scope);
    const normalized = normalizeQuoteControlUpdate(input);
    assertQuoteControlActor(actor);
    const key = pairScopeKey(normalizedScope);
    const current = this.pairStates.get(key);
    const currentVersion = current?.version ?? 0;
    if (normalized.expectedVersion !== currentVersion) throw new QuoteControlConflictError();
    const state = {
      ...normalizedScope,
      paused: normalized.paused,
      version: currentVersion + 1,
      reason: normalized.reason,
      updatedBy: actor,
      updatedAt: timestampFromClock(this.now),
    };
    this.pairStates.set(key, state);
    return { ...state };
  }
}

export function normalizePairQuoteControlScope(value: unknown): PairQuoteControlScope {
  assertRecord(value, "Pair quote control scope");
  assertExactFields(value, pairScopeFields, "Pair quote control scope");
  const chainId = normalizeChainId(value.chainId);
  const first = normalizeAddress(value.tokenLow, "tokenLow");
  const second = normalizeAddress(value.tokenHigh, "tokenHigh");
  if (first === second) throw new Error("Pair quote control tokens must be distinct");
  const [tokenLow, tokenHigh] = first < second ? [first, second] : [second, first];
  return { chainId, tokenLow, tokenHigh };
}

export function pairQuoteControlScope(
  chainId: number,
  tokenA: Address,
  tokenB: Address,
): PairQuoteControlScope {
  return normalizePairQuoteControlScope({ chainId, tokenLow: tokenA, tokenHigh: tokenB });
}

export function normalizeQuoteControlUpdate(value: unknown): UpdateQuoteControlInput {
  assertRecord(value, "Quote control update");
  assertExactFields(value, updateFields, "Quote control update");
  if (typeof value.paused !== "boolean") throw new Error("Quote control paused must be a boolean");
  if (typeof value.reason !== "string") throw new Error("Quote control reason must be a primitive string");
  const reason = value.reason.trim();
  if (reason.length === 0 || reason.length > maxReasonLength || /[\p{Cc}]/u.test(reason)) {
    throw new Error(`Quote control reason must contain 1-${maxReasonLength} printable characters`);
  }
  if (!Number.isSafeInteger(value.expectedVersion) || Number(value.expectedVersion) < 0) {
    throw new Error("Quote control expectedVersion must be a non-negative safe integer");
  }
  return {
    paused: value.paused,
    reason,
    expectedVersion: Number(value.expectedVersion),
  };
}

export function assertQuoteControlState(value: unknown): asserts value is QuoteControlState {
  assertRecord(value, "Quote control state");
  assertExactFields(value, stateFields, "Quote control state");
  if (typeof value.paused !== "boolean") throw new Error("Quote control state paused must be a boolean");
  if (!Number.isSafeInteger(value.version) || Number(value.version) < 0) {
    throw new Error("Quote control state version must be a non-negative safe integer");
  }
  if (value.reason !== null) {
    if (typeof value.reason !== "string" || value.reason.length === 0 ||
        value.reason.length > maxReasonLength || /[\p{Cc}]/u.test(value.reason)) {
      throw new Error("Quote control state reason is invalid");
    }
  }
  if (value.paused && value.reason === null) throw new Error("Paused quote control state must include a reason");
  assertQuoteControlActor(value.updatedBy);
  if (typeof value.updatedAt !== "string" || !isCanonicalUtcIsoTimestamp(value.updatedAt)) {
    throw new Error("Quote control state updatedAt must be a canonical UTC timestamp");
  }
}

export function assertPairQuoteControlState(value: unknown): asserts value is PairQuoteControlState {
  assertRecord(value, "Pair quote control state");
  assertExactFields(value, pairStateFields, "Pair quote control state");
  if (!Number.isSafeInteger(value.version) || Number(value.version) < 1) {
    throw new Error("Pair quote control state version must be a positive safe integer");
  }
  const normalizedScope = normalizePairQuoteControlScope({
    chainId: value.chainId,
    tokenLow: value.tokenLow,
    tokenHigh: value.tokenHigh,
  });
  if (value.tokenLow !== normalizedScope.tokenLow || value.tokenHigh !== normalizedScope.tokenHigh) {
    throw new Error("Pair quote control state tokens must be normalized");
  }
  assertQuoteControlState({
    paused: value.paused,
    version: value.version,
    reason: value.reason,
    updatedBy: value.updatedBy,
    updatedAt: value.updatedAt,
  });
}

export function assertQuoteControlStore(value: unknown): asserts value is QuoteControlStore {
  assertRecord(value, "Quote control store");
  for (const method of [
    "checkHealth",
    "getState",
    "updateState",
    "getPairState",
    "getPausedPairCount",
    "updatePairState",
  ] as const) {
    if (typeof value[method] !== "function") throw new Error(`Quote control store.${method} must be a function`);
  }
}

function normalizeChainId(value: unknown): number {
  const normalized = typeof value === "string" && /^[1-9][0-9]*$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(normalized) || Number(normalized) <= 0) {
    throw new Error("Pair quote control chainId must be a positive safe integer");
  }
  return Number(normalized);
}

function normalizeAddress(value: unknown, field: string): Address {
  if (typeof value !== "string" || !addressPattern.test(value)) {
    throw new Error(`Pair quote control ${field} must be a 20-byte address`);
  }
  return value.toLowerCase() as Address;
}

function pairScopeKey(scope: PairQuoteControlScope): string {
  return `${scope.chainId}:${scope.tokenLow}:${scope.tokenHigh}`;
}

export function assertQuoteControlActor(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxActorLength || !actorPattern.test(value)) {
    throw new Error(`Quote control actor must be a safe identifier no longer than ${maxActorLength} characters`);
  }
}

function timestampFromClock(now: () => number): string {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Quote control clock must return a non-negative safe integer timestamp");
  }
  return new Date(value).toISOString();
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`);
}

function assertExactFields(value: Record<string, unknown>, fields: readonly string[], label: string): void {
  const allowed = new Set(fields);
  if (Object.keys(value).length !== fields.length || Object.keys(value).some((field) => !allowed.has(field))) {
    throw new Error(`${label} fields are invalid`);
  }
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) throw new Error(`${label}.${field} must be an own field`);
  }
}
