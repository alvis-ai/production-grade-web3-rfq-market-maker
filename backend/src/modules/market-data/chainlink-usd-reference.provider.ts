import { createPublicClient, defineChain, http } from "viem";
import type { Address } from "../../shared/types/rfq.js";
import { chainlinkAggregatorV3Abi } from "./chainlink-abi.js";
import {
  assertChainlinkUsdReferenceConfig,
  cloneChainlinkUsdReferenceConfig,
  usdReferenceFeedKey,
  type ChainlinkUsdReferenceConfig,
  type ChainlinkUsdReferenceFeedConfig,
  type ChainlinkUsdReferenceNetworkConfig,
} from "./chainlink-usd-reference-config.js";

export interface UsdReferenceHealthEvidence {
  chainId: number;
  tokenAddress: Address;
  aggregator: Address;
  roundId: string;
  answer: string;
  decimals: number;
  deviationBps: number;
  observedAt: string;
  status: "healthy" | "depegged";
}

export interface UsdReferenceHealthProvider {
  getHealth(chainId: number, tokenAddress: Address): Promise<UsdReferenceHealthEvidence>;
  checkHealth(): Promise<void>;
}

type RoundData = readonly [bigint, bigint, bigint, bigint, bigint];

export interface UsdReferenceChainlinkReader {
  readChainId(): Promise<unknown>;
  readDecimals(address: Address): Promise<unknown>;
  readDescription(address: Address): Promise<unknown>;
  readLatestRoundData(address: Address): Promise<unknown>;
}

export type UsdReferenceChainlinkReaderFactory = (
  network: ChainlinkUsdReferenceNetworkConfig,
) => UsdReferenceChainlinkReader;

interface FeedRuntime {
  network: ChainlinkUsdReferenceNetworkConfig;
  feed: ChainlinkUsdReferenceFeedConfig;
  reader: UsdReferenceChainlinkReader;
}

interface CachedEvidence {
  evidence: UsdReferenceHealthEvidence;
  fetchedAtMs: number;
}

export class ChainlinkUsdReferenceHealthProvider implements UsdReferenceHealthProvider {
  private readonly config: ChainlinkUsdReferenceConfig;
  private readonly feeds = new Map<string, FeedRuntime>();
  private readonly chainChecks = new Map<number, Promise<void>>();
  private readonly metadataChecks = new Map<string, Promise<void>>();
  private readonly cache = new Map<string, CachedEvidence>();
  private readonly inFlight = new Map<string, Promise<UsdReferenceHealthEvidence>>();

  constructor(
    config: ChainlinkUsdReferenceConfig,
    readerFactory: UsdReferenceChainlinkReaderFactory = createReader,
    private readonly now: () => number = Date.now,
  ) {
    assertChainlinkUsdReferenceConfig(config);
    if (typeof readerFactory !== "function") throw new Error("USD-reference readerFactory must be a function");
    if (typeof now !== "function") throw new Error("USD-reference clock must be a function");
    currentTime(now);
    this.config = cloneChainlinkUsdReferenceConfig(config);
    for (const network of this.config.networks) {
      const reader = readerFactory(network);
      assertReader(reader);
      for (const feed of network.feeds) {
        this.feeds.set(usdReferenceFeedKey(network.chainId, feed.tokenAddress), { network, feed, reader });
      }
    }
  }

  async getHealth(chainId: number, tokenAddress: Address): Promise<UsdReferenceHealthEvidence> {
    assertChainToken(chainId, tokenAddress);
    const key = usdReferenceFeedKey(chainId, tokenAddress);
    const runtime = this.feeds.get(key);
    if (!runtime) throw new Error(`USD-reference health has no feed for ${key}`);

    const nowMs = currentTime(this.now);
    const cached = this.cache.get(key);
    const cacheAgeMs = cached ? nowMs - cached.fetchedAtMs : undefined;
    if (cached && cacheAgeMs !== undefined && cacheAgeMs >= 0 && cacheAgeMs <= this.config.cacheTtlMs) {
      return { ...cached.evidence };
    }
    const existing = this.inFlight.get(key);
    if (existing) return { ...await existing };

    const request = this.fetchEvidence(runtime, nowMs);
    this.inFlight.set(key, request);
    try {
      const evidence = await request;
      this.cache.set(key, { evidence, fetchedAtMs: nowMs });
      return { ...evidence };
    } finally {
      if (this.inFlight.get(key) === request) this.inFlight.delete(key);
    }
  }

  async checkHealth(): Promise<void> {
    const evidence = await Promise.all([...this.feeds.values()].map(({ network, feed }) =>
      this.getHealth(network.chainId, feed.tokenAddress)));
    if (evidence.some(({ status }) => status === "depegged")) {
      throw new Error("USD-reference health detected a depegged token");
    }
  }

  private async fetchEvidence(runtime: FeedRuntime, nowMs: number): Promise<UsdReferenceHealthEvidence> {
    await this.assertNetwork(runtime.network, runtime.reader);
    await this.assertSequencer(runtime.network, runtime.reader, nowMs);
    const [roundData] = await Promise.all([
      runtime.reader.readLatestRoundData(runtime.feed.aggregator).then(parseRoundData),
      this.assertMetadata(runtime.network.chainId, runtime.feed, runtime.reader),
    ]);
    const [roundId, answer, startedAt, updatedAt, answeredInRound] = roundData;
    assertRound(roundId, answer, startedAt, updatedAt, answeredInRound, runtime.feed, this.config, nowMs);
    const deviationBps = calculateDeviationBps(answer, runtime.feed.decimals);
    return {
      chainId: runtime.network.chainId,
      tokenAddress: runtime.feed.tokenAddress.toLowerCase() as Address,
      aggregator: runtime.feed.aggregator.toLowerCase() as Address,
      roundId: roundId.toString(),
      answer: answer.toString(),
      decimals: runtime.feed.decimals,
      deviationBps,
      observedAt: new Date(Number(updatedAt) * 1_000).toISOString(),
      status: deviationExceedsLimit(answer, runtime.feed.decimals, this.config.maxDeviationBps)
        ? "depegged"
        : "healthy",
    };
  }

  private async assertNetwork(
    network: ChainlinkUsdReferenceNetworkConfig,
    reader: UsdReferenceChainlinkReader,
  ): Promise<void> {
    let check = this.chainChecks.get(network.chainId);
    if (!check) {
      check = reader.readChainId().then((actual) => {
        if (typeof actual !== "number" || !Number.isSafeInteger(actual) || actual !== network.chainId) {
          throw new Error(`USD-reference RPC chain ID does not match configured chain ${network.chainId}`);
        }
      });
      this.chainChecks.set(network.chainId, check);
      void check.catch(() => this.chainChecks.delete(network.chainId));
    }
    await check;
  }

  private async assertMetadata(
    chainId: number,
    feed: ChainlinkUsdReferenceFeedConfig,
    reader: UsdReferenceChainlinkReader,
  ): Promise<void> {
    const key = `${chainId}:${feed.aggregator.toLowerCase()}`;
    let check = this.metadataChecks.get(key);
    if (!check) {
      check = Promise.all([reader.readDecimals(feed.aggregator), reader.readDescription(feed.aggregator)])
        .then(([decimals, description]) => {
          if (decimals !== feed.decimals) throw new Error("USD-reference feed decimals do not match configuration");
          if (description !== feed.description) throw new Error("USD-reference feed description does not match configuration");
        });
      this.metadataChecks.set(key, check);
      void check.catch(() => this.metadataChecks.delete(key));
    }
    await check;
  }

  private async assertSequencer(
    network: ChainlinkUsdReferenceNetworkConfig,
    reader: UsdReferenceChainlinkReader,
    nowMs: number,
  ): Promise<void> {
    if (!network.sequencerUptimeFeed || network.sequencerGracePeriodSeconds === undefined) return;
    const [, answer, startedAt] = parseRoundData(await reader.readLatestRoundData(network.sequencerUptimeFeed));
    if (answer !== 0n) throw new Error(`USD-reference sequencer is down on chain ${network.chainId}`);
    if (startedAt <= 0n) throw new Error(`USD-reference sequencer status is not initialized on chain ${network.chainId}`);
    const nowSeconds = BigInt(Math.floor(nowMs / 1_000));
    if (startedAt > nowSeconds + BigInt(Math.ceil(this.config.maxFutureSkewMs / 1_000))) {
      throw new Error(`USD-reference sequencer status is from the future on chain ${network.chainId}`);
    }
    if (nowSeconds - startedAt <= BigInt(network.sequencerGracePeriodSeconds)) {
      throw new Error(`USD-reference sequencer grace period is active on chain ${network.chainId}`);
    }
  }
}

function createReader(network: ChainlinkUsdReferenceNetworkConfig): UsdReferenceChainlinkReader {
  const chain = defineChain({
    id: network.chainId,
    name: `EVM Chain ${network.chainId}`,
    nativeCurrency: { name: "Native Token", symbol: "NATIVE", decimals: 18 },
    rpcUrls: { default: { http: [network.rpcUrl] } },
  });
  const client = createPublicClient({ chain, transport: http(network.rpcUrl) });
  return {
    readChainId: () => client.getChainId(),
    readDecimals: (address) => client.readContract({ address, abi: chainlinkAggregatorV3Abi, functionName: "decimals" }),
    readDescription: (address) => client.readContract({
      address,
      abi: chainlinkAggregatorV3Abi,
      functionName: "description",
    }),
    readLatestRoundData: (address) => client.readContract({
      address,
      abi: chainlinkAggregatorV3Abi,
      functionName: "latestRoundData",
    }),
  };
}

function assertRound(
  roundId: bigint,
  answer: bigint,
  startedAt: bigint,
  updatedAt: bigint,
  answeredInRound: bigint,
  feed: ChainlinkUsdReferenceFeedConfig,
  config: ChainlinkUsdReferenceConfig,
  nowMs: number,
): void {
  if (roundId <= 0n || answeredInRound < roundId) throw new Error("USD-reference feed returned an incomplete round");
  if (answer <= 0n || answer < BigInt(feed.minAnswer) || answer > BigInt(feed.maxAnswer)) {
    throw new Error("USD-reference feed answer is outside configured circuit-breaker bounds");
  }
  if (startedAt <= 0n || startedAt > updatedAt || updatedAt <= 0n ||
      updatedAt > BigInt(Math.floor(Number.MAX_SAFE_INTEGER / 1_000))) {
    throw new Error("USD-reference feed returned invalid timestamps");
  }
  const ageMs = nowMs - Number(updatedAt) * 1_000;
  if (ageMs < -config.maxFutureSkewMs) throw new Error("USD-reference feed update is from the future");
  if (ageMs > config.maxPriceAgeMs) throw new Error("USD-reference feed update is stale");
}

function calculateDeviationBps(answer: bigint, decimals: number): number {
  const peg = 10n ** BigInt(decimals);
  const difference = answer >= peg ? answer - peg : peg - answer;
  return Number((difference * 10_000n + peg - 1n) / peg);
}

function deviationExceedsLimit(answer: bigint, decimals: number, maxDeviationBps: number): boolean {
  const peg = 10n ** BigInt(decimals);
  const difference = answer >= peg ? answer - peg : peg - answer;
  return difference * 10_000n > peg * BigInt(maxDeviationBps);
}

function parseRoundData(value: unknown): RoundData {
  if (!Array.isArray(value) || value.length !== 5 || value.some((field) => typeof field !== "bigint")) {
    throw new Error("USD-reference feed returned malformed round data");
  }
  return value as unknown as RoundData;
}

function assertReader(value: unknown): asserts value is UsdReferenceChainlinkReader {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("USD-reference reader must be an object");
  const reader = value as Record<string, unknown>;
  for (const method of ["readChainId", "readDecimals", "readDescription", "readLatestRoundData"]) {
    if (typeof reader[method] !== "function") throw new Error(`USD-reference reader.${method} must be a function`);
  }
}

function assertChainToken(chainId: number, tokenAddress: Address): void {
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error("USD-reference chainId must be positive");
  if (typeof tokenAddress !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(tokenAddress)) {
    throw new Error("USD-reference tokenAddress must be a 20-byte hex address");
  }
}

function currentTime(now: () => number): number {
  const value = now();
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("USD-reference clock must return a positive safe integer timestamp");
  }
  return value;
}
