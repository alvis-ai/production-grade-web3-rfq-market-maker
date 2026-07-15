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
          marketSpreadBps: 0,
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
    assert.throws(() => buildServer({ logger: false }), /USD reference must have a token risk limit/);

    const noUsdRegistry = tokenRegistry();
    noUsdRegistry.tokens = noUsdRegistry.tokens.map((token) => ({ ...token, usdReference: false }));
    process.env.RFQ_TOKEN_REGISTRY_JSON = JSON.stringify(noUsdRegistry);
    process.env.RFQ_RISK_POLICY_JSON = JSON.stringify(riskPolicy());
    assert.throws(() => buildServer({
      logger: false,
      pricingEngine: {
        async price() {
          throw new Error("not used during startup");
        },
      },
    }), /must be a USD-reference token/);
  } finally {
    restoreEnv("RFQ_TOKEN_REGISTRY_JSON", originalRegistry);
    restoreEnv("RFQ_RISK_POLICY_JSON", originalPolicy);
  }
});

test("RFQ API rejects a cross-decimals quote above its USD notional limit", async () => {
  const originalRegistry = process.env.RFQ_TOKEN_REGISTRY_JSON;
  const originalPolicy = process.env.RFQ_RISK_POLICY_JSON;
  process.env.RFQ_TOKEN_REGISTRY_JSON = JSON.stringify(tokenRegistry());
  const configuredPolicy = riskPolicy();
  configuredPolicy.tokenLimits = configuredPolicy.tokenLimits.map((limit) => ({
    ...limit,
    maxNotionalUsd: "1500",
  }));
  process.env.RFQ_RISK_POLICY_JSON = JSON.stringify(configuredPolicy);
  const server = buildServer({
    logger: false,
    marketDataService: {
      async getSnapshot() {
        return {
          snapshotId: "snapshot_notional_limit",
          midPrice: "2000",
          liquidityUsd: "50000000",
          marketSpreadBps: 0,
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

    assert.equal(response.statusCode, 409, response.payload);
    assert.equal(JSON.parse(response.payload).code, "RISK_REJECTED");
    const metrics = await server.inject({ method: "GET", url: "/metrics" });
    assert.match(metrics.payload, /rfq_quote_rejections_total\{reason="QUOTE_NOTIONAL_LIMIT_EXCEEDED"\} 1/);
  } finally {
    await server.close();
    restoreEnv("RFQ_TOKEN_REGISTRY_JSON", originalRegistry);
    restoreEnv("RFQ_RISK_POLICY_JSON", originalPolicy);
  }
});

test("RFQ API blocks signing in unsafe market liquidity and volatility regimes", async () => {
  const originalRegistry = process.env.RFQ_TOKEN_REGISTRY_JSON;
  const originalPolicy = process.env.RFQ_RISK_POLICY_JSON;
  process.env.RFQ_TOKEN_REGISTRY_JSON = JSON.stringify(tokenRegistry());
  process.env.RFQ_RISK_POLICY_JSON = JSON.stringify(riskPolicy());
  let market = {
    snapshotId: "snapshot_low_liquidity",
    liquidityUsd: "999999",
    marketSpreadBps: 0,
    volatilityBps: 25,
  };
  const server = buildServer({
    logger: false,
    marketDataService: {
      async getSnapshot() {
        return {
          midPrice: "2000",
          ...market,
          observedAt: new Date().toISOString(),
        };
      },
    },
  });
  const request = {
    chainId: 1,
    user,
    tokenIn: weth,
    tokenOut: usdc,
    amountIn: "500000000000000000",
    slippageBps: 50,
  };

  try {
    await server.ready();
    const lowLiquidity = await server.inject({
      method: "POST",
      url: "/quote",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify(request),
    });
    assert.equal(lowLiquidity.statusCode, 409, lowLiquidity.payload);
    assert.equal(JSON.parse(lowLiquidity.payload).code, "RISK_REJECTED");

    market = {
      snapshotId: "snapshot_high_volatility",
      liquidityUsd: "50000000",
      marketSpreadBps: 0,
      volatilityBps: 501,
    };
    const highVolatility = await server.inject({
      method: "POST",
      url: "/quote",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ ...request, amountIn: "500000000000000001" }),
    });
    assert.equal(highVolatility.statusCode, 409, highVolatility.payload);
    assert.equal(JSON.parse(highVolatility.payload).code, "RISK_REJECTED");

    const metrics = await server.inject({ method: "GET", url: "/metrics" });
    assert.match(metrics.payload, /rfq_quote_rejections_total\{reason="MARKET_LIQUIDITY_TOO_LOW"\} 1/);
    assert.match(metrics.payload, /rfq_quote_rejections_total\{reason="MARKET_VOLATILITY_LIMIT_EXCEEDED"\} 1/);
    assert.match(metrics.payload, /rfq_signer_requests_total\{operation="sign"\} 0/);
  } finally {
    await server.close();
    restoreEnv("RFQ_TOKEN_REGISTRY_JSON", originalRegistry);
    restoreEnv("RFQ_RISK_POLICY_JSON", originalPolicy);
  }
});

test("RFQ API atomically limits cumulative user and pair open quote notional", async () => {
  const originalRegistry = process.env.RFQ_TOKEN_REGISTRY_JSON;
  const originalPolicy = process.env.RFQ_RISK_POLICY_JSON;
  process.env.RFQ_TOKEN_REGISTRY_JSON = JSON.stringify(tokenRegistry());
  process.env.RFQ_RISK_POLICY_JSON = JSON.stringify({
    ...riskPolicy(),
    maxUserOpenNotionalUsd: "3000",
    maxPairOpenNotionalUsd: "5000",
  });
  let snapshotSequence = 0;
  const server = buildServer({
    logger: false,
    marketDataService: {
      async getSnapshot() {
        snapshotSequence += 1;
        return {
          snapshotId: `snapshot_open_exposure_${snapshotSequence}`,
          midPrice: "2000",
          liquidityUsd: "50000000",
          marketSpreadBps: 0,
          volatilityBps: 25,
          observedAt: new Date().toISOString(),
        };
      },
    },
  });
  const quote = async (quoteUser) => server.inject({
    method: "POST",
    url: "/quote",
    headers: { "content-type": "application/json" },
    payload: JSON.stringify({
      chainId: 1,
      user: quoteUser,
      tokenIn: weth,
      tokenOut: usdc,
      amountIn: "1000000000000000000",
      slippageBps: 50,
    }),
  });

  try {
    await server.ready();
    assert.equal((await quote(user)).statusCode, 200);
    const sameUser = await quote(user);
    assert.equal(sameUser.statusCode, 409, sameUser.payload);

    assert.equal((await quote("0x00000000000000000000000000000000000000b2")).statusCode, 200);
    const pairLimit = await quote("0x00000000000000000000000000000000000000c3");
    assert.equal(pairLimit.statusCode, 409, pairLimit.payload);

    const metrics = await server.inject({ method: "GET", url: "/metrics" });
    assert.match(metrics.payload, /rfq_quote_rejections_total\{reason="USER_OPEN_NOTIONAL_LIMIT_EXCEEDED"\} 1/);
    assert.match(metrics.payload, /rfq_quote_rejections_total\{reason="PAIR_OPEN_NOTIONAL_LIMIT_EXCEEDED"\} 1/);
    assert.match(metrics.payload, /rfq_signer_requests_total\{operation="sign"\} 2/);
  } finally {
    await server.close();
    restoreEnv("RFQ_TOKEN_REGISTRY_JSON", originalRegistry);
    restoreEnv("RFQ_RISK_POLICY_JSON", originalPolicy);
  }
});

test("RFQ API rejects portfolio VaR before invoking the signer", async () => {
  const originalRegistry = process.env.RFQ_TOKEN_REGISTRY_JSON;
  const originalPolicy = process.env.RFQ_RISK_POLICY_JSON;
  process.env.RFQ_TOKEN_REGISTRY_JSON = JSON.stringify(tokenRegistry());
  const configuredPolicy = riskPolicy();
  configuredPolicy.portfolioVar.maxPortfolioVarUsd = "10";
  process.env.RFQ_RISK_POLICY_JSON = JSON.stringify(configuredPolicy);
  const server = buildServer({
    logger: false,
    marketDataService: {
      async getSnapshot() {
        return {
          snapshotId: "snapshot_portfolio_var_limit",
          midPrice: "2000",
          liquidityUsd: "50000000",
          marketSpreadBps: 0,
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
    assert.equal(response.statusCode, 409, response.payload);
    assert.equal(JSON.parse(response.payload).code, "RISK_REJECTED");
    const metrics = await server.inject({ method: "GET", url: "/metrics" });
    assert.match(metrics.payload, /rfq_quote_rejections_total\{reason="PORTFOLIO_VAR_LIMIT_EXCEEDED"\} 1/);
    assert.match(metrics.payload, /rfq_signer_requests_total\{operation="sign"\} 0/);
  } finally {
    await server.close();
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
        maxNotionalUsd: "2500",
        maxAbsoluteInventory: "100000000000000000000",
      },
      {
        chainId: 1,
        tokenAddress: usdc,
        maxAmountIn: "1000000000000",
        minAmountOut: "1",
        maxNotionalUsd: "2500",
        maxAbsoluteInventory: "10000000000000",
      },
    ],
    restrictedUsers: [],
    toxicFlowScores: [],
    maxToxicScoreBps: 8000,
    maxUserOpenNotionalUsd: "2000000",
    maxPairOpenNotionalUsd: "5000000",
    portfolioVar: {
      modelVersion: "component-sum-v1",
      maxPortfolioVarUsd: "500000",
      confidenceMultiplierBps: 23_300,
      horizonSeconds: 86_400,
      maxSnapshotAgeMs: 5_000,
      maxFutureSkewMs: 5_000,
      valuationPairs: [{
        chainId: 1,
        tokenAddress: weth,
        usdReferenceTokenAddress: usdc,
      }],
    },
    portfolioDelta: {
      modelVersion: "gross-net-asset-delta-v2",
      softGrossLimitUsd: "500000",
      hardGrossLimitUsd: "1000000",
      softNetLimitUsd: "250000",
      hardNetLimitUsd: "500000",
      assetLimits: [{
        chainId: 1,
        tokenAddress: weth,
        softLimitUsd: "250000",
        hardLimitUsd: "500000",
      }],
    },
    minLiquidityUsd: "1000000",
    maxVolatilityBps: 500,
    maxSlippageBps: 500,
    maxQuotedSpreadBps: 1000,
  };
}

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
