#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const backendSource = await readFile("backend/src/main.ts", "utf8");
const sdkClientSource = await readFile("sdk/src/client.ts", "utf8");
const openapiSource = await readFile("docs/api/openapi.yaml", "utf8");
const smokeSource = await readFile("scripts/smoke-api.mjs", "utf8");

const endpoints = [
  {
    method: "post",
    backendPath: "/quote",
    openapiPath: "/quote",
    operationId: "createQuote",
    sdkMethod: "quote",
    sdkPath: "/quote",
    smokePath: "/quote",
  },
  {
    method: "post",
    backendPath: "/submit",
    openapiPath: "/submit",
    operationId: "submitQuote",
    sdkMethod: "submit",
    sdkPath: "/submit",
    smokePath: "/submit",
  },
  {
    method: "get",
    backendPath: "/quote/:quoteId",
    openapiPath: "/quote/{quoteId}",
    operationId: "getQuote",
    sdkMethod: "getQuote",
    sdkPath: "/quote/",
    smokePath: "/quote/",
    pathParameter: "quoteId",
  },
  {
    method: "get",
    backendPath: "/hedges/:hedgeOrderId",
    openapiPath: "/hedges/{hedgeOrderId}",
    operationId: "getHedgeIntent",
    sdkMethod: "getHedge",
    sdkPath: "/hedges/",
    smokePath: "/hedges/",
    pathParameter: "hedgeOrderId",
  },
  {
    method: "get",
    backendPath: "/settlements/:settlementEventId",
    openapiPath: "/settlements/{settlementEventId}",
    operationId: "getSettlementEvent",
    sdkMethod: "getSettlement",
    sdkPath: "/settlements/",
    smokePath: "/settlements/",
    pathParameter: "settlementEventId",
  },
  {
    method: "get",
    backendPath: "/pnl",
    openapiPath: "/pnl",
    operationId: "getPnlSummary",
    sdkMethod: "pnl",
    sdkPath: "/pnl",
    smokePath: "/pnl",
  },
  {
    method: "get",
    backendPath: "/health",
    openapiPath: "/health",
    operationId: "getHealth",
    sdkMethod: "health",
    sdkPath: "/health",
    smokePath: "/health",
  },
  {
    method: "get",
    backendPath: "/ready",
    openapiPath: "/ready",
    operationId: "getReadiness",
    sdkMethod: "ready",
    sdkPath: "/ready",
    smokePath: "/ready",
  },
  {
    method: "get",
    backendPath: "/metrics",
    openapiPath: "/metrics",
    operationId: "getMetrics",
    sdkMethod: "metrics",
    sdkPath: "/metrics",
    smokePath: "/metrics",
  },
];

for (const endpoint of endpoints) {
  assertBackendRoute(endpoint.method, endpoint.backendPath);
  assertOpenApiRoute(endpoint.openapiPath, endpoint.method, endpoint.operationId);
  if (endpoint.pathParameter) {
    assertOpenApiNonEmptyPathParameter(endpoint.openapiPath, endpoint.pathParameter);
  }
  assertSdkMethod(endpoint.sdkMethod, endpoint.sdkPath);
  assertSmokeCoverage(endpoint.method, endpoint.smokePath);
}

assert.deepEqual(
  extractBackendRoutes(backendSource).sort(),
  endpoints.map((endpoint) => `${endpoint.method.toUpperCase()} ${endpoint.backendPath}`).sort(),
  "backend public route list must match route consistency manifest",
);
assert.deepEqual(
  extractOpenApiRoutes(openapiSource).sort(),
  endpoints.map((endpoint) => `${endpoint.method.toUpperCase()} ${endpoint.openapiPath}`).sort(),
  "OpenAPI public route list must match route consistency manifest",
);

console.log(`API route consistency check passed (${endpoints.length} endpoints)`);

function assertBackendRoute(method, path) {
  assert.ok(
    backendSource.includes(`server.${method}("${path}"`),
    `backend must register ${method.toUpperCase()} ${path}`,
  );
}

function assertOpenApiRoute(path, method, operationId) {
  const pathBlock = extractOpenApiPathBlock(path);
  assert.ok(
    new RegExp(`^    ${method}:\\n`, "m").test(pathBlock),
    `OpenAPI must define ${method.toUpperCase()} ${path}`,
  );
  assert.ok(
    pathBlock.includes(`operationId: ${operationId}`),
    `OpenAPI ${method.toUpperCase()} ${path} must use operationId ${operationId}`,
  );
}

function assertOpenApiNonEmptyPathParameter(path, parameterName) {
  const pathBlock = extractOpenApiPathBlock(path);
  const parameterBlock = extractOpenApiParameterBlock(pathBlock, parameterName);
  assert.ok(
    parameterBlock.includes("required: true"),
    `OpenAPI ${path} path parameter ${parameterName} must be required`,
  );
  assert.ok(
    parameterBlock.includes("type: string"),
    `OpenAPI ${path} path parameter ${parameterName} must be a string`,
  );
  assert.ok(
    parameterBlock.includes("minLength: 1"),
    `OpenAPI ${path} path parameter ${parameterName} must reject empty identifiers with minLength: 1`,
  );
}

function assertSdkMethod(methodName, pathFragment) {
  assert.ok(
    new RegExp(`async\\s+${methodName}\\s*\\(`).test(sdkClientSource),
    `SDK must expose ${methodName}()`,
  );
  assert.ok(
    sdkClientSource.includes(pathFragment),
    `SDK ${methodName}() must call path fragment ${pathFragment}`,
  );
}

function assertSmokeCoverage(method, pathFragment) {
  const requestName = method === "get" && pathFragment === "/metrics" ? "requestText" : "request";
  assert.ok(
    smokeSource.includes(`${requestName}("${method.toUpperCase()}", \``) ||
      smokeSource.includes(`${requestName}("${method.toUpperCase()}", "${pathFragment}"`) ||
      smokeSource.includes(`${requestName}("${method.toUpperCase()}", \`${pathFragment}`),
    `smoke-api must exercise ${method.toUpperCase()} ${pathFragment}`,
  );
}

function extractBackendRoutes(source) {
  return [...source.matchAll(/server\.(get|post)\("([^"]+)"/g)].map(
    ([, method, path]) => `${method.toUpperCase()} ${path}`,
  );
}

function extractOpenApiRoutes(source) {
  const pathsBlock = source.match(/^paths:\n([\s\S]*?)^components:/m);
  assert.ok(pathsBlock, "OpenAPI paths block not found");

  const routes = [];
  let currentPath;
  for (const line of pathsBlock[1].split("\n")) {
    const pathMatch = line.match(/^  (\/[^:]+):$/);
    if (pathMatch) {
      currentPath = pathMatch[1];
      continue;
    }

    const methodMatch = line.match(/^    (get|post):$/);
    if (currentPath && methodMatch) {
      routes.push(`${methodMatch[1].toUpperCase()} ${currentPath}`);
    }
  }

  return routes;
}

function extractOpenApiPathBlock(path) {
  const lines = openapiSource.split("\n");
  const start = lines.findIndex((line) => line === `  ${path}:`);
  assert.ok(start >= 0, `OpenAPI path ${path} not found`);

  const block = [];
  for (const line of lines.slice(start + 1)) {
    if (/^  \/[^:]+:/.test(line) || line === "components:") {
      break;
    }
    block.push(line);
  }

  return block.join("\n");
}

function extractOpenApiParameterBlock(pathBlock, parameterName) {
  const lines = pathBlock.split("\n");
  const start = lines.findIndex((line) => line === `        - name: ${parameterName}`);
  assert.ok(start >= 0, `OpenAPI path parameter ${parameterName} not found`);

  const block = [];
  for (const line of lines.slice(start)) {
    if (block.length > 0 && /^        - name: /.test(line)) {
      break;
    }
    if (block.length > 0 && /^      [a-zA-Z][a-zA-Z0-9]*:/.test(line)) {
      break;
    }
    block.push(line);
  }

  return block.join("\n");
}
