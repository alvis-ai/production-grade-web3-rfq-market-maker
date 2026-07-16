#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const paths = {
  client: "sdk/src/client.ts",
  error: "sdk/src/client-error.ts",
  request: "sdk/src/client-request.ts",
  transport: "sdk/src/client-transport.ts",
  response: "sdk/src/client-response-validation.ts",
  trading: "sdk/src/client-trading-responses.ts",
  accounting: "sdk/src/client-accounting-responses.ts",
  pnlPage: "sdk/src/client-pnl-page.ts",
};
const sources = Object.fromEntries(await Promise.all(
  Object.entries(paths).map(async ([name, path]) => [name, await readFile(path, "utf8")]),
));
const chapter = await readFile("book/Volume6-Frontend-And-SDK/Chapter04-SDK.md", "utf8");
const transportTests = await readFile("sdk/test/sdk-client-transport.test.mjs", "utf8");
const readme = await readFile("README.md", "utf8");

const limits = {
  client: 250,
  error: 50,
  request: 350,
  transport: 220,
  response: 400,
  trading: 350,
  accounting: 400,
  pnlPage: 100,
};
for (const [name, limit] of Object.entries(limits)) {
  const lines = sources[name].split(/\r?\n/).length;
  assert.ok(lines <= limit, `${paths[name]} must remain bounded to ${limit} lines (got ${lines})`);
}

assertContains(sources.client, [
  "export class RFQClient",
  "normalizeClientConfig(baseUrl, options)",
  "new RFQClientTransport(",
  "assertResponsePayload(payload, boundedResponse.response",
  "private requestHeaders",
], "SDK HTTP orchestrator");
for (const extractedDefinition of [
  "function assertQuoteRequest(",
  "function assertQuoteResponse(",
  "function assertPnlSummary(",
  "function isReadinessResponse(",
]) {
  assert.ok(!sources.client.includes(extractedDefinition), `sdk/src/client.ts must delegate ${extractedDefinition}`);
}

assertContains(sources.request, [
  "export function normalizeClientConfig",
  "export function assertQuoteRequest",
  "export function assertSubmitQuoteRequest",
  "export function assertNonEmptyIdentifier",
], "SDK request boundary");
assertContains(sources.transport, [
  "export class RFQClientTransport",
  "new AbortController()",
  "Promise.race([requestPromise, timeoutPromise])",
  "response.body.getReader()",
  "receivedBytes > this.maxResponseBytes",
  "reader.cancel(",
  'headers.get("content-length")',
], "SDK transport boundary");
assert.ok(!sources.client.includes("response.json()"), "SDK client must not decode unbounded JSON directly");
assert.ok(!sources.client.includes("response.text()"), "SDK client must not decode unbounded text directly");
assert.ok(!sources.response.includes("response.json()"), "SDK response validators must use the bounded reader");
assertContains(sources.response, [
  "export async function assertOk",
  "export function assertResponsePayload",
  "export function isHealthResponse",
  "export function isReadinessResponse",
], "SDK shared response boundary");
assertContains(sources.trading, [
  "export function assertQuoteResponse",
  "export function assertSubmitQuoteResponse",
  "export function assertQuoteStatus",
  "export function assertHedgeIntentStatus",
  "export function assertSettlementEventStatus",
], "SDK trading response boundary");
assertContains(sources.accounting, [
  "export function assertPnlSummary",
  "function assertHedgeNetPnlSummary",
  "function assertPnlTradeRecord",
], "SDK accounting response boundary");
assertContains(sources.pnlPage, [
  "export function assertPnlPageMetadata",
  "payload.hasMore !== (nextCursor !== undefined)",
  "previous.realizedAt < current.realizedAt",
], "SDK PnL page response boundary");
assertContains(chapter, [
  "`client.ts` remains the endpoint orchestration boundary",
  "`client-transport.ts`",
  "`client-request.ts`",
  "`client-trading-responses.ts`",
  "`client-accounting-responses.ts`",
  "`client-pnl-page.ts`",
  "`client-response-validation.ts`",
  "`make sdk-composition-check`",
  "`requestTimeoutMs` defaults to 15000",
  "`maxResponseBytes` defaults to 8 MiB",
], "SDK chapter");
assertContains(transportTests, [
  "RFQClient cancels oversized JSON and metrics response streams",
  "RFQClient keeps stalled response bodies inside one request deadline",
  "RFQClient preserves timeouts while reading non-success response bodies",
  "RFQClient aborts connection stalls and maps transport failures",
  "RFQClient rejects declared oversized bodies before reading them",
], "SDK transport tests");
assertContains(readme, [
  "Every SDK call keeps connection, response streaming and UTF-8/JSON decoding inside one deadline",
  "maxResponseBytes` defaults to 8 MiB",
], "SDK transport README");

console.log("SDK composition consistency checks passed");

function assertContains(source, needles, label) {
  for (const needle of needles) {
    assert.ok(source.includes(needle), `${label} must contain ${needle}`);
  }
}
