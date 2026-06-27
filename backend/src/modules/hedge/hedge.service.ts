import type { Address, HedgeIntentStatusResponse, UIntString } from "../../shared/types/rfq.js";

export interface HedgeIntent {
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

export class HedgeService {
  private readonly intents = new Map<string, HedgeIntentStatusResponse>();
  private sequence = 0;

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
}
