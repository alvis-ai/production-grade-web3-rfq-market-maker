import assert from "node:assert/strict";
import test from "node:test";
import {
  assertPortfolioDeltaEvaluation,
  evaluatePortfolioDelta,
  exceedsPortfolioDeltaHardLimit,
  normalizePortfolioDeltaPolicy,
} from "../dist/modules/risk/portfolio-delta.js";

const tokenA = "0x0000000000000000000000000000000000000011";
const tokenB = "0x0000000000000000000000000000000000000022";

test("portfolio delta calculates signed net and absolute gross exposure", () => {
  const result = evaluatePortfolioDelta(varEvaluation(), normalizePortfolioDeltaPolicy(policy()));
  assert.equal(result.preTradeGrossDeltaUsdE18, usd(110));
  assert.equal(result.preTradeNetDeltaUsdE18, usd(90));
  assert.equal(result.postTradeGrossDeltaUsdE18, usd(140));
  assert.equal(result.postTradeNetDeltaUsdE18, usd(100));
  assert.equal(result.softLimitBreached, true);
  assert.equal(exceedsPortfolioDeltaHardLimit(result), false);
  assert.deepEqual(result.postTradeComponents[0], {
    tokenAddress: tokenA,
    balance: "120",
    exposureUsdE18: usd(120),
    snapshotId: "snap_a",
  });
});

test("portfolio delta hard limits use exact strict boundaries", () => {
  const exact = evaluatePortfolioDelta(varEvaluation(), normalizePortfolioDeltaPolicy({
    ...policy(),
    hardGrossLimitUsd: "140",
    hardNetLimitUsd: "100",
  }));
  assert.equal(exceedsPortfolioDeltaHardLimit(exact), false);
  const grossExceeded = evaluatePortfolioDelta(varEvaluation(), normalizePortfolioDeltaPolicy({
    ...policy(),
    hardGrossLimitUsd: "139",
  }));
  assert.equal(exceedsPortfolioDeltaHardLimit(grossExceeded), true);
  const negativeNetExceeded = evaluatePortfolioDelta({
    ...varEvaluation(),
    postTradeComponents: [component(tokenA, "-120", "snap_a")],
  }, normalizePortfolioDeltaPolicy({ ...policy(), hardNetLimitUsd: "119" }));
  assert.equal(exceedsPortfolioDeltaHardLimit(negativeNetExceeded), true);
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
});

test("portfolio delta evaluation rejects inconsistent persisted evidence", () => {
  const evaluation = evaluatePortfolioDelta(varEvaluation(), normalizePortfolioDeltaPolicy(policy()));
  assert.doesNotThrow(() => assertPortfolioDeltaEvaluation(evaluation));
  assert.throws(
    () => assertPortfolioDeltaEvaluation({ ...evaluation, postTradeNetDeltaUsdE18: usd(99) }),
    /aggregates must match components/,
  );
  assert.throws(
    () => assertPortfolioDeltaEvaluation({ ...evaluation, softLimitBreached: false }),
    /softLimitBreached is inconsistent/,
  );
});

function policy() {
  return {
    modelVersion: "gross-net-delta-v1",
    softGrossLimitUsd: "120",
    hardGrossLimitUsd: "200",
    softNetLimitUsd: "95",
    hardNetLimitUsd: "150",
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
