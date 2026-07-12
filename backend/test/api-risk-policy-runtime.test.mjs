import assert from "node:assert/strict";
import test from "node:test";
import { buildServer } from "../dist/main.js";
import { InMemoryRiskDecisionRepository } from "../dist/modules/risk/risk-decision.repository.js";

const user = "0x0000000000000000000000000000000000000001";
const weth = "0x0000000000000000000000000000000000000002";
const usdc = "0x0000000000000000000000000000000000000003";

test("RFQ API applies configured chain/token limits to a cross-decimals quote", async () => {
  const originalRegistry = process.env.RFQ_TOKEN_REGISTRY_JSON;
  const originalPolicy = process.env.RFQ_RISK_POLICY_JSON;
  process.env.RFQ_TOKEN_REGISTRY_JSON = JSON.stringify(tokenRegistry());
  process.env.RFQ_RISK_POLICY_JSON = JSON.stringify(riskPolicy());
  const riskDecisionStore = new InMemoryRiskDecisionRepository();
  const server = buildServer({
    logger: false,
    riskDecisionStore,
    marketDataService: {
      async getSnapshot() {
        return {
          snapshotId: "snapshot_risk_policy",
          midPrice: "2000",
          liquidityUsd: "50000000",
          volatilityBps: 25,
          observedAt: new Date().toISOString(),
        };
      },
    },
  });

  try {
    await server.ready();
    const response = await server.inject({
      method: "POST",
      url: "/quote",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        chainId: 1,
        user,
        tokenIn: weth,
        tokenOut: usdc,
        amountIn: "1000000000000000000",
        slippageBps: 50,
      }),
    });

    assert.equal(response.statusCode, 200, response.payload);
    const quote = JSON.parse(response.payload);
    assert.equal(quote.amountOut, "1996800000");
    const decision = await riskDecisionStore.findByQuoteId(quote.quoteId);
    assert.equal(decision.decision, "approved");
    assert.equal(decision.policyVersion, "weth-usdc-risk-v1");

    const submit = await server.inject({
      method: "POST",
      url: "/submit",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        quote: {
          user,
          tokenIn: weth,
          tokenOut: usdc,
          amountIn: "1000000000000000000",
          amountOut: quote.amountOut,
          minAmountOut: quote.minAmountOut,
          nonce: quote.nonce,
          deadline: quote.deadline,
          chainId: 1,
        },
        signature: quote.signature,
      }),
    });
    assert.equal(submit.statusCode, 202, submit.payload);

    const pnlResponse = await server.inject({ method: "GET", url: "/pnl" });
    assert.equal(pnlResponse.statusCode, 200, pnlResponse.payload);
    const pnl = JSON.parse(pnlResponse.payload);
    assert.equal(pnl.totalTrades, 1);
    assert.equal(pnl.trades[0].fairAmountOut, "2000000000");
    assert.equal(pnl.trades[0].grossPnlTokenOut, "3200000");
    assert.equal(pnl.trades[0].grossPnlBps, 16);
    assert.equal(pnl.trades[0].tokenInDecimals, 18);
    assert.equal(pnl.trades[0].tokenOutDecimals, 6);
    assert.deepEqual(pnl.totals, [{
      chainId: 1,
      tokenOut: usdc,
      totalTrades: 1,
      grossPnlTokenOut: "3200000",
    }]);
  } finally {
    await server.close();
    restoreEnv("RFQ_TOKEN_REGISTRY_JSON", originalRegistry);
    restoreEnv("RFQ_RISK_POLICY_JSON", originalPolicy);
  }
});

test("RFQ API fails startup on malformed, unknown-token, and incomplete risk policies", () => {
  const originalRegistry = process.env.RFQ_TOKEN_REGISTRY_JSON;
  const originalPolicy = process.env.RFQ_RISK_POLICY_JSON;
  process.env.RFQ_TOKEN_REGISTRY_JSON = JSON.stringify(tokenRegistry());
  try {
    process.env.RFQ_RISK_POLICY_JSON = "{";
    assert.throws(() => buildServer({ logger: false }), /RFQ_RISK_POLICY_JSON must contain valid JSON/);

    const unknownTokenPolicy = riskPolicy();
    unknownTokenPolicy.tokenLimits.push({
      ...unknownTokenPolicy.tokenLimits[0],
      tokenAddress: "0x0000000000000000000000000000000000000004",
    });
    process.env.RFQ_RISK_POLICY_JSON = JSON.stringify(unknownTokenPolicy);
    assert.throws(() => buildServer({ logger: false }), /Risk policy token .* is not configured/);

    const incompletePolicy = riskPolicy();
    incompletePolicy.tokenLimits = incompletePolicy.tokenLimits.slice(0, 1);
    process.env.RFQ_RISK_POLICY_JSON = JSON.stringify(incompletePolicy);
    assert.throws(() => buildServer({ logger: false }), /no tokenOut limit for managed pair/);
  } finally {
    restoreEnv("RFQ_TOKEN_REGISTRY_JSON", originalRegistry);
    restoreEnv("RFQ_RISK_POLICY_JSON", originalPolicy);
  }
});

function tokenRegistry() {
  return {
    tokens: [
      {
        chainId: 1,
        tokenAddress: weth,
        symbol: "WETH",
        decimals: 18,
        isWhitelisted: true,
        riskTier: "medium",
        usdReference: false,
      },
      {
        chainId: 1,
        tokenAddress: usdc,
        symbol: "USDC",
        decimals: 6,
        isWhitelisted: true,
        riskTier: "low",
        usdReference: true,
      },
    ],
  };
}

function riskPolicy() {
  return {
    policyVersion: "weth-usdc-risk-v1",
    enabledChainIds: [1],
    tokenLimits: [
      {
        chainId: 1,
        tokenAddress: weth,
        maxAmountIn: "10000000000000000000",
        minAmountOut: "1",
        maxAbsoluteInventory: "100000000000000000000",
      },
      {
        chainId: 1,
        tokenAddress: usdc,
        maxAmountIn: "1000000000000",
        minAmountOut: "1",
        maxAbsoluteInventory: "10000000000000",
      },
    ],
    restrictedUsers: [],
    toxicFlowScores: [],
    maxToxicScoreBps: 8000,
    maxSlippageBps: 500,
    maxQuotedSpreadBps: 1000,
  };
}

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
