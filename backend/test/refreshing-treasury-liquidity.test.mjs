import assert from "node:assert/strict";
import test from "node:test";
import { RefreshingTreasuryLiquidityView } from "../dist/modules/risk/refreshing-treasury-liquidity.view.js";
import {
  buildTreasuryLiquidityTargets,
  resolveGatewayTreasuryLiquidityRuntime,
} from "../dist/runtime/gateway-treasury-liquidity.js";

const tokenA = "0x0000000000000000000000000000000000000011";
const tokenB = "0x0000000000000000000000000000000000000022";
const settlementAddress = "0x0000000000000000000000000000000000000033";
const treasuryAddress = "0x0000000000000000000000000000000000000044";

test("RefreshingTreasuryLiquidityView atomically warms every target and serves immutable hot reads", async () => {
  let calls = 0;
  let nowMs = 1_000;
  const source = {
    async checkHealth() {},
    async getLiquidity(request) {
      calls += 1;
      return snapshot(request, calls === 1 ? "100" : "200", 50n);
    },
  };
  const view = new RefreshingTreasuryLiquidityView(source, {
    targets: [{ chainId: 1, token: tokenA }, { chainId: 1, token: tokenB }],
    refreshIntervalMs: 10,
    maxAgeMs: 20,
  }, undefined, () => nowMs);

  await view.start();
  view.stop();
  assert.equal(calls, 2);
  assert.equal(view.snapshotGeneration(), 1);

  const first = await view.getLiquidity({ chainId: 1, token: tokenA });
  assert.equal(calls, 2);
  first.availableBalance = "0";
  assert.equal((await view.getLiquidity({ chainId: 1, token: tokenA })).availableBalance, "100");

  nowMs = 1_010;
  await view.refresh();
  assert.equal(calls, 4);
  assert.equal(view.snapshotGeneration(), 2);
  assert.equal((await view.getLiquidity({ chainId: 1, token: tokenA })).blockNumber, 50n);
});

test("RefreshingTreasuryLiquidityView retains the previous generation on partial failure then fails stale", async () => {
  let nowMs = 2_000;
  let fail = false;
  const source = {
    async checkHealth() {},
    async getLiquidity(request) {
      if (fail && request.token === tokenB) throw new Error("RPC unavailable");
      return snapshot(request, "100", 60n);
    },
  };
  const view = new RefreshingTreasuryLiquidityView(source, {
    targets: [{ chainId: 1, token: tokenA }, { chainId: 1, token: tokenB }],
    refreshIntervalMs: 10,
    maxAgeMs: 20,
  }, undefined, () => nowMs);

  await view.start();
  view.stop();
  fail = true;
  nowMs = 2_010;
  await assert.rejects(view.refresh(), /RPC unavailable/);
  assert.equal(view.snapshotGeneration(), 1);
  assert.equal((await view.getLiquidity({ chainId: 1, token: tokenB })).availableBalance, "100");

  nowMs = 2_021;
  await assert.rejects(view.checkHealth(), /hot state is stale/);
  await assert.rejects(view.getLiquidity({ chainId: 1, token: tokenA }), /hot state is stale/);
});

test("RefreshingTreasuryLiquidityView rejects mismatched source evidence before publishing", async () => {
  const source = {
    async checkHealth() {},
    async getLiquidity(request) {
      return snapshot({ ...request, token: tokenB }, "100", 70n);
    },
  };
  const view = new RefreshingTreasuryLiquidityView(source, {
    targets: [{ chainId: 1, token: tokenA }],
    refreshIntervalMs: 10,
    maxAgeMs: 20,
  }, undefined, () => 3_000);

  await assert.rejects(view.refresh(), /does not match its requested chain\/token/);
  await assert.rejects(view.checkHealth(), /not initialized/);
});

test("RefreshingTreasuryLiquidityView single-flights startup and suppresses repeated failure logs", async () => {
  let calls = 0;
  let successes = 0;
  let fail = false;
  const warnings = [];
  const source = {
    async checkHealth() {},
    async getLiquidity(request) {
      calls += 1;
      if (fail) throw new Error("RPC unavailable");
      successes += 1;
      return snapshot(request, "100", 75n);
    },
  };
  const view = new RefreshingTreasuryLiquidityView(source, {
    targets: [{ chainId: 1, token: tokenA }],
    refreshIntervalMs: 10,
    maxAgeMs: 100,
  }, { warn(fields) { warnings.push(fields); } });

  await Promise.all([view.start(), view.start()]);
  assert.equal(calls, 1);
  fail = true;
  await waitFor(() => calls >= 3);
  assert.equal(warnings.length, 1);

  fail = false;
  await waitFor(() => successes >= 2);
  fail = true;
  await waitFor(() => warnings.length === 2);
  view.stop();
  const callsAfterStop = calls;
  await delay(30);
  assert.equal(calls, callsAfterStop);
});

test("Gateway Treasury runtime deduplicates both pair directions and enforces reservation grace", async () => {
  const pairs = [
    { chainId: 1, tokenIn: tokenA, tokenOut: tokenB },
    { chainId: 1, tokenIn: tokenB, tokenOut: tokenA },
  ];
  assert.deepEqual(buildTreasuryLiquidityTargets(pairs), [
    { chainId: 1, token: tokenA },
    { chainId: 1, token: tokenB },
  ]);
  const source = {
    async checkHealth() {},
    async getLiquidity(request) { return snapshot(request, "100", 80n); },
  };
  const runtime = resolveGatewayTreasuryLiquidityRuntime({
    source,
    managedPairs: pairs,
    logger: { warn() {} },
    env: {
      RFQ_TREASURY_LIQUIDITY_REFRESH_INTERVAL_MS: "10",
      RFQ_TREASURY_LIQUIDITY_MAX_AGE_MS: "20",
      RFQ_QUOTE_EXPOSURE_EXPIRY_GRACE_SECONDS: "1",
    },
  });
  await runtime.start();
  runtime.stop();
  assert.equal((await runtime.provider.getLiquidity({ chainId: 1, token: tokenA })).availableBalance, "100");

  assert.throws(() => resolveGatewayTreasuryLiquidityRuntime({
    source,
    managedPairs: pairs,
    logger: { warn() {} },
    env: {
      RFQ_TREASURY_LIQUIDITY_REFRESH_INTERVAL_MS: "10",
      RFQ_TREASURY_LIQUIDITY_MAX_AGE_MS: "1000",
      RFQ_QUOTE_EXPOSURE_EXPIRY_GRACE_SECONDS: "1",
    },
  }), /must exceed Treasury hot-state max age/);
});

function snapshot(request, availableBalance, blockNumber) {
  return {
    chainId: request.chainId,
    settlementAddress,
    treasuryAddress,
    token: request.token,
    availableBalance,
    blockNumber,
  };
}

async function waitFor(condition) {
  const deadline = Date.now() + 1_000;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error("timed out waiting for Treasury refresh condition");
    await delay(5);
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
