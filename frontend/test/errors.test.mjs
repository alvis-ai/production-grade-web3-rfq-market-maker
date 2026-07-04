import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function importErrorsModule() {
  let source = await readFile(new URL("../src/lib/errors.ts", import.meta.url), "utf8");
  source = source.replace(
    'import { RFQClientError } from "@rfq-market-maker/sdk";',
    `class RFQClientError extends Error {
      constructor(message, code, status, traceId, retryAfterSeconds) {
        super(message);
        this.code = code;
        this.status = status;
        this.traceId = traceId;
        this.retryAfterSeconds = retryAfterSeconds;
      }
    }`,
  );
  source += "\nexport { RFQClientError };\n";

  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      isolatedModules: true,
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: "errors.ts",
  });

  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
}

const { RFQClientError, toUIError } = await importErrorsModule();

test("toUIError preserves structured SDK errors", () => {
  const error = new RFQClientError("Too many requests", "RATE_LIMITED", 429, "tr_frontend", 12);

  assert.deepEqual(toUIError(error, "fallback"), {
    message: "Too many requests",
    code: "RATE_LIMITED",
    status: 429,
    traceId: "tr_frontend",
    retryAfterSeconds: 12,
  });
});

test("toUIError prefers safe viem and wagmi wallet error messages", () => {
  const error = new Error("ContractFunctionExecutionError: verbose wallet stack");
  error.shortMessage = "User rejected the request";
  error.details = "This lower-priority detail should not render";

  assert.deepEqual(toUIError(error, "Onchain submit failed"), {
    message: "User rejected the request",
  });
});

test("toUIError reads nested contract revert details from wallet error causes", () => {
  const error = new Error("Contract call failed", {
    cause: {
      shortMessage: "The contract function reverted with custom error QuoteExpired()",
    },
  });

  assert.deepEqual(toUIError(error, "Onchain submit failed"), {
    message: "The contract function reverted with custom error QuoteExpired()",
  });
});

test("toUIError ignores unsafe inherited, blank, and oversized wallet error fields", () => {
  const inherited = Object.create({ shortMessage: "prototype controlled message" });
  assert.deepEqual(toUIError(inherited, "Onchain submit failed"), {
    message: "Onchain submit failed",
  });

  const blankThenDetails = {
    shortMessage: "   ",
    details: "Execution reverted with InvalidSigner()",
  };
  assert.deepEqual(toUIError(blankThenDetails, "Onchain submit failed"), {
    message: "Execution reverted with InvalidSigner()",
  });

  const oversized = {
    shortMessage: "x".repeat(513),
  };
  assert.deepEqual(toUIError(oversized, "Onchain submit failed"), {
    message: "Onchain submit failed",
  });
});

test("toUIError falls back to Error.message or the provided fallback", () => {
  assert.deepEqual(toUIError(new Error("Plain runtime error"), "fallback"), {
    message: "Plain runtime error",
  });
  assert.deepEqual(toUIError("not an error", "fallback"), {
    message: "fallback",
  });
});
