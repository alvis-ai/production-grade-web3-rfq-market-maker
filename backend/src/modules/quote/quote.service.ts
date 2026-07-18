import type {
  QuoteLifecycleStatus,
  QuoteRequest,
  QuoteResponse,
  QuoteStatusResponse,
  MarketSnapshot,
  SignedQuote,
} from "../../shared/types/rfq.js";
import { APIError, toAPIError } from "../../shared/errors/api-error.js";
import { validateQuoteRequest } from "../../shared/validation/quote-request.js";
import { localPrincipalId } from "../../shared/validation/principal-id.js";
import { getMarketDataSnapshotSource } from "../market-data/market-data.service.js";
import type { SaveMarketSnapshotInput } from "../market-data/market-snapshot.repository.js";
import type { PricingResult } from "../pricing/pricing.engine.js";
import type {
  QuoteStatusMetadata,
  SaveRejectedQuoteInput,
  SaveRequestedQuoteInput,
  SaveRouteDecisionInput,
  SaveSignedQuoteInput,
} from "./quote.repository.js";
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
} from "./quote-service-errors.js";
import {
  assertHedgeRiskPenaltyBps,
  assertInventorySkewBps,
  assertPricingAdjustmentBps,
  assertPricingResult,
} from "./quote-service-result-validation.js";
import { selectAndPersistQuoteRoute, selectQuoteRoute } from "./quote-route-selection.js";
import type { RoutePlan } from "../routing/routing.engine.js";
import { authorizeQuote } from "./quote-authorization.js";
import { requireSubmittableQuote } from "./quote-submittable.js";

export { defaultQuoteServiceConfig } from "./quote-service-contract.js";
export type {
  QuoteAccessContext,
  QuoteServiceConfig,
  QuoteServiceDeps,
  SubmittableQuoteOptions,
} from "./quote-service-contract.js";

interface FreshQuoteResult {
  response: QuoteResponse;
  idempotencyCompleted: boolean;
}

interface PreAuthorizationFailureInput {
  marketSnapshotInput: SaveMarketSnapshotInput;
  requestedQuote: SaveRequestedQuoteInput;
  idempotency?: QuoteIdempotencyReservation;
  routePlan?: RoutePlan;
  errorCode: string;
}

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
      return (await this.createFreshQuote(validatedRequest, access)).response;
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

    let result: FreshQuoteResult;
    try {
      result = await this.createFreshQuote(validatedRequest, access, claim.reservation);
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

    if (!result.idempotencyCompleted) {
      try {
        await store.complete(claim.reservation, result.response);
      } catch {
        throw new APIError("QUOTE_STORE_UNAVAILABLE", "Quote idempotency completion unavailable", 503);
      }
    }
    return result.response;
  }

  private async createFreshQuote(
    validatedRequest: QuoteRequest,
    access: QuoteAccessContext,
    idempotency?: QuoteIdempotencyReservation,
  ): Promise<FreshQuoteResult> {
    const snapshot = await this.getUsableSnapshot(validatedRequest);
    const snapshotSource = getMarketDataSnapshotSource(snapshot);
    const marketSnapshotInput: SaveMarketSnapshotInput = {
      request: validatedRequest,
      snapshot,
      ...(snapshotSource ? { source: snapshotSource } : {}),
    };
    const identity = this.identityGenerator.next();
    const quoteId = identity.quoteId;
    const requestedQuote: SaveRequestedQuoteInput = {
      quoteId,
      principalId: access.principalId,
      snapshotId: snapshot.snapshotId,
      request: validatedRequest,
    };
    const fusedIssuance = this.deps.quoteIssuanceStore;
    if (!fusedIssuance) {
      await Promise.all([
        this.saveMarketSnapshot(marketSnapshotInput),
        this.bindIdempotencyQuote(idempotency, quoteId),
      ]);
      await this.saveRequestedQuote(requestedQuote);
    }

    let routePlan: RoutePlan;
    try {
      routePlan = fusedIssuance
        ? await selectQuoteRoute(this.deps, { request: validatedRequest, snapshot })
        : await selectAndPersistQuoteRoute(this.deps, {
            quoteId,
            principalId: access.principalId,
            request: validatedRequest,
            snapshot,
          });
    } catch (error) {
      if (fusedIssuance) {
        await this.persistPreAuthorizationFailureBestEffort({
          marketSnapshotInput,
          requestedQuote,
          idempotency,
          errorCode: quoteFailureCode(error),
        });
      }
      throw error;
    }
    let inventorySkewBps: number;
    let hedgeCostBps: number;
    try {
      const [inventorySkewResult, pairPenalties] = await Promise.all([
        this.deps.inventoryService.calculateQuoteSkewBps({
          chainId: validatedRequest.chainId,
          token: validatedRequest.tokenOut,
        }),
        this.deps.hedgeService?.quoteRiskPenaltyBps
          ? Promise.all([
              this.deps.hedgeService.quoteRiskPenaltyBps({
                chainId: validatedRequest.chainId,
                token: validatedRequest.tokenIn,
              }),
              this.deps.hedgeService.quoteRiskPenaltyBps({
                chainId: validatedRequest.chainId,
                token: validatedRequest.tokenOut,
              }),
            ])
          : Promise.resolve([]),
      ]);
      assertInventorySkewBps(inventorySkewResult);
      pairPenalties.forEach(assertHedgeRiskPenaltyBps);
      const hedgeRiskPenaltyResult = pairPenalties.length === 0 ? 0 : Math.max(...pairPenalties);
      inventorySkewBps = inventorySkewResult;
      hedgeCostBps = hedgeRiskPenaltyResult;
      assertPricingAdjustmentBps(inventorySkewBps + hedgeCostBps);
    } catch (error) {
      const failure = pricingFailure(error);
      if (fusedIssuance) {
        await this.persistPreAuthorizationFailureBestEffort({
          marketSnapshotInput,
          requestedQuote,
          idempotency,
          routePlan,
          errorCode: failure.code,
        });
      } else {
        await this.markQuoteFailedBestEffort(quoteId, failure.code);
      }
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
      if (fusedIssuance) {
        await this.persistPreAuthorizationFailureBestEffort({
          marketSnapshotInput,
          requestedQuote,
          idempotency,
          routePlan,
          errorCode: failure.code,
        });
      } else {
        await this.markQuoteFailedBestEffort(quoteId, failure.code);
      }
      throw failure;
    }
    const routeDecision: SaveRouteDecisionInput = {
      quoteId,
      principalId: access.principalId,
      snapshotId: snapshot.snapshotId,
      routePlan,
    };
    const deadline = Math.floor(Date.now() / 1000) + this.config.quoteTtlSeconds;
    let authorization;
    try {
      authorization = await authorizeQuote(this.deps, {
        request: validatedRequest,
        snapshot,
        pricing,
        quoteId,
        deadline,
        ...(fusedIssuance ? {
          preparation: {
            marketSnapshot: marketSnapshotInput,
            requestedQuote,
            routeDecision,
            ...(idempotency ? { idempotency } : {}),
          },
        } : {}),
      });
    } catch (error) {
      const failure = error instanceof APIError ? error : quoteStoreFailure(error);
      await this.markQuoteFailedBestEffort(quoteId, failure.code);
      throw failure;
    }
    const { risk, persistedRiskDecision, exposureReserved } = authorization;
    if (risk.status !== "approved") {
      if (!fusedIssuance) {
        await this.saveRejectedQuoteBestEffort({
          quoteId,
          principalId: access.principalId,
          snapshotId: snapshot.snapshotId,
          request: validatedRequest,
          rejectCode: risk.reasonCode ?? "RISK_REJECTED",
          riskPolicyVersion: risk.policyVersion,
        });
      }
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
        riskDecisionId: persistedRiskDecision.riskDecisionId,
        riskPolicyVersion: persistedRiskDecision.policyVersion,
        traceId: access.traceId ?? `tr_${quoteId}`,
      });
    } catch (error) {
      if (exposureReserved) await this.releaseQuoteExposureBestEffort(quoteId);
      await this.markQuoteFailedBestEffort(quoteId, quoteFailureCode(error));
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
    const signedQuoteInput: SaveSignedQuoteInput = {
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
    };
    try {
      if (fusedIssuance) {
        await fusedIssuance.finalize({
          signedQuote: signedQuoteInput,
          response,
          ...(idempotency ? { idempotency } : {}),
        });
      } else {
        await this.saveSignedQuote(signedQuoteInput);
      }
    } catch (error) {
      if (exposureReserved) await this.releaseQuoteExposureBestEffort(quoteId);
      throw quoteStoreFailure(error);
    }

    return {
      response,
      idempotencyCompleted: fusedIssuance !== undefined && idempotency !== undefined,
    };
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

  private async bindIdempotencyQuote(
    reservation: QuoteIdempotencyReservation | undefined,
    quoteId: string,
  ): Promise<void> {
    if (!reservation) return;
    try {
      await this.deps.quoteIdempotencyStore?.bindQuote(reservation, quoteId);
    } catch {
      throw new APIError("QUOTE_STORE_UNAVAILABLE", "Quote idempotency binding unavailable", 503);
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

  private async persistPreAuthorizationFailureBestEffort(
    input: PreAuthorizationFailureInput,
  ): Promise<void> {
    try {
      await Promise.all([
        this.saveMarketSnapshot(input.marketSnapshotInput),
        this.bindIdempotencyQuote(input.idempotency, input.requestedQuote.quoteId),
      ]);
      await this.saveRequestedQuote(input.requestedQuote);
      if (input.routePlan) {
        await this.deps.quoteRepository.saveRouteDecision({
          quoteId: input.requestedQuote.quoteId,
          principalId: input.requestedQuote.principalId,
          snapshotId: input.requestedQuote.snapshotId,
          routePlan: input.routePlan,
        });
      }
      await this.markStoredQuoteFailed(input.requestedQuote.quoteId, input.errorCode);
    } catch {
      // The original dependency error remains authoritative; reconciliation handles partial audit state.
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
      const hotStatus = await this.deps.quoteIssuanceStore?.findHotStatus?.(quoteId, principalId);
      if (hotStatus) return hotStatus;
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
    const principalId = options.principalId ?? localPrincipalId;
    try {
      await this.deps.quoteIssuanceStore?.awaitSignedQuoteProjection?.(quote, principalId);
    } catch (error) {
      throw quoteStoreFailure(error);
    }
    return requireSubmittableQuote(
      this.deps,
      quote,
      signature,
      options,
      this.markQuoteExpiredBestEffort.bind(this),
    );
  }
}
