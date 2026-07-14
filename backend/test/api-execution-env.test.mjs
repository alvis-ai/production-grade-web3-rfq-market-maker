import assert from "node:assert/strict";
import test from "node:test";
import { buildServer } from "../dist/main.js";
import {
  configureAwsSignerEnvironment,
  localTestSignerService,
  signerRuntimeEnvNames,
  testSettlementAddress as settlementAddress,
} from "./helpers/signer-runtime-fixtures.mjs";

test("RFQ API validates simulated and receipt-confirmed execution configuration", async () => {
  const original = saveEnv([
    "NODE_ENV",
    ...signerRuntimeEnvNames,
    "RFQ_ALLOW_SIMULATED_SETTLEMENT",
    "RFQ_RECEIPT_CONFIG_JSON",
    "RFQ_REDIS_URL",
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
    delete process.env.RFQ_ALLOW_SIMULATED_SETTLEMENT;
    process.env.RFQ_RECEIPT_CONFIG_JSON = JSON.stringify(receiptConfig(settlementAddress));
    process.env.RFQ_REDIS_URL = "redis://127.0.0.1:6379/0";
    const server = buildServer({
      apiKeyAuthenticator: allowAllApiKeyAuthenticator(),
      logger: false,
      databasePool: fakeDatabasePool(),
      marketDataService: testMarketDataService(),
      signerService: localTestSignerService(),
    });
    await server.ready();
    await server.close();
  } finally {
    restoreEnv(original);
  }
});

function receiptConfig(address) {
  return {
    chains: [{
      chainId: 1,
      rpcUrl: "http://127.0.0.1:8545",
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
