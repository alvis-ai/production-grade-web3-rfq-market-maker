import type { QuoteRequest } from "../../shared/types/rfq.js";
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
}

export interface RiskEngine {
  evaluate(input: RiskInput): Promise<RiskDecision>;
}

export interface BasicRiskPolicy {
  policyVersion: string;
  enabledChainIds: readonly number[];
  tokenAllowlist: readonly `0x${string}`[];
  maxAmountIn: bigint;
  minAmountOut: bigint;
  maxSlippageBps: number;
}

export const defaultBasicRiskPolicy: BasicRiskPolicy = {
  policyVersion: "basic-risk-v1",
  enabledChainIds: [1, 8453, 42161],
  tokenAllowlist: [
    "0x0000000000000000000000000000000000000002",
    "0x0000000000000000000000000000000000000003",
  ],
  maxAmountIn: 10_000_000_000_000_000_000_000n,
  minAmountOut: 1n,
  maxSlippageBps: 500,
};

export class BasicRiskEngine implements RiskEngine {
  private readonly allowedTokens: ReadonlySet<string>;
  private readonly enabledChainIds: ReadonlySet<number>;

  constructor(private readonly policy: BasicRiskPolicy = defaultBasicRiskPolicy) {
    this.allowedTokens = new Set(policy.tokenAllowlist.map((token) => token.toLowerCase()));
    this.enabledChainIds = new Set(policy.enabledChainIds);
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

    if (input.request.slippageBps > this.policy.maxSlippageBps) {
      return this.reject("SLIPPAGE_TOO_WIDE");
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

export class AllowAllRiskEngine implements RiskEngine {
  async evaluate(): Promise<RiskDecision> {
    return {
      status: "approved",
      policyVersion: "allow-all-skeleton-v0",
    };
  }
}
