import assert from "node:assert/strict";
import test from "node:test";
import { ConfiguredTokenRegistry } from "../dist/modules/pricing/token-registry.js";
import {
  assertDailyLossLimitCoverage,
  assertProductionDailyLossRiskPolicy,
  buildDailyLossRiskEngine,
} from "../dist/runtime/gateway-daily-loss-risk.js";

const weth = "0x0000000000000000000000000000000000000002";
const usdc = "0x0000000000000000000000000000000000000003";
const usdt = "0x0000000000000000000000000000000000000004";

test("daily loss runtime is optional locally and mandatory with PostgreSQL in production", () => {
  const base = approvedRisk();
  assert.equal(buildDailyLossRiskEngine(base, registry(), pairs(), undefined, {}), base);
  assert.doesNotThrow(() => assertProductionDailyLossRiskPolicy(true, fakePool(), {}));
  assert.throws(
    () => assertProductionDailyLossRiskPolicy(true, fakePool(), { NODE_ENV: "production" }),
    /RFQ_DAILY_LOSS_CONFIG_JSON is required/,
  );
  assert.throws(
    () => assertProductionDailyLossRiskPolicy(true, undefined, productionEnv()),
    /requires PostgreSQL/,
  );
  assert.doesNotThrow(() => assertProductionDailyLossRiskPolicy(false, undefined, { NODE_ENV: "production" }));
  assert.throws(
    () => buildDailyLossRiskEngine(base, registry(), pairs(), undefined, productionEnv()),
    /requires PostgreSQL/,
  );
});

test("daily loss runtime validates complete managed USD-reference coverage", () => {
  const valid = parsedConfig();
  assert.doesNotThrow(() => assertDailyLossLimitCoverage(valid, registry(), pairs()));
  assert.throws(
    () => assertDailyLossLimitCoverage({ ...valid, limits: [] }, registry(), pairs()),
    /no limit for managed USD reference/,
  );
  assert.throws(
    () => assertDailyLossLimitCoverage({
      ...valid,
      limits: [{ chainId: 1, tokenAddress: weth, maxLossUsdE18: "1" }],
    }, registry(), pairs()),
    /is not a whitelisted USD reference/,
  );
  assert.throws(
    () => assertDailyLossLimitCoverage(valid, registry(), [{ chainId: 1, tokenIn: usdt, tokenOut: usdc }]),
    /no limit for managed USD reference.*0004/,
  );
});

test("daily loss runtime wraps approved risk with PostgreSQL evidence and metrics observer", async () => {
  const events = [];
  const pool = fakePool("-100.000000000000000000");
  const engine = buildDailyLossRiskEngine(
    approvedRisk(),
    registry(),
    pairs(),
    pool,
    productionEnv(),
    {
      recordDailyLossRiskObservation(...args) { events.push(["observation", ...args]); },
      recordDailyLossRiskFailure(...args) { events.push(["failure", ...args]); },
    },
  );
  const decision = await engine.evaluate(riskInput());
  assert.equal(decision.status, "rejected");
  assert.equal(decision.reasonCode, "DAILY_LOSS_LIMIT_EXCEEDED");
  assert.deepEqual(events, [[
    "observation",
    1,
    usdc,
    "-100000000000000000000",
    "100000000000000000000",
  ]]);
});

function productionEnv() {
  return {
    NODE_ENV: "production",
    RFQ_DAILY_LOSS_CONFIG_JSON: JSON.stringify(parsedConfig()),
  };
}

function parsedConfig() {
  return {
    policyVersion: "daily-loss-v1",
    limits: [{ chainId: 1, tokenAddress: usdc, maxLossUsdE18: "100000000000000000000" }],
  };
}

function pairs() {
  return [{ chainId: 1, tokenIn: weth, tokenOut: usdc }];
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

function approvedRisk() {
  return { async evaluate() { return { status: "approved", policyVersion: "base-risk-v1" }; } };
}

function fakePool(netPnl = "0") {
  return {
    async connect() {
      return {
        async query() {
          return { rows: [{
            net_pnl: netPnl,
            unavailable_count: "0",
            window_started_at: new Date("2026-07-16T00:00:00.000Z"),
            observed_at: new Date("2026-07-16T08:00:00.000Z"),
          }] };
        },
        release() {},
      };
    },
  };
}

function riskInput() {
  return {
    request: {
      chainId: 1,
      user: "0x0000000000000000000000000000000000000001",
      tokenIn: weth,
      tokenOut: usdc,
      amountIn: "1",
      slippageBps: 50,
    },
    pricing: {},
    snapshot: {},
  };
}
