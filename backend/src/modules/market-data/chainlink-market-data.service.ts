import { createPublicClient, defineChain, encodePacked, http, keccak256 } from "viem";
import type { Address, MarketSnapshot, QuoteRequest } from "../../shared/types/rfq.js";
import { tagMarketDataSnapshot, type MarketDataService } from "./market-data.service.js";
import { chainlinkAggregatorV3Abi } from "./chainlink-abi.js";
import {
  assertChainlinkMarketDataConfig,
  cloneChainlinkMarketDataConfig,
  type ChainlinkFeedConfig,
  type ChainlinkMarketDataConfig,
  type ChainlinkNetworkConfig,
} from "./chainlink-config.js";

export type ChainlinkRoundData = readonly [bigint, bigint, bigint, bigint, bigint];

export interface ChainlinkReader {
  readDecimals(address: Address): Promise<unknown>;
  readLatestRoundData(address: Address): Promise<unknown>;
}

export type ChainlinkReaderFactory = (network: ChainlinkNetworkConfig) => ChainlinkReader;

interface ResolvedFeed {
  feed: ChainlinkFeedConfig;
  invert: boolean;
}

const requestFields = ["chainId", "user", "tokenIn", "tokenOut", "amountIn", "slippageBps"] as const;
const maxFutureSkewSeconds = 1n;

export class ChainlinkMarketDataService implements MarketDataService {
  private readonly config: ChainlinkMarketDataConfig;
  private readonly networks = new Map<number, ChainlinkNetworkConfig>();
  private readonly readers = new Map<number, ChainlinkReader>();
  private readonly decimalsByFeed = new Map<string, Promise<number>>();

  constructor(config: ChainlinkMarketDataConfig, readerFactory: ChainlinkReaderFactory = createReader) {
    assertChainlinkMarketDataConfig(config);
    this.config = cloneChainlinkMarketDataConfig(config);
    for (const network of this.config.networks) {
      this.networks.set(network.chainId, network);
      this.readers.set(network.chainId, readerFactory(network));
    }
  }

  async getSnapshot(request: QuoteRequest): Promise<MarketSnapshot> {
    assertQuoteRequest(request);
    const network = this.networks.get(request.chainId);
    const reader = this.readers.get(request.chainId);
    if (!network || !reader) throw new Error(`Chainlink market data does not support chain ${request.chainId}`);

    const resolved = resolveFeed(network, request.tokenIn, request.tokenOut);
    if (!resolved) {
      throw new Error(`Chainlink market data has no feed for ${request.tokenIn}/${request.tokenOut} on chain ${request.chainId}`);
    }

    await this.assertSequencerAvailable(network, reader);
    const [roundData] = await Promise.all([
      reader.readLatestRoundData(resolved.feed.aggregator).then((value) => parseRoundData(value, "price feed")),
      this.assertFeedDecimals(request.chainId, resolved.feed, reader),
    ]);
    const [roundId, answer, , updatedAt] = roundData;
    const observedAtMs = assertFreshPriceRound(roundId, answer, updatedAt, this.config.maxPriceAgeMs);
    const midPrice = formatAnswer(answer, resolved.feed.decimals, resolved.invert);

    return tagMarketDataSnapshot({
      snapshotId: [
        "snapshot",
        request.chainId.toString(),
        "chainlink",
        keccak256(encodePacked(
          ["address", "address", "address", "uint256"],
          [request.tokenIn, request.tokenOut, resolved.feed.aggregator, roundId],
        )).slice(2),
      ].join("_"),
      midPrice,
      liquidityUsd: this.config.referenceLiquidityUsd,
      volatilityBps: this.config.referenceVolatilityBps,
      observedAt: new Date(observedAtMs).toISOString(),
    }, "chainlink-aggregator-v3");
  }

  private async assertSequencerAvailable(network: ChainlinkNetworkConfig, reader: ChainlinkReader): Promise<void> {
    if (!network.sequencerUptimeFeed || network.sequencerGracePeriodSeconds === undefined) return;
    const [, answer, startedAt] = parseRoundData(
      await reader.readLatestRoundData(network.sequencerUptimeFeed),
      "sequencer uptime feed",
    );
    if (answer !== 0n) throw new Error(`Chainlink sequencer is down on chain ${network.chainId}`);
    if (startedAt <= 0n) throw new Error(`Chainlink sequencer status is not initialized on chain ${network.chainId}`);
    const nowSeconds = BigInt(Math.floor(Date.now() / 1_000));
    if (startedAt > nowSeconds + maxFutureSkewSeconds) {
      throw new Error(`Chainlink sequencer status is from the future on chain ${network.chainId}`);
    }
    if (nowSeconds - startedAt <= BigInt(network.sequencerGracePeriodSeconds)) {
      throw new Error(`Chainlink sequencer grace period is active on chain ${network.chainId}`);
    }
  }

  private async assertFeedDecimals(chainId: number, feed: ChainlinkFeedConfig, reader: ChainlinkReader): Promise<void> {
    const key = `${chainId}:${feed.aggregator.toLowerCase()}`;
    let decimals = this.decimalsByFeed.get(key);
    if (!decimals) {
      decimals = reader.readDecimals(feed.aggregator).then((value) => {
        if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 18) {
          throw new Error("Chainlink price feed returned invalid decimals");
        }
        return value;
      });
      this.decimalsByFeed.set(key, decimals);
      void decimals.catch(() => this.decimalsByFeed.delete(key));
    }
    const actual = await decimals;
    if (actual !== feed.decimals) {
      throw new Error(`Chainlink price feed decimals mismatch: configured ${feed.decimals}, onchain ${actual}`);
    }
  }
}

function createReader(network: ChainlinkNetworkConfig): ChainlinkReader {
  const chain = defineChain({
    id: network.chainId,
    name: `EVM Chain ${network.chainId}`,
    nativeCurrency: { name: "Native Token", symbol: "NATIVE", decimals: 18 },
    rpcUrls: { default: { http: [network.rpcUrl] } },
  });
  const client = createPublicClient({ chain, transport: http(network.rpcUrl) });
  return {
    readDecimals: (address) => client.readContract({
      address,
      abi: chainlinkAggregatorV3Abi,
      functionName: "decimals",
    }),
    readLatestRoundData: (address) => client.readContract({
      address,
      abi: chainlinkAggregatorV3Abi,
      functionName: "latestRoundData",
    }),
  };
}

function resolveFeed(network: ChainlinkNetworkConfig, tokenIn: Address, tokenOut: Address): ResolvedFeed | undefined {
  for (const feed of network.feeds) {
    if (sameAddress(feed.tokenIn, tokenIn) && sameAddress(feed.tokenOut, tokenOut)) {
      return { feed, invert: feed.invert };
    }
    if (sameAddress(feed.tokenIn, tokenOut) && sameAddress(feed.tokenOut, tokenIn)) {
      return { feed, invert: !feed.invert };
    }
  }
  return undefined;
}

function parseRoundData(value: unknown, label: string): ChainlinkRoundData {
  if (!Array.isArray(value) || value.length !== 5 || value.some((field) => typeof field !== "bigint")) {
    throw new Error(`Chainlink ${label} returned malformed round data`);
  }
  return value as unknown as ChainlinkRoundData;
}

function assertFreshPriceRound(roundId: bigint, answer: bigint, updatedAt: bigint, maxPriceAgeMs: number): number {
  if (roundId <= 0n) throw new Error("Chainlink price feed returned an invalid round ID");
  if (answer <= 0n) throw new Error("Chainlink price feed returned a non-positive answer");
  if (updatedAt <= 0n || updatedAt > BigInt(Math.floor(Number.MAX_SAFE_INTEGER / 1_000))) {
    throw new Error("Chainlink price feed returned an invalid update timestamp");
  }
  const observedAtMs = Number(updatedAt) * 1_000;
  const ageMs = Date.now() - observedAtMs;
  if (ageMs < -Number(maxFutureSkewSeconds) * 1_000) throw new Error("Chainlink price feed update is from the future");
  if (ageMs > maxPriceAgeMs) throw new Error("Chainlink price feed update is stale");
  return observedAtMs;
}

function formatAnswer(answer: bigint, decimals: number, invert: boolean): string {
  if (!invert) return formatFixed(answer, decimals);
  const scaledInverse = 10n ** BigInt(decimals + 18) / answer;
  if (scaledInverse <= 0n) throw new Error("Chainlink inverted price is below supported precision");
  return formatFixed(scaledInverse, 18);
}

function formatFixed(value: bigint, decimals: number): string {
  if (value <= 0n) throw new Error("Chainlink price must be positive");
  if (decimals === 0) return value.toString();
  const padded = value.toString().padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return fraction.length > 0 ? `${whole}.${fraction}` : whole;
}

function assertQuoteRequest(value: unknown): asserts value is QuoteRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Chainlink market data request must be an object");
  const request = value as Record<string, unknown>;
  const expected = new Set(requestFields);
  for (const field of Object.keys(request)) {
    if (!expected.has(field as typeof requestFields[number])) throw new Error(`Chainlink market data request must not include unknown field ${field}`);
  }
  for (const field of requestFields) {
    if (!Object.prototype.hasOwnProperty.call(request, field)) throw new Error(`Chainlink market data request.${field} must be an own field`);
  }
  if (!Number.isSafeInteger(request.chainId) || Number(request.chainId) <= 0) throw new Error("Chainlink market data request.chainId must be a positive safe integer");
  assertAddress(request.user, "request.user");
  assertAddress(request.tokenIn, "request.tokenIn");
  assertAddress(request.tokenOut, "request.tokenOut");
  if (sameAddress(request.tokenIn, request.tokenOut)) throw new Error("Chainlink market data request tokens must be distinct");
  if (typeof request.amountIn !== "string" || !/^[1-9][0-9]*$/.test(request.amountIn)) throw new Error("Chainlink market data request.amountIn must be a positive uint string");
  if (!Number.isSafeInteger(request.slippageBps) || Number(request.slippageBps) < 0 || Number(request.slippageBps) > 10_000) {
    throw new Error("Chainlink market data request.slippageBps must be an integer from 0 to 10000");
  }
}

function assertAddress(value: unknown, label: string): asserts value is Address {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error(`Chainlink market data ${label} must be a 20-byte hex address`);
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}
