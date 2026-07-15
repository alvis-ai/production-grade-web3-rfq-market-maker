import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function importRfqModule() {
  let source = await readFile(new URL("../src/lib/rfq.ts", import.meta.url), "utf8");
  source = source
    .replace(
      'import { RFQClient } from "@rfq-market-maker/sdk";',
      "class RFQClient { constructor() {} }",
    )
    .replace('import { rfqApiBaseUrl } from "./config";', 'const rfqApiBaseUrl = "http://localhost:3000";');

  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      isolatedModules: true,
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: "rfq.ts",
  });

  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
}

const { buildQuoteFromResponse, nextQuoteIdempotencyKey } = await importRfqModule();

const request = Object.freeze({
  chainId: 1,
  user: "0x1111111111111111111111111111111111111111",
  tokenIn: "0x2222222222222222222222222222222222222222",
  tokenOut: "0x3333333333333333333333333333333333333333",
  amountIn: "1000000000000000000",
  slippageBps: 50,
});

const response = Object.freeze({
  quoteId: "q_test",
  snapshotId: "snapshot_test",
  amountOut: "998000000000000000",
  minAmountOut: "993000000000000000",
  deadline: 1893456000,
  nonce: "42",
  signature: `0x${"11".repeat(64)}1b`,
});

test("nextQuoteIdempotencyKey returns bounded unique safe keys", () => {
  const first = nextQuoteIdempotencyKey();
  const second = nextQuoteIdempotencyKey();
  assert.match(first, /^[A-Za-z0-9._:-]{16,128}$/);
  assert.match(second, /^[A-Za-z0-9._:-]{16,128}$/);
  assert.notEqual(first, second);
});

test("buildQuoteFromResponse returns the wallet quote shape", () => {
  assert.deepEqual(buildQuoteFromResponse(request, response), {
    user: request.user,
    tokenIn: request.tokenIn,
    tokenOut: request.tokenOut,
    amountIn: request.amountIn,
    amountOut: response.amountOut,
    minAmountOut: response.minAmountOut,
    nonce: response.nonce,
    deadline: response.deadline,
    chainId: request.chainId,
  });
});

test("buildQuoteFromResponse rejects unsafe request and response envelopes", () => {
  assert.throws(
    () => buildQuoteFromResponse(undefined, response),
    /quote request must be an object/,
  );
  assert.throws(
    () => buildQuoteFromResponse(request, undefined),
    /quote response must be an object/,
  );
  assert.throws(
    () => buildQuoteFromResponse(Object.create(request), response),
    /quote request\.chainId must be an own field/,
  );
  assert.throws(
    () => buildQuoteFromResponse(request, Object.create(response)),
    /quote response\.quoteId must be an own field/,
  );
  assert.throws(
    () => buildQuoteFromResponse({ ...request, routeHint: "internal" }, response),
    /quote request must not include unknown field routeHint/,
  );
  assert.throws(
    () => buildQuoteFromResponse(request, { ...response, routeHint: "internal" }),
    /quote response must not include unknown field routeHint/,
  );
});
