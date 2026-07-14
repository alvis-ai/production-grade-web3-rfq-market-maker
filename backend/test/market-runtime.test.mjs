import assert from "node:assert/strict";
import test from "node:test";
import { readDefaultMarketDataRuntime } from "../dist/runtime/market-runtime.js";

const tokenIn = "0x1000000000000000000000000000000000000001";
const tokenOut = "0x2000000000000000000000000000000000000002";

test("static market data runtime applies RFQ_MARKET_PAIRS to the provider allowlist", async () => {
  const originalProvider = process.env.RFQ_MARKET_DATA_PROVIDER;
  const originalPairs = process.env.RFQ_MARKET_PAIRS;
  process.env.RFQ_MARKET_DATA_PROVIDER = "static";
  process.env.RFQ_MARKET_PAIRS = `31337:${tokenIn}:${tokenOut}`;

  try {
    const runtime = readDefaultMarketDataRuntime();
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

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
