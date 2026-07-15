#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(path, "utf8");

const databaseConfig = await read("backend/src/db/config.ts");
const databasePool = await read("backend/src/db/pool.ts");
const redisRateLimiter = await read("backend/src/modules/rate-limit/redis-rate-limit.service.ts");
const gatewayRuntime = await read("backend/src/runtime/gateway-runtime.ts");
const analyticsRuntime = await read("backend/src/analytics-worker-main.ts");
const workerSources = await Promise.all([
  "backend/src/hedge-worker-main.ts",
  "backend/src/analytics-worker-main.ts",
  "backend/src/reconciliation-worker-main.ts",
  "backend/src/settlement-indexer-main.ts",
  "backend/src/toxic-flow-analyzer-main.ts",
].map(async (path) => [path, await read(path)]));
const databaseTests = await read("backend/test/database-config.test.mjs");
const redisTests = await read("backend/test/redis-rate-limit.test.mjs");
const apiRedisTests = await read("backend/test/api-redis-rate-limit.test.mjs");
const apiExecutionEnvTests = await read("backend/test/api-execution-env.test.mjs");
const analyticsTests = await read("backend/test/analytics-worker-runtime.test.mjs");
const compose = await read("docker-compose.yml");
const rawDeployments = await Promise.all([
  "infra/k8s/backend-deployment.yaml",
  "infra/k8s/hedge-worker-deployment.yaml",
  "infra/k8s/analytics-worker-deployment.yaml",
  "infra/k8s/reconciliation-worker-deployment.yaml",
  "infra/k8s/settlement-indexer-deployment.yaml",
  "infra/k8s/toxic-flow-analyzer-deployment.yaml",
].map(async (path) => [path, await read(path)]));
const rawSecrets = await Promise.all([
  "infra/k8s/backend-secret.yaml",
  "infra/k8s/database-migration-secret.yaml",
  "infra/k8s/hedge-worker-secret.yaml",
  "infra/k8s/analytics-worker-secret.yaml",
  "infra/k8s/reconciliation-worker-secret.yaml",
  "infra/k8s/settlement-indexer-secret.yaml",
  "infra/k8s/toxic-flow-analyzer-secret.yaml",
].map(async (path) => [path, await read(path)]));
const helmDeployments = await Promise.all([
  "infra/helm/rfq-market-maker/templates/deployment.yaml",
  "infra/helm/rfq-market-maker/templates/hedge-worker-deployment.yaml",
  "infra/helm/rfq-market-maker/templates/analytics-worker-deployment.yaml",
  "infra/helm/rfq-market-maker/templates/reconciliation-worker-deployment.yaml",
  "infra/helm/rfq-market-maker/templates/settlement-indexer-deployment.yaml",
  "infra/helm/rfq-market-maker/templates/toxic-flow-analyzer-deployment.yaml",
].map(async (path) => [path, await read(path)]));
const helmSchema = JSON.parse(await read("infra/helm/rfq-market-maker/values.schema.json"));
const readme = await read("README.md");
const kubernetesChapter = await read("book/Volume7-ProductionDeployment/Chapter02-Kubernetes.md");
const gatewayChapter = await read("book/Volume5-BackendEngineering/Chapter01-API-Gateway.md");
const threatModel = await read("docs/security/threat-model.md");
const auditChecklist = await read("docs/security/audit-checklist.md");

assertContains(databaseConfig, [
  'DatabaseSslMode = "disable" | "verify-full"',
  'new Set(["maxPool", "minPool", "sslmode", "sslrootcert"])',
  'url.searchParams.set("sslmode", config.sslMode)',
  'url.searchParams.set("sslrootcert", config.sslRootCertPath)',
  "assertDatabaseUrlParameters(parsed.searchParams)",
  "DATABASE_URL sslmode must be disable or verify-full",
  "DATABASE_URL sslrootcert requires sslmode=verify-full",
  "DATABASE_URL must use sslmode=verify-full when NODE_ENV=${nodeEnv}",
], "backend/src/db/config.ts");
assertContains(databasePool, [
  "connectionString(resolvedConfig)",
  "a.sslMode === b.sslMode",
  "a.sslRootCertPath === b.sslRootCertPath",
], "backend/src/db/pool.ts");

for (const [path, source] of workerSources) {
  assertContains(source, [
    'readOptional(env, "NODE_ENV")',
    "assertDatabaseUrlForEnvironment(databaseUrl, nodeEnv)",
  ], path);
}
assertContains(analyticsRuntime, [
  "assertProductionAnalyticsTransportSecurity(config, nodeEnv)",
  "RFQ_ANALYTICS_KAFKA_SSL must be true when NODE_ENV=${nodeEnv}",
  "Analytics Kafka SASL credentials are required when NODE_ENV=${nodeEnv}",
  "RFQ_CLICKHOUSE_URL must use https:// when NODE_ENV=${nodeEnv}",
], "backend/src/analytics-worker-main.ts");

assertContains(redisRateLimiter, [
  "export interface RedisUrlPolicy",
  "assertRedisUrlPolicy(policy)",
  "policy.requireTls === true",
  "RFQ_REDIS_URL must use rediss:// outside local environments",
], "backend/src/modules/rate-limit/redis-rate-limit.service.ts");
assertContains(gatewayRuntime, [
  "createRedisRateLimitClient(redisUrl, {",
  "requireTls: requiresExplicitRuntimeConfig(nodeEnv)",
], "backend/src/runtime/gateway-runtime.ts");

assertContains(databaseTests, [
  "preserves verified TLS",
  "requires hostname-verified TLS",
  "rejects ambiguous or downgrade-prone TLS parameters",
  "sslmode=verify-full",
  "sslrootcert",
], "backend/test/database-config.test.mjs");
assertContains(redisTests, ["{ requireTls: true }", "must use rediss"], "backend/test/redis-rate-limit.test.mjs");
assertContains(apiRedisTests, [
  'RFQ_REDIS_URL = "redis://127.0.0.1:6379/0"',
  'RFQ_REDIS_URL = "rediss://redis.example.com:6380/0"',
], "backend/test/api-redis-rate-limit.test.mjs");
assertContains(apiExecutionEnvTests, [
  'process.env.NODE_ENV = "production"',
  'RFQ_REDIS_URL = "rediss://redis.example.com:6380/0"',
], "backend/test/api-execution-env.test.mjs");
assertContains(analyticsTests, [
  "requires authenticated TLS dependencies in production",
  "KAFKA_SSL must be true",
  "SASL credentials are required",
  "must use https",
], "backend/test/analytics-worker-runtime.test.mjs");

assert.equal(
  countOccurrences(compose, "NODE_ENV: development"),
  8,
  "Compose must explicitly mark migration, API, signer and five workers as development",
);
assertContains(compose, [
  "RFQ_REDIS_URL: redis://redis:6379/0",
  "RFQ_ANALYTICS_KAFKA_SSL: \"false\"",
  "RFQ_CLICKHOUSE_URL: http://clickhouse:8123",
], "docker-compose.yml");

for (const [path, source] of rawDeployments) {
  assertContains(source, [
    'command: ["node", "backend/dist/db/migrate.js"]',
    "name: NODE_ENV",
    "configMapKeyRef:",
    "key: NODE_ENV",
  ], path);
}
for (const [path, source] of rawSecrets) {
  assert.ok(
    /^\s+DATABASE_URL: .*sslmode=verify-full$/m.test(source),
    `${path} must require hostname-verified PostgreSQL TLS`,
  );
}
const rawBackendSecret = rawSecrets.find(([path]) => path.endsWith("backend-secret.yaml"))[1];
assertContains(rawBackendSecret, ["RFQ_REDIS_URL: rediss://"], "infra/k8s/backend-secret.yaml");
assert.ok(!rawBackendSecret.includes("RFQ_REDIS_URL: redis://"), "production Redis Secret must not use plaintext");

for (const [path, source] of helmDeployments) {
  assertContains(source, [
    "env.NODE_ENV is required for database transport policy",
    ".Values.env.NODE_ENV",
  ], path);
}
for (const [path, source] of helmDeployments.slice(1)) {
  assertContains(source, ["env.NODE_ENV is required for worker transport policy"], path);
}
assert.ok(helmSchema.required.includes("env"), "Helm schema must require env");
assert.equal(
  helmSchema.properties.env.properties.NODE_ENV.const,
  "production",
  "Helm schema must prevent production transport policy bypass",
);

for (const [label, source, terms] of [
  ["README.md", readme, ["sslmode=verify-full", "`rediss://`", "plaintext dependency transport"]],
  ["Kubernetes chapter", kubernetesChapter, ["Kafka TLS plus SASL", "ClickHouse", "sslrootcert"]],
  ["API Gateway chapter", gatewayChapter, ["`rediss://`", "`sslmode=verify-full`"]],
  ["threat model", threatModel, ["Plaintext or downgrade-prone dependency transport", "Kafka TLS plus SASL"]],
  ["audit checklist", auditChecklist, ["hostname-verified PostgreSQL TLS", "ClickHouse HTTPS"]],
]) {
  assertContains(source, terms, label);
}

console.log("Transport security consistency check passed for API, migration, and 5 workers");

function assertContains(source, needles, label) {
  for (const needle of needles) {
    assert.ok(source.includes(needle), `${label} must include ${needle}`);
  }
}

function countOccurrences(source, needle) {
  return source.split(needle).length - 1;
}
