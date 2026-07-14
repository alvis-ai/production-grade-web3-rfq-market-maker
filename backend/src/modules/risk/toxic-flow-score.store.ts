import type { Address } from "../../shared/types/rfq.js";
import { isCanonicalUtcIsoTimestamp } from "../../shared/validation/timestamp.js";

export interface ToxicFlowScoreKey {
  chainId: number;
  user: Address;
}

export interface ToxicFlowScoreState extends ToxicFlowScoreKey {
  scoreBps: number;
  postTradeDriftBps: number;
  sampleSize: number;
  windowSeconds: number;
  policyVersion: string;
  observedAt: string;
  version: number;
  updatedBy: string;
  updatedAt: string;
}

export interface UpdateToxicFlowScoreInput {
  scoreBps: number;
  postTradeDriftBps: number;
  sampleSize: number;
  windowSeconds: number;
  policyVersion: string;
  observedAt: string;
  expectedVersion: number;
}

export interface ToxicFlowScoreStore {
  checkHealth(): Promise<void> | void;
  getScore(key: ToxicFlowScoreKey): Promise<ToxicFlowScoreState | null>;
  updateScore(
    key: ToxicFlowScoreKey,
    input: UpdateToxicFlowScoreInput,
    actor: string,
  ): Promise<ToxicFlowScoreState>;
}

export class ToxicFlowScoreConflictError extends Error {
  constructor() {
    super("Toxic flow score version conflict");
    this.name = "ToxicFlowScoreConflictError";
  }
}

const keyFields = ["chainId", "user"] as const;
const updateFields = [
  "scoreBps",
  "postTradeDriftBps",
  "sampleSize",
  "windowSeconds",
  "policyVersion",
  "observedAt",
  "expectedVersion",
] as const;
const stateFields = [
  ...keyFields,
  "scoreBps",
  "postTradeDriftBps",
  "sampleSize",
  "windowSeconds",
  "policyVersion",
  "observedAt",
  "version",
  "updatedBy",
  "updatedAt",
] as const;
const addressPattern = /^0x[a-fA-F0-9]{40}$/;
const safeIdentifierPattern = /^[A-Za-z0-9_:-]+$/;
const maxPolicyVersionLength = 128;
const maxActorLength = 256;
const maxWindowSeconds = 604_800;

export class InMemoryToxicFlowScoreStore implements ToxicFlowScoreStore {
  private readonly scores = new Map<string, ToxicFlowScoreState>();

  constructor(private readonly now: () => number = Date.now) {
    if (typeof now !== "function") throw new Error("Toxic flow score clock dependency must be a function");
    timestampFromClock(this.now);
  }

  checkHealth(): void {
    timestampFromClock(this.now);
  }

  async getScore(key: ToxicFlowScoreKey): Promise<ToxicFlowScoreState | null> {
    const normalizedKey = normalizeToxicFlowScoreKey(key);
    const state = this.scores.get(scoreKey(normalizedKey));
    return state ? { ...state } : null;
  }

  async updateScore(
    key: ToxicFlowScoreKey,
    input: UpdateToxicFlowScoreInput,
    actor: string,
  ): Promise<ToxicFlowScoreState> {
    const normalizedKey = normalizeToxicFlowScoreKey(key);
    const normalizedInput = normalizeToxicFlowScoreUpdate(input);
    assertToxicFlowScoreActor(actor);
    const mapKey = scoreKey(normalizedKey);
    const current = this.scores.get(mapKey);
    const currentVersion = current?.version ?? 0;
    if (currentVersion !== normalizedInput.expectedVersion) throw new ToxicFlowScoreConflictError();
    const state = {
      ...normalizedKey,
      scoreBps: normalizedInput.scoreBps,
      postTradeDriftBps: normalizedInput.postTradeDriftBps,
      sampleSize: normalizedInput.sampleSize,
      windowSeconds: normalizedInput.windowSeconds,
      policyVersion: normalizedInput.policyVersion,
      observedAt: normalizedInput.observedAt,
      version: currentVersion + 1,
      updatedBy: actor,
      updatedAt: timestampFromClock(this.now),
    };
    assertToxicFlowScoreState(state);
    this.scores.set(mapKey, state);
    return { ...state };
  }
}

export function normalizeToxicFlowScoreKey(value: unknown): ToxicFlowScoreKey {
  assertRecord(value, "Toxic flow score key");
  assertExactFields(value, keyFields, "Toxic flow score key");
  if (!Number.isSafeInteger(value.chainId) || Number(value.chainId) <= 0) {
    throw new Error("Toxic flow score chainId must be a positive safe integer");
  }
  if (typeof value.user !== "string" || !addressPattern.test(value.user)) {
    throw new Error("Toxic flow score user must be a 20-byte address");
  }
  return {
    chainId: Number(value.chainId),
    user: value.user.toLowerCase() as Address,
  };
}

export function normalizeToxicFlowScoreUpdate(value: unknown): UpdateToxicFlowScoreInput {
  assertRecord(value, "Toxic flow score update");
  assertExactFields(value, updateFields, "Toxic flow score update");
  assertBps(value.scoreBps, "scoreBps");
  if (!Number.isSafeInteger(value.postTradeDriftBps) ||
      Number(value.postTradeDriftBps) < -10_000 || Number(value.postTradeDriftBps) > 10_000) {
    throw new Error("Toxic flow score postTradeDriftBps must be an integer from -10000 to 10000");
  }
  assertPositiveSafeInteger(value.sampleSize, "sampleSize");
  assertPositiveSafeInteger(value.windowSeconds, "windowSeconds");
  if (Number(value.windowSeconds) > maxWindowSeconds) {
    throw new Error(`Toxic flow score windowSeconds must not exceed ${maxWindowSeconds}`);
  }
  assertSafeIdentifier(value.policyVersion, "policyVersion", maxPolicyVersionLength);
  if (typeof value.observedAt !== "string" || !isCanonicalUtcIsoTimestamp(value.observedAt)) {
    throw new Error("Toxic flow score observedAt must be a canonical UTC timestamp");
  }
  if (!Number.isSafeInteger(value.expectedVersion) || Number(value.expectedVersion) < 0) {
    throw new Error("Toxic flow score expectedVersion must be a non-negative safe integer");
  }
  return {
    scoreBps: Number(value.scoreBps),
    postTradeDriftBps: Number(value.postTradeDriftBps),
    sampleSize: Number(value.sampleSize),
    windowSeconds: Number(value.windowSeconds),
    policyVersion: String(value.policyVersion),
    observedAt: value.observedAt,
    expectedVersion: Number(value.expectedVersion),
  };
}

export function assertToxicFlowScoreState(value: unknown): asserts value is ToxicFlowScoreState {
  assertRecord(value, "Toxic flow score state");
  assertExactFields(value, stateFields, "Toxic flow score state");
  const key = normalizeToxicFlowScoreKey({ chainId: value.chainId, user: value.user });
  if (value.user !== key.user) throw new Error("Toxic flow score state user must be normalized");
  normalizeToxicFlowScoreUpdate({
    scoreBps: value.scoreBps,
    postTradeDriftBps: value.postTradeDriftBps,
    sampleSize: value.sampleSize,
    windowSeconds: value.windowSeconds,
    policyVersion: value.policyVersion,
    observedAt: value.observedAt,
    expectedVersion: value.version,
  });
  if (Number(value.version) < 1) throw new Error("Toxic flow score state version must be positive");
  assertToxicFlowScoreActor(value.updatedBy);
  if (typeof value.updatedAt !== "string" || !isCanonicalUtcIsoTimestamp(value.updatedAt)) {
    throw new Error("Toxic flow score state updatedAt must be a canonical UTC timestamp");
  }
}

export function assertToxicFlowScoreStore(value: unknown): asserts value is ToxicFlowScoreStore {
  assertRecord(value, "Toxic flow score store");
  for (const method of ["checkHealth", "getScore", "updateScore"] as const) {
    if (typeof value[method] !== "function") throw new Error(`Toxic flow score store.${method} must be a function`);
  }
}

export function assertToxicFlowScoreActor(value: unknown): asserts value is string {
  assertSafeIdentifier(value, "actor", maxActorLength);
}

function assertBps(value: unknown, field: string): void {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 10_000) {
    throw new Error(`Toxic flow score ${field} must be an integer from 0 to 10000`);
  }
}

function assertPositiveSafeInteger(value: unknown, field: string): void {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new Error(`Toxic flow score ${field} must be a positive safe integer`);
  }
}

function assertSafeIdentifier(value: unknown, field: string, maxLength: number): void {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength ||
      !safeIdentifierPattern.test(value)) {
    throw new Error(`Toxic flow score ${field} must be a safe identifier no longer than ${maxLength} characters`);
  }
}

function timestampFromClock(now: () => number): string {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Toxic flow score clock must return a non-negative safe integer timestamp");
  }
  return new Date(value).toISOString();
}

function scoreKey(key: ToxicFlowScoreKey): string {
  return `${key.chainId}:${key.user}`;
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
