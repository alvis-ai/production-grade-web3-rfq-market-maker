import type { SubmitQuoteRequest, SubmitQuoteResponse } from "../../shared/types/rfq.js";
import { APIError } from "../../shared/errors/api-error.js";
import { toFixedHex } from "../../shared/types/hex.js";
import type { HedgeResult } from "../hedge/hedge.service.js";
import type { HedgeIntentService } from "../hedge/hedge.service.js";
import type { InventoryPosition, InventoryService } from "../inventory/inventory.service.js";
import type { ApplySettlementEventResult, SettlementEventService } from "../settlement/settlement-event.service.js";
import type { SettlementVerificationResult, SettlementVerifier } from "../settlement/settlement-verifier.service.js";

export interface ExecutionService {
  submitQuote(request: SubmitQuoteRequest, context: ExecutionContext): Promise<ExecutionResult>;
}

export interface ExecutionServiceDeps {
  hedgeService: HedgeIntentService;
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
  hedgeResult?: HedgeResult;
  hedgeFailure?: HedgeFailure;
}

export interface HedgeFailure {
  reasonCode: "HEDGE_INTENT_FAILED";
}

export class SkeletonExecutionService implements ExecutionService {
  constructor(private readonly deps: ExecutionServiceDeps) {}

  async submitQuote(request: SubmitQuoteRequest, context: ExecutionContext): Promise<ExecutionResult> {
    const settlementVerification = await this.verifySettlement(request, context);
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
    const { hedgeResult, hedgeFailure } = settlementEventResult.duplicate
      ? { hedgeResult: undefined, hedgeFailure: undefined }
      : this.createHedgeIntent(request, context);

    return {
      response: {
        status: "accepted",
        txHash,
        settlementEventId: settlementEventResult.event.settlementEventId,
        hedgeOrderId: hedgeResult?.hedgeOrderId,
      },
      settlementEventResult,
      inventoryPositions: {
        tokenIn: tokenInPosition,
        tokenOut: tokenOutPosition,
      },
      settlementVerification,
      hedgeResult,
      hedgeFailure,
    };
  }

  private createHedgeIntent(
    request: SubmitQuoteRequest,
    context: ExecutionContext,
  ): { hedgeResult: HedgeResult; hedgeFailure?: undefined } | { hedgeResult?: undefined; hedgeFailure: HedgeFailure } {
    try {
      return {
        hedgeResult: this.deps.hedgeService.createHedgeIntent({
          quoteId: context.quoteId,
          chainId: request.quote.chainId,
          token: request.quote.tokenOut,
          side: "buy",
          amount: request.quote.amountOut,
          reason: "inventory_rebalance",
        }),
      };
    } catch {
      return {
        hedgeFailure: {
          reasonCode: "HEDGE_INTENT_FAILED",
        },
      };
    }
  }

  private async verifySettlement(
    request: SubmitQuoteRequest,
    context: ExecutionContext,
  ): Promise<SettlementVerificationResult> {
    try {
      return await this.deps.settlementVerifier.verify({
        quoteId: context.quoteId,
        request,
      });
    } catch (error) {
      throw settlementVerificationFailure(error);
    }
  }
}

function settlementVerificationFailure(error: unknown): APIError {
  if (error instanceof APIError) {
    return error;
  }

  return new APIError("SETTLEMENT_UNAVAILABLE", "Settlement verifier unavailable", 503);
}
