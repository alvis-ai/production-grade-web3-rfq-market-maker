#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const rateLimiterSource = await readFile("backend/src/modules/rate-limit/rate-limit.service.ts", "utf8");
const mainSource = await readFile("backend/src/main.ts", "utf8");
const apiTestSource = await readFile("backend/test/api.test.mjs", "utf8");
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

assertContains(mainSource, [
  "new InMemoryRateLimiter",
  "windowMs: options.rateLimit?.windowMs ?? 60_000",
  "maxQuoteRequests: options.rateLimit?.maxQuoteRequests ?? 120",
  "maxSubmitRequests: options.rateLimit?.maxSubmitRequests ?? 60",
  "maxStatusRequests: options.rateLimit?.maxStatusRequests ?? 300",
  'enforceRateLimit(rateLimiter, "quote", request, reply)',
  'enforceRateLimit(rateLimiter, "submit", request, reply)',
  'enforceRateLimit(rateLimiter, "status", request, reply)',
  'new APIError("RATE_LIMITED", "Too many requests", 429)',
  'reply.header("x-ratelimit-remaining"',
  'reply.header("retry-after"',
  "clientIdForRateLimit",
  'request.headers["x-forwarded-for"]',
], "backend/src/main.ts");

assertContains(apiTestSource, [
  "rate limits quote requests by client",
  "rate limits submit requests before validation and settlement",
  "rate limits quote status requests by client",
  "assert.equal(secondQuote.statusCode, 429)",
  'assert.equal(secondQuote.body.code, "RATE_LIMITED")',
  "assert.equal(secondSubmit.statusCode, 429)",
  'assert.equal(secondSubmit.body.code, "RATE_LIMITED")',
  "assert.equal(secondStatus.statusCode, 429)",
  'assert.equal(secondStatus.body.code, "RATE_LIMITED")',
], "backend/test/api.test.mjs");

assertContains(sdkClientSource, [
  "readonly retryAfterSeconds?: number",
  "retryAfterSeconds(response)",
  'response.headers.get("retry-after")',
  "Number.isInteger(seconds) && seconds > 0",
], "sdk/src/client.ts");

assertContains(sdkTestSource, [
  "exposes Retry-After seconds for rate limited responses",
  'code: "RATE_LIMITED"',
  '"retry-after": "60"',
  "assert.equal(error.retryAfterSeconds, 60)",
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
], "docs/api/errors.md");

assertContains(gatewayChapterSource, [
  "默认窗口为 60 秒",
  "quote 120 requests / 60 seconds",
  "submit 60 requests / 60 seconds",
  "status 300 requests / 60 seconds",
  "`RATE_LIMITED`、HTTP 429 和 `Retry-After`",
], "book/Volume5-BackendEngineering/Chapter01-API-Gateway.md");

assertContains(readmeSource, [
  "`RFQClientError` preserves structured API errors.",
  "HTTP 429 `RATE_LIMITED`",
  "`retryAfterSeconds`",
  "`Retry-After` header",
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
