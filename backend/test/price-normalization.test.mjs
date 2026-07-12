import assert from "node:assert/strict";
import test from "node:test";
import { FormulaPricingEngine, defaultFormulaPricingConfig } from "../dist/modules/pricing/pricing.engine.js";
import { ConfiguredTokenRegistry } from "../dist/modules/pricing/token-registry.js";

const user = "0x0000000000000000000000000000000000000001";
const weth = "0x0000000000000000000000000000000000000002";
const usdc = "0x0000000000000000000000000000000000000003";
const other = "0x0000000000000000000000000000000000000004";

const zeroAdjustmentConfig = {
  ...defaultFormulaPricingConfig,
  baseSpreadBps: 0,
  internalInventoryBufferBps: 0,
  maxSizeImpactBps: 0,
  maxTotalAdjustmentBps: 0,
};

test("FormulaPricingEngine converts WETH 18 decimals to USDC 6 decimals", async () => {
  const pricing = await engine(zeroAdjustmentConfig).price(input({
    tokenIn: weth,
    tokenOut: usdc,
    amountIn: "1000000000000000000",
    midPrice: "2000",
  }));

  assert.equal(pricing.amountOut, "2000000000");
  assert.equal(pricing.minAmountOut, "2000000000");
  assert.equal(pricing.pricingVersion, "formula-v2:internal_inventory");
});

test("FormulaPricingEngine converts the inverse USDC to WETH direction exactly", async () => {
  const pricing = await engine(zeroAdjustmentConfig).price(input({
    tokenIn: usdc,
    tokenOut: weth,
    amountIn: "2000000000",
    midPrice: "0.0005",
  }));

  assert.equal(pricing.amountOut, "1000000000000000000");
  assert.equal(pricing.minAmountOut, "1000000000000000000");
});

test("FormulaPricingEngine applies USD-normalized size impact and quote adjustments", async () => {
  const pricing = await engine().price(input({
    tokenIn: weth,
    tokenOut: usdc,
    amountIn: "1000000000000000000",
    midPrice: "2000",
    slippageBps: 50,
    liquidityUsd: "50000000",
    volatilityBps: 25,
  }));

  assert.equal(pricing.sizeImpactBps, 1);
  assert.equal(pricing.spreadBps, 16);
  assert.equal(pricing.amountOut, "1996800000");
  assert.equal(pricing.minAmountOut, "1986816000");
});

test("FormulaPricingEngine caps size impact using human USD notional", async () => {
  const pricing = await engine({
    ...defaultFormulaPricingConfig,
    baseSpreadBps: 0,
    internalInventoryBufferBps: 0,
  }).price(input({
    tokenIn: weth,
    tokenOut: usdc,
    amountIn: "100000000000000000000",
    midPrice: "2000",
    liquidityUsd: "1000000",
    volatilityBps: 0,
  }));

  assert.equal(pricing.sizeImpactBps, 250);
  assert.equal(pricing.spreadBps, 250);
  assert.equal(pricing.amountOut, "195000000000");
});

test("FormulaPricingEngine rejects precision loss, dust output, and pairs without a USD reference", async () => {
  const pricing = engine(zeroAdjustmentConfig);
  await assert.rejects(
    pricing.price(input({ tokenIn: weth, tokenOut: usdc, amountIn: "1", midPrice: "2000" })),
    /rounds to zero/,
  );
  await assert.rejects(
    pricing.price(input({ tokenIn: weth, tokenOut: usdc, midPrice: "1.0000000000000000001" })),
    /positive decimal string/,
  );
  await assert.rejects(
    pricing.price(input({
      tokenIn: weth,
      tokenOut: usdc,
      amountIn: ((1n << 256n)).toString(),
      midPrice: "2000",
    })),
    /request.amountIn must fit uint256/,
  );

  const noUsdRegistry = new ConfiguredTokenRegistry({
    tokens: [
      metadata(weth, "WETH", 18, false),
      metadata(other, "OTHER", 18, false),
    ],
  });
  const noUsdEngine = new FormulaPricingEngine(zeroAdjustmentConfig, noUsdRegistry);
  await assert.rejects(
    noUsdEngine.price(input({ tokenIn: weth, tokenOut: other, midPrice: "2" })),
    /approved USD reference token/,
  );

  const malformedRegistryEngine = new FormulaPricingEngine(zeroAdjustmentConfig, {
    getToken() {
      return Object.create(metadata(weth, "WETH", 18, true));
    },
  });
  await assert.rejects(
    malformedRegistryEngine.price(input()),
    /metadata.chainId must be an own field/,
  );
});

function engine(config = defaultFormulaPricingConfig) {
  return new FormulaPricingEngine(config, new ConfiguredTokenRegistry({
    tokens: [
      metadata(weth, "WETH", 18, false),
      metadata(usdc, "USDC", 6, true),
    ],
  }));
}

function metadata(tokenAddress, symbol, decimals, usdReference) {
  return {
    chainId: 1,
    tokenAddress,
    symbol,
    decimals,
    isWhitelisted: true,
    riskTier: usdReference ? "low" : "medium",
    usdReference,
  };
}

function input({
  tokenIn = weth,
  tokenOut = usdc,
  amountIn = "1000000000000000000",
  midPrice = "2000",
  slippageBps = 0,
  liquidityUsd = "50000000",
  volatilityBps = 0,
} = {}) {
  return {
    request: { chainId: 1, user, tokenIn, tokenOut, amountIn, slippageBps },
    snapshot: {
      snapshotId: "snapshot_normalized",
      midPrice,
      liquidityUsd,
      volatilityBps,
      observedAt: "2026-07-12T00:00:00.000Z",
    },
    routePlan: {
      routeId: "route_normalized",
      venue: "internal_inventory",
      tokenIn,
      tokenOut,
      expectedLiquidityUsd: liquidityUsd,
    },
    inventorySkewBps: 0,
  };
}
