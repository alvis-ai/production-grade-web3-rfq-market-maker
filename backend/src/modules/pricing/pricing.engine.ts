import type { MarketSnapshot, QuoteRequest, UIntString } from "../../shared/types/rfq.js";
import type { RoutePlan } from "../routing/routing.engine.js";

export interface PricingInput {
  request: QuoteRequest;
  snapshot: MarketSnapshot;
  routePlan: RoutePlan;
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
    const amountOut = BigInt(input.request.amountIn);
    const minAmountOut = (amountOut * BigInt(10000 - input.request.slippageBps)) / 10000n;

    return {
      amountOut: amountOut.toString() as UIntString,
      minAmountOut: minAmountOut.toString() as UIntString,
      spreadBps: 0,
      sizeImpactBps: 0,
      inventorySkewBps: input.inventorySkewBps,
      pricingVersion: `static-skeleton-v0:${input.routePlan.venue}`,
    };
  }
}
