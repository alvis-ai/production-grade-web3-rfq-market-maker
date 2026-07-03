import type { HedgeIntent, HedgeIntentService } from "../hedge/hedge.service.js";
import type { PnlStore } from "../pnl/pnl.service.js";
import type { QuoteRecord, QuoteRepository } from "../quote/quote.repository.js";
import type { SettlementEventStore } from "../settlement/settlement-event.service.js";
import type { SignedQuote } from "../../shared/types/rfq.js";

const reconciliationServiceDepsFields = ["quoteRepository", "settlementEventService"] as const;

export interface SettlementToQuoteReconciliationReport {
  scannedSettlementEvents: number;
  repairedQuoteStatuses: number;
  skippedQuoteStatuses: number;
  errors: SettlementToQuoteReconciliationError[];
}

export interface SettlementToQuoteReconciliationError {
  settlementEventId: string;
  quoteId: string;
  reason: string;
}

export interface SettlementToPnlReconciliationReport {
  scannedSettlementEvents: number;
  repairedPnlRecords: number;
  skippedPnlRecords: number;
  errors: SettlementToPnlReconciliationError[];
}

export interface SettlementToPnlReconciliationError {
  settlementEventId: string;
  quoteId: string;
  reason: string;
}

export interface SettlementToHedgeReconciliationReport {
  scannedSettlementEvents: number;
  repairedHedgeIntents: number;
  skippedHedgeIntents: number;
  errors: SettlementToHedgeReconciliationError[];
}

export interface SettlementToHedgeReconciliationError {
  settlementEventId: string;
  quoteId: string;
  reason: string;
}

export interface ReconciliationServiceDeps {
  hedgeService?: HedgeIntentService;
  pnlService?: PnlStore;
  quoteRepository: QuoteRepository;
  settlementEventService: SettlementEventStore;
}

export class ReconciliationService {
  private readonly deps: ReconciliationServiceDeps;

  constructor(deps: ReconciliationServiceDeps) {
    assertReconciliationServiceDeps(deps);
    this.deps = cloneReconciliationServiceDeps(deps);
  }

  async reconcileSettlementToQuote(): Promise<SettlementToQuoteReconciliationReport> {
    const events = this.deps.settlementEventService.listSettlementEvents();
    const report: SettlementToQuoteReconciliationReport = {
      scannedSettlementEvents: events.length,
      repairedQuoteStatuses: 0,
      skippedQuoteStatuses: 0,
      errors: [],
    };

    for (const event of events) {
      try {
        const status = await this.deps.quoteRepository.findStatus(event.quoteId);
        if (!status) {
          report.errors.push({
            settlementEventId: event.settlementEventId,
            quoteId: event.quoteId,
            reason: "QUOTE_NOT_FOUND",
          });
          continue;
        }

        if (isAlreadyReconciled(status, event)) {
          report.skippedQuoteStatuses += 1;
          continue;
        }

        await this.deps.quoteRepository.markStatus(event.quoteId, "settled", {
          txHash: event.txHash,
          settlementEventId: event.settlementEventId,
        });
        report.repairedQuoteStatuses += 1;
      } catch (error) {
        report.errors.push({
          settlementEventId: event.settlementEventId,
          quoteId: event.quoteId,
          reason: error instanceof Error ? error.message : "RECONCILIATION_FAILED",
        });
      }
    }

    return report;
  }

  async reconcileSettlementToPnl(): Promise<SettlementToPnlReconciliationReport> {
    if (!this.deps.pnlService) {
      throw new Error("ReconciliationService pnlService is required for settlement-to-PnL reconciliation");
    }

    const events = this.deps.settlementEventService.listSettlementEvents();
    const report: SettlementToPnlReconciliationReport = {
      scannedSettlementEvents: events.length,
      repairedPnlRecords: 0,
      skippedPnlRecords: 0,
      errors: [],
    };

    for (const event of events) {
      try {
        const beforeCount = this.deps.pnlService.summary().totalTrades;
        const record = await this.deps.quoteRepository.findSignedQuoteByQuoteId(event.quoteId);
        if (!record) {
          report.errors.push({
            settlementEventId: event.settlementEventId,
            quoteId: event.quoteId,
            reason: "SIGNED_QUOTE_NOT_FOUND",
          });
          continue;
        }

        this.deps.pnlService.recordSettlement({
          quoteId: event.quoteId,
          quote: signedQuoteFromRecord(record),
        });

        const afterCount = this.deps.pnlService.summary().totalTrades;
        if (afterCount === beforeCount) {
          report.skippedPnlRecords += 1;
        } else {
          report.repairedPnlRecords += 1;
        }
      } catch (error) {
        report.errors.push({
          settlementEventId: event.settlementEventId,
          quoteId: event.quoteId,
          reason: error instanceof Error ? error.message : "RECONCILIATION_FAILED",
        });
      }
    }

    return report;
  }

  async reconcileSettlementToHedge(): Promise<SettlementToHedgeReconciliationReport> {
    if (!this.deps.hedgeService) {
      throw new Error("ReconciliationService hedgeService is required for settlement-to-hedge reconciliation");
    }

    const events = this.deps.settlementEventService.listSettlementEvents();
    const report: SettlementToHedgeReconciliationReport = {
      scannedSettlementEvents: events.length,
      repairedHedgeIntents: 0,
      skippedHedgeIntents: 0,
      errors: [],
    };

    for (const event of events) {
      try {
        const existingIntent = this.deps.hedgeService.getHedgeIntentBySettlementEvent(event.settlementEventId);
        const hedgeIntent = hedgeIntentFromSettlementEvent(event);
        this.deps.hedgeService.createHedgeIntent(hedgeIntent);

        if (existingIntent) {
          report.skippedHedgeIntents += 1;
          continue;
        }

        report.repairedHedgeIntents += 1;
      } catch (error) {
        report.errors.push({
          settlementEventId: event.settlementEventId,
          quoteId: event.quoteId,
          reason: error instanceof Error ? error.message : "RECONCILIATION_FAILED",
        });
      }
    }

    return report;
  }
}

function isAlreadyReconciled(
  status: Awaited<ReturnType<QuoteRepository["findStatus"]>>,
  event: ReturnType<SettlementEventStore["listSettlementEvents"]>[number],
): boolean {
  return (
    status?.status === "settled" &&
    status.txHash?.toLowerCase() === event.txHash.toLowerCase() &&
    status.settlementEventId === event.settlementEventId
  );
}

function cloneReconciliationServiceDeps(deps: ReconciliationServiceDeps): ReconciliationServiceDeps {
  return { ...deps };
}

function assertReconciliationServiceDeps(deps: ReconciliationServiceDeps): void {
  assertRecord(deps, "deps");
  assertOwnFields(deps, reconciliationServiceDepsFields, "deps");
  assertOptionalOwnField(deps, "pnlService", "deps");
  assertOptionalOwnField(deps, "hedgeService", "deps");
  assertDependencyMethod(deps.settlementEventService, "settlementEventService", "listSettlementEvents");
  assertDependencyMethod(deps.quoteRepository, "quoteRepository", "findStatus");
  assertDependencyMethod(deps.quoteRepository, "quoteRepository", "markStatus");
  assertDependencyMethod(deps.quoteRepository, "quoteRepository", "findSignedQuoteByQuoteId");
  assertOptionalDependencyMethod(deps.pnlService, "pnlService", "summary");
  assertOptionalDependencyMethod(deps.pnlService, "pnlService", "recordSettlement");
  assertOptionalDependencyMethod(deps.hedgeService, "hedgeService", "getHedgeIntentBySettlementEvent");
  assertOptionalDependencyMethod(deps.hedgeService, "hedgeService", "createHedgeIntent");
}

function assertDependencyMethod(
  dependency: unknown,
  dependencyName: keyof ReconciliationServiceDeps,
  methodName: string,
): void {
  assertRecord(dependency, dependencyName);
  const method = (dependency as Record<string, unknown>)[methodName];
  if (typeof method !== "function") {
    throw new Error(`ReconciliationService ${dependencyName}.${methodName} must be a function`);
  }
}

function assertOptionalDependencyMethod(
  dependency: unknown,
  dependencyName: keyof ReconciliationServiceDeps,
  methodName: string,
): void {
  if (dependency === undefined) {
    return;
  }
  if (!isRecord(dependency)) {
    throw new Error(`ReconciliationService ${dependencyName} must be an object when provided`);
  }

  const method = (dependency as Record<string, unknown>)[methodName];
  if (typeof method !== "function") {
    throw new Error(`ReconciliationService ${dependencyName}.${methodName} must be a function when provided`);
  }
}

function assertRecord(value: unknown, field: "deps" | keyof ReconciliationServiceDeps): void {
  if (!isRecord(value)) {
    throw new Error(`ReconciliationService ${field} must be an object`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertOwnFields(value: object, fields: readonly string[], path: string): void {
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      throw new Error(`ReconciliationService ${path}.${field} must be an own field`);
    }
  }
}

function assertOptionalOwnField(value: object, field: string, path: string): void {
  if (field in value && !Object.prototype.hasOwnProperty.call(value, field)) {
    throw new Error(`ReconciliationService ${path}.${field} must be an own field when provided`);
  }
}

function hedgeIntentFromSettlementEvent(
  event: ReturnType<SettlementEventStore["listSettlementEvents"]>[number],
): HedgeIntent {
  return {
    settlementEventId: event.settlementEventId,
    quoteId: event.quoteId,
    chainId: event.chainId,
    token: event.tokenOut,
    side: "buy",
    amount: event.amountOut,
    reason: "inventory_rebalance",
  };
}

function signedQuoteFromRecord(record: QuoteRecord): SignedQuote {
  if (!record.amountOut || !record.minAmountOut || !record.nonce || !record.deadline) {
    throw new Error(`Quote ${record.quoteId} is missing signed quote fields`);
  }

  return {
    user: record.user,
    tokenIn: record.tokenIn,
    tokenOut: record.tokenOut,
    amountIn: record.amountIn,
    amountOut: record.amountOut,
    minAmountOut: record.minAmountOut,
    nonce: record.nonce,
    deadline: record.deadline,
    chainId: record.chainId,
  };
}
