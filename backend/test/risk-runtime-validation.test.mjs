import assert from "node:assert/strict";
import test from "node:test";
import { BasicRiskEngine, defaultBasicRiskPolicy } from "../dist/modules/risk/risk.engine.js";

const baseRequest = {
  chainId: 1,
  user: "0x0000000000000000000000000000000000000001",
  tokenIn: "0x0000000000000000000000000000000000000002",
  tokenOut: "0x0000000000000000000000000000000000000003",
  amountIn: "1000000000",
  slippageBps: 50,
};

const basePricing = {
  amountOut: "998400000",
  minAmountOut: "993408000",
  spreadBps: 16,
  sizeImpactBps: 1,
  inventorySkewBps: 0,
  pricingVersion: "formula-v1:internal_inventory",
};

test("BasicRiskEngine rejects malformed runtime payload envelopes before policy evaluation", async () => {
  const engine = new BasicRiskEngine();

  await assert.rejects(
    engine.evaluate(undefined),
    /Basic risk input must be an object/,
  );

  await assert.rejects(
    engine.evaluate({
      pricing: basePricing,
    }),
    /Basic risk input.request must be an own field/,
  );

  await assert.rejects(
    engine.evaluate({
      request: baseRequest,
    }),
    /Basic risk input.pricing must be an own field/,
  );

  await assert.rejects(
    engine.evaluate({
      request: baseRequest,
      pricing: basePricing,
      inventoryProjection: null,
    }),
    /Basic risk inventoryProjection must be an object/,
  );

  await assert.rejects(
    engine.evaluate({
      request: baseRequest,
      pricing: basePricing,
      inventoryProjection: {
        tokenOut: {
          chainId: 1,
          token: baseRequest.tokenOut,
          balance: -1n,
        },
      },
    }),
    /Basic risk inventoryProjection.tokenIn must be an own field/,
  );
});

test("BasicRiskEngine rejects inherited runtime input fields before policy evaluation", async () => {
  const engine = new BasicRiskEngine();
  const inventoryProjection = {
    tokenIn: {
      chainId: 1,
      token: baseRequest.tokenIn,
      balance: 1n,
    },
    tokenOut: {
      chainId: 1,
      token: baseRequest.tokenOut,
      balance: -1n,
    },
  };

  await assert.rejects(
    engine.evaluate(Object.create({ request: baseRequest, pricing: basePricing })),
    /Basic risk input.request must be an own field/,
  );

  const inheritedInventoryInput = Object.create({ inventoryProjection });
  Object.assign(inheritedInventoryInput, {
    request: baseRequest,
    pricing: basePricing,
  });
  await assert.rejects(
    engine.evaluate(inheritedInventoryInput),
    /Basic risk input.inventoryProjection must be an own field when provided/,
  );

  await assert.rejects(
    engine.evaluate({
      request: Object.create(baseRequest),
      pricing: basePricing,
    }),
    /Basic risk request.chainId must be an own field/,
  );

  await assert.rejects(
    engine.evaluate({
      request: baseRequest,
      pricing: Object.create(basePricing),
    }),
    /Basic risk pricing.amountOut must be an own field/,
  );

  await assert.rejects(
    engine.evaluate({
      request: baseRequest,
      pricing: basePricing,
      inventoryProjection: Object.create(inventoryProjection),
    }),
    /Basic risk inventoryProjection.tokenIn must be an own field/,
  );

  await assert.rejects(
    engine.evaluate({
      request: baseRequest,
      pricing: basePricing,
      inventoryProjection: {
        tokenIn: Object.create(inventoryProjection.tokenIn),
        tokenOut: inventoryProjection.tokenOut,
      },
    }),
    /Basic risk inventoryProjection.tokenIn.chainId must be an own field/,
  );
});

test("BasicRiskEngine rejects unsafe runtime inputs before policy evaluation", async () => {
  const engine = new BasicRiskEngine();

  await assert.rejects(
    engine.evaluate({
      request: {
        ...baseRequest,
        tokenOut: baseRequest.tokenIn,
      },
      pricing: basePricing,
    }),
    /Basic risk request token pair must contain distinct tokens/,
  );

  await assert.rejects(
    engine.evaluate({
      request: {
        ...baseRequest,
        user: new String(baseRequest.user),
      },
      pricing: basePricing,
    }),
    /Basic risk request.user entries must be 20-byte hex addresses/,
  );

  await assert.rejects(
    engine.evaluate({
      request: {
        ...baseRequest,
        amountIn: "01000000000",
      },
      pricing: basePricing,
    }),
    /Basic risk request.amountIn must be a positive uint string/,
  );

  await assert.rejects(
    engine.evaluate({
      request: baseRequest,
      pricing: {
        ...basePricing,
        amountOut: "0",
      },
    }),
    /Basic risk pricing.amountOut must be a positive uint string/,
  );

  await assert.rejects(
    engine.evaluate({
      request: baseRequest,
      pricing: {
        ...basePricing,
        amountOut: "0998400000",
      },
    }),
    /Basic risk pricing.amountOut must be a positive uint string/,
  );

  await assert.rejects(
    engine.evaluate({
      request: baseRequest,
      pricing: {
        ...basePricing,
        amountOut: "900",
        minAmountOut: "901",
      },
    }),
    /Basic risk pricing.amountOut must be greater than or equal to pricing.minAmountOut/,
  );

  await assert.rejects(
    engine.evaluate({
      request: baseRequest,
      pricing: {
        ...basePricing,
        inventorySkewBps: 10_001,
      },
    }),
    /Basic risk pricing.inventorySkewBps magnitude must be less than or equal to 10000 bps/,
  );

  await assert.rejects(
    engine.evaluate({
      request: baseRequest,
      pricing: basePricing,
      inventoryProjection: {
        tokenIn: {
          chainId: 1,
          token: baseRequest.tokenOut,
          balance: 1n,
        },
        tokenOut: {
          chainId: 1,
          token: baseRequest.tokenOut,
          balance: -1n,
        },
      },
    }),
    /Basic risk inventoryProjection.tokenIn must match request tokenIn/,
  );
});
