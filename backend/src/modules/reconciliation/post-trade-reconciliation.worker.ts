import type { SettlementEventStatusResponse } from "../../shared/types/rfq.js";
import { ReconciliationService } from "./reconciliation.service.js";
import type {
  PostTradeReconciliationJob,
  PostTradeReconciliationJobStore,
  ReconciliationSettlementEvent,
} from "./postgres-post-trade-reconciliation.store.js";

export interface PostTradeReconciliationWorkerConfig {
  workerId: string;
  leaseMs: number;
  pollIntervalMs: number;
  retryDelayMs: number;
}

export type ReconciliationJobOutcome =
  | "repaired"
  | "already_consistent"
  | "retry_scheduled"
  | "stale_revision";

export interface PostTradeReconciliationObserver {
  recordJob(outcome: ReconciliationJobOutcome): void;
  recordIterationError(): void;
}

export interface PostTradeReconciliationLogger {
  error(input: Readonly<Record<string, unknown>>, message: string): void;
}

const workerIdPattern = /^[A-Za-z0-9_:-]+$/;

export class PostTradeReconciliationWorker {
  private stopped = false;
  private wakePoll: (() => void) | undefined;

  constructor(
    private readonly store: PostTradeReconciliationJobStore,
    private readonly reconciliation: ReconciliationService,
    private readonly config: PostTradeReconciliationWorkerConfig,
    private readonly observer: PostTradeReconciliationObserver,
    private readonly logger: PostTradeReconciliationLogger = console,
  ) {
    assertStore(store);
    assertReconciliation(reconciliation);
    assertConfig(config);
    assertObserver(observer);
    assertLogger(logger);
    this.config = { ...config };
  }

  async run(): Promise<void> {
    while (!this.stopped) {
      try {
        const processed = await this.runOnce();
        if (!processed) await this.waitForPoll();
      } catch (error) {
        this.observer.recordIterationError();
        this.logger.error(
          { errorCode: reconciliationErrorCode(error) },
          "post-trade reconciliation iteration failed",
        );
        await this.waitForPoll();
      }
    }
  }

  async runOnce(): Promise<boolean> {
    const job = await this.store.claimNext(this.config.workerId, this.config.leaseMs);
    if (!job) return false;

    try {
      const repaired = await this.reconcileJob(job);
      const completed = await this.store.markProcessed(job, this.config.workerId);
      if (!completed) {
        this.observer.recordJob("stale_revision");
        return true;
      }
      this.observer.recordJob(repaired > 0 ? "repaired" : "already_consistent");
    } catch (error) {
      const errorCode = reconciliationErrorCode(error);
      const scheduled = await this.store.releaseForRetry(
        job,
        this.config.workerId,
        errorCode,
        retryDelay(this.config.retryDelayMs, job.attemptCount),
      );
      this.observer.recordJob(scheduled ? "retry_scheduled" : "stale_revision");
      if (scheduled) {
        this.logger.error({ quoteId: job.quoteId, errorCode }, "post-trade reconciliation scheduled retry");
      }
    }
    return true;
  }

  stop(): void {
    this.stopped = true;
    this.wakePoll?.();
  }

  private async reconcileJob(job: PostTradeReconciliationJob): Promise<number> {
    const settlements = await this.store.listSettlementEvents(job.quoteId);
    const canonical = settlements.filter(({ canonical: isCanonical }) => isCanonical);
    const removed = settlements.filter(({ canonical: isCanonical }) => !isCanonical);
    const desired = desiredSettlement(job, canonical);
    let repaired = 0;

    for (const historical of removed) {
      repaired += await this.reconcileRemovedQuote(historical.event);
    }

    if (desired) {
      for (const historical of removed) {
        repaired += await this.reconcileRemovedHedge(historical.event);
      }
      repaired += await this.reconcileCanonical(desired.event);
      return repaired;
    }

    for (const historical of removed) {
      repaired += await this.reconcileRemovedHedge(historical.event);
      repaired += await this.reconcileRemovedPnl(historical.event);
    }
    return repaired;
  }

  private async reconcileCanonical(event: SettlementEventStatusResponse): Promise<number> {
    const hedge = await this.reconciliation.reconcileSettlementEventToHedge(event);
    assertNoErrors(hedge.errors, "RECONCILIATION_HEDGE_FAILED");
    const pnl = await this.reconciliation.reconcileSettlementEventToPnl(event);
    assertNoErrors(pnl.errors, "RECONCILIATION_PNL_FAILED");
    const quote = await this.reconciliation.reconcileSettlementEventToQuote(event);
    assertNoErrors(quote.errors, "RECONCILIATION_QUOTE_FAILED");
    return hedge.repairedHedgeIntents + pnl.repairedPnlRecords + quote.repairedQuoteStatuses;
  }

  private async reconcileRemovedHedge(event: SettlementEventStatusResponse): Promise<number> {
    const report = await this.reconciliation.reconcileRemovedSettlementToHedge(event);
    assertNoErrors(report.errors, "RECONCILIATION_HEDGE_REMOVAL_FAILED");
    return report.removedHedgeIntents;
  }

  private async reconcileRemovedPnl(event: SettlementEventStatusResponse): Promise<number> {
    const report = await this.reconciliation.reconcileRemovedSettlementToPnl(event);
    assertNoErrors(report.errors, "RECONCILIATION_PNL_REMOVAL_FAILED");
    return report.removedPnlRecords;
  }

  private async reconcileRemovedQuote(event: SettlementEventStatusResponse): Promise<number> {
    const report = await this.reconciliation.reconcileRemovedSettlementToQuote(event);
    assertNoErrors(report.errors, "RECONCILIATION_QUOTE_REMOVAL_FAILED");
    return report.repairedQuoteStatuses;
  }

  private async waitForPoll(): Promise<void> {
    if (this.stopped) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.wakePoll = undefined;
        resolve();
      }, this.config.pollIntervalMs);
      this.wakePoll = () => {
        clearTimeout(timer);
        this.wakePoll = undefined;
        resolve();
      };
    });
  }
}

function desiredSettlement(
  job: PostTradeReconciliationJob,
  canonical: ReconciliationSettlementEvent[],
): ReconciliationSettlementEvent | undefined {
  if (job.desiredSettlementEventId === undefined) {
    if (canonical.length !== 0) throw new ReconciliationWorkerError("RECONCILIATION_STATE_CHANGED");
    return undefined;
  }
  if (canonical.length !== 1 || canonical[0].event.settlementEventId !== job.desiredSettlementEventId) {
    throw new ReconciliationWorkerError("RECONCILIATION_STATE_CHANGED");
  }
  return canonical[0];
}

function assertNoErrors(
  errors: readonly unknown[],
  code: ReconciliationWorkerErrorCode,
): void {
  if (errors.length > 0) throw new ReconciliationWorkerError(code);
}

type ReconciliationWorkerErrorCode =
  | "RECONCILIATION_STATE_CHANGED"
  | "RECONCILIATION_HEDGE_FAILED"
  | "RECONCILIATION_PNL_FAILED"
  | "RECONCILIATION_QUOTE_FAILED"
  | "RECONCILIATION_HEDGE_REMOVAL_FAILED"
  | "RECONCILIATION_PNL_REMOVAL_FAILED"
  | "RECONCILIATION_QUOTE_REMOVAL_FAILED";

class ReconciliationWorkerError extends Error {
  constructor(readonly code: ReconciliationWorkerErrorCode) {
    super(code);
  }
}

function reconciliationErrorCode(error: unknown): string {
  return error instanceof ReconciliationWorkerError ? error.code : "RECONCILIATION_DEPENDENCY_FAILED";
}

function retryDelay(baseDelayMs: number, attemptCount: number): number {
  const exponent = Math.min(Math.max(attemptCount - 1, 0), 10);
  return Math.min(baseDelayMs * (2 ** exponent), 3_600_000);
}

function assertStore(store: unknown): asserts store is PostTradeReconciliationJobStore {
  assertDependency(store, "store", [
    "claimNext",
    "listSettlementEvents",
    "markProcessed",
    "releaseForRetry",
  ]);
}

function assertReconciliation(value: unknown): asserts value is ReconciliationService {
  assertDependency(value, "reconciliation", [
    "reconcileSettlementEventToHedge",
    "reconcileSettlementEventToPnl",
    "reconcileSettlementEventToQuote",
    "reconcileRemovedSettlementToHedge",
    "reconcileRemovedSettlementToPnl",
    "reconcileRemovedSettlementToQuote",
  ]);
}

function assertObserver(observer: unknown): asserts observer is PostTradeReconciliationObserver {
  assertDependency(observer, "observer", ["recordJob", "recordIterationError"]);
}

function assertLogger(logger: unknown): asserts logger is PostTradeReconciliationLogger {
  assertDependency(logger, "logger", ["error"]);
}

function assertDependency(value: unknown, field: string, methods: readonly string[]): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Post-trade reconciliation worker ${field} must be an object`);
  }
  for (const method of methods) {
    if (typeof (value as Record<string, unknown>)[method] !== "function") {
      throw new Error(`Post-trade reconciliation worker ${field}.${method} must be a function`);
    }
  }
}

function assertConfig(config: PostTradeReconciliationWorkerConfig): void {
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    throw new Error("Post-trade reconciliation worker config must be an object");
  }
  if (typeof config.workerId !== "string" || config.workerId.length === 0 || config.workerId.length > 128 ||
      !workerIdPattern.test(config.workerId)) {
    throw new Error("Post-trade reconciliation worker workerId is invalid");
  }
  assertConfigInteger(config.leaseMs, "leaseMs", 1_000, 300_000);
  assertConfigInteger(config.pollIntervalMs, "pollIntervalMs", 10, 60_000);
  assertConfigInteger(config.retryDelayMs, "retryDelayMs", 1, 3_600_000);
}

function assertConfigInteger(value: unknown, field: string, min: number, max: number): void {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`Post-trade reconciliation worker ${field} must be between ${min} and ${max}`);
  }
}
