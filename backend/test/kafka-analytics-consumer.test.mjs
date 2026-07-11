import assert from "node:assert/strict";
import test from "node:test";
import { KafkaAnalyticsConsumer } from "../dist/modules/analytics/kafka-analytics.consumer.js";

const config = {
  brokers: ["redpanda:9092"],
  clientId: "rfq-analytics",
  ssl: false,
  connectionTimeoutMs: 1000,
  requestTimeoutMs: 5000,
  topic: "rfq.analytics.v1",
  groupId: "rfq-clickhouse-v1",
  sessionTimeoutMs: 30000,
  heartbeatIntervalMs: 3000,
};
const envelope = {
  eventId: "ao_1",
  eventType: "quote.lifecycle.v1",
  schemaVersion: 1,
  aggregateType: "quote",
  aggregateId: "q_analytics",
  occurredAt: "2026-07-11T00:00:00.000Z",
  data: { quoteId: "q_analytics" },
};

test("KafkaAnalyticsConsumer commits offsets only after ClickHouse insertion", async () => {
  const order = [];
  const sink = fakeSink(async (rows) => {
    order.push("insert");
    assert.equal(rows[0].envelope.eventId, "ao_1");
  });
  const consumerDependency = fakeConsumer(order, kafkaMessage(envelope));
  const observer = { consumed: 0, errors: 0, recordConsumed(count) { this.consumed += count; }, recordConsumerError() { this.errors += 1; } };
  const consumer = new KafkaAnalyticsConsumer(config, sink, observer, consumerDependency);

  await consumer.connect();
  await consumer.run();

  assert.deepEqual(order, ["connect", "subscribe", "insert", "resolve:12", "commit:13", "heartbeat"]);
  assert.equal(consumer.isReady(), true);
  assert.equal(observer.consumed, 1);
  assert.equal(observer.errors, 0);
});

test("KafkaAnalyticsConsumer leaves offsets unresolved when ClickHouse fails", async () => {
  const order = [];
  const sink = fakeSink(async () => { order.push("insert"); throw new Error("clickhouse unavailable"); });
  const dependency = fakeConsumer(order, kafkaMessage(envelope));
  const observer = { errors: 0, recordConsumed() {}, recordConsumerError() { this.errors += 1; } };
  const consumer = new KafkaAnalyticsConsumer(config, sink, observer, dependency);

  await consumer.connect();
  await assert.rejects(consumer.run(), /clickhouse unavailable/);
  assert.equal(order.some((value) => value.startsWith("commit:")), false);
  assert.equal(observer.errors, 1);
});

test("KafkaAnalyticsConsumer chunks large Kafka batches before committing their offset", async () => {
  const order = [];
  const insertedBatchSizes = [];
  const messages = Array.from({ length: 501 }, (_, index) => kafkaMessage({
    ...envelope,
    eventId: `ao_${index + 1}`,
  }, String(index)));
  const sink = fakeSink(async (rows) => {
    order.push(`insert:${rows.length}`);
    insertedBatchSizes.push(rows.length);
  });
  const observer = { consumed: 0, recordConsumed(count) { this.consumed += count; }, recordConsumerError() {} };
  const consumer = new KafkaAnalyticsConsumer(config, sink, observer, fakeConsumer(order, messages));

  await consumer.connect();
  await consumer.run();

  assert.deepEqual(insertedBatchSizes, [500, 1]);
  assert.ok(order.indexOf("insert:1") < order.indexOf("commit:501"));
  assert.equal(order.filter((value) => value === "heartbeat").length, 2);
  assert.equal(observer.consumed, 501);
});

test("KafkaAnalyticsConsumer rejects mismatched keys and headers before insertion", async () => {
  const order = [];
  const message = kafkaMessage(envelope);
  message.key = Buffer.from("q_other");
  const consumer = new KafkaAnalyticsConsumer(config, fakeSink(async () => { throw new Error("must not insert"); }), undefined, fakeConsumer(order, message));
  await consumer.connect();
  await assert.rejects(consumer.run(), /key does not match/);
  assert.equal(order.includes("insert"), false);
});

test("KafkaAnalyticsConsumer exposes a non-restarting Kafka crash as fatal", async () => {
  const order = [];
  const dependency = fakeConsumer(order, kafkaMessage(envelope));
  let crashListener;
  dependency.events = { CRASH: "consumer.crash" };
  dependency.on = (_eventName, listener) => {
    crashListener = listener;
    return () => { order.push("remove-listener"); };
  };
  const observer = { errors: 0, recordConsumed() {}, recordConsumerError() { this.errors += 1; } };
  const consumer = new KafkaAnalyticsConsumer(config, fakeSink(async () => {}), observer, dependency);
  await consumer.connect();
  await consumer.run();

  crashListener({ payload: { error: new Error("fatal consumer crash"), restart: false } });

  await assert.rejects(consumer.waitForFatal(), /fatal consumer crash/);
  assert.equal(consumer.isReady(), false);
  assert.equal(observer.errors, 1);
});

function kafkaMessage(value, offset = "12") {
  return {
    key: Buffer.from(value.aggregateId),
    value: Buffer.from(JSON.stringify(value)),
    offset,
    headers: {
      "event-id": Buffer.from(value.eventId),
      "event-type": Buffer.from(value.eventType),
      "schema-version": Buffer.from(String(value.schemaVersion)),
    },
  };
}

function fakeSink(insertBatch) {
  return { async initialize() {}, async checkHealth() {}, insertBatch, async close() {} };
}

function fakeConsumer(order, messageOrMessages) {
  const messages = Array.isArray(messageOrMessages) ? messageOrMessages : [messageOrMessages];
  return {
    async connect() { order.push("connect"); },
    async disconnect() { order.push("disconnect"); },
    async subscribe() { order.push("subscribe"); },
    async run(input) {
      await input.eachBatch({
        batch: { topic: "rfq.analytics.v1", partition: 0, messages },
        resolveOffset(offset) { order.push(`resolve:${offset}`); },
        async heartbeat() { order.push("heartbeat"); },
        isRunning() { return true; },
        isStale() { return false; },
      });
    },
    async commitOffsets(offsets) { order.push(`commit:${offsets[0].offset}`); },
    async stop() { order.push("stop"); },
  };
}
