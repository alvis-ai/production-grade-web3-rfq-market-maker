import type { Address, QuoteRequest } from "../../shared/types/rfq.js";

export interface ChainlinkFeedConfig {
  tokenIn: Address;
  tokenOut: Address;
  aggregator: Address;
  decimals: number;
  description: string;
  minAnswer: string;
  maxAnswer: string;
  invert: boolean;
}

export interface ChainlinkNetworkConfig {
  chainId: number;
  networkType: "l1" | "l2";
  rpcUrl: string;
  feeds: ChainlinkFeedConfig[];
  sequencerUptimeFeed?: Address;
  sequencerGracePeriodSeconds?: number;
}

export interface ChainlinkMarketDataConfig {
  networks: ChainlinkNetworkConfig[];
  referenceLiquidityUsd: string;
  referenceVolatilityBps: number;
  maxPriceAgeMs: number;
}

const configFields = ["networks", "referenceLiquidityUsd", "referenceVolatilityBps", "maxPriceAgeMs"] as const;
const networkRequiredFields = ["chainId", "networkType", "rpcUrl", "feeds"] as const;
const networkOptionalFields = ["sequencerUptimeFeed", "sequencerGracePeriodSeconds"] as const;
const feedFields = [
  "tokenIn", "tokenOut", "aggregator", "decimals", "description", "minAnswer", "maxAnswer", "invert",
] as const;
const maxInt256 = (1n << 255n) - 1n;

export function parseChainlinkMarketDataConfig(value: string): ChainlinkMarketDataConfig {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("RFQ_CHAINLINK_CONFIG_JSON must be a non-empty JSON object");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("RFQ_CHAINLINK_CONFIG_JSON must contain valid JSON");
  }
  assertChainlinkMarketDataConfig(parsed);
  return cloneChainlinkMarketDataConfig(parsed);
}

export function assertChainlinkMarketDataConfig(config: unknown): asserts config is ChainlinkMarketDataConfig {
  assertRecord(config, "Chainlink market data config");
  assertExactFields(config, configFields, [], "Chainlink market data config");
  if (!Array.isArray(config.networks) || config.networks.length === 0) {
    throw new Error("Chainlink market data config.networks must contain at least one network");
  }
  assertPositiveUIntString(config.referenceLiquidityUsd, "Chainlink market data config.referenceLiquidityUsd");
  assertInteger(config.referenceVolatilityBps, 0, 10_000, "Chainlink market data config.referenceVolatilityBps");
  assertInteger(config.maxPriceAgeMs, 1_000, 86_400_000, "Chainlink market data config.maxPriceAgeMs");

  const seenChains = new Set<number>();
  for (const network of config.networks) {
    assertNetworkConfig(network);
    if (seenChains.has(network.chainId)) throw new Error("Chainlink market data config must not contain duplicate chain IDs");
    seenChains.add(network.chainId);
  }
}

export function cloneChainlinkMarketDataConfig(config: ChainlinkMarketDataConfig): ChainlinkMarketDataConfig {
  return {
    networks: config.networks.map((network) => ({
      ...network,
      feeds: network.feeds.map((feed) => ({ ...feed })),
    })),
    referenceLiquidityUsd: config.referenceLiquidityUsd,
    referenceVolatilityBps: config.referenceVolatilityBps,
    maxPriceAgeMs: config.maxPriceAgeMs,
  };
}

export function chainlinkConfiguredPairs(config: ChainlinkMarketDataConfig): QuoteRequest[] {
  const pairs: QuoteRequest[] = [];
  for (const network of config.networks) {
    for (const feed of network.feeds) {
      pairs.push(toProbeRequest(network.chainId, feed.tokenIn, feed.tokenOut));
      pairs.push(toProbeRequest(network.chainId, feed.tokenOut, feed.tokenIn));
    }
  }
  return pairs;
}

function assertNetworkConfig(value: unknown): asserts value is ChainlinkNetworkConfig {
  assertRecord(value, "Chainlink network config");
  assertExactFields(value, networkRequiredFields, networkOptionalFields, "Chainlink network config");
  assertInteger(value.chainId, 1, Number.MAX_SAFE_INTEGER, "Chainlink network config.chainId");
  if (value.networkType !== "l1" && value.networkType !== "l2") {
    throw new Error("Chainlink network config.networkType must be l1 or l2");
  }
  assertRpcUrl(value.rpcUrl);
  if (!Array.isArray(value.feeds) || value.feeds.length === 0) {
    throw new Error("Chainlink network config.feeds must contain at least one feed");
  }

  const hasSequencerFeed = Object.prototype.hasOwnProperty.call(value, "sequencerUptimeFeed");
  const hasGracePeriod = Object.prototype.hasOwnProperty.call(value, "sequencerGracePeriodSeconds");
  if (hasSequencerFeed !== hasGracePeriod) {
    throw new Error("Chainlink network sequencerUptimeFeed and sequencerGracePeriodSeconds must be configured together");
  }
  if (value.networkType === "l2" && !hasSequencerFeed) {
    throw new Error("Chainlink L2 network requires a sequencer uptime feed and grace period");
  }
  if (value.networkType === "l1" && hasSequencerFeed) {
    throw new Error("Chainlink L1 network must not configure a sequencer uptime feed");
  }
  if (hasSequencerFeed) {
    assertNonZeroAddress(value.sequencerUptimeFeed, "Chainlink network config.sequencerUptimeFeed");
    assertInteger(value.sequencerGracePeriodSeconds, 1, 86_400, "Chainlink network config.sequencerGracePeriodSeconds");
  }

  const seenPairs = new Set<string>();
  for (const feed of value.feeds) {
    assertFeedConfig(feed);
    const direct = feedKey(feed.tokenIn, feed.tokenOut);
    const reverse = feedKey(feed.tokenOut, feed.tokenIn);
    if (seenPairs.has(direct) || seenPairs.has(reverse)) {
      throw new Error("Chainlink network config.feeds must not contain duplicate or reverse-duplicate token pairs");
    }
    seenPairs.add(direct);
  }
}

function assertFeedConfig(value: unknown): asserts value is ChainlinkFeedConfig {
  assertRecord(value, "Chainlink feed config");
  assertExactFields(value, feedFields, [], "Chainlink feed config");
  assertNonZeroAddress(value.tokenIn, "Chainlink feed config.tokenIn");
  assertNonZeroAddress(value.tokenOut, "Chainlink feed config.tokenOut");
  if (value.tokenIn.toLowerCase() === value.tokenOut.toLowerCase()) {
    throw new Error("Chainlink feed token pair must contain distinct tokens");
  }
  assertNonZeroAddress(value.aggregator, "Chainlink feed config.aggregator");
  assertInteger(value.decimals, 0, 18, "Chainlink feed config.decimals");
  assertDescription(value.description);
  assertPositiveInt256String(value.minAnswer, "Chainlink feed config.minAnswer");
  assertPositiveInt256String(value.maxAnswer, "Chainlink feed config.maxAnswer");
  if (BigInt(value.minAnswer) >= BigInt(value.maxAnswer)) {
    throw new Error("Chainlink feed config.minAnswer must be lower than maxAnswer");
  }
  if (typeof value.invert !== "boolean") throw new Error("Chainlink feed config.invert must be a boolean");
}

function assertRpcUrl(value: unknown): void {
  if (typeof value !== "string" || value.length > 2_048 || value.trim() !== value) {
    throw invalidRpcUrl();
  }
  try {
    const parsed = new URL(value);
    const loopback = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "::1" || parsed.hostname === "[::1]";
    if ((parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback)) || !parsed.hostname ||
        parsed.username || parsed.password || parsed.hash || parsed.hostname.includes("*")) {
      throw new Error();
    }
  } catch {
    throw invalidRpcUrl();
  }
}

function invalidRpcUrl(): Error {
  return new Error(
    "Chainlink network config.rpcUrl must be a bounded HTTPS URL or loopback HTTP URL without credentials, wildcard, or fragment",
  );
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`);
}

function assertExactFields(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  label: string,
): void {
  const allowed = new Set([...required, ...optional]);
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) throw new Error(`${label} must not include unknown field ${field}`);
  }
  for (const field of required) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) throw new Error(`${label}.${field} must be an own field`);
  }
  for (const field of optional) {
    if (field in value && !Object.prototype.hasOwnProperty.call(value, field)) {
      throw new Error(`${label}.${field} must be an own field when provided`);
    }
  }
}

function assertAddress(value: unknown, label: string): asserts value is Address {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`${label} must be a 20-byte hex address`);
  }
}

function assertNonZeroAddress(value: unknown, label: string): asserts value is Address {
  assertAddress(value, label);
  if (/^0x0{40}$/i.test(value)) throw new Error(`${label} must not be zero`);
}

function assertDescription(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 128 || value.trim() !== value ||
      !/^[\x20-\x7e]+$/.test(value)) {
    throw new Error("Chainlink feed config.description must be a bounded printable ASCII string");
  }
}

function assertPositiveInt256String(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value) || value.length > 77 ||
      BigInt(value) > maxInt256) {
    throw new Error(`${label} must be a canonical positive int256 string`);
  }
}

function assertInteger(value: unknown, min: number, max: number, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be an integer between ${min} and ${max}`);
  }
}

function assertPositiveUIntString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) throw new Error(`${label} must be a positive uint string`);
}

function feedKey(tokenIn: string, tokenOut: string): string {
  return `${tokenIn.toLowerCase()}:${tokenOut.toLowerCase()}`;
}

function toProbeRequest(chainId: number, tokenIn: Address, tokenOut: Address): QuoteRequest {
  return {
    chainId,
    tokenIn,
    tokenOut,
    user: "0x0000000000000000000000000000000000000001",
    amountIn: "1",
    slippageBps: 50,
  };
}
