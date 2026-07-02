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

test("InventoryService snapshots skew configuration at construction", () => {
  const mutableConfig = {
    skewUnit: 10n,
    maxPositiveSkewBps: 15,
    maxNegativeSkewBps: 6,
  };
  const inventory = new InventoryService(mutableConfig);

  mutableConfig.skewUnit = 1n;
  mutableConfig.maxPositiveSkewBps = 100;
  mutableConfig.maxNegativeSkewBps = 100;

  inventory.applySettlement({
    chainId: 1,
    tokenIn,
    tokenOut,
    amountIn: "70",
    amountOut: "170",
  });

  assert.equal(inventory.calculateQuoteSkewBps({ chainId: 1, token: tokenIn }), -6);
  assert.equal(inventory.calculateQuoteSkewBps({ chainId: 1, token: tokenOut }), 15);
});

test("InventoryService rebuilds inventory from settlement replay", () => {
  const inventory = new InventoryService();

  inventory.applySettlement({
    chainId: 1,
    tokenIn,
    tokenOut,
    amountIn: "999",
    amountOut: "111",
  });

  inventory.rebuildFromSettlements([
    {
      chainId: 1,
      tokenIn,
      tokenOut,
      amountIn: "100",
      amountOut: "80",
    },
    {
      chainId: 1,
      tokenIn: tokenOut,
      tokenOut: tokenIn,
      amountIn: "30",
      amountOut: "20",
    },
  ]);

  assert.equal(inventory.getPosition(1, tokenIn).balance, 80n);
  assert.equal(inventory.getPosition(1, tokenOut).balance, -50n);
});

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
