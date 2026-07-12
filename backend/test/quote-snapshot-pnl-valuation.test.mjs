import assert from "node:assert/strict";
import test from "node:test";
import { QuoteSnapshotPnlValuationProvider } from "../dist/modules/pnl/quote-snapshot-valuation.provider.js";
import { ConfiguredTokenRegistry } from "../dist/modules/pricing/token-registry.js";
import { pnlInput } from "./helpers/pnl-fixtures.mjs";

const weth = "0x0000000000000000000000000000000000000002";
const usdc = "0x0000000000000000000000000000000000000003";
const quote = {
  user: "0x0000000000000000000000000000000000000001",
  tokenIn: weth,
  tokenOut: usdc,
  amountIn: "1000000000000000000",
  amountOut: "1998000000",
  minAmountOut: "1980000000",
  nonce: "1",
  deadline: 4_102_444_800,
  chainId: 1,
};
const snapshot = {
  snapshotId: "snapshot_weth_usdc",
  chainId: 1,
  tokenIn: weth,
  tokenOut: usdc,
  midPrice: "2000.000000000000000000",
  liquidityUsd: "50000000",
  volatilityBps: 25,
  source: "test",
  observedAt: "2026-07-11T00:00:00.000Z",
  createdAt: "2026-07-11T00:00:00.001Z",
};
const registry = new ConfiguredTokenRegistry({
  tokens: [
    { chainId: 1, tokenAddress: weth, symbol: "WETH", decimals: 18, isWhitelisted: true, riskTier: "medium", usdReference: false },
    { chainId: 1, tokenAddress: usdc, symbol: "USDC", decimals: 6, isWhitelisted: true, riskTier: "low", usdReference: true },
  ],
});

test("QuoteSnapshotPnlValuationProvider resolves persisted price and trusted token decimals", async () => {
  const provider = new QuoteSnapshotPnlValuationProvider(snapshotStore(snapshot), registry);

  const valuation = await provider.resolve(pnlInput("q_weth_usdc", quote, {
    snapshotId: snapshot.snapshotId,
  }));

  assert.deepEqual(valuation, {
    snapshotId: snapshot.snapshotId,
    midPrice: snapshot.midPrice,
    tokenInDecimals: 18,
    tokenOutDecimals: 6,
    observedAt: snapshot.observedAt,
  });
});

test("QuoteSnapshotPnlValuationProvider fails closed on missing or mismatched snapshots", async () => {
  const input = pnlInput("q_weth_usdc", quote, { snapshotId: snapshot.snapshotId });
  await assert.rejects(
    new QuoteSnapshotPnlValuationProvider(snapshotStore(undefined), registry).resolve(input),
    /was not found/,
  );
  await assert.rejects(
    new QuoteSnapshotPnlValuationProvider(snapshotStore({ ...snapshot, chainId: 10 }), registry).resolve(input),
    /chainId must match/,
  );
  await assert.rejects(
    new QuoteSnapshotPnlValuationProvider(snapshotStore({ ...snapshot, tokenOut: weth }), registry).resolve(input),
    /token pair must match/,
  );
});

test("QuoteSnapshotPnlValuationProvider validates dependencies and registry coverage", async () => {
  assert.throws(
    () => new QuoteSnapshotPnlValuationProvider({}, registry),
    /snapshotStore.findBySnapshotId must be a function/,
  );
  const incompleteRegistry = new ConfiguredTokenRegistry({
    tokens: [
      { chainId: 1, tokenAddress: weth, symbol: "WETH", decimals: 18, isWhitelisted: true, riskTier: "medium", usdReference: false },
    ],
  });
  await assert.rejects(
    new QuoteSnapshotPnlValuationProvider(snapshotStore(snapshot), incompleteRegistry).resolve(
      pnlInput("q_weth_usdc", quote, { snapshotId: snapshot.snapshotId }),
    ),
    /Pnl tokenOut token .* is not configured/,
  );
});

function snapshotStore(record) {
  return {
    async saveSnapshot() {
      throw new Error("not used");
    },
    async findBySnapshotId() {
      return record;
    },
  };
}
