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
import { APIError } from "../../shared/errors/api-error.js";
import { validateQuoteRequest } from "../../shared/validation/quote-request.js";
import { validateSubmitQuoteRequest } from "../../shared/validation/submit-request.js";
import type { InventoryService } from "../inventory/inventory.service.js";
import {
  defaultMaxSnapshotFutureSkewMs,
  getMarketSnapshotIssue,
  type MarketDataService,
} from "../market-data/market-data.service.js";
import type { MarketSnapshotStore, SaveMarketSnapshotInput } from "../market-data/market-snapshot.repository.js";
import type { PricingEngine, PricingResult } from "../pricing/pricing.engine.js";
import type { HedgeIntentService } from "../hedge/hedge.service.js";
import type {
  QuoteRepository,
  QuoteRecord,
  QuoteStatusMetadata,
  SaveRejectedQuoteInput,
  SaveRequestedQuoteInput,
  SaveSignedQuoteInput,
} from "./quote.repository.js";
import type { RiskDecision, RiskEngine, RiskInput } from "../risk/risk.engine.js";
import type { RiskDecisionStore, SaveRiskDecisionInput } from "../risk/risk-decision.repository.js";
import type { RoutePlan, RoutingEngine } from "../routing/routing.engine.js";
import type { SignerService } from "../signer/signer.service.js";
import { QuoteIdentityGenerator } from "./quote-identity.js";

export interface QuoteServiceDeps {
  inventoryService: InventoryService;
  marketDataService: MarketDataService;
  marketSnapshotStore: MarketSnapshotStore;
  pricingEngine: PricingEngine;
  hedgeService?: HedgeIntentService;
  quoteRepository: QuoteRepository;
  riskDecisionStore: RiskDecisionStore;
  riskEngine: RiskEngine;
  routingEngine: RoutingEngine;
  signerService: SignerService;
}

export interface QuoteServiceConfig {
  maxSnapshotAgeMs: number;
  maxSnapshotFutureSkewMs: number;
  quoteTtlSeconds: number;
}

export const defaultQuoteServiceConfig: QuoteServiceConfig = {
  maxSnapshotAgeMs: 5_000,
  maxSnapshotFutureSkewMs: defaultMaxSnapshotFutureSkewMs,
  quoteTtlSeconds: 30,
};

export class QuoteService {
  private readonly identityGenerator = new QuoteIdentityGenerator();
  private readonly deps: QuoteServiceDeps;
  private readonly config: QuoteServiceConfig;

  constructor(
    deps: QuoteServiceDeps,
    config: QuoteServiceConfig = defaultQuoteServiceConfig,
  ) {
    assertPositiveSafeInteger(config.maxSnapshotAgeMs, "maxSnapshotAgeMs");
    assertPositiveSafeInteger(config.maxSnapshotFutureSkewMs, "maxSnapshotFutureSkewMs");
    assertPositiveSafeInteger(config.quoteTtlSeconds, "quoteTtlSeconds");
    assertQuoteServiceDeps(deps);
    this.deps = cloneQuoteServiceDeps(deps);
    this.config = cloneQuoteServiceConfig(config);
  }

  async createQuote(request: QuoteRequest): Promise<QuoteResponse> {
    const validatedRequest = validateQuoteRequest(request);
    const snapshot = await this.getUsableSnapshot(validatedRequest);
    await this.saveMarketSnapshot({
      request: validatedRequest,
      snapshot,
    });

    const identity = this.identityGenerator.next();
    const quoteId = identity.quoteId;
    await this.saveRequestedQuote({
      quoteId,
      snapshotId: snapshot.snapshotId,
      request: validatedRequest,
    });

    let routePlan: RoutePlan;
    try {
      routePlan = await this.deps.routingEngine.selectRoute({ request: validatedRequest, snapshot });
    } catch (error) {
      const failure = routingFailure(error);
      await this.markQuoteFailedBestEffort(quoteId, failure.code);
      throw failure;
    }
    const inventorySkewBps = this.deps.inventoryService.calculateQuoteSkewBps({
      chainId: validatedRequest.chainId,
      token: validatedRequest.tokenOut,
    });
    const hedgeRiskPenaltyBps = this.deps.hedgeService?.quoteRiskPenaltyBps?.({
      chainId: validatedRequest.chainId,
      token: validatedRequest.tokenOut,
    }) ?? 0;

    let pricing: PricingResult;
    try {
      pricing = await this.deps.pricingEngine.price({
        request: validatedRequest,
        snapshot,
        routePlan,
        inventorySkewBps: inventorySkewBps + hedgeRiskPenaltyBps,
      });
    } catch (error) {
      const failure = pricingFailure(error);
      await this.markQuoteFailedBestEffort(quoteId, failure.code);
      throw failure;
    }
    const inventoryProjection = this.deps.inventoryService.projectSettlement({
      chainId: validatedRequest.chainId,
      tokenIn: validatedRequest.tokenIn,
      tokenOut: validatedRequest.tokenOut,
      amountIn: validatedRequest.amountIn,
      amountOut: pricing.amountOut,
    });

    const risk = await this.evaluateRisk({ request: validatedRequest, pricing, inventoryProjection });
    try {
      await this.saveRiskDecision({
        quoteId,
        decision: risk,
      });
    } catch (error) {
      await this.markQuoteFailedBestEffort(quoteId, quoteFailureCode(error));
      throw error;
    }
    if (risk.status !== "approved") {
      await this.saveRejectedQuoteBestEffort({
        quoteId,
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

    const deadline = Math.floor(Date.now() / 1000) + this.config.quoteTtlSeconds;
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
      await this.markQuoteFailedBestEffort(quoteId, quoteFailureCode(error));
      throw error;
    }

    await this.saveSignedQuote({
      quoteId,
      snapshotId: snapshot.snapshotId,
      slippageBps: validatedRequest.slippageBps,
      quote: signedQuote,
      pricingVersion: pricing.pricingVersion,
      spreadBps: pricing.spreadBps,
      sizeImpactBps: pricing.sizeImpactBps,
      inventorySkewBps: pricing.inventorySkewBps,
      riskPolicyVersion: risk.policyVersion,
      signature,
    });

    return {
      quoteId,
      snapshotId: snapshot.snapshotId,
      amountOut: pricing.amountOut,
      minAmountOut: pricing.minAmountOut,
      deadline,
      nonce: identity.nonce,
      signature,
    };
  }

  async getQuoteStatus(quoteId: string): Promise<QuoteStatusResponse | undefined> {
    const status = await this.findQuoteStatus(quoteId);
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

  private async findQuoteStatus(quoteId: string): Promise<QuoteStatusResponse | undefined> {
    try {
      return await this.deps.quoteRepository.findStatus(quoteId);
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
    } catch {
      // Preserve the read or submit response; reconciliation can recover stale signed quotes later.
    }
  }

  private async findSignedQuoteByChainUserNonce(
    chainId: number,
    user: Address,
    nonce: UIntString,
  ): Promise<QuoteRecord | undefined> {
    try {
      return await this.deps.quoteRepository.findSignedQuoteByChainUserNonce(chainId, user, nonce);
    } catch (error) {
      throw quoteStoreFailure(error);
    }
  }

  private async evaluateRisk(input: RiskInput): Promise<RiskDecision> {
    try {
      return await this.deps.riskEngine.evaluate(input);
    } catch {
      return {
        status: "rejected",
        reasonCode: "RISK_ENGINE_UNAVAILABLE",
        policyVersion: "risk-engine-unavailable",
      };
    }
  }

  async markQuoteStatus(quoteId: string, status: QuoteLifecycleStatus, metadata?: QuoteStatusMetadata): Promise<void> {
    await this.markStoredQuoteStatus(quoteId, status, metadata);
  }

  async markQuoteFailed(quoteId: string, errorCode: string): Promise<void> {
    await this.markStoredQuoteFailed(quoteId, errorCode);
  }

  async requireSubmittableSignedQuote(quote: SignedQuote, signature: `0x${string}`): Promise<string> {
    const validatedSubmitRequest = validateSubmitQuoteRequest({ quote, signature }, { allowExpired: true });
    const validatedQuote = validatedSubmitRequest.quote;
    const record = await this.findSignedQuoteByChainUserNonce(
      validatedQuote.chainId,
      validatedQuote.user,
      validatedQuote.nonce,
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
    if (record.status === "expired") {
      throw new APIError("QUOTE_EXPIRED", "Quote expired", 409);
    }
    if (record.deadline && record.deadline < Math.floor(Date.now() / 1000)) {
      await this.markQuoteExpiredBestEffort(record.quoteId);
      throw new APIError("QUOTE_EXPIRED", "Quote expired", 409);
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

function quoteFailureCode(error: unknown): string {
  if (error instanceof APIError) {
    return error.code;
  }

  return "INTERNAL_ERROR";
}

function marketDataFailure(error: unknown): APIError {
  if (error instanceof APIError) {
    return error;
  }

  return new APIError("MARKET_DATA_UNAVAILABLE", "Market data unavailable", 503);
}

function quoteStoreFailure(error: unknown): APIError {
  if (error instanceof APIError) {
    return error;
  }

  return new APIError("QUOTE_STORE_UNAVAILABLE", "Quote store unavailable", 503);
}

function pricingFailure(error: unknown): APIError {
  if (error instanceof APIError) {
    return error;
  }

  return new APIError("PRICING_UNAVAILABLE", "Pricing engine unavailable", 503);
}

function routingFailure(error: unknown): APIError {
  if (error instanceof APIError) {
    return error;
  }

  return new APIError("ROUTING_UNAVAILABLE", "Routing engine unavailable", 503);
}

function assertUsableSnapshot(
  snapshot: MarketSnapshot,
  maxSnapshotAgeMs: number,
  maxSnapshotFutureSkewMs: number,
): void {
  const issue = getMarketSnapshotIssue(snapshot, maxSnapshotAgeMs, maxSnapshotFutureSkewMs);
  if (issue) {
    throw new APIError("MARKET_DATA_UNAVAILABLE", `Market data ${issue}`, 503);
  }
}

function cloneQuoteServiceConfig(config: QuoteServiceConfig): QuoteServiceConfig {
  return { ...config };
}

function cloneQuoteServiceDeps(deps: QuoteServiceDeps): QuoteServiceDeps {
  return { ...deps };
}

function assertQuoteServiceDeps(deps: QuoteServiceDeps): void {
  if (typeof deps !== "object" || deps === null) {
    throw new Error("Quote service deps must be an object");
  }

  assertDependencyMethod(deps.marketDataService, "marketDataService", "getSnapshot");
  assertDependencyMethod(deps.marketSnapshotStore, "marketSnapshotStore", "saveSnapshot");
  assertDependencyMethod(deps.routingEngine, "routingEngine", "selectRoute");
  assertDependencyMethod(deps.pricingEngine, "pricingEngine", "price");
  assertDependencyMethod(deps.inventoryService, "inventoryService", "calculateQuoteSkewBps");
  assertDependencyMethod(deps.inventoryService, "inventoryService", "projectSettlement");
  assertOptionalDependencyMethod(deps.hedgeService, "hedgeService", "quoteRiskPenaltyBps");
  assertDependencyMethod(deps.riskEngine, "riskEngine", "evaluate");
  assertDependencyMethod(deps.riskDecisionStore, "riskDecisionStore", "saveDecision");
  assertDependencyMethod(deps.signerService, "signerService", "signQuote");
  assertDependencyMethod(deps.signerService, "signerService", "verifyQuoteSignature");
  assertDependencyMethod(deps.quoteRepository, "quoteRepository", "saveRequested");
  assertDependencyMethod(deps.quoteRepository, "quoteRepository", "saveRejected");
  assertDependencyMethod(deps.quoteRepository, "quoteRepository", "saveSigned");
  assertDependencyMethod(deps.quoteRepository, "quoteRepository", "findStatus");
  assertDependencyMethod(deps.quoteRepository, "quoteRepository", "markStatus");
  assertDependencyMethod(deps.quoteRepository, "quoteRepository", "markFailed");
  assertDependencyMethod(deps.quoteRepository, "quoteRepository", "findSignedQuoteByChainUserNonce");
}

function assertDependencyMethod(
  dependency: unknown,
  dependencyName: keyof QuoteServiceDeps,
  methodName: string,
): void {
  const method = typeof dependency === "object" && dependency !== null
    ? (dependency as Record<string, unknown>)[methodName]
    : undefined;
  if (typeof method !== "function") {
    throw new Error(`Quote service ${dependencyName}.${methodName} must be a function`);
  }
}

function assertOptionalDependencyMethod(
  dependency: unknown,
  dependencyName: keyof QuoteServiceDeps,
  methodName: string,
): void {
  if (dependency === undefined) {
    return;
  }
  if (typeof dependency !== "object" || dependency === null) {
    throw new Error(`Quote service ${dependencyName} must be an object when provided`);
  }

  const method = (dependency as Record<string, unknown>)[methodName];
  if (method !== undefined && typeof method !== "function") {
    throw new Error(`Quote service ${dependencyName}.${methodName} must be a function when provided`);
  }
}

function assertPositiveSafeInteger(value: number, field: keyof QuoteServiceConfig): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Quote service ${field} must be a positive safe integer`);
  }
}

function isExactSignedQuote(
  record: {
    chainId: number;
    user: string;
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
    amountOut?: string;
    minAmountOut?: string;
    nonce?: string;
    deadline?: number;
  },
  quote: SignedQuote,
): boolean {
  return (
    record.chainId === quote.chainId &&
    record.user.toLowerCase() === quote.user.toLowerCase() &&
    record.tokenIn.toLowerCase() === quote.tokenIn.toLowerCase() &&
    record.tokenOut.toLowerCase() === quote.tokenOut.toLowerCase() &&
    record.amountIn === quote.amountIn &&
    record.amountOut === quote.amountOut &&
    record.minAmountOut === quote.minAmountOut &&
    record.nonce === quote.nonce &&
    record.deadline === quote.deadline
  );
}
