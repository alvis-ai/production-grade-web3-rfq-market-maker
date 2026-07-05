import assert from "node:assert/strict";
import test from "node:test";
import { HedgeService } from "../dist/modules/hedge/hedge.service.js";

test("HedgeService rejects unsafe failure penalty configuration at construction", () => {
  assert.throws(
    () => new HedgeService(null),
    /Hedge config must be an object/,
  );
  assert.throws(
    () => new HedgeService([]),
    /Hedge config must be an object/,
  );

  assert.throws(
    () =>
      new HedgeService(
        Object.create({
          failurePenaltyBps: 25,
          maxFailurePenaltyBps: 100,
        }),
      ),
    /Hedge config.failurePenaltyBps must be an own field/,
  );

  assert.throws(
    () =>
      new HedgeService({
        failurePenaltyBps: 0,
        maxFailurePenaltyBps: 100,
      }),
    /Hedge failurePenaltyBps must be a positive safe integer/,
  );

  assert.throws(
    () =>
      new HedgeService({
        failurePenaltyBps: 25,
        maxFailurePenaltyBps: Number.MAX_SAFE_INTEGER + 1,
      }),
    /Hedge maxFailurePenaltyBps must be a positive safe integer/,
  );

  assert.throws(
    () =>
      new HedgeService({
        failurePenaltyBps: 25,
        maxFailurePenaltyBps: 10_001,
      }),
    /Hedge maxFailurePenaltyBps must be less than or equal to 10000 bps/,
  );

  assert.throws(
    () =>
      new HedgeService({
        failurePenaltyBps: 200,
        maxFailurePenaltyBps: 100,
      }),
    /Hedge failurePenaltyBps must be less than or equal to maxFailurePenaltyBps/,
  );
});
