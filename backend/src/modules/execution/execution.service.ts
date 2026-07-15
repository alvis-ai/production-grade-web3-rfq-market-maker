import { keccak256, toBytes } from "viem";
import { APIError } from "../../shared/errors/api-error.js";
import type { SubmitQuoteRequest } from "../../shared/types/rfq.js";
import { validateSubmitQuoteRequest } from "../../shared/validation/submit-request.js";
import {
  DeltaNeutralHedgePlanner,
  type HedgeIntentPlanner,
} from "../hedge/hedge-intent-planner.js";
import type { HedgeIntent, HedgeResult } from "../hedge/hedge.service.js";
import type {
  ApplySettlementEventInput,
  ApplySettlementEventResult,
} from "../settlement/settlement-event.service.js";
import type { SettlementVerificationResult } from "../settlement/settlement-verifier.service.js";
import {
  assertExecutionContext,
  normalizeExecutionServiceDeps,
  normalizeHedgeIntentPlanner,
  normalizeSettlementEvidenceProvider,
  type ExecutionContext,
  type ExecutionResult,
  type ExecutionService,
  type ExecutionServiceDeps,
  type HedgeFailure,
  type SettlementEvidence,
  type SettlementEvidenceProvider,
} from "./execution-service-contract.js";
import {
  assertHedgeResult,
  assertInventoryPositionResult,
} from "./execution-service-post-trade-validation.js";
import {
  assertApplySettlementEventResult,
  assertSettlementEvidence,
  assertSettlementVerificationResult,
  settlementEventStoreFailure,
  settlementVerificationFailure,
} from "./execution-service-result-validation.js";

export type {
  ExecutionContext,
  ExecutionResult,
  ExecutionService,
  ExecutionServiceDeps,
  HedgeFailure,
  SettlementEvidence,
  SettlementEvidenceProvider,
} from "./execution-service-contract.js";

type CreateHedgeIntentResult =
  | { hedgeResult: HedgeResult; hedgeFailure?: undefined; hedgeLagSeconds: number }
  | { hedgeResult?: undefined; hedgeFailure: HedgeFailure; hedgeLagSeconds?: undefined };

export class SkeletonExecutionService implements ExecutionService {
  private readonly deps: ExecutionServiceDeps;
  private readonly evidenceProvider: SettlementEvidenceProvider;
  private readonly hedgePlanner: HedgeIntentPlanner;

  constructor(
    deps: ExecutionServiceDeps,
    evidenceProvider: SettlementEvidenceProvider = syntheticSettlementEvidenceProvider,
    hedgePlanner: HedgeIntentPlanner = new DeltaNeutralHedgePlanner(),
  ) {
    this.deps = normalizeExecutionServiceDeps(deps);
    this.evidenceProvider = normalizeSettlementEvidenceProvider(evidenceProvider);
    this.hedgePlanner = normalizeHedgeIntentPlanner(hedgePlanner);
  }

  async submitQuote(request: SubmitQuoteRequest, context: ExecutionContext): Promise<ExecutionResult> {
    assertExecutionContext(context);
    const validatedRequest = validateSubmitQuoteRequest(request);
    const settlementVerification = await this.verifySettlement(validatedRequest, context);
    const evidence = await this.resolveSettlementEvidence(validatedRequest, context);
    const settlementEventResult = await this.applySettlementEvent({
      quoteId: context.quoteId,
      quote: validatedRequest.quote,
      txHash: evidence.txHash,
      blockNumber: evidence.blockNumber,
      logIndex: evidence.logIndex,
      settledAt: evidence.settledAt,
    });

    const inventoryPositions = await this.readInventoryPositions(validatedRequest);
    const { hedgeResult, hedgeFailure, hedgeLagSeconds } = settlementEventResult.duplicate
      ? { hedgeResult: undefined, hedgeFailure: undefined, hedgeLagSeconds: undefined }
      : await this.createHedgeIntent(validatedRequest, context, settlementEventResult.event.settlementEventId);

    return {
      response: {
        status: "accepted",
        txHash: evidence.txHash,
        settlementEventId: settlementEventResult.event.settlementEventId,
        hedgeOrderId: hedgeResult?.hedgeOrderId,
      },
      settlementEventResult,
      inventoryPositions,
      settlementVerification,
      hedgeResult,
      hedgeFailure,
      hedgeLagSeconds,
    };
  }

  private async resolveSettlementEvidence(
    request: SubmitQuoteRequest,
    context: ExecutionContext,
  ): Promise<SettlementEvidence> {
    try {
      const evidence = await this.evidenceProvider.resolve(request, context);
      assertSettlementEvidence(evidence, request);
      return evidence;
    } catch (error) {
      if (error instanceof APIError) throw error;
      throw new APIError("SETTLEMENT_UNAVAILABLE", "Settlement evidence is unavailable", 503);
    }
  }

  private async applySettlementEvent(input: ApplySettlementEventInput): Promise<ApplySettlementEventResult> {
    try {
      const settlementEventResult = await this.deps.settlementEventService.applySettlementEvent(input);
      assertApplySettlementEventResult(settlementEventResult, input);
      return settlementEventResult;
    } catch (error) {
      throw settlementEventStoreFailure(error);
    }
  }

  private async readInventoryPositions(
    request: SubmitQuoteRequest,
  ): Promise<ExecutionResult["inventoryPositions"]> {
    try {
      const [tokenIn, tokenOut] = await Promise.all([
        this.deps.inventoryService.getPosition(request.quote.chainId, request.quote.tokenIn),
        this.deps.inventoryService.getPosition(request.quote.chainId, request.quote.tokenOut),
      ]);
      assertInventoryPositionResult(tokenIn, request.quote.chainId, request.quote.tokenIn, "tokenIn");
      assertInventoryPositionResult(tokenOut, request.quote.chainId, request.quote.tokenOut, "tokenOut");
      return { tokenIn, tokenOut };
    } catch {
      return undefined;
    }
  }

  private async createHedgeIntent(
    request: SubmitQuoteRequest,
    context: ExecutionContext,
    settlementEventId: string,
  ): Promise<CreateHedgeIntentResult> {
    const startedAt = Date.now();
    let intent: HedgeIntent;

    try {
      intent = this.hedgePlanner.plan({
        settlementEventId,
        quoteId: context.quoteId,
        chainId: request.quote.chainId,
        tokenIn: request.quote.tokenIn,
        tokenOut: request.quote.tokenOut,
        amountIn: request.quote.amountIn,
        amountOut: request.quote.amountOut,
      });
    } catch {
      return { hedgeFailure: { reasonCode: "HEDGE_INTENT_FAILED" } };
    }

    try {
      const hedgeResult = await this.deps.hedgeService.createHedgeIntent(intent);
      assertHedgeResult(hedgeResult, intent);
      return {
        hedgeResult,
        hedgeLagSeconds: elapsedSeconds(startedAt),
      };
    } catch {
      try {
        await this.deps.hedgeService.recordHedgeFailure?.(intent, "HEDGE_INTENT_FAILED");
      } catch {}
      return { hedgeFailure: { reasonCode: "HEDGE_INTENT_FAILED" } };
    }
  }

  private async verifySettlement(
    request: SubmitQuoteRequest,
    context: ExecutionContext,
  ): Promise<SettlementVerificationResult> {
    try {
      const settlementVerification = await this.deps.settlementVerifier.verify({
        quoteId: context.quoteId,
        request,
      });
      assertSettlementVerificationResult(settlementVerification, request.quote.amountOut);
      return settlementVerification;
    } catch (error) {
      throw settlementVerificationFailure(error);
    }
  }
}

const syntheticSettlementEvidenceProvider: SettlementEvidenceProvider = {
  async resolve(request, context) {
    if (request.txHash !== undefined) {
      throw new APIError(
        "INVALID_REQUEST",
        "txHash confirmation is not enabled by the simulated execution provider",
        400,
      );
    }
    return {
      txHash: buildSyntheticTxHash(request, context),
      blockNumber: 0,
      logIndex: 0,
      settledAt: new Date().toISOString(),
    };
  },
};

export function buildSyntheticTxHash(request: SubmitQuoteRequest, context: ExecutionContext): `0x${string}` {
  assertExecutionContext(context);
  const validatedRequest = validateSubmitQuoteRequest(request);
  if (validatedRequest.txHash !== undefined) {
    throw new APIError("INVALID_REQUEST", "Synthetic tx hash generation does not accept txHash", 400);
  }
  const payload = JSON.stringify({
    quoteId: context.quoteId,
    quote: validatedRequest.quote,
    signature: validatedRequest.signature,
  });
  return keccak256(toBytes(payload));
}

function elapsedSeconds(startedAtMs: number): number {
  return (Date.now() - startedAtMs) / 1000;
}
