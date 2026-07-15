import assert from "node:assert/strict";
import test from "node:test";
import { ConfiguredTokenRegistry } from "../dist/modules/pricing/token-registry.js";
import { InventoryService } from "../dist/modules/inventory/inventory.service.js";
import { InMemoryMarketSnapshotRepository } from "../dist/modules/market-data/market-snapshot.repository.js";
import {
  InMemoryQuoteExposureStore,
  normalizeQuoteExposurePolicy,
} from "../dist/modules/risk/quote-exposure.store.js";

const tokenA = "0x0000000000000000000000000000000000000011";
const tokenB = "0x0000000000000000000000000000000000000022";
const userA = "0x00000000000000000000000000000000000000a1";
const userB = "0x00000000000000000000000000000000000000b2";

test("InMemoryQuoteExposureStore enforces exact user open-notional boundaries", async () => {
  const now = 1_700_000_000;
  const store = new InMemoryQuoteExposureStore(
    policy("202", "500"),
    registry(),
    () => now,
  );

  assert.equal((await store.reserve(input("q_user_1", userA, now + 30))).status, "reserved");
  assert.equal((await store.reserve(input("q_user_2", userA, now + 30))).status, "reserved");
  assert.deepEqual(await store.reserve(input("q_user_3", userA, now + 30)), {
    status: "rejected",
    reasonCode: "USER_OPEN_NOTIONAL_LIMIT_EXCEEDED",
  });
});

test("InMemoryQuoteExposureStore canonicalizes pair direction across users", async () => {
  const now = 1_700_000_000;
  const store = new InMemoryQuoteExposureStore(
    policy("150", "200"),
    registry(),
    () => now,
  );

  assert.equal((await store.reserve(input("q_pair_1", userA, now + 30))).status, "reserved");
  assert.deepEqual(await store.reserve(reverseInput("q_pair_2", userB, now + 30)), {
    status: "rejected",
    reasonCode: "PAIR_OPEN_NOTIONAL_LIMIT_EXCEEDED",
  });
});

test("InMemoryQuoteExposureStore releases failures and stops counting expired quotes", async () => {
  let now = 1_700_000_000;
  const store = new InMemoryQuoteExposureStore(
    policy("101", "202"),
    registry(),
    () => now,
  );

  assert.equal((await store.reserve(input("q_release_1", userA, now + 30))).status, "reserved");
  await store.release("q_release_1");
  assert.equal((await store.reserve(input("q_release_2", userA, now + 1))).status, "reserved");
  now += 2;
  assert.equal((await store.reserve(input("q_after_expiry", userA, now + 30))).status, "reserved");
});

test("InMemoryQuoteExposureStore reserves output liquidity across concurrent quotes until expiry", async () => {
  let now = 1_700_000_000;
  const store = new InMemoryQuoteExposureStore(policy("1000", "1000"), registry(), () => now);
  const first = withLiquidity(input("q_liquidity_1", userA, now + 30), "150000000000000000000");
  const second = withLiquidity(input("q_liquidity_2", userB, now + 30), "150000000000000000000");

  assert.equal((await store.reserve(first)).status, "reserved");
  assert.deepEqual(await store.reserve(second), {
    status: "rejected",
    reasonCode: "TREASURY_LIQUIDITY_INSUFFICIENT",
  });

  now += 31;
  assert.equal((await store.reserve(withLiquidity(
    input("q_liquidity_after_expiry", userB, now + 30),
    "101000000000000000000",
  ))).status, "reserved");
});

test("InMemoryQuoteExposureStore rounds sub-E18 USD reference units up", async () => {
  const now = 1_700_000_000;
  const highDecimals = "0x0000000000000000000000000000000000000033";
  const nonUsd = "0x0000000000000000000000000000000000000044";
  const store = new InMemoryQuoteExposureStore(
    policy("1", "1"),
    registry([
      token(highDecimals, 24, true),
      token(nonUsd, 18, false),
    ]),
    () => now,
  );
  const result = await store.reserve({
    quoteId: "q_round_up",
    request: request(userA, highDecimals, nonUsd, "1"),
    pricing: pricing("1"),
    deadline: now + 30,
  });
  assert.deepEqual(result, { status: "reserved", notionalUsdE18: "1" });
});

test("InMemoryQuoteExposureStore serializes concurrent portfolio VaR reservations", async () => {
  const now = 1_700_000_000;
  const tokenRegistry = registry([
    token(tokenA, 6, false),
    token(tokenB, 18, true),
  ]);
  const marketSnapshotStore = new InMemoryMarketSnapshotRepository();
  await marketSnapshotStore.saveSnapshot({
    request: request(userA, tokenA, tokenB, "100000000"),
    snapshot: {
      snapshotId: "portfolio_var_snapshot",
      midPrice: "1.01",
      liquidityUsd: "1000000",
      marketSpreadBps: 10,
      volatilityBps: 1_000,
      observedAt: new Date(now * 1_000).toISOString(),
    },
  });
  const store = new InMemoryQuoteExposureStore(
    {
      ...policy("1000", "1000"),
      portfolioVar: portfolioVarPolicy("30"),
    },
    tokenRegistry,
    () => now,
    { inventoryService: new InventoryService(), marketSnapshotStore },
  );

  const results = await Promise.all([
    store.reserve(input("q_var_concurrent_1", userA, now + 30)),
    store.reserve(input("q_var_concurrent_2", userB, now + 30)),
  ]);
  assert.equal(results.filter((result) => result.status === "reserved").length, 1);
  assert.deepEqual(results.find((result) => result.status === "rejected"), {
    status: "rejected",
    reasonCode: "PORTFOLIO_VAR_LIMIT_EXCEEDED",
  });
  const reserved = results.find((result) => result.status === "reserved");
  assert.equal(reserved.portfolioVar.preTradeVarUsdE18, "0");
  assert.equal(reserved.portfolioVar.postTradeVarUsdE18, "20200000000000000000");
});

test("InMemoryQuoteExposureStore enforces hard delta and replays soft-breach evidence", async () => {
  const now = 1_700_000_000;
  const tokenRegistry = registry([token(tokenA, 6, false), token(tokenB, 18, true)]);
  const marketSnapshotStore = new InMemoryMarketSnapshotRepository();
  await marketSnapshotStore.saveSnapshot({
    request: request(userA, tokenA, tokenB, "100000000"),
    snapshot: {
      snapshotId: "portfolio_delta_snapshot",
      midPrice: "1.01",
      liquidityUsd: "1000000",
      marketSpreadBps: 10,
      volatilityBps: 1_000,
      observedAt: new Date(now * 1_000).toISOString(),
    },
  });
  let softBreaches = 0;
  const store = new InMemoryQuoteExposureStore(
    {
      ...policy("1000", "1000"),
      portfolioVar: portfolioVarPolicy("100"),
      portfolioDelta: portfolioDeltaPolicy("50", "150"),
    },
    tokenRegistry,
    () => now,
    { inventoryService: new InventoryService(), marketSnapshotStore },
    { recordPortfolioDeltaSoftBreach: () => { softBreaches += 1; } },
  );

  const firstInput = input("q_delta_first", userA, now + 30);
  const first = await store.reserve(firstInput);
  assert.equal(first.status, "reserved");
  assert.equal(first.portfolioDelta.postTradeGrossDeltaUsdE18, "101000000000000000000");
  assert.equal(first.portfolioDelta.softLimitBreached, true);
  assert.deepEqual(await store.reserve(firstInput), first);
  assert.equal(softBreaches, 1);
  assert.deepEqual(await store.reserve(input("q_delta_second", userB, now + 30)), {
    status: "rejected",
    reasonCode: "PORTFOLIO_DELTA_LIMIT_EXCEEDED",
  });
  assert.equal(softBreaches, 1);
});

test("quote exposure policy validates independent user and pair limits", () => {
  assert.deepEqual(
    normalizeQuoteExposurePolicy({ maxUserOpenNotionalUsd: "200", maxPairOpenNotionalUsd: "100" }),
    {
      maxUserOpenNotionalUsdE18: 200n * 10n ** 18n,
      maxPairOpenNotionalUsdE18: 100n * 10n ** 18n,
    },
  );
  assert.throws(
    () => normalizeQuoteExposurePolicy({ maxUserOpenNotionalUsd: "0", maxPairOpenNotionalUsd: "200" }),
    /canonical positive uint256 string/,
  );
  assert.throws(
    () => normalizeQuoteExposurePolicy({
      maxUserOpenNotionalUsd: "100",
      maxPairOpenNotionalUsd: "200",
      unknown: true,
    }),
    /unknown field unknown/,
  );
});

function input(quoteId, user, deadline) {
  return {
    quoteId,
    request: request(user, tokenA, tokenB, "100000000"),
    pricing: pricing("101000000000000000000"),
    deadline,
  };
}

function reverseInput(quoteId, user, deadline) {
  return {
    quoteId,
    request: request(user, tokenB, tokenA, "101000000000000000000"),
    pricing: pricing("100000000"),
    deadline,
  };
}

function withLiquidity(value, availableBalance) {
  return {
    ...value,
    treasuryLiquidity: {
      chainId: 1,
      settlementAddress: "0x0000000000000000000000000000000000000044",
      treasuryAddress: "0x0000000000000000000000000000000000000055",
      token: value.request.tokenOut,
      availableBalance,
      blockNumber: 123n,
    },
  };
}

function request(user, tokenIn, tokenOut, amountIn) {
  return { chainId: 1, user, tokenIn, tokenOut, amountIn, slippageBps: 50 };
}

function pricing(amountOut) {
  return {
    amountOut,
    minAmountOut: amountOut,
    spreadBps: 10,
    sizeImpactBps: 1,
    marketSpreadBps: 0,
    inventorySkewBps: 0,
    volatilityPremiumBps: 0,
    hedgeCostBps: 0,
    pricingVersion: "exposure-test-v1",
  };
}

function policy(maxUserOpenNotionalUsd, maxPairOpenNotionalUsd) {
  return { maxUserOpenNotionalUsd, maxPairOpenNotionalUsd };
}

function registry(tokens = [token(tokenA, 6, true), token(tokenB, 18, true)]) {
  return new ConfiguredTokenRegistry({ tokens });
}

function portfolioVarPolicy(maxPortfolioVarUsd) {
  return {
    modelVersion: "component-sum-v1",
    maxPortfolioVarUsd,
    confidenceMultiplierBps: 20_000,
    horizonSeconds: 86_400,
    maxSnapshotAgeMs: 5_000,
    maxFutureSkewMs: 5_000,
    valuationPairs: [{
      chainId: 1,
      tokenAddress: tokenA,
      usdReferenceTokenAddress: tokenB,
    }],
  };
}

function portfolioDeltaPolicy(softLimitUsd, hardLimitUsd) {
  return {
    modelVersion: "gross-net-delta-v1",
    softGrossLimitUsd: softLimitUsd,
    hardGrossLimitUsd: hardLimitUsd,
    softNetLimitUsd: softLimitUsd,
    hardNetLimitUsd: hardLimitUsd,
  };
}

function token(tokenAddress, decimals, usdReference) {
  return {
    chainId: 1,
    tokenAddress,
    symbol: `T${decimals}`,
    decimals,
    isWhitelisted: true,
    riskTier: "low",
    usdReference,
  };
}
