import assert from "node:assert/strict";
import test from "node:test";
import { InventoryService } from "../dist/modules/inventory/inventory.service.js";

test("InventoryService rejects unsafe skew configuration at construction", () => {
  assert.throws(
    () => new InventoryService(null),
    /Inventory config must be an object/,
  );
  assert.throws(
    () => new InventoryService([]),
    /Inventory config must be an object/,
  );

  assert.throws(
    () =>
      new InventoryService(
        Object.create({
          skewUnit: 10n,
          maxPositiveSkewBps: 150,
          maxNegativeSkewBps: 50,
        }),
      ),
    /Inventory config.skewUnit must be an own field/,
  );

  assert.throws(
    () =>
      new InventoryService({
        skewUnit: 0n,
        maxPositiveSkewBps: 150,
        maxNegativeSkewBps: 50,
      }),
    /Inventory skewUnit must be a positive bigint/,
  );

  assert.throws(
    () =>
      new InventoryService({
        skewUnit: 10n,
        maxPositiveSkewBps: -1,
        maxNegativeSkewBps: 50,
      }),
    /Inventory maxPositiveSkewBps must be a non-negative safe integer/,
  );

  assert.throws(
    () =>
      new InventoryService({
        skewUnit: 10n,
        maxPositiveSkewBps: 150,
        maxNegativeSkewBps: Number.MAX_SAFE_INTEGER + 1,
      }),
    /Inventory maxNegativeSkewBps must be a non-negative safe integer/,
  );

  assert.throws(
    () =>
      new InventoryService({
        skewUnit: 10n,
        maxPositiveSkewBps: 10_001,
        maxNegativeSkewBps: 50,
      }),
    /Inventory maxPositiveSkewBps must be less than or equal to 10000 bps/,
  );
});
