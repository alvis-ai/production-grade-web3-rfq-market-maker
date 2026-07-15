#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const paths = {
  client: "sdk/src/client.ts",
  error: "sdk/src/client-error.ts",
  request: "sdk/src/client-request.ts",
  response: "sdk/src/client-response-validation.ts",
  trading: "sdk/src/client-trading-responses.ts",
  accounting: "sdk/src/client-accounting-responses.ts",
};
const sources = Object.fromEntries(await Promise.all(
  Object.entries(paths).map(async ([name, path]) => [name, await readFile(path, "utf8")]),
));
const chapter = await readFile("book/Volume6-Frontend-And-SDK/Chapter04-SDK.md", "utf8");

const limits = { client: 250, error: 50, request: 350, response: 400, trading: 350, accounting: 400 };
for (const [name, limit] of Object.entries(limits)) {
  const lines = sources[name].split(/\r?\n/).length;
  assert.ok(lines <= limit, `${paths[name]} must remain bounded to ${limit} lines (got ${lines})`);
}

assertContains(sources.client, [
  "export class RFQClient",
  "normalizeClientConfig(baseUrl, options)",
  "assertResponsePayload(payload, response",
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
assertContains(chapter, [
  "`client.ts` remains the HTTP orchestration boundary",
  "`client-request.ts`",
  "`client-trading-responses.ts`",
  "`client-accounting-responses.ts`",
  "`client-response-validation.ts`",
  "`make sdk-composition-check`",
], "SDK chapter");

console.log("SDK composition consistency checks passed");

function assertContains(source, needles, label) {
  for (const needle of needles) {
    assert.ok(source.includes(needle), `${label} must contain ${needle}`);
  }
}
