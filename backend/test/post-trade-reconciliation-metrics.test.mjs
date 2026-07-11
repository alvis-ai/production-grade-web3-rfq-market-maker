import assert from "node:assert/strict";
import test from "node:test";
import { PostTradeReconciliationMetrics } from "../dist/modules/reconciliation/post-trade-reconciliation.metrics.js";

test("PostTradeReconciliationMetrics exposes bounded outcomes and durable backlog", () => {
  const metrics = new PostTradeReconciliationMetrics();
  metrics.recordJob("repaired");
  metrics.recordJob("retry_scheduled");
  metrics.recordIterationError();
  const output = metrics.renderPrometheus({
    pendingCount: 3,
    oldestPendingRequestedAt: "2026-07-11T00:00:00.000Z",
  }, Date.parse("2026-07-11T00:01:00.000Z"));

  assert.match(output, /rfq_reconciliation_jobs_total\{outcome="repaired"\} 1/);
  assert.match(output, /rfq_reconciliation_jobs_total\{outcome="retry_scheduled"\} 1/);
  assert.match(output, /rfq_reconciliation_iteration_errors_total 1/);
  assert.match(output, /rfq_reconciliation_pending_jobs 3/);
  assert.match(output, /rfq_reconciliation_oldest_pending_age_seconds 60/);
  assert.doesNotMatch(output, /quoteId|settlementEventId/);
});

test("PostTradeReconciliationMetrics rejects unbounded labels and malformed stats", () => {
  const metrics = new PostTradeReconciliationMetrics();
  assert.throws(() => metrics.recordJob("unknown"), /outcome is invalid/);
  assert.throws(() => metrics.renderPrometheus({ pendingCount: -1 }), /pendingCount/);
  assert.throws(
    () => metrics.renderPrometheus({ pendingCount: 1, oldestPendingRequestedAt: "2026-07-11" }),
    /canonical UTC ISO/,
  );
});
