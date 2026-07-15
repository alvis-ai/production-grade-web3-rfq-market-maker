#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const metricsSource = await readFile("backend/src/modules/metrics/metrics.service.ts", "utf8");
const hedgeWorkerMetricsSource = await readFile("backend/src/modules/hedge/hedge-worker.ts", "utf8");
const hedgeFeeMetricsSource = await readFile("backend/src/modules/hedge/hedge-fee-worker.ts", "utf8");
const analyticsWorkerMetricsSource = await readFile("backend/src/modules/analytics/analytics-worker.metrics.ts", "utf8");
const reconciliationWorkerMetricsSource = await readFile(
  "backend/src/modules/reconciliation/post-trade-reconciliation.metrics.ts",
  "utf8",
);
const settlementIndexerMetricsSource = await readFile(
  "backend/src/modules/indexer/settlement-indexer.metrics.ts",
  "utf8",
);
const toxicFlowAnalyzerMetricsSource = await readFile(
  "backend/src/modules/risk/toxic-flow-analyzer.worker.ts",
  "utf8",
);
const datasourceSource = await readFile("infra/grafana/provisioning/datasources/prometheus.yml", "utf8");
const dashboardProviderSource = await readFile("infra/grafana/provisioning/dashboards/dashboards.yml", "utf8");
const dashboardSource = await readFile("infra/grafana/provisioning/dashboards/rfq-overview.json", "utf8");
const alertRulesSource = await readFile("infra/prometheus/rules/rfq-alerts.yml", "utf8");

const emittedMetrics = extractEmittedMetrics(
  `${metricsSource}\n${hedgeWorkerMetricsSource}\n${hedgeFeeMetricsSource}\n${analyticsWorkerMetricsSource}\n${reconciliationWorkerMetricsSource}\n${settlementIndexerMetricsSource}\n${toxicFlowAnalyzerMetricsSource}`,
);
const alertMetrics = extractAlertMetrics(alertRulesSource);
const dashboard = JSON.parse(dashboardSource);
const expressions = extractDashboardExpressions(dashboard);
const dashboardMetrics = new Set(expressions.flatMap(extractMetricsFromExpression));
const kubernetesAvailabilityMetrics = [
  "kube_horizontalpodautoscaler_status_desired_replicas",
  "kube_horizontalpodautoscaler_spec_max_replicas",
  "kube_horizontalpodautoscaler_status_condition",
  "kube_poddisruptionbudget_status_pod_disruptions_allowed",
];

assert.equal(dashboard.title, "RFQ Market Maker Overview", "Grafana dashboard title must stay stable");
assert.equal(dashboard.uid, "rfq-market-maker-overview", "Grafana dashboard uid must stay stable");
assert.ok(Array.isArray(dashboard.panels), "Grafana dashboard must define panels");
assert.ok(dashboard.panels.length >= 10, "Grafana dashboard must cover core production panels");
assert.ok(expressions.length >= emittedMetrics.length, "Grafana dashboard must expose enough Prometheus queries");

for (const metric of emittedMetrics) {
  assert.ok(dashboardMetrics.has(metric), `Grafana overview dashboard must query ${metric}`);
}

for (const metric of alertMetrics) {
  assert.ok(dashboardMetrics.has(metric), `Grafana overview dashboard must query alert metric ${metric}`);
}

for (const metric of kubernetesAvailabilityMetrics) {
  assert.ok(
    expressions.some((expression) => expression.includes(metric)),
    `Grafana overview dashboard must query Kubernetes availability metric ${metric}`,
  );
}
assert.ok(
  dashboard.panels.some((panel) => panel.title === "Kubernetes Availability Controls"),
  "Grafana overview dashboard must expose Kubernetes HPA and PDB state",
);

for (const panel of dashboard.panels) {
  assert.ok(panel.title, "Every Grafana panel must have a title");
  assert.ok(panel.type, `${panel.title} must declare panel type`);
  assert.equal(panel.datasource?.uid, "prometheus", `${panel.title} must use the Prometheus datasource uid`);
  assert.ok(Array.isArray(panel.targets) && panel.targets.length > 0, `${panel.title} must define targets`);
  for (const target of panel.targets) {
    assert.ok(target.expr, `${panel.title} target must define expr`);
    assert.ok(target.refId, `${panel.title} target must define refId`);
  }
}

assert.ok(datasourceSource.includes("uid: prometheus"), "Grafana datasource must use uid prometheus");
assert.ok(datasourceSource.includes("url: http://prometheus:9090"), "Grafana datasource must point at Compose Prometheus");
assert.ok(
  dashboardProviderSource.includes("path: /etc/grafana/provisioning/dashboards"),
  "Grafana provider must load provisioned dashboards directory",
);

console.log(
  `Grafana dashboard consistency check passed (${dashboard.panels.length} panels, ${emittedMetrics.length} metrics, ${alertMetrics.length} alert metrics)`,
);

function extractEmittedMetrics(source) {
  return [...source.matchAll(/"# HELP (rfq_[a-z0-9_]+) /g)].map((match) => match[1]);
}

function extractAlertMetrics(source) {
  return [...new Set([...source.matchAll(/\b(rfq_[a-z0-9_]+(?:_bucket|_sum|_count)?)\b/g)]
    .map((match) => normalizeMetricName(match[1])))]
    .sort();
}

function extractDashboardExpressions(dashboard) {
  return dashboard.panels.flatMap((panel) => panel.targets?.map((target) => target.expr) ?? []);
}

function extractMetricsFromExpression(expression) {
  return [...new Set([...expression.matchAll(/\b(rfq_[a-z0-9_]+(?:_bucket|_sum|_count)?)\b/g)]
    .map((match) => normalizeMetricName(match[1])))];
}

function normalizeMetricName(metricName) {
  return metricName.replace(/_(bucket|sum|count)$/, "");
}
