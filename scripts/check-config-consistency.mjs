#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { readBackendGatewaySource } from "./lib/read-backend-gateway-source.mjs";

const envExampleSource = await readFile(".env.example", "utf8");
const composeSource = await readFile("docker-compose.yml", "utf8");
const k8sConfigSource = await readFile("infra/k8s/configmap.yaml", "utf8");
const helmValuesSource = await readFile("infra/helm/rfq-market-maker/values.yaml", "utf8");
const backendSource = await readBackendGatewaySource();
const apiKeyAuthSource = await readFile("backend/src/modules/auth/api-key-auth.service.ts", "utf8");
const hedgeWorkerSource = await readFile("backend/src/hedge-worker-main.ts", "utf8");
const analyticsWorkerSource = await readFile("backend/src/analytics-worker-main.ts", "utf8");
const frontendConfigSource = await readFile("frontend/src/lib/config.ts", "utf8");
const readmeSource = await readFile("README.md", "utf8");
const tokenRegistryJson = '{"tokens":[{"chainId":1,"tokenAddress":"0x0000000000000000000000000000000000000002","symbol":"TOKEN2","decimals":18,"isWhitelisted":true,"riskTier":"low","usdReference":true},{"chainId":1,"tokenAddress":"0x0000000000000000000000000000000000000003","symbol":"TOKEN3","decimals":18,"isWhitelisted":true,"riskTier":"low","usdReference":true}]}';
const riskPolicyJson = '{"policyVersion":"token-limit-risk-v1","enabledChainIds":[1],"tokenLimits":[{"chainId":1,"tokenAddress":"0x0000000000000000000000000000000000000002","maxAmountIn":"1000000000000000000000","minAmountOut":"1","maxAbsoluteInventory":"10000000000000000000000"},{"chainId":1,"tokenAddress":"0x0000000000000000000000000000000000000003","maxAmountIn":"1000000000000000000000","minAmountOut":"1","maxAbsoluteInventory":"10000000000000000000000"}],"restrictedUsers":[],"toxicFlowScores":[],"maxToxicScoreBps":8000,"maxSlippageBps":500,"maxQuotedSpreadBps":1000}';

const localExpected = {
  HOST: "127.0.0.1",
  PORT: "3000",
  RFQ_QUOTE_TTL_SECONDS: "30",
  RFQ_BODY_LIMIT_BYTES: "32768",
  RFQ_SUBMIT_RESERVATION_LEASE_MS: "900000",
  RFQ_CORS_ALLOWED_ORIGINS: "http://localhost:5173",
  RFQ_ENABLE_HSTS: "false",
  RFQ_TRUST_PROXY: "false",
  RFQ_RATE_LIMIT_BACKEND: "memory",
  RFQ_TOKEN_REGISTRY_JSON: tokenRegistryJson,
  RFQ_RISK_POLICY_JSON: riskPolicyJson,
  VITE_RFQ_API_BASE_URL: "http://localhost:3000",
  VITE_RFQ_SETTLEMENT_ADDRESS: "0x0000000000000000000000000000000000000004",
  VITE_WALLETCONNECT_PROJECT_ID: "00000000000000000000000000000000",
  RFQ_SIGNER_MODE: "local",
  RFQ_SIGNER_PRIVATE_KEY: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  RFQ_SETTLEMENT_ADDRESS: "0x0000000000000000000000000000000000000004",
};

const composeExpected = {
  HOST: "0.0.0.0",
  PORT: "3000",
  NODE_ENV: "development",
  RFQ_QUOTE_TTL_SECONDS: "30",
  RFQ_BODY_LIMIT_BYTES: "32768",
  RFQ_SUBMIT_RESERVATION_LEASE_MS: "900000",
  RFQ_CORS_ALLOWED_ORIGINS: "http://localhost:5173",
  RFQ_ENABLE_HSTS: "false",
  RFQ_TRUST_PROXY: "false",
  RFQ_RATE_LIMIT_BACKEND: "redis",
  RFQ_REDIS_URL: "redis://redis:6379/0",
  RFQ_TOKEN_REGISTRY_JSON: tokenRegistryJson,
  RFQ_RISK_POLICY_JSON: riskPolicyJson,
  RFQ_SIGNER_MODE: "local",
  RFQ_SIGNER_PRIVATE_KEY: localExpected.RFQ_SIGNER_PRIVATE_KEY,
  RFQ_SETTLEMENT_ADDRESS: localExpected.RFQ_SETTLEMENT_ADDRESS,
};

const productionExpected = {
  NODE_ENV: "production",
  HOST: "0.0.0.0",
  PORT: "3000",
  RFQ_LOG_LEVEL: "info",
  RFQ_QUOTE_TTL_SECONDS: "30",
  RFQ_BODY_LIMIT_BYTES: "32768",
  RFQ_SUBMIT_RESERVATION_LEASE_MS: "900000",
  RFQ_CORS_ALLOWED_ORIGINS: "https://app.example.com",
  RFQ_ENABLE_HSTS: "true",
  RFQ_TRUST_PROXY: "false",
  RFQ_RATE_LIMIT_BACKEND: "redis",
  RFQ_SIGNER_MODE: "aws-kms",
  RFQ_AWS_KMS_REGION: "us-east-1",
  RFQ_AWS_KMS_MAX_ATTEMPTS: "3",
  RFQ_TOKEN_REGISTRY_JSON: tokenRegistryJson,
  RFQ_RISK_POLICY_JSON: riskPolicyJson,
};

const envExample = parseDotEnv(envExampleSource);
const composeBackendEnv = parseComposeBackendEnvironment(composeSource);
const k8sConfig = parseConfigMapData(k8sConfigSource);
const helmEnv = parseHelmEnv(helmValuesSource);
const readmeLocalConfig = parseReadmeLocalConfig(readmeSource);

assertConfig(envExample, localExpected, ".env.example");
assertConfig(readmeLocalConfig, localExpected, "README Local Configuration block");
assertConfig(composeBackendEnv, composeExpected, "docker-compose backend environment");
assertConfig(k8sConfig, productionExpected, "infra/k8s/configmap.yaml data");
assertConfig(helmEnv, productionExpected, "infra/helm/rfq-market-maker/values.yaml env");

assert.ok(backendSource.includes("const defaultBodyLimitBytes = 32_768;"), "backend default body limit must be 32768");
assert.ok(
  backendSource.includes('const defaultCorsAllowedOrigins = ["http://localhost:5173"];'),
  "backend default CORS origin must match local frontend URL",
);
assert.ok(backendSource.includes("const defaultEnableHsts = false;"), "backend default HSTS must be false");
assert.ok(backendSource.includes("const defaultTrustProxy = false;"), "backend default proxy trust must be false");
assert.ok(backendSource.includes('const defaultListenHost = "127.0.0.1";'), "backend default listen host must be 127.0.0.1");
assert.ok(backendSource.includes("const defaultListenPort = 3000;"), "backend default listen port must be 3000");
assert.ok(
  backendSource.includes("readDecimalIntegerConfig") &&
    backendSource.includes("must be a base-10 integer between") &&
    backendSource.includes('name: "PORT"') &&
    backendSource.includes("max: 65_535") &&
    backendSource.includes("min: 1"),
  "backend must enforce PORT base-10 integer bounds",
);
assert.ok(
  backendSource.includes("readDecimalIntegerConfig") &&
    backendSource.includes('name: "RFQ_QUOTE_TTL_SECONDS"') &&
    backendSource.includes("max: 3600") &&
    backendSource.includes("min: 1"),
  "backend must enforce RFQ_QUOTE_TTL_SECONDS base-10 integer bounds",
);
assert.ok(
  backendSource.includes("readDecimalIntegerConfig") &&
    backendSource.includes('name: "RFQ_BODY_LIMIT_BYTES"') &&
    backendSource.includes("max: 1_048_576") &&
    backendSource.includes("min: 1024"),
  "backend must enforce RFQ_BODY_LIMIT_BYTES base-10 integer bounds",
);
assert.ok(
  backendSource.includes('name: "RFQ_SUBMIT_RESERVATION_LEASE_MS"') &&
    backendSource.includes("maxSubmitReservationLeaseMs") &&
    backendSource.includes("minSubmitReservationLeaseMs"),
  "backend must enforce submit reservation lease bounds",
);
assert.ok(
  backendSource.includes('assertIntegerOption(options.bodyLimitBytes, "bodyLimitBytes", 1024, 1_048_576)') &&
    backendSource.includes('assertIntegerOption(options.quoteTtlSeconds, "quoteTtlSeconds", 1, 3600)'),
  "backend direct buildServer numeric options must enforce runtime bounds",
);
assert.ok(
  backendSource.includes('assertBooleanOption(options.logger, "logger")') &&
    backendSource.includes('assertBooleanOption(options.enableHsts, "enableHsts")') &&
    backendSource.includes('assertBooleanOption(options.trustProxy, "trustProxy")'),
  "backend direct buildServer boolean options must fail fast",
);
assert.ok(
  backendSource.includes("RFQ_ENABLE_HSTS must be true or false"),
  "backend must enforce RFQ_ENABLE_HSTS boolean parsing",
);
assert.ok(
  backendSource.includes("RFQ_TRUST_PROXY must be true or false"),
  "backend must enforce RFQ_TRUST_PROXY boolean parsing",
);
assert.ok(
  backendSource.includes("RFQ_RATE_LIMIT_BACKEND must be memory or redis") &&
    backendSource.includes("RFQ_REDIS_URL is required when RFQ_RATE_LIMIT_BACKEND=redis"),
  "backend must enforce distributed rate limit configuration",
);
assert.ok(
  envExampleSource.includes("RFQ_API_KEY_CONFIG_JSON") &&
    backendSource.includes("RFQ_API_KEY_CONFIG_JSON is required when NODE_ENV=") &&
    apiKeyAuthSource.includes("parseApiKeyAuthConfig") &&
    apiKeyAuthSource.includes("timingSafeEqual"),
  "API-key authentication must be optional locally, required in production, and digest-validated",
);
assert.ok(
  backendSource.includes("DATABASE_URL is required when NODE_ENV=") &&
    backendSource.includes("resolvePostgresPool(options)"),
  "backend must require PostgreSQL persistence outside local environments",
);
assert.ok(
  hedgeWorkerSource.includes('readRequired(env, "DATABASE_URL")') &&
    hedgeWorkerSource.includes('readRequired(env, "RFQ_HEDGE_ROUTES_JSON")') &&
    hedgeWorkerSource.includes('readCredential(env, "RFQ_BINANCE_API_KEY")') &&
    hedgeWorkerSource.includes('readCredential(env, "RFQ_BINANCE_API_SECRET")') &&
    hedgeWorkerSource.includes("placeholder must be replaced") &&
    hedgeWorkerSource.includes("must exceed two RFQ_BINANCE_REQUEST_TIMEOUT_MS windows"),
  "hedge worker must require durable queue, isolated venue credentials, and a safe lease window",
);
assert.ok(
  k8sConfigSource.includes("RFQ_HEDGE_ROUTES_JSON:") &&
    k8sConfigSource.includes('RFQ_HEDGE_LEASE_MS: "30000"') &&
    k8sConfigSource.includes('RFQ_BINANCE_REQUEST_TIMEOUT_MS: "10000"'),
  "Kubernetes config must define non-secret hedge worker routing and timing controls",
);
assert.ok(
  analyticsWorkerSource.includes('readCsv(env, "RFQ_ANALYTICS_KAFKA_BROKERS")') &&
    analyticsWorkerSource.includes('readRequired(env, "RFQ_CLICKHOUSE_URL")') &&
    analyticsWorkerSource.includes("must exceed batch size times Kafka request timeout") &&
    analyticsWorkerSource.includes("placeholder must be replaced") &&
    analyticsWorkerSource.includes('configuredTopic !== analyticsTopic'),
  "analytics worker must require durable endpoints, a fixed topic, isolated secrets, and a safe lease window",
);
assert.ok(
  k8sConfigSource.includes('RFQ_ANALYTICS_KAFKA_TOPIC: "rfq.analytics.v1"') &&
    k8sConfigSource.includes('RFQ_ANALYTICS_LEASE_MS: "120000"') &&
    k8sConfigSource.includes('RFQ_CLICKHOUSE_ANALYTICS_TABLE: "rfq_analytics_events"') &&
    helmValuesSource.includes("analyticsWorker:") &&
    helmValuesSource.includes('RFQ_ANALYTICS_KAFKA_SSL: "true"'),
  "Kubernetes and Helm config must define non-secret analytics pipeline controls",
);
assert.ok(
  composeSource.includes("internal://redpanda:9092") &&
    composeSource.includes("external://localhost:19092") &&
    composeSource.includes("redpanda-topic-init:") &&
    composeSource.includes('RFQ_ANALYTICS_KAFKA_BROKERS: redpanda:9092'),
  "Compose must expose distinct Redpanda listeners and initialize the analytics topic",
);
assert.ok(
  frontendConfigSource.includes("readOptionalConfigString") &&
    frontendConfigSource.includes("must be a primitive string"),
  "frontend must reject non-primitive env configuration values before trimming",
);
assert.ok(
  frontendConfigSource.includes("VITE_RFQ_API_BASE_URL must be an absolute http(s) URL"),
  "frontend must reject non-URL API base configuration",
);
assert.ok(
  frontendConfigSource.includes("VITE_RFQ_API_BASE_URL must use http or https"),
  "frontend must reject non-http API base configuration",
);
assert.ok(
  frontendConfigSource.includes("VITE_RFQ_API_BASE_URL must not include credentials"),
  "frontend must reject API base URL credentials",
);
assert.ok(
  frontendConfigSource.includes("VITE_RFQ_API_BASE_URL host must not contain wildcards"),
  "frontend must reject API base URL wildcard hosts",
);
assert.ok(
  frontendConfigSource.includes("VITE_RFQ_API_BASE_URL must not include query strings or fragments"),
  "frontend must reject API base URL query strings and fragments",
);
assert.ok(
  frontendConfigSource.includes("VITE_RFQ_SETTLEMENT_ADDRESS must be a 20-byte hex address"),
  "frontend must reject invalid settlement address configuration",
);
assert.ok(
  frontendConfigSource.includes("VITE_WALLETCONNECT_PROJECT_ID must be 128 characters or fewer"),
  "frontend must bound WalletConnect project id length",
);
assert.ok(
  frontendConfigSource.includes(
    "VITE_WALLETCONNECT_PROJECT_ID must contain only letters, numbers, underscore, or hyphen",
  ),
  "frontend must reject unsafe WalletConnect project id characters",
);

console.log("Config consistency check passed");

function parseDotEnv(source) {
  const result = {};
  for (const line of source.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const index = trimmed.indexOf("=");
    assert.ok(index > 0, `Invalid .env line: ${line}`);
    result[trimmed.slice(0, index)] = trimmed.slice(index + 1);
  }

  return result;
}

function parseComposeBackendEnvironment(source) {
  const lines = source.split("\n");
  const backendStart = lines.findIndex((line) => line === "  backend:");
  assert.ok(backendStart >= 0, "docker-compose.yml must define backend service");
  const environmentStart = lines.findIndex((line, index) => index > backendStart && line === "    environment:");
  assert.ok(environmentStart >= 0, "docker-compose.yml backend must define environment");

  const result = {};
  for (const line of lines.slice(environmentStart + 1)) {
    if (/^    [a-zA-Z0-9_-]+:/.test(line)) break;
    const match = line.match(/^      ([A-Z0-9_]+):\s*(.+)$/);
    if (match) {
      result[match[1]] = unquote(match[2]);
    }
  }

  return result;
}

function parseConfigMapData(source) {
  const lines = source.split("\n");
  const dataStart = lines.findIndex((line) => line === "data:");
  assert.ok(dataStart >= 0, "ConfigMap must define data");

  const result = {};
  for (const line of lines.slice(dataStart + 1)) {
    const match = line.match(/^  ([A-Z0-9_]+):\s*(.+)$/);
    if (match) {
      result[match[1]] = unquote(match[2]);
    }
  }

  return result;
}

function parseHelmEnv(source) {
  const lines = source.split("\n");
  const envStart = lines.findIndex((line) => line === "env:");
  assert.ok(envStart >= 0, "Helm values must define env");

  const result = {};
  for (const line of lines.slice(envStart + 1)) {
    if (/^[a-zA-Z][a-zA-Z0-9]*:/.test(line)) break;
    const match = line.match(/^  ([A-Z0-9_]+):\s*(.+)$/);
    if (match) {
      result[match[1]] = unquote(match[2]);
    }
  }

  return result;
}

function parseReadmeLocalConfig(source) {
  const match = source.match(/```text\n(HOST=127\.0\.0\.1[\s\S]*?RFQ_SETTLEMENT_ADDRESS=0x\.\.\.)\n```/);
  assert.ok(match, "README Local Configuration block not found");

  const result = parseDotEnv(match[1]);
  result.RFQ_SIGNER_PRIVATE_KEY = localExpected.RFQ_SIGNER_PRIVATE_KEY;
  result.RFQ_SETTLEMENT_ADDRESS = localExpected.RFQ_SETTLEMENT_ADDRESS;
  result.VITE_RFQ_SETTLEMENT_ADDRESS = localExpected.VITE_RFQ_SETTLEMENT_ADDRESS;
  return result;
}

function assertConfig(actual, expected, label) {
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(actual[key], value, `${label} must set ${key}=${value}`);
  }
}

function unquote(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}
