import { readFile, readdir } from "node:fs/promises";
import assert from "node:assert/strict";

const apiErrorSource = await readFile("backend/src/shared/errors/api-error.ts", "utf8");
const backendSource = await readSourceTree("backend/src");
const sdkTypesSource = await readFile("sdk/src/types.ts", "utf8");
const openapiSource = await readFile("docs/api/openapi.yaml", "utf8");
const errorDocsSource = await readFile("docs/api/errors.md", "utf8");

const backendCodes = [...apiErrorSource.matchAll(/\|\s+"([A-Z0-9_]+)"/g)].map((match) => match[1]);
const sdkCodes = extractSdkErrorCodes(sdkTypesSource);
const openapiCodes = extractOpenapiErrorCodes(openapiSource);
const docsStatusByCode = extractDocumentedErrorStatuses(errorDocsSource);
const docsCodes = [...docsStatusByCode.keys()];
const backendStatusByCode = extractBackendApiErrorStatuses(backendSource);

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
