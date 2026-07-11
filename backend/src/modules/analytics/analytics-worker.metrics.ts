import type { AnalyticsConsumerObserver } from "./kafka-analytics.consumer.js";
import type { AnalyticsOutboxObserver } from "./analytics-outbox.publisher.js";
import type { AnalyticsOutboxStats } from "./postgres-analytics-outbox.store.js";

export class AnalyticsWorkerMetrics implements AnalyticsOutboxObserver, AnalyticsConsumerObserver {
  private published = 0;
  private publishRetries = 0;
  private deleted = 0;
  private iterationErrors = 0;
  private consumed = 0;
  private consumerErrors = 0;
  private lastPublishedAtSeconds = 0;
  private lastConsumedAtSeconds = 0;

  recordPublished(count: number): void {
    assertPositiveCount(count);
    this.published += count;
    this.lastPublishedAtSeconds = nowSeconds();
  }

  recordRetry(count: number): void {
    assertPositiveCount(count);
    this.publishRetries += count;
  }

  recordDeleted(count: number): void {
    assertPositiveCount(count);
    this.deleted += count;
  }

  recordIterationError(): void {
    this.iterationErrors += 1;
  }

  recordConsumed(count: number): void {
    assertPositiveCount(count);
    this.consumed += count;
    this.lastConsumedAtSeconds = nowSeconds();
  }

  recordConsumerError(): void {
    this.consumerErrors += 1;
  }

  renderPrometheus(stats?: AnalyticsOutboxStats, nowMs: number = Date.now()): string {
    if (!Number.isSafeInteger(nowMs) || nowMs <= 0) throw new Error("Analytics metrics clock is invalid");
    const lines = [
      "# HELP rfq_analytics_outbox_published_total Outbox events acknowledged by Kafka and marked published.",
      "# TYPE rfq_analytics_outbox_published_total counter",
      `rfq_analytics_outbox_published_total ${this.published}`,
      "# HELP rfq_analytics_outbox_retries_total Outbox events released for retry after publish failures.",
      "# TYPE rfq_analytics_outbox_retries_total counter",
      `rfq_analytics_outbox_retries_total ${this.publishRetries}`,
      "# HELP rfq_analytics_outbox_deleted_total Published outbox rows removed after retention.",
      "# TYPE rfq_analytics_outbox_deleted_total counter",
      `rfq_analytics_outbox_deleted_total ${this.deleted}`,
      "# HELP rfq_analytics_publisher_iteration_errors_total Publisher polling iterations that failed outside a record outcome.",
      "# TYPE rfq_analytics_publisher_iteration_errors_total counter",
      `rfq_analytics_publisher_iteration_errors_total ${this.iterationErrors}`,
      "# HELP rfq_analytics_clickhouse_events_total Kafka events inserted into the ClickHouse analytical projection.",
      "# TYPE rfq_analytics_clickhouse_events_total counter",
      `rfq_analytics_clickhouse_events_total ${this.consumed}`,
      "# HELP rfq_analytics_consumer_errors_total Kafka batches rejected or not inserted into ClickHouse.",
      "# TYPE rfq_analytics_consumer_errors_total counter",
      `rfq_analytics_consumer_errors_total ${this.consumerErrors}`,
      "# HELP rfq_analytics_last_published_timestamp_seconds Latest successful outbox publish timestamp.",
      "# TYPE rfq_analytics_last_published_timestamp_seconds gauge",
      `rfq_analytics_last_published_timestamp_seconds ${this.lastPublishedAtSeconds}`,
      "# HELP rfq_analytics_last_consumed_timestamp_seconds Latest successful ClickHouse consume timestamp.",
      "# TYPE rfq_analytics_last_consumed_timestamp_seconds gauge",
      `rfq_analytics_last_consumed_timestamp_seconds ${this.lastConsumedAtSeconds}`,
    ];
    if (stats !== undefined) {
      assertStats(stats);
      const oldestAgeSeconds = stats.oldestPendingCreatedAt === undefined
        ? 0
        : Math.max(0, (nowMs - Date.parse(stats.oldestPendingCreatedAt)) / 1_000);
      lines.push(
        "# HELP rfq_analytics_outbox_pending Current unpublished analytics outbox rows.",
        "# TYPE rfq_analytics_outbox_pending gauge",
        `rfq_analytics_outbox_pending ${stats.pendingCount}`,
        "# HELP rfq_analytics_outbox_oldest_age_seconds Age of the oldest unpublished analytics outbox row.",
        "# TYPE rfq_analytics_outbox_oldest_age_seconds gauge",
        `rfq_analytics_outbox_oldest_age_seconds ${oldestAgeSeconds}`,
        "# HELP rfq_analytics_outbox_cleanup_eligible Published outbox rows older than the configured retention cutoff.",
        "# TYPE rfq_analytics_outbox_cleanup_eligible gauge",
        `rfq_analytics_outbox_cleanup_eligible ${stats.cleanupEligibleCount}`,
      );
    }
    lines.push("");
    return lines.join("\n");
  }
}

function assertPositiveCount(value: unknown): void {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new Error("Analytics metrics count must be a positive safe integer");
  }
}

function assertStats(value: unknown): asserts value is AnalyticsOutboxStats {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Analytics metrics outbox stats must be an object");
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set(["pendingCount", "cleanupEligibleCount", "oldestPendingCreatedAt"]);
  if (Object.keys(record).some((field) => !allowed.has(field)) ||
      !Object.hasOwn(record, "pendingCount") || !Object.hasOwn(record, "cleanupEligibleCount")) {
    throw new Error("Analytics metrics outbox stats fields are invalid");
  }
  if (!Number.isSafeInteger(record.pendingCount) || (record.pendingCount as number) < 0) {
    throw new Error("Analytics metrics pendingCount is invalid");
  }
  if (!Number.isSafeInteger(record.cleanupEligibleCount) || (record.cleanupEligibleCount as number) < 0) {
    throw new Error("Analytics metrics cleanupEligibleCount is invalid");
  }
  if (record.oldestPendingCreatedAt !== undefined &&
      (typeof record.oldestPendingCreatedAt !== "string" ||
       Number.isNaN(Date.parse(record.oldestPendingCreatedAt)) ||
       new Date(record.oldestPendingCreatedAt).toISOString() !== record.oldestPendingCreatedAt)) {
    throw new Error("Analytics metrics oldestPendingCreatedAt is invalid");
  }
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1_000);
}
