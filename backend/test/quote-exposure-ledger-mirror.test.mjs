import assert from "node:assert/strict";
import test from "node:test";
import { QuoteExposureLedgerMirror } from "../dist/modules/risk/quote-exposure-ledger.mirror.js";

const streamKey = "rfq:{quote-exposure}:ledger:events";

test("QuoteExposureLedgerMirror persists before acknowledging and cleans expired projections", async () => {
  const order = [];
  const sink = {
    async checkHealth() { order.push("health"); },
    async applyMirrored(operation, record, sourceStreamId) {
      order.push(`persist:${operation}:${sourceStreamId}:${record.quoteId}`);
      return { inserted: true, applied: true };
    },
    async deleteExpired(limit) {
      order.push(`cleanup:${limit}`);
      return 0;
    },
  };
  const client = streamClient(order, streamEntry());
  const observations = [];
  const mirror = new QuoteExposureLedgerMirror(client, sink, config(), {
    recordLedgerMirrored(value) { observations.push(value); },
    recordLedgerMirrorError() {},
    recordLedgerBacklog(value) { observations.push({ backlog: value }); },
  }, undefined, () => 10_000, {
    async awaitPreparedQuoteProjection(quoteId) { order.push(`barrier:${quoteId}`); },
  });

  assert.equal(await mirror.runOnce(), 1);
  assert.deepEqual(order, [
    "group",
    "claim",
    "read",
    "barrier:q_mirror",
    "persist:reserve:epoch_v1:1700000000000-0:q_mirror",
    "ack",
    "cleanup:25",
  ]);
  assert.deepEqual(observations, [{ backlog: 0 }, {
    sourceStreamId: "epoch_v1:1700000000000-0",
    operation: "reserve",
    inserted: true,
    applied: true,
  }]);
});

test("QuoteExposureLedgerMirror throttles cleanup and retains failed health until PostgreSQL recovers", async () => {
  let nowMilliseconds = 10_000;
  let cleanupCalls = 0;
  let failCleanup = false;
  const sink = {
    async checkHealth() {},
    async applyMirrored() { return { inserted: true, applied: true }; },
    async deleteExpired() {
      cleanupCalls += 1;
      if (failCleanup) throw new Error("postgres unavailable");
      return 0;
    },
  };
  const mirror = new QuoteExposureLedgerMirror(
    streamClient([], undefined),
    sink,
    config(),
    undefined,
    undefined,
    () => nowMilliseconds,
  );

  await mirror.initialize();
  mirror.assertHealthy();
  assert.equal(await mirror.runOnce(), 0);
  assert.equal(await mirror.runOnce(), 0);
  assert.equal(cleanupCalls, 1, "idle polling must not query PostgreSQL every cycle");

  nowMilliseconds += 1_000;
  failCleanup = true;
  await assert.rejects(mirror.runOnce(), /postgres unavailable/);
  assert.throws(() => mirror.assertHealthy(), /mirror is unhealthy/);

  failCleanup = false;
  assert.equal(await mirror.runOnce(), 0);
  assert.throws(() => mirror.assertHealthy(), /mirror is unhealthy/);
  nowMilliseconds += 1_000;
  assert.equal(await mirror.runOnce(), 0);
  mirror.assertHealthy();
});

test("QuoteExposureLedgerMirror never acknowledges a failed PostgreSQL projection", async () => {
  const order = [];
  const sink = {
    async checkHealth() {},
    async applyMirrored() {
      order.push("persist");
      throw new Error("postgres unavailable");
    },
    async deleteExpired() { return 0; },
  };
  const mirror = new QuoteExposureLedgerMirror(streamClient(order, streamEntry()), sink, config());

  await assert.rejects(mirror.runOnce(), /postgres unavailable/);
  assert.deepEqual(order.filter((value) => value === "ack"), []);
});

function config() {
  return {
    streamKey,
    sourceEpoch: "epoch_v1",
    group: "quote_exposure_pg_v1",
    consumer: "gateway_test",
    batchSize: 10,
    blockMs: 0,
    claimIdleMs: 1_000,
    retryDelayMs: 10,
    cleanupLimit: 25,
    cleanupIntervalMs: 1_000,
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
        return entry ? [[streamKey, [entry]]] : null;
      }
      throw new Error(`unexpected command ${command}`);
    },
    async eval() {
      order.push("ack");
      return [1, 0];
    },
    async quit() { return "OK"; },
  };
}

function streamEntry() {
  const record = {
    schemaVersion: 1,
    quoteId: "q_mirror",
    chainId: 1,
    user: "0x00000000000000000000000000000000000000aa",
    tokenLow: "0x0000000000000000000000000000000000000011",
    tokenHigh: "0x0000000000000000000000000000000000000022",
    tokenIn: "0x0000000000000000000000000000000000000011",
    amountIn: "1",
    tokenOut: "0x0000000000000000000000000000000000000022",
    amountOut: "1",
    notionalUsdE18: "1",
    deadline: 1_900_000_000,
    ledgerExpiresAt: 1_900_000_002,
  };
  return [
    "1700000000000-0",
    ["schema_version", "1", "operation", "reserve", "payload", JSON.stringify(record)],
  ];
}
