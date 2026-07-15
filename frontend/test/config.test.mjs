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

const {
  buildFrontendConfig,
  normalizeAddress,
  normalizeBaseUrl,
  normalizeWalletConnectProjectId,
  resolveFrontendConfig,
} = await importConfigModule();

test("frontend config normalizers preserve defaults and canonical strings", () => {
  assert.equal(normalizeBaseUrl(undefined), "http://localhost:3000");
  assert.equal(normalizeBaseUrl(" https://api.example.com/rfq/ "), "https://api.example.com/rfq");
  assert.equal(normalizeAddress(undefined), "0x0000000000000000000000000000000000000004");
  assert.equal(normalizeAddress(""), undefined);
  assert.equal(normalizeWalletConnectProjectId(undefined), "00000000000000000000000000000000");
});

test("frontend config builder reads only supported own env fields", () => {
  assert.deepEqual(
    buildFrontendConfig({
      MODE: "production",
      VITE_RFQ_API_BASE_URL: " https://api.example.com/rfq/ ",
      VITE_RFQ_SETTLEMENT_ADDRESS: "0x1111111111111111111111111111111111111111",
      VITE_WALLETCONNECT_PROJECT_ID: "wallet_project",
    }),
    {
      rfqApiBaseUrl: "https://api.example.com/rfq",
      rfqSettlementAddress: "0x1111111111111111111111111111111111111111",
      walletConnectProjectId: "wallet_project",
    },
  );
});

test("runtime config overrides build values and inherits omitted build values", () => {
  assert.deepEqual(
    resolveFrontendConfig(
      {
        VITE_RFQ_API_BASE_URL: "https://app.example.com/api/",
        VITE_RFQ_SETTLEMENT_ADDRESS: "0x2222222222222222222222222222222222222222",
      },
      {
        VITE_RFQ_API_BASE_URL: "https://build.example.com",
        VITE_RFQ_SETTLEMENT_ADDRESS: "0x1111111111111111111111111111111111111111",
        VITE_WALLETCONNECT_PROJECT_ID: "build_project",
      },
    ),
    {
      rfqApiBaseUrl: "https://app.example.com/api",
      rfqSettlementAddress: "0x2222222222222222222222222222222222222222",
      walletConnectProjectId: "build_project",
    },
  );
});

test("blank runtime settlement address disables wallet submission instead of using a build value", () => {
  assert.deepEqual(
    resolveFrontendConfig(
      { VITE_RFQ_SETTLEMENT_ADDRESS: "" },
      { VITE_RFQ_SETTLEMENT_ADDRESS: "0x1111111111111111111111111111111111111111" },
    ),
    {
      rfqApiBaseUrl: "http://localhost:3000",
      rfqSettlementAddress: undefined,
      walletConnectProjectId: "00000000000000000000000000000000",
    },
  );
});

test("runtime config rejects malformed and inherited fields", () => {
  assert.throws(
    () => resolveFrontendConfig(null, {}),
    /frontend runtime config must be an object/,
  );
  assert.throws(
    () => resolveFrontendConfig({}, null),
    /frontend build config must be an object/,
  );
  assert.throws(
    () => resolveFrontendConfig(Object.create({ VITE_RFQ_API_BASE_URL: "https://evil.example" }), {}),
    /frontend config env\.VITE_RFQ_API_BASE_URL must be an own field when provided/,
  );
});

test("frontend loads the external runtime config before the application bundle", async () => {
  const indexHtml = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const runtimeScriptIndex = indexHtml.indexOf('src="/runtime-config.js"');
  const applicationScriptIndex = indexHtml.indexOf('src="/src/app/main.tsx"');

  assert.ok(runtimeScriptIndex >= 0);
  assert.ok(applicationScriptIndex > runtimeScriptIndex);
});

test("frontend config builder rejects malformed or inherited env fields", () => {
  assert.throws(
    () => buildFrontendConfig(null),
    /frontend config env must be an object/,
  );
  assert.throws(
    () => buildFrontendConfig(Object.create({ VITE_RFQ_API_BASE_URL: "https://api.example.com" })),
    /frontend config env\.VITE_RFQ_API_BASE_URL must be an own field when provided/,
  );
  assert.throws(
    () =>
      buildFrontendConfig(
        Object.create({
          VITE_RFQ_SETTLEMENT_ADDRESS: "0x1111111111111111111111111111111111111111",
        }),
      ),
    /frontend config env\.VITE_RFQ_SETTLEMENT_ADDRESS must be an own field when provided/,
  );
  assert.throws(
    () => buildFrontendConfig(Object.create({ VITE_WALLETCONNECT_PROJECT_ID: "wallet_project" })),
    /frontend config env\.VITE_WALLETCONNECT_PROJECT_ID must be an own field when provided/,
  );
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
