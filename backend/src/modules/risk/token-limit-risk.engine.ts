import type { Address } from "../../shared/types/rfq.js";
import {
  ConfiguredTokenRegistry,
  requireTokenMetadata,
  type TokenMetadata,
  type TokenRegistry,
} from "../pricing/token-registry.js";
import {
  assertRiskInput,
  type RiskDecision,
  type RiskEngine,
  type RiskInput,
  type RiskRejectReasonCode,
  type ToxicFlowScore,
} from "./risk.engine.js";
import type { QuoteExposurePolicy } from "./quote-exposure.store.js";

export interface TokenRiskLimit {
  chainId: number;
  tokenAddress: Address;
  maxAmountIn: string;
  minAmountOut: string;
  maxNotionalUsd: string;
  maxAbsoluteInventory: string;
}

export interface TokenLimitRiskPolicy {
  policyVersion: string;
  enabledChainIds: number[];
  tokenLimits: TokenRiskLimit[];
  restrictedUsers: Address[];
  toxicFlowScores: ToxicFlowScore[];
  maxToxicScoreBps: number;
  maxUserOpenNotionalUsd: string;
  maxPairOpenNotionalUsd: string;
  minLiquidityUsd: string;
  maxVolatilityBps: number;
  maxSlippageBps: number;
  maxQuotedSpreadBps: number;
}

interface ParsedTokenRiskLimit {
  config: TokenRiskLimit;
  maxAmountIn: bigint;
  minAmountOut: bigint;
  maxNotionalUsd: bigint;
  maxAbsoluteInventory: bigint;
  metadata: TokenMetadata;
}

export const defaultTokenLimitRiskPolicy: TokenLimitRiskPolicy = {
  policyVersion: "token-limit-risk-v1",
  enabledChainIds: [1],
  tokenLimits: [
    {
      chainId: 1,
      tokenAddress: "0x0000000000000000000000000000000000000002",
      maxAmountIn: "1000000000000000000000",
      minAmountOut: "1",
      maxNotionalUsd: "1000000",
      maxAbsoluteInventory: "10000000000000000000000",
    },
    {
      chainId: 1,
      tokenAddress: "0x0000000000000000000000000000000000000003",
      maxAmountIn: "1000000000000000000000",
      minAmountOut: "1",
      maxNotionalUsd: "1000000",
      maxAbsoluteInventory: "10000000000000000000000",
    },
  ],
  restrictedUsers: [],
  toxicFlowScores: [],
  maxToxicScoreBps: 8_000,
  maxUserOpenNotionalUsd: "2000000",
  maxPairOpenNotionalUsd: "5000000",
  minLiquidityUsd: "1000000",
  maxVolatilityBps: 500,
  maxSlippageBps: 500,
  maxQuotedSpreadBps: 1_000,
};

const policyFields = [
  "policyVersion",
  "enabledChainIds",
  "tokenLimits",
  "restrictedUsers",
  "toxicFlowScores",
  "maxToxicScoreBps",
  "maxUserOpenNotionalUsd",
  "maxPairOpenNotionalUsd",
  "minLiquidityUsd",
  "maxVolatilityBps",
  "maxSlippageBps",
  "maxQuotedSpreadBps",
] as const;
const tokenLimitFields = [
  "chainId",
  "tokenAddress",
  "maxAmountIn",
  "minAmountOut",
  "maxNotionalUsd",
  "maxAbsoluteInventory",
] as const;
const toxicFlowScoreFields = ["user", "scoreBps"] as const;
const safeIdentifierPattern = /^[A-Za-z0-9_:-]+$/;
const maxSafeIdentifierLength = 128;
const maxPolicyEntries = 10_000;
const maxUint256 = (1n << 256n) - 1n;

export class TokenLimitRiskEngine implements RiskEngine {
  private readonly policy: TokenLimitRiskPolicy;
  private readonly enabledChainIds: ReadonlySet<number>;
  private readonly limitsByToken: ReadonlyMap<string, ParsedTokenRiskLimit>;
  private readonly restrictedUsers: ReadonlySet<string>;
  private readonly toxicFlowScores: ReadonlyMap<string, number>;
  private readonly minLiquidityUsd: bigint;

  constructor(
    policy: TokenLimitRiskPolicy = defaultTokenLimitRiskPolicy,
    tokenRegistry: TokenRegistry = new ConfiguredTokenRegistry(),
  ) {
    assertTokenLimitRiskPolicy(policy);
    this.policy = cloneTokenLimitRiskPolicy(policy);
    this.enabledChainIds = new Set(this.policy.enabledChainIds);
    this.minLiquidityUsd = BigInt(this.policy.minLiquidityUsd);
    this.limitsByToken = new Map(this.policy.tokenLimits.map((limit) => [
      tokenLimitKey(limit.chainId, limit.tokenAddress),
      {
        config: { ...limit },
        maxAmountIn: BigInt(limit.maxAmountIn),
        minAmountOut: BigInt(limit.minAmountOut),
        maxNotionalUsd: BigInt(limit.maxNotionalUsd),
        maxAbsoluteInventory: BigInt(limit.maxAbsoluteInventory),
        metadata: requireTokenMetadata(tokenRegistry, limit.chainId, limit.tokenAddress, "Risk policy"),
      },
    ]));
    this.restrictedUsers = new Set(this.policy.restrictedUsers.map((user) => user.toLowerCase()));
    this.toxicFlowScores = new Map(
      this.policy.toxicFlowScores.map((score) => [score.user.toLowerCase(), score.scoreBps]),
    );
  }

  getTokenLimit(chainId: number, tokenAddress: Address): TokenRiskLimit | undefined {
    if (!Number.isSafeInteger(chainId) || chainId <= 0 || !isAddress(tokenAddress)) return undefined;
    const limit = this.limitsByToken.get(tokenLimitKey(chainId, tokenAddress));
    return limit ? { ...limit.config } : undefined;
  }

  getQuoteExposurePolicy(): QuoteExposurePolicy {
    return {
      maxUserOpenNotionalUsd: this.policy.maxUserOpenNotionalUsd,
      maxPairOpenNotionalUsd: this.policy.maxPairOpenNotionalUsd,
    };
  }

  async evaluate(input: RiskInput): Promise<RiskDecision> {
    assertRiskInput(input);
    if (!this.enabledChainIds.has(input.request.chainId)) return this.reject("CHAIN_NOT_ENABLED");

    const tokenInLimit = this.limitsByToken.get(tokenLimitKey(input.request.chainId, input.request.tokenIn));
    const tokenOutLimit = this.limitsByToken.get(tokenLimitKey(input.request.chainId, input.request.tokenOut));
    if (!tokenInLimit || !tokenOutLimit) return this.reject("TOKEN_NOT_ALLOWED");

    if (BigInt(input.snapshot.liquidityUsd) < this.minLiquidityUsd) {
      return this.reject("MARKET_LIQUIDITY_TOO_LOW");
    }
    if (input.snapshot.volatilityBps > this.policy.maxVolatilityBps) {
      return this.reject("MARKET_VOLATILITY_LIMIT_EXCEEDED");
    }

    if (BigInt(input.request.amountIn) > tokenInLimit.maxAmountIn) {
      return this.reject("AMOUNT_IN_LIMIT_EXCEEDED");
    }
    if (BigInt(input.pricing.amountOut) < tokenOutLimit.minAmountOut) {
      return this.reject("AMOUNT_OUT_TOO_SMALL");
    }

    const maxNotionalUsd = min(tokenInLimit.maxNotionalUsd, tokenOutLimit.maxNotionalUsd);
    let hasUsdReference = false;
    if (tokenInLimit.metadata.usdReference) {
      hasUsdReference = true;
      if (exceedsUsdNotional(input.request.amountIn, tokenInLimit.metadata.decimals, maxNotionalUsd)) {
        return this.reject("QUOTE_NOTIONAL_LIMIT_EXCEEDED");
      }
    }
    if (tokenOutLimit.metadata.usdReference) {
      hasUsdReference = true;
      if (exceedsUsdNotional(input.pricing.amountOut, tokenOutLimit.metadata.decimals, maxNotionalUsd)) {
        return this.reject("QUOTE_NOTIONAL_LIMIT_EXCEEDED");
      }
    }
    if (!hasUsdReference) return this.reject("USD_REFERENCE_REQUIRED");

    if (this.restrictedUsers.has(input.request.user.toLowerCase())) {
      return this.reject("TOXIC_FLOW_RESTRICTED_USER");
    }

    const toxicScoreBps = this.toxicFlowScores.get(input.request.user.toLowerCase()) ?? 0;
    if (toxicScoreBps > this.policy.maxToxicScoreBps) {
      return this.reject("TOXIC_FLOW_SCORE_EXCEEDED");
    }
    if (input.request.slippageBps > this.policy.maxSlippageBps) {
      return this.reject("SLIPPAGE_TOO_WIDE");
    }
    if (input.pricing.spreadBps > this.policy.maxQuotedSpreadBps) {
      return this.reject("QUOTED_SPREAD_TOO_WIDE");
    }

    if (input.inventoryProjection) {
      if (abs(input.inventoryProjection.tokenIn.balance) > tokenInLimit.maxAbsoluteInventory) {
        return this.reject("TOKEN_IN_INVENTORY_LIMIT_EXCEEDED");
      }
      if (abs(input.inventoryProjection.tokenOut.balance) > tokenOutLimit.maxAbsoluteInventory) {
        return this.reject("TOKEN_OUT_INVENTORY_LIMIT_EXCEEDED");
      }
    }

    return { status: "approved", policyVersion: this.policy.policyVersion };
  }

  private reject(reasonCode: RiskRejectReasonCode): RiskDecision {
    return { status: "rejected", reasonCode, policyVersion: this.policy.policyVersion };
  }
}

export function parseTokenLimitRiskPolicy(value: string): TokenLimitRiskPolicy {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("RFQ_RISK_POLICY_JSON must be a non-empty JSON object");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("RFQ_RISK_POLICY_JSON must contain valid JSON");
  }
  assertTokenLimitRiskPolicy(parsed);
  return cloneTokenLimitRiskPolicy(parsed);
}

export function assertTokenLimitRiskPolicy(value: unknown): asserts value is TokenLimitRiskPolicy {
  assertRecord(value, "Token limit risk policy");
  assertExactFields(value, policyFields, "Token limit risk policy");
  assertSafeIdentifier(value.policyVersion, "Token limit risk policy.policyVersion");
  const enabledChainIds = assertChainIds(value.enabledChainIds);
  assertTokenLimits(value.tokenLimits, enabledChainIds);
  assertAddressList(value.restrictedUsers, "Token limit risk policy.restrictedUsers");
  assertToxicFlowScores(value.toxicFlowScores);
  assertBps(value.maxToxicScoreBps, "Token limit risk policy.maxToxicScoreBps");
  assertPositiveUint256String(
    value.maxUserOpenNotionalUsd,
    "Token limit risk policy.maxUserOpenNotionalUsd",
  );
  assertPositiveUint256String(
    value.maxPairOpenNotionalUsd,
    "Token limit risk policy.maxPairOpenNotionalUsd",
  );
  assertPositiveUint256String(value.minLiquidityUsd, "Token limit risk policy.minLiquidityUsd");
  assertBps(value.maxVolatilityBps, "Token limit risk policy.maxVolatilityBps");
  assertBps(value.maxSlippageBps, "Token limit risk policy.maxSlippageBps");
  assertBps(value.maxQuotedSpreadBps, "Token limit risk policy.maxQuotedSpreadBps");
}

function assertTokenLimits(value: unknown, enabledChainIds: ReadonlySet<number>): void {
  if (!Array.isArray(value) || value.length === 0 || value.length > maxPolicyEntries) {
    throw new Error(`Token limit risk policy.tokenLimits must contain between 1 and ${maxPolicyEntries} entries`);
  }

  const seen = new Set<string>();
  const coveredChains = new Set<number>();
  for (const entry of value) {
    assertRecord(entry, "Token risk limit");
    assertExactFields(entry, tokenLimitFields, "Token risk limit");
    assertPositiveSafeInteger(entry.chainId, "Token risk limit.chainId");
    if (!enabledChainIds.has(entry.chainId)) {
      throw new Error("Token risk limit.chainId must be present in enabledChainIds");
    }
    assertAddress(entry.tokenAddress, "Token risk limit.tokenAddress");
    assertPositiveUint256String(entry.maxAmountIn, "Token risk limit.maxAmountIn");
    assertPositiveUint256String(entry.minAmountOut, "Token risk limit.minAmountOut");
    assertPositiveUint256String(entry.maxNotionalUsd, "Token risk limit.maxNotionalUsd");
    assertPositiveUint256String(entry.maxAbsoluteInventory, "Token risk limit.maxAbsoluteInventory");
    const key = tokenLimitKey(entry.chainId, entry.tokenAddress);
    if (seen.has(key)) throw new Error("Token limit risk policy must not contain duplicate chain/token limits");
    seen.add(key);
    coveredChains.add(entry.chainId);
  }

  for (const chainId of enabledChainIds) {
    if (!coveredChains.has(chainId)) {
      throw new Error(`Token limit risk policy enabled chain ${chainId} must have at least one token limit`);
    }
  }
}

function assertChainIds(value: unknown): ReadonlySet<number> {
  if (!Array.isArray(value) || value.length === 0 || value.length > maxPolicyEntries) {
    throw new Error(`Token limit risk policy.enabledChainIds must contain between 1 and ${maxPolicyEntries} entries`);
  }
  const chainIds = new Set<number>();
  for (const chainId of value) {
    assertPositiveSafeInteger(chainId, "Token limit risk policy.enabledChainIds entry");
    if (chainIds.has(chainId)) throw new Error("Token limit risk policy.enabledChainIds must not contain duplicates");
    chainIds.add(chainId);
  }
  return chainIds;
}

function assertAddressList(value: unknown, label: string): void {
  if (!Array.isArray(value) || value.length > maxPolicyEntries) {
    throw new Error(`${label} must be an array with at most ${maxPolicyEntries} entries`);
  }
  const seen = new Set<string>();
  for (const address of value) {
    assertAddress(address, `${label} entry`);
    const normalized = address.toLowerCase();
    if (seen.has(normalized)) throw new Error(`${label} must not contain duplicate addresses`);
    seen.add(normalized);
  }
}

function assertToxicFlowScores(value: unknown): void {
  if (!Array.isArray(value) || value.length > maxPolicyEntries) {
    throw new Error(`Token limit risk policy.toxicFlowScores must be an array with at most ${maxPolicyEntries} entries`);
  }
  const seen = new Set<string>();
  for (const score of value) {
    assertRecord(score, "Token limit toxic flow score");
    assertExactFields(score, toxicFlowScoreFields, "Token limit toxic flow score");
    assertAddress(score.user, "Token limit toxic flow score.user");
    assertBps(score.scoreBps, "Token limit toxic flow score.scoreBps");
    const normalized = score.user.toLowerCase();
    if (seen.has(normalized)) throw new Error("Token limit risk policy.toxicFlowScores must not contain duplicate users");
    seen.add(normalized);
  }
}

function cloneTokenLimitRiskPolicy(policy: TokenLimitRiskPolicy): TokenLimitRiskPolicy {
  return {
    ...policy,
    enabledChainIds: [...policy.enabledChainIds],
    tokenLimits: policy.tokenLimits.map((limit) => ({
      ...limit,
      tokenAddress: limit.tokenAddress.toLowerCase() as Address,
    })),
    restrictedUsers: policy.restrictedUsers.map((user) => user.toLowerCase() as Address),
    toxicFlowScores: policy.toxicFlowScores.map((score) => ({
      ...score,
      user: score.user.toLowerCase() as Address,
    })),
  };
}

function tokenLimitKey(chainId: number, tokenAddress: string): string {
  return `${chainId}:${tokenAddress.toLowerCase()}`;
}

function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function min(left: bigint, right: bigint): bigint {
  return left < right ? left : right;
}

function exceedsUsdNotional(amount: string, decimals: number, maxNotionalUsd: bigint): boolean {
  return BigInt(amount) > maxNotionalUsd * (10n ** BigInt(decimals));
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
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maxSafeIdentifierLength ||
    !safeIdentifierPattern.test(value)
  ) {
    throw new Error(`${label} must be a 1-128 character safe identifier`);
  }
}

function assertPositiveSafeInteger(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
}

function assertAddress(value: unknown, label: string): asserts value is Address {
  if (!isAddress(value)) throw new Error(`${label} must be a 20-byte hex address`);
}

function isAddress(value: unknown): value is Address {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
}

function assertPositiveUint256String(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value) || BigInt(value) > maxUint256) {
    throw new Error(`${label} must be a canonical positive uint256 string`);
  }
}

function assertBps(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 10_000) {
    throw new Error(`${label} must be an integer between 0 and 10000`);
  }
}
