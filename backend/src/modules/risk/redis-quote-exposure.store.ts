import { randomBytes } from "node:crypto";
import { Redis } from "ioredis";
import type { TokenRegistry } from "../pricing/token-registry.js";
import {
  normalizeRedisUrl,
  type RedisUrlPolicy,
} from "../../shared/redis/redis-url.js";
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
  acquireAndReadQuoteExposureStateScript,
  acquireQuoteExposureLockScript,
  commitQuoteExposureReservationScript,
  getQuoteExposureReservationScript,
  initializeQuoteExposureLedgerScript,
  readQuoteExposureStateScript,
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
    const result = await this.client.eval(
      initializeQuoteExposureLedgerScript,
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
    const assets = this.portfolioVarEvaluator?.valuationAssets(reservation.chainId) ?? [];
    const { lockToken, state } = await this.acquireState(reservation, assets);
    let lockReleased = false;
    try {
      if (state.existing) {
        assertSameReservation(storedRedisQuoteExposureToNormalized(state.existing), reservation);
        lockReleased = true;
        await this.requireReplicaAcknowledgements();
        this.notifyMutation({ operation: "reserve", duplicate: true, backlog: state.backlog });
        return storedRedisQuoteExposureResult(state.existing);
      }

      let portfolioVar: PortfolioVarEvaluation | undefined;
      let portfolioDelta: PortfolioDeltaEvaluation | undefined;
      if (this.portfolioVarEvaluator) {
        portfolioVar = await this.portfolioVarEvaluator.evaluateTokenDeltas(
          reservation.chainId,
          state.tokenDeltas,
          reservation,
        );
        if (this.portfolioVarEvaluator.exceedsLimit(portfolioVar)) {
          return { status: "rejected", reasonCode: "PORTFOLIO_VAR_LIMIT_EXCEEDED" };
        }
        if (this.portfolioDeltaPolicy) {
          portfolioDelta = evaluatePortfolioDelta(
            portfolioVar,
            this.portfolioDeltaPolicy,
            reservation.chainId,
          );
          if (exceedsPortfolioDeltaHardLimit(portfolioDelta)) {
            return { status: "rejected", reasonCode: "PORTFOLIO_DELTA_LIMIT_EXCEEDED" };
          }
        }
      }

      const stored = toStoredRedisQuoteExposureReservation(
        reservation,
        this.config.expiryGraceSeconds,
        portfolioVar,
        portfolioDelta,
      );
      const result = await this.client.eval(
        commitQuoteExposureReservationScript,
        9,
        ...this.ledgerKeys(reservation.chainId),
        lockToken,
        reservation.quoteId,
        JSON.stringify(stored),
        reservation.deadline,
        stored.ledgerExpiresAt,
        this.maxUserOpenNotionalUsdE18.toString(),
        this.maxPairOpenNotionalUsdE18.toString(),
        reservation.treasuryLiquidity?.availableBalance.toString() ?? "",
        this.config.maxBacklog,
      );
      const committed = parseRedisQuoteExposureMutation(result);
      lockReleased = true;
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
      await this.requireReplicaAcknowledgements();
      this.notifyMutation({
        operation: "reserve",
        duplicate: committed.status === "duplicate",
        backlog: committed.backlog,
      });
      if (accepted.portfolioDelta?.softLimitBreached) {
        notifyPortfolioDeltaSoftBreach(this.observer);
      }
      return storedRedisQuoteExposureResult(accepted);
    } finally {
      if (!lockReleased) await this.releaseLock(reservation.chainId, lockToken);
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
      const result = await this.client.eval(
        releaseQuoteExposureReservationScript,
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
    const result = await this.client.eval(
      getQuoteExposureReservationScript,
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

  private async readState(
    lockToken: string,
    reservation: NormalizedQuoteExposureReservation,
    assets: readonly `0x${string}`[],
  ): Promise<ReadRedisQuoteExposureState> {
    for (let pass = 0; pass < 100; pass += 1) {
      const fields = assets.map((asset) => `${reservation.chainId}:${asset.toLowerCase()}`);
      const result = await this.client.eval(
        readQuoteExposureStateScript,
        9,
        ...this.ledgerKeys(reservation.chainId),
        lockToken,
        this.config.cleanupLimit,
        reservation.quoteId,
        fields.length,
        ...fields,
      );
      if (Array.isArray(result) && result[0] === -1) continue;
      return parseRedisQuoteExposureState(
        result,
        assets.map((asset) => asset.toLowerCase() as `0x${string}`),
        reservation.chainId,
      );
    }
    this.notifyFailure("state_invalid");
    throw new Error("Redis quote exposure expired cleanup did not converge");
  }

  private async acquireState(
    reservation: NormalizedQuoteExposureReservation,
    assets: readonly `0x${string}`[],
  ): Promise<{ lockToken: string; state: ReadRedisQuoteExposureState }> {
    const lockToken = `owner_${randomBytes(16).toString("hex")}`;
    const fields = assets.map((asset) => `${reservation.chainId}:${asset.toLowerCase()}`);
    const startedAt = performance.now();
    const deadline = startedAt + this.config.lockAcquireTimeoutMs;
    while (true) {
      let result: unknown;
      try {
        result = await this.client.eval(
          acquireAndReadQuoteExposureStateScript,
          9,
          ...this.ledgerKeys(reservation.chainId),
          lockToken,
          this.config.lockTtlMs,
          this.config.cleanupLimit,
          reservation.quoteId,
          fields.length,
          ...fields,
        );
      } catch (error) {
        await this.releaseLock(reservation.chainId, lockToken);
        throw error;
      }
      if (Array.isArray(result) && result[0] === 0 && result[1] === "lock_busy") {
        if (performance.now() >= deadline) {
          this.notifyFailure("lock_timeout");
          throw new Error("Redis quote exposure chain lock timed out");
        }
        await delay(1);
        continue;
      }
      try {
        const state = Array.isArray(result) && result[0] === -1
          ? await this.readState(lockToken, reservation, assets)
          : parseRedisQuoteExposureState(result, assets, reservation.chainId);
        this.notifyLockWait((performance.now() - startedAt) / 1_000);
        return { lockToken, state };
      } catch (error) {
        await this.releaseLock(reservation.chainId, lockToken);
        this.notifyFailure("state_invalid");
        throw error;
      }
    }
  }

  private async acquireLock(chainId: number): Promise<string> {
    const token = `owner_${randomBytes(16).toString("hex")}`;
    const startedAt = performance.now();
    const deadline = startedAt + this.config.lockAcquireTimeoutMs;
    while (true) {
      const result = await this.client.eval(
        acquireQuoteExposureLockScript,
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
      await this.client.eval(
        releaseQuoteExposureLockScript,
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

  private notifyBacklog(backlog: number): void {
    try { this.observer.recordLedgerBacklog(backlog); } catch {}
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
