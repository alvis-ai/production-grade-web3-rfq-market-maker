import assert from "node:assert/strict";
import test from "node:test";
import { readToxicFlowAnalyzerRuntimeConfig } from "../dist/toxic-flow-analyzer-main.js";
import { ToxicFlowAnalyzerMetrics } from "../dist/modules/risk/toxic-flow-analyzer.worker.js";

const registry = JSON.stringify({ tokens: [
  { chainId: 1, tokenAddress: "0x0000000000000000000000000000000000000002", symbol: "WETH", decimals: 18, isWhitelisted: true, riskTier: "medium", usdReference: false },
] });

test("toxic-flow analyzer runtime reads bounded production configuration", () => {
  const config = readToxicFlowAnalyzerRuntimeConfig({ NODE_ENV: "production",
    DATABASE_URL: "postgres://analyzer:secret@db.example.com/rfq?sslmode=verify-full", RFQ_TOKEN_REGISTRY_JSON: registry,
    RFQ_TOXIC_FLOW_ANALYZER_WORKER_ID: "analyzer_a", RFQ_TOXIC_FLOW_MARKOUT_HORIZON_SECONDS: "60",
    RFQ_TOXIC_FLOW_MARKOUT_MAX_SNAPSHOT_LAG_SECONDS: "120", RFQ_TOXIC_FLOW_SCORE_WINDOW_SECONDS: "3600",
    RFQ_TOXIC_FLOW_SCORE_SCALE: "200", RFQ_TOXIC_FLOW_ANALYZER_POLICY_VERSION: "markout-v2" });
  assert.equal(config.worker.workerId, "analyzer_a");
  assert.equal(config.worker.horizonSeconds, 60);
  assert.equal(config.worker.maxSnapshotLagSeconds, 120);
  assert.equal(config.worker.windowSeconds, 3600);
  assert.equal(config.worker.scoreScale, 200);
  assert.equal(config.worker.policyVersion, "markout-v2");
  assert.equal(config.listenPort, 3005);
});

test("toxic-flow analyzer runtime rejects missing or inconsistent policy", () => {
  assert.throws(() => readToxicFlowAnalyzerRuntimeConfig({ RFQ_TOKEN_REGISTRY_JSON: registry }), /DATABASE_URL is required/);
  assert.throws(() => readToxicFlowAnalyzerRuntimeConfig({ DATABASE_URL: "postgres://db/rfq", RFQ_TOKEN_REGISTRY_JSON: registry,
    RFQ_TOXIC_FLOW_MARKOUT_HORIZON_SECONDS: "300", RFQ_TOXIC_FLOW_SCORE_WINDOW_SECONDS: "299" }), /inconsistent/);
  assert.throws(() => readToxicFlowAnalyzerRuntimeConfig({ DATABASE_URL: "postgres://db/rfq", RFQ_TOKEN_REGISTRY_JSON: registry,
    RFQ_TOXIC_FLOW_SCORE_SCALE: "0" }), /must be an integer/);
  assert.throws(() => readToxicFlowAnalyzerRuntimeConfig({ NODE_ENV: "production", DATABASE_URL: "postgres://db/rfq",
    RFQ_TOKEN_REGISTRY_JSON: registry }), /sslmode=verify-full/);
});

test("ToxicFlowAnalyzerMetrics renders bounded outcomes and backlog", () => {
  const metrics = new ToxicFlowAnalyzerMetrics();
  metrics.recordResult({ status: "scored", settlementEventId: "se_1" });
  metrics.recordResult({ status: "retry_scheduled", settlementEventId: "se_2", errorCode: "MARKOUT_SNAPSHOT_UNAVAILABLE" });
  metrics.recordIterationError();
  const output = metrics.renderPrometheus({ pendingCount: 2, oldestEligibleAt: "2026-07-14T00:00:00.000Z" }, Date.parse("2026-07-14T00:01:00.000Z"));
  assert.match(output, /rfq_toxic_flow_markouts_total\{outcome="scored"\} 1/);
  assert.match(output, /rfq_toxic_flow_markouts_total\{outcome="retry_scheduled"\} 1/);
  assert.match(output, /rfq_toxic_flow_analyzer_iteration_errors_total 1/);
  assert.match(output, /rfq_toxic_flow_markout_pending 2/);
  assert.match(output, /rfq_toxic_flow_markout_oldest_eligible_age_seconds 60/);
});
