#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import {
  backendMetricsSourcePaths,
  readBackendMetricsSource,
} from "./lib/read-backend-metrics-source.mjs";

const metricsSource = await readBackendMetricsSource();
const metricsModules = new Map(await Promise.all(backendMetricsSourcePaths.map(async (path) => {
  return [path, await readFile(path, "utf8")];
})));
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
const signerServiceMetricsSource = await readFile("backend/src/modules/signer/signer-server.ts", "utf8");
const signerAuditMetricsSource = await readFile(
  "backend/src/modules/signer/signer-audit-stream.metrics.ts",
  "utf8",
);
const readinessSource = await readFile("backend/src/modules/health/readiness.service.ts", "utf8");
const rateLimitSource = await readFile("backend/src/modules/rate-limit/rate-limit.service.ts", "utf8");
const prometheusConfigSource = await readFile("infra/prometheus/prometheus.yml", "utf8");
const alertRulesSource = await readFile("infra/prometheus/rules/rfq-alerts.yml", "utf8");
const backendMetricsChapter = await readFile("book/Volume5-BackendEngineering/Chapter08-Metrics-Service.md", "utf8");
const monitoringChapter = await readFile("book/Volume7-ProductionDeployment/Chapter03-Monitoring.md", "utf8");

const emittedMetrics = extractEmittedMetrics(
  `${metricsSource}\n${hedgeWorkerMetricsSource}\n${hedgeFeeMetricsSource}\n${analyticsWorkerMetricsSource}\n${reconciliationWorkerMetricsSource}\n${settlementIndexerMetricsSource}\n${toxicFlowAnalyzerMetricsSource}\n${signerServiceMetricsSource}\n${signerAuditMetricsSource}`,
);
const alertMetrics = extractAlertMetrics(alertRulesSource);
const backendDocMetrics = extractDocumentedMetrics(backendMetricsChapter);
const monitoringDocMetrics = extractDocumentedMetrics(monitoringChapter);
const alertNames = extractAlertNames(alertRulesSource);
const readinessComponents = extractStringUnionValues(readinessSource, "ReadinessComponentName");
const metricsReadinessComponents = extractConstStringArray(metricsSource, "readinessDependencyComponents");
const rateLimitedEndpoints = extractStringUnionValues(rateLimitSource, "RateLimitedEndpoint");
const metricsRateLimitedEndpoints = extractConstStringArray(metricsSource, "rateLimitedEndpoints");
const signerMetricOperations = extractStringUnionValues(metricsSource, "SignerMetricOperation");
const metricsSignerOperations = extractConstStringArray(metricsSource, "signerMetricOperations");
const kubernetesAvailabilityMetrics = [
  "kube_horizontalpodautoscaler_status_desired_replicas",
  "kube_horizontalpodautoscaler_spec_max_replicas",
  "kube_horizontalpodautoscaler_status_condition",
  "kube_poddisruptionbudget_status_pod_disruptions_allowed",
  "kube_pod_status_unschedulable",
];

const metricsModuleLineLimits = new Map([
  ["backend/src/modules/metrics/metrics.service.ts", 500],
  ["backend/src/modules/metrics/metrics-contract.ts", 140],
  ["backend/src/modules/metrics/metrics-validation.ts", 350],
  ["backend/src/modules/metrics/prometheus-metrics.ts", 520],
]);
for (const [path, maxLines] of metricsModuleLineLimits) {
  const source = metricsModules.get(path);
  assert.ok(source, `Metrics module ${path} must be included in the composed source`);
  assert.ok(source.split("\n").length <= maxLines, `Metrics module ${path} must stay within ${maxLines} lines`);
}
assert.ok(
  metricsModules.get("backend/src/modules/metrics/metrics.service.ts")?.includes("renderPrometheusMetrics({"),
  "MetricsService must delegate Prometheus serialization to the renderer",
);
assert.ok(
  !metricsModules.get("backend/src/modules/metrics/prometheus-metrics.ts")?.includes("metrics.service"),
  "Prometheus renderer must not depend on the stateful MetricsService facade",
);

assert.ok(emittedMetrics.length >= 20, "MetricsService must expose a production-grade metric surface");
assert.equal(new Set(emittedMetrics).size, emittedMetrics.length, "MetricsService metric HELP blocks must be unique");
assert.deepEqual(
  metricsRateLimitedEndpoints,
  rateLimitedEndpoints,
  "MetricsService rate limit endpoint labels must match backend RateLimitedEndpoint",
);
assert.deepEqual(
  metricsSignerOperations,
  signerMetricOperations,
  "MetricsService signer operation labels must match SignerMetricOperation",
);
assert.deepEqual(
  metricsReadinessComponents,
  readinessComponents,
  "MetricsService readiness dependency labels must match backend readiness components",
);

for (const metric of emittedMetrics) {
  assert.ok(backendDocMetrics.has(metric), `Chapter08 Metrics Service must document ${metric}`);
  assert.ok(monitoringDocMetrics.has(metric), `Chapter03 Monitoring must document ${metric}`);
  assert.ok(alertMetrics.includes(metric), `Prometheus alert rules must cover backend metric ${metric}`);
}

for (const metric of alertMetrics) {
  assert.ok(emittedMetrics.includes(metric), `Prometheus alert rule references unknown backend metric ${metric}`);
}

for (const alertName of alertNames) {
  const block = extractAlertBlock(alertRulesSource, alertName);
  assert.match(block, /severity:\s+(critical|warning)/, `${alertName} must declare severity`);
  assert.ok(
    block.includes("runbook: book/Volume7-ProductionDeployment/Chapter05-Runbook.md"),
    `${alertName} must link the production runbook`,
  );
}

assert.ok(prometheusConfigSource.includes("job_name: rfq-backend"), "Prometheus must scrape the backend job");
assert.ok(prometheusConfigSource.includes("job_name: rfq-signer"), "Prometheus must scrape the signer job");
assert.ok(prometheusConfigSource.includes("job_name: rfq-hedge-worker"), "Prometheus must scrape the hedge worker job");
assert.ok(prometheusConfigSource.includes("job_name: rfq-analytics-worker"), "Prometheus must scrape the analytics worker job");
assert.ok(
  prometheusConfigSource.includes("job_name: rfq-reconciliation-worker"),
  "Prometheus must scrape the reconciliation worker job",
);
assert.ok(
  prometheusConfigSource.includes("job_name: rfq-settlement-indexer"),
  "Prometheus must scrape the settlement indexer job",
);
assert.ok(
  prometheusConfigSource.includes("job_name: rfq-toxic-flow-analyzer"),
  "Prometheus must scrape the toxic-flow analyzer job",
);
assert.ok(prometheusConfigSource.includes("metrics_path: /metrics"), "Prometheus backend job must scrape /metrics");
assert.ok(
  prometheusConfigSource.includes("/etc/prometheus/rules/rfq-alerts.yml"),
  "Prometheus must load RFQ alert rules",
);
for (const metric of kubernetesAvailabilityMetrics) {
  assert.ok(alertRulesSource.includes(metric), `Prometheus alerts must cover Kubernetes metric ${metric}`);
  assert.ok(monitoringChapter.includes(`\`${metric}\``), `Chapter03 Monitoring must document ${metric}`);
}

console.log(
  `Metrics consistency check passed (${emittedMetrics.length} metrics, ${alertNames.length} alerts)`,
);

function extractEmittedMetrics(source) {
  return [...source.matchAll(/"# HELP (rfq_[a-z0-9_]+) /g)]
    .map((match) => match[1]);
}

function extractAlertMetrics(source) {
  return [...new Set([...source.matchAll(/\b(rfq_[a-z0-9_]+(?:_bucket|_sum|_count)?)\b/g)]
    .map((match) => normalizeMetricName(match[1])))]
    .sort();
}

function extractDocumentedMetrics(source) {
  return new Set([...source.matchAll(/`(rfq_[a-z0-9_]+)`/g)].map((match) => normalizeMetricName(match[1])));
}

function extractAlertNames(source) {
  return [...source.matchAll(/^\s+- alert: ([A-Za-z0-9_]+)$/gm)].map((match) => match[1]).sort();
}

function extractAlertBlock(source, alertName) {
  const lines = source.split("\n");
  const start = lines.findIndex((line) => line.trim() === `- alert: ${alertName}`);
  assert.ok(start >= 0, `${alertName} block not found`);

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index].trim().startsWith("- alert: ")) {
      end = index;
      break;
    }
  }

  return lines.slice(start, end).join("\n");
}

function extractStringUnionValues(source, typeName) {
  const match = source.match(new RegExp(`export\\s+type\\s+${typeName}\\s*=([\\s\\S]*?);`));
  assert.ok(match, `Unable to find TypeScript string union ${typeName}`);

  return [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
}

function extractConstStringArray(source, constName) {
  const match = source.match(new RegExp(`const\\s+${constName}[^=]*=\\s*\\[([\\s\\S]*?)\\]\\s*(?:as\\s+const)?;`));
  assert.ok(match, `Unable to find const string array ${constName}`);

  const values = [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
  assert.ok(values.length > 0, `${constName} must not be empty`);
  return values;
}

function normalizeMetricName(metricName) {
  return metricName.replace(/_(bucket|sum|count)$/, "");
}
