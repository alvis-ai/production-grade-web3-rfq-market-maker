export type ReadinessComponentStatus = "ok" | "degraded";

export interface ReadinessResponse {
  status: "ready" | "degraded";
  components: Record<string, ReadinessComponentStatus>;
}

export class ReadinessService {
  check(): ReadinessResponse {
    const components = {
      marketData: "ok",
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

    return {
      status: "ready",
      components,
    };
  }
}
