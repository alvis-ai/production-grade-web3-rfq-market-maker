import type {
  QuoteLifecycleStatus,
  QuoteRequest,
  QuoteResponse,
  QuoteStatusResponse,
  MarketSnapshot,
  SignedQuote,
  Address,
  UIntString,
} from "../../shared/types/rfq.js";
import { APIError, toAPIError } from "../../shared/errors/api-error.js";
import { validateQuoteRequest } from "../../shared/validation/quote-request.js";
import { validateSubmitQuoteRequest } from "../../shared/validation/submit-request.js";
import { assertPrincipalId, localPrincipalId } from "../../shared/validation/principal-id.js";
import { getMarketDataSnapshotSource } from "../market-data/market-data.service.js";
import type { SaveMarketSnapshotInput } from "../market-data/market-snapshot.repository.js";
import type { PricingResult } from "../pricing/pricing.engine.js";
import type {
  QuoteRecord,
  QuoteStatusMetadata,
  SaveRejectedQuoteInput,
  SaveRequestedQuoteInput,
  SaveSignedQuoteInput,
} from "./quote.repository.js";
import type { RiskDecision, RiskInput } from "../risk/risk.engine.js";
import type { SaveRiskDecisionInput } from "../risk/risk-decision.repository.js";
import type { RoutePlan } from "../routing/routing.engine.js";
import { QuoteIdentityGenerator } from "./quote-identity.js";
import {
  assertQuoteIdempotencyKey,
  quoteRequestHash,
  type QuoteIdempotencyReservation,
} from "./quote-idempotency.store.js";
import {
  defaultQuoteServiceConfig,
  normalizeQuoteAccessContext,
  normalizeQuoteServiceConfig,
  normalizeQuoteServiceDeps,
  type QuoteAccessContext,
  type QuoteServiceConfig,
  type QuoteServiceDeps,
  type SubmittableQuoteOptions,
} from "./quote-service-contract.js";
import {
  assertUsableSnapshot,
  marketDataFailure,
  pricingFailure,
  quoteFailureCode,
  quoteStoreFailure,
  routingFailure,
} from "./quote-service-errors.js";
import {
  assertHedgeRiskPenaltyBps,
  assertInventoryProjection,
  assertInventorySkewBps,
  assertPricingAdjustmentBps,
  assertPricingResult,
  assertQuoteExposureReservationResult,
  assertRiskDecision,
  assertRoutePlan,
  isExactSignedQuote,
  riskUnavailableDecision,
} from "./quote-service-result-validation.js";

export { defaultQuoteServiceConfig } from "./quote-service-contract.js";
export type {
  QuoteAccessContext,
  QuoteServiceConfig,
  QuoteServiceDeps,
  SubmittableQuoteOptions,
} from "./quote-service-contract.js";

export class QuoteService {
  private readonly identityGenerator = new QuoteIdentityGenerator();
  private readonly deps: QuoteServiceDeps;
  private readonly config: QuoteServiceConfig;

  constructor(
    deps: QuoteServiceDeps,
    config: QuoteServiceConfig = defaultQuoteServiceConfig,
  ) {
    this.deps = normalizeQuoteServiceDeps(deps);
    this.config = normalizeQuoteServiceConfig(config);
  }

  async createQuote(request: QuoteRequest, context?: QuoteAccessContext): Promise<QuoteResponse> {
    const access = normalizeQuoteAccessContext(context);
    const validatedRequest = validateQuoteRequest(request);
    if (access.idempotencyKey === undefined) {
      return this.createFreshQuote(validatedRequest, access);
    }

    try {
      assertQuoteIdempotencyKey(access.idempotencyKey);
    } catch {
      throw new APIError("INVALID_REQUEST", "Idempotency-Key is invalid", 400);
    }
    const store = this.deps.quoteIdempotencyStore;
    if (!store) throw new APIError("QUOTE_STORE_UNAVAILABLE", "Quote idempotency store unavailable", 503);

    let claim;
    try {
      claim = await store.acquire(access.principalId, access.idempotencyKey, quoteRequestHash(validatedRequest));
    } catch {
      throw new APIError("QUOTE_STORE_UNAVAILABLE", "Quote idempotency store unavailable", 503);
    }
    if (claim.status === "replay") return claim.response;
    if (claim.status === "failed") {
      throw new APIError(claim.error.code, claim.error.message, claim.error.statusCode);
    }
    if (claim.status === "conflict") {
      throw new APIError("IDEMPOTENCY_KEY_CONFLICT", "Idempotency-Key was already used for another request", 409);
    }
    if (claim.status === "in_progress") {
      throw new APIError("IDEMPOTENCY_REQUEST_IN_PROGRESS", "Idempotent quote request is still processing", 409);
    }

    let response: QuoteResponse;
    try {
      response = await this.createFreshQuote(validatedRequest, access, claim.reservation);
    } catch (error) {
      const apiError = toAPIError(error);
      try {
        await store.fail(claim.reservation, {
          code: apiError.code,
          message: apiError.message,
          statusCode: apiError.statusCode,
        });
      } catch {
        throw new APIError("QUOTE_STORE_UNAVAILABLE", "Quote idempotency store unavailable", 503);
      }
      throw error;
    }

    try {
      await store.complete(claim.reservation, response);
    } catch {
      throw new APIError("QUOTE_STORE_UNAVAILABLE", "Quote idempotency completion unavailable", 503);
    }
    return response;
  }

  private async createFreshQuote(
    validatedRequest: QuoteRequest,
    access: QuoteAccessContext,
    idempotency?: QuoteIdempotencyReservation,
  ): Promise<QuoteResponse> {
    const snapshot = await this.getUsableSnapshot(validatedRequest);
    const snapshotSource = getMarketDataSnapshotSource(snapshot);
    await this.saveMarketSnapshot({
      request: validatedRequest,
      snapshot,
      ...(snapshotSource ? { source: snapshotSource } : {}),
    });

    const identity = this.identityGenerator.next();
    const quoteId = identity.quoteId;
    if (idempotency) {
      try {
        await this.deps.quoteIdempotencyStore?.bindQuote(idempotency, quoteId);
      } catch {
        throw new APIError("QUOTE_STORE_UNAVAILABLE", "Quote idempotency binding unavailable", 503);
      }
    }
    await this.saveRequestedQuote({
      quoteId,
      principalId: access.principalId,
      snapshotId: snapshot.snapshotId,
      request: validatedRequest,
    });

    let routePlan: RoutePlan;
    try {
      const routeResult = await this.deps.routingEngine.selectRoute({ request: validatedRequest, snapshot });
      assertRoutePlan(routeResult, validatedRequest);
      routePlan = routeResult;
    } catch (error) {
      const failure = routingFailure(error);
      await this.markQuoteFailedBestEffort(quoteId, failure.code);
      throw failure;
    }
    let inventorySkewBps: number;
    let hedgeCostBps: number;
    try {
      const inventorySkewResult = await this.deps.inventoryService.calculateQuoteSkewBps({
        chainId: validatedRequest.chainId,
        token: validatedRequest.tokenOut,
      });
      assertInventorySkewBps(inventorySkewResult);
      let hedgeRiskPenaltyResult = 0;
      if (this.deps.hedgeService?.quoteRiskPenaltyBps) {
        const pairPenalties = await Promise.all([
          this.deps.hedgeService.quoteRiskPenaltyBps({
            chainId: validatedRequest.chainId,
            token: validatedRequest.tokenIn,
          }),
          this.deps.hedgeService.quoteRiskPenaltyBps({
            chainId: validatedRequest.chainId,
            token: validatedRequest.tokenOut,
          }),
        ]);
        pairPenalties.forEach(assertHedgeRiskPenaltyBps);
        hedgeRiskPenaltyResult = Math.max(...pairPenalties);
      }
      inventorySkewBps = inventorySkewResult;
      hedgeCostBps = hedgeRiskPenaltyResult;
      assertPricingAdjustmentBps(inventorySkewBps + hedgeCostBps);
    } catch (error) {
      const failure = pricingFailure(error);
      await this.markQuoteFailedBestEffort(quoteId, failure.code);
      throw failure;
    }

    let pricing: PricingResult;
    try {
      const pricingResult = await this.deps.pricingEngine.price({
        request: validatedRequest,
        snapshot,
        routePlan,
        inventorySkewBps,
        hedgeCostBps,
      });
      assertPricingResult(pricingResult);
      pricing = pricingResult;
    } catch (error) {
      const failure = pricingFailure(error);
      await this.markQuoteFailedBestEffort(quoteId, failure.code);
      throw failure;
    }
    const deadline = Math.floor(Date.now() / 1000) + this.config.quoteTtlSeconds;
    let risk: RiskDecision;
    let exposureReserved = false;
    try {
      const projectionResult = await this.deps.inventoryService.projectSettlement({
        chainId: validatedRequest.chainId,
        tokenIn: validatedRequest.tokenIn,
        tokenOut: validatedRequest.tokenOut,
        amountIn: validatedRequest.amountIn,
        amountOut: pricing.amountOut,
      });
      assertInventoryProjection(projectionResult, validatedRequest);
      risk = await this.evaluateRisk({
        request: validatedRequest,
        pricing,
        snapshot,
        inventoryProjection: projectionResult,
      });
      if (risk.status === "approved" && this.deps.quoteExposureStore) {
        const treasuryLiquidity = this.deps.treasuryLiquidityProvider
          ? await this.deps.treasuryLiquidityProvider.getLiquidity({
              chainId: validatedRequest.chainId,
              token: validatedRequest.tokenOut,
            })
          : undefined;
        const exposure = await this.deps.quoteExposureStore.reserve({
          quoteId,
          request: validatedRequest,
          pricing,
          deadline,
          ...(treasuryLiquidity ? { treasuryLiquidity } : {}),
        });
        assertQuoteExposureReservationResult(exposure);
        if (exposure.status === "reserved") {
          exposureReserved = true;
        } else {
          risk = {
            status: "rejected",
            policyVersion: risk.policyVersion,
            reasonCode: exposure.reasonCode,
          };
        }
      }
    } catch {
      risk = riskUnavailableDecision();
    }
    try {
      await this.saveRiskDecision({
        quoteId,
        decision: risk,
      });
    } catch (error) {
      if (exposureReserved) await this.releaseQuoteExposureBestEffort(quoteId);
      await this.markQuoteFailedBestEffort(quoteId, quoteFailureCode(error));
      throw error;
    }
    if (risk.status !== "approved") {
      await this.saveRejectedQuoteBestEffort({
        quoteId,
        principalId: access.principalId,
        snapshotId: snapshot.snapshotId,
        request: validatedRequest,
        rejectCode: risk.reasonCode ?? "RISK_REJECTED",
        riskPolicyVersion: risk.policyVersion,
      });
      throw new APIError(
        "RISK_REJECTED",
        "Quote rejected by risk policy",
        409,
        undefined,
        risk.reasonCode ?? "RISK_REJECTED",
      );
    }

    const signedQuote: SignedQuote = {
      user: validatedRequest.user,
      tokenIn: validatedRequest.tokenIn,
      tokenOut: validatedRequest.tokenOut,
      amountIn: validatedRequest.amountIn,
      amountOut: pricing.amountOut,
      minAmountOut: pricing.minAmountOut,
      nonce: identity.nonce,
      deadline,
      chainId: validatedRequest.chainId,
    };

    let signature: `0x${string}`;
    try {
      signature = await this.deps.signerService.signQuote({
        quote: signedQuote,
        quoteId,
        snapshotId: snapshot.snapshotId,
      });
    } catch (error) {
      if (exposureReserved) await this.releaseQuoteExposureBestEffort(quoteId);
      await this.markQuoteFailedBestEffort(quoteId, quoteFailureCode(error));
      throw error;
    }

    try {
      await this.saveSignedQuote({
        quoteId,
        principalId: access.principalId,
        snapshotId: snapshot.snapshotId,
        slippageBps: validatedRequest.slippageBps,
        quote: signedQuote,
        pricingVersion: pricing.pricingVersion,
        spreadBps: pricing.spreadBps,
        sizeImpactBps: pricing.sizeImpactBps,
        marketSpreadBps: pricing.marketSpreadBps,
        inventorySkewBps: pricing.inventorySkewBps,
        volatilityPremiumBps: pricing.volatilityPremiumBps,
        hedgeCostBps: pricing.hedgeCostBps,
        riskPolicyVersion: risk.policyVersion,
        signature,
      });
    } catch (error) {
      if (exposureReserved) await this.releaseQuoteExposureBestEffort(quoteId);
      throw error;
    }

    const response: QuoteResponse = {
      quoteId,
      snapshotId: snapshot.snapshotId,
      amountOut: pricing.amountOut,
      minAmountOut: pricing.minAmountOut,
      deadline,
      nonce: identity.nonce,
      signature,
    };
    return response;
  }

  async getQuoteStatus(quoteId: string, context?: QuoteAccessContext): Promise<QuoteStatusResponse | undefined> {
    const access = normalizeQuoteAccessContext(context);
    const status = await this.findQuoteStatus(quoteId, access.principalId);
    if (!status) return undefined;

    if (status.status === "signed" && status.deadline && status.deadline < Math.floor(Date.now() / 1000)) {
      await this.markQuoteExpiredBestEffort(status.quoteId);
      return {
        ...status,
        status: "expired",
      };
    }

    return status;
  }

  private async getUsableSnapshot(request: QuoteRequest): Promise<MarketSnapshot> {
    let snapshot: MarketSnapshot;
    try {
      snapshot = await this.deps.marketDataService.getSnapshot(request);
    } catch (error) {
      throw marketDataFailure(error);
    }

    assertUsableSnapshot(snapshot, this.config.maxSnapshotAgeMs, this.config.maxSnapshotFutureSkewMs);
    return snapshot;
  }

  private async saveRequestedQuote(input: SaveRequestedQuoteInput): Promise<void> {
    try {
      await this.deps.quoteRepository.saveRequested(input);
    } catch (error) {
      throw quoteStoreFailure(error);
    }
  }

  private async saveMarketSnapshot(input: SaveMarketSnapshotInput): Promise<void> {
    try {
      await this.deps.marketSnapshotStore.saveSnapshot(input);
    } catch (error) {
      throw quoteStoreFailure(error);
    }
  }

  private async saveRejectedQuote(input: SaveRejectedQuoteInput): Promise<void> {
    try {
      await this.deps.quoteRepository.saveRejected(input);
    } catch (error) {
      throw quoteStoreFailure(error);
    }
  }

  private async saveRejectedQuoteBestEffort(input: SaveRejectedQuoteInput): Promise<void> {
    try {
      await this.saveRejectedQuote(input);
    } catch {
      // Preserve the risk decision; reconciliation can recover requested quotes later.
    }
  }

  private async saveSignedQuote(input: SaveSignedQuoteInput): Promise<void> {
    try {
      await this.deps.quoteRepository.saveSigned(input);
    } catch (error) {
      throw quoteStoreFailure(error);
    }
  }

  private async saveRiskDecision(input: SaveRiskDecisionInput): Promise<void> {
    try {
      await this.deps.riskDecisionStore.saveDecision(input);
    } catch (error) {
      throw quoteStoreFailure(error);
    }
  }

  private async releaseQuoteExposureBestEffort(quoteId: string): Promise<void> {
    try {
      await this.deps.quoteExposureStore?.release(quoteId);
    } catch {
      // The reservation is deadline-bound and will stop counting even when release fails.
    }
  }

  private async findQuoteStatus(quoteId: string, principalId: string): Promise<QuoteStatusResponse | undefined> {
    try {
      return await this.deps.quoteRepository.findStatus(quoteId, principalId);
    } catch (error) {
      throw quoteStoreFailure(error);
    }
  }

  private async markStoredQuoteStatus(
    quoteId: string,
    status: QuoteLifecycleStatus,
    metadata?: QuoteStatusMetadata,
  ): Promise<void> {
    try {
      await this.deps.quoteRepository.markStatus(quoteId, status, metadata);
    } catch (error) {
      throw quoteStoreFailure(error);
    }
  }

  private async markStoredQuoteFailed(quoteId: string, errorCode: string): Promise<void> {
    try {
      await this.deps.quoteRepository.markFailed(quoteId, errorCode);
    } catch (error) {
      throw quoteStoreFailure(error);
    }
  }

  private async markQuoteFailedBestEffort(quoteId: string, errorCode: string): Promise<void> {
    try {
      await this.markStoredQuoteFailed(quoteId, errorCode);
    } catch {
      // Preserve the original signer failure; reconciliation can recover requested quotes later.
    }
  }

  private async markQuoteExpiredBestEffort(quoteId: string): Promise<void> {
    try {
      await this.markStoredQuoteStatus(quoteId, "expired");
      await this.releaseQuoteExposureBestEffort(quoteId);
    } catch {
      // Preserve the read or submit response; reconciliation can recover stale signed quotes later.
    }
  }

  private async findSignedQuoteByChainUserNonce(
    chainId: number,
    user: Address,
    nonce: UIntString,
    principalId: string,
  ): Promise<QuoteRecord | undefined> {
    try {
      return await this.deps.quoteRepository.findSignedQuoteByChainUserNonce(chainId, user, nonce, principalId);
    } catch (error) {
      throw quoteStoreFailure(error);
    }
  }

  private async evaluateRisk(input: RiskInput): Promise<RiskDecision> {
    try {
      const riskDecision = await this.deps.riskEngine.evaluate(input);
      assertRiskDecision(riskDecision);
      return riskDecision;
    } catch {
      return riskUnavailableDecision();
    }
  }

  async markQuoteStatus(quoteId: string, status: QuoteLifecycleStatus, metadata?: QuoteStatusMetadata): Promise<void> {
    await this.markStoredQuoteStatus(quoteId, status, metadata);
    if (status === "expired") {
      await this.releaseQuoteExposureBestEffort(quoteId);
    }
  }

  async markQuoteFailed(quoteId: string, errorCode: string): Promise<void> {
    await this.markStoredQuoteFailed(quoteId, errorCode);
  }

  async requireSubmittableSignedQuote(
    quote: SignedQuote,
    signature: `0x${string}`,
    options: SubmittableQuoteOptions = {},
  ): Promise<string> {
    if (typeof options !== "object" || options === null || Array.isArray(options)) {
      throw new APIError("INVALID_REQUEST", "Submit quote lookup options must be an object", 400);
    }
    const unknownOption = Object.keys(options).find(
      (field) => field !== "allowExpired" && field !== "principalId",
    );
    if (unknownOption) {
      throw new APIError("INVALID_REQUEST", `Submit quote lookup options contain unknown field ${unknownOption}`, 400);
    }
    if ("allowExpired" in options && !Object.prototype.hasOwnProperty.call(options, "allowExpired")) {
      throw new APIError("INVALID_REQUEST", "Submit quote lookup allowExpired must be an own field", 400);
    }
    if (options.allowExpired !== undefined && typeof options.allowExpired !== "boolean") {
      throw new APIError("INVALID_REQUEST", "Submit quote lookup allowExpired must be a boolean", 400);
    }
    if ("principalId" in options && !Object.prototype.hasOwnProperty.call(options, "principalId")) {
      throw new APIError("INVALID_REQUEST", "Submit quote lookup principalId must be an own field", 400);
    }
    try {
      assertPrincipalId(options.principalId ?? localPrincipalId, "Submit quote lookup principalId");
    } catch (error) {
      throw new APIError("INVALID_REQUEST", error instanceof Error ? error.message : "Invalid principalId", 400);
    }
    const allowExpired = options.allowExpired ?? false;
    const principalId = options.principalId ?? localPrincipalId;
    const validatedSubmitRequest = validateSubmitQuoteRequest({ quote, signature }, { allowExpired: true });
    const validatedQuote = validatedSubmitRequest.quote;
    const record = await this.findSignedQuoteByChainUserNonce(
      validatedQuote.chainId,
      validatedQuote.user,
      validatedQuote.nonce,
      principalId,
    );
    if (!record || !isExactSignedQuote(record, validatedQuote)) {
      throw new APIError("QUOTE_NOT_FOUND", "Signed quote not found", 404);
    }
    if (record.status === "submitted" || record.status === "settled") {
      throw new APIError("QUOTE_ALREADY_USED", "Quote already used", 409);
    }
    if (record.status === "failed") {
      throw new APIError("QUOTE_FAILED", "Quote already failed", 409);
    }
    if (record.status === "expired" && !allowExpired) {
      throw new APIError("QUOTE_EXPIRED", "Quote expired", 409);
    }
    if (!allowExpired && record.deadline && record.deadline < Math.floor(Date.now() / 1000)) {
      await this.markQuoteExpiredBestEffort(record.quoteId);
      throw new APIError("QUOTE_EXPIRED", "Quote expired", 409);
    }
    if (record.signature?.toLowerCase() !== validatedSubmitRequest.signature.toLowerCase()) {
      throw new APIError("INVALID_SIGNATURE", "Quote signature does not match stored signed quote", 409);
    }

    const isValidSignature = await this.deps.signerService.verifyQuoteSignature(
      validatedQuote,
      validatedSubmitRequest.signature,
    );
    if (!isValidSignature) {
      throw new APIError("INVALID_SIGNATURE", "Quote signature is not from the trusted signer", 409);
    }

    return record.quoteId;
  }
}
