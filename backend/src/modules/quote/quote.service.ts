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
import type { InventoryProjection, IInventoryService } from "../inventory/inventory.service.js";
import {
  defaultMaxSnapshotFutureSkewMs,
  getMarketDataSnapshotSource,
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
import type { RiskDecision, RiskEngine, RiskInput, RiskRejectReasonCode } from "../risk/risk.engine.js";
import type { RiskDecisionStore, SaveRiskDecisionInput } from "../risk/risk-decision.repository.js";
import type {
  QuoteExposureReservationResult,
  QuoteExposureStore,
} from "../risk/quote-exposure.store.js";
import type { RoutePlan, RoutingEngine } from "../routing/routing.engine.js";
import type { SignerService } from "../signer/signer.service.js";
import { QuoteIdentityGenerator } from "./quote-identity.js";

export interface QuoteServiceDeps {
  inventoryService: IInventoryService;
  marketDataService: MarketDataService;
  marketSnapshotStore: MarketSnapshotStore;
  pricingEngine: PricingEngine;
  hedgeService?: HedgeIntentService;
  quoteRepository: QuoteRepository;
  quoteExposureStore?: QuoteExposureStore;
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

const quoteServiceConfigFields = ["maxSnapshotAgeMs", "maxSnapshotFutureSkewMs", "quoteTtlSeconds"] as const;
const quoteServiceDepsFields = [
  "inventoryService",
  "marketDataService",
  "marketSnapshotStore",
  "pricingEngine",
  "quoteRepository",
  "riskDecisionStore",
  "riskEngine",
  "routingEngine",
  "signerService",
] as const;
const routePlanFields = ["routeId", "venue", "tokenIn", "tokenOut", "expectedLiquidityUsd"] as const;
const inventoryProjectionFields = ["tokenIn", "tokenOut"] as const;
const inventoryPositionFields = ["chainId", "token", "balance"] as const;
const pricingResultFields = [
  "amountOut",
  "minAmountOut",
  "spreadBps",
  "sizeImpactBps",
  "inventorySkewBps",
  "volatilityPremiumBps",
  "hedgeCostBps",
  "pricingVersion",
] as const;
const riskDecisionBaseFields = ["status", "policyVersion"] as const;
const rejectedRiskDecisionFields = ["reasonCode"] as const;
const rejectedRiskDecisionFullFields = ["status", "policyVersion", "reasonCode"] as const;
const riskRejectReasonCodes = new Set<string>([
  "CHAIN_NOT_ENABLED",
  "TOKEN_NOT_ALLOWED",
  "MARKET_LIQUIDITY_TOO_LOW",
  "MARKET_VOLATILITY_LIMIT_EXCEEDED",
  "AMOUNT_IN_LIMIT_EXCEEDED",
  "AMOUNT_OUT_TOO_SMALL",
  "QUOTE_NOTIONAL_LIMIT_EXCEEDED",
  "USER_OPEN_NOTIONAL_LIMIT_EXCEEDED",
  "PAIR_OPEN_NOTIONAL_LIMIT_EXCEEDED",
  "USD_REFERENCE_REQUIRED",
  "SLIPPAGE_TOO_WIDE",
  "QUOTED_SPREAD_TOO_WIDE",
  "TOXIC_FLOW_RESTRICTED_USER",
  "TOXIC_FLOW_SCORE_EXCEEDED",
  "TOKEN_IN_INVENTORY_LIMIT_EXCEEDED",
  "TOKEN_OUT_INVENTORY_LIMIT_EXCEEDED",
  "RISK_ENGINE_UNAVAILABLE",
]);
const positiveUIntStringPattern = /^[1-9][0-9]*$/;
const safeIdentifierPattern = /^[A-Za-z0-9_:-]+$/;
const maxSafeIdentifierLength = 128;
const maxBps = 10_000;

export class QuoteService {
  private readonly identityGenerator = new QuoteIdentityGenerator();
  private readonly deps: QuoteServiceDeps;
  private readonly config: QuoteServiceConfig;

  constructor(
    deps: QuoteServiceDeps,
    config: QuoteServiceConfig = defaultQuoteServiceConfig,
  ) {
    assertRecord(config, "config");
    assertOwnFields(config, quoteServiceConfigFields, "config");
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
    const snapshotSource = getMarketDataSnapshotSource(snapshot);
    await this.saveMarketSnapshot({
      request: validatedRequest,
      snapshot,
      ...(snapshotSource ? { source: snapshotSource } : {}),
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
      const hedgeRiskPenaltyResult = this.deps.hedgeService?.quoteRiskPenaltyBps
        ? await this.deps.hedgeService.quoteRiskPenaltyBps({
            chainId: validatedRequest.chainId,
            token: validatedRequest.tokenOut,
          })
        : 0;
      assertHedgeRiskPenaltyBps(hedgeRiskPenaltyResult);
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
        const exposure = await this.deps.quoteExposureStore.reserve({
          quoteId,
          request: validatedRequest,
          pricing,
          deadline,
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
        snapshotId: snapshot.snapshotId,
        slippageBps: validatedRequest.slippageBps,
        quote: signedQuote,
        pricingVersion: pricing.pricingVersion,
        spreadBps: pricing.spreadBps,
        sizeImpactBps: pricing.sizeImpactBps,
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

  private async releaseQuoteExposureBestEffort(quoteId: string): Promise<void> {
    try {
      await this.deps.quoteExposureStore?.release(quoteId);
    } catch {
      // The reservation is deadline-bound and will stop counting even when release fails.
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
      await this.releaseQuoteExposureBestEffort(quoteId);
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
    options: { allowExpired?: boolean } = {},
  ): Promise<string> {
    if (typeof options !== "object" || options === null || Array.isArray(options)) {
      throw new APIError("INVALID_REQUEST", "Submit quote lookup options must be an object", 400);
    }
    const unknownOption = Object.keys(options).find((field) => field !== "allowExpired");
    if (unknownOption) {
      throw new APIError("INVALID_REQUEST", `Submit quote lookup options contain unknown field ${unknownOption}`, 400);
    }
    if ("allowExpired" in options && !Object.prototype.hasOwnProperty.call(options, "allowExpired")) {
      throw new APIError("INVALID_REQUEST", "Submit quote lookup allowExpired must be an own field", 400);
    }
    if (options.allowExpired !== undefined && typeof options.allowExpired !== "boolean") {
      throw new APIError("INVALID_REQUEST", "Submit quote lookup allowExpired must be a boolean", 400);
    }
    const allowExpired = options.allowExpired ?? false;
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
  assertRecord(deps, "deps");
  assertOwnFields(deps, quoteServiceDepsFields, "deps");
  assertOptionalOwnField(deps, "hedgeService", "deps");
  assertOptionalOwnField(deps, "quoteExposureStore", "deps");
  assertDependencyMethod(deps.marketDataService, "marketDataService", "getSnapshot");
  assertDependencyMethod(deps.marketSnapshotStore, "marketSnapshotStore", "saveSnapshot");
  assertDependencyMethod(deps.routingEngine, "routingEngine", "selectRoute");
  assertDependencyMethod(deps.pricingEngine, "pricingEngine", "price");
  assertDependencyMethod(deps.inventoryService, "inventoryService", "calculateQuoteSkewBps");
  assertDependencyMethod(deps.inventoryService, "inventoryService", "projectSettlement");
  assertOptionalDependencyMethod(deps.hedgeService, "hedgeService", "quoteRiskPenaltyBps");
  if (deps.quoteExposureStore !== undefined) {
    assertDependencyMethod(deps.quoteExposureStore, "quoteExposureStore", "reserve");
    assertDependencyMethod(deps.quoteExposureStore, "quoteExposureStore", "release");
  }
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
  assertRecord(dependency, dependencyName);
  const method = (dependency as Record<string, unknown>)[methodName];
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
  if (!isRecord(dependency)) {
    throw new Error(`Quote service ${dependencyName} must be an object when provided`);
  }

  const method = (dependency as Record<string, unknown>)[methodName];
  if (method !== undefined && typeof method !== "function") {
    throw new Error(`Quote service ${dependencyName}.${methodName} must be a function when provided`);
  }
}

function assertRecord(value: unknown, field: "config" | "deps" | keyof QuoteServiceDeps): void {
  if (!isRecord(value)) {
    throw new Error(`Quote service ${field} must be an object`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertOwnFields(value: object, fields: readonly string[], path: string): void {
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      throw new Error(`Quote service ${path}.${field} must be an own field`);
    }
  }
}

function assertOptionalOwnField(value: object, field: string, path: string): void {
  if (field in value && !Object.prototype.hasOwnProperty.call(value, field)) {
    throw new Error(`Quote service ${path}.${field} must be an own field when provided`);
  }
}

function assertPositiveSafeInteger(value: number, field: keyof QuoteServiceConfig): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Quote service ${field} must be a positive safe integer`);
  }
}

function assertRoutePlan(value: unknown, request: QuoteRequest): asserts value is RoutePlan {
  if (!isRecord(value)) {
    throw new Error("Quote service route plan must be an object");
  }

  assertOwnFields(value, routePlanFields, "route plan");
  assertNoUnknownFields(value, routePlanFields, "route plan");
  assertRouteSafeIdentifier(value.routeId);
  if (value.venue !== "internal_inventory") {
    throw new Error("Quote service route plan.venue must be internal_inventory");
  }

  const tokenIn = value.tokenIn;
  const tokenOut = value.tokenOut;
  assertRouteAddress(tokenIn, "tokenIn");
  assertRouteAddress(tokenOut, "tokenOut");
  if (
    tokenIn.toLowerCase() !== request.tokenIn.toLowerCase() ||
    tokenOut.toLowerCase() !== request.tokenOut.toLowerCase()
  ) {
    throw new Error("Quote service route plan token pair must match quote request token pair");
  }

  assertRouteExpectedLiquidity(value.expectedLiquidityUsd);
}

function assertRouteSafeIdentifier(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > maxSafeIdentifierLength ||
    !safeIdentifierPattern.test(value)
  ) {
    throw new Error("Quote service route plan.routeId must be a safe identifier");
  }
}

function assertRouteAddress(value: unknown, field: "tokenIn" | "tokenOut"): asserts value is Address {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`Quote service route plan.${field} must be a 20-byte hex address`);
  }
}

function assertRouteExpectedLiquidity(value: unknown): asserts value is UIntString {
  if (typeof value !== "string" || !positiveUIntStringPattern.test(value)) {
    throw new Error("Quote service route plan.expectedLiquidityUsd must be a positive uint string");
  }
}

function assertInventorySkewBps(value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || Math.abs(value) > maxBps) {
    throw new Error("Quote service inventory skew bps must be a safe bps integer");
  }
}

function assertHedgeRiskPenaltyBps(value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > maxBps) {
    throw new Error("Quote service hedge risk penalty bps must be a non-negative bps integer");
  }
}

function assertPricingAdjustmentBps(value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || Math.abs(value) > maxBps) {
    throw new Error("Quote service pricing adjustment bps must be a safe bps integer");
  }
}

function assertInventoryProjection(value: unknown, request: QuoteRequest): asserts value is InventoryProjection {
  if (!isRecord(value)) {
    throw new Error("Quote service inventory projection must be an object");
  }

  assertOwnFields(value, inventoryProjectionFields, "inventory projection");
  assertNoUnknownFields(value, inventoryProjectionFields, "inventory projection");
  assertInventoryProjectionPosition(value.tokenIn, request.chainId, request.tokenIn, "tokenIn");
  assertInventoryProjectionPosition(value.tokenOut, request.chainId, request.tokenOut, "tokenOut");
}

function assertInventoryProjectionPosition(
  value: unknown,
  expectedChainId: number,
  expectedToken: Address,
  field: "tokenIn" | "tokenOut",
): asserts value is InventoryProjection["tokenIn"] {
  if (!isRecord(value)) {
    throw new Error(`Quote service inventory projection.${field} must be an object`);
  }

  assertOwnFields(value, inventoryPositionFields, `inventory projection.${field}`);
  assertNoUnknownFields(value, inventoryPositionFields, `inventory projection.${field}`);
  const chainId = value.chainId;
  const token = value.token;
  const balance = value.balance;
  if (typeof chainId !== "number" || !Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new Error(`Quote service inventory projection.${field}.chainId must be a positive safe integer`);
  }
  assertInventoryProjectionAddress(token, field);
  if (chainId !== expectedChainId || token.toLowerCase() !== expectedToken.toLowerCase()) {
    throw new Error(`Quote service inventory projection.${field} must match quote request ${field}`);
  }
  if (typeof balance !== "bigint") {
    throw new Error(`Quote service inventory projection.${field}.balance must be a bigint`);
  }
}

function assertInventoryProjectionAddress(value: unknown, field: "tokenIn" | "tokenOut"): asserts value is Address {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`Quote service inventory projection.${field}.token must be a 20-byte hex address`);
  }
}

function assertPricingResult(value: unknown): asserts value is PricingResult {
  if (!isRecord(value)) {
    throw new Error("Quote service pricing result must be an object");
  }

  assertOwnFields(value, pricingResultFields, "pricing result");
  assertNoUnknownFields(value, pricingResultFields, "pricing result");
  const amountOut = value.amountOut;
  const minAmountOut = value.minAmountOut;
  assertPricingUIntString(amountOut, "amountOut");
  assertPricingUIntString(minAmountOut, "minAmountOut");

  if (BigInt(amountOut) < BigInt(minAmountOut)) {
    throw new Error(
      "Quote service pricing result.amountOut must be greater than or equal to pricing result.minAmountOut",
    );
  }

  assertNonNegativeBpsInteger(value.spreadBps, "spreadBps");
  assertNonNegativeBpsInteger(value.sizeImpactBps, "sizeImpactBps");
  assertBpsMagnitudeInteger(value.inventorySkewBps, "inventorySkewBps");
  assertNonNegativeBpsInteger(value.volatilityPremiumBps, "volatilityPremiumBps");
  assertNonNegativeBpsInteger(value.hedgeCostBps, "hedgeCostBps");
  assertPricingSafeIdentifier(value.pricingVersion);
}

function assertQuoteExposureReservationResult(
  value: unknown,
): asserts value is QuoteExposureReservationResult {
  if (!isRecord(value)) {
    throw new Error("Quote service exposure reservation result must be an object");
  }
  if (value.status === "reserved") {
    assertOwnFields(value, ["status", "notionalUsdE18"], "exposure reservation result");
    assertNoUnknownFields(value, ["status", "notionalUsdE18"], "exposure reservation result");
    if (typeof value.notionalUsdE18 !== "string" || !positiveUIntStringPattern.test(value.notionalUsdE18)) {
      throw new Error("Quote service exposure reservation notionalUsdE18 must be a positive uint string");
    }
    return;
  }
  if (value.status === "rejected") {
    assertOwnFields(value, ["status", "reasonCode"], "exposure reservation result");
    assertNoUnknownFields(value, ["status", "reasonCode"], "exposure reservation result");
    if (
      value.reasonCode !== "USER_OPEN_NOTIONAL_LIMIT_EXCEEDED" &&
      value.reasonCode !== "PAIR_OPEN_NOTIONAL_LIMIT_EXCEEDED"
    ) {
      throw new Error("Quote service exposure reservation reasonCode is invalid");
    }
    return;
  }
  throw new Error("Quote service exposure reservation status is invalid");
}

function assertNoUnknownFields(value: object, fields: readonly string[], path: string): void {
  for (const field of Object.keys(value)) {
    if (!fields.includes(field)) {
      throw new Error(`Quote service ${path} must not include unknown field ${field}`);
    }
  }
}

function assertPricingUIntString(value: unknown, field: "amountOut" | "minAmountOut"): asserts value is UIntString {
  if (typeof value !== "string" || !positiveUIntStringPattern.test(value)) {
    throw new Error(`Quote service pricing result.${field} must be a positive uint string`);
  }
}

function assertNonNegativeBpsInteger(
  value: unknown,
  field: "spreadBps" | "sizeImpactBps" | "volatilityPremiumBps" | "hedgeCostBps",
): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > maxBps) {
    throw new Error(`Quote service pricing result.${field} must be a non-negative bps integer`);
  }
}

function assertBpsMagnitudeInteger(value: unknown, field: "inventorySkewBps"): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || Math.abs(value) > maxBps) {
    throw new Error(`Quote service pricing result.${field} must be a safe bps integer`);
  }
}

function assertPricingSafeIdentifier(value: unknown): void {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > maxSafeIdentifierLength ||
    !safeIdentifierPattern.test(value)
  ) {
    throw new Error("Quote service pricing result.pricingVersion must be a safe identifier");
  }
}

function assertRiskDecision(value: unknown): asserts value is RiskDecision {
  if (!isRecord(value)) {
    throw new Error("Quote service risk decision must be an object");
  }

  assertOwnFields(value, riskDecisionBaseFields, "risk decision");
  assertOptionalOwnField(value, "reasonCode", "risk decision");
  const status = value.status;
  if (status !== "approved" && status !== "rejected") {
    throw new Error("Quote service risk decision.status must be approved or rejected");
  }
  assertRiskPolicyVersion(value.policyVersion);

  if (status === "approved") {
    assertNoUnknownFields(value, riskDecisionBaseFields, "risk decision");
    return;
  }

  assertOwnFields(value, rejectedRiskDecisionFields, "risk decision");
  assertNoUnknownFields(value, rejectedRiskDecisionFullFields, "risk decision");
  assertRiskRejectReasonCode(value.reasonCode);
}

function assertRiskPolicyVersion(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("Quote service risk decision.policyVersion must be a non-empty string");
  }
}

function assertRiskRejectReasonCode(value: unknown): asserts value is RiskRejectReasonCode {
  if (typeof value !== "string" || !riskRejectReasonCodes.has(value)) {
    throw new Error("Quote service risk decision.reasonCode must be a stable risk reject reason");
  }
}

function riskUnavailableDecision(): RiskDecision {
  return {
    status: "rejected",
    reasonCode: "RISK_ENGINE_UNAVAILABLE",
    policyVersion: "risk-engine-unavailable",
  };
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
