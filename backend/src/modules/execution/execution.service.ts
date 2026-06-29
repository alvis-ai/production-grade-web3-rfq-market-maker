import { keccak256, toBytes } from "viem";
import type { SubmitQuoteRequest, SubmitQuoteResponse } from "../../shared/types/rfq.js";
import { APIError } from "../../shared/errors/api-error.js";
import type { HedgeIntent, HedgeResult } from "../hedge/hedge.service.js";
import type { HedgeIntentService, HedgeFailureReasonCode } from "../hedge/hedge.service.js";
import type { InventoryPosition, InventoryService } from "../inventory/inventory.service.js";
import type { ApplySettlementEventResult, SettlementEventStore } from "../settlement/settlement-event.service.js";
import type { SettlementVerificationResult, SettlementVerifier } from "../settlement/settlement-verifier.service.js";

export interface ExecutionService {
  submitQuote(request: SubmitQuoteRequest, context: ExecutionContext): Promise<ExecutionResult>;
}

export interface ExecutionServiceDeps {
  hedgeService: HedgeIntentService;
  inventoryService: InventoryService;
  settlementEventService: SettlementEventStore;
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
  hedgeLagSeconds?: number;
}

export interface HedgeFailure {
  reasonCode: HedgeFailureReasonCode;
}

type CreateHedgeIntentResult =
  | { hedgeResult: HedgeResult; hedgeFailure?: undefined; hedgeLagSeconds: number }
  | { hedgeResult?: undefined; hedgeFailure: HedgeFailure; hedgeLagSeconds?: undefined };

export class SkeletonExecutionService implements ExecutionService {
  constructor(private readonly deps: ExecutionServiceDeps) {}

  async submitQuote(request: SubmitQuoteRequest, context: ExecutionContext): Promise<ExecutionResult> {
    const settlementVerification = await this.verifySettlement(request, context);
    const txHash = buildSyntheticTxHash(request, context);
    const settlementEventResult = this.applySettlementEvent({
      quoteId: context.quoteId,
      quote: request.quote,
      txHash,
      logIndex: 0,
    });

    const tokenInPosition = this.deps.inventoryService.getPosition(request.quote.chainId, request.quote.tokenIn);
    const tokenOutPosition = this.deps.inventoryService.getPosition(request.quote.chainId, request.quote.tokenOut);
    const { hedgeResult, hedgeFailure, hedgeLagSeconds } = settlementEventResult.duplicate
      ? { hedgeResult: undefined, hedgeFailure: undefined, hedgeLagSeconds: undefined }
      : this.createHedgeIntent(request, context, settlementEventResult.event.settlementEventId);

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
      hedgeLagSeconds,
    };
  }

  private applySettlementEvent(input: Parameters<SettlementEventStore["applySettlementEvent"]>[0]): ApplySettlementEventResult {
    try {
      return this.deps.settlementEventService.applySettlementEvent(input);
    } catch (error) {
      throw settlementEventStoreFailure(error);
    }
  }

  private createHedgeIntent(
    request: SubmitQuoteRequest,
    context: ExecutionContext,
    settlementEventId: string,
  ): CreateHedgeIntentResult {
    const intent: HedgeIntent = {
      settlementEventId,
      quoteId: context.quoteId,
      chainId: request.quote.chainId,
      token: request.quote.tokenOut,
      side: "buy",
      amount: request.quote.amountOut,
      reason: "inventory_rebalance",
    };
    const startedAt = Date.now();

    try {
      return {
        hedgeResult: this.deps.hedgeService.createHedgeIntent(intent),
        hedgeLagSeconds: elapsedSeconds(startedAt),
      };
    } catch {
      this.deps.hedgeService.recordHedgeFailure?.(intent, "HEDGE_INTENT_FAILED");
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

export function buildSyntheticTxHash(request: SubmitQuoteRequest, context: ExecutionContext): `0x${string}` {
  const payload = JSON.stringify({
    quoteId: context.quoteId,
    quote: request.quote,
    signature: request.signature,
  });

  return keccak256(toBytes(payload));
}

function elapsedSeconds(startedAtMs: number): number {
  return (Date.now() - startedAtMs) / 1000;
}

function settlementVerificationFailure(error: unknown): APIError {
  if (error instanceof APIError) {
    return error;
  }

  return new APIError("SETTLEMENT_UNAVAILABLE", "Settlement verifier unavailable", 503);
}

function settlementEventStoreFailure(error: unknown): APIError {
  if (error instanceof APIError) {
    return error;
  }

  return new APIError("SETTLEMENT_EVENT_STORE_UNAVAILABLE", "Settlement event store unavailable", 503);
}
