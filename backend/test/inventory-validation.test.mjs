import assert from "node:assert/strict";
import test from "node:test";
import { InventoryService } from "../dist/modules/inventory/inventory.service.js";

const tokenIn = "0x0000000000000000000000000000000000000002";
const tokenOut = "0x0000000000000000000000000000000000000003";

test("InventoryService rejects malformed runtime payload envelopes before mutating balances", () => {
  const inventory = new InventoryService();

  assert.throws(
    () => inventory.applySettlement(undefined),
    /Inventory settlement delta must be an object/,
  );
  assert.throws(
    () => inventory.projectSettlement(null),
    /Inventory settlement delta must be an object/,
  );
  assert.throws(
    () => inventory.calculateQuoteSkewBps([]),
    /Inventory skew input must be an object/,
  );
  assert.throws(
    () => inventory.rebuildFromSettlements([undefined]),
    /Inventory settlement delta must be an object/,
  );

  assert.equal(inventory.getPosition(1, tokenIn).balance, 0n);
  assert.equal(inventory.getPosition(1, tokenOut).balance, 0n);
});

test("InventoryService rejects inherited runtime fields before mutating balances", () => {
  const inventory = new InventoryService();
  inventory.applySettlement({
    chainId: 1,
    tokenIn,
    tokenOut,
    amountIn: "100",
    amountOut: "80",
  });

  assert.throws(
    () => inventory.applySettlement(Object.create({
      chainId: 1,
      tokenIn,
      tokenOut,
      amountIn: "10",
      amountOut: "9",
    })),
    /Inventory settlement delta.chainId must be an own field/,
  );

  const inheritedAmountProjection = Object.create({ amountOut: "9" });
  Object.assign(inheritedAmountProjection, {
    chainId: 1,
    tokenIn,
    tokenOut,
    amountIn: "10",
  });
  assert.throws(
    () => inventory.projectSettlement(inheritedAmountProjection),
    /Inventory settlement delta.amountOut must be an own field/,
  );

  assert.throws(
    () =>
      inventory.calculateQuoteSkewBps(
        Object.create({
          chainId: 1,
          token: tokenOut,
        }),
      ),
    /Inventory skew input.chainId must be an own field/,
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
        Object.create({
          chainId: 1,
          tokenIn,
          tokenOut,
          amountIn: "10",
          amountOut: "9",
        }),
      ]),
    /Inventory settlement delta.chainId must be an own field/,
  );

  assert.equal(inventory.getPosition(1, tokenIn).balance, 100n);
  assert.equal(inventory.getPosition(1, tokenOut).balance, -80n);
});

test("InventoryService rejects unsafe settlement inputs before mutating balances", () => {
  const inventory = new InventoryService();

  assert.throws(
    () =>
      inventory.applySettlement({
        chainId: 0,
        tokenIn,
        tokenOut,
        amountIn: "100",
        amountOut: "99",
      }),
    /Inventory chainId must be a positive safe integer/,
  );
  assert.throws(
    () =>
      inventory.applySettlement({
        chainId: 1,
        tokenIn: "0x1234",
        tokenOut,
        amountIn: "100",
        amountOut: "99",
      }),
    /Inventory tokenIn must be a 20-byte hex address/,
  );
  assert.throws(
    () =>
      inventory.applySettlement({
        chainId: 1,
        tokenIn,
        tokenOut: tokenIn,
        amountIn: "100",
        amountOut: "99",
      }),
    /Inventory token pair must contain distinct tokens/,
  );
  assert.throws(
    () =>
      inventory.applySettlement({
        chainId: 1,
        tokenIn,
        tokenOut,
        amountIn: "0",
        amountOut: "99",
      }),
    /Inventory amountIn must be a positive uint string/,
  );
  assert.throws(
    () =>
      inventory.applySettlement({
        chainId: 1,
        tokenIn,
        tokenOut,
        amountIn: "0100",
        amountOut: "99",
      }),
    /Inventory amountIn must be a positive uint string/,
  );
  assert.throws(
    () =>
      inventory.applySettlement({
        chainId: 1,
        tokenIn,
        tokenOut,
        amountIn: "100",
        amountOut: "099",
      }),
    /Inventory amountOut must be a positive uint string/,
  );

  assert.equal(inventory.getPosition(1, tokenIn).balance, 0n);
  assert.equal(inventory.getPosition(1, tokenOut).balance, 0n);
});

test("InventoryService rejects unsafe projection and skew inputs", () => {
  const inventory = new InventoryService();

  assert.throws(
    () =>
      inventory.projectSettlement({
        chainId: 1,
        tokenIn,
        tokenOut,
        amountIn: "100",
        amountOut: "-1",
      }),
    /Inventory amountOut must be a positive uint string/,
  );
  assert.throws(
    () =>
      inventory.projectSettlement({
        chainId: 1,
        tokenIn,
        tokenOut,
        amountIn: "100",
        amountOut: "099",
      }),
    /Inventory amountOut must be a positive uint string/,
  );
  assert.throws(
    () => inventory.calculateQuoteSkewBps({ chainId: Number.MAX_SAFE_INTEGER + 1, token: tokenOut }),
    /Inventory chainId must be a positive safe integer/,
  );
  assert.throws(
    () => inventory.getPosition(1, "0x1234"),
    /Inventory token must be a 20-byte hex address/,
  );
});
