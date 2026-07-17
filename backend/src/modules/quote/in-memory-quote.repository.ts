import type {
  Address,
  QuoteLifecycleStatus,
  QuoteStatusResponse,
  SignedQuote,
  UIntString,
} from "../../shared/types/rfq.js";
import { assertPrincipalId } from "../../shared/validation/principal-id.js";
import type {
  ClearSettlementStatusInput,
  ClearSettlementStatusResult,
  QuoteRecord,
  QuoteRepository,
  QuoteStatusMetadata,
  SaveRejectedQuoteInput,
  SaveRequestedQuoteInput,
  SaveRouteDecisionInput,
  SaveSignedQuoteInput,
} from "./quote-repository-contract.js";
import {
  assertCanClearSettlementStatus,
  assertCanMarkFailed,
  assertCanSaveRejectedQuote,
  assertCanSaveRequestedQuote,
  assertCanSaveRouteDecision,
  assertCanSaveSignedQuote,
  assertNonEmptyString,
  assertNonSettlementStatusMetadata,
  assertQuoteStatusMetadata,
  assertQuoteStatusMetadataDoesNotConflict,
  assertRejectedQuoteInput,
  assertRequestedQuoteInput,
  assertRouteDecisionInput,
  assertSafeIdentifier,
  assertSettlementStatusMetadata,
  assertSignedQuoteInput,
  assertStatusTransition,
  cloneQuoteRecord,
  hasSettlementStatusMetadata,
  mergeQuoteStatusMetadata,
  normalizeClearSettlementStatusInput,
  normalizeQuoteStatusMetadata,
  quoteStatusResponseFromRecord,
  shouldExpireAfterSettlementRemoval,
} from "./quote-repository-invariants.js";

export class InMemoryQuoteRepository implements QuoteRepository {
  private readonly records = new Map<string, QuoteRecord>();
  private readonly quoteIdsByChainUserNonce = new Map<string, string>();

  async checkHealth(): Promise<void> {
    await this.findStatus("__readiness_probe__");
  }

  async saveRequested(input: SaveRequestedQuoteInput): Promise<void> {
    assertRequestedQuoteInput(input);

    const current = this.records.get(input.quoteId);
    if (current) {
      assertCanSaveRequestedQuote(current, input);
      return;
    }

    this.records.set(input.quoteId, {
      quoteId: input.quoteId,
      principalId: input.principalId,
      chainId: input.request.chainId,
      user: input.request.user,
      tokenIn: input.request.tokenIn,
      tokenOut: input.request.tokenOut,
      amountIn: input.request.amountIn,
      slippageBps: input.request.slippageBps,
      snapshotId: input.snapshotId,
      status: "requested",
    });
  }

  async saveRouteDecision(input: SaveRouteDecisionInput): Promise<void> {
    assertRouteDecisionInput(input);

    const current = this.records.get(input.quoteId);
    assertCanSaveRouteDecision(current, input);
    if (current?.routeId !== undefined) {
      return;
    }

    this.records.set(input.quoteId, {
      ...current,
      routeId: input.routePlan.routeId,
      routeVenue: input.routePlan.venue,
      routeExpectedLiquidityUsd: input.routePlan.expectedLiquidityUsd,
      routeDecidedAt: new Date().toISOString(),
    });
  }

  async saveRejected(input: SaveRejectedQuoteInput): Promise<void> {
    assertRejectedQuoteInput(input);

    const current = this.records.get(input.quoteId);
    assertCanSaveRejectedQuote(current, input);
    if (!current || current.status === "rejected") {
      return;
    }

    this.records.set(input.quoteId, {
      ...current,
      quoteId: input.quoteId,
      principalId: input.principalId,
      chainId: input.request.chainId,
      user: input.request.user,
      tokenIn: input.request.tokenIn,
      tokenOut: input.request.tokenOut,
      amountIn: input.request.amountIn,
      slippageBps: input.request.slippageBps,
      snapshotId: input.snapshotId,
      status: "rejected",
      rejectCode: input.rejectCode,
      riskPolicyVersion: input.riskPolicyVersion,
    });
  }

  async saveSigned(input: SaveSignedQuoteInput): Promise<void> {
    assertSignedQuoteInput(input);

    const current = this.records.get(input.quoteId);
    const key = this.chainUserNonceKey(input.quote.chainId, input.quote.user, input.quote.nonce);
    const existingQuoteId = this.quoteIdsByChainUserNonce.get(key);
    if (existingQuoteId && existingQuoteId !== input.quoteId) {
      throw new Error(`Signed quote nonce key already exists for ${existingQuoteId}`);
    }
    if (current?.nonce && !this.isSameSignedQuoteIdentity(current, input.quote)) {
      throw new Error(`Signed quote identity cannot be changed for ${input.quoteId}`);
    }
    if (current) {
      assertCanSaveSignedQuote(current, input);
      if (current.status === "signed") {
        return;
      }
    }

    this.records.set(input.quoteId, {
      ...(current ?? {}),
      quoteId: input.quoteId,
      principalId: input.principalId,
      chainId: input.quote.chainId,
      user: input.quote.user,
      tokenIn: input.quote.tokenIn,
      tokenOut: input.quote.tokenOut,
      amountIn: input.quote.amountIn,
      slippageBps: input.slippageBps,
      amountOut: input.quote.amountOut,
      minAmountOut: input.quote.minAmountOut,
      nonce: input.quote.nonce,
      deadline: input.quote.deadline,
      snapshotId: input.snapshotId,
      pricingVersion: input.pricingVersion,
      spreadBps: input.spreadBps,
      sizeImpactBps: input.sizeImpactBps,
      marketSpreadBps: input.marketSpreadBps,
      inventorySkewBps: input.inventorySkewBps,
      volatilityPremiumBps: input.volatilityPremiumBps,
      hedgeCostBps: input.hedgeCostBps,
      riskPolicyVersion: input.riskPolicyVersion,
      status: "signed",
      signature: input.signature,
    });
    this.quoteIdsByChainUserNonce.set(key, input.quoteId);
  }

  async findStatus(quoteId: string, principalId?: string): Promise<QuoteStatusResponse | undefined> {
    if (principalId !== undefined) assertPrincipalId(principalId, "Quote status principalId");
    const record = this.records.get(quoteId);
    if (!record || (principalId !== undefined && record.principalId !== principalId)) return undefined;

    return quoteStatusResponseFromRecord(record);
  }

  async findPrincipalId(quoteId: string): Promise<string | undefined> {
    assertSafeIdentifier(quoteId, "quoteId", "Quote ownership");
    return this.records.get(quoteId)?.principalId;
  }

  async markFailed(quoteId: string, errorCode: string): Promise<void> {
    const current = this.records.get(quoteId);
    if (!current) {
      return;
    }
    assertNonEmptyString(errorCode, "errorCode", "Failed quote");
    assertCanMarkFailed(current, errorCode);
    if (current.status === "failed") {
      return;
    }

    this.records.set(quoteId, {
      ...current,
      status: "failed",
      rejectCode: errorCode,
    });
  }

  async markStatus(quoteId: string, status: QuoteLifecycleStatus, metadata?: QuoteStatusMetadata): Promise<void> {
    const current = this.records.get(quoteId);
    if (!current) {
      return;
    }
    assertStatusTransition(current, status);
    assertQuoteStatusMetadata(metadata);
    const normalizedMetadata = normalizeQuoteStatusMetadata(metadata);
    assertQuoteStatusMetadataDoesNotConflict(current, normalizedMetadata);
    assertNonSettlementStatusMetadata(current, status, normalizedMetadata);
    assertSettlementStatusMetadata(current, status, normalizedMetadata);
    const statusMetadata = mergeQuoteStatusMetadata(current, normalizedMetadata);

    this.records.set(quoteId, {
      ...current,
      status,
      ...statusMetadata,
    });
  }

  async restoreSettlementStatus(quoteId: string, metadata: QuoteStatusMetadata): Promise<void> {
    const current = this.records.get(quoteId);
    if (!current) return;
    if (current.status !== "expired") {
      await this.markStatus(quoteId, "settled", metadata);
      return;
    }

    assertQuoteStatusMetadata(metadata);
    const normalizedMetadata = normalizeQuoteStatusMetadata(metadata);
    assertQuoteStatusMetadataDoesNotConflict(current, normalizedMetadata);
    assertSettlementStatusMetadata(current, "settled", normalizedMetadata);
    this.records.set(quoteId, {
      ...current,
      status: "settled",
      ...mergeQuoteStatusMetadata(current, normalizedMetadata),
    });
  }

  async clearSettlementStatus(input: ClearSettlementStatusInput): Promise<ClearSettlementStatusResult> {
    const normalizedInput = normalizeClearSettlementStatusInput(input);
    const current = this.records.get(normalizedInput.quoteId);
    if (!current) {
      return {
        cleared: false,
      };
    }
    if (!hasSettlementStatusMetadata(current)) {
      return {
        status: quoteStatusResponseFromRecord(current),
        cleared: false,
      };
    }

    assertCanClearSettlementStatus(current, normalizedInput);
    const nextRecord: QuoteRecord = {
      ...current,
      status: shouldExpireAfterSettlementRemoval(current, normalizedInput.nowSeconds) ? "expired" : "signed",
      txHash: undefined,
      settlementEventId: undefined,
      hedgeOrderId: undefined,
      pnlId: undefined,
    };
    this.records.set(current.quoteId, nextRecord);

    return {
      status: quoteStatusResponseFromRecord(nextRecord),
      cleared: true,
    };
  }

  async findQuoteIdByChainUserNonce(
    chainId: number,
    user: Address,
    nonce: UIntString,
  ): Promise<string | undefined> {
    return this.quoteIdsByChainUserNonce.get(this.chainUserNonceKey(chainId, user, nonce));
  }

  async findSignedQuoteByQuoteId(quoteId: string, principalId?: string): Promise<QuoteRecord | undefined> {
    if (principalId !== undefined) assertPrincipalId(principalId, "Signed quote principalId");
    const record = this.records.get(quoteId);
    if (
      (principalId !== undefined && record?.principalId !== principalId) ||
      !record?.nonce ||
      !record.amountOut ||
      !record.minAmountOut ||
      !record.deadline ||
      !record.signature ||
      record.spreadBps === undefined ||
      record.sizeImpactBps === undefined ||
      record.marketSpreadBps === undefined ||
      record.inventorySkewBps === undefined ||
      record.volatilityPremiumBps === undefined ||
      record.hedgeCostBps === undefined
    ) {
      return undefined;
    }

    return cloneQuoteRecord(record);
  }

  async findSignedQuoteByChainUserNonce(
    chainId: number,
    user: Address,
    nonce: UIntString,
    principalId?: string,
  ): Promise<QuoteRecord | undefined> {
    const quoteId = await this.findQuoteIdByChainUserNonce(chainId, user, nonce);
    if (!quoteId) return undefined;

    return this.findSignedQuoteByQuoteId(quoteId, principalId);
  }

  private chainUserNonceKey(chainId: number, user: Address, nonce: UIntString): string {
    return `${chainId}:${user.toLowerCase()}:${nonce}`;
  }

  private isSameSignedQuoteIdentity(record: QuoteRecord, quote: SignedQuote): boolean {
    return (
      record.chainId === quote.chainId &&
      record.user.toLowerCase() === quote.user.toLowerCase() &&
      record.nonce === quote.nonce
    );
  }
}
