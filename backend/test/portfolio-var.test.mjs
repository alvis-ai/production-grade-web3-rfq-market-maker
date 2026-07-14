import assert from "node:assert/strict";
import test from "node:test";
import { ConfiguredTokenRegistry } from "../dist/modules/pricing/token-registry.js";
import {
  applyPortfolioDelta,
  calculatePortfolioVar,
  evaluatePortfolioVar,
  normalizePortfolioVarPolicy,
} from "../dist/modules/risk/portfolio-var.js";

const assetA = "0x0000000000000000000000000000000000000011";
const assetB = "0x0000000000000000000000000000000000000022";
const usd = "0x0000000000000000000000000000000000000033";
const observedAt = "2023-11-14T22:13:20.000Z";
const nowMs = Date.parse(observedAt) + 1_000;

test("portfolio VaR sums conservative direct and reverse valuation components", () => {
  const normalized = normalizePortfolioVarPolicy(policy(), registry());
  const positions = [
    position(assetA, 10n * 10n ** 18n),
    position(assetB, -5n * 10n ** 6n),
    position(usd, -990n * 10n ** 6n),
  ];
  const result = calculatePortfolioVar(1, positions, snapshots(), normalized, registry(), nowMs);

  assert.equal(result.totalVarUsdE18, (21n * 10n ** 18n).toString());
  assert.deepEqual(result.components, [
    {
      tokenAddress: assetA,
      balance: (10n * 10n ** 18n).toString(),
      exposureUsdE18: (1_000n * 10n ** 18n).toString(),
      volatilityBps: 100,
      componentVarUsdE18: (20n * 10n ** 18n).toString(),
      snapshotId: "snap_asset_a",
    },
    {
      tokenAddress: assetB,
      balance: (-5n * 10n ** 6n).toString(),
      exposureUsdE18: (-10n * 10n ** 18n).toString(),
      volatilityBps: 500,
      componentVarUsdE18: (1n * 10n ** 18n).toString(),
      snapshotId: "snap_asset_b_reverse",
    },
  ]);
});

test("portfolio VaR exposes replayable pre/post trade calculations", () => {
  const normalized = normalizePortfolioVarPolicy(policy(), registry());
  const preTrade = [position(assetA, 10n * 10n ** 18n), position(usd, -1_000n * 10n ** 6n)];
  const postTrade = applyPortfolioDelta(
    preTrade,
    1,
    assetA,
    1n * 10n ** 18n,
    usd,
    100n * 10n ** 6n,
  );
  const result = evaluatePortfolioVar(1, preTrade, postTrade, snapshots(), normalized, registry(), nowMs);

  assert.equal(result.modelVersion, "component-sum-v1");
  assert.equal(result.horizonSeconds, 86_400);
  assert.equal(result.preTradeVarUsdE18, (20n * 10n ** 18n).toString());
  assert.equal(result.postTradeVarUsdE18, (22n * 10n ** 18n).toString());
  assert.equal(result.varLimitUsdE18, (100n * 10n ** 18n).toString());
});

test("portfolio VaR rounds exposure and loss away from zero", () => {
  const normalized = normalizePortfolioVarPolicy({
    ...policy(),
    confidenceMultiplierBps: 1,
  }, registry());
  const result = calculatePortfolioVar(
    1,
    [position(assetA, 1n)],
    [{ ...snapshots()[0], midPrice: "0.000000000000000001", volatilityBps: 1 }],
    normalized,
    registry(),
    nowMs,
  );
  assert.equal(result.components[0].exposureUsdE18, "1");
  assert.equal(result.components[0].componentVarUsdE18, "1");
});

test("portfolio VaR fails closed for missing, stale, future, or unconfigured valuations", () => {
  const normalized = normalizePortfolioVarPolicy(policy(), registry());
  assert.throws(
    () => calculatePortfolioVar(1, [position(assetA, 1n)], [], normalized, registry(), nowMs),
    /no usable market snapshot/,
  );
  assert.throws(
    () => calculatePortfolioVar(
      1,
      [position(assetA, 1n)],
      [{ ...snapshots()[0], observedAt: "2023-11-14T22:13:10.000Z" }],
      normalized,
      registry(),
      nowMs,
    ),
    /is stale/,
  );
  assert.throws(
    () => calculatePortfolioVar(
      1,
      [position(assetA, 1n)],
      [{ ...snapshots()[0], observedAt: "2023-11-14T22:13:26.001Z" }],
      normalized,
      registry(),
      nowMs,
    ),
    /is from the future/,
  );
  assert.throws(
    () => calculatePortfolioVar(
      1,
      [position("0x0000000000000000000000000000000000000044", 1n)],
      snapshots(),
      normalized,
      registryWithUnknownAsset(),
      nowMs,
    ),
    /no valuation pair/,
  );
});

test("portfolio VaR policy validates valuation assets and immutable risk parameters", () => {
  assert.throws(
    () => normalizePortfolioVarPolicy({ ...policy(), maxPortfolioVarUsd: "0" }, registry()),
    /canonical positive uint256/,
  );
  assert.throws(
    () => normalizePortfolioVarPolicy({ ...policy(), unknown: true }, registry()),
    /unknown field unknown/,
  );
  assert.throws(
    () => normalizePortfolioVarPolicy({
      ...policy(),
      valuationPairs: [{ chainId: 1, tokenAddress: usd, usdReferenceTokenAddress: assetA }],
    }, registry()),
    /tokenAddress must not be a USD-reference token/,
  );
});

function policy() {
  return {
    modelVersion: "component-sum-v1",
    maxPortfolioVarUsd: "100",
    confidenceMultiplierBps: 20_000,
    horizonSeconds: 86_400,
    maxSnapshotAgeMs: 5_000,
    maxFutureSkewMs: 5_000,
    valuationPairs: [
      { chainId: 1, tokenAddress: assetA, usdReferenceTokenAddress: usd },
      { chainId: 1, tokenAddress: assetB, usdReferenceTokenAddress: usd },
    ],
  };
}

function snapshots() {
  return [
    {
      snapshotId: "snap_asset_a",
      chainId: 1,
      tokenIn: assetA,
      tokenOut: usd,
      midPrice: "100",
      volatilityBps: 100,
      observedAt,
    },
    {
      snapshotId: "snap_asset_b_reverse",
      chainId: 1,
      tokenIn: usd,
      tokenOut: assetB,
      midPrice: "0.5",
      volatilityBps: 500,
      observedAt,
    },
  ];
}

function position(tokenAddress, balance) {
  return { chainId: 1, tokenAddress, balance };
}

function registry() {
  return new ConfiguredTokenRegistry({
    tokens: [
      token(assetA, 18, false),
      token(assetB, 6, false),
      token(usd, 6, true),
    ],
  });
}

function registryWithUnknownAsset() {
  return new ConfiguredTokenRegistry({
    tokens: [
      token(assetA, 18, false),
      token(assetB, 6, false),
      token(usd, 6, true),
      token("0x0000000000000000000000000000000000000044", 18, false),
    ],
  });
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
