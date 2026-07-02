import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function importConfigModule() {
  const source = await readFile(new URL("../src/lib/config.ts", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      isolatedModules: true,
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: "config.ts",
  });

  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
}

const { normalizeAddress, normalizeBaseUrl, normalizeWalletConnectProjectId } = await importConfigModule();

test("frontend config normalizers preserve defaults and canonical strings", () => {
  assert.equal(normalizeBaseUrl(undefined), "http://localhost:3000");
  assert.equal(normalizeBaseUrl(" https://api.example.com/rfq/ "), "https://api.example.com/rfq");
  assert.equal(normalizeAddress(undefined), "0x0000000000000000000000000000000000000004");
  assert.equal(normalizeWalletConnectProjectId(undefined), "00000000000000000000000000000000");
});

test("frontend config normalizers reject boxed strings before trim coercion", () => {
  assert.throws(
    () => normalizeBaseUrl(new String("https://api.example.com")),
    /VITE_RFQ_API_BASE_URL must be a primitive string/,
  );
  assert.throws(
    () => normalizeAddress(new String("0x0000000000000000000000000000000000000004")),
    /VITE_RFQ_SETTLEMENT_ADDRESS must be a primitive string/,
  );
  assert.throws(
    () => normalizeWalletConnectProjectId(new String("wallet_project")),
    /VITE_WALLETCONNECT_PROJECT_ID must be a primitive string/,
  );
});

test("frontend config normalizers reject non-string explicit values", () => {
  assert.throws(() => normalizeBaseUrl(3000), /VITE_RFQ_API_BASE_URL must be a primitive string/);
  assert.throws(() => normalizeAddress(4), /VITE_RFQ_SETTLEMENT_ADDRESS must be a primitive string/);
  assert.throws(() => normalizeWalletConnectProjectId(true), /VITE_WALLETCONNECT_PROJECT_ID must be a primitive string/);
});
