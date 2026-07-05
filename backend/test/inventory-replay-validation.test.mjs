import assert from "node:assert/strict";
import test from "node:test";
import { InventoryService } from "../dist/modules/inventory/inventory.service.js";

const tokenIn = "0x0000000000000000000000000000000000000002";
const tokenOut = "0x0000000000000000000000000000000000000003";

test("InventoryService rejects unsafe settlement replay before mutating balances", () => {
  const inventory = new InventoryService();
  inventory.applySettlement({
    chainId: 1,
    tokenIn,
    tokenOut,
    amountIn: "100",
    amountOut: "80",
  });

  assert.throws(
    () =>
      inventory.rebuildFromSettlements([
        {
          chainId: 1,
          tokenIn,
          tokenOut,
          amountIn: "10",
          amountOut: "9",
        },
        {
          chainId: 1,
          tokenIn,
          tokenOut: "0x1234",
          amountIn: "10",
          amountOut: "9",
        },
      ]),
    /Inventory tokenOut must be a 20-byte hex address/,
  );
  assert.throws(
    () =>
      inventory.rebuildFromSettlements([
        {
          chainId: 1,
          tokenIn,
          tokenOut,
          amountIn: "10",
          amountOut: "9",
        },
        {
          chainId: 1,
          tokenIn,
          tokenOut,
          amountIn: "010",
          amountOut: "9",
        },
      ]),
    /Inventory amountIn must be a positive uint string/,
  );
  assert.throws(
    () => inventory.rebuildFromSettlements("not an array"),
    /Inventory settlement replay input must be an array/,
  );

  assert.equal(inventory.getPosition(1, tokenIn).balance, 100n);
  assert.equal(inventory.getPosition(1, tokenOut).balance, -80n);
});
