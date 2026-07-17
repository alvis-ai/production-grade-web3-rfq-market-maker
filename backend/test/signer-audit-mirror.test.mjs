import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { SignerAuditMirror } from "../dist/modules/signer/signer-audit-mirror.js";

const streamKey = "rfq:{signer-audit}:events:v1";
const event = {
  quoteId: "q_audit_mirror_1",
  snapshotId: "snapshot_audit_mirror_1",
  riskDecisionId: "rd_q_audit_mirror_1",
  riskPolicyVersion: "risk-v1",
  traceId: "tr_audit_mirror_1",
  quoteDigest: `0x${"11".repeat(32)}`,
  signatureHash: `0x${"22".repeat(32)}`,
  signerAddress: "0x0000000000000000000000000000000000000005",
  settlementAddress: "0x0000000000000000000000000000000000000004",
  chainId: 1,
  deadline: 1_700_000_030,
  outcome: "success",
  occurredAt: "2023-11-14T22:13:20.000Z",
};

test("SignerAuditMirror persists before atomic acknowledgement and deletion", async () => {
  const order = [];
  const observations = [];
  const client = fakeClient({ newEntries: [streamEntry("1700000000000-1", event)] }, order);
  const sink = fakeSink(true, order);
  const mirror = new SignerAuditMirror(client, sink, config(), {
    recordMirrored(observation) { observations.push(observation); },
    recordMirrorError() {},
  });

  assert.equal(await mirror.runOnce(), 1);
  assert.deepEqual(order, ["group", "sink:test_v1:1700000000000-1", "ack:1700000000000-1"]);
  assert.deepEqual(observations, [{ sourceStreamId: "test_v1:1700000000000-1", inserted: true }]);
  assert.equal(client.evalCalls[0].args[0], streamKey);
  assert.deepEqual(client.evalCalls[0].args.slice(1), ["rfq_signer_audit_pg_v1", "1700000000000-1"]);
});

test("SignerAuditMirror reclaims stale entries and treats PostgreSQL conflict as an idempotent replay", async () => {
  const order = [];
  const client = fakeClient({ claimedEntries: [streamEntry("1700000000000-2", event)] }, order);
  const observations = [];
  const mirror = new SignerAuditMirror(client, fakeSink(false, order), config(), {
    recordMirrored(observation) { observations.push(observation); },
    recordMirrorError() {},
  });

  assert.equal(await mirror.runOnce(), 1);
  assert.equal(client.commands.some(([command]) => command === "XREADGROUP"), false);
  assert.deepEqual(observations, [{ sourceStreamId: "test_v1:1700000000000-2", inserted: false }]);
});

test("SignerAuditMirror leaves corrupt or unpersisted entries pending", async () => {
  const payload = JSON.stringify(event);
  const corrupt = ["1700000000000-3", [
    "schema_version", "1",
    "event_key", "00".repeat(32),
    "payload", payload,
  ]];
  const corruptClient = fakeClient({ newEntries: [corrupt] });
  const corruptMirror = new SignerAuditMirror(corruptClient, fakeSink(true), config());
  await assert.rejects(corruptMirror.runOnce(), /integrity check failed/);
  assert.equal(corruptClient.evalCalls.length, 0);

  const failingClient = fakeClient({ newEntries: [streamEntry("1700000000000-4", event)] });
  const failingMirror = new SignerAuditMirror(failingClient, {
    async checkHealth() {},
    async appendMirrored() { throw new Error("postgres unavailable"); },
  }, config());
  await assert.rejects(failingMirror.runOnce(), /postgres unavailable/);
  assert.equal(failingClient.evalCalls.length, 0);
});

test("SignerAuditMirror logs only a bounded code for background failures", async () => {
  const logs = [];
  const mirror = new SignerAuditMirror(
    fakeClient({ newEntries: [streamEntry("1700000000000-5", event)] }),
    {
      async checkHealth() {},
      async appendMirrored() { throw new Error("postgres://secret@audit.internal unavailable"); },
    },
    config(),
    undefined,
    { warn(fields, message) { logs.push({ fields, message }); } },
  );

  await mirror.start();
  await new Promise((resolve) => setTimeout(resolve, 15));
  await mirror.stop();

  assert.ok(logs.length > 0);
  assert.deepEqual(logs[0], {
    fields: { code: "SIGNER_AUDIT_MIRROR_FAILED" },
    message: "signer audit mirror cycle failed",
  });
  assert.doesNotMatch(JSON.stringify(logs), /secret|audit\.internal/);
});

test("SignerAuditMirror validates config and closes its dedicated consumer", async () => {
  assert.throws(() => new SignerAuditMirror({}, fakeSink(true), config()), /client\.call/);
  assert.throws(
    () => new SignerAuditMirror(fakeClient(), fakeSink(true), config({ consumer: "bad consumer" })),
    /consumer/,
  );
  const client = fakeClient();
  const mirror = new SignerAuditMirror(client, fakeSink(true), config());
  await mirror.initialize();
  await mirror.close();
  assert.equal(client.quitCalls, 1);
});

function config(overrides = {}) {
  return {
    streamKey,
    sourceEpoch: "test_v1",
    group: "rfq_signer_audit_pg_v1",
    consumer: "signer_test_1",
    batchSize: 10,
    blockMs: 0,
    claimIdleMs: 1_000,
    retryDelayMs: 10,
    ...overrides,
  };
}

function streamEntry(id, value) {
  const payload = JSON.stringify(value);
  const eventKey = createHash("sha256").update(payload).digest("hex");
  return [id, ["schema_version", "1", "event_key", eventKey, "payload", payload]];
}

function fakeSink(inserted, order = []) {
  return {
    async checkHealth() {},
    async appendMirrored(_event, sourceStreamId) {
      order.push(`sink:${sourceStreamId}`);
      return inserted;
    },
  };
}

function fakeClient(options = {}, order = []) {
  return {
    status: "ready",
    commands: [],
    evalCalls: [],
    quitCalls: 0,
    async call(command, ...args) {
      this.commands.push([command, ...args]);
      if (command === "XGROUP") {
        order.push("group");
        return "OK";
      }
      if (command === "XAUTOCLAIM") return ["0-0", options.claimedEntries ?? []];
      if (command === "XREADGROUP") {
        return options.newEntries?.length ? [[streamKey, options.newEntries]] : null;
      }
      throw new Error(`unexpected command ${command}`);
    },
    async eval(_script, _numberOfKeys, ...args) {
      this.evalCalls.push({ args });
      order.push(`ack:${args[2]}`);
      return options.acknowledged ?? 1;
    },
    async quit() { this.quitCalls += 1; },
  };
}
