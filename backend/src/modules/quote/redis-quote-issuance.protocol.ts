import type { QuoteResponse, SignedQuote } from "../../shared/types/rfq.js";
import { assertPrincipalId } from "../../shared/validation/principal-id.js";
import { isCanonicalUtcIsoTimestamp } from "../../shared/validation/timestamp.js";
import {
  assertRiskDecisionInput,
  assertRiskDecisionRecord,
  type RiskDecisionRecord,
  type SaveRiskDecisionInput,
} from "../risk/risk-decision.repository.js";
import {
  assertQuoteIdempotencyFailure,
  assertQuoteIdempotencyKey,
  assertQuoteResponse,
  type QuoteIdempotencyFailure,
} from "./quote-idempotency.store.js";
import type {
  FinalizeQuoteIssuanceInput,
  PrepareQuoteIssuanceInput,
  QuoteSigningAuthorization,
} from "./quote-issuance.store.js";
import {
  assertQuoteIssuanceFinalization,
  assertQuoteIssuancePreparation,
} from "./postgres-quote-issuance.store.js";
import {
  assertSignerQuoteCommitContext,
  quoteSigningAuthorizationHash,
} from "../signer/signer-quote-commit.js";

export type RedisQuoteIssuanceEventType = "prepared" | "authorized" | "finalized" | "failed";
export type RedisQuoteIssuanceStage = Exclude<RedisQuoteIssuanceEventType, "failed"> | "failed";

export interface RedisQuoteIdempotencyRecord {
  schemaVersion: 1;
  principalId: string;
  key: string;
  requestHash: string;
  state: "processing" | "succeeded" | "failed";
  createdAtMs: number;
  updatedAtMs: number;
  ownerToken?: string;
  leaseExpiresAtMs?: number;
  quoteId?: string;
  response?: QuoteResponse;
  error?: QuoteIdempotencyFailure;
}

export interface RedisQuoteIssuanceRecord {
  schemaVersion: 1;
  quoteId: string;
  principalId: string;
  stage: RedisQuoteIssuanceStage;
  preparationHash: string;
  preparation: Omit<PrepareQuoteIssuanceInput, "idempotency">;
  preparedAtMs: number;
  updatedAtMs: number;
  authorizationHash?: string;
  authorization?: {
    input: SaveRiskDecisionInput;
    record: RiskDecisionRecord;
    signingAuthorization?: QuoteSigningAuthorization;
    signingAuthorizationHash?: string;
  };
  finalizationHash?: string;
  finalization?: Omit<FinalizeQuoteIssuanceInput, "idempotency">;
  signerAuditEventKey?: string;
  failure?: QuoteIdempotencyFailure;
}

export interface RedisQuoteIssuanceEvent {
  schemaVersion: 1;
  eventType: RedisQuoteIssuanceEventType;
  occurredAtMs: number;
  quote?: RedisQuoteIssuanceRecord;
  idempotency?: RedisQuoteIdempotencyRecord;
}

export interface RedisQuoteIssuanceClient {
  readonly status?: string;
  connect?: () => Promise<unknown>;
  disconnect?: () => void;
  eval(script: string, numberOfKeys: number, ...args: Array<string | number>): Promise<unknown>;
  get(key: string): Promise<unknown>;
  ping(): Promise<unknown>;
  info(section: string): Promise<unknown>;
  xlen(key: string): Promise<unknown>;
  wait(replicas: number, timeoutMs: number): Promise<unknown>;
  quit(): Promise<unknown>;
}

export interface RedisQuoteIssuanceConfig {
  keyPrefix: string;
  ledgerEpoch: string;
  allowEpochInitialization: boolean;
  maxBacklog: number;
  leaseMs: number;
  hotStateTtlMs: number;
  idempotencyTtlMs: number;
  minReplicaAcks: number;
  replicaAckTimeoutMs: number;
  requireAof: boolean;
  projectionWaitTimeoutMs: number;
  projectionPollIntervalMs: number;
}

export interface RedisQuoteIssuanceObservation {
  eventType: RedisQuoteIssuanceEventType;
  duplicate: boolean;
  backlog: number;
}

export interface RedisQuoteIssuanceObserver {
  recordIssuanceMutation(observation: RedisQuoteIssuanceObservation): void;
  recordIssuanceFailure(reason: "backlog_full" | "replica_ack" | "state_invalid" | "projection_timeout"): void;
  recordIssuanceBacklog(backlog: number): void;
}

export const noopRedisQuoteIssuanceObserver: RedisQuoteIssuanceObserver = {
  recordIssuanceMutation() {},
  recordIssuanceFailure() {},
  recordIssuanceBacklog() {},
};

export function normalizeRedisQuoteIssuanceConfig(
  config: RedisQuoteIssuanceConfig,
): RedisQuoteIssuanceConfig {
  assertRecord(config, "Redis quote issuance config");
  const fields = [
    "keyPrefix", "ledgerEpoch", "allowEpochInitialization", "maxBacklog", "leaseMs", "hotStateTtlMs",
    "idempotencyTtlMs", "minReplicaAcks", "replicaAckTimeoutMs", "requireAof",
    "projectionWaitTimeoutMs", "projectionPollIntervalMs",
  ];
  assertExactFields(config, fields, "Redis quote issuance config");
  if (typeof config.keyPrefix !== "string" ||
      !/^rfq:\{[a-z0-9_-]{1,32}\}:[a-z0-9:_-]{1,48}$/.test(config.keyPrefix)) {
    throw new Error("Redis quote issuance keyPrefix must use a bounded rfq:{hash-tag}: key");
  }
  if (typeof config.ledgerEpoch !== "string" ||
      !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(config.ledgerEpoch)) {
    throw new Error("Redis quote issuance ledgerEpoch must be a safe epoch identifier");
  }
  if (typeof config.allowEpochInitialization !== "boolean" || typeof config.requireAof !== "boolean") {
    throw new Error("Redis quote issuance boolean config is invalid");
  }
  assertInteger(config.maxBacklog, 1, 1_000_000, "maxBacklog");
  assertInteger(config.leaseMs, 10_000, 3_900_000, "leaseMs");
  assertInteger(config.hotStateTtlMs, 60_000, 604_800_000, "hotStateTtlMs");
  assertInteger(config.idempotencyTtlMs, config.hotStateTtlMs, 2_592_000_000, "idempotencyTtlMs");
  assertInteger(config.minReplicaAcks, 0, 5, "minReplicaAcks");
  assertInteger(config.replicaAckTimeoutMs, 1, 5_000, "replicaAckTimeoutMs");
  assertInteger(config.projectionWaitTimeoutMs, 1, 30_000, "projectionWaitTimeoutMs");
  assertInteger(config.projectionPollIntervalMs, 1, 1_000, "projectionPollIntervalMs");
  if (config.projectionPollIntervalMs > config.projectionWaitTimeoutMs) {
    throw new Error("Redis quote issuance projection poll interval cannot exceed wait timeout");
  }
  return { ...config };
}

export function parseRedisQuoteIssuanceRecord(payload: string): RedisQuoteIssuanceRecord {
  const value = parseJsonObject(payload, "Redis quote issuance payload");
  const required = [
    "schemaVersion", "quoteId", "principalId", "stage", "preparationHash", "preparation",
    "preparedAtMs", "updatedAtMs",
  ];
  const optional = [
    "authorizationHash", "authorization", "finalizationHash", "finalization", "signerAuditEventKey", "failure",
  ];
  assertExactFields(value, required, "Redis quote issuance payload", optional);
  if (value.schemaVersion !== 1 ||
      !["prepared", "authorized", "finalized", "failed"].includes(String(value.stage))) {
    throw new Error("Redis quote issuance metadata is invalid");
  }
  assertSafeIdentifier(value.quoteId, "Redis quote issuance quoteId");
  assertPrincipalId(value.principalId, "Redis quote issuance principalId");
  assertSha256(value.preparationHash, "Redis quote issuance preparationHash");
  assertTimestampMs(value.preparedAtMs, "Redis quote issuance preparedAtMs");
  assertTimestampMs(value.updatedAtMs, "Redis quote issuance updatedAtMs");
  if ((value.updatedAtMs as number) < (value.preparedAtMs as number)) {
    throw new Error("Redis quote issuance updatedAtMs cannot precede preparedAtMs");
  }
  assertQuoteIssuancePreparation(value.preparation as PrepareQuoteIssuanceInput);
  const preparation = value.preparation as PrepareQuoteIssuanceInput;
  if (preparation.requestedQuote.quoteId !== value.quoteId ||
      preparation.requestedQuote.principalId !== value.principalId) {
    throw new Error("Redis quote issuance preparation identity is invalid");
  }

  if (value.authorization !== undefined) {
    assertRecord(value.authorization, "Redis quote issuance authorization");
    assertExactFields(
      value.authorization,
      ["input", "record"],
      "Redis quote issuance authorization",
      ["signingAuthorization", "signingAuthorizationHash"],
    );
    const authorizationInput = value.authorization.input as SaveRiskDecisionInput;
    assertRiskDecisionInput(authorizationInput);
    assertRiskDecisionRecord(value.authorization.record as RiskDecisionRecord, authorizationInput);
    if (authorizationInput.quoteId !== value.quoteId) {
      throw new Error("Redis quote issuance authorization quoteId is invalid");
    }
    assertSha256(value.authorizationHash, "Redis quote issuance authorizationHash");
    const signingAuthorization = value.authorization.signingAuthorization;
    if (signingAuthorization !== undefined) {
      assertQuoteSigningAuthorization(signingAuthorization);
      assertSha256(
        value.authorization.signingAuthorizationHash,
        "Redis quote issuance signingAuthorizationHash",
      );
      if (value.authorization.signingAuthorizationHash !==
          quoteSigningAuthorizationHash(signingAuthorization, signingAuthorization.commit)) {
        throw new Error("Redis quote issuance signing authorization hash is invalid");
      }
    } else if (value.authorization.signingAuthorizationHash !== undefined) {
      throw new Error("Redis quote issuance signing authorization hash has no authorization");
    }
  } else if (value.authorizationHash !== undefined) {
    throw new Error("Redis quote issuance authorization hash has no authorization");
  }

  if (value.finalization !== undefined) {
    assertQuoteIssuanceFinalization(value.finalization as FinalizeQuoteIssuanceInput);
    const finalization = value.finalization as FinalizeQuoteIssuanceInput;
    if (finalization.signedQuote.quoteId !== value.quoteId ||
        finalization.signedQuote.principalId !== value.principalId) {
      throw new Error("Redis quote issuance finalization identity is invalid");
    }
    assertSha256(value.finalizationHash, "Redis quote issuance finalizationHash");
    if (value.signerAuditEventKey !== undefined) {
      assertSha256(value.signerAuditEventKey, "Redis quote issuance signerAuditEventKey");
    }
  } else if (value.finalizationHash !== undefined) {
    throw new Error("Redis quote issuance finalization hash has no finalization");
  } else if (value.signerAuditEventKey !== undefined) {
    throw new Error("Redis quote issuance signer audit key has no finalization");
  }
  if (value.failure !== undefined) assertQuoteIdempotencyFailure(value.failure);

  const stage = value.stage as RedisQuoteIssuanceStage;
  if (stage === "prepared" && (value.authorization !== undefined || value.finalization !== undefined || value.failure !== undefined)) {
    throw new Error("Redis quote issuance prepared stage contains later state");
  }
  if (stage === "authorized" && (value.authorization === undefined || value.finalization !== undefined || value.failure !== undefined)) {
    throw new Error("Redis quote issuance authorized stage is incomplete");
  }
  if (stage === "finalized" && (value.authorization === undefined || value.finalization === undefined || value.failure !== undefined)) {
    throw new Error("Redis quote issuance finalized stage is incomplete");
  }
  if (stage === "failed" && value.failure === undefined) {
    throw new Error("Redis quote issuance failed stage has no failure");
  }
  return value as unknown as RedisQuoteIssuanceRecord;
}

export function assertQuoteSigningAuthorization(
  value: unknown,
): asserts value is QuoteSigningAuthorization {
  assertRecord(value, "Redis quote signing authorization");
  assertExactFields(
    value,
    ["quote", "quoteId", "snapshotId", "commit"],
    "Redis quote signing authorization",
  );
  assertSignerQuoteCommitContext(value.commit, {
    quote: value.quote as SignedQuote,
    quoteId: value.quoteId as string,
    snapshotId: value.snapshotId as string,
  });
}

export function parseRedisQuoteIdempotencyRecord(payload: string): RedisQuoteIdempotencyRecord {
  const value = parseJsonObject(payload, "Redis quote idempotency payload");
  const required = [
    "schemaVersion", "principalId", "key", "requestHash", "state", "createdAtMs", "updatedAtMs",
  ];
  const optional = ["ownerToken", "leaseExpiresAtMs", "quoteId", "response", "error"];
  assertExactFields(value, required, "Redis quote idempotency payload", optional);
  if (value.schemaVersion !== 1 || !["processing", "succeeded", "failed"].includes(String(value.state))) {
    throw new Error("Redis quote idempotency metadata is invalid");
  }
  assertPrincipalId(value.principalId, "Redis quote idempotency principalId");
  assertQuoteIdempotencyKey(value.key);
  assertSha256(value.requestHash, "Redis quote idempotency requestHash");
  assertTimestampMs(value.createdAtMs, "Redis quote idempotency createdAtMs");
  assertTimestampMs(value.updatedAtMs, "Redis quote idempotency updatedAtMs");
  if ((value.updatedAtMs as number) < (value.createdAtMs as number)) {
    throw new Error("Redis quote idempotency updatedAtMs cannot precede createdAtMs");
  }
  if (value.quoteId !== undefined) assertSafeIdentifier(value.quoteId, "Redis quote idempotency quoteId");
  const state = value.state as RedisQuoteIdempotencyRecord["state"];
  if (state === "processing") {
    assertSafeIdentifier(value.ownerToken, "Redis quote idempotency ownerToken");
    assertTimestampMs(value.leaseExpiresAtMs, "Redis quote idempotency leaseExpiresAtMs");
    if ((value.leaseExpiresAtMs as number) <= (value.createdAtMs as number) ||
        value.response !== undefined || value.error !== undefined) {
      throw new Error("Redis quote idempotency processing state is invalid");
    }
  } else if (value.ownerToken !== undefined || value.leaseExpiresAtMs !== undefined) {
    throw new Error("Redis quote idempotency terminal state retains lease ownership");
  }
  if (state === "succeeded") {
    assertQuoteResponse(value.response);
    if (value.quoteId !== (value.response as QuoteResponse).quoteId || value.error !== undefined) {
      throw new Error("Redis quote idempotency succeeded state is invalid");
    }
  } else if (value.response !== undefined) {
    throw new Error("Redis quote idempotency non-success state contains a response");
  }
  if (state === "failed") {
    assertQuoteIdempotencyFailure(value.error);
  } else if (value.error !== undefined) {
    throw new Error("Redis quote idempotency non-failed state contains an error");
  }
  return value as unknown as RedisQuoteIdempotencyRecord;
}

export function parseRedisQuoteIssuanceEvent(payload: string): RedisQuoteIssuanceEvent {
  const value = parseJsonObject(payload, "Redis quote issuance event");
  assertExactFields(
    value,
    ["schemaVersion", "eventType", "occurredAtMs"],
    "Redis quote issuance event",
    ["quote", "idempotency"],
  );
  if (value.schemaVersion !== 1 ||
      !["prepared", "authorized", "finalized", "failed"].includes(String(value.eventType))) {
    throw new Error("Redis quote issuance event metadata is invalid");
  }
  assertTimestampMs(value.occurredAtMs, "Redis quote issuance event occurredAtMs");
  const quote = value.quote === undefined
    ? undefined
    : parseRedisQuoteIssuanceRecord(JSON.stringify(value.quote));
  const idempotency = value.idempotency === undefined
    ? undefined
    : parseRedisQuoteIdempotencyRecord(JSON.stringify(value.idempotency));
  if (!quote && !idempotency) throw new Error("Redis quote issuance event has no state");
  if (quote && value.eventType !== quote.stage) {
    throw new Error("Redis quote issuance event type does not match quote stage");
  }
  if (quote && idempotency?.quoteId !== undefined && idempotency.quoteId !== quote.quoteId) {
    throw new Error("Redis quote issuance event identities do not match");
  }
  return {
    schemaVersion: 1,
    eventType: value.eventType as RedisQuoteIssuanceEventType,
    occurredAtMs: value.occurredAtMs as number,
    ...(quote ? { quote } : {}),
    ...(idempotency ? { idempotency } : {}),
  };
}

export function quoteRecordToSignedQuote(record: RedisQuoteIssuanceRecord): SignedQuote | undefined {
  return record.finalization?.signedQuote.quote;
}

export function assertRedisAofHealth(info: unknown): void {
  if (typeof info !== "string") throw new Error("Redis quote issuance persistence info is invalid");
  const fields = new Map<string, string>();
  for (const line of info.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf(":");
    if (separator > 0) fields.set(line.slice(0, separator), line.slice(separator + 1));
  }
  if (fields.get("aof_enabled") !== "1" || fields.get("aof_last_write_status") !== "ok") {
    throw new Error("Redis quote issuance AOF is not healthy");
  }
}

function parseJsonObject(payload: string, label: string): Record<string, unknown> {
  let value: unknown;
  try { value = JSON.parse(payload); } catch {
    throw new Error(`${label} must be valid JSON`);
  }
  assertRecord(value, label);
  return value;
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function assertExactFields(
  value: Record<string, unknown>,
  required: readonly string[],
  label: string,
  optional: readonly string[] = [],
): void {
  const allowed = new Set([...required, ...optional]);
  if (required.some((field) => !Object.prototype.hasOwnProperty.call(value, field)) ||
      Object.keys(value).some((field) => !allowed.has(field))) {
    throw new Error(`${label} fields are invalid`);
  }
}

function assertTimestampMs(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0 ||
      !isCanonicalUtcIsoTimestamp(new Date(value as number).toISOString())) {
    throw new Error(`${label} must be a positive safe millisecond timestamp`);
  }
}

function assertInteger(value: unknown, min: number, max: number, field: string): void {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`Redis quote issuance ${field} must be between ${min} and ${max}`);
  }
}

function assertSha256(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest`);
  }
}

function assertSafeIdentifier(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.length < 1 || value.length > 128 ||
      !/^[A-Za-z0-9_:-]+$/.test(value)) {
    throw new Error(`${label} must be a safe identifier`);
  }
}
