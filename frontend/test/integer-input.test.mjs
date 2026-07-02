import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function importIntegerInputModule() {
  const source = await readFile(new URL("../src/lib/integer-input.ts", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      isolatedModules: true,
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: "integer-input.ts",
  });

  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
}

const { parseIntegerInput } = await importIntegerInputModule();

test("parseIntegerInput accepts primitive decimal strings inside bounds", () => {
  assert.equal(parseIntegerInput("1", 1, Number.MAX_SAFE_INTEGER), 1);
  assert.equal(parseIntegerInput("10000", 0, 10_000), 10_000);
});

test("parseIntegerInput rejects boxed strings before regex coercion", () => {
  assert.equal(parseIntegerInput(new String("1"), 1, Number.MAX_SAFE_INTEGER), undefined);
});

test("parseIntegerInput rejects non-string and unsafe numeric forms", () => {
  assert.equal(parseIntegerInput(1, 1, Number.MAX_SAFE_INTEGER), undefined);
  assert.equal(parseIntegerInput("1.5", 1, Number.MAX_SAFE_INTEGER), undefined);
  assert.equal(parseIntegerInput("1e3", 1, Number.MAX_SAFE_INTEGER), undefined);
  assert.equal(parseIntegerInput("", 0, 10_000), undefined);
  assert.equal(parseIntegerInput(String(Number.MAX_SAFE_INTEGER + 1), 1, Number.MAX_SAFE_INTEGER), undefined);
});
