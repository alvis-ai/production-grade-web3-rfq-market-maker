import assert from "node:assert/strict";
import test from "node:test";
import { runChainlinkIntegrationCheck } from "./chainlink-integration-check.mjs";

const tokenIn = "0x1000000000000000000000000000000000000001";
const tokenOut = "0x2000000000000000000000000000000000000002";
const aggregator = "0x3000000000000000000000000000000000000003";
const sequencer = "0x4000000000000000000000000000000000000004";
const chainId = 11_155_111;
const fixedNow = 1_800_000_000_000;
const baseFeed = {
  tokenIn,
  tokenOut,
  aggregator,
  decimals: 8,
  description: "TOKEN / USD",
  minAnswer: "100000000",
  maxAnswer: "1000000000000",
  invert: false,
};

const baseEnvironment = {
  RFQ_CHAINLINK_INTEGRATION_CONFIRM: "read-live-oracle",
  RFQ_CHAINLINK_INTEGRATION_CHAIN_ID: String(chainId),
  RFQ_CHAINLINK_INTEGRATION_TOKEN_IN: tokenIn,
  RFQ_CHAINLINK_INTEGRATION_TOKEN_OUT: tokenOut,
  RFQ_CHAINLINK_CONFIG_JSON: JSON.stringify({
    networks: [{
      chainId,
      networkType: "l1",
      rpcUrl: "https://rpc.example/v1/private-credential",
      feeds: [baseFeed],
    }],
    referenceLiquidityUsd: "50000000",
    referenceVolatilityBps: 25,
    maxPriceAgeMs: 60_000,
  }),
};

test("Chainlink canary verifies direct and reverse target oracle snapshots", async () => {
  const fixture = createFixture();
  const result = await runChainlinkIntegrationCheck(baseEnvironment, fixture.dependencies);

  assert.deepEqual(result, {
    status: "ok",
    mode: "target-chainlink-read",
    chainId,
    networkType: "l1",
    tokenIn,
    tokenOut,
    aggregator,
    description: "TOKEN / USD",
    direct: {
      snapshotId: result.direct.snapshotId,
      midPrice: "2000",
      observedAt: "2027-01-15T07:59:50.000Z",
      ageMs: 10_000,
    },
    reverse: {
      snapshotId: result.reverse.snapshotId,
      midPrice: "0.0005",
      observedAt: "2027-01-15T07:59:50.000Z",
      ageMs: 10_000,
    },
    sequencerChecked: false,
  });
  assert.match(result.direct.snapshotId, /^snapshot_11155111_chainlink_[0-9a-f]{64}$/);
  assert.match(result.reverse.snapshotId, /^snapshot_11155111_chainlink_[0-9a-f]{64}$/);
  assert.notEqual(result.direct.snapshotId, result.reverse.snapshotId);
  assert.equal(fixture.calls.decimals, 1);
  assert.equal(fixture.calls.description, 1);
  assert.equal(fixture.calls.chainId, 1);
  assert.equal(fixture.calls.priceRound, 2);
  assert.doesNotMatch(JSON.stringify(result), /private-credential|rpc\.example/);
});

test("Chainlink canary rejects unsafe confirmation and pair selection before RPC reads", async () => {
  const fixture = createFixture();
  await assert.rejects(
    runChainlinkIntegrationCheck({
      ...baseEnvironment,
      RFQ_CHAINLINK_INTEGRATION_CONFIRM: "no",
    }, fixture.dependencies),
    /read-live-oracle is required/,
  );
  await assert.rejects(
    runChainlinkIntegrationCheck({
      ...baseEnvironment,
      RFQ_CHAINLINK_INTEGRATION_TOKEN_OUT: "0x5000000000000000000000000000000000000005",
    }, fixture.dependencies),
    /does not contain the selected token pair/,
  );
  assert.deepEqual(fixture.calls, { chainId: 0, decimals: 0, description: 0, priceRound: 0, sequencerRound: 0 });
});

test("Chainlink canary checks a healthy L2 sequencer before each price read", async () => {
  const config = JSON.parse(baseEnvironment.RFQ_CHAINLINK_CONFIG_JSON);
  config.networks[0] = {
    ...config.networks[0],
    networkType: "l2",
    sequencerUptimeFeed: sequencer,
    sequencerGracePeriodSeconds: 3_600,
  };
  const fixture = createFixture();
  const result = await runChainlinkIntegrationCheck({
    ...baseEnvironment,
    RFQ_CHAINLINK_CONFIG_JSON: JSON.stringify(config),
  }, fixture.dependencies);

  assert.equal(result.sequencerChecked, true);
  assert.equal(result.networkType, "l2");
  assert.equal(fixture.calls.sequencerRound, 2);
  assert.equal(fixture.calls.priceRound, 2);
});

test("Chainlink canary redacts provider, stale, and circuit-breaker failures", async () => {
  for (const options of [
    { providerFailure: "https://rpc.example/v1/private-credential" },
    { updatedAt: BigInt(fixedNow / 1_000 - 61) },
    { answer: 99_999_999n },
    { description: "WRONG / FEED" },
    { observedChainId: 1 },
  ]) {
    const fixture = createFixture(options);
    await assert.rejects(
      runChainlinkIntegrationCheck(baseEnvironment, fixture.dependencies),
      (error) => {
        assert.equal(error.message, "Target Chainlink integration check failed");
        assert.doesNotMatch(error.stack ?? "", /private-credential|rpc\.example|WRONG \/ FEED/);
        return true;
      },
    );
  }
});

function createFixture(options = {}) {
  const calls = { chainId: 0, decimals: 0, description: 0, priceRound: 0, sequencerRound: 0 };
  const reader = {
    async readChainId() {
      calls.chainId += 1;
      return options.observedChainId ?? chainId;
    },
    async readDecimals() {
      calls.decimals += 1;
      if (options.providerFailure) throw new Error(options.providerFailure);
      return 8;
    },
    async readDescription() {
      calls.description += 1;
      return options.description ?? "TOKEN / USD";
    },
    async readLatestRoundData(address) {
      if (address.toLowerCase() === sequencer) {
        calls.sequencerRound += 1;
        return [7n, 0n, BigInt(fixedNow / 1_000 - 4_000), BigInt(fixedNow / 1_000 - 4_000), 7n];
      }
      calls.priceRound += 1;
      if (options.providerFailure) throw new Error(options.providerFailure);
      const updatedAt = options.updatedAt ?? BigInt(fixedNow / 1_000 - 10);
      return [42n, options.answer ?? 200_000_000_000n, updatedAt, updatedAt, 42n];
    },
  };
  return {
    calls,
    dependencies: {
      now: () => fixedNow,
      readerFactory: () => reader,
    },
  };
}
