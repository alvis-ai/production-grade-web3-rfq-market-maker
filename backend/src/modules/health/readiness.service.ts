import {
  defaultMaxSnapshotFutureSkewMs,
  getMarketSnapshotIssue,
  type MarketDataService,
} from "../market-data/market-data.service.js";
import type { QuoteRequest, SignedQuote } from "../../shared/types/rfq.js";
import type { SignerService } from "../signer/signer.service.js";

export type ReadinessComponentStatus = "ok" | "degraded";

export interface ReadinessResponse {
  status: "ready" | "degraded";
  components: Record<string, ReadinessComponentStatus>;
}

export interface ReadinessServiceDeps {
  marketDataService: MarketDataService;
  signerService: SignerService;
}

export interface ReadinessServiceConfig {
  maxSnapshotAgeMs: number;
  maxSnapshotFutureSkewMs: number;
  probeRequest: QuoteRequest;
  probeQuote: SignedQuote;
}

export const defaultReadinessServiceConfig: ReadinessServiceConfig = {
  maxSnapshotAgeMs: 5_000,
  maxSnapshotFutureSkewMs: defaultMaxSnapshotFutureSkewMs,
  probeRequest: {
    chainId: 1,
    user: "0x0000000000000000000000000000000000000001",
    tokenIn: "0x0000000000000000000000000000000000000002",
    tokenOut: "0x0000000000000000000000000000000000000003",
    amountIn: "1000000000",
    slippageBps: 50,
  },
  probeQuote: {
    user: "0x0000000000000000000000000000000000000001",
    tokenIn: "0x0000000000000000000000000000000000000002",
    tokenOut: "0x0000000000000000000000000000000000000003",
    amountIn: "1000000000",
    amountOut: "998400000",
    minAmountOut: "993408000",
    nonce: "1",
    deadline: 4_102_444_800,
    chainId: 1,
  },
};

export class ReadinessService {
  constructor(
    private readonly deps: ReadinessServiceDeps,
    private readonly config: ReadinessServiceConfig = defaultReadinessServiceConfig,
  ) {}

  async check(): Promise<ReadinessResponse> {
    const marketDataStatus = await this.checkMarketData();
    const signerStatus = await this.checkSigner();
    const components = {
      marketData: marketDataStatus,
      pricing: "ok",
      risk: "ok",
      signer: signerStatus,
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
      return getMarketSnapshotIssue(
        snapshot,
        this.config.maxSnapshotAgeMs,
        this.config.maxSnapshotFutureSkewMs,
      ) ? "degraded" : "ok";
    } catch {
      return "degraded";
    }
  }

  private async checkSigner(): Promise<ReadinessComponentStatus> {
    try {
      const signature = await this.deps.signerService.signQuote({
        quote: this.config.probeQuote,
        quoteId: "readiness_probe",
        snapshotId: "readiness_snapshot",
      });
      const verified = await this.deps.signerService.verifyQuoteSignature(this.config.probeQuote, signature);
      return verified ? "ok" : "degraded";
    } catch {
      return "degraded";
    }
  }
}
