import assert from "node:assert/strict";
import test from "node:test";
import { buildServer } from "../dist/main.js";

const user = "0x0000000000000000000000000000000000000001";
const weth = "0x0000000000000000000000000000000000000002";
const usdc = "0x0000000000000000000000000000000000000003";

test("RFQ API uses configured token decimals for a signed WETH to USDC quote", async () => {
  const original = process.env.RFQ_TOKEN_REGISTRY_JSON;
  process.env.RFQ_TOKEN_REGISTRY_JSON = JSON.stringify(tokenRegistryConfig(true));
  const server = buildServer({
    logger: false,
    marketDataService: {
      async getSnapshot() {
        return {
          snapshotId: "snapshot_cross_decimals",
          midPrice: "2000",
          liquidityUsd: "50000000",
          volatilityBps: 25,
          observedAt: new Date().toISOString(),
        };
      },
    },
    riskEngine: {
      async evaluate() {
        return { status: "approved", policyVersion: "risk-cross-decimals-v1" };
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

    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.payload);
    assert.equal(body.amountOut, "1996800000");
    assert.equal(body.minAmountOut, "1986816000");
    assert.match(body.signature, /^0x[0-9a-f]{130}$/);

    const submit = await server.inject({
      method: "POST",
      url: "/submit",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        quote: {
          chainId: 1,
          user,
          tokenIn: weth,
          tokenOut: usdc,
          amountIn: "1000000000000000000",
          amountOut: body.amountOut,
          minAmountOut: body.minAmountOut,
          nonce: body.nonce,
          deadline: body.deadline,
        },
        signature: body.signature,
      }),
    });
    assert.equal(submit.statusCode, 202, submit.payload);
    assert.equal(JSON.parse(submit.payload).status, "accepted");
  } finally {
    await server.close();
    restoreEnv("RFQ_TOKEN_REGISTRY_JSON", original);
  }
});

test("RFQ API rejects malformed token metadata and non-USD CEX quote assets at startup", () => {
  const originalRegistry = process.env.RFQ_TOKEN_REGISTRY_JSON;
  const originalPairs = process.env.RFQ_CEX_PAIRS;
  const originalMinSources = process.env.RFQ_CEX_MIN_SOURCES;
  try {
    process.env.RFQ_TOKEN_REGISTRY_JSON = "{";
    assert.throws(() => buildServer({ logger: false }), /RFQ_TOKEN_REGISTRY_JSON must contain valid JSON/);

    process.env.RFQ_TOKEN_REGISTRY_JSON = JSON.stringify({
      tokens: tokenRegistryConfig(true).tokens.slice(0, 1),
    });
    assert.throws(() => buildServer({ logger: false }), /Pricing tokenOut token .* is not configured/);

    process.env.RFQ_TOKEN_REGISTRY_JSON = JSON.stringify(tokenRegistryConfig(false));
    process.env.RFQ_CEX_PAIRS = `1:${weth}:${usdc}:binance:ETHUSDC`;
    process.env.RFQ_CEX_MIN_SOURCES = "1";
    assert.throws(
      () => buildServer({ logger: false }),
      /CEX pair .* requires tokenOut to be an approved USD reference token/,
    );
    assert.throws(
      () => buildServer({
        logger: false,
        pricingEngine: {
          async price() {
            throw new Error("unused custom pricing engine");
          },
        },
      }),
      /CEX pair .* requires tokenOut to be an approved USD reference token/,
    );
  } finally {
    restoreEnv("RFQ_TOKEN_REGISTRY_JSON", originalRegistry);
    restoreEnv("RFQ_CEX_PAIRS", originalPairs);
    restoreEnv("RFQ_CEX_MIN_SOURCES", originalMinSources);
  }
});

test("RFQ API builds a decimals-aware readiness pricing probe for managed market pairs", async () => {
  const original = process.env.RFQ_TOKEN_REGISTRY_JSON;
  process.env.RFQ_TOKEN_REGISTRY_JSON = JSON.stringify(tokenRegistryConfig(true));
  const server = buildServer({ logger: false });

  try {
    await server.ready();
    const response = await server.inject({ method: "GET", url: "/ready" });
    assert.equal(response.statusCode, 200, response.payload);
    const body = JSON.parse(response.payload);
    assert.equal(body.status, "ready");
    assert.equal(body.components.marketData, "ok");
    assert.equal(body.components.pricing, "ok");
    assert.equal(body.components.risk, "ok");
  } finally {
    await server.close();
    restoreEnv("RFQ_TOKEN_REGISTRY_JSON", original);
  }
});

function tokenRegistryConfig(usdcIsUsdReference) {
  return {
    tokens: [
      {
        chainId: 1,
        tokenAddress: weth,
        symbol: "WETH",
        decimals: 18,
        isWhitelisted: true,
        riskTier: "medium",
        usdReference: !usdcIsUsdReference,
      },
      {
        chainId: 1,
        tokenAddress: usdc,
        symbol: "USDC",
        decimals: 6,
        isWhitelisted: true,
        riskTier: "low",
        usdReference: usdcIsUsdReference,
      },
    ],
  };
}

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
