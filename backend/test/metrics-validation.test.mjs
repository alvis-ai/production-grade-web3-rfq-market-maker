import assert from "node:assert/strict";
import test from "node:test";
import { MetricsService } from "../dist/modules/metrics/metrics.service.js";

const readinessResponse = {
  status: "degraded",
  components: {
    marketData: "ok",
    marketSnapshotStore: "ok",
    routing: "ok",
    pricing: "ok",
    risk: "ok",
    signer: "degraded",
    quoteRepository: "ok",
    quoteControl: "ok",
    riskDecisionStore: "ok",
    rateLimitStore: "ok",
    inventory: "ok",
    execution: "ok",
    settlementEventStore: "ok",
    pnl: "ok",
    metrics: "ok",
  },
};

test("MetricsService rejects unsupported fixed-label inputs before mutating state", () => {
  const metrics = new MetricsService();

  assert.throws(
    () => metrics.recordRateLimited("metrics"),
    /Metrics rate-limited endpoint must be quote, submit, or status/,
  );
  assert.throws(
    () => metrics.recordSignerRequest("rotate"),
    /Metrics signer operation must be sign or verify/,
  );
  assert.throws(
    () => metrics.recordSignerLatency("rotate", 0.1),
    /Metrics signer operation must be sign or verify/,
  );
  assert.throws(
    () => metrics.recordQuoteControlError("delete"),
    /Metrics quote control operation must be read or update/,
  );
  assert.throws(
    () => metrics.recordToxicFlowScoreError("delete"),
    /Metrics toxic flow score operation must be read or update/,
  );
  assert.throws(
    () => metrics.recordQuoteControlState("true"),
    /Metrics quote control paused state must be a boolean/,
  );
  assert.throws(
    () => metrics.recordPausedQuotePairCount(-1),
    /Metrics paused quote pair count must be a non-negative safe integer/,
  );
  assert.throws(
    () => metrics.recordPausedQuotePairCount(1.5),
    /Metrics paused quote pair count must be a non-negative safe integer/,
  );
  assert.throws(
    () =>
      metrics.recordReadiness({
        ...readinessResponse,
        status: "unknown",
      }),
    /Metrics readiness status must be ready or degraded/,
  );
  assert.throws(
    () => metrics.recordReadiness(Object.create(readinessResponse)),
    /Metrics readiness.status must be an own field/,
  );
  assert.throws(
    () =>
      metrics.recordReadiness({
        status: "degraded",
        components: Object.create(readinessResponse.components),
      }),
    /Metrics readiness components.marketData must be an own field/,
  );
  assert.throws(
    () => {
      const { signer, ...components } = readinessResponse.components;
      metrics.recordReadiness({
        ...readinessResponse,
        components,
      });
    },
    /Metrics readiness components.signer must be an own field/,
  );
  assert.throws(
    () =>
      metrics.recordReadiness({
        ...readinessResponse,
        components: {
          ...readinessResponse.components,
          externalUrl: "ok",
        },
      }),
    /Metrics readiness component externalUrl is not supported/,
  );

  const output = metrics.renderPrometheus();

  assert.match(output, /rfq_rate_limited_total\{endpoint="quote"\} 0/);
  assert.match(output, /rfq_rate_limited_total\{endpoint="submit"\} 0/);
  assert.match(output, /rfq_rate_limited_total\{endpoint="status"\} 0/);
  assert.match(output, /rfq_signer_requests_total\{operation="sign"\} 0/);
  assert.match(output, /rfq_signer_latency_seconds_count\{operation="sign"\} 0/);
  assert.match(output, /rfq_toxic_flow_score_updates_total 0/);
  assert.match(output, /rfq_toxic_flow_score_errors_total\{operation="read"\} 0/);
  assert.match(output, /rfq_toxic_flow_score_errors_total\{operation="update"\} 0/);
  assert.match(output, /rfq_readiness_status\{status="ready"\} 0/);
  assert.match(output, /rfq_readiness_status\{status="degraded"\} 0/);
  assert.match(output, /rfq_dependency_status\{component="signer",status="ok"\} 0/);
  assert.match(output, /rfq_dependency_status\{component="signer",status="degraded"\} 0/);
});

test("MetricsService rejects non-string dynamic label values before mutating state", () => {
  const metrics = new MetricsService();

  assert.throws(
    () => metrics.recordQuoteRejection(null),
    /Metrics label value must be a string/,
  );
  assert.throws(
    () => metrics.recordHedgeIntentError([]),
    /Metrics label value must be a string/,
  );
  assert.throws(
    () => metrics.recordQuoteStatusUpdateError({}),
    /Metrics label value must be a string/,
  );
  assert.throws(
    () => metrics.recordPnlRecordError(undefined),
    /Metrics label value must be a string/,
  );

  const output = metrics.renderPrometheus();

  assert.doesNotMatch(output, /rfq_quote_rejections_total\{reason=/);
  assert.doesNotMatch(output, /rfq_hedge_intent_errors_total\{reason=/);
  assert.doesNotMatch(output, /rfq_quote_status_update_errors_total\{target_status=/);
  assert.doesNotMatch(output, /rfq_pnl_record_errors_total\{reason=/);
});

test("MetricsService rejects non-finite histogram observations before mutating state", () => {
  const metrics = new MetricsService();

  assert.throws(
    () => metrics.recordQuoteLatency(Number.NaN),
    /Metrics histogram observation must be a finite number/,
  );
  assert.throws(
    () => metrics.recordSubmitLatency(Number.POSITIVE_INFINITY),
    /Metrics histogram observation must be a finite number/,
  );
  assert.throws(
    () => metrics.recordSignerLatency("sign", Number.NEGATIVE_INFINITY),
    /Metrics histogram observation must be a finite number/,
  );
  assert.throws(
    () => metrics.recordHedgeLag(Number.NaN),
    /Metrics histogram observation must be a finite number/,
  );

  const output = metrics.renderPrometheus();

  assert.match(output, /rfq_quote_latency_seconds_sum 0/);
  assert.match(output, /rfq_quote_latency_seconds_count 0/);
  assert.match(output, /rfq_submit_latency_seconds_sum 0/);
  assert.match(output, /rfq_submit_latency_seconds_count 0/);
  assert.match(output, /rfq_signer_latency_seconds_sum\{operation="sign"\} 0/);
  assert.match(output, /rfq_signer_latency_seconds_count\{operation="sign"\} 0/);
  assert.match(output, /rfq_hedge_lag_seconds_sum 0/);
  assert.match(output, /rfq_hedge_lag_seconds_count 0/);
  assert.doesNotMatch(output, /NaN|Infinity/);
});
