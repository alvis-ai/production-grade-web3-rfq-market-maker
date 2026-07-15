#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(path, "utf8");

const databaseConfig = await read("backend/src/db/config.ts");
const databasePool = await read("backend/src/db/pool.ts");
const redisRateLimiter = await read("backend/src/modules/rate-limit/redis-rate-limit.service.ts");
const gatewayRuntime = await read("backend/src/runtime/gateway-runtime.ts");
const rpcValidation = await read("backend/src/shared/validation/rpc.ts");
const receiptProvider = await read("backend/src/modules/execution/receipt-settlement-evidence.provider.ts");
const treasuryProvider = await read("backend/src/modules/risk/treasury-liquidity.provider.ts");
const settlementIndexerReader = await read("backend/src/modules/indexer/settlement-indexer.reader.ts");
const settlementIndexerWorker = await read("backend/src/modules/indexer/settlement-indexer.worker.ts");
const settlementIndexerRuntime = await read("backend/src/settlement-indexer-main.ts");
const chainlinkConfig = await read("backend/src/modules/market-data/chainlink-config.ts");
const analyticsRuntime = await read("backend/src/analytics-worker-main.ts");
const signerRuntime = await read("backend/src/signer-main.ts");
const signerRuntimeTests = await read("backend/test/signer-process-runtime.test.mjs");
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
const receiptTests = await read("backend/test/receipt-settlement-evidence.test.mjs");
const treasuryTests = await read("backend/test/treasury-liquidity-provider.test.mjs");
const settlementIndexerReaderTests = await read("backend/test/settlement-indexer-reader.test.mjs");
const settlementIndexerRuntimeTests = await read("backend/test/settlement-indexer-runtime.test.mjs");
const settlementIndexerTests = await read("backend/test/settlement-indexer.test.mjs");
const analyticsTests = await read("backend/test/analytics-worker-runtime.test.mjs");
const chainlinkTests = await read("backend/test/chainlink-market-data.test.mjs");
const compose = await read("docker-compose.yml");
const rawSignerDeployment = await read("infra/k8s/signer-deployment.yaml");
const rawSignerSecret = await read("infra/k8s/signer-secret.yaml");
const helmSignerDeployment = await read("infra/helm/rfq-market-maker/templates/signer-deployment.yaml");
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
assertContains(signerRuntime, [
  'RFQ_SIGNER_AUDIT_BACKEND=memory is not allowed when NODE_ENV=',
  'readDatabaseConfig({ NODE_ENV: nodeEnv, DATABASE_URL: auditDatabaseUrl })',
  'RFQ_SIGNER_AUDIT_DATABASE_URL is required for the postgres signer audit backend',
], "backend/src/signer-main.ts");
assertContains(signerRuntimeTests, [
  "dedicated production audit database",
  "sslmode=verify-full",
  "sslrootcert=",
], "backend/test/signer-process-runtime.test.mjs");

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
assertContains(chainlinkConfig, [
  'parsed.protocol !== "https:"',
  'parsed.protocol === "http:" && loopback',
  'parsed.hostname.includes("*")',
  "bounded HTTPS URL or loopback HTTP URL",
], "backend/src/modules/market-data/chainlink-config.ts");
assertContains(rpcValidation, [
  "export interface RpcUrlPolicy",
  'parsed.protocol === "https:"',
  'parsed.hostname.includes("*")',
  "parsed.hash",
  'Object.hasOwn(value, "requireTls")',
  "export function assertRpcChainId",
  "chain ID does not match configured chain",
], "backend/src/shared/validation/rpc.ts");
assert.equal(
  countOccurrences(gatewayRuntime, "{ requireTls: requiresExplicitRuntimeConfig(nodeEnv) }"),
  2,
  "API receipt and Treasury configuration must both apply the non-local RPC TLS policy",
);
assertContains(receiptProvider, [
  'assertRpcChainId(await reader.getChainId(), chain.chainId, "Receipt RPC")',
  "getChainId: () => client.getChainId()",
], "receipt settlement evidence provider");
assertContains(treasuryProvider, [
  "private readonly chainChecks",
  "await this.assertChainIdentity(chain, reader)",
  "void check.catch(() => this.chainChecks.delete(chain.chainId))",
  "getChainId: () => client.getChainId()",
], "Treasury liquidity provider");
assertContains(settlementIndexerReader, [
  "rpcPolicy: RpcUrlPolicy",
  "getChainId: () => client.getChainId()",
], "settlement indexer reader");
assertContains(settlementIndexerRuntime, [
  "{ requireTls: requiresExplicitRuntimeConfig(nodeEnv) }",
], "settlement indexer runtime");
assertContains(settlementIndexerWorker, [
  "await assertReaderChainId(reader, chainId)",
  'throw new SettlementIndexerError("RPC_OR_STORE_UNAVAILABLE")',
], "settlement indexer worker");
assert.ok(
  settlementIndexerWorker.indexOf("await assertReaderChainId(reader, chainId)") <
    settlementIndexerWorker.indexOf("const cursor = await this.store.claimCursor"),
  "settlement indexer must verify the active chain before claiming a cursor",
);

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
  '"http://rpc.example.com/v1/key"',
  "/must use a bounded HTTPS URL/",
], "backend/test/api-execution-env.test.mjs");
assertContains(receiptTests, [
  "rejects a wrong RPC chain before reading settlement evidence",
  "http://host.docker.internal:8545",
  "{ requireTls: true }",
], "receipt settlement evidence tests");
assertContains(treasuryTests, [
  "rejects a wrong chain before balance reads and retries failed checks",
  "a successful chain identity check is cached for the quote hot path",
], "Treasury liquidity tests");
assertContains(settlementIndexerReaderTests, [
  "http://host.docker.internal:8545",
  "{ requireTls: true }",
], "settlement indexer reader tests");
assertContains(settlementIndexerRuntimeTests, [
  'baseEnv("http://rpc.example/project-token")',
  'NODE_ENV: "development"',
], "settlement indexer runtime tests");
assertContains(settlementIndexerTests, [
  "rejects a wrong RPC chain before claiming a cursor",
  "assert.equal(fixture.store.claimCalls, 0)",
], "settlement indexer worker tests");
assertContains(analyticsTests, [
  "requires authenticated TLS dependencies in production",
  "KAFKA_SSL must be true",
  "SASL credentials are required",
  "must use https",
], "backend/test/analytics-worker-runtime.test.mjs");
assertContains(chainlinkTests, [
  'rpcUrl = "http://rpc.example.com/v1/key"',
  "/bounded HTTPS/",
], "backend/test/chainlink-market-data.test.mjs");

assert.equal(
  countOccurrences(compose, "NODE_ENV: development"),
  8,
  "Compose must explicitly mark migration, API, signer and five workers as development",
);
assertContains(compose, [
  "RFQ_REDIS_URL: redis://redis:6379/0",
  "RFQ_ANALYTICS_KAFKA_SSL: \"false\"",
  "RFQ_CLICKHOUSE_URL: http://clickhouse:8123",
  '"rpcUrl":"http://host.docker.internal:8545"',
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
assert.match(
  rawSignerSecret,
  /^\s+RFQ_SIGNER_AUDIT_DATABASE_URL: postgres:\/\/[^\n]*sslmode=verify-full[^\n]*sslrootcert=/m,
  "signer audit Secret must require hostname-verified PostgreSQL TLS with an explicit CA",
);
assertContains(rawSignerDeployment, [
  "RFQ_SIGNER_AUDIT_DATABASE_URL",
  "mountPath: /etc/rfq-signer-database-ca",
], "infra/k8s/signer-deployment.yaml");
assertContains(helmSignerDeployment, [
  "RFQ_SIGNER_AUDIT_DATABASE_URL",
  ".Values.signerService.secret.databaseCaCertKey",
], "Helm signer deployment");

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
  ["README.md", readme, ["sslmode=verify-full", "`rediss://`", "plaintext dependency transport", "Non-local indexer RPC URLs must use HTTPS"]],
  ["Kubernetes chapter", kubernetesChapter, ["Kafka TLS plus SASL", "ClickHouse", "sslrootcert", "startup and every poll verify `eth_chainId`"]],
  ["API Gateway chapter", gatewayChapter, ["`rediss://`", "`sslmode=verify-full`"]],
  ["threat model", threatModel, ["Plaintext or downgrade-prone dependency transport", "Kafka TLS plus SASL", "Wrong-chain or plaintext settlement RPC"]],
  ["audit checklist", auditChecklist, ["hostname-verified PostgreSQL TLS", "ClickHouse HTTPS", "active chain ID before consuming transaction"]],
]) {
  assertContains(source, terms, label);
}

console.log("Transport security consistency check passed for API, signer, Chainlink, settlement RPCs, migration, and 5 workers");

function assertContains(source, needles, label) {
  for (const needle of needles) {
    assert.ok(source.includes(needle), `${label} must include ${needle}`);
  }
}

function countOccurrences(source, needle) {
  return source.split(needle).length - 1;
}
