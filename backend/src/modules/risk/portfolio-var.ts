import type { Address } from "../../shared/types/rfq.js";
import { normalizeHumanPrice } from "../pricing/price-normalization.js";
import {
  requireTokenMetadata,
  type TokenRegistry,
} from "../pricing/token-registry.js";

export interface PortfolioVarValuationPair {
  chainId: number;
  tokenAddress: Address;
  usdReferenceTokenAddress: Address;
}

export interface PortfolioVarPolicy {
  modelVersion: string;
  maxPortfolioVarUsd: string;
  confidenceMultiplierBps: number;
  horizonSeconds: number;
  maxSnapshotAgeMs: number;
  maxFutureSkewMs: number;
  valuationPairs: PortfolioVarValuationPair[];
}

export interface PortfolioVarPosition {
  chainId: number;
  tokenAddress: Address;
  balance: bigint;
}

export interface PortfolioVarSnapshot {
  snapshotId: string;
  chainId: number;
  tokenIn: Address;
  tokenOut: Address;
  midPrice: string;
  volatilityBps: number;
  observedAt: string;
}

export interface PortfolioVarComponent {
  tokenAddress: Address;
  balance: string;
  exposureUsdE18: string;
  volatilityBps: number;
  componentVarUsdE18: string;
  snapshotId: string;
}

export interface PortfolioVarCalculation {
  totalVarUsdE18: string;
  components: PortfolioVarComponent[];
}

export interface PortfolioVarEvaluation {
  modelVersion: string;
  horizonSeconds: number;
  preTradeVarUsdE18: string;
  postTradeVarUsdE18: string;
  varLimitUsdE18: string;
  preTradeComponents: PortfolioVarComponent[];
  postTradeComponents: PortfolioVarComponent[];
}

export interface NormalizedPortfolioVarPolicy {
  modelVersion: string;
  maxPortfolioVarUsdE18: bigint;
  confidenceMultiplierBps: number;
  horizonSeconds: number;
  maxSnapshotAgeMs: number;
  maxFutureSkewMs: number;
  valuationPairs: PortfolioVarValuationPair[];
}

const policyFields = [
  "modelVersion",
  "maxPortfolioVarUsd",
  "confidenceMultiplierBps",
  "horizonSeconds",
  "maxSnapshotAgeMs",
  "maxFutureSkewMs",
  "valuationPairs",
] as const;
const pairFields = ["chainId", "tokenAddress", "usdReferenceTokenAddress"] as const;
const safeIdentifierPattern = /^[A-Za-z0-9_:-]+$/;
const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const positiveUintPattern = /^[1-9][0-9]*$/;
const maxUint256 = (1n << 256n) - 1n;
const usdScale = 10n ** 18n;
const bpsScaleSquared = 10_000n * 10_000n;
const maxPolicyPairs = 10_000;

export function normalizePortfolioVarPolicy(
  policy: PortfolioVarPolicy,
  tokenRegistry: TokenRegistry,
): NormalizedPortfolioVarPolicy {
  assertPortfolioVarPolicy(policy);
  const seen = new Set<string>();
  const valuationPairs = policy.valuationPairs.map((pair) => {
    const token = requireTokenMetadata(tokenRegistry, pair.chainId, pair.tokenAddress, "Portfolio VaR asset");
    const usdReference = requireTokenMetadata(
      tokenRegistry,
      pair.chainId,
      pair.usdReferenceTokenAddress,
      "Portfolio VaR USD reference",
    );
    if (token.usdReference) {
      throw new Error("Portfolio VaR valuation pair tokenAddress must not be a USD-reference token");
    }
    if (!usdReference.usdReference) {
      throw new Error("Portfolio VaR valuation pair usdReferenceTokenAddress must be a USD-reference token");
    }
    const normalized = {
      chainId: pair.chainId,
      tokenAddress: pair.tokenAddress.toLowerCase() as Address,
      usdReferenceTokenAddress: pair.usdReferenceTokenAddress.toLowerCase() as Address,
    };
    const key = positionKey(normalized.chainId, normalized.tokenAddress);
    if (seen.has(key)) {
      throw new Error("Portfolio VaR policy must not contain duplicate chain/token valuation pairs");
    }
    seen.add(key);
    return normalized;
  });

  return {
    modelVersion: policy.modelVersion,
    maxPortfolioVarUsdE18: BigInt(policy.maxPortfolioVarUsd) * usdScale,
    confidenceMultiplierBps: policy.confidenceMultiplierBps,
    horizonSeconds: policy.horizonSeconds,
    maxSnapshotAgeMs: policy.maxSnapshotAgeMs,
    maxFutureSkewMs: policy.maxFutureSkewMs,
    valuationPairs,
  };
}

export function assertPortfolioVarPolicy(policy: unknown): asserts policy is PortfolioVarPolicy {
  assertRecord(policy, "Portfolio VaR policy");
  assertExactFields(policy, policyFields, "Portfolio VaR policy");
  assertSafeIdentifier(policy.modelVersion, "Portfolio VaR policy.modelVersion");
  assertPositiveUint256(policy.maxPortfolioVarUsd, "Portfolio VaR policy.maxPortfolioVarUsd");
  assertInteger(
    policy.confidenceMultiplierBps,
    1,
    100_000,
    "Portfolio VaR policy.confidenceMultiplierBps",
  );
  assertInteger(policy.horizonSeconds, 1, 2_592_000, "Portfolio VaR policy.horizonSeconds");
  assertInteger(policy.maxSnapshotAgeMs, 1_000, 86_400_000, "Portfolio VaR policy.maxSnapshotAgeMs");
  assertInteger(policy.maxFutureSkewMs, 0, 300_000, "Portfolio VaR policy.maxFutureSkewMs");
  if (
    !Array.isArray(policy.valuationPairs) ||
    policy.valuationPairs.length === 0 ||
    policy.valuationPairs.length > maxPolicyPairs
  ) {
    throw new Error(`Portfolio VaR policy.valuationPairs must contain between 1 and ${maxPolicyPairs} entries`);
  }

  const seen = new Set<string>();
  for (const pair of policy.valuationPairs) {
    assertRecord(pair, "Portfolio VaR valuation pair");
    assertExactFields(pair, pairFields, "Portfolio VaR valuation pair");
    assertInteger(pair.chainId, 1, Number.MAX_SAFE_INTEGER, "Portfolio VaR valuation pair.chainId");
    assertAddress(pair.tokenAddress, "Portfolio VaR valuation pair.tokenAddress");
    assertAddress(
      pair.usdReferenceTokenAddress,
      "Portfolio VaR valuation pair.usdReferenceTokenAddress",
    );
    if (pair.tokenAddress.toLowerCase() === pair.usdReferenceTokenAddress.toLowerCase()) {
      throw new Error("Portfolio VaR valuation pair must contain distinct tokens");
    }
    const key = positionKey(pair.chainId, pair.tokenAddress);
    if (seen.has(key)) {
      throw new Error("Portfolio VaR policy must not contain duplicate chain/token valuation pairs");
    }
    seen.add(key);
  }
}

export function calculatePortfolioVar(
  chainId: number,
  positions: readonly PortfolioVarPosition[],
  snapshots: readonly PortfolioVarSnapshot[],
  policy: NormalizedPortfolioVarPolicy,
  tokenRegistry: TokenRegistry,
  nowMs: number,
): PortfolioVarCalculation {
  assertInteger(chainId, 1, Number.MAX_SAFE_INTEGER, "Portfolio VaR chainId");
  assertInteger(nowMs, 1, Number.MAX_SAFE_INTEGER, "Portfolio VaR current time");
  if (!Array.isArray(positions)) throw new Error("Portfolio VaR positions must be an array");
  if (!Array.isArray(snapshots)) throw new Error("Portfolio VaR snapshots must be an array");

  const balances = aggregatePositions(chainId, positions);
  const pairs = new Map(
    policy.valuationPairs
      .filter((pair) => pair.chainId === chainId)
      .map((pair) => [positionKey(pair.chainId, pair.tokenAddress), pair]),
  );
  const snapshotByAsset = normalizeSnapshots(chainId, snapshots, pairs, policy, nowMs);
  const components: PortfolioVarComponent[] = [];
  let totalVarUsdE18 = 0n;

  for (const [key, position] of [...balances.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    if (position.balance === 0n) continue;
    const metadata = requireTokenMetadata(
      tokenRegistry,
      chainId,
      position.tokenAddress,
      "Portfolio VaR position",
    );
    if (metadata.usdReference) continue;
    const pair = pairs.get(key);
    if (!pair) {
      throw new Error(`Portfolio VaR has no valuation pair for ${key}`);
    }
    const snapshot = snapshotByAsset.get(key);
    if (!snapshot) {
      throw new Error(`Portfolio VaR has no usable market snapshot for ${key}`);
    }
    const price = normalizeHumanPrice(snapshot.midPrice);
    const direct = snapshot.tokenIn.toLowerCase() === pair.tokenAddress;
    const absoluteBalance = abs(position.balance);
    const exposureNumerator = direct
      ? absoluteBalance * price.numerator * usdScale
      : absoluteBalance * price.denominator * usdScale;
    const exposureDenominator = direct
      ? (10n ** BigInt(metadata.decimals)) * price.denominator
      : (10n ** BigInt(metadata.decimals)) * price.numerator;
    const absoluteExposureUsdE18 = ceilDiv(exposureNumerator, exposureDenominator);
    const exposureUsdE18 = position.balance < 0n ? -absoluteExposureUsdE18 : absoluteExposureUsdE18;
    const componentVarUsdE18 = ceilDiv(
      absoluteExposureUsdE18 * BigInt(snapshot.volatilityBps) * BigInt(policy.confidenceMultiplierBps),
      bpsScaleSquared,
    );
    totalVarUsdE18 += componentVarUsdE18;
    components.push({
      tokenAddress: position.tokenAddress,
      balance: position.balance.toString(),
      exposureUsdE18: exposureUsdE18.toString(),
      volatilityBps: snapshot.volatilityBps,
      componentVarUsdE18: componentVarUsdE18.toString(),
      snapshotId: snapshot.snapshotId,
    });
  }

  return { totalVarUsdE18: totalVarUsdE18.toString(), components };
}

export function evaluatePortfolioVar(
  chainId: number,
  preTradePositions: readonly PortfolioVarPosition[],
  postTradePositions: readonly PortfolioVarPosition[],
  snapshots: readonly PortfolioVarSnapshot[],
  policy: NormalizedPortfolioVarPolicy,
  tokenRegistry: TokenRegistry,
  nowMs: number,
): PortfolioVarEvaluation {
  const preTrade = calculatePortfolioVar(chainId, preTradePositions, snapshots, policy, tokenRegistry, nowMs);
  const postTrade = calculatePortfolioVar(chainId, postTradePositions, snapshots, policy, tokenRegistry, nowMs);
  return {
    modelVersion: policy.modelVersion,
    horizonSeconds: policy.horizonSeconds,
    preTradeVarUsdE18: preTrade.totalVarUsdE18,
    postTradeVarUsdE18: postTrade.totalVarUsdE18,
    varLimitUsdE18: policy.maxPortfolioVarUsdE18.toString(),
    preTradeComponents: preTrade.components,
    postTradeComponents: postTrade.components,
  };
}

export function applyPortfolioDelta(
  positions: readonly PortfolioVarPosition[],
  chainId: number,
  tokenIn: Address,
  amountIn: bigint,
  tokenOut: Address,
  amountOut: bigint,
): PortfolioVarPosition[] {
  assertInteger(chainId, 1, Number.MAX_SAFE_INTEGER, "Portfolio VaR delta chainId");
  assertAddress(tokenIn, "Portfolio VaR delta tokenIn");
  assertAddress(tokenOut, "Portfolio VaR delta tokenOut");
  if (tokenIn.toLowerCase() === tokenOut.toLowerCase()) {
    throw new Error("Portfolio VaR delta tokens must be distinct");
  }
  if (typeof amountIn !== "bigint" || amountIn <= 0n || typeof amountOut !== "bigint" || amountOut <= 0n) {
    throw new Error("Portfolio VaR delta amounts must be positive bigints");
  }
  const balances = aggregatePositions(chainId, positions);
  addBalance(balances, chainId, tokenIn, amountIn);
  addBalance(balances, chainId, tokenOut, -amountOut);
  return [...balances.values()].sort((left, right) =>
    left.tokenAddress.toLowerCase().localeCompare(right.tokenAddress.toLowerCase()));
}

function normalizeSnapshots(
  chainId: number,
  snapshots: readonly PortfolioVarSnapshot[],
  pairs: ReadonlyMap<string, PortfolioVarValuationPair>,
  policy: NormalizedPortfolioVarPolicy,
  nowMs: number,
): Map<string, PortfolioVarSnapshot> {
  const normalized = new Map<string, PortfolioVarSnapshot>();
  for (const snapshot of snapshots) {
    assertRecord(snapshot, "Portfolio VaR snapshot");
    assertSafeIdentifier(snapshot.snapshotId, "Portfolio VaR snapshot.snapshotId");
    assertInteger(snapshot.chainId, 1, Number.MAX_SAFE_INTEGER, "Portfolio VaR snapshot.chainId");
    assertAddress(snapshot.tokenIn, "Portfolio VaR snapshot.tokenIn");
    assertAddress(snapshot.tokenOut, "Portfolio VaR snapshot.tokenOut");
    normalizeHumanPrice(snapshot.midPrice);
    assertInteger(snapshot.volatilityBps, 0, 10_000, "Portfolio VaR snapshot.volatilityBps");
    const observedAtMs = Date.parse(snapshot.observedAt);
    if (!Number.isSafeInteger(observedAtMs) || new Date(observedAtMs).toISOString() !== snapshot.observedAt) {
      throw new Error("Portfolio VaR snapshot.observedAt must be a canonical UTC ISO timestamp");
    }
    if (observedAtMs < nowMs - policy.maxSnapshotAgeMs) {
      throw new Error(`Portfolio VaR snapshot ${snapshot.snapshotId} is stale`);
    }
    if (observedAtMs > nowMs + policy.maxFutureSkewMs) {
      throw new Error(`Portfolio VaR snapshot ${snapshot.snapshotId} is from the future`);
    }
    if (snapshot.chainId !== chainId) continue;
    const tokenIn = snapshot.tokenIn.toLowerCase() as Address;
    const tokenOut = snapshot.tokenOut.toLowerCase() as Address;
    const directKey = positionKey(chainId, tokenIn);
    const reverseKey = positionKey(chainId, tokenOut);
    const directPair = pairs.get(directKey);
    const reversePair = pairs.get(reverseKey);
    const pair = directPair?.usdReferenceTokenAddress === tokenOut
      ? directPair
      : reversePair?.usdReferenceTokenAddress === tokenIn
        ? reversePair
        : undefined;
    if (!pair) throw new Error(`Portfolio VaR snapshot ${snapshot.snapshotId} is not a configured valuation pair`);
    const key = positionKey(chainId, pair.tokenAddress);
    if (normalized.has(key)) {
      throw new Error(`Portfolio VaR received duplicate snapshots for ${key}`);
    }
    normalized.set(key, { ...snapshot, tokenIn, tokenOut });
  }
  return normalized;
}

function aggregatePositions(
  chainId: number,
  positions: readonly PortfolioVarPosition[],
): Map<string, PortfolioVarPosition> {
  const balances = new Map<string, PortfolioVarPosition>();
  for (const position of positions) {
    assertRecord(position, "Portfolio VaR position");
    assertInteger(position.chainId, 1, Number.MAX_SAFE_INTEGER, "Portfolio VaR position.chainId");
    assertAddress(position.tokenAddress, "Portfolio VaR position.tokenAddress");
    if (typeof position.balance !== "bigint") throw new Error("Portfolio VaR position.balance must be a bigint");
    if (position.chainId !== chainId) throw new Error("Portfolio VaR position chain does not match evaluation chain");
    addBalance(balances, chainId, position.tokenAddress, position.balance);
  }
  return balances;
}

function addBalance(
  balances: Map<string, PortfolioVarPosition>,
  chainId: number,
  tokenAddress: Address,
  delta: bigint,
): void {
  const normalizedToken = tokenAddress.toLowerCase() as Address;
  const key = positionKey(chainId, normalizedToken);
  const existing = balances.get(key);
  balances.set(key, {
    chainId,
    tokenAddress: normalizedToken,
    balance: (existing?.balance ?? 0n) + delta,
  });
}

function positionKey(chainId: number, tokenAddress: string): string {
  return `${chainId}:${tokenAddress.toLowerCase()}`;
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  if (numerator < 0n || denominator <= 0n) throw new Error("Portfolio VaR ceil division inputs are invalid");
  return numerator === 0n ? 0n : ((numerator - 1n) / denominator) + 1n;
}

function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function assertExactFields(value: Record<string, unknown>, fields: readonly string[], label: string): void {
  const expected = new Set(fields);
  for (const field of Object.keys(value)) {
    if (!expected.has(field)) throw new Error(`${label} must not include unknown field ${field}`);
  }
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) throw new Error(`${label}.${field} must be an own field`);
  }
}

function assertSafeIdentifier(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.length < 1 || value.length > 128 || !safeIdentifierPattern.test(value)) {
    throw new Error(`${label} must be a 1-128 character safe identifier`);
  }
}

function assertAddress(value: unknown, label: string): asserts value is Address {
  if (typeof value !== "string" || !addressPattern.test(value)) {
    throw new Error(`${label} must be a 20-byte hex address`);
  }
}

function assertPositiveUint256(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !positiveUintPattern.test(value) || BigInt(value) > maxUint256) {
    throw new Error(`${label} must be a canonical positive uint256 string`);
  }
}

function assertInteger(value: unknown, min: number, max: number, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be an integer between ${min} and ${max}`);
  }
}
