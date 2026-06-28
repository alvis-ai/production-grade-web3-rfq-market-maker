import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const apiErrorSource = await readFile("backend/src/shared/errors/api-error.ts", "utf8");
const sdkTypesSource = await readFile("sdk/src/types.ts", "utf8");
const openapiSource = await readFile("docs/api/openapi.yaml", "utf8");
const errorDocsSource = await readFile("docs/api/errors.md", "utf8");

const backendCodes = [...apiErrorSource.matchAll(/\|\s+"([A-Z0-9_]+)"/g)].map((match) => match[1]);
const sdkCodes = extractTypeUnionCodes(sdkTypesSource, "RFQErrorCode");
const openapiCodes = extractOpenapiErrorCodes(openapiSource);
const docsCodes = [...errorDocsSource.matchAll(/^\| `([A-Z0-9_]+)` \|/gm)].map((match) => match[1]);

assert.deepEqual(sdkCodes, backendCodes, "SDK RFQErrorCode union must match backend RFQErrorCode");
assert.deepEqual(openapiCodes, backendCodes, "OpenAPI ErrorResponse enum must match backend RFQErrorCode");
assert.deepEqual(docsCodes, backendCodes, "docs/api/errors.md table must match backend RFQErrorCode");

console.log(`API error code consistency check passed (${backendCodes.length} codes)`);

function extractOpenapiErrorCodes(source) {
  const match = source.match(/ErrorResponse:[\s\S]*?code:[\s\S]*?enum:\n([\s\S]*?)\n\s*message:/);
  assert.ok(match, "OpenAPI ErrorResponse.code enum not found");

  return [...match[1].matchAll(/^\s+- ([A-Z0-9_]+)$/gm)].map((item) => item[1]);
}

function extractTypeUnionCodes(source, typeName) {
  const match = source.match(new RegExp(`export type ${typeName} =\\n([\\s\\S]*?);`));
  assert.ok(match, `${typeName} union not found`);

  return [...match[1].matchAll(/^\s*\|\s+"([A-Z0-9_]+)"/gm)].map((item) => item[1]);
}
