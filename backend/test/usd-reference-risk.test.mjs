import assert from "node:assert/strict";
import test from "node:test";
import {
  ChainlinkUsdReferenceHealthProvider,
} from "../dist/modules/market-data/chainlink-usd-reference.provider.js";
import {
  parseChainlinkUsdReferenceConfig,
} from "../dist/modules/market-data/chainlink-usd-reference-config.js";
import { ConfiguredTokenRegistry } from "../dist/modules/pricing/token-registry.js";
import { UsdReferenceRiskEngine } from "../dist/modules/risk/usd-reference-risk.engine.js";
import {
  assertUsdReferenceFeedCoverage,
  assertProductionUsdReferenceRiskPolicy,
  buildUsdReferenceRiskEngine,
} from "../dist/runtime/market-runtime.js";

const token = "0x0000000000000000000000000000000000000003";
const asset = "0x0000000000000000000000000000000000000002";
const aggregator = "0x0000000000000000000000000000000000000004";
const nowMs = 1_700_000_000_000;

test("Chainlink USD-reference provider validates identity, freshness, caches rounds, and detects depeg", async () => {
  let reads = 0;
  let answer = 100_000_000n;
  const provider = new ChainlinkUsdReferenceHealthProvider(config(), () => ({
    async readChainId() { return 1; },
    async readDecimals() { return 8; },
    async readDescription() { return "USDC / USD"; },
    async readLatestRoundData() {
      reads += 1;
      return [9n, answer, 1_699_999_990n, 1_699_999_999n, 9n];
    },
  }), () => nowMs);

  const [first, second] = await Promise.all([provider.getHealth(1, token), provider.getHealth(1, token)]);
  assert.equal(first.status, "healthy");
  assert.equal(first.deviationBps, 0);
  assert.deepEqual(second, first);
  assert.equal(reads, 1);

  answer = 97_000_000n;
  const uncached = new ChainlinkUsdReferenceHealthProvider(config(), () => ({
    async readChainId() { return 1; },
    async readDecimals() { return 8; },
    async readDescription() { return "USDC / USD"; },
    async readLatestRoundData() { return [10n, answer, 1_699_999_990n, 1_699_999_999n, 10n]; },
  }), () => nowMs);
  const depegged = await uncached.getHealth(1, token);
  assert.equal(depegged.status, "depegged");
  assert.equal(depegged.deviationBps, 300);
  await assert.rejects(uncached.checkHealth(), /depegged token/);
});

test("Chainlink USD-reference provider fails closed on stale or mismatched evidence", async () => {
  const stale = providerWith({ updatedAt: 1_699_999_900n });
  await assert.rejects(stale.getHealth(1, token), /stale/);

  const mismatched = providerWith({ description: "DAI / USD" });
  await assert.rejects(mismatched.getHealth(1, token), /description does not match/);

  const incomplete = providerWith({ answeredInRound: 6n });
  await assert.rejects(incomplete.getHealth(1, token), /incomplete round/);
});

test("USD-reference risk guard blocks depeg before approval and binds evidence round into policy version", async () => {
  const registry = tokenRegistry();
  let status = "healthy";
  let roundId = "11";
  const provider = {
    async getHealth() {
      return evidence({ status, roundId });
    },
    async checkHealth() {
      if (status === "depegged") throw new Error("depegged");
    },
  };
  const engine = new UsdReferenceRiskEngine(
    { async evaluate() { return { status: "approved", policyVersion: "base-risk-v1" }; } },
    registry,
    provider,
    "usd-reference-v1",
  );

  const approved = await engine.evaluate(riskInput());
  assert.equal(approved.status, "approved");
  assert.match(approved.policyVersion, /^base-risk-v1:usd-reference-v1:u[0-9a-f]{24}$/);
  roundId = "12";
  const nextRound = await engine.evaluate(riskInput());
  assert.notEqual(nextRound.policyVersion, approved.policyVersion);

  status = "depegged";
  const rejected = await engine.evaluate(riskInput());
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.reasonCode, "USD_REFERENCE_DEPEG");
  await assert.rejects(engine.checkHealth(), /depegged/);
});

test("production runtime requires complete USD-reference feed coverage", () => {
  const registry = tokenRegistry();
  const base = { async evaluate() { return { status: "approved", policyVersion: "base" }; } };
  const pairs = [{ chainId: 1, tokenIn: asset, tokenOut: token }];
  assert.equal(buildUsdReferenceRiskEngine(base, registry, pairs, {}), base);
  assert.throws(
    () => assertProductionUsdReferenceRiskPolicy(true, { NODE_ENV: "production" }),
    /RFQ_USD_REFERENCE_CONFIG_JSON is required/,
  );
  assert.doesNotThrow(() => assertProductionUsdReferenceRiskPolicy(false, { NODE_ENV: "production" }));

  const missing = config({ networks: [{ ...config().networks[0], feeds: [] }] });
  assert.throws(() => parseChainlinkUsdReferenceConfig(JSON.stringify(missing)), /between 1 and 1000 feeds/);
  assert.doesNotThrow(() => assertUsdReferenceFeedCoverage(config(), registry, pairs));
  const nonReferenceFeed = config({ networks: [{
    ...config().networks[0],
    feeds: [{ ...config().networks[0].feeds[0], tokenAddress: asset, description: "WETH / USD" }],
  }] });
  assert.throws(
    () => assertUsdReferenceFeedCoverage(nonReferenceFeed, registry, pairs),
    /is not marked usdReference/,
  );
});

function providerWith(overrides = {}) {
  return new ChainlinkUsdReferenceHealthProvider(config(), () => ({
    async readChainId() { return 1; },
    async readDecimals() { return 8; },
    async readDescription() { return overrides.description ?? "USDC / USD"; },
    async readLatestRoundData() {
      return [
        7n,
        100_000_000n,
        1_699_999_890n,
        overrides.updatedAt ?? 1_699_999_999n,
        overrides.answeredInRound ?? 7n,
      ];
    },
  }), () => nowMs);
}

function config(overrides = {}) {
  return {
    policyVersion: "usd-reference-v1",
    maxPriceAgeMs: 60_000,
    maxFutureSkewMs: 1_000,
    maxDeviationBps: 100,
    cacheTtlMs: 1_000,
    networks: [{
      chainId: 1,
      networkType: "l1",
      rpcUrl: "https://rpc.example.com",
      feeds: [{
        tokenAddress: token,
        aggregator,
        decimals: 8,
        description: "USDC / USD",
        minAnswer: "50000000",
        maxAnswer: "150000000",
      }],
    }],
    ...overrides,
  };
}

function tokenRegistry() {
  return new ConfiguredTokenRegistry({ tokens: [{
    chainId: 1,
    tokenAddress: asset,
    symbol: "WETH",
    decimals: 18,
    isWhitelisted: true,
    riskTier: "low",
    usdReference: false,
  }, {
    chainId: 1,
    tokenAddress: token,
    symbol: "USDC",
    decimals: 6,
    isWhitelisted: true,
    riskTier: "low",
    usdReference: true,
  }] });
}

function evidence(overrides = {}) {
  return {
    chainId: 1,
    tokenAddress: token,
    aggregator,
    roundId: "11",
    answer: "100000000",
    decimals: 8,
    deviationBps: 0,
    observedAt: new Date(nowMs - 1_000).toISOString(),
    status: "healthy",
    ...overrides,
  };
}

function riskInput() {
  return {
    request: {
      chainId: 1,
      user: "0x0000000000000000000000000000000000000001",
      tokenIn: asset,
      tokenOut: token,
      amountIn: "1",
      slippageBps: 50,
    },
    pricing: {},
    snapshot: {},
  };
}
