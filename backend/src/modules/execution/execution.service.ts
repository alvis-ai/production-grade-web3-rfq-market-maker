import type { SubmitQuoteRequest, SubmitQuoteResponse } from "../../shared/types/rfq.js";
import { toFixedHex } from "../../shared/types/hex.js";
import type { HedgeResult } from "../hedge/hedge.service.js";
import type { HedgeService } from "../hedge/hedge.service.js";
import type { InventoryPosition, InventoryService } from "../inventory/inventory.service.js";
import type { ApplySettlementEventResult, SettlementEventService } from "../settlement/settlement-event.service.js";
import type { SettlementVerificationResult, SettlementVerifier } from "../settlement/settlement-verifier.service.js";

export interface ExecutionService {
  submitQuote(request: SubmitQuoteRequest, context: ExecutionContext): Promise<ExecutionResult>;
}

export interface ExecutionServiceDeps {
  hedgeService: HedgeService;
  inventoryService: InventoryService;
  settlementEventService: SettlementEventService;
  settlementVerifier: SettlementVerifier;
}

export interface ExecutionContext {
  quoteId: string;
}

export interface ExecutionResult {
  response: SubmitQuoteResponse;
  settlementEventResult: ApplySettlementEventResult;
  inventoryPositions: {
    tokenIn: InventoryPosition;
    tokenOut: InventoryPosition;
  };
  settlementVerification: SettlementVerificationResult;
  hedgeResult: HedgeResult;
}

export class SkeletonExecutionService implements ExecutionService {
  constructor(private readonly deps: ExecutionServiceDeps) {}

  async submitQuote(request: SubmitQuoteRequest, context: ExecutionContext): Promise<ExecutionResult> {
    const settlementVerification = await this.deps.settlementVerifier.verify({
      quoteId: context.quoteId,
      request,
    });
    const txSeed = `${request.quote.user}:${request.quote.nonce}:${request.signature}`;
    const txHash = `0x${toFixedHex(txSeed, 64)}` as `0x${string}`;
    const settlementEventResult = this.deps.settlementEventService.applySettlementEvent({
      quoteId: context.quoteId,
      quote: request.quote,
      txHash,
      logIndex: 0,
    });

    const tokenInPosition = this.deps.inventoryService.getPosition(request.quote.chainId, request.quote.tokenIn);
    const tokenOutPosition = this.deps.inventoryService.getPosition(request.quote.chainId, request.quote.tokenOut);
    const hedgeResult = this.deps.hedgeService.createHedgeIntent({
      quoteId: context.quoteId,
      chainId: request.quote.chainId,
      token: request.quote.tokenOut,
      side: "buy",
      amount: request.quote.amountOut,
      reason: "inventory_rebalance",
    });

    return {
      response: {
        status: "accepted",
        txHash,
        settlementEventId: settlementEventResult.event.settlementEventId,
        hedgeOrderId: hedgeResult.hedgeOrderId,
      },
      settlementEventResult,
      inventoryPositions: {
        tokenIn: tokenInPosition,
        tokenOut: tokenOutPosition,
      },
      settlementVerification,
      hedgeResult,
    };
  }
}
