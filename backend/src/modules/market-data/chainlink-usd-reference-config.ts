import type { Address } from "../../shared/types/rfq.js";

export interface ChainlinkUsdReferenceFeedConfig {
  tokenAddress: Address;
  aggregator: Address;
  decimals: number;
  description: string;
  minAnswer: string;
  maxAnswer: string;
}

export interface ChainlinkUsdReferenceNetworkConfig {
  chainId: number;
  networkType: "l1" | "l2";
  rpcUrl: string;
  feeds: ChainlinkUsdReferenceFeedConfig[];
  sequencerUptimeFeed?: Address;
  sequencerGracePeriodSeconds?: number;
}

export interface ChainlinkUsdReferenceConfig {
  policyVersion: string;
  networks: ChainlinkUsdReferenceNetworkConfig[];
  maxPriceAgeMs: number;
  maxFutureSkewMs: number;
  maxDeviationBps: number;
  cacheTtlMs: number;
}

const configFields = [
  "policyVersion",
  "networks",
  "maxPriceAgeMs",
  "maxFutureSkewMs",
  "maxDeviationBps",
  "cacheTtlMs",
] as const;
const networkRequiredFields = ["chainId", "networkType", "rpcUrl", "feeds"] as const;
const networkOptionalFields = ["sequencerUptimeFeed", "sequencerGracePeriodSeconds"] as const;
const feedFields = ["tokenAddress", "aggregator", "decimals", "description", "minAnswer", "maxAnswer"] as const;
const maxInt256 = (1n << 255n) - 1n;

export function parseChainlinkUsdReferenceConfig(value: string): ChainlinkUsdReferenceConfig {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("RFQ_USD_REFERENCE_CONFIG_JSON must be a non-empty JSON object");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("RFQ_USD_REFERENCE_CONFIG_JSON must contain valid JSON");
  }
  assertChainlinkUsdReferenceConfig(parsed);
  return cloneChainlinkUsdReferenceConfig(parsed);
}

export function assertChainlinkUsdReferenceConfig(
  value: unknown,
): asserts value is ChainlinkUsdReferenceConfig {
  assertRecord(value, "USD-reference config");
  assertExactFields(value, configFields, [], "USD-reference config");
  assertPolicyVersion(value.policyVersion);
  if (!Array.isArray(value.networks) || value.networks.length === 0 || value.networks.length > 100) {
    throw new Error("USD-reference config.networks must contain between 1 and 100 networks");
  }
  assertInteger(value.maxPriceAgeMs, 1_000, 86_400_000, "USD-reference config.maxPriceAgeMs");
  assertInteger(value.maxFutureSkewMs, 0, 300_000, "USD-reference config.maxFutureSkewMs");
  assertInteger(value.maxDeviationBps, 1, 5_000, "USD-reference config.maxDeviationBps");
  assertInteger(value.cacheTtlMs, 0, 60_000, "USD-reference config.cacheTtlMs");
  if (value.cacheTtlMs > value.maxPriceAgeMs) {
    throw new Error("USD-reference config.cacheTtlMs must not exceed maxPriceAgeMs");
  }

  const chainIds = new Set<number>();
  const tokenKeys = new Set<string>();
  const aggregatorKeys = new Set<string>();
  for (const network of value.networks) {
    assertNetwork(network);
    if (chainIds.has(network.chainId)) {
      throw new Error("USD-reference config must not contain duplicate chain IDs");
    }
    chainIds.add(network.chainId);
    for (const feed of network.feeds) {
      const key = usdReferenceFeedKey(network.chainId, feed.tokenAddress);
      if (tokenKeys.has(key)) {
        throw new Error("USD-reference config must not contain duplicate chain/token feeds");
      }
      tokenKeys.add(key);
      const aggregatorKey = `${network.chainId}:${feed.aggregator.toLowerCase()}`;
      if (aggregatorKeys.has(aggregatorKey)) {
        throw new Error("USD-reference config must not reuse one aggregator for multiple tokens");
      }
      aggregatorKeys.add(aggregatorKey);
    }
  }
}

export function cloneChainlinkUsdReferenceConfig(
  config: ChainlinkUsdReferenceConfig,
): ChainlinkUsdReferenceConfig {
  return {
    ...config,
    networks: config.networks.map((network) => ({
      ...network,
      feeds: network.feeds.map((feed) => ({ ...feed })),
    })),
  };
}

export function usdReferenceFeedKey(chainId: number, tokenAddress: string): string {
  return `${chainId}:${tokenAddress.toLowerCase()}`;
}

function assertNetwork(value: unknown): asserts value is ChainlinkUsdReferenceNetworkConfig {
  assertRecord(value, "USD-reference network");
  assertExactFields(value, networkRequiredFields, networkOptionalFields, "USD-reference network");
  assertInteger(value.chainId, 1, Number.MAX_SAFE_INTEGER, "USD-reference network.chainId");
  if (value.networkType !== "l1" && value.networkType !== "l2") {
    throw new Error("USD-reference network.networkType must be l1 or l2");
  }
  assertRpcUrl(value.rpcUrl);
  if (!Array.isArray(value.feeds) || value.feeds.length === 0 || value.feeds.length > 1_000) {
    throw new Error("USD-reference network.feeds must contain between 1 and 1000 feeds");
  }
  const hasSequencerFeed = Object.prototype.hasOwnProperty.call(value, "sequencerUptimeFeed");
  const hasGracePeriod = Object.prototype.hasOwnProperty.call(value, "sequencerGracePeriodSeconds");
  if (hasSequencerFeed !== hasGracePeriod) {
    throw new Error("USD-reference network sequencer feed and grace period must be configured together");
  }
  if (value.networkType === "l2" && !hasSequencerFeed) {
    throw new Error("USD-reference L2 network requires a sequencer uptime feed and grace period");
  }
  if (value.networkType === "l1" && hasSequencerFeed) {
    throw new Error("USD-reference L1 network must not configure a sequencer uptime feed");
  }
  if (hasSequencerFeed) {
    assertNonZeroAddress(value.sequencerUptimeFeed, "USD-reference network.sequencerUptimeFeed");
    assertInteger(
      value.sequencerGracePeriodSeconds,
      1,
      86_400,
      "USD-reference network.sequencerGracePeriodSeconds",
    );
  }
  for (const feed of value.feeds) assertFeed(feed);
}

function assertFeed(value: unknown): asserts value is ChainlinkUsdReferenceFeedConfig {
  assertRecord(value, "USD-reference feed");
  assertExactFields(value, feedFields, [], "USD-reference feed");
  assertNonZeroAddress(value.tokenAddress, "USD-reference feed.tokenAddress");
  assertNonZeroAddress(value.aggregator, "USD-reference feed.aggregator");
  assertInteger(value.decimals, 0, 18, "USD-reference feed.decimals");
  if (typeof value.description !== "string" || value.description.length < 5 || value.description.length > 128 ||
      value.description.trim() !== value.description || !/^[\x20-\x7e]+$/.test(value.description) ||
      !/ \/ USD$/.test(value.description)) {
    throw new Error("USD-reference feed.description must be a bounded printable token / USD identity");
  }
  assertPositiveInt256String(value.minAnswer, "USD-reference feed.minAnswer");
  assertPositiveInt256String(value.maxAnswer, "USD-reference feed.maxAnswer");
  if (BigInt(value.minAnswer) >= BigInt(value.maxAnswer)) {
    throw new Error("USD-reference feed.minAnswer must be lower than maxAnswer");
  }
  const pegAnswer = 10n ** BigInt(value.decimals);
  if (BigInt(value.minAnswer) >= pegAnswer || BigInt(value.maxAnswer) <= pegAnswer) {
    throw new Error("USD-reference feed bounds must contain the 1 USD peg");
  }
}

function assertPolicyVersion(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length < 1 || value.length > 64 || value.trim() !== value ||
      !/^[A-Za-z0-9._:-]+$/.test(value)) {
    throw new Error("USD-reference config.policyVersion must be a bounded safe identifier");
  }
}

function assertRpcUrl(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length > 2_048 || value.trim() !== value) throw invalidRpcUrl();
  try {
    const parsed = new URL(value);
    const loopback = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "::1" || parsed.hostname === "[::1]";
    if ((parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback)) || !parsed.hostname ||
        parsed.username || parsed.password || parsed.hash || parsed.hostname.includes("*")) throw new Error();
  } catch {
    throw invalidRpcUrl();
  }
}

function invalidRpcUrl(): Error {
  return new Error(
    "USD-reference network.rpcUrl must be a bounded HTTPS URL or loopback HTTP URL without credentials, wildcard, or fragment",
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

function assertNonZeroAddress(value: unknown, label: string): asserts value is Address {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value) || /^0x0{40}$/i.test(value)) {
    throw new Error(`${label} must be a non-zero 20-byte hex address`);
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
