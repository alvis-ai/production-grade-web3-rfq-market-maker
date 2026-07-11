import assert from "node:assert/strict";
import test from "node:test";
import { AnalyticsOutboxPublisher } from "../dist/modules/analytics/analytics-outbox.publisher.js";

const baseRecord = {
  outboxId: "1",
  topic: "rfq.analytics.v1",
  eventKey: "q_analytics",
  eventType: "quote.lifecycle.v1",
  schemaVersion: 1,
  aggregateType: "quote",
  aggregateId: "q_analytics",
  payload: { quoteId: "q_analytics" },
  attemptCount: 1,
  createdAt: "2026-07-11T00:00:00.000Z",
};
const config = {
  workerId: "analytics_worker_1",
  leaseMs: 120000,
  batchSize: 10,
  pollIntervalMs: 10,
  retryDelayMs: 1000,
  retentionMs: 604800000,
  cleanupIntervalMs: 3600000,
  cleanupBatchSize: 1000,
};

test("AnalyticsOutboxPublisher marks acknowledged messages published", async () => {
  const store = fakeStore([baseRecord]);
  const sent = [];
  const publisher = fakePublisher(async (record) => sent.push(record.outboxId));
  const worker = new AnalyticsOutboxPublisher(store, publisher, config);

  assert.deepEqual(await worker.runOnce(), { claimed: 1, published: 1, retried: 0 });
  assert.deepEqual(sent, ["1"]);
  assert.deepEqual(store.calls.markPublished[0], ["1", "analytics_worker_1"]);
});

test("AnalyticsOutboxPublisher retains failed sends with bounded exponential backoff", async () => {
  const store = fakeStore([{ ...baseRecord, attemptCount: 20 }]);
  const publisher = fakePublisher(async () => { throw new Error("broker unavailable"); });
  const worker = new AnalyticsOutboxPublisher(store, publisher, config);

  assert.deepEqual(await worker.runOnce(), { claimed: 1, published: 0, retried: 1 });
  assert.deepEqual(store.calls.releaseForRetry[0], [
    "1",
    "analytics_worker_1",
    "ANALYTICS_PUBLISH_FAILED",
    60000,
  ]);
});

test("AnalyticsOutboxPublisher processes later records after one send failure", async () => {
  const store = fakeStore([baseRecord, { ...baseRecord, outboxId: "2" }]);
  const publisher = fakePublisher(async (record) => {
    if (record.outboxId === "1") throw new Error("first failed");
  });
  const worker = new AnalyticsOutboxPublisher(store, publisher, config);

  assert.deepEqual(await worker.runOnce(), { claimed: 2, published: 1, retried: 1 });
  assert.deepEqual(store.calls.markPublished[0], ["2", "analytics_worker_1"]);
});

test("AnalyticsOutboxPublisher deletes only records older than retention", async () => {
  const store = fakeStore([]);
  store.deletePublishedBefore = async (...args) => {
    store.calls.deletePublishedBefore.push(args);
    return 3;
  };
  const worker = new AnalyticsOutboxPublisher(store, fakePublisher(async () => {}), config);

  assert.equal(await worker.cleanupOnce(Date.parse("2026-07-11T00:00:00.000Z")), 3);
  assert.deepEqual(store.calls.deletePublishedBefore[0], ["2026-07-04T00:00:00.000Z", 1000]);
});

test("AnalyticsOutboxPublisher stop wakes a long polling delay", async () => {
  const worker = new AnalyticsOutboxPublisher(
    fakeStore([]),
    fakePublisher(async () => {}),
    { ...config, pollIntervalMs: 60000 },
  );
  const runTask = worker.run();
  await new Promise((resolve) => setImmediate(resolve));

  worker.stop();

  await withTimeout(runTask, 250);
});

function fakeStore(records) {
  const calls = { markPublished: [], releaseForRetry: [], deletePublishedBefore: [] };
  return {
    calls,
    async checkHealth() {},
    async claimBatch() { return records; },
    async markPublished(...args) { calls.markPublished.push(args); },
    async releaseForRetry(...args) { calls.releaseForRetry.push(args); },
    async stats() { return { pendingCount: records.length }; },
    async deletePublishedBefore() { return 0; },
  };
}

function fakePublisher(publish) {
  return {
    async connect() {},
    async disconnect() {},
    publish,
    isConnected() { return true; },
  };
}

async function withTimeout(promise, timeoutMs) {
  let timer;
  try {
    await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("publisher did not stop promptly")), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
