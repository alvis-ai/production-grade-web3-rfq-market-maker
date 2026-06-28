import type { SettlementEventStatusResponse, SignedQuote } from "../../shared/types/rfq.js";
import type { InventoryService, SettlementDelta } from "../inventory/inventory.service.js";

export interface ApplySettlementEventInput {
  quoteId: string;
  txHash: `0x${string}`;
  logIndex?: number;
  quote: SignedQuote;
}

export interface ApplySettlementEventResult {
  event: SettlementEventStatusResponse;
  duplicate: boolean;
}

export interface SettlementEventStore {
  applySettlementEvent(input: ApplySettlementEventInput): ApplySettlementEventResult;
  getSettlementEvent(settlementEventId: string): SettlementEventStatusResponse | undefined;
}

export class SettlementEventService implements SettlementEventStore {
  private readonly events = new Map<string, SettlementEventStatusResponse>();
  private readonly eventIdsByKey = new Map<string, string>();

  constructor(private readonly inventoryService: InventoryService) {}

  applySettlementEvent(input: ApplySettlementEventInput): ApplySettlementEventResult {
    const logIndex = input.logIndex ?? 0;
    const key = this.eventKey(input.quote.chainId, input.txHash, logIndex);
    const existingEventId = this.eventIdsByKey.get(key);
    if (existingEventId) {
      const event = this.events.get(existingEventId);
      if (!event) {
        throw new Error(`Settlement event index is inconsistent for ${existingEventId}`);
      }

      return {
        event,
        duplicate: true,
      };
    }

    const event: SettlementEventStatusResponse = {
      settlementEventId: `se_${input.quote.chainId}_${input.txHash.slice(2, 10).toLowerCase()}_${logIndex}`,
      status: "applied",
      quoteId: input.quoteId,
      chainId: input.quote.chainId,
      txHash: input.txHash,
      logIndex,
      user: input.quote.user,
      tokenIn: input.quote.tokenIn,
      tokenOut: input.quote.tokenOut,
      amountIn: input.quote.amountIn,
      amountOut: input.quote.amountOut,
      observedAt: new Date().toISOString(),
    };

    this.inventoryService.applySettlement(this.toSettlementDelta(event));
    this.events.set(event.settlementEventId, event);
    this.eventIdsByKey.set(key, event.settlementEventId);

    return {
      event,
      duplicate: false,
    };
  }

  getSettlementEvent(settlementEventId: string): SettlementEventStatusResponse | undefined {
    return this.events.get(settlementEventId);
  }

  private toSettlementDelta(event: SettlementEventStatusResponse): SettlementDelta {
    return {
      chainId: event.chainId,
      tokenIn: event.tokenIn,
      tokenOut: event.tokenOut,
      amountIn: event.amountIn,
      amountOut: event.amountOut,
    };
  }

  private eventKey(chainId: number, txHash: `0x${string}`, logIndex: number): string {
    return `${chainId}:${txHash.toLowerCase()}:${logIndex}`;
  }
}
