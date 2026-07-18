import assert from "node:assert/strict";
import test from "node:test";
import { QuoteIssuanceJournalMirror } from "../dist/modules/quote/quote-issuance-journal.mirror.js";

const streamKey = "rfq:{quote-issuance}:ledger:events";
const projectedKeyPrefix = "rfq:{quote-issuance}:ledger:projected";

test("QuoteIssuanceJournalMirror projects and marks visibility before acknowledging", async () => {
  const order = [];
  const event = preparedEvent();
  const sink = {
    async checkHealth() { order.push("health"); },
    async applyMirrored(value, sourceStreamId) {
      order.push(`persist:${value.eventType}:${sourceStreamId}`);
      return { inserted: true, applied: true };
    },
  };
  const mirror = new QuoteIssuanceJournalMirror(
    streamClient(order, streamEntry(event)),
    sink,
    config(),
  );

  assert.equal(await mirror.runOnce(), 1);
  assert.deepEqual(order, [
    "group",
    "claim",
    "read",
    "persist:prepared:epoch_v1:1700000000000-0",
    "project:prepared",
    "ack",
  ]);
});

test("QuoteIssuanceJournalMirror retains an event when PostgreSQL projection fails", async () => {
  const order = [];
  const sink = {
    async checkHealth() {},
    async applyMirrored() {
      order.push("persist");
      throw new Error("postgres unavailable");
    },
  };
  const mirror = new QuoteIssuanceJournalMirror(
    streamClient(order, streamEntry(preparedEvent())),
    sink,
    config(),
  );

  await assert.rejects(mirror.runOnce(), /postgres unavailable/);
  assert.equal(order.includes("project:prepared"), false);
  assert.equal(order.includes("ack"), false);
});

function config() {
  return {
    streamKey,
    projectedKeyPrefix,
    projectionTtlMs: 60_000,
    sourceEpoch: "epoch_v1",
    group: "quote_issuance_pg_v1",
    consumer: "gateway_test",
    batchSize: 10,
    blockMs: 0,
    claimIdleMs: 1_000,
    retryDelayMs: 10,
  };
}

function streamClient(order, entry) {
  return {
    async call(command) {
      if (command === "XGROUP") {
        order.push("group");
        return "OK";
      }
      if (command === "XAUTOCLAIM") {
        order.push("claim");
        return ["0-0", []];
      }
      if (command === "XREADGROUP") {
        order.push("read");
        return [[streamKey, [entry]]];
      }
      throw new Error(`unexpected command ${command}`);
    },
    async eval(script, _keys, _key, value) {
      if (script.includes("local ranks")) {
        order.push(`project:${value}`);
        return value;
      }
      order.push("ack");
      return [1, 0];
    },
    async quit() { return "OK"; },
  };
}

function streamEntry(event) {
  return [
    "1700000000000-0",
    [
      "schema_version", "1",
      "event_type", event.eventType,
      "payload", JSON.stringify(event),
    ],
  ];
}

function preparedEvent() {
  const request = {
    chainId: 1,
    user: "0x0000000000000000000000000000000000000033",
    tokenIn: "0x0000000000000000000000000000000000000011",
    tokenOut: "0x0000000000000000000000000000000000000022",
    amountIn: "1000000000000000000",
    slippageBps: 50,
  };
  const quoteId = "q_journal_mirror";
  const principalId = "principal_journal_mirror";
  const snapshotId = "snapshot_journal_mirror";
  const quote = {
    schemaVersion: 1,
    quoteId,
    principalId,
    stage: "prepared",
    preparationHash: "a".repeat(64),
    preparation: {
      marketSnapshot: {
        request,
        snapshot: {
          snapshotId,
          midPrice: "1.0",
          liquidityUsd: "10000000",
          marketSpreadBps: 10,
          volatilityBps: 20,
          observedAt: "2026-07-18T00:00:00.000Z",
        },
        source: "journal-test-v1",
      },
      requestedQuote: { quoteId, principalId, request, snapshotId },
      routeDecision: {
        quoteId,
        principalId,
        snapshotId,
        routePlan: {
          routeId: "route_journal",
          venue: "internal_inventory",
          tokenIn: request.tokenIn,
          tokenOut: request.tokenOut,
          expectedLiquidityUsd: "10000000",
        },
      },
    },
    preparedAtMs: 1_900_000_000_000,
    updatedAtMs: 1_900_000_000_000,
  };
  return {
    schemaVersion: 1,
    eventType: "prepared",
    occurredAtMs: 1_900_000_000_000,
    quote,
  };
}
