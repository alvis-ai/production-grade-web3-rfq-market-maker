import assert from "node:assert/strict";
import test from "node:test";
import { KafkaAnalyticsProducer } from "../dist/modules/analytics/kafka-analytics.producer.js";

const config = {
  brokers: ["redpanda:9092"],
  clientId: "rfq-analytics",
  ssl: false,
  connectionTimeoutMs: 1000,
  requestTimeoutMs: 5000,
};
const record = {
  outboxId: "9",
  topic: "rfq.analytics.v1",
  eventKey: "q_analytics",
  eventType: "quote.lifecycle.v1",
  schemaVersion: 1,
  aggregateType: "quote",
  aggregateId: "q_analytics",
  payload: { quoteId: "q_analytics", amountIn: "1000" },
  attemptCount: 1,
  createdAt: "2026-07-11T00:00:00.000Z",
};

test("KafkaAnalyticsProducer sends keyed, acknowledged, versioned envelopes", async () => {
  const calls = [];
  const dependency = {
    async connect() { calls.push("connect"); },
    async disconnect() { calls.push("disconnect"); },
    async send(input) { calls.push(input); },
  };
  const producer = new KafkaAnalyticsProducer(config, dependency);

  await assert.rejects(producer.publish(record), /not connected/);
  await producer.connect();
  await producer.publish(record);
  await producer.disconnect();

  const send = calls[1];
  assert.equal(send.acks, -1);
  assert.equal(send.topic, "rfq.analytics.v1");
  assert.equal(send.messages[0].key, "q_analytics");
  assert.equal(send.messages[0].headers["event-id"], "ao_9");
  assert.equal(JSON.parse(send.messages[0].value).data.amountIn, "1000");
  assert.equal(producer.isConnected(), false);
});

test("KafkaAnalyticsProducer validates broker and SASL configuration", () => {
  const dependency = { async connect() {}, async disconnect() {}, async send() {} };
  assert.throws(() => new KafkaAnalyticsProducer({ ...config, brokers: ["http://redpanda:9092"] }, dependency), /host:port/);
  assert.throws(() => new KafkaAnalyticsProducer({ ...config, brokers: ["redpanda:70000"] }, dependency), /port/);
  assert.throws(
    () => new KafkaAnalyticsProducer({ ...config, sasl: { mechanism: "plain", username: "", password: "secret" } }, dependency),
    /username/,
  );
});
