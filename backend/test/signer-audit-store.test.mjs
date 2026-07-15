import assert from "node:assert/strict";
import test from "node:test";
import {
  InMemorySignerAuditStore,
  PostgresSignerAuditStore,
  assertSignerAuditEvent,
} from "../dist/modules/signer/signer-audit.store.js";

const event = {
  quoteId: "q_audit_1",
  snapshotId: "snapshot_audit_1",
  quoteDigest: `0x${"11".repeat(32)}`,
  signatureHash: `0x${"22".repeat(32)}`,
  signerAddress: "0x0000000000000000000000000000000000000005",
  settlementAddress: "0x0000000000000000000000000000000000000004",
  chainId: 1,
  deadline: 1_700_000_030,
  outcome: "success",
  occurredAt: "2023-11-14T22:13:20.000Z",
};

test("InMemorySignerAuditStore snapshots validated events defensively", async () => {
  const store = new InMemorySignerAuditStore();
  await store.append(event);
  const first = store.snapshot();
  assert.deepEqual(first, [event]);
  first[0].quoteId = "mutated";
  assert.equal(store.snapshot()[0].quoteId, event.quoteId);
  await store.checkHealth();
});

test("PostgresSignerAuditStore writes only bounded audit evidence and checks table readiness", async () => {
  const queries = [];
  const pool = {
    async query(config) {
      queries.push(config);
      if (config.text.startsWith("SELECT to_regclass")) return { rows: [{ table_name: "signer_audit_events" }] };
      return { rows: [], rowCount: 1 };
    },
  };
  const store = new PostgresSignerAuditStore(pool, 2_000);
  await store.append(event);
  await store.checkHealth();

  assert.match(queries[0].text, /INSERT INTO signer_audit_events/);
  assert.equal(queries[0].query_timeout, 2_000);
  assert.deepEqual(queries[0].values.slice(0, 2), [event.quoteId, event.snapshotId]);
  assert.deepEqual(queries[0].values[2], Buffer.from("11".repeat(32), "hex"));
  assert.deepEqual(queries[0].values[3], Buffer.from("22".repeat(32), "hex"));
  assert.equal(queries[1].query_timeout, 2_000);
});

test("PostgresSignerAuditStore fails readiness when the append-only table is absent", async () => {
  const store = new PostgresSignerAuditStore({
    async query() { return { rows: [{ table_name: null }] }; },
  }, 1_000);
  await assert.rejects(store.checkHealth(), /table is unavailable/);
  assert.throws(() => new PostgresSignerAuditStore({}, 1_000), /must expose query/);
  assert.throws(() => new PostgresSignerAuditStore({ query() {} }, 99), /queryTimeoutMs/);
});

test("signer audit validation rejects malformed or privacy-expanding event envelopes", () => {
  const invalid = [
    null,
    { ...event, user: "0x0000000000000000000000000000000000000001" },
    { ...event, quoteId: "bad id" },
    { ...event, quoteDigest: "0x11" },
    { ...event, signerAddress: "0x0000000000000000000000000000000000000000" },
    { ...event, chainId: 0 },
    { ...event, deadline: 1.5 },
    { ...event, outcome: "signer_error" },
    { ...event, outcome: "invalid" },
    { ...event, occurredAt: "2023-11-14T22:13:20Z" },
  ];
  for (const value of invalid) assert.throws(() => assertSignerAuditEvent(value));

  const { signatureHash: _signatureHash, ...failureEvent } = event;
  assert.doesNotThrow(() => assertSignerAuditEvent({
    ...failureEvent,
    outcome: "signer_error",
  }));
});
