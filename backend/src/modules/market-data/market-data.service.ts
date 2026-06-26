import type { MarketSnapshot, QuoteRequest } from "../../shared/types/rfq.js";

export interface MarketDataService {
  getSnapshot(request: QuoteRequest): Promise<MarketSnapshot>;
}

export class StaticMarketDataService implements MarketDataService {
  async getSnapshot(request: QuoteRequest): Promise<MarketSnapshot> {
    return {
      snapshotId: [
        "snapshot",
        request.chainId.toString(),
        request.tokenIn.slice(2, 10).toLowerCase(),
        request.tokenOut.slice(2, 10).toLowerCase(),
      ].join("_"),
      midPrice: "1",
      liquidityUsd: "1000000",
      volatilityBps: 25,
      observedAt: new Date().toISOString(),
    };
  }
}
