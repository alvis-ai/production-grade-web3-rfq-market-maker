import assert from "node:assert/strict";
import test from "node:test";
import { buildServer } from "../dist/main.js";
import {
  configureAwsSignerEnvironment,
  localTestSignerService,
  signerRuntimeEnvNames,
  testSettlementAddress as settlementAddress,
} from "./helpers/signer-runtime-fixtures.mjs";
import {
  configureUsdReferenceEnvironment,
  dailyLossRuntimeEnvName,
  usdReferenceRuntimeEnvName,
} from "./helpers/usd-reference-runtime-fixtures.mjs";

test("RFQ API validates simulated and receipt-confirmed execution configuration", async () => {
  const original = saveEnv([
    "NODE_ENV",
    ...signerRuntimeEnvNames,
    "RFQ_ALLOW_SIMULATED_SETTLEMENT",
    "RFQ_RECEIPT_CONFIG_JSON",
    "RFQ_REDIS_URL",
    dailyLossRuntimeEnvName,
    usdReferenceRuntimeEnvName,
  ]);

  try {
    delete process.env.NODE_ENV;
    process.env.RFQ_ALLOW_SIMULATED_SETTLEMENT = "sometimes";
    assert.throws(() => buildServer({ logger: false }), /must be true or false/);

    process.env.RFQ_ALLOW_SIMULATED_SETTLEMENT = "false";
    delete process.env.RFQ_RECEIPT_CONFIG_JSON;
    assert.throws(() => buildServer({ logger: false }), /must configure at least one chain/);

    process.env.RFQ_RECEIPT_CONFIG_JSON = JSON.stringify(receiptConfig(
      "0x0000000000000000000000000000000000000005",
    ));
    assert.throws(() => buildServer({ logger: false }), /must match RFQ_SETTLEMENT_ADDRESS/);

    process.env.NODE_ENV = "production";
    configureAwsSignerEnvironment();
    configureUsdReferenceEnvironment();
    delete process.env.RFQ_ALLOW_SIMULATED_SETTLEMENT;
    process.env.RFQ_REDIS_URL = "rediss://redis.example.com:6380/0";
    process.env.RFQ_RECEIPT_CONFIG_JSON = JSON.stringify(receiptConfig(
      settlementAddress,
      "http://rpc.example.com/v1/key",
    ));
    assert.throws(() => buildServer(runtimeServerOptions()), /must use a bounded HTTPS URL/);

    process.env.RFQ_RECEIPT_CONFIG_JSON = JSON.stringify(receiptConfig(settlementAddress));
    const server = buildServer(runtimeServerOptions());
    await server.ready();
    await server.close();
  } finally {
    restoreEnv(original);
  }
});

function receiptConfig(address, rpcUrl = "https://rpc.example.com/v1/key") {
  return {
    chains: [{
      chainId: 1,
      rpcUrl,
      settlementAddress: address,
      confirmations: 2,
      receiptTimeoutMs: 120_000,
    }],
  };
}

function fakeDatabasePool() {
  const client = {
    async query() {
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  return {
    async connect() {
      return client;
    },
  };
}

function testMarketDataService() {
  return { async getSnapshot() { throw new Error("unused market data"); } };
}

function runtimeServerOptions() {
  return {
    apiKeyAuthenticator: allowAllApiKeyAuthenticator(),
    logger: false,
    databasePool: fakeDatabasePool(),
    marketDataService: testMarketDataService(),
    quoteExposureStore: unusedQuoteExposureStore(),
    signerService: localTestSignerService(),
  };
}

function unusedQuoteExposureStore() {
  return {
    async checkHealth() {},
    async reserve() { throw new Error("unused quote exposure"); },
    async release() {},
  };
}

function saveEnv(names) {
  return Object.fromEntries(names.map((name) => [name, process.env[name]]));
}

function allowAllApiKeyAuthenticator() {
  return {
    authenticate() {
      return {
        status: "authenticated",
        principal: { keyId: "test_key", principalId: "test_principal", scopes: ["quote:write"] },
      };
    },
  };
}

function restoreEnv(values) {
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}
