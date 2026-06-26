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

export class AllowAllRiskEngine implements RiskEngine {
  async evaluate(): Promise<RiskDecision> {
    return {
      status: "approved",
      policyVersion: "allow-all-skeleton-v0",
    };
  }
}
