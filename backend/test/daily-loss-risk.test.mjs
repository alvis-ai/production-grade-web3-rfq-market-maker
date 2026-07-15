import assert from "node:assert/strict";
import test from "node:test";
import {
  DailyLossEvidenceError,
  DailyLossRiskEngine,
  parseDailyLossRiskConfig,
} from "../dist/modules/risk/daily-loss-risk.engine.js";
import { PostgresDailyLossEvidenceProvider } from "../dist/modules/risk/postgres-daily-loss-evidence.provider.js";
import { ConfiguredTokenRegistry } from "../dist/modules/pricing/token-registry.js";

const weth = "0x0000000000000000000000000000000000000002";
const usdc = "0x0000000000000000000000000000000000000003";
const usdt = "0x0000000000000000000000000000000000000004";
const windowStartedAt = "2026-07-16T00:00:00.000Z";
const observedAt = "2026-07-16T08:00:00.000Z";

test("DailyLossRiskEngine approves below the limit and rejects the exact loss boundary", async () => {
  let netPnlUsdE18 = "-99999999999999999999";
  const observations = [];
  const engine = new DailyLossRiskEngine(
    approvedRisk(),
    registry(),
    { async getDailyLossEvidence(chainId, tokenAddress) {
      return evidence({ chainId, tokenAddress, netPnlUsdE18 });
    } },
    config(),
    observer(observations),
  );

  const approved = await engine.evaluate(riskInput());
  assert.equal(approved.status, "approved");
  assert.match(approved.policyVersion, /^base-risk-v1:daily-loss-v1:dl[0-9a-f]{24}$/);
  assert.deepEqual(observations, [["observation", 1, usdc, netPnlUsdE18, "100000000000000000000"]]);

  netPnlUsdE18 = "-100000000000000000000";
  const rejected = await engine.evaluate(riskInput());
  assert.deepEqual(rejected, {
    status: "rejected",
    reasonCode: "DAILY_LOSS_LIMIT_EXCEEDED",
    policyVersion: rejected.policyVersion,
  });
  assert.notEqual(rejected.policyVersion, approved.policyVersion);
  await assert.rejects(engine.checkHealth(), /Daily loss limit exceeded/);
});

test("DailyLossRiskEngine uses tokenIn for two USD references and skips evidence after base rejection", async () => {
  const requestedTokens = [];
  const provider = {
    async getDailyLossEvidence(chainId, tokenAddress) {
      requestedTokens.push(tokenAddress);
      return evidence({ chainId, tokenAddress, netPnlUsdE18: "0" });
    },
  };
  const engine = new DailyLossRiskEngine(approvedRisk(), registry(), provider, config({
    limits: [
      config().limits[0],
      { chainId: 1, tokenAddress: usdt, maxLossUsdE18: "100000000000000000000" },
    ],
  }));
  assert.equal((await engine.evaluate(riskInput({ tokenIn: usdt, tokenOut: usdc }))).status, "approved");
  assert.deepEqual(requestedTokens, [usdt]);

  const rejectedBase = new DailyLossRiskEngine(
    { async evaluate() { return { status: "rejected", reasonCode: "TOKEN_NOT_ALLOWED", policyVersion: "base" }; } },
    registry(),
    provider,
    config(),
  );
  assert.equal((await rejectedBase.evaluate(riskInput())).reasonCode, "TOKEN_NOT_ALLOWED");
  assert.deepEqual(requestedTokens, [usdt]);
});

test("DailyLossRiskEngine fails closed on malformed evidence and isolates observer failures", async () => {
  const failures = [];
  const invalid = new DailyLossRiskEngine(
    approvedRisk(),
    registry(),
    { async getDailyLossEvidence() { return { ...evidence(), netPnlUsdE18: "01" }; } },
    config(),
    observer(failures),
  );
  await assert.rejects(invalid.evaluate(riskInput()), /net PnL is invalid/);
  assert.deepEqual(failures, [["failure", 1, usdc, "EVIDENCE_INVALID"]]);

  const metricsUnavailable = {
    recordDailyLossRiskObservation() { throw new Error("metrics unavailable"); },
    recordDailyLossRiskFailure() { throw new Error("metrics unavailable"); },
  };
  const safe = new DailyLossRiskEngine(
    approvedRisk(),
    registry(),
    { async getDailyLossEvidence() { return evidence(); } },
    config(),
    metricsUnavailable,
  );
  assert.equal((await safe.evaluate(riskInput())).status, "approved");
});

test("daily loss config parser rejects unknown, duplicate, and unbounded limits", () => {
  assert.deepEqual(parseDailyLossRiskConfig(JSON.stringify(config())), config());
  assert.throws(() => parseDailyLossRiskConfig("{}"), /fields are invalid/);
  assert.throws(
    () => parseDailyLossRiskConfig(JSON.stringify({ ...config(), unknown: true })),
    /fields are invalid/,
  );
  assert.throws(
    () => parseDailyLossRiskConfig(JSON.stringify({ ...config(), limits: [config().limits[0], config().limits[0]] })),
    /duplicate chain\/token limits/,
  );
  assert.throws(
    () => parseDailyLossRiskConfig(JSON.stringify({ ...config(), limits: [] })),
    /between 1 and 100 limits/,
  );
});

test("PostgresDailyLossEvidenceProvider reads one UTC window with exact decimal scaling", async () => {
  const queries = [];
  let released = 0;
  const provider = new PostgresDailyLossEvidenceProvider({
    async connect() {
      return {
        async query(sql, params) {
          queries.push({ sql, params });
          return { rows: [{
            net_pnl: "-12.3456",
            unavailable_count: "0",
            window_started_at: new Date(windowStartedAt),
            observed_at: new Date(observedAt),
          }] };
        },
        release() { released += 1; },
      };
    },
  });
  assert.deepEqual(await provider.getDailyLossEvidence(1, usdc), evidence({
    netPnlUsdE18: "-12345600000000000000",
  }));
  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /date_trunc\('day', now\(\) AT TIME ZONE 'UTC'\)/);
  assert.match(queries[0].sql, /FILTER \(WHERE hedge_net_pnl_status = 'complete'\)/);
  assert.match(queries[0].sql, /hedge_net_pnl_status IN \('complete', 'unavailable'\)/);
  assert.deepEqual(queries[0].params, [1, usdc]);
  assert.equal(released, 1);
});

test("PostgresDailyLossEvidenceProvider classifies store and row failures", async () => {
  const unavailable = new PostgresDailyLossEvidenceProvider({ async connect() { throw new Error("offline"); } });
  await assert.rejects(
    unavailable.getDailyLossEvidence(1, usdc),
    (error) => error instanceof DailyLossEvidenceError && error.code === "STORE_UNAVAILABLE",
  );

  let released = 0;
  const invalid = new PostgresDailyLossEvidenceProvider({ async connect() { return {
    async query() { return { rows: [{
      net_pnl: "NaN",
      unavailable_count: "0",
      window_started_at: windowStartedAt,
      observed_at: observedAt,
    }] }; },
    release() { released += 1; },
  }; } });
  await assert.rejects(
    invalid.getDailyLossEvidence(1, usdc),
    (error) => error instanceof DailyLossEvidenceError && error.code === "EVIDENCE_INVALID",
  );
  assert.equal(released, 1);

  const incomplete = new PostgresDailyLossEvidenceProvider({ async connect() { return {
    async query() { return { rows: [{
      net_pnl: "0",
      unavailable_count: "1",
      window_started_at: windowStartedAt,
      observed_at: observedAt,
    }] }; },
    release() {},
  }; } });
  await assert.rejects(
    incomplete.getDailyLossEvidence(1, usdc),
    (error) => error instanceof DailyLossEvidenceError && error.code === "EVIDENCE_INVALID",
  );
});

function approvedRisk() {
  return {
    async evaluate() { return { status: "approved", policyVersion: "base-risk-v1" }; },
    async checkHealth() {},
  };
}

function config(overrides = {}) {
  return {
    policyVersion: "daily-loss-v1",
    limits: [{ chainId: 1, tokenAddress: usdc, maxLossUsdE18: "100000000000000000000" }],
    ...overrides,
  };
}

function evidence(overrides = {}) {
  return {
    chainId: 1,
    tokenAddress: usdc,
    netPnlUsdE18: "0",
    windowStartedAt,
    observedAt,
    ...overrides,
  };
}

function observer(events) {
  return {
    recordDailyLossRiskObservation(chainId, tokenAddress, netPnlUsdE18, maxLossUsdE18) {
      events.push(["observation", chainId, tokenAddress, netPnlUsdE18, maxLossUsdE18]);
    },
    recordDailyLossRiskFailure(chainId, tokenAddress, reason) {
      events.push(["failure", chainId, tokenAddress, reason]);
    },
  };
}

function registry() {
  return new ConfiguredTokenRegistry({ tokens: [
    token(weth, "WETH", false),
    token(usdc, "USDC", true),
    token(usdt, "USDT", true),
  ] });
}

function token(tokenAddress, symbol, usdReference) {
  return {
    chainId: 1,
    tokenAddress,
    symbol,
    decimals: symbol === "WETH" ? 18 : 6,
    isWhitelisted: true,
    riskTier: "low",
    usdReference,
  };
}

function riskInput(overrides = {}) {
  return {
    request: {
      chainId: 1,
      user: "0x0000000000000000000000000000000000000001",
      tokenIn: weth,
      tokenOut: usdc,
      amountIn: "1000000000000000000",
      slippageBps: 50,
      ...overrides,
    },
    pricing: {
      amountOut: "1000000",
      minAmountOut: "995000",
      spreadBps: 10,
      sizeImpactBps: 1,
      marketSpreadBps: 1,
      inventorySkewBps: 0,
      volatilityPremiumBps: 1,
      hedgeCostBps: 0,
      pricingVersion: "pricing-v1",
    },
    snapshot: {
      snapshotId: "snapshot_1",
      midPrice: "1",
      liquidityUsd: "1000000",
      marketSpreadBps: 1,
      volatilityBps: 10,
      observedAt,
    },
  };
}
