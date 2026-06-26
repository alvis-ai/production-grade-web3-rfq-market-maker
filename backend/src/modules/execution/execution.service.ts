import type { SubmitQuoteRequest, SubmitQuoteResponse } from "../../shared/types/rfq.js";
import { toFixedHex } from "../../shared/types/hex.js";
import type { HedgeResult } from "../hedge/hedge.service.js";
import type { HedgeService } from "../hedge/hedge.service.js";
import type { InventoryPosition, InventoryService, SettlementDelta } from "../inventory/inventory.service.js";

export interface ExecutionService {
  submitQuote(request: SubmitQuoteRequest): Promise<ExecutionResult>;
}

export interface ExecutionServiceDeps {
  hedgeService: HedgeService;
  inventoryService: InventoryService;
}

export interface ExecutionResult {
  response: SubmitQuoteResponse;
  settlementDelta: SettlementDelta;
  inventoryPositions: {
    tokenIn: InventoryPosition;
    tokenOut: InventoryPosition;
  };
  hedgeResult: HedgeResult;
}

export class SkeletonExecutionService implements ExecutionService {
  constructor(private readonly deps: ExecutionServiceDeps) {}

  async submitQuote(request: SubmitQuoteRequest): Promise<ExecutionResult> {
    const txSeed = `${request.quote.user}:${request.quote.nonce}:${request.signature}`;
    const txHash = `0x${toFixedHex(txSeed, 64)}` as `0x${string}`;
    const settlementDelta: SettlementDelta = {
      chainId: request.quote.chainId,
      tokenIn: request.quote.tokenIn,
      tokenOut: request.quote.tokenOut,
      amountIn: request.quote.amountIn,
      amountOut: request.quote.amountOut,
    };

    this.deps.inventoryService.applySettlement(settlementDelta);
    const tokenInPosition = this.deps.inventoryService.getPosition(request.quote.chainId, request.quote.tokenIn);
    const tokenOutPosition = this.deps.inventoryService.getPosition(request.quote.chainId, request.quote.tokenOut);
    const hedgeResult = this.deps.hedgeService.createHedgeIntent({
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
      },
      settlementDelta,
      inventoryPositions: {
        tokenIn: tokenInPosition,
        tokenOut: tokenOutPosition,
      },
      hedgeResult,
    };
  }
}
