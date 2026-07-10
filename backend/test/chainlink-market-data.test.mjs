import assert from "node:assert/strict";
import test from "node:test";
import { CachedMarketDataService } from "../dist/modules/market-data/cached-market-data.service.js";
import { ChainlinkMarketDataService } from "../dist/modules/market-data/chainlink-market-data.service.js";
import { parseChainlinkMarketDataConfig } from "../dist/modules/market-data/chainlink-config.js";
import { getMarketDataSnapshotSource } from "../dist/modules/market-data/market-data.service.js";
import { SharedPriceCache, pairKey } from "../dist/modules/market-data/price-cache.js";

const user = "0x0000000000000000000000000000000000000001";
const tokenIn = "0x0000000000000000000000000000000000000002";
const tokenOut = "0x0000000000000000000000000000000000000003";
const aggregator = "0x0000000000000000000000000000000000000004";
const sequencer = "0x0000000000000000000000000000000000000005";
const nowSeconds = 1_800_000_000;

const request = {
  chainId: 1,
  user,
  tokenIn,
  tokenOut,
  amountIn: "1000000",
  slippageBps: 50,
};

test("ChainlinkMarketDataService returns fresh direct and inverse prices using oracle timestamps", async () => {
  const config = validConfig();
  const reader = new FakeReader(8, new Map([
    [aggregator, round(200_000_000_000n, BigInt(nowSeconds - 10), 42n)],
  ]));
  const service = new ChainlinkMarketDataService(config, () => reader);
  config.networks[0].feeds[0].decimals = 18;

  await withFixedNow(nowSeconds * 1_000, async () => {
    const direct = await service.getSnapshot(request);
    const inverse = await service.getSnapshot({ ...request, tokenIn: tokenOut, tokenOut: tokenIn });

    assert.equal(direct.midPrice, "2000");
    assert.equal(direct.observedAt, new Date((nowSeconds - 10) * 1_000).toISOString());
    assert.equal(direct.liquidityUsd, "50000000");
    assert.equal(direct.volatilityBps, 25);
    assert.equal(getMarketDataSnapshotSource(direct), "chainlink-aggregator-v3");
    assert.match(direct.snapshotId, /^snapshot_1_chainlink_/);
    assert.equal(inverse.midPrice, "0.0005");
    assert.notEqual(inverse.snapshotId, direct.snapshotId);
    assert.equal(reader.decimalReads, 1);
  });
});

test("ChainlinkMarketDataService rejects stale, future, non-positive, and decimals-mismatched feeds", async () => {
  await withFixedNow(nowSeconds * 1_000, async () => {
    await assert.rejects(serviceForRound(round(1n, BigInt(nowSeconds - 61))).getSnapshot(request), /stale/);
    await assert.rejects(serviceForRound(round(1n, BigInt(nowSeconds + 2))).getSnapshot(request), /future/);
    await assert.rejects(serviceForRound(round(0n, BigInt(nowSeconds))).getSnapshot(request), /non-positive/);

    const reader = new FakeReader(18, new Map([[aggregator, round(1n, BigInt(nowSeconds))]]));
    const service = new ChainlinkMarketDataService(validConfig(), () => reader);
    await assert.rejects(service.getSnapshot(request), /decimals mismatch/);
  });
});

test("ChainlinkMarketDataService enforces L2 sequencer status and recovery grace period", async () => {
  const config = validConfig();
  config.networks[0] = {
    ...config.networks[0],
    chainId: 8453,
    networkType: "l2",
    sequencerUptimeFeed: sequencer,
    sequencerGracePeriodSeconds: 3_600,
  };
  const l2Request = { ...request, chainId: 8453 };
  const rounds = new Map([
    [aggregator, round(200_000_000n, BigInt(nowSeconds - 10))],
    [sequencer, round(1n, BigInt(nowSeconds - 100), 7n, BigInt(nowSeconds - 100))],
  ]);
  const reader = new FakeReader(8, rounds);
  const service = new ChainlinkMarketDataService(config, () => reader);

  await withFixedNow(nowSeconds * 1_000, async () => {
    await assert.rejects(service.getSnapshot(l2Request), /sequencer is down/);
    assert.equal(reader.readsByAddress.get(aggregator) ?? 0, 0);

    rounds.set(sequencer, round(0n, BigInt(nowSeconds - 100), 8n, BigInt(nowSeconds - 100)));
    await assert.rejects(service.getSnapshot(l2Request), /grace period is active/);

    rounds.set(sequencer, round(0n, BigInt(nowSeconds - 4_000), 9n, BigInt(nowSeconds - 4_000)));
    const snapshot = await service.getSnapshot(l2Request);
    assert.equal(snapshot.midPrice, "2");
  });
});

test("Chainlink config parser rejects ambiguous feeds and unsafe runtime config", () => {
  const config = validConfig();
  assert.deepEqual(parseChainlinkMarketDataConfig(JSON.stringify(config)), config);
  assert.throws(() => parseChainlinkMarketDataConfig("{"), /valid JSON/);
  assert.throws(() => parseChainlinkMarketDataConfig(JSON.stringify({ ...config, unknown: true })), /unknown field/);

  const reverseDuplicate = structuredClone(config);
  reverseDuplicate.networks[0].feeds.push({
    ...reverseDuplicate.networks[0].feeds[0],
    tokenIn: tokenOut,
    tokenOut: tokenIn,
  });
  assert.throws(() => parseChainlinkMarketDataConfig(JSON.stringify(reverseDuplicate)), /reverse-duplicate/);

  const incompleteSequencer = structuredClone(config);
  incompleteSequencer.networks[0].sequencerUptimeFeed = sequencer;
  assert.throws(() => parseChainlinkMarketDataConfig(JSON.stringify(incompleteSequencer)), /configured together/);

  const l2WithoutSequencer = structuredClone(config);
  l2WithoutSequencer.networks[0].networkType = "l2";
  assert.throws(() => parseChainlinkMarketDataConfig(JSON.stringify(l2WithoutSequencer)), /L2 network requires/);

  const l1WithSequencer = structuredClone(config);
  l1WithSequencer.networks[0].sequencerUptimeFeed = sequencer;
  l1WithSequencer.networks[0].sequencerGracePeriodSeconds = 3_600;
  assert.throws(() => parseChainlinkMarketDataConfig(JSON.stringify(l1WithSequencer)), /L1 network must not/);

  const credentialedRpc = structuredClone(config);
  credentialedRpc.networks[0].rpcUrl = "https://user:secret@rpc.example.com";
  assert.throws(() => parseChainlinkMarketDataConfig(JSON.stringify(credentialedRpc)), /absolute HTTP/);
});

test("CachedMarketDataService always prefers the CEX overlay to the base provider cache", async () => {
  const cexCache = new SharedPriceCache();
  const baseCache = new SharedPriceCache();
  const baseSnapshot = snapshot("base", "1");
  const cexSnapshot = snapshot("cex", "2");
  const key = pairKey(request.chainId, request.tokenIn, request.tokenOut);
  let innerReads = 0;
  const service = new CachedMarketDataService({
    async getSnapshot() {
      innerReads += 1;
      return snapshot("inner", "3");
    },
  }, [cexCache, baseCache]);

  baseCache.set(key, baseSnapshot);
  assert.equal((await service.getSnapshot(request)).midPrice, "1");
  cexCache.set(key, cexSnapshot);
  assert.equal((await service.getSnapshot(request)).midPrice, "2");
  assert.equal(innerReads, 0);
});

function validConfig() {
  return {
    networks: [{
      chainId: 1,
      networkType: "l1",
      rpcUrl: "https://rpc.example.com/v1/key",
      feeds: [{ tokenIn, tokenOut, aggregator, decimals: 8, invert: false }],
    }],
    referenceLiquidityUsd: "50000000",
    referenceVolatilityBps: 25,
    maxPriceAgeMs: 60_000,
  };
}

function serviceForRound(roundData) {
  const reader = new FakeReader(8, new Map([[aggregator, roundData]]));
  return new ChainlinkMarketDataService(validConfig(), () => reader);
}

function round(answer, updatedAt, roundId = 1n, startedAt = updatedAt) {
  return [roundId, answer, startedAt, updatedAt, roundId];
}

function snapshot(id, midPrice) {
  return {
    snapshotId: `snapshot_${id}`,
    midPrice,
    liquidityUsd: "1000000",
    volatilityBps: 10,
    observedAt: new Date().toISOString(),
  };
}

class FakeReader {
  decimalReads = 0;
  readsByAddress = new Map();

  constructor(decimals, rounds) {
    this.decimals = decimals;
    this.rounds = rounds;
  }

  async readDecimals() {
    this.decimalReads += 1;
    return this.decimals;
  }

  async readLatestRoundData(address) {
    this.readsByAddress.set(address, (this.readsByAddress.get(address) ?? 0) + 1);
    const value = this.rounds.get(address);
    if (!value) throw new Error(`No round configured for ${address}`);
    return value;
  }
}

async function withFixedNow(now, callback) {
  const original = Date.now;
  Date.now = () => now;
  try {
    return await callback();
  } finally {
    Date.now = original;
  }
}
