import { randomBytes } from "node:crypto";
import { Redis } from "ioredis";
import type { TokenRegistry } from "../pricing/token-registry.js";
import {
  normalizeRedisUrl,
  type RedisUrlPolicy,
} from "../../shared/redis/redis-url.js";
import { RedisLuaScript } from "../../shared/redis/redis-lua-script.js";
import {
  assertSameReservation,
  notifyPortfolioDeltaSoftBreach,
  normalizeQuoteExposurePolicy,
  normalizeQuoteExposureReservation,
  type NormalizedQuoteExposureReservation,
  type QuoteExposurePolicy,
  type QuoteExposureRejectReason,
  type QuoteExposureReservationResult,
  type QuoteExposureStore,
  type ReserveQuoteExposureInput,
} from "./quote-exposure.store.js";
import type { InMemoryPortfolioVarEvaluator } from "./in-memory-portfolio-var.js";
import {
  evaluatePortfolioDelta,
  exceedsPortfolioDeltaHardLimit,
  normalizePortfolioDeltaPolicy,
  type NormalizedPortfolioDeltaPolicy,
  type PortfolioDeltaEvaluation,
} from "./portfolio-delta.js";
import type { PortfolioVarEvaluation } from "./portfolio-var.js";
import {
  acquireQuoteExposureLockScript,
  commitQuoteExposureReservationScript,
  getQuoteExposureReservationScript,
  initializeQuoteExposureLedgerScript,
  readVersionedQuoteExposureStateScript,
  releaseQuoteExposureLockScript,
  releaseQuoteExposureReservationScript,
} from "./redis-quote-exposure.scripts.js";
import {
  assertRedisAofHealth,
  assertRedisQuoteExposureClient,
  assertRedisQuoteExposureObserver,
  assertSafeRedisQuoteExposureIdentifier,
  noopRedisQuoteExposureObserver,
  normalizeRedisQuoteExposureConfig,
  parseRedisNonNegativeSafeInteger,
  parseRedisQuoteExposureMutation,
  parseRedisQuoteExposureRecord,
  parseRedisQuoteExposureState,
  storedRedisQuoteExposureResult,
  storedRedisQuoteExposureToNormalized,
  toStoredRedisQuoteExposureReservation,
  type ReadRedisQuoteExposureState,
  type RedisQuoteExposureClient,
  type RedisQuoteExposureLedgerObserver,
  type RedisQuoteExposureObservation,
  type RedisQuoteExposureRecord,
  type RedisQuoteExposureStoreConfig,
} from "./redis-quote-exposure.protocol.js";

const initializeQuoteExposureLedgerCommand = new RedisLuaScript(initializeQuoteExposureLedgerScript);
const commitQuoteExposureReservationCommand = new RedisLuaScript(commitQuoteExposureReservationScript);
const releaseQuoteExposureReservationCommand = new RedisLuaScript(releaseQuoteExposureReservationScript);
const getQuoteExposureReservationCommand = new RedisLuaScript(getQuoteExposureReservationScript);
const readVersionedQuoteExposureStateCommand = new RedisLuaScript(readVersionedQuoteExposureStateScript);
const acquireQuoteExposureLockCommand = new RedisLuaScript(acquireQuoteExposureLockScript);
const releaseQuoteExposureLockCommand = new RedisLuaScript(releaseQuoteExposureLockScript);

export { parseRedisQuoteExposureRecord } from "./redis-quote-exposure.protocol.js";
export type {
  RedisQuoteExposureClient,
  RedisQuoteExposureLedgerObserver,
  RedisQuoteExposureObservation,
  RedisQuoteExposureRecord,
  RedisQuoteExposureStoreConfig,
} from "./redis-quote-exposure.protocol.js";

export function createRedisQuoteExposureClient(
  redisUrl: string,
  policy: RedisUrlPolicy = {},
): RedisQuoteExposureClient {
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
  }) as unknown as RedisQuoteExposureClient;
}

const rejectReasons = new Set<QuoteExposureRejectReason>([
  "USER_OPEN_NOTIONAL_LIMIT_EXCEEDED",
  "PAIR_OPEN_NOTIONAL_LIMIT_EXCEEDED",
  "TREASURY_LIQUIDITY_INSUFFICIENT",
]);

export class RedisQuoteExposureStore implements QuoteExposureStore {
  private readonly config: RedisQuoteExposureStoreConfig;
  private readonly observer: RedisQuoteExposureLedgerObserver;
  private readonly maxUserOpenNotionalUsdE18: bigint;
  private readonly maxPairOpenNotionalUsdE18: bigint;
  private readonly portfolioDeltaPolicy?: NormalizedPortfolioDeltaPolicy;
  private readonly hotStates = new Map<number, ReadRedisQuoteExposureState>();
  private readonly reservationTails = new Map<number, Promise<void>>();
  private connectPromise: Promise<void> | undefined;
  private initialized = false;

  constructor(
    private readonly client: RedisQuoteExposureClient,
    policy: QuoteExposurePolicy,
    private readonly tokenRegistry: TokenRegistry,
    private readonly portfolioVarEvaluator: InMemoryPortfolioVarEvaluator | undefined,
    config: RedisQuoteExposureStoreConfig,
    observer: RedisQuoteExposureLedgerObserver = noopRedisQuoteExposureObserver,
    private readonly nowSeconds: () => number = () => Math.floor(Date.now() / 1_000),
  ) {
    assertRedisQuoteExposureClient(client);
    this.config = normalizeRedisQuoteExposureConfig(config);
    const limits = normalizeQuoteExposurePolicy(policy);
    this.maxUserOpenNotionalUsdE18 = limits.maxUserOpenNotionalUsdE18;
    this.maxPairOpenNotionalUsdE18 = limits.maxPairOpenNotionalUsdE18;
    if (policy.portfolioVar && !portfolioVarEvaluator) {
      throw new Error("Redis quote exposure portfolio VaR evaluator is required by policy");
    }
    if (!policy.portfolioVar && portfolioVarEvaluator) {
      throw new Error("Redis quote exposure portfolio VaR evaluator requires portfolio VaR policy");
    }
    if (policy.portfolioDelta) {
      this.portfolioDeltaPolicy = normalizePortfolioDeltaPolicy(policy.portfolioDelta);
    }
    assertRedisQuoteExposureObserver(observer);
    this.observer = observer;
    if (typeof nowSeconds !== "function") {
      throw new Error("Redis quote exposure nowSeconds must be a function");
    }
  }

  async initialize(): Promise<void> {
    await this.ensureConnected();
    const result = await initializeQuoteExposureLedgerCommand.execute(
      this.client,
      1,
      this.key("epoch"),
      this.config.ledgerEpoch,
      this.config.allowEpochInitialization ? "1" : "0",
    );
    if (!Array.isArray(result) || result.length !== 2 ||
        !Number.isSafeInteger(result[0]) || typeof result[1] !== "string") {
      this.notifyFailure("state_invalid");
      throw new Error("Redis quote exposure epoch initialization returned malformed state");
    }
    if (result[0] === -1) {
      throw new Error("Redis quote exposure ledger is empty and requires an approved bootstrap");
    }
    if (result[0] !== 1 || result[1] !== this.config.ledgerEpoch) {
      throw new Error("Redis quote exposure ledger epoch does not match runtime configuration");
    }
    this.initialized = true;
  }

  async checkHealth(): Promise<void> {
    if (!this.initialized) await this.initialize();
    if (await this.client.ping() !== "PONG") {
      throw new Error("Redis quote exposure health check returned an unexpected response");
    }
    if (this.config.requireAof) assertRedisAofHealth(await this.client.info("persistence"));
    const backlog = parseRedisNonNegativeSafeInteger(
      await this.client.xlen(this.key("events")),
      "backlog",
    );
    this.notifyBacklog(backlog);
    if (backlog >= this.config.maxBacklog) {
      throw new Error(`Redis quote exposure backlog reached ${this.config.maxBacklog}`);
    }
  }

  async reserve(input: ReserveQuoteExposureInput): Promise<QuoteExposureReservationResult> {
    if (!this.initialized) await this.initialize();
    const reservation = normalizeQuoteExposureReservation(input, this.tokenRegistry, this.nowSeconds());
    return this.serializeChainMutation(
      reservation.chainId,
      () => this.reserveNormalized(reservation),
    );
  }

  private async reserveNormalized(
    reservation: NormalizedQuoteExposureReservation,
  ): Promise<QuoteExposureReservationResult> {
    const assets = this.portfolioVarEvaluator?.valuationAssets(reservation.chainId) ?? [];
    const startedAt = performance.now();
    const retryDeadline = startedAt + this.config.lockAcquireTimeoutMs;
    let conflicted = false;
    let state = this.hotState(reservation.chainId, assets);
    let stateWasCached = state !== undefined;
    while (true) {
      if (!state) {
        state = await this.readVersionedState(reservation, assets);
        this.cacheHotState(state, reservation.chainId);
        stateWasCached = false;
      }
      if (state.existing) {
        assertSameReservation(storedRedisQuoteExposureToNormalized(state.existing), reservation);
        await this.requireReplicaAcknowledgements();
        if (conflicted) this.notifyLockWait((performance.now() - startedAt) / 1_000);
        this.notifyMutation({ operation: "reserve", duplicate: true, backlog: state.backlog });
        return storedRedisQuoteExposureResult(state.existing);
      }

      const evaluated = await this.evaluateReservation(reservation, state);
      if ("rejection" in evaluated) {
        if (!stateWasCached) return evaluated.rejection;
        state = undefined;
        continue;
      }
      const stored = evaluated.record;
      const result = await commitQuoteExposureReservationCommand.execute(
        this.client,
        9,
        ...this.ledgerKeys(reservation.chainId),
        state.version,
        reservation.quoteId,
        JSON.stringify(stored),
        reservation.deadline,
        stored.ledgerExpiresAt,
        this.maxUserOpenNotionalUsdE18.toString(),
        this.maxPairOpenNotionalUsdE18.toString(),
        reservation.treasuryLiquidity?.availableBalance.toString() ?? "",
        this.config.maxBacklog,
        this.config.cleanupLimit,
      );
      const committed = parseRedisQuoteExposureMutation(result);
      if (committed.status === "conflict") {
        conflicted = true;
        this.notifyVersionConflict();
        if (performance.now() >= retryDeadline) {
          this.notifyLockWait((performance.now() - startedAt) / 1_000);
          this.notifyFailure("version_retry_timeout");
          throw new Error("Redis quote exposure version retry timed out");
        }
        await yieldControl();
        state = undefined;
        continue;
      }
      if (committed.status === "rejected") {
        if (!rejectReasons.has(committed.reason as QuoteExposureRejectReason)) {
          this.notifyFailure("state_invalid");
          throw new Error("Redis quote exposure commit returned an invalid rejection reason");
        }
        return { status: "rejected", reasonCode: committed.reason as QuoteExposureRejectReason };
      }
      if (committed.status === "error") {
        this.notifyFailure(committed.reason === "backlog_full" ? "backlog_full" : "state_invalid");
        throw new Error(`Redis quote exposure commit failed: ${committed.reason}`);
      }
      const accepted = parseRedisQuoteExposureRecord(committed.payload);
      assertSameReservation(storedRedisQuoteExposureToNormalized(accepted), reservation);
      if (committed.status === "reserved") {
        this.cacheAcceptedReservation(state, accepted, committed.backlog);
      } else if (stateWasCached) {
        this.hotStates.delete(reservation.chainId);
      }
      await this.requireReplicaAcknowledgements();
      if (conflicted) this.notifyLockWait((performance.now() - startedAt) / 1_000);
      this.notifyMutation({
        operation: "reserve",
        duplicate: committed.status === "duplicate",
        backlog: committed.backlog,
      });
      if (accepted.portfolioDelta?.softLimitBreached) {
        notifyPortfolioDeltaSoftBreach(this.observer);
      }
      return storedRedisQuoteExposureResult(accepted);
    }
  }

  async release(quoteId: string): Promise<void> {
    assertSafeRedisQuoteExposureIdentifier(quoteId, "quoteId");
    if (!this.initialized) await this.initialize();
    const record = await this.readReservation(quoteId);
    if (!record) return;
    const lockToken = await this.acquireLock(record.chainId);
    let lockReleased = false;
    try {
      const result = await releaseQuoteExposureReservationCommand.execute(
        this.client,
        9,
        ...this.ledgerKeys(record.chainId),
        lockToken,
        quoteId,
        this.config.maxBacklog,
      );
      const released = parseRedisQuoteExposureMutation(result);
      lockReleased = true;
      if (released.status === "error" || released.status === "rejected") {
        this.notifyFailure(released.reason === "backlog_full" ? "backlog_full" : "state_invalid");
        throw new Error(`Redis quote exposure release failed: ${released.reason}`);
      }
      this.hotStates.delete(record.chainId);
      if (released.status === "reserved") await this.requireReplicaAcknowledgements();
      this.notifyMutation({
        operation: "release",
        duplicate: released.status === "duplicate",
        backlog: released.backlog,
      });
    } finally {
      if (!lockReleased) await this.releaseLock(record.chainId, lockToken);
    }
  }

  async close(): Promise<void> {
    if (this.client.status === "wait" || this.client.status === "end") {
      this.client.disconnect?.();
      return;
    }
    try {
      await this.client.quit();
    } catch {
      this.client.disconnect?.();
    }
  }

  private async readReservation(quoteId: string): Promise<RedisQuoteExposureRecord | undefined> {
    const result = await getQuoteExposureReservationCommand.execute(
      this.client,
      1,
      this.key("reservations"),
      quoteId,
    );
    if (result === "") return undefined;
    if (typeof result !== "string") {
      throw new Error("Redis quote exposure reservation probe returned malformed state");
    }
    return parseRedisQuoteExposureRecord(result);
  }

  private async readVersionedState(
    reservation: NormalizedQuoteExposureReservation,
    assets: readonly `0x${string}`[],
  ): Promise<ReadRedisQuoteExposureState> {
    for (let pass = 0; pass < 100; pass += 1) {
      const fields = assets.map((asset) => `${reservation.chainId}:${asset.toLowerCase()}`);
      const result = await readVersionedQuoteExposureStateCommand.execute(
        this.client,
        9,
        ...this.ledgerKeys(reservation.chainId),
        this.config.cleanupLimit,
        reservation.quoteId,
        reservation.chainId,
        fields.length,
        ...fields,
      );
      if (Array.isArray(result) && result[0] === -1) continue;
      try {
        return parseRedisQuoteExposureState(
          result,
          assets.map((asset) => asset.toLowerCase() as `0x${string}`),
          reservation.chainId,
        );
      } catch (error) {
        this.notifyFailure("state_invalid");
        throw error;
      }
    }
    this.notifyFailure("state_invalid");
    throw new Error("Redis quote exposure expired cleanup did not converge");
  }

  private async evaluateReservation(
    reservation: NormalizedQuoteExposureReservation,
    state: ReadRedisQuoteExposureState,
  ): Promise<
    { record: RedisQuoteExposureRecord } |
    { rejection: QuoteExposureReservationResult }
  > {
    let portfolioVar: PortfolioVarEvaluation | undefined;
    let portfolioDelta: PortfolioDeltaEvaluation | undefined;
    if (this.portfolioVarEvaluator) {
      portfolioVar = await this.portfolioVarEvaluator.evaluateTokenDeltas(
        reservation.chainId,
        state.tokenDeltas,
        reservation,
      );
      if (this.portfolioVarEvaluator.exceedsLimit(portfolioVar)) {
        return { rejection: { status: "rejected", reasonCode: "PORTFOLIO_VAR_LIMIT_EXCEEDED" } };
      }
      if (this.portfolioDeltaPolicy) {
        portfolioDelta = evaluatePortfolioDelta(
          portfolioVar,
          this.portfolioDeltaPolicy,
          reservation.chainId,
        );
        if (exceedsPortfolioDeltaHardLimit(portfolioDelta)) {
          return { rejection: { status: "rejected", reasonCode: "PORTFOLIO_DELTA_LIMIT_EXCEEDED" } };
        }
      }
    }
    return {
      record: toStoredRedisQuoteExposureReservation(
        reservation,
        this.config.expiryGraceSeconds,
        portfolioVar,
        portfolioDelta,
      ),
    };
  }

  private hotState(
    chainId: number,
    assets: readonly `0x${string}`[],
  ): ReadRedisQuoteExposureState | undefined {
    const state = this.hotStates.get(chainId);
    if (!state || state.tokenDeltas.length !== assets.length) return undefined;
    for (let index = 0; index < assets.length; index += 1) {
      if (state.tokenDeltas[index]?.tokenAddress !== assets[index]?.toLowerCase()) return undefined;
    }
    return state;
  }

  private cacheHotState(state: ReadRedisQuoteExposureState, chainId: number): void {
    this.hotStates.set(chainId, {
      tokenDeltas: state.tokenDeltas.map((delta) => ({ ...delta })),
      backlog: state.backlog,
      version: state.version,
    });
  }

  private cacheAcceptedReservation(
    state: ReadRedisQuoteExposureState,
    record: RedisQuoteExposureRecord,
    backlog: number,
  ): void {
    const tokenDeltas = state.tokenDeltas.map((delta) => {
      let next = delta.delta;
      if (delta.tokenAddress === record.tokenIn) next += BigInt(record.amountIn);
      if (delta.tokenAddress === record.tokenOut) next -= BigInt(record.amountOut);
      return { ...delta, delta: next };
    });
    this.hotStates.set(record.chainId, {
      tokenDeltas,
      backlog,
      version: state.version + 1,
    });
  }

  private async serializeChainMutation<T>(chainId: number, operation: () => Promise<T>): Promise<T> {
    const previous = this.reservationTails.get(chainId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    this.reservationTails.set(chainId, current);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.reservationTails.get(chainId) === current) this.reservationTails.delete(chainId);
    }
  }

  private async acquireLock(chainId: number): Promise<string> {
    const token = `owner_${randomBytes(16).toString("hex")}`;
    const startedAt = performance.now();
    const deadline = startedAt + this.config.lockAcquireTimeoutMs;
    while (true) {
      const result = await acquireQuoteExposureLockCommand.execute(
        this.client,
        1,
        this.key(`lock:${chainId}`),
        token,
        this.config.lockTtlMs,
      );
      if (result === 1) {
        this.notifyLockWait((performance.now() - startedAt) / 1_000);
        return token;
      }
      if (result !== 0) {
        this.notifyFailure("state_invalid");
        throw new Error("Redis quote exposure lock returned malformed state");
      }
      if (performance.now() >= deadline) {
        this.notifyFailure("lock_timeout");
        throw new Error("Redis quote exposure chain lock timed out");
      }
      await delay(1);
    }
  }

  private async releaseLock(chainId: number, token: string): Promise<void> {
    try {
      await releaseQuoteExposureLockCommand.execute(
        this.client,
        1,
        this.key(`lock:${chainId}`),
        token,
      );
    } catch {
      // The bounded lease expires even when explicit unlock fails.
    }
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
      throw new Error("Redis quote exposure mutation did not reach the required replicas");
    }
  }

  private ledgerKeys(chainId: number): string[] {
    return [
      this.key("reservations"),
      this.key(`deadlines:${chainId}`),
      this.key("user-totals"),
      this.key("pair-totals"),
      this.key("output-totals"),
      this.key("token-deltas"),
      this.key("events"),
      this.key(`lock:${chainId}`),
      this.key("versions"),
    ];
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

  private notifyMutation(observation: RedisQuoteExposureObservation): void {
    try { this.observer.recordLedgerMutation(observation); } catch {}
  }

  private notifyFailure(reason: Parameters<RedisQuoteExposureLedgerObserver["recordLedgerFailure"]>[0]): void {
    try { this.observer.recordLedgerFailure(reason); } catch {}
  }

  private notifyLockWait(seconds: number): void {
    try { this.observer.recordLedgerLockWait(seconds); } catch {}
  }

  private notifyVersionConflict(): void {
    try { this.observer.recordLedgerVersionConflict(); } catch {}
  }

  private notifyBacklog(backlog: number): void {
    try { this.observer.recordLedgerBacklog(backlog); } catch {}
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function yieldControl(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
