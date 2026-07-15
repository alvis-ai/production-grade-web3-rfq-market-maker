import assert from "node:assert/strict";
import test from "node:test";
import { readSettlementIndexerRuntimeConfig } from "../dist/settlement-indexer-main.js";

test("settlement indexer runtime parses durable worker and chain settings", () => {
  const config = readSettlementIndexerRuntimeConfig(baseEnv());
  assert.equal(config.worker.workerId, "indexer_runtime_1");
  assert.equal(config.worker.leaseMs, 30_000);
  assert.equal(config.worker.pollIntervalMs, 1_000);
  assert.equal(config.worker.readinessStaleMs, 60_000);
  assert.equal(config.listenHost, "0.0.0.0");
  assert.equal(config.listenPort, 3004);
  assert.equal(config.shutdownTimeoutMs, 20_000);
  assert.equal(config.indexer.chains[0].reorgLookbackBlocks, 1_000);
});

test("settlement indexer runtime reads only own fields and rejects unsafe configuration", () => {
  const inherited = Object.create(baseEnv());
  assert.throws(() => readSettlementIndexerRuntimeConfig(inherited), /DATABASE_URL is required/);
  assert.throws(
    () => readSettlementIndexerRuntimeConfig({ ...baseEnv(), DATABASE_URL: "mysql://database" }),
    /postgres/,
  );
  assert.throws(
    () => readSettlementIndexerRuntimeConfig({ ...baseEnv(), RFQ_SETTLEMENT_INDEXER_LEASE_MS: "9000" }),
    /at least twice/,
  );
  assert.throws(
    () => readSettlementIndexerRuntimeConfig({ ...baseEnv(), RFQ_SETTLEMENT_INDEXER_PORT: "03004" }),
    /integer between/,
  );
  assert.throws(
    () => readSettlementIndexerRuntimeConfig({ ...baseEnv(), RFQ_SETTLEMENT_INDEXER_HOST: " 0.0.0.0" }),
    /surrounding whitespace/,
  );
  assert.throws(
    () => readSettlementIndexerRuntimeConfig({ ...baseEnv(), NODE_ENV: "production" }),
    /sslmode=verify-full/,
  );
  assert.doesNotThrow(() => readSettlementIndexerRuntimeConfig({
    ...baseEnv(),
    NODE_ENV: "production",
    DATABASE_URL: "postgres://indexer:secret@db.example.com/rfq?sslmode=verify-full",
  }));
});

function baseEnv() {
  return {
    DATABASE_URL: "postgres://rfq:secret@database:5432/rfq",
    RFQ_SETTLEMENT_INDEXER_WORKER_ID: "indexer_runtime_1",
    RFQ_SETTLEMENT_INDEXER_CONFIG_JSON: JSON.stringify({ chains: [{
      chainId: 1,
      rpcUrl: "https://rpc.example/project-token",
      settlementAddress: "0x0000000000000000000000000000000000000004",
      startBlock: 20_000_000,
      confirmations: 12,
      maxBlockRange: 500,
      reorgLookbackBlocks: 1_000,
      requestTimeoutMs: 10_000,
    }] }),
  };
}
