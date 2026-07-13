import assert from "node:assert/strict";
import test from "node:test";
import {
  DeltaNeutralHedgePlanner,
  hedgePlanInputFromSettlementEvent,
} from "../dist/modules/hedge/hedge-intent-planner.js";
import { ConfiguredTokenRegistry } from "../dist/modules/pricing/token-registry.js";

const user = "0x0000000000000000000000000000000000000001";
const weth = "0x0000000000000000000000000000000000000002";
const usdc = "0x0000000000000000000000000000000000000003";

test("DeltaNeutralHedgePlanner sells received tokenIn when tokenOut is the USD reference", () => {
  const planner = plannerFor(false, true);

  assert.deepEqual(planner.plan(planInput()), {
    settlementEventId: "se_1",
    quoteId: "q_1",
    chainId: 1,
    token: weth,
    side: "sell",
    amount: "1000000000000000000",
    reason: "inventory_rebalance",
  });
});

test("DeltaNeutralHedgePlanner buys paid tokenOut when tokenIn is the USD reference", () => {
  const planner = plannerFor(true, false);

  assert.deepEqual(planner.plan(planInput()), {
    settlementEventId: "se_1",
    quoteId: "q_1",
    chainId: 1,
    token: usdc,
    side: "buy",
    amount: "2000000000",
    reason: "inventory_rebalance",
  });
});

test("DeltaNeutralHedgePlanner buys tokenOut for a USD-reference stable pair", () => {
  assert.deepEqual(plannerFor(true, true).plan(planInput()), {
    settlementEventId: "se_1",
    quoteId: "q_1",
    chainId: 1,
    token: usdc,
    side: "buy",
    amount: "2000000000",
    reason: "inventory_rebalance",
  });
});

test("DeltaNeutralHedgePlanner fails closed without a reference asset", () => {
  assert.throws(() => plannerFor(false, false).plan(planInput()), /HEDGE_REFERENCE_ASSET_AMBIGUOUS/);
});

test("hedgePlanInputFromSettlementEvent preserves the economic settlement legs", () => {
  assert.deepEqual(hedgePlanInputFromSettlementEvent({
    settlementEventId: "se_1",
    status: "applied",
    quoteId: "q_1",
    chainId: 1,
    txHash: `0x${"11".repeat(32)}`,
    quoteHash: `0x${"22".repeat(32)}`,
    blockNumber: 10,
    logIndex: 2,
    user,
    tokenIn: weth,
    tokenOut: usdc,
    amountIn: "1000000000000000000",
    amountOut: "2000000000",
    nonce: "7",
    observedAt: "2026-07-14T00:00:00.000Z",
  }), planInput());
});

function plannerFor(tokenInUsdReference, tokenOutUsdReference) {
  return new DeltaNeutralHedgePlanner(new ConfiguredTokenRegistry({
    tokens: [
      token(weth, "WETH", 18, tokenInUsdReference),
      token(usdc, "USDC", 6, tokenOutUsdReference),
    ],
  }));
}

function token(tokenAddress, symbol, decimals, usdReference) {
  return {
    chainId: 1,
    tokenAddress,
    symbol,
    decimals,
    isWhitelisted: true,
    riskTier: "low",
    usdReference,
  };
}

function planInput() {
  return {
    settlementEventId: "se_1",
    quoteId: "q_1",
    chainId: 1,
    tokenIn: weth,
    tokenOut: usdc,
    amountIn: "1000000000000000000",
    amountOut: "2000000000",
  };
}
