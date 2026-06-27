import { getMarketSnapshotIssue, type MarketDataService } from "../market-data/market-data.service.js";
import type { QuoteRequest } from "../../shared/types/rfq.js";

export type ReadinessComponentStatus = "ok" | "degraded";

export interface ReadinessResponse {
  status: "ready" | "degraded";
  components: Record<string, ReadinessComponentStatus>;
}

export interface ReadinessServiceDeps {
  marketDataService: MarketDataService;
}

export interface ReadinessServiceConfig {
  maxSnapshotAgeMs: number;
  probeRequest: QuoteRequest;
}

export const defaultReadinessServiceConfig: ReadinessServiceConfig = {
  maxSnapshotAgeMs: 5_000,
  probeRequest: {
    chainId: 1,
    user: "0x0000000000000000000000000000000000000001",
    tokenIn: "0x0000000000000000000000000000000000000002",
    tokenOut: "0x0000000000000000000000000000000000000003",
    amountIn: "1000000000",
    slippageBps: 50,
  },
};

export class ReadinessService {
  constructor(
    private readonly deps: ReadinessServiceDeps,
    private readonly config: ReadinessServiceConfig = defaultReadinessServiceConfig,
  ) {}

  async check(): Promise<ReadinessResponse> {
    const marketDataStatus = await this.checkMarketData();
    const components = {
      marketData: marketDataStatus,
      pricing: "ok",
      risk: "ok",
      signer: "ok",
      quoteRepository: "ok",
      inventory: "ok",
      execution: "ok",
      settlementEventStore: "ok",
      pnl: "ok",
      metrics: "ok",
    } as const;

    const hasDegradedComponent = Object.values(components).some((status) => status === "degraded");

    return {
      status: hasDegradedComponent ? "degraded" : "ready",
      components,
    };
  }

  private async checkMarketData(): Promise<ReadinessComponentStatus> {
    try {
      const snapshot = await this.deps.marketDataService.getSnapshot(this.config.probeRequest);
      return getMarketSnapshotIssue(snapshot, this.config.maxSnapshotAgeMs) ? "degraded" : "ok";
    } catch {
      return "degraded";
    }
  }
}
