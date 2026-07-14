import { isCanonicalUtcIsoTimestamp } from "../../shared/validation/timestamp.js";
import { requireTokenMetadata, type TokenRegistry } from "../pricing/token-registry.js";
import {
  ToxicFlowScoreConflictError,
  type ToxicFlowScoreStore,
} from "./toxic-flow-score.store.js";
import {
  calculateToxicFlowMarkout,
  type ToxicFlowMarkoutJob,
  type ToxicFlowMarkoutStats,
  type ToxicFlowMarkoutStore,
} from "./toxic-flow-markout.js";

export interface ToxicFlowAnalyzerConfig {
  workerId: string;
  leaseMs: number;
  pollIntervalMs: number;
  retryDelayMs: number;
  horizonSeconds: number;
  maxSnapshotLagSeconds: number;
  windowSeconds: number;
  scoreScale: number;
  policyVersion: string;
}

export interface ToxicFlowAnalyzerResult {
  status: "idle" | "scored" | "invalidated" | "retry_scheduled";
  settlementEventId?: string;
  errorCode?: string;
}

export interface ToxicFlowAnalyzerObserver {
  recordResult(result: ToxicFlowAnalyzerResult): void;
  recordIterationError(): void;
}

export class ToxicFlowAnalyzerMetrics implements ToxicFlowAnalyzerObserver {
  private scored = 0;
  private invalidated = 0;
  private retries = 0;
  private iterationErrors = 0;
  private lastProcessedAtSeconds = 0;

  recordResult(result: ToxicFlowAnalyzerResult): void {
    if (result.status === "idle") return;
    if (result.status === "scored") this.scored += 1;
    if (result.status === "invalidated") this.invalidated += 1;
    if (result.status === "retry_scheduled") this.retries += 1;
    this.lastProcessedAtSeconds = Math.floor(Date.now() / 1_000);
  }

  recordIterationError(): void {
    this.iterationErrors += 1;
  }

  renderPrometheus(stats?: ToxicFlowMarkoutStats, nowMs = Date.now()): string {
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
      throw new Error("Toxic-flow analyzer metrics clock is invalid");
    }
    const normalizedStats = normalizeStats(stats);
    const oldestEligibleAtMs = normalizedStats.oldestEligibleAt === undefined
      ? nowMs
      : Date.parse(normalizedStats.oldestEligibleAt);
    const oldestEligibleAgeSeconds = normalizedStats.oldestEligibleAt === undefined
      ? 0
      : Math.max(0, Math.floor((nowMs - oldestEligibleAtMs) / 1_000));
    return [
      "# HELP rfq_toxic_flow_markouts_total Toxic-flow analyzer outcomes.",
      "# TYPE rfq_toxic_flow_markouts_total counter",
      `rfq_toxic_flow_markouts_total{outcome="scored"} ${this.scored}`,
      `rfq_toxic_flow_markouts_total{outcome="invalidated"} ${this.invalidated}`,
      `rfq_toxic_flow_markouts_total{outcome="retry_scheduled"} ${this.retries}`,
      "# HELP rfq_toxic_flow_analyzer_iteration_errors_total Analyzer loop failures outside a claimed job.",
      "# TYPE rfq_toxic_flow_analyzer_iteration_errors_total counter",
      `rfq_toxic_flow_analyzer_iteration_errors_total ${this.iterationErrors}`,
      "# HELP rfq_toxic_flow_markout_pending Pending settlement markout jobs.",
      "# TYPE rfq_toxic_flow_markout_pending gauge",
      `rfq_toxic_flow_markout_pending ${normalizedStats.pendingCount}`,
      "# HELP rfq_toxic_flow_markout_oldest_eligible_age_seconds Age of the oldest pending eligible markout.",
      "# TYPE rfq_toxic_flow_markout_oldest_eligible_age_seconds gauge",
      `rfq_toxic_flow_markout_oldest_eligible_age_seconds ${oldestEligibleAgeSeconds}`,
      "# HELP rfq_toxic_flow_analyzer_last_processed_timestamp_seconds Latest non-idle analyzer result.",
      "# TYPE rfq_toxic_flow_analyzer_last_processed_timestamp_seconds gauge",
      `rfq_toxic_flow_analyzer_last_processed_timestamp_seconds ${this.lastProcessedAtSeconds}`,
      "",
    ].join("\n");
  }
}

const noopObserver: ToxicFlowAnalyzerObserver = {
  recordResult(): void {},
  recordIterationError(): void {},
};

export class ToxicFlowAnalyzerWorker {
  private stopped = false;

  constructor(
    private readonly markouts: ToxicFlowMarkoutStore,
    private readonly scores: ToxicFlowScoreStore,
    private readonly tokens: TokenRegistry,
    private readonly config: ToxicFlowAnalyzerConfig,
    private readonly observer: ToxicFlowAnalyzerObserver = noopObserver,
  ) {
    assertConfig(config);
  }

  async runOnce(): Promise<ToxicFlowAnalyzerResult> {
    const job = await this.markouts.claimNext(
      this.config.workerId,
      this.config.leaseMs,
      this.config.horizonSeconds,
    );
    if (!job) return { status: "idle" };

    try {
      if (!job.desiredCanonical) {
        await this.markouts.invalidateMarkout(job);
        await this.publish(job);
        await this.markouts.complete(job, this.config.workerId);
        return { status: "invalidated", settlementEventId: job.settlementEventId };
      }

      const snapshot = await this.markouts.findPostTradeSnapshot(
        job,
        this.config.horizonSeconds,
        this.config.maxSnapshotLagSeconds,
      );
      if (!snapshot) return this.retry(job, "MARKOUT_SNAPSHOT_UNAVAILABLE");

      const tokenIn = requireTokenMetadata(
        this.tokens,
        job.chainId,
        job.tokenIn,
        "Toxic-flow analyzer tokenIn",
      );
      const tokenOut = requireTokenMetadata(
        this.tokens,
        job.chainId,
        job.tokenOut,
        "Toxic-flow analyzer tokenOut",
      );
      const result = calculateToxicFlowMarkout(
        job.amountIn,
        job.amountOut,
        tokenIn.decimals,
        tokenOut.decimals,
        snapshot.midPrice,
        this.config.scoreScale,
      );
      await this.markouts.upsertMarkout(
        job,
        snapshot,
        result,
        this.config.horizonSeconds,
        this.config.policyVersion,
      );
      await this.publish(job);
      await this.markouts.complete(job, this.config.workerId);
      return { status: "scored", settlementEventId: job.settlementEventId };
    } catch (error) {
      return this.retry(job, errorCode(error));
    }
  }

  async run(): Promise<void> {
    this.stopped = false;
    while (!this.stopped) {
      try {
        const result = await this.runOnce();
        this.observer.recordResult(result);
      } catch {
        this.observer.recordIterationError();
      }
      if (!this.stopped) await delay(this.config.pollIntervalMs);
    }
  }

  stop(): void {
    this.stopped = true;
  }

  private async publish(job: ToxicFlowMarkoutJob): Promise<void> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const aggregate = await this.markouts.aggregateUser(
        job.chainId,
        job.user,
        this.config.windowSeconds,
      );
      const current = await this.scores.getScore({ chainId: job.chainId, user: job.user });
      try {
        await this.scores.updateScore(
          { chainId: job.chainId, user: job.user },
          {
            scoreBps: aggregate.scoreBps,
            postTradeDriftBps: aggregate.averagePostTradeDriftBps,
            sampleSize: aggregate.sampleSize,
            windowSeconds: this.config.windowSeconds,
            policyVersion: this.config.policyVersion,
            observedAt: aggregate.observedAt,
            expectedVersion: current?.version ?? 0,
          },
          `toxic_analyzer:${this.config.workerId}`,
        );
        return;
      } catch (error) {
        if (!(error instanceof ToxicFlowScoreConflictError) || attempt === 4) throw error;
      }
    }
  }

  private async retry(job: ToxicFlowMarkoutJob, code: string): Promise<ToxicFlowAnalyzerResult> {
    const exponent = Math.min(Math.max(job.attemptCount - 1, 0), 10);
    const delayMs = Math.min(this.config.retryDelayMs * 2 ** exponent, 3_600_000);
    await this.markouts.releaseForRetry(job, this.config.workerId, code, delayMs);
    return {
      status: "retry_scheduled",
      settlementEventId: job.settlementEventId,
      errorCode: code,
    };
  }
}

function normalizeStats(stats: ToxicFlowMarkoutStats | undefined): ToxicFlowMarkoutStats {
  if (stats === undefined) return { pendingCount: 0 };
  if (!Number.isSafeInteger(stats.pendingCount) || stats.pendingCount < 0) {
    throw new Error("Toxic-flow analyzer metrics stats are invalid");
  }
  if (stats.oldestEligibleAt !== undefined &&
      !isCanonicalUtcIsoTimestamp(stats.oldestEligibleAt)) {
    throw new Error("Toxic-flow analyzer metrics stats are invalid");
  }
  if (stats.pendingCount === 0 && stats.oldestEligibleAt !== undefined) {
    throw new Error("Toxic-flow analyzer metrics stats are inconsistent");
  }
  if (stats.pendingCount > 0 && stats.oldestEligibleAt === undefined) {
    throw new Error("Toxic-flow analyzer metrics stats are inconsistent");
  }
  return stats;
}

function errorCode(error: unknown): string {
  if (error instanceof Error && /^[A-Z0-9_:-]{1,128}$/.test(error.message)) {
    return error.message;
  }
  return "TOXIC_FLOW_ANALYZER_INTERNAL";
}

function assertConfig(config: ToxicFlowAnalyzerConfig): void {
  if (typeof config !== "object" || config === null ||
      typeof config.workerId !== "string" ||
      !/^[A-Za-z0-9_:-]{1,128}$/.test(config.workerId) ||
      typeof config.policyVersion !== "string" ||
      !/^[A-Za-z0-9_:-]{1,128}$/.test(config.policyVersion)) {
    throw new Error("Toxic-flow analyzer config is invalid");
  }
  const integerBounds: Array<[number, number, number]> = [
    [config.leaseMs, 1_000, 300_000],
    [config.pollIntervalMs, 10, 60_000],
    [config.retryDelayMs, 1, 3_600_000],
    [config.horizonSeconds, 1, 604_800],
    [config.maxSnapshotLagSeconds, 0, 604_800],
    [config.windowSeconds, 1, 604_800],
    [config.scoreScale, 1, 10_000],
  ];
  for (const [value, min, max] of integerBounds) {
    if (!Number.isSafeInteger(value) || value < min || value > max) {
      throw new Error("Toxic-flow analyzer config is invalid");
    }
  }
  if (config.windowSeconds < config.horizonSeconds ||
      config.horizonSeconds + config.maxSnapshotLagSeconds > 604_800) {
    throw new Error("Toxic-flow analyzer config is invalid");
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
