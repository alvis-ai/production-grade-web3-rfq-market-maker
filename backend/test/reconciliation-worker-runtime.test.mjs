import assert from "node:assert/strict";
import test from "node:test";
import {
  readReconciliationTokenRegistry,
  readReconciliationWorkerRuntimeConfig,
} from "../dist/reconciliation-worker-main.js";

const baseEnv = {
  DATABASE_URL: "postgres://rfq:rfq@postgres:5432/rfq_market_maker",
};

test("reconciliation worker runtime parses durable defaults", () => {
  const config = readReconciliationWorkerRuntimeConfig(baseEnv);
  assert.equal(config.worker.leaseMs, 30_000);
  assert.equal(config.worker.pollIntervalMs, 250);
  assert.equal(config.worker.retryDelayMs, 1_000);
  assert.equal(config.listenPort, 3003);
  assert.match(config.worker.workerId, /^reconciliation_worker_[a-f0-9]{16}$/);
});

test("reconciliation worker runtime accepts bounded overrides", () => {
  const config = readReconciliationWorkerRuntimeConfig({
    ...baseEnv,
    RFQ_RECONCILIATION_WORKER_ID: "reconciliation_worker_custom",
    RFQ_RECONCILIATION_WORKER_HOST: "127.0.0.1",
    RFQ_RECONCILIATION_WORKER_PORT: "3103",
    RFQ_RECONCILIATION_LEASE_MS: "45000",
    RFQ_RECONCILIATION_POLL_INTERVAL_MS: "500",
    RFQ_RECONCILIATION_RETRY_DELAY_MS: "2000",
  });
  assert.equal(config.worker.workerId, "reconciliation_worker_custom");
  assert.equal(config.listenHost, "127.0.0.1");
  assert.equal(config.listenPort, 3103);
  assert.equal(config.worker.leaseMs, 45_000);
});

test("reconciliation worker runtime rejects missing or unsafe configuration", () => {
  assert.throws(() => readReconciliationWorkerRuntimeConfig({}), /DATABASE_URL is required/);
  assert.throws(
    () => readReconciliationWorkerRuntimeConfig({ ...baseEnv, RFQ_RECONCILIATION_WORKER_PORT: "0" }),
    /must be an integer between 1 and 65535/,
  );
  assert.throws(
    () => readReconciliationWorkerRuntimeConfig({ ...baseEnv, RFQ_RECONCILIATION_WORKER_HOST: "bad host" }),
    /HOST is invalid/,
  );
  assert.throws(
    () => readReconciliationWorkerRuntimeConfig({ ...baseEnv, NODE_ENV: "production" }),
    /sslmode=verify-full/,
  );
  assert.doesNotThrow(() => readReconciliationWorkerRuntimeConfig({
    ...baseEnv,
    NODE_ENV: "production",
    DATABASE_URL: "postgres://reconciliation:secret@db.example.com/rfq?sslmode=verify-full",
  }));
});

test("reconciliation worker loads the same strict token registry used for PnL valuation", () => {
  const token = "0x0000000000000000000000000000000000000010";
  const registry = readReconciliationTokenRegistry({
    RFQ_TOKEN_REGISTRY_JSON: JSON.stringify({
      tokens: [{
        chainId: 10,
        tokenAddress: token,
        symbol: "TOKEN10",
        decimals: 6,
        isWhitelisted: true,
        riskTier: "low",
        usdReference: true,
      }],
    }),
  });
  assert.equal(registry.getToken(10, token).decimals, 6);
  assert.throws(
    () => readReconciliationTokenRegistry({ RFQ_TOKEN_REGISTRY_JSON: "{" }),
    /must contain valid JSON/,
  );

  const inherited = Object.create({ RFQ_TOKEN_REGISTRY_JSON: "{" });
  const defaultRegistry = readReconciliationTokenRegistry(inherited);
  assert.equal(defaultRegistry.getToken(1, "0x0000000000000000000000000000000000000002").decimals, 18);
});
