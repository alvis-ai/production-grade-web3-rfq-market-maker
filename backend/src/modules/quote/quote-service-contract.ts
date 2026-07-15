import { assertPrincipalId, localPrincipalId } from "../../shared/validation/principal-id.js";
import type { IInventoryService } from "../inventory/inventory.service.js";
import {
  defaultMaxSnapshotFutureSkewMs,
  type MarketDataService,
} from "../market-data/market-data.service.js";
import type { MarketSnapshotStore } from "../market-data/market-snapshot.repository.js";
import type { HedgeIntentService } from "../hedge/hedge.service.js";
import type { PricingEngine } from "../pricing/pricing.engine.js";
import type { RiskDecisionStore } from "../risk/risk-decision.repository.js";
import type { QuoteExposureStore } from "../risk/quote-exposure.store.js";
import type { RiskEngine } from "../risk/risk.engine.js";
import type { SettlementIndexerRiskGuard } from "../risk/settlement-indexer-risk.guard.js";
import type { TreasuryLiquidityProvider } from "../risk/treasury-liquidity.provider.js";
import type { RoutingEngine } from "../routing/routing.engine.js";
import type { SignerService } from "../signer/signer.service.js";
import type { QuoteRepository } from "./quote.repository.js";
import type { QuoteIdempotencyStore } from "./quote-idempotency.store.js";

export interface QuoteServiceDeps {
  inventoryService: IInventoryService;
  marketDataService: MarketDataService;
  marketSnapshotStore: MarketSnapshotStore;
  pricingEngine: PricingEngine;
  hedgeService?: HedgeIntentService;
  quoteIdempotencyStore?: QuoteIdempotencyStore;
  quoteRepository: QuoteRepository;
  quoteExposureStore?: QuoteExposureStore;
  treasuryLiquidityProvider?: TreasuryLiquidityProvider;
  riskDecisionStore: RiskDecisionStore;
  riskEngine: RiskEngine;
  routingEngine: RoutingEngine;
  settlementIndexerRiskGuard?: SettlementIndexerRiskGuard;
  signerService: SignerService;
}

export interface QuoteServiceConfig {
  maxSnapshotAgeMs: number;
  maxSnapshotFutureSkewMs: number;
  quoteTtlSeconds: number;
}

export interface QuoteAccessContext {
  principalId: string;
  idempotencyKey?: string;
  traceId?: string;
}

export interface SubmittableQuoteOptions {
  allowExpired?: boolean;
  principalId?: string;
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
const quoteAccessContextFields = ["principalId"] as const;
const quoteAccessContextOptionalFields = ["idempotencyKey", "traceId"] as const;
const traceIdPattern = /^tr_[A-Za-z0-9._:-]+$/;

export function normalizeQuoteServiceConfig(config: QuoteServiceConfig): QuoteServiceConfig {
  assertRecord(config, "config");
  assertOwnFields(config, quoteServiceConfigFields, "config");
  assertPositiveSafeInteger(config.maxSnapshotAgeMs, "maxSnapshotAgeMs");
  assertPositiveSafeInteger(config.maxSnapshotFutureSkewMs, "maxSnapshotFutureSkewMs");
  assertPositiveSafeInteger(config.quoteTtlSeconds, "quoteTtlSeconds");
  return { ...config };
}

export function normalizeQuoteServiceDeps(deps: QuoteServiceDeps): QuoteServiceDeps {
  assertQuoteServiceDeps(deps);
  return { ...deps };
}

export function normalizeQuoteAccessContext(context: QuoteAccessContext | undefined): QuoteAccessContext {
  const value = context ?? { principalId: localPrincipalId };
  assertRecord(value, "access context");
  assertOwnFields(value, quoteAccessContextFields, "access context");
  assertOptionalOwnField(value, "idempotencyKey", "access context");
  assertOptionalOwnField(value, "traceId", "access context");
  const allowedFields = new Set<string>([...quoteAccessContextFields, ...quoteAccessContextOptionalFields]);
  const unknownField = Object.keys(value).find((field) => !allowedFields.has(field));
  if (unknownField) throw new Error(`Quote service access context contains unknown field ${unknownField}`);
  assertPrincipalId(value.principalId, "Quote service access context.principalId");
  if (value.idempotencyKey !== undefined && typeof value.idempotencyKey !== "string") {
    throw new Error("Quote service access context.idempotencyKey must be a string when provided");
  }
  if (value.traceId !== undefined &&
      (typeof value.traceId !== "string" || value.traceId.length > 128 || !traceIdPattern.test(value.traceId))) {
    throw new Error("Quote service access context.traceId must be a safe trace identifier when provided");
  }
  return {
    principalId: value.principalId,
    ...(value.idempotencyKey === undefined ? {} : { idempotencyKey: value.idempotencyKey }),
    ...(value.traceId === undefined ? {} : { traceId: value.traceId }),
  };
}

function assertQuoteServiceDeps(deps: QuoteServiceDeps): void {
  assertRecord(deps, "deps");
  assertOwnFields(deps, quoteServiceDepsFields, "deps");
  assertOptionalOwnField(deps, "hedgeService", "deps");
  assertOptionalOwnField(deps, "quoteIdempotencyStore", "deps");
  assertOptionalOwnField(deps, "quoteExposureStore", "deps");
  assertOptionalOwnField(deps, "settlementIndexerRiskGuard", "deps");
  assertOptionalOwnField(deps, "treasuryLiquidityProvider", "deps");
  assertDependencyMethod(deps.marketDataService, "marketDataService", "getSnapshot");
  assertDependencyMethod(deps.marketSnapshotStore, "marketSnapshotStore", "saveSnapshot");
  assertDependencyMethod(deps.routingEngine, "routingEngine", "selectRoute");
  assertDependencyMethod(deps.pricingEngine, "pricingEngine", "price");
  assertDependencyMethod(deps.inventoryService, "inventoryService", "calculateQuoteSkewBps");
  assertDependencyMethod(deps.inventoryService, "inventoryService", "projectSettlement");
  assertOptionalDependencyMethod(deps.hedgeService, "hedgeService", "quoteRiskPenaltyBps");
  if (deps.quoteIdempotencyStore !== undefined) {
    for (const method of ["acquire", "bindQuote", "complete", "fail", "checkHealth"]) {
      assertDependencyMethod(deps.quoteIdempotencyStore, "quoteIdempotencyStore", method);
    }
  }
  if (deps.quoteExposureStore !== undefined) {
    assertDependencyMethod(deps.quoteExposureStore, "quoteExposureStore", "reserve");
    assertDependencyMethod(deps.quoteExposureStore, "quoteExposureStore", "release");
  }
  if (deps.treasuryLiquidityProvider !== undefined) {
    if (deps.quoteExposureStore === undefined) {
      throw new Error("Quote service treasuryLiquidityProvider requires quoteExposureStore");
    }
    assertDependencyMethod(deps.treasuryLiquidityProvider, "treasuryLiquidityProvider", "getLiquidity");
  }
  if (deps.settlementIndexerRiskGuard !== undefined) {
    assertDependencyMethod(deps.settlementIndexerRiskGuard, "settlementIndexerRiskGuard", "checkHealth");
    assertDependencyMethod(deps.settlementIndexerRiskGuard, "settlementIndexerRiskGuard", "assertQuoteSafe");
  }
  assertDependencyMethod(deps.riskEngine, "riskEngine", "evaluate");
  assertDependencyMethod(deps.riskDecisionStore, "riskDecisionStore", "saveDecision");
  assertDependencyMethod(deps.signerService, "signerService", "signQuote");
  assertDependencyMethod(deps.signerService, "signerService", "verifyQuoteSignature");
  assertDependencyMethod(deps.quoteRepository, "quoteRepository", "saveRequested");
  assertDependencyMethod(deps.quoteRepository, "quoteRepository", "saveRejected");
  assertDependencyMethod(deps.quoteRepository, "quoteRepository", "saveSigned");
  assertDependencyMethod(deps.quoteRepository, "quoteRepository", "findStatus");
  assertDependencyMethod(deps.quoteRepository, "quoteRepository", "findPrincipalId");
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
  if (dependency === undefined) return;
  if (!isRecord(dependency)) {
    throw new Error(`Quote service ${dependencyName} must be an object when provided`);
  }
  const method = dependency[methodName];
  if (method !== undefined && typeof method !== "function") {
    throw new Error(`Quote service ${dependencyName}.${methodName} must be a function when provided`);
  }
}

function assertRecord(
  value: unknown,
  field: "config" | "deps" | "access context" | keyof QuoteServiceDeps,
): asserts value is Record<string, unknown> {
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
