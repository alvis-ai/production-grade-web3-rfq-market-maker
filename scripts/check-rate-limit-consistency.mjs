#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const rateLimiterSource = await readFile("backend/src/modules/rate-limit/rate-limit.service.ts", "utf8");
const mainSource = await readFile("backend/src/main.ts", "utf8");
const apiTestSource = await readFile("backend/test/api.test.mjs", "utf8");
const rateLimitTestSource = await readFile("backend/test/rate-limit.test.mjs", "utf8");
const sdkClientSource = await readFile("sdk/src/client.ts", "utf8");
const sdkTestSource = await readFile("sdk/test/sdk.test.mjs", "utf8");
const frontendErrorSource = await readFile("frontend/src/lib/errors.ts", "utf8");
const frontendStatusPanelSource = await readFile("frontend/src/components/QuoteStatusPanel.tsx", "utf8");
const openapiSource = await readFile("docs/api/openapi.yaml", "utf8");
const errorDocsSource = await readFile("docs/api/errors.md", "utf8");
const gatewayChapterSource = await readFile("book/Volume5-BackendEngineering/Chapter01-API-Gateway.md", "utf8");
const readmeSource = await readFile("README.md", "utf8");

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

assertContains(mainSource, [
  "new InMemoryRateLimiter",
  "windowMs: options.rateLimit?.windowMs ?? 60_000",
  "maxQuoteRequests: options.rateLimit?.maxQuoteRequests ?? 120",
  "maxSubmitRequests: options.rateLimit?.maxSubmitRequests ?? 60",
  "maxStatusRequests: options.rateLimit?.maxStatusRequests ?? 300",
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

assertContains(apiTestSource, [
  "RFQ API rejects unsafe rate limit configuration at startup",
  "RFQ API rejects invalid RFQ_TRUST_PROXY at startup",
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
], "backend/test/api.test.mjs");

assertContains(rateLimitTestSource, [
  "InMemoryRateLimiter normalizes client identities before bucketing",
  "Rate limit input must be an object",
  "Rate limit clientId must be 128 characters or fewer",
  "Rate limit clientId must contain only letters, numbers, dot, underscore, colon, or hyphen",
], "backend/test/rate-limit.test.mjs");

assertContains(sdkClientSource, [
  "readonly retryAfterSeconds?: number",
  "retryAfterSeconds(response)",
  'response.headers.get("retry-after")',
  "retryAfterSecondsPattern = /^[1-9][0-9]*$/",
  "Number.isSafeInteger(seconds)",
], "sdk/src/client.ts");

assertContains(sdkTestSource, [
  "exposes Retry-After seconds for rate limited responses",
  "ignores non-canonical Retry-After headers",
  'code: "RATE_LIMITED"',
  '"retry-after": "60"',
  '"60.0"',
  '"6e1"',
  "assert.equal(error.retryAfterSeconds, 60)",
  "assert.equal(error.retryAfterSeconds, undefined)",
], "sdk/test/sdk.test.mjs");

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
], "docs/api/errors.md");

assertContains(gatewayChapterSource, [
  "默认窗口为 60 秒",
  "quote 120 requests / 60 seconds",
  "submit 60 requests / 60 seconds",
  "status 300 requests / 60 seconds",
  "错误配置会在启动期 fail fast",
  "默认 `RFQ_TRUST_PROXY=false`",
  "启用 `RFQ_TRUST_PROXY=true`",
  "client identity trim + lowercase",
  "128 character clientId upper bound",
  "clientId character set `[A-Za-z0-9_.:-]`",
  "trusted forwarded identity exceeding 128 characters or outside `[A-Za-z0-9_.:-]` returns `INVALID_REQUEST`/400",
  "`RATE_LIMITED`、HTTP 429 和 `Retry-After`",
], "book/Volume5-BackendEngineering/Chapter01-API-Gateway.md");

assertContains(readmeSource, [
  "`RFQClientError` preserves structured API errors.",
  "HTTP 429 `RATE_LIMITED`",
  "`retryAfterSeconds`",
  "`Retry-After` header",
  "`RFQ_TRUST_PROXY=false`",
  "128 character limit and `[A-Za-z0-9_.:-]` character set",
], "README.md");

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
