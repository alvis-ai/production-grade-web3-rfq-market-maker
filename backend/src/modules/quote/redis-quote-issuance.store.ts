import { createHash, randomBytes } from "node:crypto";
import { Redis } from "ioredis";
import type { QuoteResponse, QuoteStatusResponse, SignedQuote } from "../../shared/types/rfq.js";
import { normalizeRedisUrl, type RedisUrlPolicy } from "../../shared/redis/redis-url.js";
import { assertPrincipalId } from "../../shared/validation/principal-id.js";
import {
  assertRiskDecisionRecord,
  assertRiskDecisionInput,
  type RiskDecisionRecord,
} from "../risk/risk-decision.repository.js";
import {
  assertQuoteIdempotencyFailure,
  assertQuoteIdempotencyKey,
  assertQuoteIdempotencyReservation,
  assertQuoteResponse,
  type QuoteIdempotencyClaimResult,
  type QuoteIdempotencyFailure,
  type QuoteIdempotencyReservation,
  type QuoteIdempotencyStore,
} from "./quote-idempotency.store.js";
import type {
  AuthorizeQuoteIssuanceInput,
  FinalizeQuoteIssuanceInput,
  PrepareQuoteIssuanceInput,
  QuoteIssuanceStore,
} from "./quote-issuance.store.js";
import {
  assertQuoteIssuanceFinalization,
  assertQuoteIssuancePreparation,
} from "./postgres-quote-issuance.store.js";
import {
  acquireQuoteIdempotencyScript,
  authorizeQuoteIssuanceScript,
  bindQuoteIdempotencyScript,
  completeQuoteIdempotencyScript,
  failQuoteIdempotencyScript,
  finalizeQuoteIssuanceScript,
  initializeQuoteIssuanceLedgerScript,
  prepareQuoteIssuanceScript,
} from "./redis-quote-issuance.scripts.js";
import {
  assertQuoteSigningAuthorization,
  assertRedisAofHealth,
  noopRedisQuoteIssuanceObserver,
  normalizeRedisQuoteIssuanceConfig,
  parseRedisQuoteIdempotencyRecord,
  parseRedisQuoteIssuanceRecord,
  type RedisQuoteIdempotencyRecord,
  type RedisQuoteIssuanceClient,
  type RedisQuoteIssuanceConfig,
  type RedisQuoteIssuanceEventType,
  type RedisQuoteIssuanceObserver,
  type RedisQuoteIssuanceRecord,
} from "./redis-quote-issuance.protocol.js";
import { quoteSigningAuthorizationHash } from "../signer/signer-quote-commit.js";

export type {
  RedisQuoteIssuanceClient,
  RedisQuoteIssuanceConfig,
  RedisQuoteIssuanceObserver,
} from "./redis-quote-issuance.protocol.js";

export function createRedisQuoteIssuanceClient(
  redisUrl: string,
  policy: RedisUrlPolicy = {},
): RedisQuoteIssuanceClient {
  const normalizedUrl = normalizeRedisUrl(redisUrl, policy);
  return new Redis(normalizedUrl, {
    connectTimeout: 2_000,
    enableOfflineQueue: false,
    enableReadyCheck: true,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy(attempt: number) {
      return attempt <= 3 ? Math.min(100 * 2 ** (attempt - 1), 1_000) : null;
    },
  }) as unknown as RedisQuoteIssuanceClient;
}

export class RedisQuoteIssuanceStore implements QuoteIssuanceStore, QuoteIdempotencyStore {
  readonly asynchronousProjection = true as const;
  private readonly config: RedisQuoteIssuanceConfig;
  private readonly observer: RedisQuoteIssuanceObserver;
  private connectPromise: Promise<void> | undefined;
  private initialized = false;

  constructor(
    private readonly client: RedisQuoteIssuanceClient,
    config: RedisQuoteIssuanceConfig,
    observer: RedisQuoteIssuanceObserver = noopRedisQuoteIssuanceObserver,
    private readonly nowMilliseconds: () => number = Date.now,
  ) {
    assertClient(client);
    this.config = normalizeRedisQuoteIssuanceConfig(config);
    assertObserver(observer);
    if (typeof nowMilliseconds !== "function") {
      throw new Error("Redis quote issuance nowMilliseconds must be a function");
    }
    this.observer = observer;
  }

  async initialize(): Promise<void> {
    await this.ensureConnected();
    const result = await this.client.eval(
      initializeQuoteIssuanceLedgerScript,
      1,
      this.key("epoch"),
      this.config.ledgerEpoch,
      this.config.allowEpochInitialization ? "1" : "0",
    );
    if (!Array.isArray(result) || result.length !== 2 ||
        !Number.isSafeInteger(result[0]) || typeof result[1] !== "string") {
      this.notifyFailure("state_invalid");
      throw new Error("Redis quote issuance epoch initialization returned malformed state");
    }
    if (result[0] === -1) {
      throw new Error("Redis quote issuance ledger is empty and requires an approved bootstrap");
    }
    if (result[0] !== 1 || result[1] !== this.config.ledgerEpoch) {
      throw new Error("Redis quote issuance ledger epoch does not match runtime configuration");
    }
    this.initialized = true;
  }

  async checkHealth(): Promise<void> {
    if (!this.initialized) await this.initialize();
    if (await this.client.ping() !== "PONG") {
      throw new Error("Redis quote issuance health check returned an unexpected response");
    }
    if (this.config.requireAof) assertRedisAofHealth(await this.client.info("persistence"));
    const backlog = parseNonNegativeInteger(await this.client.xlen(this.key("events")), "backlog");
    this.notifyBacklog(backlog);
    if (backlog >= this.config.maxBacklog) {
      throw new Error(`Redis quote issuance backlog reached ${this.config.maxBacklog}`);
    }
  }

  async acquire(principalId: string, key: string, requestHash: string): Promise<QuoteIdempotencyClaimResult> {
    assertPrincipalId(principalId, "Redis quote idempotency principalId");
    assertQuoteIdempotencyKey(key);
    assertSha256(requestHash, "Redis quote idempotency requestHash");
    if (!this.initialized) await this.initialize();
    const ownerToken = `quote_idem_${randomBytes(16).toString("hex")}`;
    const result = await this.client.eval(
      acquireQuoteIdempotencyScript,
      1,
      this.idempotencyKey(principalId, key),
      principalId,
      key,
      requestHash,
      ownerToken,
      this.leaseMs(),
      this.config.idempotencyTtlMs,
    );
    const parsed = parseStateResult(result, "idempotency acquire");
    if (parsed.code === 0) throw stateError("idempotency acquire", parsed.payload);
    if (parsed.code === 4) return { status: "conflict" };
    const state = parseRedisQuoteIdempotencyRecord(parsed.payload);
    if (parsed.code === 2) return { status: "replay", response: state.response! };
    if (parsed.code === 3) return { status: "failed", error: state.error! };
    if (parsed.code === 5) return { status: "in_progress" };
    if (parsed.code === 6) {
      const failure: QuoteIdempotencyFailure = {
        code: "QUOTE_FAILED",
        message: "Idempotent quote request expired before completion",
        statusCode: 409,
      };
      await this.fail(reservationFromState(state), failure);
      return { status: "failed", error: failure };
    }
    if (parsed.code !== 1 || state.state !== "processing") {
      throw new Error("Redis quote idempotency acquire returned an unsupported state");
    }
    return { status: "acquired", reservation: reservationFromState(state) };
  }

  async bindQuote(reservation: QuoteIdempotencyReservation, quoteId: string): Promise<void> {
    assertQuoteIdempotencyReservation(reservation);
    assertSafeIdentifier(quoteId, "Redis quote idempotency quoteId");
    if (!this.initialized) await this.initialize();
    const result = await this.client.eval(
      bindQuoteIdempotencyScript,
      1,
      this.idempotencyKey(reservation.principalId, reservation.key),
      reservation.principalId,
      reservation.requestHash,
      reservation.ownerToken,
      quoteId,
      this.now(),
      this.config.idempotencyTtlMs,
    );
    const parsed = parseStateResult(result, "idempotency binding");
    if (parsed.code !== 1) throw stateError("idempotency binding", parsed.payload);
    parseRedisQuoteIdempotencyRecord(parsed.payload);
    await this.requireReplicaAcknowledgements();
  }

  async complete(reservation: QuoteIdempotencyReservation, response: Parameters<QuoteIdempotencyStore["complete"]>[1]): Promise<void> {
    assertQuoteIdempotencyReservation(reservation);
    assertQuoteResponse(response);
    if (!this.initialized) await this.initialize();
    const result = await this.client.eval(
      completeQuoteIdempotencyScript,
      2,
      this.idempotencyKey(reservation.principalId, reservation.key),
      this.key("events"),
      reservation.principalId,
      reservation.requestHash,
      reservation.ownerToken,
      response.quoteId,
      JSON.stringify(response),
      this.now(),
      this.config.maxBacklog,
      this.config.idempotencyTtlMs,
    );
    const mutation = parseMutationResult(result, "idempotency completion");
    if (mutation.code !== 1 && mutation.code !== 2) throw mutationError("idempotency completion", mutation);
    parseRedisQuoteIdempotencyRecord(mutation.payload);
    await this.requireReplicaAcknowledgements();
    this.notifyMutation("finalized", mutation);
  }

  async fail(reservation: QuoteIdempotencyReservation, error: QuoteIdempotencyFailure): Promise<void> {
    assertQuoteIdempotencyReservation(reservation);
    assertQuoteIdempotencyFailure(error);
    if (!this.initialized) await this.initialize();
    const stateValue = await this.client.get(this.idempotencyKey(reservation.principalId, reservation.key));
    const state = typeof stateValue === "string" ? parseRedisQuoteIdempotencyRecord(stateValue) : undefined;
    const quoteId = state?.quoteId;
    const result = await this.client.eval(
      failQuoteIdempotencyScript,
      3,
      this.idempotencyKey(reservation.principalId, reservation.key),
      quoteId ? this.quoteKey(quoteId) : this.key("quote:none"),
      this.key("events"),
      reservation.principalId,
      reservation.requestHash,
      reservation.ownerToken,
      JSON.stringify(error),
      this.now(),
      this.config.maxBacklog,
      this.config.idempotencyTtlMs,
      this.config.hotStateTtlMs,
    );
    const mutation = parseMutationResult(result, "idempotency failure");
    if (mutation.code === 3) return;
    if (mutation.code !== 1 && mutation.code !== 2) throw mutationError("idempotency failure", mutation);
    parseRedisQuoteIdempotencyRecord(mutation.payload);
    await this.requireReplicaAcknowledgements();
    this.notifyMutation("failed", mutation);
  }

  async prepare(input: PrepareQuoteIssuanceInput): Promise<void> {
    assertQuoteIssuancePreparation(input);
    if (!this.initialized) await this.initialize();
    const now = this.now();
    const preparation = {
      marketSnapshot: input.marketSnapshot,
      requestedQuote: input.requestedQuote,
      routeDecision: input.routeDecision,
    };
    const preparationHash = digest(preparation);
    const record: RedisQuoteIssuanceRecord = {
      schemaVersion: 1,
      quoteId: input.requestedQuote.quoteId,
      principalId: input.requestedQuote.principalId,
      stage: "prepared",
      preparationHash,
      preparation,
      preparedAtMs: now,
      updatedAtMs: now,
    };
    parseRedisQuoteIssuanceRecord(JSON.stringify(record));
    const idempotencyKey = input.idempotency
      ? this.idempotencyKey(input.idempotency.principalId, input.idempotency.key)
      : this.key(`idempotency:none:${input.requestedQuote.quoteId}`);
    const result = await this.client.eval(
      prepareQuoteIssuanceScript,
      3,
      this.quoteKey(record.quoteId),
      idempotencyKey,
      this.key("events"),
      record.quoteId,
      record.principalId,
      preparationHash,
      JSON.stringify(record),
      now,
      this.config.maxBacklog,
      input.idempotency ? "1" : "0",
      input.idempotency?.requestHash ?? "",
      input.idempotency?.ownerToken ?? "",
      this.config.idempotencyTtlMs,
      this.config.hotStateTtlMs,
    );
    const mutation = parseMutationResult(result, "issuance preparation");
    if (mutation.code !== 1 && mutation.code !== 2) throw mutationError("issuance preparation", mutation);
    if (mutation.payload !== preparationHash) {
      throw new Error("Redis quote issuance preparation returned conflicting evidence");
    }
    await this.requireReplicaAcknowledgements();
    this.notifyMutation("prepared", mutation);
  }

  async authorize(input: AuthorizeQuoteIssuanceInput): Promise<RiskDecisionRecord> {
    const riskInput = { quoteId: input.quoteId, decision: input.decision };
    assertRiskDecisionInput(riskInput);
    if (input.signingAuthorization !== undefined) {
      assertQuoteSigningAuthorization(input.signingAuthorization);
      if (input.signingAuthorization.quoteId !== input.quoteId ||
          input.signingAuthorization.commit.riskPolicyVersion !== input.decision.policyVersion) {
        throw new Error("Redis quote issuance signing authorization does not match the risk decision");
      }
    }
    if (!this.initialized) await this.initialize();
    const now = this.now();
    const record: RiskDecisionRecord = {
      riskDecisionId: `rd_${input.quoteId}`,
      quoteId: input.quoteId,
      decision: input.decision.status,
      ...(input.decision.status === "rejected" ? { reasonCode: input.decision.reasonCode } : {}),
      policyVersion: input.decision.policyVersion,
      createdAt: new Date(now).toISOString(),
    };
    const authorization = {
      input: riskInput,
      record,
      ...(input.signingAuthorization ? {
        signingAuthorization: input.signingAuthorization,
        signingAuthorizationHash: quoteSigningAuthorizationHash(
          input.signingAuthorization,
          input.signingAuthorization.commit,
        ),
      } : {}),
    };
    const result = await this.client.eval(
      authorizeQuoteIssuanceScript,
      2,
      this.quoteKey(input.quoteId),
      this.key("events"),
      input.quoteId,
      digest(authorization),
      JSON.stringify(authorization),
      now,
      this.config.maxBacklog,
      this.config.hotStateTtlMs,
    );
    const mutation = parseMutationResult(result, "issuance authorization");
    if (mutation.code !== 1 && mutation.code !== 2) throw mutationError("issuance authorization", mutation);
    const stored = parseRiskDecisionRecord(mutation.payload, riskInput);
    await this.requireReplicaAcknowledgements();
    this.notifyMutation("authorized", mutation);
    return stored;
  }

  async finalize(input: FinalizeQuoteIssuanceInput): Promise<void> {
    assertQuoteIssuanceFinalization(input);
    if (!this.initialized) await this.initialize();
    const now = this.now();
    const finalization = { signedQuote: input.signedQuote, response: input.response };
    const finalizationHash = digest(finalization);
    const idempotencyKey = input.idempotency
      ? this.idempotencyKey(input.idempotency.principalId, input.idempotency.key)
      : this.key(`idempotency:none:${input.signedQuote.quoteId}`);
    const result = await this.client.eval(
      finalizeQuoteIssuanceScript,
      4,
      this.quoteKey(input.signedQuote.quoteId),
      idempotencyKey,
      this.nonceIndexKey(input.signedQuote.quote),
      this.key("events"),
      input.signedQuote.quoteId,
      input.signedQuote.principalId,
      finalizationHash,
      JSON.stringify(finalization),
      now,
      this.config.maxBacklog,
      input.idempotency ? "1" : "0",
      input.idempotency?.requestHash ?? "",
      input.idempotency?.ownerToken ?? "",
      this.config.idempotencyTtlMs,
      this.config.hotStateTtlMs,
    );
    const mutation = parseMutationResult(result, "issuance finalization");
    if (mutation.code !== 1 && mutation.code !== 2) throw mutationError("issuance finalization", mutation);
    if (mutation.payload !== finalizationHash) {
      throw new Error("Redis quote issuance finalization returned conflicting evidence");
    }
    await this.requireReplicaAcknowledgements();
    this.notifyMutation("finalized", mutation);
  }

  async findHotStatus(quoteId: string, principalId: string): Promise<QuoteStatusResponse | undefined> {
    assertSafeIdentifier(quoteId, "Redis quote status quoteId");
    assertPrincipalId(principalId, "Redis quote status principalId");
    if (!this.initialized) await this.initialize();
    const value = await this.client.get(this.quoteKey(quoteId));
    if (value === null) return undefined;
    if (typeof value !== "string") throw new Error("Redis quote status returned malformed state");
    const record = parseRedisQuoteIssuanceRecord(value);
    if (record.principalId !== principalId) return undefined;
    const projected = await this.client.get(this.projectionKey(quoteId));
    if (typeof projected === "string" && projectionRank(projected) >= projectionRank(record.stage)) {
      return undefined;
    }
    return hotStatus(record);
  }

  async recoverFinalizedResponse(quoteId: string, principalId: string): Promise<QuoteResponse | undefined> {
    assertSafeIdentifier(quoteId, "Redis quote recovery quoteId");
    assertPrincipalId(principalId, "Redis quote recovery principalId");
    if (!this.initialized) await this.initialize();
    const value = await this.client.get(this.quoteKey(quoteId));
    if (value === null) return undefined;
    if (typeof value !== "string") throw new Error("Redis quote recovery returned malformed state");
    const record = parseRedisQuoteIssuanceRecord(value);
    if (record.principalId !== principalId || record.stage !== "finalized" || !record.finalization) {
      return undefined;
    }
    const response = { ...record.finalization.response };
    assertQuoteResponse(response);
    return response;
  }

  async awaitSignedQuoteProjection(quote: SignedQuote, principalId: string): Promise<void> {
    assertPrincipalId(principalId, "Redis quote projection principalId");
    if (!this.initialized) await this.initialize();
    const quoteId = await this.client.get(this.nonceIndexKey(quote));
    if (quoteId === null) return;
    if (typeof quoteId !== "string") throw new Error("Redis quote nonce index returned malformed state");
    const value = await this.client.get(this.quoteKey(quoteId));
    if (typeof value !== "string") throw new Error("Redis quote projection hot state is unavailable");
    const record = parseRedisQuoteIssuanceRecord(value);
    if (record.principalId !== principalId || !sameSignedQuote(record.finalization?.signedQuote.quote, quote)) {
      throw new Error("Redis quote projection identity conflicts with the submitted quote");
    }
    await this.awaitQuoteProjection(quoteId, "finalized");
  }

  async awaitQuoteProjection(quoteId: string, expectedStage: "prepared" | "finalized"): Promise<void> {
    assertSafeIdentifier(quoteId, "Redis quote projection quoteId");
    if (!this.initialized) await this.initialize();
    const expectedRank = projectionRank(expectedStage);
    const deadline = performance.now() + this.config.projectionWaitTimeoutMs;
    while (true) {
      const stage = await this.client.get(this.projectionKey(quoteId));
      if (typeof stage === "string" && projectionRank(stage) >= expectedRank) return;
      if (stage === "failed" && expectedStage === "finalized") {
        throw new Error("Redis quote projection reached failed state");
      }
      if (stage !== null && (typeof stage !== "string" || projectionRank(stage) === 0)) {
        this.notifyFailure("state_invalid");
        throw new Error("Redis quote issuance projection marker is invalid");
      }
      if (performance.now() >= deadline) {
        this.notifyFailure("projection_timeout");
        throw new Error("Redis quote issuance PostgreSQL projection timed out");
      }
      await delay(this.config.projectionPollIntervalMs);
    }
  }

  async close(): Promise<void> {
    if (this.client.status === "wait" || this.client.status === "end") {
      this.client.disconnect?.();
      return;
    }
    try { await this.client.quit(); } catch { this.client.disconnect?.(); }
  }

  streamKey(): string {
    return this.key("events");
  }

  projectedKey(quoteId: string): string {
    assertSafeIdentifier(quoteId, "Redis quote projection quoteId");
    return this.projectionKey(quoteId);
  }

  hotStateTtlMs(): number {
    return this.config.hotStateTtlMs;
  }

  private leaseMs(): number {
    return this.config.leaseMs;
  }

  private now(): number {
    const value = this.nowMilliseconds();
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error("Redis quote issuance clock returned an invalid timestamp");
    }
    return value;
  }

  private async requireReplicaAcknowledgements(): Promise<void> {
    if (this.config.minReplicaAcks === 0) return;
    const acknowledgements = await this.client.wait(
      this.config.minReplicaAcks,
      this.config.replicaAckTimeoutMs,
    );
    if (!Number.isSafeInteger(acknowledgements) ||
        (acknowledgements as number) < this.config.minReplicaAcks) {
      this.notifyFailure("replica_ack");
      throw new Error("Redis quote issuance mutation did not reach the required replicas");
    }
  }

  private idempotencyKey(principalId: string, key: string): string {
    return this.key(`idempotency:${digest(`${principalId}\u0000${key}`)}`);
  }

  private quoteKey(quoteId: string): string {
    return this.key(`quote:${quoteId}`);
  }

  private nonceIndexKey(quote: Pick<SignedQuote, "chainId" | "user" | "nonce">): string {
    return this.key(`nonce:${digest(`${quote.chainId}:${quote.user.toLowerCase()}:${quote.nonce}`)}`);
  }

  private projectionKey(quoteId: string): string {
    return this.key(`projected:${quoteId}`);
  }

  private key(suffix: string): string {
    return `${this.config.keyPrefix}:${suffix}`;
  }

  private async ensureConnected(): Promise<void> {
    if (!this.client.connect || this.client.status === undefined || this.client.status === "ready") return;
    if (this.connectPromise) return this.connectPromise;
    if (this.client.status !== "wait" && this.client.status !== "end") return;
    this.connectPromise = this.client.connect().then(() => undefined).finally(() => {
      this.connectPromise = undefined;
    });
    return this.connectPromise;
  }

  private notifyMutation(eventType: RedisQuoteIssuanceEventType, mutation: MutationResult): void {
    try {
      this.observer.recordIssuanceMutation({
        eventType,
        duplicate: mutation.code === 2,
        backlog: mutation.backlog,
      });
    } catch {}
  }

  private notifyFailure(reason: Parameters<RedisQuoteIssuanceObserver["recordIssuanceFailure"]>[0]): void {
    try { this.observer.recordIssuanceFailure(reason); } catch {}
  }

  private notifyBacklog(backlog: number): void {
    try { this.observer.recordIssuanceBacklog(backlog); } catch {}
  }
}

interface MutationResult {
  code: number;
  payload: string;
  backlog: number;
  streamId: string;
}

function parseStateResult(value: unknown, operation: string): { code: number; payload: string } {
  if (!Array.isArray(value) || value.length !== 2 || !Number.isSafeInteger(value[0]) ||
      typeof value[1] !== "string") {
    throw new Error(`Redis quote ${operation} returned malformed state`);
  }
  return { code: value[0] as number, payload: value[1] };
}

function parseMutationResult(value: unknown, operation: string): MutationResult {
  if (!Array.isArray(value) || value.length !== 4 || !Number.isSafeInteger(value[0]) ||
      typeof value[1] !== "string" || !Number.isSafeInteger(value[2]) || (value[2] as number) < 0 ||
      typeof value[3] !== "string") {
    throw new Error(`Redis quote ${operation} returned malformed state`);
  }
  const code = value[0] as number;
  const streamId = value[3];
  if ((code === 1 && !/^\d+-\d+$/.test(streamId)) || (code !== 1 && streamId !== "")) {
    throw new Error(`Redis quote ${operation} returned an invalid stream id`);
  }
  return { code, payload: value[1], backlog: value[2] as number, streamId };
}

function parseRiskDecisionRecord(
  payload: string,
  input: AuthorizeQuoteIssuanceInput,
): RiskDecisionRecord {
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch {
    throw new Error("Redis quote issuance authorization returned malformed evidence");
  }
  assertRiskDecisionRecord(value as RiskDecisionRecord, input);
  return value as RiskDecisionRecord;
}

function mutationError(operation: string, mutation: MutationResult): Error {
  return stateError(operation, mutation.payload);
}

function stateError(operation: string, reason: string): Error {
  return new Error(`Redis quote ${operation} failed: ${reason}`);
}

function reservationFromState(state: RedisQuoteIdempotencyRecord): QuoteIdempotencyReservation {
  if (state.state !== "processing" || !state.ownerToken || !state.leaseExpiresAtMs) {
    throw new Error("Redis quote idempotency state is not an active reservation");
  }
  const reservation = {
    principalId: state.principalId,
    key: state.key,
    requestHash: state.requestHash,
    ownerToken: state.ownerToken,
    expiresAt: new Date(state.leaseExpiresAtMs).toISOString(),
  };
  assertQuoteIdempotencyReservation(reservation);
  return reservation;
}

function hotStatus(record: RedisQuoteIssuanceRecord): QuoteStatusResponse {
  const status = record.stage === "finalized"
    ? "signed"
    : record.stage === "failed"
      ? "failed"
      : record.authorization?.record.decision === "rejected"
        ? "rejected"
        : "requested";
  return {
    quoteId: record.quoteId,
    status,
    snapshotId: record.preparation.requestedQuote.snapshotId,
    ...(record.finalization ? { deadline: record.finalization.signedQuote.quote.deadline } : {}),
    ...(record.failure ? { errorCode: record.failure.code } : {}),
    ...(record.authorization?.record.reasonCode ? { errorCode: record.authorization.record.reasonCode } : {}),
  };
}

function sameSignedQuote(left: SignedQuote | undefined, right: SignedQuote): boolean {
  return left !== undefined && left.chainId === right.chainId &&
    left.user.toLowerCase() === right.user.toLowerCase() &&
    left.tokenIn.toLowerCase() === right.tokenIn.toLowerCase() &&
    left.tokenOut.toLowerCase() === right.tokenOut.toLowerCase() &&
    left.amountIn === right.amountIn && left.amountOut === right.amountOut &&
    left.minAmountOut === right.minAmountOut && left.nonce === right.nonce &&
    left.deadline === right.deadline;
}

function projectionRank(stage: string): number {
  if (stage === "prepared") return 1;
  if (stage === "authorized") return 2;
  if (stage === "failed") return 3;
  if (stage === "finalized") return 4;
  return 0;
}

function digest(value: unknown): string {
  const input = typeof value === "string" ? value : JSON.stringify(value);
  return createHash("sha256").update(input).digest("hex");
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

function parseNonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`Redis quote issuance ${field} must be a non-negative safe integer`);
  }
  return value as number;
}

function assertClient(value: unknown): asserts value is RedisQuoteIssuanceClient {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Redis quote issuance client must be an object");
  }
  for (const method of ["eval", "get", "ping", "info", "xlen", "wait", "quit"] as const) {
    if (typeof (value as Record<string, unknown>)[method] !== "function") {
      throw new Error(`Redis quote issuance client.${method} must be a function`);
    }
  }
}

function assertObserver(value: unknown): asserts value is RedisQuoteIssuanceObserver {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Redis quote issuance observer must be an object");
  }
  for (const method of ["recordIssuanceMutation", "recordIssuanceFailure", "recordIssuanceBacklog"] as const) {
    if (typeof (value as Record<string, unknown>)[method] !== "function") {
      throw new Error(`Redis quote issuance observer.${method} must be a function`);
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
