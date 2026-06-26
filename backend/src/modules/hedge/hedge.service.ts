import type { Address, UIntString } from "../../shared/types/rfq.js";

export interface HedgeIntent {
  chainId: number;
  token: Address;
  side: "buy" | "sell";
  amount: UIntString;
  reason: "inventory_rebalance" | "risk_reduction";
}

export interface HedgeResult {
  status: "queued";
  hedgeOrderId: string;
}

export class HedgeService {
  createHedgeIntent(intent: HedgeIntent): HedgeResult {
    const hedgeOrderId = `h_${intent.chainId}_${intent.token.slice(2, 10)}_${Date.now().toString()}`;

    return {
      status: "queued",
      hedgeOrderId,
    };
  }
}
