#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const rateLimiterSource = await readFile("backend/src/modules/rate-limit/rate-limit.service.ts", "utf8");
const redisRateLimiterSource = await readFile("backend/src/modules/rate-limit/redis-rate-limit.service.ts", "utf8");
const mainSource = await readFile("backend/src/main.ts", "utf8");
const apiGatewayEnvTestSource = await readFile("backend/test/api-gateway-env.test.mjs", "utf8");
const apiGatewayTestSource = await readFile("backend/test/api-gateway.test.mjs", "utf8");
const apiRateLimitTestSource = await readFile("backend/test/api-rate-limit.test.mjs", "utf8");
const apiRedisRateLimitTestSource = await readFile("backend/test/api-redis-rate-limit.test.mjs", "utf8");
const rateLimitTestSource = await readFile("backend/test/rate-limit.test.mjs", "utf8");
const redisRateLimitTestSource = await readFile("backend/test/redis-rate-limit.test.mjs", "utf8");
const sdkClientSource = await readFile("sdk/src/client.ts", "utf8");
const sdkClientErrorsTestSource = await readFile("sdk/test/sdk-client-errors.test.mjs", "utf8");
const frontendErrorSource = await readFile("frontend/src/lib/errors.ts", "utf8");
const frontendStatusPanelSource = await readFile("frontend/src/components/QuoteStatusPanel.tsx", "utf8");
const openapiSource = await readFile("docs/api/openapi.yaml", "utf8");
const errorDocsSource = await readFile("docs/api/errors.md", "utf8");
const gatewayChapterSource = await readFile("book/Volume5-BackendEngineering/Chapter01-API-Gateway.md", "utf8");
const readmeSource = await readFile("README.md", "utf8");
const envExampleSource = await readFile(".env.example", "utf8");
const composeSource = await readFile("docker-compose.yml", "utf8");
const k8sConfigSource = await readFile("infra/k8s/configmap.yaml", "utf8");
const k8sSecretSource = await readFile("infra/k8s/backend-secret.yaml", "utf8");
const helmValuesSource = await readFile("infra/helm/rfq-market-maker/values.yaml", "utf8");
const helmDeploymentSource = await readFile("infra/helm/rfq-market-maker/templates/deployment.yaml", "utf8");

const defaults = extractDefaultRateLimitConfig(rateLimiterSource);

assert.deepEqual(defaults, {
  windowMs: 60_000,
  maxQuoteRequests: 120,
  maxSubmitRequests: 60,
  maxStatusRequests: 300,
});

assertContains(rateLimiterSource, [
  "assertPositiveSafeInteger",
  'assertPositiveSafeInteger(config.windowMs, "windowMs")',
  'assertPositiveSafeInteger(config.maxQuoteRequests, "maxQuoteRequests")',
  'assertPositiveSafeInteger(config.maxSubmitRequests, "maxSubmitRequests")',
  'assertPositiveSafeInteger(config.maxStatusRequests, "maxStatusRequests")',
  "normalizeRateLimitInput(input)",
  "maxRateLimitClientIdLength",
  "rateLimitClientIdPattern",
  "Rate limit input must be an object",
  "Rate limit clientId must be 128 characters or fewer",
  "Rate limit clientId must contain only letters, numbers, dot, underscore, colon, or hyphen",
  "clientId.trim().toLowerCase()",
  "Rate limit ${field} must be a positive safe integer",
], "backend/src/modules/rate-limit/rate-limit.service.ts");

assertContains(redisRateLimiterSource, [
  "class RedisRateLimiter",
  "implements RateLimiter",
  'redis.call("GET", KEYS[1])',
  'redis.call("SET", KEYS[1], 1, "PX", ARGV[1])',
  'redis.call("INCR", KEYS[1])',
  "if current >= tonumber(ARGV[2])",
  "assertScriptResult(result)",
  "normalizeRateLimitInput(input)",
  "limitForRateLimitEndpoint",
  "async checkHealth()",
  'response !== "PONG"',
  "lazyConnect: true",
  "enableOfflineQueue: false",
  "maxRetriesPerRequest: 1",
  "RFQ_REDIS_URL must be a valid redis:// or rediss:// URL without a fragment",
], "backend/src/modules/rate-limit/redis-rate-limit.service.ts");

assertContains(mainSource, [
  "new InMemoryRateLimiter",
  "new RedisRateLimiter",
  "createRedisRateLimitClient(redisUrl)",
  "resolveRateLimiter(options)",
  'readOwnEnvValue(env, "RFQ_RATE_LIMIT_BACKEND")',
  'readOwnEnvValue(env, "RFQ_REDIS_URL")',
  "RFQ_RATE_LIMIT_BACKEND must be redis when NODE_ENV=${nodeEnv}",
  'new APIError("RATE_LIMIT_UNAVAILABLE", "Rate limit store unavailable", 503)',
  "assertRateLimitDecision(decision)",
  'rateLimitDecisionFields = ["allowed", "remaining", "retryAfterSeconds"]',
  "rateLimiter: rateLimiter ?? disabledRateLimiterHealth",
  "normalizeRateLimitOption(options.rateLimit)",
  "assertOptionalOwnFields(rateLimit, rateLimitOptionFields, \"rateLimit\")",
  "windowMs: rateLimit.windowMs ?? 60_000",
  "maxQuoteRequests: rateLimit.maxQuoteRequests ?? 120",
  "maxSubmitRequests: rateLimit.maxSubmitRequests ?? 60",
  "maxStatusRequests: rateLimit.maxStatusRequests ?? 300",
  'enforceRateLimit(rateLimiter, metricsService, "quote", request, reply, trustProxy)',
  'enforceRateLimit(rateLimiter, metricsService, "submit", request, reply, trustProxy)',
  'enforceRateLimit(rateLimiter, metricsService, "status", request, reply, trustProxy)',
  'new APIError("RATE_LIMITED", "Too many requests", 429)',
  'reply.header("x-ratelimit-remaining"',
  'reply.header("retry-after"',
  "clientIdForRateLimit(request, trustProxy)",
  "assertGatewayRateLimitClientId",
  "maxRateLimitClientIdLength",
  "rateLimitClientIdPattern",
  'new APIError("INVALID_REQUEST", "Rate limit clientId must be 128 characters or fewer", 400)',
  'new APIError("INVALID_REQUEST",',
  "Rate limit clientId must contain only letters, numbers, dot, underscore, colon, or hyphen",
  "const defaultTrustProxy = false;",
  "trustProxy?: boolean",
  "readTrustProxy()",
  "RFQ_TRUST_PROXY must be true or false",
  "if (!trustProxy)",
  'request.headers["x-forwarded-for"]',
], "backend/src/main.ts");

assertContains(apiGatewayTestSource, [
  "RFQ API rejects unsafe rate limit configuration at startup",
  "buildServer rateLimit must be an object or false",
  "buildServer rateLimit.windowMs must be an own field when provided",
], "backend/test/api-gateway.test.mjs");

assertContains(apiGatewayEnvTestSource, [
  "RFQ API rejects invalid RFQ_TRUST_PROXY at startup",
], "backend/test/api-gateway-env.test.mjs");

assertContains(apiRateLimitTestSource, [
  "rate limits quote requests by client",
  "does not trust x-forwarded-for for rate limit identity by default",
  "trusts x-forwarded-for for rate limit identity only when proxy trust is enabled",
  "rejects oversized trusted forwarded rate limit identity",
  "rejects unsafe trusted forwarded rate limit identity",
  "rate limits submit requests before validation and settlement",
  "rate limits quote status requests by client",
  "assert.equal(secondQuote.statusCode, 429)",
  'assert.equal(secondQuote.body.code, "RATE_LIMITED")',
  "assert.equal(secondSubmit.statusCode, 429)",
  'assert.equal(secondSubmit.body.code, "RATE_LIMITED")',
  "assert.equal(secondStatus.statusCode, 429)",
  'assert.equal(secondStatus.body.code, "RATE_LIMITED")',
], "backend/test/api-rate-limit.test.mjs");

assertContains(rateLimitTestSource, [
  "InMemoryRateLimiter normalizes client identities before bucketing",
  "Rate limit input must be an object",
  "Rate limit clientId must be a primitive string",
  'new String("client-a")',
  "Rate limit clientId must be 128 characters or fewer",
  "Rate limit clientId must contain only letters, numbers, dot, underscore, colon, or hyphen",
], "backend/test/rate-limit.test.mjs");

assertContains(redisRateLimitTestSource, [
  "RedisRateLimiter maps atomic script results to endpoint decisions",
  "RedisRateLimiter snapshots configuration and supports bounded key prefixes",
  "RedisRateLimiter validates dependencies, config, inputs and script output",
  "RedisRateLimiter probes health, connects lazily and closes clients",
  "normalizeRedisUrl accepts Redis URLs and rejects unsafe schemes or fragments",
], "backend/test/redis-rate-limit.test.mjs");

assertContains(apiRedisRateLimitTestSource, [
  "RFQ API awaits injected distributed rate limit decisions",
  "RFQ API fails closed when the distributed rate limit store is unavailable",
  "RFQ API fails closed on malformed distributed rate limit decisions",
  "RFQ API readiness and shutdown include the rate limit store",
  "RFQ API validates Redis rate limit runtime configuration",
  'assert.equal(response.body.code, "RATE_LIMIT_UNAVAILABLE")',
  'response.body.components.rateLimitStore, "degraded"',
], "backend/test/api-redis-rate-limit.test.mjs");

assertContains(sdkClientSource, [
  "readonly retryAfterSeconds?: number",
  "retryAfterSeconds(response)",
  'response.headers.get("retry-after")',
  "retryAfterSecondsPattern = /^[1-9][0-9]*$/",
  "Number.isSafeInteger(seconds)",
], "sdk/src/client.ts");

assertContains(sdkClientErrorsTestSource, [
  "exposes Retry-After seconds for rate limited responses",
  "ignores non-canonical Retry-After headers",
  'code: "RATE_LIMITED"',
  '"retry-after": "60"',
  '"60.0"',
  '"6e1"',
  "assert.equal(error.retryAfterSeconds, 60)",
  "assert.equal(error.retryAfterSeconds, undefined)",
], "sdk/test/sdk-client-errors.test.mjs");

assertContains(frontendErrorSource, [
  "retryAfterSeconds?: number",
  "retryAfterSeconds: error.retryAfterSeconds",
], "frontend/src/lib/errors.ts");

assertContains(frontendStatusPanelSource, [
  "error.retryAfterSeconds",
  "Retry After",
  "{error.retryAfterSeconds}s",
], "frontend/src/components/QuoteStatusPanel.tsx");

for (const path of ["/quote:", "/submit:", "/quote/{quoteId}:", "/hedges/{hedgeOrderId}:", "/settlements/{settlementEventId}:", "/pnl:"]) {
  const pathBlock = extractOpenapiPathBlock(openapiSource, path);
  assert.ok(pathBlock.includes('"429":'), `OpenAPI ${path} must document HTTP 429`);
  assert.ok(pathBlock.includes("Retry-After:"), `OpenAPI ${path} must document Retry-After header`);
  assert.ok(pathBlock.includes("#/components/schemas/ErrorResponse"), `OpenAPI ${path} 429 must use ErrorResponse`);
}

assertContains(errorDocsSource, [
  "| `RATE_LIMITED` | 429 |",
  "`RATE_LIMITED` 响应必须返回 HTTP 429，并带 `Retry-After` header。",
  "## Rate Limit Policy",
  "| `quote` | `POST /quote` | 120 requests / 60 seconds | HTTP 429, `RATE_LIMITED`, `Retry-After` |",
  "| `submit` | `POST /submit` | 60 requests / 60 seconds | HTTP 429, `RATE_LIMITED`, `Retry-After` |",
  "| `status` | `GET /quote/:quoteId`, `GET /settlements/:settlementEventId`, `GET /hedges/:hedgeOrderId`, `GET /pnl` | 300 requests / 60 seconds | HTTP 429, `RATE_LIMITED`, `Retry-After` |",
  "`x-forwarded-for` is ignored unless `RFQ_TRUST_PROXY=true`",
  "forwarded client identities longer than 128 characters or outside `[A-Za-z0-9_.:-]` are rejected as `INVALID_REQUEST`/400",
  "| `RATE_LIMIT_UNAVAILABLE` | 503 |",
  "Redis failure is fail-closed as `RATE_LIMIT_UNAVAILABLE`/503",
], "docs/api/errors.md");

assertContains(gatewayChapterSource, [
  "默认窗口为 60 秒",
  "quote 120 requests / 60 seconds",
  "submit 60 requests / 60 seconds",
  "status 300 requests / 60 seconds",
  "任何非本地 `NODE_ENV` 都强制 `RFQ_RATE_LIMIT_BACKEND=redis`",
  "单个 Lua script",
  "超限后不继续递增计数",
  "默认 `RFQ_TRUST_PROXY=false`",
  "trusted forwarded identity exceeding 128 characters or outside `[A-Za-z0-9_.:-]` returns `INVALID_REQUEST`/400",
  "`RATE_LIMIT_UNAVAILABLE`/503",
  "`rateLimitStore` readiness",
], "book/Volume5-BackendEngineering/Chapter01-API-Gateway.md");

assertContains(readmeSource, [
  "`RFQClientError` preserves structured API errors.",
  "HTTP 429 `RATE_LIMITED`",
  "`retryAfterSeconds`",
  "`Retry-After` header",
  "`RFQ_TRUST_PROXY=false`",
  "128 character limit and `[A-Za-z0-9_.:-]` character set",
  "forces `RFQ_RATE_LIMIT_BACKEND=redis`",
  "Redis uses one atomic Lua operation",
  "`RATE_LIMIT_UNAVAILABLE`/503",
], "README.md");

assertContains(envExampleSource, ["RFQ_RATE_LIMIT_BACKEND=memory"], ".env.example");
assertContains(composeSource, [
  "RFQ_RATE_LIMIT_BACKEND: redis",
  "RFQ_REDIS_URL: redis://redis:6379/0",
  "redis:",
  "condition: service_healthy",
], "docker-compose.yml");
assertContains(k8sConfigSource, ["RFQ_RATE_LIMIT_BACKEND: redis"], "infra/k8s/configmap.yaml");
assertContains(k8sSecretSource, ["RFQ_REDIS_URL:"], "infra/k8s/backend-secret.yaml");
assertContains(helmValuesSource, ["redisSecret:", "urlKey: RFQ_REDIS_URL"], "infra/helm/rfq-market-maker/values.yaml");
assertContains(helmDeploymentSource, [
  "name: RFQ_REDIS_URL",
  "name: {{ .Values.redisSecret.name }}",
  "key: {{ .Values.redisSecret.urlKey }}",
], "infra/helm/rfq-market-maker/templates/deployment.yaml");

console.log("Rate limit consistency check passed");

function extractDefaultRateLimitConfig(source) {
  const match = source.match(/export const defaultRateLimitConfig: RateLimitConfig = \{([\s\S]*?)\};/);
  assert.ok(match, "defaultRateLimitConfig block not found");

  return {
    windowMs: readNumber(match[1], "windowMs"),
    maxQuoteRequests: readNumber(match[1], "maxQuoteRequests"),
    maxSubmitRequests: readNumber(match[1], "maxSubmitRequests"),
    maxStatusRequests: readNumber(match[1], "maxStatusRequests"),
  };
}

function readNumber(source, key) {
  const match = source.match(new RegExp(`${key}:\\s*([0-9_]+),`));
  assert.ok(match, `${key} not found`);
  return Number(match[1].replaceAll("_", ""));
}

function extractOpenapiPathBlock(source, pathHeader) {
  const start = source.indexOf(`  ${pathHeader}`);
  assert.ok(start >= 0, `OpenAPI path ${pathHeader} not found`);

  const rest = source.slice(start + 1);
  const next = rest.search(/^  \/[a-zA-Z{]/m);
  return next >= 0 ? source.slice(start, start + 1 + next) : source.slice(start);
}

function assertContains(source, needles, label) {
  for (const needle of needles) {
    assert.ok(source.includes(needle), `${label} must include ${needle}`);
  }
}
