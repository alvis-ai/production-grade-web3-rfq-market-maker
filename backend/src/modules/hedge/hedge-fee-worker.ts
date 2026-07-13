import {
  CexVenueError,
  type CexExecutionAdapter,
  type CexOrderResult,
} from "./binance-spot.adapter.js";
import {
  decimalQuantitiesEqual,
  sumCexTradeQuantity,
} from "./hedge-fee-evidence.js";
import { parseHedgeExecutedQuantity, type HedgeRouteTable } from "./hedge-route.js";
import type {
  HedgeFeeReconciliationJob,
  HedgeFeeStats,
  HedgeFeeStore,
} from "./postgres-hedge-fee.store.js";
import type { HedgeWorkerConfig, HedgeWorkerLogger } from "./hedge-worker.js";

export interface HedgeFeeWorkerResult {
  status: "idle" | "reconciled" | "retry_scheduled";
  hedgeOrderId?: string;
  errorCode?: string;
}

export interface HedgeFeeWorkerObserver {
  recordResult(result: HedgeFeeWorkerResult): void;
  recordIterationError(): void;
}

const maxRetryBackoffMs = 60_000;

export class HedgeFeeWorker {
  private stopped = false;

  constructor(
    private readonly store: HedgeFeeStore,
    private readonly routes: HedgeRouteTable,
    private readonly adapters: ReadonlyMap<"binance", CexExecutionAdapter>,
    private readonly config: HedgeWorkerConfig,
    private readonly logger: HedgeWorkerLogger = consoleLogger,
    private readonly observer: HedgeFeeWorkerObserver = noOpObserver,
  ) {
    assertDependencies(store, routes, adapters, config, logger, observer);
    this.adapters = new Map(adapters);
    this.config = { ...config };
  }

  async runOnce(): Promise<HedgeFeeWorkerResult> {
    const job = await this.store.claimNext(this.config.workerId, this.config.leaseMs);
    if (!job) return { status: "idle" };
    try {
      const route = this.routes.find(job.chainId, job.token);
      if (!route || route.symbol !== job.symbol) throw new Error("HEDGE_ROUTE_NOT_CONFIGURED");
      const adapter = this.adapters.get(route.venue);
      if (!adapter) throw new Error("HEDGE_ROUTE_NOT_CONFIGURED");
      const order = await adapter.queryOrder({ symbol: job.symbol, clientOrderId: job.clientOrderId });
      if (!order) return this.scheduleRetry(job, "HEDGE_FEE_ORDER_UNCONFIRMED");
      assertOrderMatchesJob(order, job, route);
      const fills = await adapter.queryOrderTrades({
        symbol: job.symbol,
        venueOrderId: order.venueOrderId,
      });
      if (fills.length === 0 || fills.some((fill) => fill.isBuyer !== (job.side === "buy")) ||
          !decimalQuantitiesEqual(sumCexTradeQuantity(fills, "quantity"), order.executedQuantity, 36) ||
          !decimalQuantitiesEqual(sumCexTradeQuantity(fills, "quoteQuantity"), order.executedQuoteQuantity, 18)) {
        throw new CexVenueError("HEDGE_TRADE_FILLS_INCOMPLETE", true);
      }
      await this.store.completeReconciliation(
        job.hedgeOrderId,
        this.config.workerId,
        job.filledAmount,
        order.venueOrderId,
        order.executedQuoteQuantity,
        fills,
      );
      return { status: "reconciled", hedgeOrderId: job.hedgeOrderId };
    } catch (error) {
      const normalized = normalizeFeeError(error);
      return this.scheduleRetry(job, normalized.errorCode, normalized.retryAfterMs);
    }
  }

  async run(): Promise<void> {
    this.stopped = false;
    while (!this.stopped) {
      try {
        const result = await this.runOnce();
        this.observer.recordResult(result);
        if (result.status !== "idle") this.logger.info({ ...result }, "hedge fee job processed");
      } catch (error) {
        this.observer.recordIterationError();
        this.logger.error({ error: errorMessage(error) }, "hedge fee worker iteration failed");
      }
      if (!this.stopped) await delay(this.config.pollIntervalMs);
    }
  }

  stop(): void {
    this.stopped = true;
  }

  private async scheduleRetry(
    job: HedgeFeeReconciliationJob,
    errorCode: string,
    retryAfterMs?: number,
  ): Promise<HedgeFeeWorkerResult> {
    await this.store.releaseForRetry(
      job.hedgeOrderId,
      this.config.workerId,
      errorCode,
      Math.max(retryBackoffMs(this.config.retryDelayMs, job.attemptCount), retryAfterMs ?? 0),
    );
    return { status: "retry_scheduled", hedgeOrderId: job.hedgeOrderId, errorCode };
  }
}

export class HedgeFeeWorkerMetrics implements HedgeFeeWorkerObserver {
  private reconciled = 0;
  private retries = 0;
  private iterationErrors = 0;
  private lastProcessedAtSeconds = 0;

  recordResult(result: HedgeFeeWorkerResult): void {
    if (result.status === "idle") return;
    if (result.status === "reconciled") this.reconciled += 1;
    if (result.status === "retry_scheduled") this.retries += 1;
    this.lastProcessedAtSeconds = Math.floor(Date.now() / 1_000);
  }

  recordIterationError(): void {
    this.iterationErrors += 1;
  }

  renderPrometheus(stats?: HedgeFeeStats, nowMs = Date.now()): string {
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
      throw new Error("Hedge fee metrics nowMs must be a non-negative safe integer");
    }
    assertFeeStats(stats);
    const lines = [
      "# HELP rfq_hedge_fee_reconciliations_total Hedge fee reconciliation outcomes.",
      "# TYPE rfq_hedge_fee_reconciliations_total counter",
      `rfq_hedge_fee_reconciliations_total{status="reconciled"} ${this.reconciled}`,
      `rfq_hedge_fee_reconciliations_total{status="retry_scheduled"} ${this.retries}`,
      "# HELP rfq_hedge_fee_iteration_errors_total Fee worker iterations that failed outside a claimed job outcome.",
      "# TYPE rfq_hedge_fee_iteration_errors_total counter",
      `rfq_hedge_fee_iteration_errors_total ${this.iterationErrors}`,
      "# HELP rfq_hedge_fee_last_processed_timestamp_seconds Unix timestamp of the latest non-idle fee result.",
      "# TYPE rfq_hedge_fee_last_processed_timestamp_seconds gauge",
      `rfq_hedge_fee_last_processed_timestamp_seconds ${this.lastProcessedAtSeconds}`,
    ];
    if (stats !== undefined) {
      const oldestDueAgeSeconds = stats.oldestDueAt === undefined
        ? 0
        : Math.max(0, Math.floor((nowMs - Date.parse(stats.oldestDueAt)) / 1_000));
      lines.push(
        "# HELP rfq_hedge_fee_pending Current hedge orders awaiting exact venue fee evidence.",
        "# TYPE rfq_hedge_fee_pending gauge",
        `rfq_hedge_fee_pending ${stats.pendingCount}`,
        "# HELP rfq_hedge_fee_oldest_due_age_seconds Age of the oldest pending hedge fee reconciliation deadline.",
        "# TYPE rfq_hedge_fee_oldest_due_age_seconds gauge",
        `rfq_hedge_fee_oldest_due_age_seconds ${oldestDueAgeSeconds}`,
      );
    }
    lines.push("");
    return lines.join("\n");
  }
}

function assertFeeStats(stats: HedgeFeeStats | undefined): void {
  if (stats === undefined) return;
  if (typeof stats !== "object" || stats === null || Array.isArray(stats) ||
      !Object.hasOwn(stats, "pendingCount") ||
      Object.keys(stats).some((field) => field !== "pendingCount" && field !== "oldestDueAt") ||
      !Number.isSafeInteger(stats.pendingCount) || stats.pendingCount < 0) {
    throw new Error("Hedge fee metrics stats are invalid");
  }
  if (stats.oldestDueAt !== undefined &&
      (typeof stats.oldestDueAt !== "string" || Number.isNaN(Date.parse(stats.oldestDueAt)) ||
       new Date(stats.oldestDueAt).toISOString() !== stats.oldestDueAt)) {
    throw new Error("Hedge fee metrics oldestDueAt must be canonical UTC ISO");
  }
  if ((stats.pendingCount === 0) !== (stats.oldestDueAt === undefined)) {
    throw new Error("Hedge fee metrics stats are inconsistent");
  }
}

function assertOrderMatchesJob(
  order: CexOrderResult,
  job: HedgeFeeReconciliationJob,
  route: NonNullable<ReturnType<HedgeRouteTable["find"]>>,
): void {
  if (job.venueOrderId !== undefined && job.venueOrderId !== order.venueOrderId) {
    throw new CexVenueError("HEDGE_VENUE_RESPONSE_INVALID", true);
  }
  const filledAmount = parseHedgeExecutedQuantity(order.executedQuantity, route);
  if (filledAmount !== job.filledAmount || order.executedQuoteQuantity === "0" ||
      (job.executedQuoteQuantity !== undefined &&
        !decimalQuantitiesEqual(job.executedQuoteQuantity, order.executedQuoteQuantity, 18))) {
    throw new CexVenueError("HEDGE_VENUE_RESPONSE_INVALID", true);
  }
}

function normalizeFeeError(error: unknown): { errorCode: string; retryAfterMs?: number } {
  if (error instanceof CexVenueError) {
    return {
      errorCode: error.errorCode,
      ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs }),
    };
  }
  if (error instanceof Error && /^[A-Z0-9_:-]{1,128}$/.test(error.message)) {
    return { errorCode: error.message };
  }
  return { errorCode: "HEDGE_FEE_WORKER_INTERNAL" };
}

function retryBackoffMs(baseDelayMs: number, attemptCount: number): number {
  const exponent = Math.min(Math.max(attemptCount - 1, 0), 30);
  return Math.min(baseDelayMs * (2 ** exponent), maxRetryBackoffMs);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown hedge fee worker error";
}

const consoleLogger: HedgeWorkerLogger = {
  info(fields, message) {
    console.info(JSON.stringify({ level: "info", message, ...fields }));
  },
  error(fields, message) {
    console.error(JSON.stringify({ level: "error", message, ...fields }));
  },
};

const noOpObserver: HedgeFeeWorkerObserver = {
  recordResult() {},
  recordIterationError() {},
};

function assertDependencies(
  store: HedgeFeeStore,
  routes: HedgeRouteTable,
  adapters: ReadonlyMap<"binance", CexExecutionAdapter>,
  config: HedgeWorkerConfig,
  logger: HedgeWorkerLogger,
  observer: HedgeFeeWorkerObserver,
): void {
  if (typeof store !== "object" || store === null ||
      ["stats", "claimNext", "completeReconciliation", "releaseForRetry"].some(
        (method) => typeof (store as unknown as Record<string, unknown>)[method] !== "function",
      )) {
    throw new Error("Hedge fee worker store is invalid");
  }
  if (typeof routes !== "object" || routes === null || typeof routes.find !== "function") {
    throw new Error("Hedge fee worker routes.find must be a function");
  }
  if (!(adapters instanceof Map) || adapters.size === 0 || [...adapters].some(([venue, adapter]) =>
    venue !== "binance" || typeof adapter !== "object" || adapter === null ||
    typeof adapter.queryOrder !== "function" || typeof adapter.queryOrderTrades !== "function")) {
    throw new Error("Hedge fee worker adapter entry is invalid");
  }
  if (typeof config !== "object" || config === null || Array.isArray(config) ||
      typeof config.workerId !== "string" || !/^[A-Za-z0-9_:-]{1,128}$/.test(config.workerId) ||
      !isBoundedInteger(config.leaseMs, 1_000, 300_000) ||
      !isBoundedInteger(config.pollIntervalMs, 10, 60_000) ||
      !isBoundedInteger(config.retryDelayMs, 1, 3_600_000)) {
    throw new Error("Hedge fee worker config is invalid");
  }
  if (typeof logger !== "object" || logger === null || typeof logger.info !== "function" ||
      typeof logger.error !== "function") {
    throw new Error("Hedge fee worker logger is invalid");
  }
  if (typeof observer !== "object" || observer === null || typeof observer.recordResult !== "function" ||
      typeof observer.recordIterationError !== "function") {
    throw new Error("Hedge fee worker observer is invalid");
  }
}

function isBoundedInteger(value: number, min: number, max: number): boolean {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}
