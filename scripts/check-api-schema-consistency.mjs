#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const backendTypesSource = await readFile("backend/src/shared/types/rfq.ts", "utf8");
const backendReadinessSource = await readFile("backend/src/modules/health/readiness.service.ts", "utf8");
const sdkClientSource = await readFile("sdk/src/client.ts", "utf8");
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
const closedOpenApiSchemas = [
  "QuoteRequest",
  "QuoteResponse",
  "SubmitQuoteRequest",
  "SubmitQuoteResponse",
  "SignedQuote",
  "QuoteStatus",
  "HedgeIntentStatus",
  "SettlementEventStatus",
  "PnlTradeRecord",
  "PnlSummary",
  "HealthResponse",
  "ReadinessResponse",
];
const inlineEnumMappings = [
  ["SubmitQuoteResponse", "SubmitQuoteResponse", "SubmitQuoteResponse", "status"],
  ["HedgeIntentStatusResponse", "HedgeIntentStatus", "HedgeIntentStatus", "status"],
  ["HedgeIntentStatusResponse", "HedgeIntentStatus", "HedgeIntentStatus", "side"],
  ["HedgeIntentStatusResponse", "HedgeIntentStatus", "HedgeIntentStatus", "reason"],
  ["SettlementEventStatusResponse", "SettlementEventStatus", "SettlementEventStatus", "status"],
  ["PnlTradeRecord", "PnlTradeRecord", "PnlTradeRecord", "model"],
  ["PnlSummaryResponse", "PnlSummary", "PnlSummary", "status"],
];
const sdkRuntimeEnumMappings = [
  ["SubmitQuoteResponse", "status", "assertSubmitQuoteResponse"],
  ["QuoteStatus", "status", "assertQuoteStatus"],
  ["HedgeIntentStatus", "status", "assertHedgeIntentStatus"],
  ["HedgeIntentStatus", "side", "assertHedgeIntentStatus"],
  ["HedgeIntentStatus", "reason", "assertHedgeIntentStatus"],
  ["SettlementEventStatus", "status", "assertSettlementEventStatus"],
  ["PnlTradeRecord", "model", "assertPnlTradeRecord"],
  ["PnlSummary", "status", "assertPnlSummary"],
  ["HealthResponse", "status", "isHealthResponse"],
  ["ReadinessResponse", "status", "isReadinessResponse"],
];

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

for (const schemaName of closedOpenApiSchemas) {
  assertOpenApiSchemaClosed(schemaName);
}

for (const [backendName, sdkName, openapiName, propertyName] of inlineEnumMappings) {
  const backendValues = extractInterfacePropertyEnumValues(backendTypesSource, backendName, propertyName);
  assert.deepEqual(
    extractInterfacePropertyEnumValues(sdkTypesSource, sdkName, propertyName),
    backendValues,
    `SDK ${sdkName}.${propertyName} enum must match backend ${backendName}.${propertyName}`,
  );
  assert.deepEqual(
    extractOpenApiEnum(openapiSource, openapiName, propertyName),
    backendValues,
    `OpenAPI ${openapiName}.${propertyName} enum must match backend ${backendName}.${propertyName}`,
  );
}

for (const [sdkName, propertyName, functionName] of sdkRuntimeEnumMappings) {
  const runtimeValues = extractSdkRuntimeEnumGuardValues(sdkClientSource, functionName, propertyName);
  assert.deepEqual(
    runtimeValues,
    extractInterfacePropertyEnumValues(sdkTypesSource, sdkName, propertyName),
    `SDK runtime ${functionName} ${sdkName}.${propertyName} enum guard must match SDK type`,
  );
  assert.deepEqual(
    runtimeValues,
    extractOpenApiEnum(openapiSource, sdkName, propertyName),
    `SDK runtime ${functionName} ${sdkName}.${propertyName} enum guard must match OpenAPI`,
  );
}

const healthResponse = extractOpenApiSchema(openapiSource, "HealthResponse");
assert.deepEqual(healthResponse.properties, ["status"], "HealthResponse properties must be stable");
assert.deepEqual(healthResponse.required, ["status"], "HealthResponse.status must be required");
assert.deepEqual(
  extractOpenApiEnum(openapiSource, "HealthResponse", "status"),
  extractInterfacePropertyStringUnionValues(sdkTypesSource, "HealthResponse", "status"),
  "OpenAPI HealthResponse.status enum must match SDK",
);

const readinessResponse = extractOpenApiSchema(openapiSource, "ReadinessResponse");
const sdkReadiness = extractInterfaceFields(sdkTypesSource, "ReadinessResponse");
const backendReadinessComponents = extractStringUnionValues(backendReadinessSource, "ReadinessComponentName");
const sdkReadinessComponents = extractStringUnionValues(sdkTypesSource, "ReadinessComponentName");
const sdkClientReadinessComponents = extractConstStringArray(sdkClientSource, "readinessDependencyComponents");
const readinessComponents = extractOpenApiNestedObjectSchema(openapiSource, "ReadinessResponse", "components");
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
  sdkReadinessComponents,
  backendReadinessComponents,
  "SDK ReadinessComponentName must match backend readiness components",
);
assert.deepEqual(
  sdkClientReadinessComponents,
  backendReadinessComponents,
  "SDK client readiness runtime components must match backend readiness components",
);
assert.deepEqual(
  readinessComponents.properties,
  backendReadinessComponents,
  "ReadinessResponse.components OpenAPI properties must match backend readiness components",
);
assert.deepEqual(
  readinessComponents.required,
  backendReadinessComponents,
  "ReadinessResponse.components OpenAPI required fields must match backend readiness components",
);
assert.equal(
  readinessComponents.additionalProperties,
  "false",
  "ReadinessResponse.components OpenAPI schema must reject unknown readiness components",
);
for (const component of backendReadinessComponents) {
  assert.equal(
    readinessComponents.refs.get(component),
    "#/components/schemas/ReadinessComponentStatus",
    `ReadinessResponse.components.${component} must use ReadinessComponentStatus`,
  );
}
assert.deepEqual(
  extractStringUnionValues(sdkTypesSource, "ReadinessComponentStatus"),
  extractStringUnionValues(backendReadinessSource, "ReadinessComponentStatus"),
  "SDK ReadinessComponentStatus must match backend",
);
assert.deepEqual(
  extractOpenApiSchemaEnum(openapiSource, "ReadinessComponentStatus"),
  extractStringUnionValues(backendReadinessSource, "ReadinessComponentStatus"),
  "OpenAPI ReadinessComponentStatus enum must match backend",
);
assert.deepEqual(
  extractInterfacePropertyEnumValues(backendReadinessSource, "ReadinessResponse", "status"),
  extractInterfacePropertyEnumValues(sdkTypesSource, "ReadinessResponse", "status"),
  "SDK ReadinessResponse.status enum must match backend",
);
assert.deepEqual(
  extractOpenApiEnum(openapiSource, "ReadinessResponse", "status"),
  extractInterfacePropertyEnumValues(backendReadinessSource, "ReadinessResponse", "status"),
  "OpenAPI ReadinessResponse.status enum must match backend",
);
assert.deepEqual(
  extractSdkRuntimeLocalStatusGuardValues(sdkClientSource, "isReadinessComponents"),
  extractStringUnionValues(sdkTypesSource, "ReadinessComponentStatus"),
  "SDK runtime isReadinessComponents component status guard must match SDK ReadinessComponentStatus",
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
  "PositiveUIntString must reject zero, negative values, and leading zeros",
);
assert.equal(
  extractOpenApiSchemaPattern(openapiSource, "IntString"),
  "^(0|-?[1-9][0-9]*)$",
  "IntString must be canonical and reject leading zeros and negative zero",
);
assert.equal(
  extractOpenApiSchemaPattern(openapiSource, "SafeIdentifier"),
  "^[A-Za-z0-9_:-]+$",
  "SafeIdentifier must use the shared public resource identifier pattern",
);
assert.equal(
  extractOpenApiSchemaNumericBound(openapiSource, "SafeIdentifier", "minLength"),
  "1",
  "SafeIdentifier must reject empty resource identifiers",
);
assert.equal(
  extractOpenApiSchemaNumericBound(openapiSource, "SafeIdentifier", "maxLength"),
  "128",
  "SafeIdentifier must cap resource identifiers at 128 characters",
);

for (const [schemaName, propertyName] of [
  ["QuoteResponse", "quoteId"],
  ["QuoteResponse", "snapshotId"],
  ["SubmitQuoteResponse", "settlementEventId"],
  ["SubmitQuoteResponse", "hedgeOrderId"],
  ["SubmitQuoteResponse", "pnlId"],
  ["QuoteStatus", "quoteId"],
  ["QuoteStatus", "snapshotId"],
  ["QuoteStatus", "settlementEventId"],
  ["QuoteStatus", "hedgeOrderId"],
  ["QuoteStatus", "pnlId"],
  ["HedgeIntentStatus", "hedgeOrderId"],
  ["HedgeIntentStatus", "settlementEventId"],
  ["HedgeIntentStatus", "quoteId"],
  ["SettlementEventStatus", "settlementEventId"],
  ["SettlementEventStatus", "quoteId"],
  ["PnlTradeRecord", "pnlId"],
  ["PnlTradeRecord", "quoteId"],
]) {
  assert.equal(
    extractOpenApiPropertyRef(openapiSource, schemaName, propertyName),
    "#/components/schemas/SafeIdentifier",
    `${schemaName}.${propertyName} must use SafeIdentifier`,
  );
}
assert.ok(
  sdkClientSource.includes("function isSafeIdentifier") &&
    sdkClientSource.includes("statusIdentifierPattern.test(value)") &&
    sdkClientSource.includes("value.length <= maxStatusIdentifierLength"),
  "SDK successful response validators must reuse the shared safe identifier rule",
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
  ["SettlementEventStatus", "nonce"],
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
  ["QuoteStatus", "deadline"],
  ["HedgeIntentStatus", "chainId"],
  ["SettlementEventStatus", "chainId"],
  ["SettlementEventStatus", "blockNumber"],
  ["SettlementEventStatus", "logIndex"],
  ["PnlTradeRecord", "chainId"],
  ["PnlTradeRecord", "deadline"],
  ["PnlTradeRecord", "grossPnlBps"],
]) {
  assert.equal(
    extractOpenApiPropertyNumericBound(openapiSource, schemaName, propertyName, "maximum"),
    "9007199254740991",
    `${schemaName}.${propertyName} must document the JavaScript safe integer maximum`,
  );
}

for (const [schemaName, propertyName] of [
  ["PnlTradeRecord", "grossPnlTokenOut"],
  ["PnlSummary", "grossPnlTokenOut"],
]) {
  assert.equal(
    extractOpenApiPropertyRef(openapiSource, schemaName, propertyName),
    "#/components/schemas/IntString",
    `${schemaName}.${propertyName} must use IntString`,
  );
}
for (const [schemaName, propertyName] of [
  ["QuoteRequest", "chainId"],
  ["SignedQuote", "chainId"],
  ["SignedQuote", "deadline"],
  ["QuoteStatus", "deadline"],
  ["HedgeIntentStatus", "chainId"],
  ["SettlementEventStatus", "chainId"],
  ["PnlTradeRecord", "chainId"],
  ["PnlTradeRecord", "deadline"],
]) {
  assert.equal(
    extractOpenApiPropertyNumericBound(openapiSource, schemaName, propertyName, "minimum"),
    "1",
    `${schemaName}.${propertyName} must document the positive safe integer minimum`,
  );
}
for (const [schemaName, propertyName] of [
  ["SettlementEventStatus", "blockNumber"],
  ["SettlementEventStatus", "logIndex"],
]) {
  assert.equal(
    extractOpenApiPropertyNumericBound(openapiSource, schemaName, propertyName, "minimum"),
    "0",
    `${schemaName}.${propertyName} must document the non-negative safe integer minimum`,
  );
}
assert.equal(
  extractOpenApiPropertyNumericBound(openapiSource, "PnlTradeRecord", "grossPnlBps", "minimum"),
  "-9007199254740991",
  "PnlTradeRecord.grossPnlBps must document the JavaScript safe integer minimum",
);

for (const schemaName of ["SubmitQuoteResponse", "QuoteStatus", "SettlementEventStatus"]) {
  assert.equal(
    extractOpenApiPropertyPattern(openapiSource, schemaName, "txHash"),
    "^0x[a-fA-F0-9]{64}$",
    `${schemaName}.txHash must be a 32-byte transaction hash`,
  );
}

console.log(`API schema consistency check passed (${schemaMappings.length + 4} schemas)`);

function extractInterfaceFields(source, interfaceName) {
  const match = source.match(new RegExp(`export\\s+interface\\s+${interfaceName}\\s+\\{([\\s\\S]*?)\\n\\}`));
  assert.ok(match, `Unable to find TypeScript interface ${interfaceName}`);

  return [...match[1].matchAll(/^\s+([a-zA-Z][a-zA-Z0-9]*)(\?)?:/gm)].map((item) => ({
    name: item[1],
    optional: item[2] === "?",
  }));
}

function extractInterfacePropertyStringUnionValues(source, interfaceName, propertyName) {
  const match = source.match(new RegExp(`export\\s+interface\\s+${interfaceName}\\s+\\{([\\s\\S]*?)\\n\\}`));
  assert.ok(match, `Unable to find TypeScript interface ${interfaceName}`);

  const propertyMatch = match[1].match(new RegExp(`^\\s+${propertyName}\\??:\\s*([^;]+);`, "m"));
  assert.ok(propertyMatch, `Unable to find ${interfaceName}.${propertyName}`);

  const values = [...propertyMatch[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
  assert.ok(values.length > 0, `${interfaceName}.${propertyName} must be a string literal union`);
  return values;
}

function extractInterfacePropertyEnumValues(source, interfaceName, propertyName) {
  const match = source.match(new RegExp(`export\\s+interface\\s+${interfaceName}\\s+\\{([\\s\\S]*?)\\n\\}`));
  assert.ok(match, `Unable to find TypeScript interface ${interfaceName}`);

  const propertyMatch = match[1].match(new RegExp(`^\\s+${propertyName}\\??:\\s*([^;]+);`, "m"));
  assert.ok(propertyMatch, `Unable to find ${interfaceName}.${propertyName}`);

  const literalValues = [...propertyMatch[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
  if (literalValues.length > 0) {
    return literalValues;
  }

  const aliasMatch = propertyMatch[1].trim().match(/^([A-Z][A-Za-z0-9]*)$/);
  assert.ok(aliasMatch, `${interfaceName}.${propertyName} must be a string literal union or type alias`);
  return extractStringUnionValues(source, aliasMatch[1]);
}

function extractStringUnionValues(source, typeName) {
  const match = source.match(new RegExp(`export\\s+type\\s+${typeName}\\s*=([\\s\\S]*?);`));
  assert.ok(match, `Unable to find TypeScript string union ${typeName}`);

  return [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
}

function extractConstStringArray(source, constName) {
  const match = source.match(new RegExp(`const\\s+${constName}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s+as\\s+const;`));
  assert.ok(match, `Unable to find const string array ${constName}`);

  const values = [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
  assert.ok(values.length > 0, `${constName} must not be empty`);
  return values;
}

function extractSdkRuntimeEnumGuardValues(source, functionName, propertyName) {
  const body = extractFunctionBody(source, functionName);
  const enumCallMatch = body.match(
    new RegExp(`assertRequiredEnumField\\(\\s*[a-zA-Z][a-zA-Z0-9]*\\s*,\\s*"${propertyName}"\\s*,\\s*\\[([\\s\\S]*?)\\]`),
  );
  if (enumCallMatch) {
    return extractStringLiterals(enumCallMatch[1], `${functionName}.${propertyName}`);
  }

  const comparisonPattern = new RegExp(`(?:payload|value)\\.${propertyName}\\s*(?:===|!==)\\s*"([^"]+)"`, "g");
  const values = uniquePreservingOrder([...body.matchAll(comparisonPattern)].map((item) => item[1]));
  assert.ok(values.length > 0, `Unable to find SDK runtime enum guard for ${functionName}.${propertyName}`);
  return values;
}

function extractSdkRuntimeLocalStatusGuardValues(source, functionName) {
  const body = extractFunctionBody(source, functionName);
  const values = uniquePreservingOrder([...body.matchAll(/\bstatus\s*(?:===|!==)\s*"([^"]+)"/g)].map((item) => item[1]));
  assert.ok(values.length > 0, `Unable to find SDK runtime local status guard for ${functionName}`);
  return values;
}

function extractFunctionBody(source, functionName) {
  const functionIndex = source.indexOf(`function ${functionName}`);
  assert.ok(functionIndex >= 0, `Unable to find function ${functionName}`);
  const bodyStart = source.indexOf("{", functionIndex);
  assert.ok(bodyStart >= 0, `Unable to find function body for ${functionName}`);

  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") {
      depth += 1;
    }
    if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(bodyStart + 1, index);
      }
    }
  }

  assert.fail(`Unable to close function body for ${functionName}`);
}

function extractStringLiterals(source, label) {
  const values = [...source.matchAll(/"([^"]+)"/g)].map((item) => item[1]);
  assert.ok(values.length > 0, `${label} must contain string literals`);
  return values;
}

function uniquePreservingOrder(values) {
  return [...new Set(values)];
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

function extractOpenApiSchemaNumericBound(source, schemaName, boundName) {
  const lines = extractOpenApiSchemaLines(source, schemaName);
  const boundLine = lines.find((line) => line.trim().startsWith(`${boundName}: `));
  assert.ok(boundLine, `Unable to find ${boundName} for ${schemaName}`);

  return boundLine.trim().slice(`${boundName}: `.length);
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

function extractOpenApiSchemaEnum(source, schemaName) {
  const lines = extractOpenApiSchemaLines(source, schemaName);
  const enumIndex = lines.findIndex((line) => line === "      enum:");
  assert.ok(enumIndex >= 0, `Unable to find enum for ${schemaName}`);

  const values = [];
  for (const line of lines.slice(enumIndex + 1)) {
    if (!line.startsWith("        - ")) {
      break;
    }
    values.push(line.slice("        - ".length));
  }

  assert.ok(values.length > 0, `${schemaName}.enum must not be empty`);
  return values;
}

function extractOpenApiNestedObjectSchema(source, schemaName, propertyName) {
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

  const additionalPropertiesLine = propertyLines.find((line) => line.trim().startsWith("additionalProperties: "));
  assert.ok(additionalPropertiesLine, `Unable to find additionalProperties for ${schemaName}.${propertyName}`);

  const requiredIndex = propertyLines.findIndex((line) => line === "          required:");
  assert.ok(requiredIndex >= 0, `Unable to find required list for ${schemaName}.${propertyName}`);
  const required = [];
  for (const line of propertyLines.slice(requiredIndex + 1)) {
    if (!line.startsWith("            - ")) {
      break;
    }
    required.push(line.slice("            - ".length));
  }

  const propertiesIndex = propertyLines.findIndex((line) => line === "          properties:");
  assert.ok(propertiesIndex >= 0, `Unable to find properties for ${schemaName}.${propertyName}`);
  const properties = [];
  const refs = new Map();
  for (let index = propertiesIndex + 1; index < propertyLines.length; index += 1) {
    const match = propertyLines[index].match(/^            ([a-zA-Z][a-zA-Z0-9]*):$/);
    if (!match) {
      continue;
    }

    const name = match[1];
    properties.push(name);
    const refLine = propertyLines.slice(index + 1).find((line) => {
      return line.trim().startsWith("$ref: ") || /^            [a-zA-Z][a-zA-Z0-9]*:$/.test(line);
    });
    assert.ok(refLine?.trim().startsWith("$ref: "), `Unable to find $ref for ${schemaName}.${propertyName}.${name}`);
    refs.set(name, refLine.trim().slice("$ref: ".length).replace(/^"|"$/g, ""));
  }

  assert.ok(required.length > 0, `${schemaName}.${propertyName}.required must not be empty`);
  assert.ok(properties.length > 0, `${schemaName}.${propertyName}.properties must not be empty`);

  return {
    additionalProperties: additionalPropertiesLine.trim().slice("additionalProperties: ".length),
    required,
    properties,
    refs,
  };
}

function assertOpenApiSchemaClosed(schemaName) {
  const lines = extractOpenApiSchemaLines(openapiSource, schemaName);
  assert.ok(
    lines.includes("      additionalProperties: false"),
    `${schemaName} OpenAPI schema must reject unknown fields with additionalProperties: false`,
  );
}
