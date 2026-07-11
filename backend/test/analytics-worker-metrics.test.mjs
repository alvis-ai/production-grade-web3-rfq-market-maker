import assert from "node:assert/strict";
import test from "node:test";
import { AnalyticsWorkerMetrics } from "../dist/modules/analytics/analytics-worker.metrics.js";

test("AnalyticsWorkerMetrics exposes bounded counters and outbox backlog gauges", () => {
  const metrics = new AnalyticsWorkerMetrics();
  metrics.recordPublished(2);
  metrics.recordRetry(1);
  metrics.recordDeleted(3);
  metrics.recordIterationError();
  metrics.recordConsumed(2);
  metrics.recordConsumerError();
  const output = metrics.renderPrometheus({
    pendingCount: 4,
    cleanupEligibleCount: 2,
    oldestPendingCreatedAt: "2026-07-11T00:00:00.000Z",
  }, Date.parse("2026-07-11T00:01:00.000Z"));

  assert.match(output, /rfq_analytics_outbox_published_total 2/);
  assert.match(output, /rfq_analytics_outbox_retries_total 1/);
  assert.match(output, /rfq_analytics_clickhouse_events_total 2/);
  assert.match(output, /rfq_analytics_consumer_errors_total 1/);
  assert.match(output, /rfq_analytics_outbox_pending 4/);
  assert.match(output, /rfq_analytics_outbox_oldest_age_seconds 60/);
  assert.match(output, /rfq_analytics_outbox_cleanup_eligible 2/);
  assert.doesNotMatch(output, /quoteId|aggregate_id/);
});

test("AnalyticsWorkerMetrics rejects invalid mutation and stats input", () => {
  const metrics = new AnalyticsWorkerMetrics();
  assert.throws(() => metrics.recordPublished(0), /positive safe integer/);
  assert.throws(() => metrics.renderPrometheus({ pendingCount: -1, cleanupEligibleCount: 0 }), /pendingCount/);
  assert.throws(
    () => metrics.renderPrometheus({ pendingCount: 1, cleanupEligibleCount: 0, oldestPendingCreatedAt: "2026-07-11" }),
    /oldestPendingCreatedAt/,
  );
});
