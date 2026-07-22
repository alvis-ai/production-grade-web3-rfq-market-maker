import assert from "node:assert/strict";
import test from "node:test";
import { readQuoteExposureRuntimeConfig } from "../dist/runtime/gateway-quote-exposure.js";

test("quote exposure runtime keeps PostgreSQL compatibility only for local environments", () => {
  const config = readQuoteExposureRuntimeConfig({});

  assert.equal(config.backend, "postgres");
  assert.equal(config.allowEpochInitialization, true);
  assert.equal(config.minReplicaAcks, 0);
  assert.equal(config.requireTls, false);
  assert.equal(config.mirrorCleanupIntervalMs, 10_000);
});

test("quote exposure runtime requires replicated durable Redis in production", () => {
  const config = readQuoteExposureRuntimeConfig(productionEnv());

  assert.equal(config.backend, "redis-stream");
  assert.equal(config.redisUrl, "rediss://redis.example.com:6380/0");
  assert.equal(config.ledgerEpoch, "production_v1");
  assert.equal(config.allowEpochInitialization, false);
  assert.equal(config.minReplicaAcks, 1);
  assert.equal(config.requireAof, true);
  assert.equal(config.requireTls, true);
  assert.equal(config.keyPrefix, "rfq:{quote-state}:exposure");
  assert.ok(config.expiryGraceSeconds * 1_000 > config.inventoryMaxAgeMs);
});

test("quote exposure runtime rejects unsafe production authority configuration", () => {
  assert.throws(
    () => readQuoteExposureRuntimeConfig({ ...productionEnv(), RFQ_QUOTE_EXPOSURE_BACKEND: "postgres" }),
    /must be redis-stream/,
  );
  assert.throws(
    () => readQuoteExposureRuntimeConfig({
      ...productionEnv(),
      RFQ_QUOTE_EXPOSURE_ALLOW_EPOCH_INITIALIZATION: "true",
    }),
    /cannot be enabled in production/,
  );
  assert.throws(
    () => readQuoteExposureRuntimeConfig({
      ...productionEnv(),
      RFQ_QUOTE_EXPOSURE_MIN_REPLICA_ACKS: "0",
    }),
    /must be at least 1 in production/,
  );
  const missingEpoch = productionEnv();
  delete missingEpoch.RFQ_QUOTE_EXPOSURE_LEDGER_EPOCH;
  assert.throws(
    () => readQuoteExposureRuntimeConfig(missingEpoch),
    /LEDGER_EPOCH must be a safe identifier/,
  );
});

test("quote exposure runtime rejects stale inventory and lease bounds", () => {
  assert.throws(
    () => readQuoteExposureRuntimeConfig({
      RFQ_QUOTE_INVENTORY_REFRESH_INTERVAL_MS: "100",
      RFQ_QUOTE_INVENTORY_MAX_AGE_MS: "100",
    }),
    /must cover at least two refresh intervals/,
  );
  assert.throws(
    () => readQuoteExposureRuntimeConfig({
      RFQ_QUOTE_EXPOSURE_LOCK_TTL_MS: "100",
      RFQ_QUOTE_EXPOSURE_LOCK_ACQUIRE_TIMEOUT_MS: "100",
    }),
    /must be less than lock TTL/,
  );
  assert.throws(
    () => readQuoteExposureRuntimeConfig({
      RFQ_QUOTE_EXPOSURE_MIRROR_CLEANUP_INTERVAL_MS: "999",
    }),
    /between 1000 and 600000/,
  );
});

function productionEnv() {
  return {
    NODE_ENV: "production",
    RFQ_REDIS_URL: "rediss://redis.example.com:6380/0",
    RFQ_QUOTE_EXPOSURE_LEDGER_EPOCH: "production_v1",
  };
}
