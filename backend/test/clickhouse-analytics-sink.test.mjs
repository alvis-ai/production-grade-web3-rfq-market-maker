import assert from "node:assert/strict";
import test from "node:test";
import { ClickHouseAnalyticsSink } from "../dist/modules/analytics/clickhouse-analytics.sink.js";

const config = {
  url: "http://clickhouse:8123",
  username: "default",
  password: "",
  database: "default",
  table: "rfq_analytics_events",
  requestTimeoutMs: 5000,
};
const row = {
  envelope: {
    eventId: "ao_1",
    eventType: "quote.lifecycle.v1",
    schemaVersion: 1,
    aggregateType: "quote",
    aggregateId: "q_analytics",
    occurredAt: "2026-07-11T00:00:00.000Z",
    data: { quoteId: "q_analytics", amountIn: "1000" },
  },
  kafkaTopic: "rfq.analytics.v1",
  kafkaPartition: 0,
  kafkaOffset: "12",
};

test("ClickHouseAnalyticsSink creates a replacing projection and inserts Kafka metadata", async () => {
  const calls = [];
  const client = {
    async command(input) { calls.push({ command: input }); },
    async insert(input) { calls.push({ insert: input }); },
    async ping() { return { success: true }; },
    async close() { calls.push({ close: true }); },
  };
  const sink = new ClickHouseAnalyticsSink(config, client);

  await sink.initialize();
  await sink.checkHealth();
  await sink.insertBatch([row]);
  await sink.close();

  assert.match(calls[0].command.query, /ReplacingMergeTree\(ingested_at\)/);
  assert.match(calls[0].command.query, /ORDER BY event_id/);
  assert.equal(calls[1].insert.format, "JSONEachRow");
  assert.equal(calls[1].insert.values[0].event_id, "ao_1");
  assert.equal(calls[1].insert.values[0].occurred_at, "2026-07-11 00:00:00.000");
  assert.equal(calls[1].insert.values[0].kafka_offset, "12");
  assert.equal(JSON.parse(calls[1].insert.values[0].payload).amountIn, "1000");
});

test("ClickHouseAnalyticsSink fails health and malformed projection rows", async () => {
  const client = {
    async command() {},
    async insert() {},
    async ping() { return { success: false, error: new Error("denied") }; },
    async close() {},
  };
  const sink = new ClickHouseAnalyticsSink(config, client);
  await assert.rejects(sink.checkHealth(), /denied/);
  await assert.rejects(sink.insertBatch([]), /between 1 and 500/);
  await assert.rejects(sink.insertBatch([{ ...row, kafkaOffset: "01" }]), /kafkaOffset/);
});
