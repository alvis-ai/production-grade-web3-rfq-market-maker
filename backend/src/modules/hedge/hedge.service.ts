import type { Address, HedgeIntentStatusResponse, UIntString } from "../../shared/types/rfq.js";

export type HedgeFailureReasonCode = "HEDGE_INTENT_FAILED";

export interface HedgeIntent {
  settlementEventId: string;
  quoteId: string;
  chainId: number;
  token: Address;
  side: "buy" | "sell";
  amount: UIntString;
  reason: "inventory_rebalance" | "risk_reduction";
}

export interface HedgeResult {
  status: "queued";
  hedgeOrderId: string;
  record: HedgeIntentStatusResponse;
}

export interface HedgeRiskInput {
  chainId: number;
  token: Address;
}

export interface HedgeIntentService {
  checkHealth?(): void;
  createHedgeIntent(intent: HedgeIntent): HedgeResult;
  getHedgeIntent(hedgeOrderId: string): HedgeIntentStatusResponse | undefined;
  recordHedgeFailure?(intent: HedgeIntent, reasonCode: HedgeFailureReasonCode): void;
  quoteRiskPenaltyBps?(input: HedgeRiskInput): number;
}

export interface HedgeServiceConfig {
  failurePenaltyBps: number;
  maxFailurePenaltyBps: number;
}

export const defaultHedgeServiceConfig: HedgeServiceConfig = {
  failurePenaltyBps: 25,
  maxFailurePenaltyBps: 150,
};

export class HedgeService implements HedgeIntentService {
  private readonly intents = new Map<string, HedgeIntentStatusResponse>();
  private readonly failurePressure = new Map<string, number>();
  private sequence = 0;

  constructor(private readonly config: HedgeServiceConfig = defaultHedgeServiceConfig) {}

  checkHealth(): void {
    this.getHedgeIntent("__readiness_probe__");
  }

  createHedgeIntent(intent: HedgeIntent): HedgeResult {
    this.sequence += 1;
    const hedgeOrderId = [
      "h",
      intent.chainId.toString(),
      intent.token.slice(2, 10).toLowerCase(),
      this.sequence.toString().padStart(6, "0"),
    ].join("_");
    const record: HedgeIntentStatusResponse = {
      hedgeOrderId,
      status: "queued",
      settlementEventId: intent.settlementEventId,
      quoteId: intent.quoteId,
      chainId: intent.chainId,
      token: intent.token,
      side: intent.side,
      amount: intent.amount,
      reason: intent.reason,
      createdAt: new Date().toISOString(),
    };
    this.intents.set(hedgeOrderId, record);

    return {
      status: "queued",
      hedgeOrderId,
      record,
    };
  }

  getHedgeIntent(hedgeOrderId: string): HedgeIntentStatusResponse | undefined {
    return this.intents.get(hedgeOrderId);
  }

  recordHedgeFailure(intent: HedgeIntent, _reasonCode: HedgeFailureReasonCode): void {
    const key = this.key(intent.chainId, intent.token);
    const current = this.failurePressure.get(key) ?? 0;
    this.failurePressure.set(key, Math.min(current + this.config.failurePenaltyBps, this.config.maxFailurePenaltyBps));
  }

  quoteRiskPenaltyBps(input: HedgeRiskInput): number {
    return this.failurePressure.get(this.key(input.chainId, input.token)) ?? 0;
  }

  private key(chainId: number, token: Address): string {
    return `${chainId}:${token.toLowerCase()}`;
  }
}
