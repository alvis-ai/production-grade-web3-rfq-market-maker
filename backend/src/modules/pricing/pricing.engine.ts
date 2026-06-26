import type { MarketSnapshot, QuoteRequest, UIntString } from "../../shared/types/rfq.js";

export interface PricingInput {
  request: QuoteRequest;
  snapshot: MarketSnapshot;
  inventorySkewBps: number;
}

export interface PricingResult {
  amountOut: UIntString;
  minAmountOut: UIntString;
  spreadBps: number;
  sizeImpactBps: number;
  inventorySkewBps: number;
  pricingVersion: string;
}

export interface PricingEngine {
  price(input: PricingInput): Promise<PricingResult>;
}

export class StaticPricingEngine implements PricingEngine {
  async price(input: PricingInput): Promise<PricingResult> {
    return {
      amountOut: input.request.amountIn,
      minAmountOut: input.request.amountIn,
      spreadBps: 0,
      sizeImpactBps: 0,
      inventorySkewBps: input.inventorySkewBps,
      pricingVersion: "static-skeleton-v0",
    };
  }
}
