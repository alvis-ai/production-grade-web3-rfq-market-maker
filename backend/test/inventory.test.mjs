import assert from "node:assert/strict";
import test from "node:test";
import { InventoryService } from "../dist/modules/inventory/inventory.service.js";

const tokenIn = "0x0000000000000000000000000000000000000002";
const tokenOut = "0x0000000000000000000000000000000000000003";

test("InventoryService applies settlement deltas and projects without mutating balances", () => {
  const inventory = new InventoryService();

  inventory.applySettlement({
    chainId: 1,
    tokenIn,
    tokenOut,
    amountIn: "1000000000",
    amountOut: "998400000",
  });

  assert.equal(inventory.getPosition(1, tokenIn).balance, 1000000000n);
  assert.equal(inventory.getPosition(1, tokenOut).balance, -998400000n);

  const projection = inventory.projectSettlement({
    chainId: 1,
    tokenIn,
    tokenOut,
    amountIn: "250000000",
    amountOut: "249000000",
  });

  assert.equal(projection.tokenIn.balance, 1250000000n);
  assert.equal(projection.tokenOut.balance, -1247400000n);
  assert.equal(inventory.getPosition(1, tokenIn).balance, 1000000000n);
  assert.equal(inventory.getPosition(1, tokenOut).balance, -998400000n);
});

test("InventoryService calculates bounded quote skew by inventory direction", () => {
  const inventory = new InventoryService({
    skewUnit: 10n,
    maxPositiveSkewBps: 15,
    maxNegativeSkewBps: 6,
  });

  assert.equal(inventory.calculateQuoteSkewBps({ chainId: 1, token: tokenOut }), 0);

  inventory.applySettlement({
    chainId: 1,
    tokenIn,
    tokenOut,
    amountIn: "70",
    amountOut: "170",
  });

  assert.equal(inventory.getPosition(1, tokenIn).balance, 70n);
  assert.equal(inventory.getPosition(1, tokenOut).balance, -170n);
  assert.equal(inventory.calculateQuoteSkewBps({ chainId: 1, token: tokenIn }), -6);
  assert.equal(inventory.calculateQuoteSkewBps({ chainId: 1, token: tokenOut }), 15);
});

test("InventoryService rejects unsafe skew configuration at construction", () => {
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
