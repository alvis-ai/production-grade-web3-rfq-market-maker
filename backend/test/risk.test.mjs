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

test("BasicRiskEngine rejects projected token-in inventory over hard limit", async () => {
  const decision = await new BasicRiskEngine().evaluate({
    request: baseRequest,
    pricing: basePricing,
    inventoryProjection: {
      tokenIn: {
        chainId: 1,
        token: baseRequest.tokenIn,
        balance: 2_000_000_001n,
      },
      tokenOut: {
        chainId: 1,
        token: baseRequest.tokenOut,
        balance: -1n,
      },
    },
  });

  assert.equal(decision.status, "rejected");
  assert.equal(decision.reasonCode, "TOKEN_IN_INVENTORY_LIMIT_EXCEEDED");
  assert.equal(decision.policyVersion, "basic-risk-v1");
});

test("BasicRiskEngine rejects projected token-out inventory over hard limit", async () => {
  const decision = await new BasicRiskEngine().evaluate({
    request: baseRequest,
    pricing: basePricing,
    inventoryProjection: {
      tokenIn: {
        chainId: 1,
        token: baseRequest.tokenIn,
        balance: 1n,
      },
      tokenOut: {
        chainId: 1,
        token: baseRequest.tokenOut,
        balance: -2_000_000_001n,
      },
    },
  });

  assert.equal(decision.status, "rejected");
  assert.equal(decision.reasonCode, "TOKEN_OUT_INVENTORY_LIMIT_EXCEEDED");
});

test("BasicRiskEngine rejects restricted toxic-flow users", async () => {
  const decision = await new BasicRiskEngine({
    ...defaultBasicRiskPolicy,
    restrictedUsers: [baseRequest.user],
  }).evaluate({
    request: baseRequest,
    pricing: basePricing,
  });

  assert.equal(decision.status, "rejected");
  assert.equal(decision.reasonCode, "TOXIC_FLOW_RESTRICTED_USER");
  assert.equal(decision.policyVersion, "basic-risk-v1");
});

test("BasicRiskEngine rejects users above toxic-flow score threshold", async () => {
  const decision = await new BasicRiskEngine({
    ...defaultBasicRiskPolicy,
    maxToxicScoreBps: 8000,
    toxicFlowScores: [
      {
        user: baseRequest.user,
        scoreBps: 9000,
      },
    ],
  }).evaluate({
    request: baseRequest,
    pricing: basePricing,
  });

  assert.equal(decision.status, "rejected");
  assert.equal(decision.reasonCode, "TOXIC_FLOW_SCORE_EXCEEDED");
  assert.equal(decision.policyVersion, "basic-risk-v1");
});

test("BasicRiskEngine rejects quoted spreads above policy limit", async () => {
  const decision = await new BasicRiskEngine({
    ...defaultBasicRiskPolicy,
    maxQuotedSpreadBps: 100,
  }).evaluate({
    request: baseRequest,
    pricing: {
      ...basePricing,
      spreadBps: 101,
    },
  });

  assert.equal(decision.status, "rejected");
  assert.equal(decision.reasonCode, "QUOTED_SPREAD_TOO_WIDE");
  assert.equal(decision.policyVersion, "basic-risk-v1");
});

test("BasicRiskEngine snapshots policy configuration at construction", async () => {
  const mutablePolicy = {
    ...defaultBasicRiskPolicy,
    policyVersion: "snapshot-risk-v1",
    enabledChainIds: [1],
    tokenAllowlist: [baseRequest.tokenIn, baseRequest.tokenOut],
    restrictedUsers: [],
    toxicFlowScores: [],
    maxAmountIn: 2_000_000_000n,
    minAmountOut: 1n,
    maxSlippageBps: 100,
    maxQuotedSpreadBps: 100,
    maxAbsoluteInventory: 2_000_000_000n,
  };
  const engine = new BasicRiskEngine(mutablePolicy);

  mutablePolicy.policyVersion = "mutated-risk-v2";
  mutablePolicy.enabledChainIds.length = 0;
  mutablePolicy.tokenAllowlist.length = 0;
  mutablePolicy.restrictedUsers.push(baseRequest.user);
  mutablePolicy.toxicFlowScores.push({ user: baseRequest.user, scoreBps: 10_000 });
  mutablePolicy.maxAmountIn = 1n;
  mutablePolicy.maxSlippageBps = 1;
  mutablePolicy.maxQuotedSpreadBps = 1;

  const decision = await engine.evaluate({
    request: baseRequest,
    pricing: basePricing,
  });

  assert.equal(decision.status, "approved");
  assert.equal(decision.policyVersion, "snapshot-risk-v1");
});

test("BasicRiskEngine rejects unsafe policy configuration at construction", () => {
  assert.throws(
    () => new BasicRiskEngine(null),
    /Basic risk policy must be an object/,
  );

  assert.throws(
    () => new BasicRiskEngine(Object.create(defaultBasicRiskPolicy)),
    /Basic risk policy.policyVersion must be an own field/,
  );

  assert.throws(
    () => new BasicRiskEngine({ ...defaultBasicRiskPolicy, enabledChainIds: undefined }),
    /Basic risk enabledChainIds must be an array/,
  );

  assert.throws(
    () => new BasicRiskEngine({ ...defaultBasicRiskPolicy, policyVersion: " " }),
    /Basic risk policyVersion must be a non-empty string/,
  );

  assert.throws(
    () => new BasicRiskEngine({ ...defaultBasicRiskPolicy, enabledChainIds: [] }),
    /Basic risk enabledChainIds must contain at least one chain id/,
  );

  assert.throws(
    () => new BasicRiskEngine({ ...defaultBasicRiskPolicy, enabledChainIds: [1, 1] }),
    /Basic risk enabledChainIds must not contain duplicate chain ids/,
  );

  assert.throws(
    () => new BasicRiskEngine({ ...defaultBasicRiskPolicy, tokenAllowlist: [] }),
    /Basic risk tokenAllowlist must contain at least one address/,
  );

  assert.throws(
    () =>
      new BasicRiskEngine({
        ...defaultBasicRiskPolicy,
        tokenAllowlist: ["0x00000000000000000000000000000000000000zz"],
      }),
    /Basic risk tokenAllowlist entries must be 20-byte hex addresses/,
  );

  assert.throws(
    () =>
      new BasicRiskEngine({
        ...defaultBasicRiskPolicy,
        tokenAllowlist: [new String(baseRequest.tokenIn), baseRequest.tokenOut],
      }),
    /Basic risk tokenAllowlist entries must be 20-byte hex addresses/,
  );

  assert.throws(
    () =>
      new BasicRiskEngine({
        ...defaultBasicRiskPolicy,
        tokenAllowlist: [
          "0x0000000000000000000000000000000000000002",
          "0x0000000000000000000000000000000000000002",
        ],
      }),
    /Basic risk tokenAllowlist must not contain duplicate addresses/,
  );

  assert.throws(
    () =>
      new BasicRiskEngine({
        ...defaultBasicRiskPolicy,
        restrictedUsers: [
          "0x00000000000000000000000000000000000000aa",
          "0x00000000000000000000000000000000000000AA",
        ],
      }),
    /Basic risk restrictedUsers must not contain duplicate addresses/,
  );

  assert.throws(
    () => new BasicRiskEngine({ ...defaultBasicRiskPolicy, maxAmountIn: 0n }),
    /Basic risk maxAmountIn must be a positive bigint/,
  );

  assert.throws(
    () => new BasicRiskEngine({ ...defaultBasicRiskPolicy, maxQuotedSpreadBps: 10_001 }),
    /Basic risk maxQuotedSpreadBps must be less than or equal to 10000 bps/,
  );

  assert.throws(
    () =>
      new BasicRiskEngine({
        ...defaultBasicRiskPolicy,
        toxicFlowScores: [
          null,
        ],
      }),
    /Basic risk toxicFlowScores entry must be an object/,
  );

  assert.throws(
    () =>
      new BasicRiskEngine({
        ...defaultBasicRiskPolicy,
        toxicFlowScores: [
          Object.create({
            user: baseRequest.user,
            scoreBps: 100,
          }),
        ],
      }),
    /Basic risk toxicFlowScores entry.user must be an own field/,
  );

  assert.throws(
    () =>
      new BasicRiskEngine({
        ...defaultBasicRiskPolicy,
        toxicFlowScores: [
          {
            user: baseRequest.user,
            scoreBps: -1,
          },
        ],
      }),
    /Basic risk toxicFlowScores.scoreBps must be a non-negative safe integer/,
  );

  assert.throws(
    () =>
      new BasicRiskEngine({
        ...defaultBasicRiskPolicy,
        toxicFlowScores: [
          {
            user: "0x00000000000000000000000000000000000000bb",
            scoreBps: 100,
          },
          {
            user: "0x00000000000000000000000000000000000000BB",
            scoreBps: 9000,
          },
        ],
      }),
    /Basic risk toxicFlowScores must not contain duplicate users/,
  );
});

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
