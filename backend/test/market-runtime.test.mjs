import assert from "node:assert/strict";
import test from "node:test";
import {
  assertCexHedgeSourcesRoutable,
  assertProductionMarketDataPolicy,
  readDefaultMarketDataRuntime,
} from "../dist/runtime/market-runtime.js";
import { ConfiguredTokenRegistry } from "../dist/modules/pricing/token-registry.js";

const tokenIn = "0x1000000000000000000000000000000000000001";
const tokenOut = "0x2000000000000000000000000000000000000002";

test("static market data runtime applies RFQ_MARKET_PAIRS to the provider allowlist", async () => {
  const originalProvider = process.env.RFQ_MARKET_DATA_PROVIDER;
  const originalPairs = process.env.RFQ_MARKET_PAIRS;
  process.env.RFQ_MARKET_DATA_PROVIDER = "static";
  process.env.RFQ_MARKET_PAIRS = `31337:${tokenIn}:${tokenOut}`;

  try {
    const runtime = readDefaultMarketDataRuntime();
    assert.equal(runtime.provider, "static");
    assert.deepEqual(
      runtime.defaultPairs.map(({ chainId, tokenIn: pairTokenIn, tokenOut: pairTokenOut }) => ({
        chainId,
        tokenIn: pairTokenIn,
        tokenOut: pairTokenOut,
      })),
      [{ chainId: 31337, tokenIn, tokenOut }],
    );
    const request = {
      chainId: 31337,
      user: "0x3000000000000000000000000000000000000003",
      tokenIn,
      tokenOut,
      amountIn: "1000000000000000000",
      slippageBps: 50,
    };

    const snapshot = await runtime.service.getSnapshot(request);
    assert.equal(snapshot.midPrice, "1");
    assert.match(snapshot.snapshotId, /^snapshot_31337_/);
    await assert.rejects(
      runtime.service.getSnapshot({
        ...request,
        chainId: 1,
        tokenIn: "0x0000000000000000000000000000000000000002",
        tokenOut: "0x0000000000000000000000000000000000000003",
      }),
      /Market data pair is not configured/,
    );
  } finally {
    restoreEnv("RFQ_MARKET_DATA_PROVIDER", originalProvider);
    restoreEnv("RFQ_MARKET_PAIRS", originalPairs);
  }
});

test("non-local static market data requires a configured mandatory live CEX book", () => {
  const pair = {
    chainId: 1,
    tokenIn,
    tokenOut,
    exchange: "binance",
    symbol: "ETHUSDT",
    role: "hedge",
  };
  const production = { NODE_ENV: "production" };

  assert.throws(
    () => assertProductionMarketDataPolicy("static", [], true, production),
    /non-empty RFQ_CEX_PAIRS/,
  );
  assert.throws(
    () => assertProductionMarketDataPolicy("static", [pair], false, production),
    /RFQ_CEX_REQUIRE_LIVE_BOOK=true/,
  );
  assert.doesNotThrow(
    () => assertProductionMarketDataPolicy("static", [pair], true, production),
  );
  assert.doesNotThrow(
    () => assertProductionMarketDataPolicy("chainlink", [], false, production),
  );
  assert.doesNotThrow(
    () => assertProductionMarketDataPolicy("static", [], false, { NODE_ENV: "development" }),
  );
});

test("CEX hedge sources must match the worker route table exactly", () => {
  const registry = new ConfiguredTokenRegistry({
    tokens: [{
      chainId: 1,
      tokenAddress: tokenIn,
      symbol: "WETH",
      decimals: 18,
      isWhitelisted: true,
      riskTier: "medium",
      usdReference: false,
    }, {
      chainId: 1,
      tokenAddress: tokenOut,
      symbol: "USDC",
      decimals: 6,
      isWhitelisted: true,
      riskTier: "low",
      usdReference: true,
    }],
  });
  const source = {
    chainId: 1,
    tokenIn,
    tokenOut,
    exchange: "binance",
    symbol: "ethusdc",
    role: "hedge",
  };
  const route = {
    chainId: 1,
    token: tokenIn,
    venue: "binance",
    symbol: "ETHUSDC",
    baseAsset: "ETH",
    quoteAsset: "USDC",
    quoteToken: tokenOut,
    tokenDecimals: 18,
    quoteTokenDecimals: 6,
    stepSizeRaw: "100000000000000",
  };

  assert.doesNotThrow(() => assertCexHedgeSourcesRoutable(
    registry,
    [source],
    { RFQ_HEDGE_ROUTES_JSON: JSON.stringify({ routes: [route] }) },
  ));
  assert.throws(
    () => assertCexHedgeSourcesRoutable(registry, [source], {}),
    /RFQ_HEDGE_ROUTES_JSON is required/,
  );
  assert.throws(
    () => assertCexHedgeSourcesRoutable(
      registry,
      [source],
      { RFQ_HEDGE_ROUTES_JSON: JSON.stringify({ routes: [{ ...route, symbol: "BTCUSDC" }] }) },
    ),
    /does not match its configured hedge route/,
  );
  assert.throws(
    () => assertCexHedgeSourcesRoutable(
      registry,
      [{ ...source, tokenIn: "0x3000000000000000000000000000000000000003" }],
      { RFQ_HEDGE_ROUTES_JSON: JSON.stringify({ routes: [route] }) },
    ),
    /has no configured hedge route/,
  );
  assert.doesNotThrow(() => assertCexHedgeSourcesRoutable(
    registry,
    [{ ...source, exchange: "coinbase", symbol: "ETH-USD", role: "reference" }],
    {},
  ));
});

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
