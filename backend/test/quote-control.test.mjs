import assert from "node:assert/strict";
import test from "node:test";
import {
  InMemoryQuoteControlStore,
  QuoteControlConflictError,
  assertPairQuoteControlState,
  normalizePairQuoteControlScope,
  normalizeQuoteControlUpdate,
} from "../dist/modules/quote-control/quote-control.store.js";

test("InMemoryQuoteControlStore applies versioned pause and resume updates", async () => {
  let now = Date.parse("2026-07-14T00:00:00.000Z");
  const store = new InMemoryQuoteControlStore(() => now);

  const initial = await store.getState();
  assert.deepEqual(initial, {
    paused: false,
    version: 0,
    reason: null,
    updatedBy: "system",
    updatedAt: "2026-07-14T00:00:00.000Z",
  });
  initial.paused = true;
  assert.equal((await store.getState()).paused, false);

  now += 1_000;
  const paused = await store.updateState({
    paused: true,
    reason: "  market data incident  ",
    expectedVersion: 0,
  }, "institution_a:ops_key");
  assert.deepEqual(paused, {
    paused: true,
    version: 1,
    reason: "market data incident",
    updatedBy: "institution_a:ops_key",
    updatedAt: "2026-07-14T00:00:01.000Z",
  });

  await assert.rejects(
    store.updateState({ paused: false, reason: "stale resume", expectedVersion: 0 }, "institution_a:ops_key"),
    QuoteControlConflictError,
  );
  assert.equal((await store.getState()).paused, true);

  now += 1_000;
  const resumed = await store.updateState({
    paused: false,
    reason: "incident resolved",
    expectedVersion: 1,
  }, "institution_a:ops_key");
  assert.equal(resumed.paused, false);
  assert.equal(resumed.version, 2);
  assert.equal(resumed.reason, "incident resolved");
});

test("quote control rejects unsafe update envelopes, actors, reasons, and clocks", async () => {
  assert.throws(() => normalizeQuoteControlUpdate(null), /must be an object/);
  assert.throws(
    () => normalizeQuoteControlUpdate({ paused: true, reason: "incident", expectedVersion: 0, extra: true }),
    /fields are invalid/,
  );
  assert.throws(
    () => normalizeQuoteControlUpdate(Object.create({ paused: true, reason: "incident", expectedVersion: 0 })),
    /fields are invalid/,
  );
  assert.throws(
    () => normalizeQuoteControlUpdate({ paused: true, reason: "bad\nreason", expectedVersion: 0 }),
    /printable characters/,
  );
  assert.throws(
    () => new InMemoryQuoteControlStore(() => Number.NaN),
    /clock must return a non-negative safe integer/,
  );

  const store = new InMemoryQuoteControlStore(() => 1_700_000_000_000);
  await assert.rejects(
    store.updateState({ paused: true, reason: "incident", expectedVersion: 0 }, "bad/actor"),
    /actor must be a safe identifier/,
  );
});

test("pair quote control normalizes direction and applies independent CAS versions", async () => {
  let now = Date.parse("2026-07-14T00:00:00.000Z");
  const store = new InMemoryQuoteControlStore(() => now);
  const high = "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
  const low = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const scope = normalizePairQuoteControlScope({ chainId: "8453", tokenLow: high, tokenHigh: low });
  assert.deepEqual(scope, {
    chainId: 8453,
    tokenLow: low,
    tokenHigh: high.toLowerCase(),
  });
  assert.equal(await store.getPairState(scope), null);

  now += 1_000;
  const paused = await store.updatePairState(scope, {
    paused: true,
    reason: "venue book unavailable",
    expectedVersion: 0,
  }, "institution_a:ops_key");
  assert.equal(paused.version, 1);
  assert.equal(paused.paused, true);
  assert.equal(await store.getPausedPairCount(), 1);

  const reverse = await store.getPairState({
    chainId: 8453,
    tokenLow: high,
    tokenHigh: low,
  });
  assert.deepEqual(reverse, paused);
  reverse.paused = false;
  assert.equal((await store.getPairState(scope)).paused, true);

  await assert.rejects(
    store.updatePairState(scope, {
      paused: false,
      reason: "stale recovery",
      expectedVersion: 0,
    }, "institution_a:ops_key"),
    QuoteControlConflictError,
  );
  assert.equal((await store.getState()).version, 0);
  assert.equal(await store.getPausedPairCount(), 1);
});

test("pair quote control rejects malformed, identical, and unsafe scopes", () => {
  const token = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  assert.throws(
    () => normalizePairQuoteControlScope({ chainId: 1, tokenLow: token, tokenHigh: token }),
    /tokens must be distinct/,
  );
  assert.throws(
    () => normalizePairQuoteControlScope({ chainId: "01", tokenLow: token, tokenHigh: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }),
    /chainId must be a positive safe integer/,
  );
  assert.throws(
    () => normalizePairQuoteControlScope({
      chainId: 1,
      tokenLow: token,
      tokenHigh: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      extra: true,
    }),
    /fields are invalid/,
  );
  assert.throws(
    () => assertPairQuoteControlState({
      chainId: 1,
      tokenLow: token,
      tokenHigh: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      paused: false,
      version: 0,
      reason: "invalid initial state",
      updatedBy: "system",
      updatedAt: "2026-07-14T00:00:00.000Z",
    }),
    /version must be a positive safe integer/,
  );
});
