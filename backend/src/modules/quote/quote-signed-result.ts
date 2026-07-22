import type { QuoteResponse, SignedQuote } from "../../shared/types/rfq.js";
import type { PricingResult } from "../pricing/pricing.engine.js";
import type { SaveSignedQuoteInput } from "./quote.repository.js";

interface BuildSignedQuoteResultInput {
  quoteId: string;
  principalId: string;
  snapshotId: string;
  slippageBps: number;
  quote: SignedQuote;
  pricing: PricingResult;
  riskPolicyVersion: string;
  signature: `0x${string}`;
}

export interface SignedQuoteResult {
  response: QuoteResponse;
  signedQuoteInput: SaveSignedQuoteInput;
}

export function buildSignedQuoteResult(input: BuildSignedQuoteResultInput): SignedQuoteResult {
  const response: QuoteResponse = {
    quoteId: input.quoteId,
    snapshotId: input.snapshotId,
    amountOut: input.pricing.amountOut,
    minAmountOut: input.pricing.minAmountOut,
    deadline: input.quote.deadline,
    nonce: input.quote.nonce,
    signature: input.signature,
  };
  return {
    response,
    signedQuoteInput: {
      quoteId: input.quoteId,
      principalId: input.principalId,
      snapshotId: input.snapshotId,
      slippageBps: input.slippageBps,
      quote: input.quote,
      pricingVersion: input.pricing.pricingVersion,
      spreadBps: input.pricing.spreadBps,
      sizeImpactBps: input.pricing.sizeImpactBps,
      marketSpreadBps: input.pricing.marketSpreadBps,
      inventorySkewBps: input.pricing.inventorySkewBps,
      volatilityPremiumBps: input.pricing.volatilityPremiumBps,
      hedgeCostBps: input.pricing.hedgeCostBps,
      riskPolicyVersion: input.riskPolicyVersion,
      signature: input.signature,
    },
  };
}
