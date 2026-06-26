import type { MarketSnapshot, QuoteRequest } from "../../shared/types/rfq.js";

export interface RouteInput {
  request: QuoteRequest;
  snapshot: MarketSnapshot;
}

export interface RoutePlan {
  routeId: string;
  venue: "internal_inventory";
  tokenIn: QuoteRequest["tokenIn"];
  tokenOut: QuoteRequest["tokenOut"];
  expectedLiquidityUsd: string;
}

export interface RoutingEngine {
  selectRoute(input: RouteInput): Promise<RoutePlan>;
}

export class InternalInventoryRoutingEngine implements RoutingEngine {
  async selectRoute(input: RouteInput): Promise<RoutePlan> {
    return {
      routeId: [
        "route",
        input.request.chainId.toString(),
        input.request.tokenIn.slice(2, 10).toLowerCase(),
        input.request.tokenOut.slice(2, 10).toLowerCase(),
      ].join("_"),
      venue: "internal_inventory",
      tokenIn: input.request.tokenIn,
      tokenOut: input.request.tokenOut,
      expectedLiquidityUsd: input.snapshot.liquidityUsd,
    };
  }
}
