import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAnalyticsEventEnvelope,
  parseAnalyticsEvent,
  serializeAnalyticsEvent,
} from "../dist/modules/analytics/analytics-event.js";

const record = {
  outboxId: "42",
  topic: "rfq.analytics.v1",
  eventKey: "q_analytics",
  eventType: "quote.lifecycle.v1",
  schemaVersion: 1,
  aggregateType: "quote",
  aggregateId: "q_analytics",
  payload: { quoteId: "q_analytics", amountIn: "1000000000000000000", chainId: 1 },
  attemptCount: 1,
  createdAt: "2026-07-11T00:00:00.000Z",
};

test("analytics event envelope preserves large amounts as strings", () => {
  const envelope = buildAnalyticsEventEnvelope(record);
  assert.equal(envelope.eventId, "ao_42");
  assert.equal(envelope.data.amountIn, "1000000000000000000");
  assert.deepEqual(parseAnalyticsEvent(serializeAnalyticsEvent(envelope)), envelope);
});

test("analytics event parser rejects unknown fields, unsafe numbers, and oversized messages", () => {
  const valid = buildAnalyticsEventEnvelope(record);
  assert.throws(
    () => parseAnalyticsEvent(JSON.stringify({ ...valid, unexpected: true })),
    /fields are invalid/,
  );
  assert.throws(
    () => serializeAnalyticsEvent({ ...valid, data: { amount: Number.MAX_SAFE_INTEGER + 1 } }),
    /finite safe integers/,
  );
  assert.throws(() => parseAnalyticsEvent("x".repeat(1_048_577)), /1 MiB/);
  assert.throws(() => parseAnalyticsEvent(null), /value is required/);
});

test("analytics event builder rejects malformed outbox records", () => {
  assert.throws(() => buildAnalyticsEventEnvelope({ ...record, outboxId: "01" }), /positive decimal/);
  assert.throws(() => buildAnalyticsEventEnvelope({ ...record, eventType: "Quote.Created" }), /eventType/);
  assert.throws(() => buildAnalyticsEventEnvelope({ ...record, eventKey: "q_other" }), /must match aggregateId/);
  assert.throws(() => buildAnalyticsEventEnvelope({ ...record, payload: [] }), /JSON object/);
});
