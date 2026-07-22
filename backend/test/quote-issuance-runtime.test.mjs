import assert from "node:assert/strict";
import test from "node:test";
import { readQuoteIssuanceRuntimeConfig } from "../dist/runtime/gateway-quote-issuance.js";

test("quote issuance runtime defaults local development to PostgreSQL", () => {
  const config = readQuoteIssuanceRuntimeConfig({ NODE_ENV: "development" }, 60_000);
  assert.equal(config.backend, "postgres");
  assert.equal(config.leaseMs, 60_000);
});

test("quote issuance runtime requires durable Redis policy in production", () => {
  const config = readQuoteIssuanceRuntimeConfig({
    NODE_ENV: "production",
    RFQ_REDIS_URL: "rediss://redis.example.com:6380/0",
    RFQ_QUOTE_ISSUANCE_LEDGER_EPOCH: "production_v1",
    RFQ_QUOTE_ISSUANCE_ALLOW_EPOCH_INITIALIZATION: "false",
    RFQ_QUOTE_ISSUANCE_REQUIRE_AOF: "true",
    RFQ_QUOTE_ISSUANCE_MIN_REPLICA_ACKS: "1",
  }, 60_000);
  assert.equal(config.backend, "redis-stream");
  assert.equal(config.requireTls, true);
  assert.equal(config.keyPrefix, "rfq:{quote-state}:issuance");
  assert.equal(config.allowEpochInitialization, false);
  assert.equal(config.minReplicaAcks, 1);
});

test("quote issuance runtime rejects PostgreSQL and weak durability in production", () => {
  assert.throws(() => readQuoteIssuanceRuntimeConfig({
    NODE_ENV: "production",
    RFQ_QUOTE_ISSUANCE_BACKEND: "postgres",
  }), /must be redis-stream/);
  assert.throws(() => readQuoteIssuanceRuntimeConfig({
    NODE_ENV: "production",
    RFQ_REDIS_URL: "rediss://redis.example.com:6380/0",
    RFQ_QUOTE_ISSUANCE_LEDGER_EPOCH: "production_v1",
    RFQ_QUOTE_ISSUANCE_MIN_REPLICA_ACKS: "0",
  }), /must be at least 1/);
});
