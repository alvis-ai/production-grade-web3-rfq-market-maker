import type {
  PostTradeReconciliationObserver,
  ReconciliationJobOutcome,
} from "./post-trade-reconciliation.worker.js";
import type { PostTradeReconciliationStats } from "./postgres-post-trade-reconciliation.store.js";

const outcomes: readonly ReconciliationJobOutcome[] = [
  "repaired",
  "already_consistent",
  "retry_scheduled",
  "stale_revision",
];

export class PostTradeReconciliationMetrics implements PostTradeReconciliationObserver {
  private readonly jobs = new Map<ReconciliationJobOutcome, number>(outcomes.map((outcome) => [outcome, 0]));
  private iterationErrors = 0;
  private lastProcessedTimestampSeconds = 0;

  recordJob(outcome: ReconciliationJobOutcome): void {
    if (!outcomes.includes(outcome)) throw new Error("Post-trade reconciliation metric outcome is invalid");
    this.jobs.set(outcome, (this.jobs.get(outcome) ?? 0) + 1);
    if (outcome === "repaired" || outcome === "already_consistent") {
      this.lastProcessedTimestampSeconds = Math.floor(Date.now() / 1_000);
    }
  }

  recordIterationError(): void {
    this.iterationErrors += 1;
  }

  renderPrometheus(stats?: PostTradeReconciliationStats, nowMs = Date.now()): string {
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
      throw new Error("Post-trade reconciliation metrics nowMs must be a non-negative safe integer");
    }
    assertStats(stats);
    const pendingCount = stats?.pendingCount ?? 0;
    const oldestAgeSeconds = stats?.oldestPendingRequestedAt
      ? Math.max(0, Math.floor((nowMs - Date.parse(stats.oldestPendingRequestedAt)) / 1_000))
      : 0;
    return [
      "# HELP rfq_reconciliation_jobs_total Post-trade reconciliation jobs by bounded outcome.",
      "# TYPE rfq_reconciliation_jobs_total counter",
      ...outcomes.map((outcome) => `rfq_reconciliation_jobs_total{outcome="${outcome}"} ${this.jobs.get(outcome) ?? 0}`),
      "# HELP rfq_reconciliation_iteration_errors_total Reconciliation polling iterations that failed outside a leased job.",
      "# TYPE rfq_reconciliation_iteration_errors_total counter",
      `rfq_reconciliation_iteration_errors_total ${this.iterationErrors}`,
      "# HELP rfq_reconciliation_pending_jobs Durable post-trade jobs whose desired revision is not processed.",
      "# TYPE rfq_reconciliation_pending_jobs gauge",
      `rfq_reconciliation_pending_jobs ${pendingCount}`,
      "# HELP rfq_reconciliation_oldest_pending_age_seconds Age of the oldest pending desired revision.",
      "# TYPE rfq_reconciliation_oldest_pending_age_seconds gauge",
      `rfq_reconciliation_oldest_pending_age_seconds ${oldestAgeSeconds}`,
      "# HELP rfq_reconciliation_last_processed_timestamp_seconds Unix timestamp of the last consistent desired revision.",
      "# TYPE rfq_reconciliation_last_processed_timestamp_seconds gauge",
      `rfq_reconciliation_last_processed_timestamp_seconds ${this.lastProcessedTimestampSeconds}`,
      "",
    ].join("\n");
  }
}

function assertStats(stats: PostTradeReconciliationStats | undefined): void {
  if (stats === undefined) return;
  if (typeof stats !== "object" || stats === null || Array.isArray(stats)) {
    throw new Error("Post-trade reconciliation metrics stats must be an object");
  }
  if (!Number.isSafeInteger(stats.pendingCount) || stats.pendingCount < 0) {
    throw new Error("Post-trade reconciliation metrics pendingCount must be non-negative");
  }
  if (stats.oldestPendingRequestedAt !== undefined) {
    const timestamp = stats.oldestPendingRequestedAt;
    if (typeof timestamp !== "string" || Number.isNaN(Date.parse(timestamp)) ||
        new Date(timestamp).toISOString() !== timestamp) {
      throw new Error("Post-trade reconciliation metrics oldestPendingRequestedAt must be canonical UTC ISO");
    }
  }
}
