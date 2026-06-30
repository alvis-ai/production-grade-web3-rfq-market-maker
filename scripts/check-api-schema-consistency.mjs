#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const backendTypesSource = await readFile("backend/src/shared/types/rfq.ts", "utf8");
const sdkTypesSource = await readFile("sdk/src/types.ts", "utf8");
const openapiSource = await readFile("docs/api/openapi.yaml", "utf8");

const schemaMappings = [
  ["QuoteRequest", "QuoteRequest", "QuoteRequest"],
  ["SignedQuote", "Quote", "SignedQuote"],
  ["QuoteResponse", "QuoteResponse", "QuoteResponse"],
  ["SubmitQuoteRequest", "SubmitQuoteRequest", "SubmitQuoteRequest"],
  ["SubmitQuoteResponse", "SubmitQuoteResponse", "SubmitQuoteResponse"],
  ["QuoteStatusResponse", "QuoteStatus", "QuoteStatus"],
  ["HedgeIntentStatusResponse", "HedgeIntentStatus", "HedgeIntentStatus"],
  ["SettlementEventStatusResponse", "SettlementEventStatus", "SettlementEventStatus"],
  ["PnlTradeRecord", "PnlTradeRecord", "PnlTradeRecord"],
  ["PnlSummaryResponse", "PnlSummary", "PnlSummary"],
];
const closedRequestSchemas = ["QuoteRequest", "SubmitQuoteRequest", "SignedQuote"];

for (const [backendName, sdkName, openapiName] of schemaMappings) {
  const backendFields = extractInterfaceFields(backendTypesSource, backendName);
  const sdkFields = extractInterfaceFields(sdkTypesSource, sdkName);
  const openapiSchema = extractOpenApiSchema(openapiSource, openapiName);

  assert.deepEqual(
    sdkFields,
    backendFields,
    `${sdkName} SDK fields must match backend ${backendName}`,
  );
  assert.deepEqual(
    openapiSchema.properties,
    backendFields.map((field) => field.name),
    `${openapiName} OpenAPI properties must match backend ${backendName}`,
  );
  assert.deepEqual(
    openapiSchema.required,
    backendFields.filter((field) => !field.optional).map((field) => field.name),
    `${openapiName} OpenAPI required fields must match backend ${backendName}`,
  );
}

for (const schemaName of closedRequestSchemas) {
  assertOpenApiSchemaClosed(schemaName);
}

const healthResponse = extractOpenApiSchema(openapiSource, "HealthResponse");
assert.deepEqual(healthResponse.properties, ["status"], "HealthResponse properties must be stable");
assert.deepEqual(healthResponse.required, ["status"], "HealthResponse.status must be required");

const readinessResponse = extractOpenApiSchema(openapiSource, "ReadinessResponse");
const sdkReadiness = extractInterfaceFields(sdkTypesSource, "ReadinessResponse");
assert.deepEqual(
  readinessResponse.properties,
  sdkReadiness.map((field) => field.name),
  "ReadinessResponse OpenAPI properties must match SDK",
);
assert.deepEqual(
  readinessResponse.required,
  sdkReadiness.filter((field) => !field.optional).map((field) => field.name),
  "ReadinessResponse OpenAPI required fields must match SDK",
);

assert.deepEqual(
  extractStringUnionValues(backendTypesSource, "QuoteLifecycleStatus"),
  extractStringUnionValues(sdkTypesSource, "QuoteLifecycleStatus"),
  "SDK QuoteLifecycleStatus must match backend",
);
assert.deepEqual(
  extractOpenApiEnum(openapiSource, "QuoteStatus", "status"),
  extractStringUnionValues(backendTypesSource, "QuoteLifecycleStatus"),
  "OpenAPI QuoteStatus.status enum must match backend QuoteLifecycleStatus",
);

assert.equal(
  extractOpenApiPropertyPattern(openapiSource, "QuoteResponse", "signature"),
  "^0x[a-fA-F0-9]{130}$",
  "QuoteResponse.signature must be a 65-byte canonical low-s EIP-712 signature",
);
assert.equal(
  extractOpenApiSchemaPattern(openapiSource, "PositiveUIntString"),
  "^[1-9][0-9]*$",
  "PositiveUIntString must reject zero and negative values",
);

for (const [schemaName, propertyName] of [
  ["QuoteRequest", "amountIn"],
  ["QuoteResponse", "amountOut"],
  ["QuoteResponse", "minAmountOut"],
  ["QuoteResponse", "nonce"],
  ["SignedQuote", "amountIn"],
  ["SignedQuote", "amountOut"],
  ["SignedQuote", "minAmountOut"],
  ["SignedQuote", "nonce"],
  ["HedgeIntentStatus", "amount"],
  ["SettlementEventStatus", "amountIn"],
  ["SettlementEventStatus", "amountOut"],
  ["PnlTradeRecord", "amountIn"],
  ["PnlTradeRecord", "amountOut"],
  ["PnlTradeRecord", "minAmountOut"],
  ["PnlTradeRecord", "nonce"],
]) {
  assert.equal(
    extractOpenApiPropertyRef(openapiSource, schemaName, propertyName),
    "#/components/schemas/PositiveUIntString",
    `${schemaName}.${propertyName} must use PositiveUIntString`,
  );
}

for (const [schemaName, propertyName] of [
  ["QuoteRequest", "chainId"],
  ["SignedQuote", "chainId"],
  ["SignedQuote", "deadline"],
  ["PnlTradeRecord", "deadline"],
]) {
  assert.equal(
    extractOpenApiPropertyNumericBound(openapiSource, schemaName, propertyName, "maximum"),
    "9007199254740991",
    `${schemaName}.${propertyName} must document the JavaScript safe integer maximum`,
  );
}

for (const schemaName of ["SubmitQuoteResponse", "QuoteStatus", "SettlementEventStatus"]) {
  assert.equal(
    extractOpenApiPropertyPattern(openapiSource, schemaName, "txHash"),
    "^0x[a-fA-F0-9]{64}$",
    `${schemaName}.txHash must be a 32-byte transaction hash`,
  );
}

console.log(`API schema consistency check passed (${schemaMappings.length + 2} schemas)`);

function extractInterfaceFields(source, interfaceName) {
  const match = source.match(new RegExp(`export\\s+interface\\s+${interfaceName}\\s+\\{([\\s\\S]*?)\\n\\}`));
  assert.ok(match, `Unable to find TypeScript interface ${interfaceName}`);

  return [...match[1].matchAll(/^\s+([a-zA-Z][a-zA-Z0-9]*)(\?)?:/gm)].map((item) => ({
    name: item[1],
    optional: item[2] === "?",
  }));
}

function extractStringUnionValues(source, typeName) {
  const match = source.match(new RegExp(`export\\s+type\\s+${typeName}\\s*=([\\s\\S]*?);`));
  assert.ok(match, `Unable to find TypeScript string union ${typeName}`);

  return [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
}

function extractOpenApiSchema(source, schemaName) {
  const lines = extractOpenApiSchemaLines(source, schemaName);
  const required = extractOpenApiRequired(lines, schemaName);
  const properties = extractOpenApiProperties(lines, schemaName);

  return { required, properties };
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

function extractOpenApiRequired(lines, schemaName) {
  const start = lines.findIndex((line) => line === "      required:");
  if (start < 0) {
    return [];
  }

  const required = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith("        - ")) {
      break;
    }
    required.push(line.slice("        - ".length));
  }

  assert.ok(required.length > 0, `${schemaName}.required must not be empty when present`);
  return required;
}

function extractOpenApiProperties(lines, schemaName) {
  const start = lines.findIndex((line) => line === "      properties:");
  assert.ok(start >= 0, `Unable to find OpenAPI properties for ${schemaName}`);

  const properties = [];
  for (const line of lines.slice(start + 1)) {
    if (/^      [A-Za-z0-9]+:/.test(line)) {
      break;
    }

    const match = line.match(/^        ([a-zA-Z][a-zA-Z0-9]*):$/);
    if (match) {
      properties.push(match[1]);
    }
  }

  assert.ok(properties.length > 0, `${schemaName}.properties must not be empty`);
  return properties;
}

function extractOpenApiEnum(source, schemaName, propertyName) {
  const lines = extractOpenApiSchemaLines(source, schemaName);
  const propertyIndex = lines.findIndex((line) => line === `        ${propertyName}:`);
  assert.ok(propertyIndex >= 0, `Unable to find ${schemaName}.${propertyName}`);

  const enumIndex = lines.findIndex((line, index) => index > propertyIndex && line === "          enum:");
  assert.ok(enumIndex >= 0, `Unable to find enum for ${schemaName}.${propertyName}`);

  const values = [];
  for (const line of lines.slice(enumIndex + 1)) {
    if (!line.startsWith("            - ")) {
      break;
    }
    values.push(line.slice("            - ".length));
  }

  return values;
}

function extractOpenApiPropertyPattern(source, schemaName, propertyName) {
  const lines = extractOpenApiSchemaLines(source, schemaName);
  const propertyIndex = lines.findIndex((line) => line === `        ${propertyName}:`);
  assert.ok(propertyIndex >= 0, `Unable to find ${schemaName}.${propertyName}`);

  const propertyLines = [];
  for (const line of lines.slice(propertyIndex + 1)) {
    if (/^        [a-zA-Z][a-zA-Z0-9]*:$/.test(line)) {
      break;
    }
    propertyLines.push(line);
  }

  const patternLine = propertyLines.find((line) => line.trim().startsWith("pattern: "));
  assert.ok(patternLine, `Unable to find pattern for ${schemaName}.${propertyName}`);

  return patternLine.trim().slice("pattern: ".length).replace(/^"|"$/g, "");
}

function extractOpenApiSchemaPattern(source, schemaName) {
  const lines = extractOpenApiSchemaLines(source, schemaName);
  const patternLine = lines.find((line) => line.trim().startsWith("pattern: "));
  assert.ok(patternLine, `Unable to find pattern for ${schemaName}`);

  return patternLine.trim().slice("pattern: ".length).replace(/^"|"$/g, "");
}

function extractOpenApiPropertyRef(source, schemaName, propertyName) {
  const lines = extractOpenApiSchemaLines(source, schemaName);
  const propertyIndex = lines.findIndex((line) => line === `        ${propertyName}:`);
  assert.ok(propertyIndex >= 0, `Unable to find ${schemaName}.${propertyName}`);

  const propertyLines = [];
  for (const line of lines.slice(propertyIndex + 1)) {
    if (/^        [a-zA-Z][a-zA-Z0-9]*:$/.test(line)) {
      break;
    }
    propertyLines.push(line);
  }

  const refLine = propertyLines.find((line) => line.trim().startsWith("$ref: "));
  assert.ok(refLine, `Unable to find $ref for ${schemaName}.${propertyName}`);

  return refLine.trim().slice("$ref: ".length).replace(/^"|"$/g, "");
}

function extractOpenApiPropertyNumericBound(source, schemaName, propertyName, boundName) {
  const lines = extractOpenApiSchemaLines(source, schemaName);
  const propertyIndex = lines.findIndex((line) => line === `        ${propertyName}:`);
  assert.ok(propertyIndex >= 0, `Unable to find ${schemaName}.${propertyName}`);

  const propertyLines = [];
  for (const line of lines.slice(propertyIndex + 1)) {
    if (/^        [a-zA-Z][a-zA-Z0-9]*:$/.test(line)) {
      break;
    }
    propertyLines.push(line);
  }

  const boundLine = propertyLines.find((line) => line.trim().startsWith(`${boundName}: `));
  assert.ok(boundLine, `Unable to find ${boundName} for ${schemaName}.${propertyName}`);

  return boundLine.trim().slice(`${boundName}: `.length);
}

function assertOpenApiSchemaClosed(schemaName) {
  const lines = extractOpenApiSchemaLines(openapiSource, schemaName);
  assert.ok(
    lines.includes("      additionalProperties: false"),
    `${schemaName} OpenAPI schema must reject unknown request fields with additionalProperties: false`,
  );
}
