import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function importQuoteRequestModule() {
  const source = await readFile(new URL("../src/lib/quote-request.ts", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      isolatedModules: true,
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: "quote-request.ts",
  });

  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
}

const { validateQuoteFormRequest } = await importQuoteRequestModule();

const baseRequest = Object.freeze({
  chainId: 1,
  user: "0x1111111111111111111111111111111111111111",
  tokenIn: "0x2222222222222222222222222222222222222222",
  tokenOut: "0x3333333333333333333333333333333333333333",
  amountIn: "1000000000000000000",
  slippageBps: 50,
});

test("validateQuoteFormRequest returns a canonical valid request", () => {
  assert.deepEqual(validateQuoteFormRequest(baseRequest), baseRequest);
});

test("validateQuoteFormRequest rejects unsafe request object shapes", () => {
  assert.throws(
    () => validateQuoteFormRequest(undefined),
    /quote form request must be an object/,
  );
  assert.throws(
    () => validateQuoteFormRequest(Object.create(baseRequest)),
    /quote form request\.chainId must be an own field/,
  );
  assert.throws(
    () =>
      validateQuoteFormRequest({
        ...baseRequest,
        routeHint: "internal",
      }),
    /quote form request must not include unknown field routeHint/,
  );
});

test("validateQuoteFormRequest rejects boxed string address fields", () => {
  for (const field of ["user", "tokenIn", "tokenOut"]) {
    assert.throws(
      () =>
        validateQuoteFormRequest({
          ...baseRequest,
          [field]: new String(baseRequest[field]),
        }),
      new RegExp(`${field} must be an EVM address`),
    );
  }
});

test("validateQuoteFormRequest rejects boxed string amountIn", () => {
  assert.throws(
    () =>
      validateQuoteFormRequest({
        ...baseRequest,
        amountIn: new String(baseRequest.amountIn),
      }),
    /amountIn must be a positive uint string/,
  );
});
