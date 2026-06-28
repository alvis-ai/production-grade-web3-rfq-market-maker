#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const quoteRequest = JSON.parse(await readFile("examples/quote-request.json", "utf8"));
const submitRequest = JSON.parse(await readFile("examples/submit-request.json", "utf8"));
const openapiSource = await readFile("docs/api/openapi.yaml", "utf8");

assert.deepEqual(
  Object.keys(quoteRequest),
  extractOpenApiRequired(openapiSource, "QuoteRequest"),
  "examples/quote-request.json must contain exactly the required QuoteRequest fields",
);
assert.deepEqual(
  Object.keys(submitRequest),
  extractOpenApiRequired(openapiSource, "SubmitQuoteRequest"),
  "examples/submit-request.json must contain exactly the required SubmitQuoteRequest fields",
);
assert.deepEqual(
  Object.keys(submitRequest.quote),
  extractOpenApiRequired(openapiSource, "SignedQuote"),
  "examples/submit-request.json quote must contain exactly the required SignedQuote fields",
);

assertPositiveInteger(quoteRequest.chainId, "quoteRequest.chainId");
assertAddress(quoteRequest.user, "quoteRequest.user");
assertAddress(quoteRequest.tokenIn, "quoteRequest.tokenIn");
assertAddress(quoteRequest.tokenOut, "quoteRequest.tokenOut");
assert.notEqual(
  quoteRequest.tokenIn.toLowerCase(),
  quoteRequest.tokenOut.toLowerCase(),
  "quote request tokenIn and tokenOut must differ",
);
assertPositiveUint(quoteRequest.amountIn, "quoteRequest.amountIn");
assert.ok(
  Number.isInteger(quoteRequest.slippageBps) && quoteRequest.slippageBps >= 0 && quoteRequest.slippageBps <= 10000,
  "quoteRequest.slippageBps must be an integer from 0 to 10000",
);

assertAddress(submitRequest.quote.user, "submitRequest.quote.user");
assertAddress(submitRequest.quote.tokenIn, "submitRequest.quote.tokenIn");
assertAddress(submitRequest.quote.tokenOut, "submitRequest.quote.tokenOut");
assertPositiveUint(submitRequest.quote.amountIn, "submitRequest.quote.amountIn");
assertPositiveUint(submitRequest.quote.amountOut, "submitRequest.quote.amountOut");
assertPositiveUint(submitRequest.quote.minAmountOut, "submitRequest.quote.minAmountOut");
assertUint(submitRequest.quote.nonce, "submitRequest.quote.nonce");
assertPositiveInteger(submitRequest.quote.deadline, "submitRequest.quote.deadline");
assertPositiveInteger(submitRequest.quote.chainId, "submitRequest.quote.chainId");
assertSignature(submitRequest.signature, "submitRequest.signature");

assert.ok(
  BigInt(submitRequest.quote.amountOut) >= BigInt(submitRequest.quote.minAmountOut),
  "submitRequest.quote.amountOut must be greater than or equal to minAmountOut",
);
assert.ok(
  submitRequest.quote.deadline > Math.floor(Date.now() / 1000),
  "submitRequest.quote.deadline must be in the future",
);

for (const field of ["chainId", "user", "tokenIn", "tokenOut", "amountIn"]) {
  assert.equal(
    normalizeComparable(submitRequest.quote[field]),
    normalizeComparable(quoteRequest[field]),
    `submitRequest.quote.${field} must match quoteRequest.${field}`,
  );
}

assertOpenApiQuoteExampleMatchesFile(openapiSource, quoteRequest);

console.log("Examples consistency check passed");

function extractOpenApiRequired(source, schemaName) {
  const lines = extractOpenApiSchemaLines(source, schemaName);
  const start = lines.findIndex((line) => line === "      required:");
  assert.ok(start >= 0, `${schemaName} must define required fields`);

  const required = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith("        - ")) {
      break;
    }
    required.push(line.slice("        - ".length));
  }

  return required;
}

function extractOpenApiSchemaLines(source, schemaName) {
  const lines = source.split("\n");
  const start = lines.findIndex((line) => line === `    ${schemaName}:`);
  assert.ok(start >= 0, `Unable to find OpenAPI schema ${schemaName}`);

  const schemaLines = [];
  for (const line of lines.slice(start + 1)) {
    if (/^    [A-Za-z0-9]+:/.test(line)) {
      break;
    }
    schemaLines.push(line);
  }

  return schemaLines;
}

function assertOpenApiQuoteExampleMatchesFile(source, quoteRequest) {
  const match = source.match(/\/quote:[\s\S]*?examples:[\s\S]*?value:\n([\s\S]*?)\n\s+responses:/);
  assert.ok(match, "Unable to find OpenAPI /quote request example");

  const example = {};
  for (const line of match[1].split("\n")) {
    const item = line.match(/^\s{18}([a-zA-Z][a-zA-Z0-9]*):\s*(.+)$/);
    if (!item) continue;

    example[item[1]] = parseOpenApiScalar(item[2]);
  }

  assert.deepEqual(example, quoteRequest, "OpenAPI /quote example must match examples/quote-request.json");
}

function parseOpenApiScalar(value) {
  const trimmed = value.trim();
  if (/^".*"$/.test(trimmed)) {
    return trimmed.slice(1, -1);
  }
  const numberValue = Number(trimmed);
  if (Number.isFinite(numberValue)) {
    return numberValue;
  }
  return trimmed;
}

function assertAddress(value, label) {
  assert.ok(typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value), `${label} must be an EVM address`);
}

function assertUint(value, label) {
  assert.ok(typeof value === "string" && /^[0-9]+$/.test(value), `${label} must be a uint string`);
}

function assertPositiveUint(value, label) {
  assertUint(value, label);
  assert.ok(BigInt(value) > 0n, `${label} must be positive`);
}

function assertPositiveInteger(value, label) {
  assert.ok(Number.isInteger(value) && value > 0, `${label} must be a positive integer`);
}

function assertSignature(value, label) {
  assert.ok(
    typeof value === "string" && /^0x[a-fA-F0-9]{130}$/.test(value),
    `${label} must be a 65-byte 0x-prefixed hex signature`,
  );
}

function normalizeComparable(value) {
  return typeof value === "string" && value.startsWith("0x") ? value.toLowerCase() : value;
}
