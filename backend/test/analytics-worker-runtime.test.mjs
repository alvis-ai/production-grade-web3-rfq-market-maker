import assert from "node:assert/strict";
import test from "node:test";
import { readAnalyticsWorkerRuntimeConfig } from "../dist/analytics-worker-main.js";

const baseEnv = {
  DATABASE_URL: "postgres://rfq:rfq@postgres:5432/rfq_market_maker",
  RFQ_ANALYTICS_KAFKA_BROKERS: "redpanda-0:9092,redpanda-1:9092",
  RFQ_CLICKHOUSE_URL: "http://clickhouse:8123",
};

test("analytics worker runtime parses durable local defaults", () => {
  const config = readAnalyticsWorkerRuntimeConfig(baseEnv);
  assert.deepEqual(config.kafka.brokers, ["redpanda-0:9092", "redpanda-1:9092"]);
  assert.equal(config.consumer.topic, "rfq.analytics.v1");
  assert.equal(config.publisher.leaseMs, 120000);
  assert.equal(config.publisher.retentionMs, 604800000);
  assert.equal(config.clickhouse.table, "rfq_analytics_events");
  assert.match(config.publisher.workerId, /^analytics_worker_[a-f0-9]{16}$/);
});

test("analytics worker runtime preserves secret bytes and validates SASL pairs", () => {
  const config = readAnalyticsWorkerRuntimeConfig({
    ...baseEnv,
    RFQ_ANALYTICS_KAFKA_SSL: "true",
    RFQ_ANALYTICS_KAFKA_SASL_MECHANISM: "scram-sha-256",
    RFQ_ANALYTICS_KAFKA_SASL_USERNAME: "analytics-user",
    RFQ_ANALYTICS_KAFKA_SASL_PASSWORD: " secret with spaces ",
    RFQ_CLICKHOUSE_PASSWORD: " clickhouse secret ",
  });
  assert.equal(config.kafka.ssl, true);
  assert.equal(config.kafka.sasl.password, " secret with spaces ");
  assert.equal(config.clickhouse.password, " clickhouse secret ");

  assert.throws(
    () => readAnalyticsWorkerRuntimeConfig({ ...baseEnv, RFQ_ANALYTICS_KAFKA_SASL_MECHANISM: "plain" }),
    /username and password are required together/,
  );
});

test("analytics worker requires authenticated TLS dependencies in production", () => {
  const productionEnv = {
    ...baseEnv,
    NODE_ENV: "production",
    DATABASE_URL: "postgres://analytics:secret@db.example.com/rfq?sslmode=verify-full",
    RFQ_ANALYTICS_KAFKA_SSL: "true",
    RFQ_ANALYTICS_KAFKA_SASL_MECHANISM: "scram-sha-256",
    RFQ_ANALYTICS_KAFKA_SASL_USERNAME: "analytics-user",
    RFQ_ANALYTICS_KAFKA_SASL_PASSWORD: "analytics-secret",
    RFQ_CLICKHOUSE_URL: "https://clickhouse.example.com:8443",
  };
  assert.doesNotThrow(() => readAnalyticsWorkerRuntimeConfig(productionEnv));
  assert.throws(
    () => readAnalyticsWorkerRuntimeConfig({ ...productionEnv, DATABASE_URL: baseEnv.DATABASE_URL }),
    /sslmode=verify-full/,
  );
  assert.throws(
    () => readAnalyticsWorkerRuntimeConfig({ ...productionEnv, RFQ_ANALYTICS_KAFKA_SSL: "false" }),
    /KAFKA_SSL must be true/,
  );
  assert.throws(
    () => readAnalyticsWorkerRuntimeConfig({
      ...productionEnv,
      RFQ_ANALYTICS_KAFKA_SASL_MECHANISM: undefined,
      RFQ_ANALYTICS_KAFKA_SASL_USERNAME: undefined,
      RFQ_ANALYTICS_KAFKA_SASL_PASSWORD: undefined,
    }),
    /SASL credentials are required/,
  );
  assert.throws(
    () => readAnalyticsWorkerRuntimeConfig({ ...productionEnv, RFQ_CLICKHOUSE_URL: baseEnv.RFQ_CLICKHOUSE_URL }),
    /must use https:\/\//,
  );
});

test("analytics worker runtime rejects unsafe endpoints, topics, placeholders, and short leases", () => {
  assert.throws(
    () => readAnalyticsWorkerRuntimeConfig({ ...baseEnv, RFQ_ANALYTICS_KAFKA_BROKERS: "http://redpanda:9092" }),
    /host:port/,
  );
  assert.throws(
    () => readAnalyticsWorkerRuntimeConfig({ ...baseEnv, RFQ_ANALYTICS_KAFKA_TOPIC: "other-topic" }),
    /must be rfq\.analytics\.v1/,
  );
  assert.throws(
    () => readAnalyticsWorkerRuntimeConfig({
      ...baseEnv,
      RFQ_ANALYTICS_BATCH_SIZE: "10",
      RFQ_ANALYTICS_KAFKA_REQUEST_TIMEOUT_MS: "10000",
      RFQ_ANALYTICS_LEASE_MS: "100000",
    }),
    /must exceed batch size/,
  );
  assert.throws(
    () => readAnalyticsWorkerRuntimeConfig({ ...baseEnv, RFQ_CLICKHOUSE_PASSWORD: "replace-with-clickhouse-password" }),
    /placeholder must be replaced/,
  );
});
