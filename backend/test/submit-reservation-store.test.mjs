import assert from "node:assert/strict";
import test from "node:test";
import {
  InMemorySubmitReservationStore,
  assertSubmitReservation,
} from "../dist/modules/execution/submit-reservation.store.js";

test("InMemorySubmitReservationStore enforces ownership and permits reacquisition after release", async () => {
  let owner = 0;
  const store = new InMemorySubmitReservationStore(
    { leaseMs: 60_000 },
    { now: () => 1_000, ownerToken: () => `submit_owner_${++owner}` },
  );

  const first = await store.acquire("q_submit_1");
  assert.equal(first.ownerToken, "submit_owner_1");
  assert.equal(await store.acquire("q_submit_1"), undefined);

  await store.release({ ...first, ownerToken: "submit_wrong_owner" });
  assert.equal(await store.acquire("q_submit_1"), undefined);
  await store.release(first);

  const second = await store.acquire("q_submit_1");
  assert.equal(second.ownerToken, "submit_owner_2");
});

test("InMemorySubmitReservationStore reclaims only expired reservations", async () => {
  let now = 1_000;
  let owner = 0;
  const store = new InMemorySubmitReservationStore(
    { leaseMs: 60_000 },
    { now: () => now, ownerToken: () => `submit_owner_${++owner}` },
  );

  const first = await store.acquire("q_submit_expiry");
  now += 59_999;
  assert.equal(await store.acquire("q_submit_expiry"), undefined);
  now += 1;
  const reclaimed = await store.acquire("q_submit_expiry");
  assert.notEqual(reclaimed.ownerToken, first.ownerToken);
});

test("submit reservation validation rejects malformed config, dependencies, and payloads", () => {
  for (const leaseMs of [59_999, 3_600_001, 60_000.5, "60000"]) {
    assert.throws(
      () => new InMemorySubmitReservationStore({ leaseMs }),
      /leaseMs must be an integer between/,
    );
  }
  assert.throws(
    () => new InMemorySubmitReservationStore({ leaseMs: 60_000 }, { now: 1 }),
    /dependencies.now must be a function/,
  );
  assert.throws(
    () => assertSubmitReservation({
      quoteId: "q_submit",
      ownerToken: "submit_owner",
      expiresAt: "2026-01-01",
    }),
    /canonical UTC timestamp/,
  );
});
