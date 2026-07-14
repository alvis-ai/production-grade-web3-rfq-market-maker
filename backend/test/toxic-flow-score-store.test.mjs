import assert from "node:assert/strict";
import test from "node:test";
import {
  InMemoryToxicFlowScoreStore,
  ToxicFlowScoreConflictError,
  normalizeToxicFlowScoreKey,
  normalizeToxicFlowScoreUpdate,
} from "../dist/modules/risk/toxic-flow-score.store.js";

const user = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

test("InMemoryToxicFlowScoreStore applies normalized CAS updates and defensive reads", async () => {
  let now = Date.parse("2026-07-14T00:00:00.000Z");
  const store = new InMemoryToxicFlowScoreStore(() => now);
  const key = { chainId: 1, user: user.toUpperCase().replace("0X", "0x") };
  assert.equal(await store.getScore(key), null);

  now += 1_000;
  const inserted = await store.updateScore(key, update(), "risk_analyzer:writer_key");
  assert.deepEqual(inserted, {
    chainId: 1,
    user,
    scoreBps: 4200,
    postTradeDriftBps: -35,
    sampleSize: 25,
    windowSeconds: 300,
    policyVersion: "markout-v1",
    observedAt: "2026-07-14T00:00:00.000Z",
    version: 1,
    updatedBy: "risk_analyzer:writer_key",
    updatedAt: "2026-07-14T00:00:01.000Z",
  });
  inserted.scoreBps = 1;
  assert.equal((await store.getScore({ chainId: 1, user })).scoreBps, 4200);

  await assert.rejects(
    store.updateScore({ chainId: 1, user }, update({ expectedVersion: 0 }), "risk_analyzer:writer_key"),
    ToxicFlowScoreConflictError,
  );
  now += 1_000;
  const updated = await store.updateScore(
    { chainId: 1, user },
    update({ scoreBps: 8100, expectedVersion: 1 }),
    "risk_analyzer:writer_key",
  );
  assert.equal(updated.version, 2);
  assert.equal(updated.scoreBps, 8100);
});

test("toxic flow score validation rejects unsafe keys, envelopes, and evidence", () => {
  assert.throws(
    () => normalizeToxicFlowScoreKey({ chainId: 0, user }),
    /chainId must be a positive safe integer/,
  );
  assert.throws(
    () => normalizeToxicFlowScoreKey({ chainId: 1, user: "0x1" }),
    /user must be a 20-byte address/,
  );
  assert.throws(
    () => normalizeToxicFlowScoreUpdate({ ...update(), extra: true }),
    /fields are invalid/,
  );
  assert.throws(
    () => normalizeToxicFlowScoreUpdate(update({ scoreBps: 10_001 })),
    /scoreBps must be an integer from 0 to 10000/,
  );
  assert.throws(
    () => normalizeToxicFlowScoreUpdate(update({ postTradeDriftBps: -10_001 })),
    /postTradeDriftBps must be an integer from -10000 to 10000/,
  );
  assert.throws(
    () => normalizeToxicFlowScoreUpdate(update({ sampleSize: 0 })),
    /empty sample must have zero score and drift/,
  );
  assert.throws(
    () => normalizeToxicFlowScoreUpdate(update({ windowSeconds: 604_801 })),
    /windowSeconds must not exceed 604800/,
  );
  assert.throws(
    () => normalizeToxicFlowScoreUpdate(update({ policyVersion: "unsafe version" })),
    /policyVersion must be a safe identifier/,
  );
  assert.throws(
    () => normalizeToxicFlowScoreUpdate(update({ observedAt: "2026-07-14" })),
    /observedAt must be a canonical UTC timestamp/,
  );
});

test("toxic flow score permits only zeroed empty-sample clearing state", async () => {
  const now = Date.parse("2026-07-14T00:00:00.000Z");
  const store = new InMemoryToxicFlowScoreStore(() => now);
  const cleared = await store.updateScore({ chainId: 1, user }, update({
    scoreBps: 0, postTradeDriftBps: 0, sampleSize: 0,
  }), "risk_analyzer:writer_key");
  assert.equal(cleared.sampleSize, 0);
});

function update(overrides = {}) {
  return {
    scoreBps: 4200,
    postTradeDriftBps: -35,
    sampleSize: 25,
    windowSeconds: 300,
    policyVersion: "markout-v1",
    observedAt: "2026-07-14T00:00:00.000Z",
    expectedVersion: 0,
    ...overrides,
  };
}
