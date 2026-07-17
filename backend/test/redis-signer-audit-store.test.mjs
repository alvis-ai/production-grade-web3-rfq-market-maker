import assert from "node:assert/strict";
import test from "node:test";
import { RedisSignerAuditStore } from "../dist/modules/signer/redis-signer-audit.store.js";

const event = {
  quoteId: "q_audit_stream_1",
  snapshotId: "snapshot_audit_stream_1",
  riskDecisionId: "rd_q_audit_stream_1",
  riskPolicyVersion: "risk-v1",
  traceId: "tr_audit_stream_1",
  quoteDigest: `0x${"11".repeat(32)}`,
  signatureHash: `0x${"22".repeat(32)}`,
  signerAddress: "0x0000000000000000000000000000000000000005",
  settlementAddress: "0x0000000000000000000000000000000000000004",
  chainId: 1,
  deadline: 1_700_000_030,
  outcome: "success",
  occurredAt: "2023-11-14T22:13:20.000Z",
};

test("RedisSignerAuditStore appends bounded, deduplicated events and requires replica acknowledgement", async () => {
  const observations = [];
  const client = fakeClient({ appendResult: [1, "1700000000000-1", 7, 0], replicas: 2 });
  const store = new RedisSignerAuditStore(client, config(), {
    recordAppend(observation) { observations.push(["append", observation]); },
    recordAppendFailure(reason) { observations.push(["failure", reason]); },
    recordBacklog(backlog) { observations.push(["backlog", backlog]); },
  });

  await store.append(event);
  await store.checkHealth();
  await store.close();

  assert.equal(client.evals.length, 1);
  assert.equal(client.evals[0].numberOfKeys, 2);
  assert.equal(client.evals[0].args[0], "rfq:{signer-audit}:events:v1");
  assert.match(client.evals[0].args[1], /^rfq:\{signer-audit\}:events:v1:dedupe:[0-9a-f]{64}$/);
  assert.equal(client.evals[0].args[2], 100);
  assert.equal(JSON.parse(client.evals[0].args[4]).quoteId, event.quoteId);
  assert.deepEqual(client.waits, [[1, 25]]);
  assert.deepEqual(observations, [
    ["append", { backlog: 7, duplicate: false }],
    ["backlog", 4],
  ]);
  assert.equal(client.quitCalls, 1);
});

test("RedisSignerAuditStore fails closed on a full backlog, missing replicas, or unhealthy AOF", async () => {
  const failures = [];
  const observer = {
    recordAppend() {},
    recordAppendFailure(reason) { failures.push(reason); },
    recordBacklog() {},
  };
  const full = new RedisSignerAuditStore(
    fakeClient({ appendResult: [0, "", 100, 0] }),
    config({ minReplicaAcks: 0 }),
    observer,
  );
  await assert.rejects(full.append(event), /backlog reached/);

  const unreplicated = new RedisSignerAuditStore(
    fakeClient({ appendResult: [1, "1700000000000-2", 1, 0], replicas: 0 }),
    config(),
    observer,
  );
  await assert.rejects(unreplicated.append(event), /required replicas/);

  const noAof = new RedisSignerAuditStore(
    fakeClient({ info: "aof_enabled:0\r\naof_last_write_status:ok\r\n" }),
    config({ minReplicaAcks: 0 }),
  );
  await assert.rejects(noAof.checkHealth(), /requires healthy AOF/);
  assert.deepEqual(failures, ["backlog_full", "replica_ack"]);
});

test("RedisSignerAuditStore validates clients, config, and script results", async () => {
  assert.throws(() => new RedisSignerAuditStore({}, config()), /client\.eval/);
  assert.throws(
    () => new RedisSignerAuditStore(fakeClient(), config({ streamKey: "rfq:unsafe:events" })),
    /streamKey/,
  );
  const malformed = new RedisSignerAuditStore(
    fakeClient({ appendResult: [1, "bad", 1, 0] }),
    config({ minReplicaAcks: 0 }),
  );
  await assert.rejects(malformed.append(event), /invalid values/);
});

function config(overrides = {}) {
  return {
    streamKey: "rfq:{signer-audit}:events:v1",
    maxBacklog: 100,
    dedupeTtlMs: 60_000,
    minReplicaAcks: 1,
    replicaAckTimeoutMs: 25,
    requireAof: true,
    ...overrides,
  };
}

function fakeClient(overrides = {}) {
  return {
    status: "ready",
    evals: [],
    waits: [],
    quitCalls: 0,
    async eval(_script, numberOfKeys, ...args) {
      this.evals.push({ numberOfKeys, args });
      return overrides.appendResult ?? [1, "1700000000000-1", 1, 0];
    },
    async ping() { return "PONG"; },
    async info() { return overrides.info ?? "aof_enabled:1\r\naof_last_write_status:ok\r\n"; },
    async xlen() { return overrides.backlog ?? 4; },
    async wait(replicas, timeoutMs) {
      this.waits.push([replicas, timeoutMs]);
      return overrides.replicas ?? replicas;
    },
    async quit() { this.quitCalls += 1; },
  };
}
