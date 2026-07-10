import assert from "node:assert/strict";
import test from "node:test";
import { buildServer } from "../dist/main.js";

const signerKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const settlementAddress = "0x0000000000000000000000000000000000000004";

test("RFQ API validates simulated and receipt-confirmed execution configuration", async () => {
  const original = saveEnv([
    "NODE_ENV",
    "RFQ_SIGNER_PRIVATE_KEY",
    "RFQ_SETTLEMENT_ADDRESS",
    "RFQ_ALLOW_SIMULATED_SETTLEMENT",
    "RFQ_RECEIPT_CONFIG_JSON",
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
    process.env.RFQ_SIGNER_PRIVATE_KEY = signerKey;
    process.env.RFQ_SETTLEMENT_ADDRESS = settlementAddress;
    delete process.env.RFQ_ALLOW_SIMULATED_SETTLEMENT;
    process.env.RFQ_RECEIPT_CONFIG_JSON = JSON.stringify(receiptConfig(settlementAddress));
    const server = buildServer({ logger: false });
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

function saveEnv(names) {
  return Object.fromEntries(names.map((name) => [name, process.env[name]]));
}

function restoreEnv(values) {
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}
