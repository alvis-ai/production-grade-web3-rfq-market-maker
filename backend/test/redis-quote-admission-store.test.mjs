import assert from "node:assert/strict";
import test from "node:test";
import { RedisQuoteAdmissionStore } from "../dist/modules/quote/redis-quote-admission.store.js";
import { admitQuoteAtomicallyScript } from "../dist/modules/quote/redis-quote-admission.scripts.js";
import { resolveRedisQuoteAdmissionStore } from "../dist/runtime/gateway-quote-admission.js";

const durability = {
  keyPrefix: "rfq:{quote-state}:ledger",
  minReplicaAcks: 1,
  replicaAckTimeoutMs: 20,
  requireAof: true,
};

test("RedisQuoteAdmissionStore accepts one combined exposure and issuance mutation", async () => {
  const calls = [];
  const issuanceMutation = [1, JSON.stringify(riskRecord()), 1, "1-0"];
  const exposureStore = fakeExposureStore({
    async reserveWithCommit(input, extension) {
      calls.push(["reserve", input]);
      assert.equal(extension.command.source, admitQuoteAtomicallyScript);
      assert.deepEqual(extension.keys, ["quote", "idempotency", "events"]);
      extension.beforeExecute();
      extension.beforeExecute();
      const parsed = extension.parseResult([[1, "exposure", 1], issuanceMutation]);
      return {
        exposure: { status: "reserved", notionalUsdE18: "1" },
        extension: parsed.extension,
      };
    },
  });
  const issuanceStore = fakeIssuanceStore({
    async prepareAtomicAdmission(input) {
      calls.push(["prepare", input]);
      return preparedAdmission();
    },
    async acceptAtomicAdmission(prepared, result, acknowledge) {
      calls.push(["accept", prepared, result, acknowledge]);
      return riskRecord();
    },
  });
  const store = new RedisQuoteAdmissionStore(exposureStore, issuanceStore);

  let beforeCommitCalls = 0;
  const result = await store.admit(
    { exposure: { quoteId: "q_1" }, issuance: { authorization: {} } },
    () => { beforeCommitCalls += 1; },
  );

  assert.equal(result.exposure.status, "reserved");
  assert.equal(result.riskDecision.quoteId, "q_1");
  assert.deepEqual(calls.map(([name]) => name), ["prepare", "reserve", "accept"]);
  assert.equal(calls[2][3], false);
  assert.equal(beforeCommitCalls, 1);
});

test("RedisQuoteAdmissionStore returns exposure rejection without accepting issuance", async () => {
  let accepted = false;
  const store = new RedisQuoteAdmissionStore(
    fakeExposureStore({
      async reserveWithCommit() {
        return { exposure: { status: "rejected", reasonCode: "PAIR_OPEN_NOTIONAL_LIMIT_EXCEEDED" } };
      },
    }),
    fakeIssuanceStore({
      async acceptAtomicAdmission() { accepted = true; },
    }),
  );

  const result = await store.admit({ exposure: {}, issuance: {} });
  assert.deepEqual(result, {
    exposure: { status: "rejected", reasonCode: "PAIR_OPEN_NOTIONAL_LIMIT_EXCEEDED" },
  });
  assert.equal(accepted, false);
});

test("RedisQuoteAdmissionStore rejects issuance conflict before exposure retry", async () => {
  const store = new RedisQuoteAdmissionStore(
    fakeExposureStore({
      async reserveWithCommit(_input, extension) {
        extension.parseResult([
          [4, "issuance_conflict", 0],
          [0, "idempotency_ownership", 0, ""],
        ]);
        assert.fail("conflicting issuance must throw");
      },
    }),
    fakeIssuanceStore(),
  );

  await assert.rejects(
    store.admit({ exposure: {}, issuance: {} }),
    /issuance admission failed: idempotency_ownership/,
  );
});

test("RedisQuoteAdmissionStore rejects different slots and durability policies", () => {
  assert.throws(
    () => new RedisQuoteAdmissionStore(
      fakeExposureStore(),
      fakeIssuanceStore({ config: { ...durability, keyPrefix: "rfq:{other}:issuance" } }),
    ),
    /one Redis Cluster hash tag/,
  );
  assert.throws(
    () => new RedisQuoteAdmissionStore(
      fakeExposureStore(),
      fakeIssuanceStore({ config: { ...durability, minReplicaAcks: 2 } }),
    ),
    /durability policies must match/,
  );
});

test("quote admission runtime requires one Redis authority", () => {
  const issuance = {
    redisUrl: "redis://127.0.0.1:6379/0",
    redisStore: fakeIssuanceStore(),
  };
  const exposure = {
    redisUrl: "redis://127.0.0.1:6380/0",
    redisStore: fakeExposureStore(),
  };
  assert.throws(
    () => resolveRedisQuoteAdmissionStore(issuance, exposure),
    /requires one Redis authority/,
  );
  assert.equal(resolveRedisQuoteAdmissionStore(undefined, exposure), undefined);
  assert.ok(resolveRedisQuoteAdmissionStore(issuance, {
    ...exposure,
    redisUrl: "redis://127.0.0.1:6379/0",
  }) instanceof RedisQuoteAdmissionStore);
});

function fakeExposureStore(overrides = {}) {
  return {
    atomicAdmissionConfig() { return durability; },
    async reserveWithCommit() { assert.fail("reserveWithCommit override is required"); },
    ...overrides,
  };
}

function fakeIssuanceStore(overrides = {}) {
  const config = overrides.config ?? durability;
  return {
    atomicAdmissionConfig() { return config; },
    async prepareAtomicAdmission() { return preparedAdmission(); },
    async acceptAtomicAdmission() { return riskRecord(); },
    ...overrides,
  };
}

function preparedAdmission() {
  return {
    keys: ["quote", "idempotency", "events"],
    arguments: Array.from({ length: 12 }, (_, index) => String(index)),
    riskInput: { quoteId: "q_1", decision: { status: "approved", policyVersion: "v1" } },
  };
}

function riskRecord() {
  return {
    riskDecisionId: "rd_q_1",
    quoteId: "q_1",
    decision: "approved",
    policyVersion: "v1",
    createdAt: "2026-07-23T00:00:00.000Z",
  };
}
