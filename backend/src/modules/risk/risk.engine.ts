import type { QuoteRequest } from "../../shared/types/rfq.js";
import type { InventoryProjection } from "../inventory/inventory.service.js";
import type { PricingResult } from "../pricing/pricing.engine.js";

const basicRiskPolicyFields = [
  "policyVersion",
  "enabledChainIds",
  "tokenAllowlist",
  "restrictedUsers",
  "toxicFlowScores",
  "maxToxicScoreBps",
  "maxAmountIn",
  "minAmountOut",
  "maxSlippageBps",
  "maxQuotedSpreadBps",
  "maxAbsoluteInventory",
] as const;
const toxicFlowScoreFields = ["user", "scoreBps"] as const;
const riskInputFields = ["request", "pricing"] as const;
const riskInputOptionalFields = ["inventoryProjection"] as const;
const quoteRequestFields = ["chainId", "user", "tokenIn", "tokenOut", "amountIn", "slippageBps"] as const;
const pricingResultFields = [
  "amountOut",
  "minAmountOut",
  "spreadBps",
  "sizeImpactBps",
  "inventorySkewBps",
  "pricingVersion",
] as const;
const inventoryProjectionFields = ["tokenIn", "tokenOut"] as const;
const inventoryPositionFields = ["chainId", "token", "balance"] as const;

export type RiskDecisionStatus = "approved" | "rejected";
export type RiskRejectReasonCode =
  | "CHAIN_NOT_ENABLED"
  | "TOKEN_NOT_ALLOWED"
  | "AMOUNT_IN_LIMIT_EXCEEDED"
  | "AMOUNT_OUT_TOO_SMALL"
  | "SLIPPAGE_TOO_WIDE"
  | "QUOTED_SPREAD_TOO_WIDE"
  | "TOXIC_FLOW_RESTRICTED_USER"
  | "TOXIC_FLOW_SCORE_EXCEEDED"
  | "TOKEN_IN_INVENTORY_LIMIT_EXCEEDED"
  | "TOKEN_OUT_INVENTORY_LIMIT_EXCEEDED"
  | "RISK_ENGINE_UNAVAILABLE";

export type RiskDecision =
  | {
      status: "approved";
      policyVersion: string;
    }
  | {
      status: "rejected";
      reasonCode: RiskRejectReasonCode;
      policyVersion: string;
    };

export interface RiskInput {
  request: QuoteRequest;
  pricing: PricingResult;
  inventoryProjection?: InventoryProjection;
}

export interface RiskEngine {
  evaluate(input: RiskInput): Promise<RiskDecision>;
}

export interface BasicRiskPolicy {
  policyVersion: string;
  enabledChainIds: readonly number[];
  tokenAllowlist: readonly `0x${string}`[];
  restrictedUsers: readonly `0x${string}`[];
  toxicFlowScores: readonly ToxicFlowScore[];
  maxToxicScoreBps: number;
  maxAmountIn: bigint;
  minAmountOut: bigint;
  maxSlippageBps: number;
  maxQuotedSpreadBps: number;
  maxAbsoluteInventory: bigint;
}

export interface ToxicFlowScore {
  user: `0x${string}`;
  scoreBps: number;
}

export const defaultBasicRiskPolicy: BasicRiskPolicy = {
  policyVersion: "basic-risk-v1",
  enabledChainIds: [1, 8453, 42161],
  tokenAllowlist: [
    "0x0000000000000000000000000000000000000002",
    "0x0000000000000000000000000000000000000003",
  ],
  restrictedUsers: [],
  toxicFlowScores: [],
  maxToxicScoreBps: 8_000,
  maxAmountIn: 10_000_000_000_000_000_000_000n,
  minAmountOut: 1n,
  maxSlippageBps: 500,
  maxQuotedSpreadBps: 1_000,
  maxAbsoluteInventory: 2_000_000_000n,
};

export class BasicRiskEngine implements RiskEngine {
  private readonly policy: BasicRiskPolicy;
  private readonly allowedTokens: ReadonlySet<string>;
  private readonly enabledChainIds: ReadonlySet<number>;
  private readonly restrictedUsers: ReadonlySet<string>;
  private readonly toxicFlowScores: ReadonlyMap<string, number>;

  constructor(policy: BasicRiskPolicy = defaultBasicRiskPolicy) {
    assertObject(policy, "policy");
    assertOwnFields(policy, basicRiskPolicyFields, "policy");
    assertNonEmptyString(policy.policyVersion, "policyVersion");
    assertChainIds(policy.enabledChainIds);
    assertAddressList(policy.tokenAllowlist, "tokenAllowlist", true);
    assertAddressList(policy.restrictedUsers, "restrictedUsers", false);
    assertToxicFlowScores(policy.toxicFlowScores);
    assertBpsUpperBound(policy.maxToxicScoreBps, "maxToxicScoreBps");
    assertPositiveBigInt(policy.maxAmountIn, "maxAmountIn");
    assertPositiveBigInt(policy.minAmountOut, "minAmountOut");
    assertBpsUpperBound(policy.maxSlippageBps, "maxSlippageBps");
    assertBpsUpperBound(policy.maxQuotedSpreadBps, "maxQuotedSpreadBps");
    assertPositiveBigInt(policy.maxAbsoluteInventory, "maxAbsoluteInventory");

    this.policy = cloneBasicRiskPolicy(policy);
    this.allowedTokens = new Set(this.policy.tokenAllowlist.map((token) => token.toLowerCase()));
    this.enabledChainIds = new Set(this.policy.enabledChainIds);
    this.restrictedUsers = new Set(this.policy.restrictedUsers.map((user) => user.toLowerCase()));
    this.toxicFlowScores = new Map(this.policy.toxicFlowScores.map((score) => [score.user.toLowerCase(), score.scoreBps]));
  }

  async evaluate(input: RiskInput): Promise<RiskDecision> {
    assertRiskInput(input);
    if (!this.enabledChainIds.has(input.request.chainId)) {
      return this.reject("CHAIN_NOT_ENABLED");
    }

    if (!this.isAllowedToken(input.request.tokenIn) || !this.isAllowedToken(input.request.tokenOut)) {
      return this.reject("TOKEN_NOT_ALLOWED");
    }

    if (BigInt(input.request.amountIn) > this.policy.maxAmountIn) {
      return this.reject("AMOUNT_IN_LIMIT_EXCEEDED");
    }

    if (BigInt(input.pricing.amountOut) < this.policy.minAmountOut) {
      return this.reject("AMOUNT_OUT_TOO_SMALL");
    }

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
      if (abs(input.inventoryProjection.tokenIn.balance) > this.policy.maxAbsoluteInventory) {
        return this.reject("TOKEN_IN_INVENTORY_LIMIT_EXCEEDED");
      }

      if (abs(input.inventoryProjection.tokenOut.balance) > this.policy.maxAbsoluteInventory) {
        return this.reject("TOKEN_OUT_INVENTORY_LIMIT_EXCEEDED");
      }
    }

    return {
      status: "approved",
      policyVersion: this.policy.policyVersion,
    };
  }

  private isAllowedToken(token: `0x${string}`): boolean {
    return this.allowedTokens.has(token.toLowerCase());
  }

  private reject(reasonCode: RiskRejectReasonCode): RiskDecision {
    return {
      status: "rejected",
      reasonCode,
      policyVersion: this.policy.policyVersion,
    };
  }
}

function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function cloneBasicRiskPolicy(policy: BasicRiskPolicy): BasicRiskPolicy {
  return {
    ...policy,
    enabledChainIds: [...policy.enabledChainIds],
    tokenAllowlist: [...policy.tokenAllowlist],
    restrictedUsers: [...policy.restrictedUsers],
    toxicFlowScores: policy.toxicFlowScores.map((score) => ({ ...score })),
  };
}

function assertNonEmptyString(value: string, field: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Basic risk ${field} must be a non-empty string`);
  }
}

function assertChainIds(chainIds: readonly number[]): void {
  assertArray(chainIds, "enabledChainIds");
  if (chainIds.length === 0) {
    throw new Error("Basic risk enabledChainIds must contain at least one chain id");
  }

  const seenChainIds = new Set<number>();
  for (const chainId of chainIds) {
    if (!Number.isSafeInteger(chainId) || chainId <= 0) {
      throw new Error("Basic risk enabledChainIds entries must be positive safe integers");
    }
    if (seenChainIds.has(chainId)) {
      throw new Error("Basic risk enabledChainIds must not contain duplicate chain ids");
    }
    seenChainIds.add(chainId);
  }
}

function assertAddressList(
  addresses: readonly `0x${string}`[],
  field: "tokenAllowlist" | "restrictedUsers",
  requireNonEmpty: boolean,
): void {
  assertArray(addresses, field);
  if (requireNonEmpty && addresses.length === 0) {
    throw new Error(`Basic risk ${field} must contain at least one address`);
  }

  const seenAddresses = new Set<string>();
  for (const address of addresses) {
    assertAddress(address, field);
    const normalized = address.toLowerCase();
    if (seenAddresses.has(normalized)) {
      throw new Error(`Basic risk ${field} must not contain duplicate addresses`);
    }
    seenAddresses.add(normalized);
  }
}

function assertToxicFlowScores(scores: readonly ToxicFlowScore[]): void {
  assertArray(scores, "toxicFlowScores");
  const seenUsers = new Set<string>();
  for (const score of scores) {
    assertObject(score, "toxicFlowScores entry");
    assertOwnFields(score, toxicFlowScoreFields, "toxicFlowScores entry");
    assertAddress(score.user, "toxicFlowScores.user");
    assertBpsUpperBound(score.scoreBps, "toxicFlowScores.scoreBps");
    const normalizedUser = score.user.toLowerCase();
    if (seenUsers.has(normalizedUser)) {
      throw new Error("Basic risk toxicFlowScores must not contain duplicate users");
    }
    seenUsers.add(normalizedUser);
  }
}

function assertAddress(value: string, field: string): void {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`Basic risk ${field} entries must be 20-byte hex addresses`);
  }
}

function assertRiskInput(input: RiskInput): void {
  assertObject(input, "input");
  assertOwnFields(input, riskInputFields, "input");
  assertOwnOptionalFields(input, riskInputOptionalFields, "input");
  assertObject(input.request, "request");
  assertOwnFields(input.request, quoteRequestFields, "request");
  assertObject(input.pricing, "pricing");
  assertOwnFields(input.pricing, pricingResultFields, "pricing");
  assertPositiveSafeInteger(input.request.chainId, "request.chainId");
  assertAddress(input.request.user, "request.user");
  assertAddress(input.request.tokenIn, "request.tokenIn");
  assertAddress(input.request.tokenOut, "request.tokenOut");
  if (input.request.tokenIn.toLowerCase() === input.request.tokenOut.toLowerCase()) {
    throw new Error("Basic risk request token pair must contain distinct tokens");
  }
  assertPositiveUIntString(input.request.amountIn, "request.amountIn");
  assertBpsUpperBound(input.request.slippageBps, "request.slippageBps");

  assertPositiveUIntString(input.pricing.amountOut, "pricing.amountOut");
  assertPositiveUIntString(input.pricing.minAmountOut, "pricing.minAmountOut");
  if (BigInt(input.pricing.amountOut) < BigInt(input.pricing.minAmountOut)) {
    throw new Error("Basic risk pricing.amountOut must be greater than or equal to pricing.minAmountOut");
  }
  assertBpsUpperBound(input.pricing.spreadBps, "pricing.spreadBps");
  assertBpsUpperBound(input.pricing.sizeImpactBps, "pricing.sizeImpactBps");
  assertBpsMagnitude(input.pricing.inventorySkewBps, "pricing.inventorySkewBps");
  assertNonEmptyString(input.pricing.pricingVersion, "pricing.pricingVersion");

  if (input.inventoryProjection !== undefined) {
    assertObject(input.inventoryProjection, "inventoryProjection");
    assertOwnFields(input.inventoryProjection, inventoryProjectionFields, "inventoryProjection");
    assertInventoryPosition(input.inventoryProjection.tokenIn, input.request.chainId, input.request.tokenIn, "tokenIn");
    assertInventoryPosition(input.inventoryProjection.tokenOut, input.request.chainId, input.request.tokenOut, "tokenOut");
  }
}

function assertInventoryPosition(
  position: InventoryProjection["tokenIn"],
  expectedChainId: number,
  expectedToken: `0x${string}`,
  field: "tokenIn" | "tokenOut",
): void {
  assertObject(position, `inventoryProjection.${field}`);
  assertOwnFields(position, inventoryPositionFields, `inventoryProjection.${field}`);
  assertPositiveSafeInteger(position.chainId, `inventoryProjection.${field}.chainId`);
  assertAddress(position.token, `inventoryProjection.${field}.token`);
  if (position.chainId !== expectedChainId || position.token.toLowerCase() !== expectedToken.toLowerCase()) {
    throw new Error(`Basic risk inventoryProjection.${field} must match request ${field}`);
  }
  if (typeof position.balance !== "bigint") {
    throw new Error(`Basic risk inventoryProjection.${field}.balance must be a bigint`);
  }
}

function assertObject(value: unknown, field: string): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Basic risk ${field} must be an object`);
  }
}

function assertOwnFields(value: object, fields: readonly string[], path: string): void {
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      throw new Error(`Basic risk ${path}.${field} must be an own field`);
    }
  }
}

function assertOwnOptionalFields(value: object, fields: readonly string[], path: string): void {
  for (const field of fields) {
    if (field in value && !Object.prototype.hasOwnProperty.call(value, field)) {
      throw new Error(`Basic risk ${path}.${field} must be an own field when provided`);
    }
  }
}

function assertArray(value: unknown, field: string): void {
  if (!Array.isArray(value)) {
    throw new Error(`Basic risk ${field} must be an array`);
  }
}

function assertPositiveSafeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Basic risk ${field} must be a positive safe integer`);
  }
}

function assertPositiveUIntString(value: string, field: string): void {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`Basic risk ${field} must be a positive uint string`);
  }
}

function assertBpsMagnitude(value: number, field: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`Basic risk ${field} must be a safe integer`);
  }
  if (Math.abs(value) > 10_000) {
    throw new Error(`Basic risk ${field} magnitude must be less than or equal to 10000 bps`);
  }
}

function assertPositiveBigInt(value: bigint, field: keyof BasicRiskPolicy): void {
  if (typeof value !== "bigint" || value <= 0n) {
    throw new Error(`Basic risk ${field} must be a positive bigint`);
  }
}

function assertBpsUpperBound(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Basic risk ${field} must be a non-negative safe integer`);
  }

  if (value > 10_000) {
    throw new Error(`Basic risk ${field} must be less than or equal to 10000 bps`);
  }
}
