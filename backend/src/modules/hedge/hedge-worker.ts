import {
  CexVenueError,
  type CexExecutionAdapter,
  type CexOrderResult,
} from "./binance-spot.adapter.js";
import {
  buildHedgeClientOrderId,
  formatHedgeQuantity,
  parseHedgeExecutedQuantity,
  quantizeHedgeAmount,
  routeForJob,
  type HedgeRoute,
  type HedgeRouteTable,
} from "./hedge-route.js";
import type { UIntString } from "../../shared/types/rfq.js";
import type { HedgeJob, HedgeJobStore } from "./postgres-hedge-job.store.js";
import { parseCexQuoteQuantity } from "./hedge-execution-evidence.js";

export interface HedgeWorkerConfig {
  workerId: string;
  leaseMs: number;
  pollIntervalMs: number;
  retryDelayMs: number;
}

export interface HedgeWorkerLogger {
  info(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
}

export interface HedgeWorkerResult {
  status: "idle" | "filled" | "failed" | "retry_scheduled";
  hedgeOrderId?: string;
  errorCode?: string;
}

export interface HedgeWorkerObserver {
  recordResult(result: HedgeWorkerResult): void;
  recordIterationError(): void;
}

const workerIdPattern = /^[A-Za-z0-9_:-]+$/;
const maxRetryBackoffMs = 60_000;

export class HedgeWorker {
  private stopped = false;

  constructor(
    private readonly store: HedgeJobStore,
    private readonly routes: HedgeRouteTable,
    private readonly adapters: ReadonlyMap<"binance", CexExecutionAdapter>,
    private readonly config: HedgeWorkerConfig,
    private readonly logger: HedgeWorkerLogger = consoleLogger,
    private readonly observer: HedgeWorkerObserver = noOpObserver,
  ) {
    assertStore(store);
    assertRoutes(routes);
    assertAdapters(adapters);
    assertWorkerConfig(config);
    assertLogger(logger);
    assertObserver(observer);
    this.config = { ...config };
    this.adapters = new Map(adapters);
  }

  async runOnce(): Promise<HedgeWorkerResult> {
    const job = await this.store.claimNext(this.config.workerId, this.config.leaseMs);
    if (!job) return { status: "idle" };

    try {
      const route = routeForJob(this.routes, job);
      const clientOrderId = buildHedgeClientOrderId(job.hedgeOrderId);
      const targetAmount = quantizeHedgeAmount(job.amount, route);
      const quantity = formatHedgeQuantity(job.amount, route);
      await this.store.prepareRoute(job.hedgeOrderId, this.config.workerId, {
        venue: route.venue,
        symbol: route.symbol,
        clientOrderId,
        baseAsset: route.baseAsset,
        quoteAsset: route.quoteAsset,
        quoteToken: route.quoteToken,
        baseTokenDecimals: route.tokenDecimals,
        quoteTokenDecimals: route.quoteTokenDecimals,
      });
      const adapter = this.adapters.get(route.venue)!;
      const existing = await adapter.queryOrder({ symbol: route.symbol, clientOrderId });
      let order: CexOrderResult;
      if (existing) {
        await this.store.recordExternalOrderObserved(job.hedgeOrderId, this.config.workerId);
        order = existing;
      } else {
        if (job.submissionAttempted) {
          return this.scheduleRetry(job, "HEDGE_SUBMISSION_UNCONFIRMED");
        }
        await this.store.authorizeSubmission(job.hedgeOrderId, this.config.workerId);
        order = await adapter.submitMarketOrder({
          symbol: route.symbol,
          side: job.side,
          quantity,
          clientOrderId,
        });
      }
      return await this.applyOrderResult(job, route, targetAmount, order);
    } catch (error) {
      return this.handleJobError(job, error);
    }
  }

  async run(): Promise<void> {
    this.stopped = false;
    while (!this.stopped) {
      try {
        const result = await this.runOnce();
        this.observer.recordResult(result);
        if (result.status !== "idle") {
          this.logger.info({ ...result }, "hedge job processed");
        }
      } catch (error) {
        this.observer.recordIterationError();
        this.logger.error(
          { errorCode: normalizeJobError(error).errorCode },
          "hedge worker iteration failed",
        );
      }
      if (!this.stopped) await delay(this.config.pollIntervalMs);
    }
  }

  stop(): void {
    this.stopped = true;
  }

  private async applyOrderResult(
    job: HedgeJob,
    route: HedgeRoute,
    targetAmount: UIntString,
    order: CexOrderResult,
  ): Promise<HedgeWorkerResult> {
    assertOrderResult(order);
    const filledAmount = parseHedgeExecutedQuantity(order.executedQuantity, route);
    const executedQuoteQuantity = parseCexQuoteQuantity(order.executedQuoteQuantity);
    if ((filledAmount === undefined) !== (executedQuoteQuantity === undefined)) {
      throw new CexVenueError("HEDGE_VENUE_RESPONSE_INVALID", true);
    }
    if (filledAmount !== undefined && BigInt(filledAmount) > BigInt(targetAmount)) {
      throw new CexVenueError("HEDGE_VENUE_RESPONSE_INVALID", true);
    }
    if (order.state === "filled") {
      if (filledAmount === undefined || filledAmount !== targetAmount) {
        throw new CexVenueError("HEDGE_VENUE_RESPONSE_INVALID", true);
      }
      await this.store.completeFilled(
        job.hedgeOrderId,
        this.config.workerId,
        order.externalOrderId,
        order.venueOrderId,
        filledAmount,
        executedQuoteQuantity!,
      );
      return { status: "filled", hedgeOrderId: job.hedgeOrderId };
    }
    if (order.state === "failed") {
      const errorCode = order.failureCode ?? "HEDGE_VENUE_REJECTED";
      await this.store.completeFailed(
        job.hedgeOrderId,
        this.config.workerId,
        errorCode,
        order.externalOrderId,
        order.venueOrderId,
        filledAmount,
        executedQuoteQuantity,
      );
      return { status: "failed", hedgeOrderId: job.hedgeOrderId, errorCode };
    }
    if (filledAmount !== undefined) {
      await this.store.recordExecutionProgress(
        job.hedgeOrderId,
        this.config.workerId,
        order.externalOrderId,
        order.venueOrderId,
        filledAmount,
        executedQuoteQuantity!,
      );
    }
    return this.scheduleRetry(job, "HEDGE_ORDER_PENDING");
  }

  private async handleJobError(job: HedgeJob, error: unknown): Promise<HedgeWorkerResult> {
    const normalized = normalizeJobError(error);
    if (!normalized.retryable) {
      if (job.submissionAttempted) {
        return this.scheduleRetry(job, normalized.errorCode, normalized.retryAfterMs);
      }
      await this.store.completeFailed(job.hedgeOrderId, this.config.workerId, normalized.errorCode);
      return { status: "failed", hedgeOrderId: job.hedgeOrderId, errorCode: normalized.errorCode };
    }
    return this.scheduleRetry(job, normalized.errorCode, normalized.retryAfterMs);
  }

  private async scheduleRetry(job: HedgeJob, errorCode: string, retryAfterMs?: number): Promise<HedgeWorkerResult> {
    await this.store.releaseForRetry(
      job.hedgeOrderId,
      this.config.workerId,
      errorCode,
      Math.max(retryBackoffMs(this.config.retryDelayMs, job.attemptCount), retryAfterMs ?? 0),
    );
    return { status: "retry_scheduled", hedgeOrderId: job.hedgeOrderId, errorCode };
  }
}

function retryBackoffMs(baseDelayMs: number, attemptCount: number): number {
  const exponent = Math.min(Math.max(attemptCount - 1, 0), 30);
  return Math.min(baseDelayMs * (2 ** exponent), maxRetryBackoffMs);
}

export class HedgeWorkerMetrics implements HedgeWorkerObserver {
  private readonly jobs = { filled: 0, failed: 0, retry_scheduled: 0 };
  private iterationErrors = 0;
  private lastProcessedAtSeconds = 0;

  recordResult(result: HedgeWorkerResult): void {
    if (result.status === "idle") return;
    this.jobs[result.status] += 1;
    this.lastProcessedAtSeconds = Math.floor(Date.now() / 1_000);
  }

  recordIterationError(): void {
    this.iterationErrors += 1;
  }

  renderPrometheus(): string {
    return [
      "# HELP rfq_hedge_worker_jobs_total Hedge jobs processed by terminal or retry outcome.",
      "# TYPE rfq_hedge_worker_jobs_total counter",
      `rfq_hedge_worker_jobs_total{status="filled"} ${this.jobs.filled}`,
      `rfq_hedge_worker_jobs_total{status="failed"} ${this.jobs.failed}`,
      `rfq_hedge_worker_jobs_total{status="retry_scheduled"} ${this.jobs.retry_scheduled}`,
      "# HELP rfq_hedge_worker_iteration_errors_total Hedge worker iterations that failed outside a claimed job outcome.",
      "# TYPE rfq_hedge_worker_iteration_errors_total counter",
      `rfq_hedge_worker_iteration_errors_total ${this.iterationErrors}`,
      "# HELP rfq_hedge_worker_last_processed_timestamp_seconds Unix timestamp of the latest non-idle hedge result.",
      "# TYPE rfq_hedge_worker_last_processed_timestamp_seconds gauge",
      `rfq_hedge_worker_last_processed_timestamp_seconds ${this.lastProcessedAtSeconds}`,
      "",
    ].join("\n");
  }
}

function normalizeJobError(error: unknown): { errorCode: string; retryable: boolean; retryAfterMs?: number } {
  if (error instanceof CexVenueError) {
    return {
      errorCode: error.errorCode,
      retryable: error.retryable,
      ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs }),
    };
  }
  if (error instanceof Error && (error.message === "HEDGE_ROUTE_NOT_CONFIGURED" ||
      error.message === "HEDGE_ROUTE_REFERENCE_TOKEN_MISMATCH" ||
      error.message === "HEDGE_AMOUNT_BELOW_STEP_SIZE" || error.message === "HEDGE_SETTLEMENT_NON_CANONICAL")) {
    return { errorCode: error.message, retryable: false };
  }
  if (error instanceof Error && (error.message === "HEDGE_EXECUTED_QUANTITY_INVALID" ||
      error.message === "HEDGE_EXECUTED_QUOTE_QUANTITY_INVALID")) {
    return { errorCode: error.message, retryable: true };
  }
  return { errorCode: "HEDGE_WORKER_INTERNAL", retryable: true };
}

function assertOrderResult(result: CexOrderResult): void {
  if (typeof result !== "object" || result === null || Array.isArray(result)) {
    throw new CexVenueError("HEDGE_VENUE_RESPONSE_INVALID", true);
  }
  const expectedFields = result.state === "failed"
    ? new Set(["state", "externalOrderId", "venueOrderId", "executedQuantity", "executedQuoteQuantity", "failureCode"])
    : new Set(["state", "externalOrderId", "venueOrderId", "executedQuantity", "executedQuoteQuantity"]);
  if (Object.keys(result).some((field) => !expectedFields.has(field)) ||
      !Object.prototype.hasOwnProperty.call(result, "state") ||
      !Object.prototype.hasOwnProperty.call(result, "externalOrderId") ||
      !Object.prototype.hasOwnProperty.call(result, "venueOrderId") ||
      !Object.prototype.hasOwnProperty.call(result, "executedQuantity") ||
      !Object.prototype.hasOwnProperty.call(result, "executedQuoteQuantity")) {
    throw new CexVenueError("HEDGE_VENUE_RESPONSE_INVALID", true);
  }
  if (result.state !== "pending" && result.state !== "filled" && result.state !== "failed") {
    throw new CexVenueError("HEDGE_VENUE_RESPONSE_INVALID", true);
  }
  if (typeof result.externalOrderId !== "string" || result.externalOrderId.trim().length === 0 ||
      result.externalOrderId.length > 128) {
    throw new CexVenueError("HEDGE_VENUE_RESPONSE_INVALID", true);
  }
  if (typeof result.venueOrderId !== "string" || !/^[1-9][0-9]{0,15}$/.test(result.venueOrderId) ||
      !Number.isSafeInteger(Number(result.venueOrderId))) {
    throw new CexVenueError("HEDGE_VENUE_RESPONSE_INVALID", true);
  }
  if (result.failureCode !== undefined &&
      (typeof result.failureCode !== "string" || !/^[A-Z0-9_:-]{1,128}$/.test(result.failureCode))) {
    throw new CexVenueError("HEDGE_VENUE_RESPONSE_INVALID", true);
  }
  if (typeof result.executedQuantity !== "string" ||
      !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(result.executedQuantity)) {
    throw new CexVenueError("HEDGE_VENUE_RESPONSE_INVALID", true);
  }
  if (typeof result.executedQuoteQuantity !== "string" ||
      !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(result.executedQuoteQuantity)) {
    throw new CexVenueError("HEDGE_VENUE_RESPONSE_INVALID", true);
  }
}

function assertWorkerConfig(config: HedgeWorkerConfig): void {
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    throw new Error("Hedge worker config must be an object");
  }
  const fields = ["workerId", "leaseMs", "pollIntervalMs", "retryDelayMs"];
  if (Object.keys(config).length !== fields.length ||
      fields.some((field) => !Object.prototype.hasOwnProperty.call(config, field))) {
    throw new Error("Hedge worker config fields are invalid");
  }
  if (typeof config.workerId !== "string" || config.workerId.length === 0 || config.workerId.length > 128 ||
      !workerIdPattern.test(config.workerId)) {
    throw new Error("Hedge worker workerId must be a safe identifier");
  }
  assertInteger(config.leaseMs, "leaseMs", 1_000, 300_000);
  assertInteger(config.pollIntervalMs, "pollIntervalMs", 10, 60_000);
  assertInteger(config.retryDelayMs, "retryDelayMs", 1, 3_600_000);
}

function assertStore(store: HedgeJobStore): void {
  if (typeof store !== "object" || store === null || Array.isArray(store)) {
    throw new Error("Hedge worker store must be an object");
  }
  for (const method of [
    "claimNext",
    "prepareRoute",
    "authorizeSubmission",
    "recordExternalOrderObserved",
    "recordExecutionProgress",
    "completeFilled",
    "completeFailed",
    "releaseForRetry",
  ]) {
    if (typeof (store as unknown as Record<string, unknown>)[method] !== "function") {
      throw new Error(`Hedge worker store.${method} must be a function`);
    }
  }
}

function assertRoutes(routes: HedgeRouteTable): void {
  if (typeof routes !== "object" || routes === null || typeof routes.find !== "function") {
    throw new Error("Hedge worker routes.find must be a function");
  }
}

function assertAdapters(adapters: ReadonlyMap<"binance", CexExecutionAdapter>): void {
  if (!(adapters instanceof Map) || adapters.size === 0) {
    throw new Error("Hedge worker adapters must be a non-empty Map");
  }
  for (const [venue, adapter] of adapters) {
    if (venue !== "binance" || typeof adapter !== "object" || adapter === null ||
        typeof adapter.queryOrder !== "function" || typeof adapter.submitMarketOrder !== "function") {
      throw new Error("Hedge worker adapter entry is invalid");
    }
  }
}

function assertLogger(logger: HedgeWorkerLogger): void {
  if (typeof logger !== "object" || logger === null || typeof logger.info !== "function" ||
      typeof logger.error !== "function") {
    throw new Error("Hedge worker logger must expose info and error functions");
  }
}

function assertObserver(observer: HedgeWorkerObserver): void {
  if (typeof observer !== "object" || observer === null || typeof observer.recordResult !== "function" ||
      typeof observer.recordIterationError !== "function") {
    throw new Error("Hedge worker observer must expose recordResult and recordIterationError functions");
  }
}

function assertInteger(value: number, field: string, min: number, max: number): void {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`Hedge worker ${field} must be a safe integer between ${min} and ${max}`);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const consoleLogger: HedgeWorkerLogger = {
  info(fields, message) {
    console.info(JSON.stringify({ level: "info", message, ...fields }));
  },
  error(fields, message) {
    console.error(JSON.stringify({ level: "error", message, ...fields }));
  },
};

const noOpObserver: HedgeWorkerObserver = {
  recordResult() {},
  recordIterationError() {},
};
