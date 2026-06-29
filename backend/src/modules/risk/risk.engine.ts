import type { QuoteRequest } from "../../shared/types/rfq.js";
import type { InventoryProjection } from "../inventory/inventory.service.js";
import type { PricingResult } from "../pricing/pricing.engine.js";

export type RiskDecisionStatus = "approved" | "rejected";

export interface RiskDecision {
  status: RiskDecisionStatus;
  reasonCode?: string;
  policyVersion: string;
}

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
  private readonly allowedTokens: ReadonlySet<string>;
  private readonly enabledChainIds: ReadonlySet<number>;
  private readonly restrictedUsers: ReadonlySet<string>;
  private readonly toxicFlowScores: ReadonlyMap<string, number>;

  constructor(private readonly policy: BasicRiskPolicy = defaultBasicRiskPolicy) {
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

    this.allowedTokens = new Set(policy.tokenAllowlist.map((token) => token.toLowerCase()));
    this.enabledChainIds = new Set(policy.enabledChainIds);
    this.restrictedUsers = new Set(policy.restrictedUsers.map((user) => user.toLowerCase()));
    this.toxicFlowScores = new Map(policy.toxicFlowScores.map((score) => [score.user.toLowerCase(), score.scoreBps]));
  }

  async evaluate(input: RiskInput): Promise<RiskDecision> {
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

  private reject(reasonCode: string): RiskDecision {
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

function assertNonEmptyString(value: string, field: keyof BasicRiskPolicy): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Basic risk ${field} must be a non-empty string`);
  }
}

function assertChainIds(chainIds: readonly number[]): void {
  if (chainIds.length === 0) {
    throw new Error("Basic risk enabledChainIds must contain at least one chain id");
  }

  for (const chainId of chainIds) {
    if (!Number.isSafeInteger(chainId) || chainId <= 0) {
      throw new Error("Basic risk enabledChainIds entries must be positive safe integers");
    }
  }
}

function assertAddressList(
  addresses: readonly `0x${string}`[],
  field: "tokenAllowlist" | "restrictedUsers",
  requireNonEmpty: boolean,
): void {
  if (requireNonEmpty && addresses.length === 0) {
    throw new Error(`Basic risk ${field} must contain at least one address`);
  }

  for (const address of addresses) {
    assertAddress(address, field);
  }
}

function assertToxicFlowScores(scores: readonly ToxicFlowScore[]): void {
  for (const score of scores) {
    assertAddress(score.user, "toxicFlowScores.user");
    assertBpsUpperBound(score.scoreBps, "toxicFlowScores.scoreBps");
  }
}

function assertAddress(value: `0x${string}`, field: string): void {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`Basic risk ${field} entries must be 20-byte hex addresses`);
  }
}

function assertPositiveBigInt(value: bigint, field: keyof BasicRiskPolicy): void {
  if (typeof value !== "bigint" || value <= 0n) {
    throw new Error(`Basic risk ${field} must be a positive bigint`);
  }
}

function assertBpsUpperBound(value: number, field: keyof BasicRiskPolicy | "toxicFlowScores.scoreBps"): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Basic risk ${field} must be a non-negative safe integer`);
  }

  if (value > 10_000) {
    throw new Error(`Basic risk ${field} must be less than or equal to 10000 bps`);
  }
}
