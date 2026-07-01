import { readFile, readdir } from "node:fs/promises";
import assert from "node:assert/strict";

const apiErrorSource = await readFile("backend/src/shared/errors/api-error.ts", "utf8");
const backendSource = await readSourceTree("backend/src");
const apiTestSource = await readFile("backend/test/api.test.mjs", "utf8");
const sdkTypesSource = await readFile("sdk/src/types.ts", "utf8");
const openapiSource = await readFile("docs/api/openapi.yaml", "utf8");
const errorDocsSource = await readFile("docs/api/errors.md", "utf8");

const backendCodes = [...apiErrorSource.matchAll(/\|\s+"([A-Z0-9_]+)"/g)].map((match) => match[1]);
const sdkCodes = extractSdkErrorCodes(sdkTypesSource);
const openapiCodes = extractOpenapiErrorCodes(openapiSource);
const docsStatusByCode = extractDocumentedErrorStatuses(errorDocsSource);
const docsCodes = [...docsStatusByCode.keys()];
const backendStatusByCode = extractBackendApiErrorStatuses(backendSource);
const openapiResponses = extractOpenApiResponses(openapiSource);
const openapiNon2xxResponses = openapiResponses.filter((response) => response.status >= 400 && response.status <= 599);
const allowedNonErrorResponseSchemas = new Map([
  ["GET /ready 503", "#/components/schemas/ReadinessResponse"],
]);

assert.deepEqual(sdkCodes, backendCodes, "SDK rfqErrorCodes array must match backend RFQErrorCode");
assert.deepEqual(openapiCodes, backendCodes, "OpenAPI ErrorResponse enum must match backend RFQErrorCode");
assert.deepEqual(docsCodes, backendCodes, "docs/api/errors.md table must match backend RFQErrorCode");
for (const [code, statuses] of backendStatusByCode) {
  const documentedStatuses = docsStatusByCode.get(code);
  assert.ok(documentedStatuses, `docs/api/errors.md must document ${code}`);
  const undocumentedStatuses = statuses.filter((status) => !documentedStatuses.includes(status));
  assert.deepEqual(
    undocumentedStatuses,
    [],
    `docs/api/errors.md ${code} HTTP status list must cover backend APIError statuses`,
  );
}
for (const response of openapiNon2xxResponses) {
  const allowedSchema = allowedNonErrorResponseSchemas.get(response.key);
  assert.equal(
    response.schemaRef,
    allowedSchema ?? "#/components/schemas/ErrorResponse",
    allowedSchema
      ? `OpenAPI ${response.key} must intentionally use ${allowedSchema}`
      : `OpenAPI ${response.key} error response must use ErrorResponse`,
  );
}
assertTraceHeaderContract(backendSource, apiTestSource, openapiSource, openapiResponses);

console.log(`API error code consistency check passed (${backendCodes.length} codes)`);

async function readSourceTree(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const sources = [];
  for (const entry of entries) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      sources.push(await readSourceTree(path));
    } else if (entry.isFile() && path.endsWith(".ts")) {
      sources.push(await readFile(path, "utf8"));
    }
  }

  return sources.join("\n");
}

function extractOpenapiErrorCodes(source) {
  const match = source.match(/ErrorResponse:[\s\S]*?code:[\s\S]*?enum:\n([\s\S]*?)\n\s*message:/);
  assert.ok(match, "OpenAPI ErrorResponse.code enum not found");

  return [...match[1].matchAll(/^\s+- ([A-Z0-9_]+)$/gm)].map((item) => item[1]);
}

function extractOpenApiResponses(source) {
  const pathsBlock = source.match(/^paths:\n([\s\S]*?)^components:/m);
  assert.ok(pathsBlock, "OpenAPI paths block not found");

  const responses = [];
  const lines = pathsBlock[1].split("\n");
  let currentPath;
  let currentMethod;
  for (let index = 0; index < lines.length; index += 1) {
    const pathMatch = lines[index].match(/^  (\/[^:]+):$/);
    if (pathMatch) {
      currentPath = pathMatch[1];
      currentMethod = undefined;
      continue;
    }

    const methodMatch = lines[index].match(/^    (get|post):$/);
    if (methodMatch) {
      currentMethod = methodMatch[1].toUpperCase();
      continue;
    }

    const responseMatch = lines[index].match(/^        "(\d{3})":$/);
    if (!responseMatch || !currentPath || !currentMethod) {
      continue;
    }

    const block = [];
    for (const line of lines.slice(index + 1)) {
      if (/^        "\d{3}":$/.test(line) || /^    (get|post):$/.test(line) || /^  \/[^:]+:$/.test(line)) {
        break;
      }
      block.push(line);
    }

    const status = Number(responseMatch[1]);
    const label = `${currentMethod} ${currentPath} ${status}`;
    responses.push({
      key: label,
      status,
      schemaRef: extractOpenApiResponseSchemaRef(block.join("\n"), label),
      traceHeaderRef: extractOpenApiTraceHeaderRef(block.join("\n"), label),
    });
  }

  assert.ok(responses.length > 0, "OpenAPI paths must define responses");
  return responses;
}

function extractOpenApiResponseSchemaRef(responseBlock, label) {
  const match = responseBlock.match(/\n              schema:\n                \$ref:\s+"([^"]+)"/);
  return match?.[1];
}

function extractOpenApiTraceHeaderRef(responseBlock, label) {
  const match = responseBlock.match(/\n            x-trace-id:\n              \$ref:\s+"([^"]+)"/);
  assert.ok(match, `OpenAPI ${label} response must define x-trace-id header`);
  return match[1];
}

function extractSdkErrorCodes(source) {
  const match = source.match(/export const rfqErrorCodes = \[\n([\s\S]*?)\] as const;/);
  assert.ok(match, "SDK rfqErrorCodes constant array not found");

  return [...match[1].matchAll(/^\s*"([A-Z0-9_]+)",$/gm)].map((item) => item[1]);
}

function extractDocumentedErrorStatuses(source) {
  const statusByCode = new Map();
  for (const [, code, statusColumn] of source.matchAll(/^\| `([A-Z0-9_]+)` \| ([^|]+) \|/gm)) {
    const statuses = statusColumn.split("/").map((status) => Number(status.trim()));
    assert.ok(
      statuses.every((status) => Number.isInteger(status) && status >= 100 && status <= 599),
      `docs/api/errors.md ${code} HTTP status column must contain numeric HTTP status codes`,
    );
    statusByCode.set(code, [...new Set(statuses)].sort((left, right) => left - right));
  }

  return statusByCode;
}

function extractBackendApiErrorStatuses(source) {
  const statusByCode = new Map();
  for (const [, code, status] of source.matchAll(/new\s+APIError\(\s*"([A-Z0-9_]+)"\s*,[\s\S]*?,\s*(\d{3})(?:\s*,|\s*\))/g)) {
    const statuses = statusByCode.get(code) ?? new Set();
    statuses.add(Number(status));
    statusByCode.set(code, statuses);
  }

  assert.ok(statusByCode.size > 0, "backend/src must construct APIError statuses");
  return new Map(
    [...statusByCode].map(([code, statuses]) => [code, [...statuses].sort((left, right) => left - right)]),
  );
}

function assertTraceHeaderContract(backend, apiTest, openapi, responses) {
  assert.ok(
    openapi.includes("Every response includes an x-trace-id header"),
    "OpenAPI info description must document the x-trace-id response header",
  );
  assert.ok(
    openapi.includes("  headers:\n    TraceId:") &&
      openapi.includes("Request correlation id attached to every response") &&
      openapi.includes('pattern: "^tr_.+"'),
    "OpenAPI components.headers.TraceId must define the reusable trace header",
  );
  for (const response of responses) {
    assert.equal(
      response.traceHeaderRef,
      "#/components/headers/TraceId",
      `OpenAPI ${response.key} must reference components.headers.TraceId`,
    );
  }
  assert.ok(
    backend.includes('reply.header("x-trace-id", requestTraceId(request))'),
    "backend onRequest hook must attach x-trace-id to every response",
  );
  assert.ok(
    backend.includes('return reply.header("x-trace-id", traceId).code(error.statusCode).send(error.toResponse(traceId));'),
    "backend sendError must keep x-trace-id aligned with ErrorResponse.traceId",
  );
  assert.ok(
    backend.includes("function requestTraceId(request: FastifyRequest): string") &&
      backend.includes("return `tr_${request.id}`;"),
    "backend requestTraceId must keep stable tr_ prefixed request ids",
  );

  const headerBodyAssertions = [...apiTest.matchAll(/headers\["x-trace-id"\],\s*[^,\n]+\.body\.traceId/g)];
  assert.ok(
    headerBodyAssertions.length >= 10,
    "backend API tests must assert x-trace-id matches ErrorResponse.traceId across error paths",
  );
  assert.ok(
    apiTest.includes('assert.match(String(response.headers["x-trace-id"]), /^tr_/)'),
    "backend API tests must assert x-trace-id exists on successful responses",
  );
}
