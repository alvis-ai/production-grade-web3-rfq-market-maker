import assert from "node:assert/strict";
import test from "node:test";
import {
  assertPortfolioDeltaEvaluation,
  assertPortfolioDeltaEvaluationMatchesPolicy,
  evaluatePortfolioDelta,
  exceedsPortfolioDeltaHardLimit,
  normalizePortfolioDeltaPolicy,
} from "../dist/modules/risk/portfolio-delta.js";

const tokenA = "0x0000000000000000000000000000000000000011";
const tokenB = "0x0000000000000000000000000000000000000022";

test("portfolio delta calculates signed net and absolute gross exposure", () => {
  const result = evaluatePortfolioDelta(varEvaluation(), normalizePortfolioDeltaPolicy(policy()), 1);
  assert.equal(result.preTradeGrossDeltaUsdE18, usd(110));
  assert.equal(result.preTradeNetDeltaUsdE18, usd(90));
  assert.equal(result.postTradeGrossDeltaUsdE18, usd(140));
  assert.equal(result.postTradeNetDeltaUsdE18, usd(100));
  assert.equal(result.softLimitBreached, true);
  assert.equal(exceedsPortfolioDeltaHardLimit(result), false);
  assert.deepEqual(result.postTradeComponents[0], {
    chainId: 1,
    tokenAddress: tokenA,
    balance: "120",
    exposureUsdE18: usd(120),
    snapshotId: "snap_a",
    softLimitUsdE18: usd(110),
    hardLimitUsdE18: usd(150),
    softLimitBreached: true,
  });
});

test("portfolio delta hard limits use exact strict boundaries", () => {
  const exact = evaluatePortfolioDelta(varEvaluation(), normalizePortfolioDeltaPolicy({
    ...policy(),
    hardGrossLimitUsd: "140",
    hardNetLimitUsd: "100",
  }), 1);
  assert.equal(exceedsPortfolioDeltaHardLimit(exact), false);
  const grossExceeded = evaluatePortfolioDelta(varEvaluation(), normalizePortfolioDeltaPolicy({
    ...policy(),
    hardGrossLimitUsd: "139",
  }), 1);
  assert.equal(exceedsPortfolioDeltaHardLimit(grossExceeded), true);
  const negativeNetExceeded = evaluatePortfolioDelta({
    ...varEvaluation(),
    preTradeComponents: [component(tokenA, "-100", "snap_a")],
    postTradeComponents: [component(tokenA, "-120", "snap_a")],
  }, normalizePortfolioDeltaPolicy({ ...policy(), hardNetLimitUsd: "119" }), 1);
  assert.equal(exceedsPortfolioDeltaHardLimit(negativeNetExceeded), true);
});

test("portfolio delta applies token limits independently from portfolio limits", () => {
  const tokenLimitedPolicy = {
    ...policy(),
    softGrossLimitUsd: "1000",
    hardGrossLimitUsd: "2000",
    softNetLimitUsd: "1000",
    hardNetLimitUsd: "2000",
    assetLimits: policy().assetLimits.map((limit) =>
      limit.tokenAddress === tokenA
        ? { ...limit, softLimitUsd: "110", hardLimitUsd: "119" }
        : limit),
  };
  const evaluation = evaluatePortfolioDelta(
    varEvaluation(),
    normalizePortfolioDeltaPolicy(tokenLimitedPolicy),
    1,
  );
  assert.equal(evaluation.softLimitBreached, true);
  assert.equal(evaluation.postTradeComponents[0].softLimitBreached, true);
  assert.equal(exceedsPortfolioDeltaHardLimit(evaluation), true);
});

test("portfolio delta policy rejects unknown, zero, and inverted limits", () => {
  assert.throws(
    () => normalizePortfolioDeltaPolicy({ ...policy(), unknown: true }),
    /unknown field unknown/,
  );
  assert.throws(
    () => normalizePortfolioDeltaPolicy({ ...policy(), softNetLimitUsd: "0" }),
    /canonical positive uint256/,
  );
  assert.throws(
    () => normalizePortfolioDeltaPolicy({ ...policy(), softGrossLimitUsd: "201" }),
    /must not exceed hardGrossLimitUsd/,
  );
  assert.throws(
    () => normalizePortfolioDeltaPolicy({
      ...policy(),
      assetLimits: [...policy().assetLimits, { ...policy().assetLimits[0] }],
    }),
    /must not contain duplicates/,
  );
  const missingAssetPolicy = normalizePortfolioDeltaPolicy({
    ...policy(),
    assetLimits: policy().assetLimits.filter((limit) => limit.tokenAddress !== tokenB),
  });
  assert.throws(
    () => evaluatePortfolioDelta(varEvaluation(), missingAssetPolicy, 1),
    /has no asset limit/,
  );
});

test("portfolio delta evaluation rejects inconsistent persisted evidence", () => {
  const normalizedPolicy = normalizePortfolioDeltaPolicy(policy());
  const evaluation = evaluatePortfolioDelta(varEvaluation(), normalizedPolicy, 1);
  assert.doesNotThrow(() => assertPortfolioDeltaEvaluation(evaluation));
  assert.doesNotThrow(() => assertPortfolioDeltaEvaluationMatchesPolicy(evaluation, normalizedPolicy, 1));
  assert.throws(
    () => assertPortfolioDeltaEvaluation({ ...evaluation, postTradeNetDeltaUsdE18: usd(99) }),
    /aggregates must match components/,
  );
  assert.throws(
    () => assertPortfolioDeltaEvaluation({ ...evaluation, softLimitBreached: false }),
    /softLimitBreached is inconsistent/,
  );
  assert.throws(
    () => assertPortfolioDeltaEvaluation({
      ...evaluation,
      postTradeComponents: evaluation.postTradeComponents.map((component, index) =>
        index === 0 ? { ...component, softLimitBreached: false } : component),
    }),
    /component.softLimitBreached is inconsistent/,
  );
  assert.throws(
    () => assertPortfolioDeltaEvaluation({
      ...evaluation,
      postTradeComponents: evaluation.postTradeComponents.map((component, index) =>
        index === 0 ? { ...component, snapshotId: "different_snapshot" } : component),
    }),
    /snapshots and limits must match/,
  );
  assert.throws(
    () => assertPortfolioDeltaEvaluationMatchesPolicy(
      evaluation,
      normalizePortfolioDeltaPolicy({ ...policy(), hardGrossLimitUsd: "201" }),
      1,
    ),
    /does not match active portfolio policy/,
  );
});

function policy() {
  return {
    modelVersion: "gross-net-asset-delta-v2",
    softGrossLimitUsd: "120",
    hardGrossLimitUsd: "200",
    softNetLimitUsd: "95",
    hardNetLimitUsd: "150",
    assetLimits: [
      {
        chainId: 1,
        tokenAddress: tokenA,
        softLimitUsd: "110",
        hardLimitUsd: "150",
      },
      {
        chainId: 1,
        tokenAddress: tokenB,
        softLimitUsd: "30",
        hardLimitUsd: "50",
      },
    ],
  };
}

function varEvaluation() {
  return {
    modelVersion: "component-sum-v1",
    horizonSeconds: 86400,
    preTradeVarUsdE18: "1",
    postTradeVarUsdE18: "1",
    varLimitUsdE18: "2",
    preTradeComponents: [component(tokenA, "100", "snap_a"), component(tokenB, "-10", "snap_b")],
    postTradeComponents: [component(tokenA, "120", "snap_a"), component(tokenB, "-20", "snap_b")],
  };
}

function component(tokenAddress, exposureUsdE18, snapshotId) {
  return {
    tokenAddress,
    balance: exposureUsdE18,
    exposureUsdE18: usd(Number(exposureUsdE18)),
    volatilityBps: 100,
    componentVarUsdE18: "1",
    snapshotId,
  };
}

function usd(value) {
  return (BigInt(value) * 10n ** 18n).toString();
}
