import type { HedgeIntent, HedgeIntentService } from "../hedge/hedge.service.js";
import type { PnlStore } from "../pnl/pnl.service.js";
import type { QuoteRecord, QuoteRepository } from "../quote/quote.repository.js";
import type { SettlementEventStore } from "../settlement/settlement-event.service.js";
import type { SignedQuote } from "../../shared/types/rfq.js";

const reconciliationServiceDepsFields = ["quoteRepository", "settlementEventService"] as const;
const settlementReconciliationFilterFields = ["chainId", "quoteHash"] as const;

type SettlementEventForReconciliation = Awaited<ReturnType<SettlementEventStore["listSettlementEvents"]>>[number];

export interface SettlementReconciliationFilter {
  chainId: number;
  quoteHash: `0x${string}`;
}

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

export interface RemovedSettlementToQuoteReconciliationReport {
  scannedRemovedSettlementEvents: number;
  repairedQuoteStatuses: number;
  skippedQuoteStatuses: number;
  errors: SettlementToQuoteReconciliationError[];
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

export interface RemovedSettlementToPnlReconciliationReport {
  scannedRemovedSettlementEvents: number;
  removedPnlRecords: number;
  skippedPnlRecords: number;
  errors: SettlementToPnlReconciliationError[];
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

export interface RemovedSettlementToHedgeReconciliationReport {
  scannedRemovedSettlementEvents: number;
  removedHedgeIntents: number;
  skippedHedgeIntents: number;
  errors: SettlementToHedgeReconciliationError[];
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

  async reconcileSettlementToQuote(
    filter?: SettlementReconciliationFilter,
  ): Promise<SettlementToQuoteReconciliationReport> {
    const events = await this.listSettlementEventsForReconciliation(filter);
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

  async reconcileRemovedSettlementToQuote(
    event: SettlementEventForReconciliation,
  ): Promise<RemovedSettlementToQuoteReconciliationReport> {
    const report: RemovedSettlementToQuoteReconciliationReport = {
      scannedRemovedSettlementEvents: 1,
      repairedQuoteStatuses: 0,
      skippedQuoteStatuses: 0,
      errors: [],
    };

    try {
      const result = await this.deps.quoteRepository.clearSettlementStatus({
        quoteId: event.quoteId,
        txHash: event.txHash,
        settlementEventId: event.settlementEventId,
      });
      if (!result.status) {
        report.errors.push({
          settlementEventId: event.settlementEventId,
          quoteId: event.quoteId,
          reason: "QUOTE_NOT_FOUND",
        });
        return report;
      }
      if (result.cleared) {
        report.repairedQuoteStatuses += 1;
      } else {
        report.skippedQuoteStatuses += 1;
      }
    } catch (error) {
      report.errors.push({
        settlementEventId: event.settlementEventId,
        quoteId: event.quoteId,
        reason: error instanceof Error ? error.message : "RECONCILIATION_FAILED",
      });
    }

    return report;
  }

  async reconcileSettlementToPnl(
    filter?: SettlementReconciliationFilter,
  ): Promise<SettlementToPnlReconciliationReport> {
    if (!this.deps.pnlService) {
      throw new Error("ReconciliationService pnlService is required for settlement-to-PnL reconciliation");
    }

    const events = await this.listSettlementEventsForReconciliation(filter);
    const report: SettlementToPnlReconciliationReport = {
      scannedSettlementEvents: events.length,
      repairedPnlRecords: 0,
      skippedPnlRecords: 0,
      errors: [],
    };

    for (const event of events) {
      try {
        const beforeCount = (await this.deps.pnlService.summary()).totalTrades;
        const record = await this.deps.quoteRepository.findSignedQuoteByQuoteId(event.quoteId);
        if (!record) {
          report.errors.push({
            settlementEventId: event.settlementEventId,
            quoteId: event.quoteId,
            reason: "SIGNED_QUOTE_NOT_FOUND",
          });
          continue;
        }

        await this.deps.pnlService.recordSettlement({
          quoteId: event.quoteId,
          quote: signedQuoteFromRecord(record),
        });

        const afterCount = (await this.deps.pnlService.summary()).totalTrades;
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

  async reconcileRemovedSettlementToPnl(
    event: SettlementEventForReconciliation,
  ): Promise<RemovedSettlementToPnlReconciliationReport> {
    if (!this.deps.pnlService) {
      throw new Error("ReconciliationService pnlService is required for removed-settlement-to-PnL reconciliation");
    }

    const report: RemovedSettlementToPnlReconciliationReport = {
      scannedRemovedSettlementEvents: 1,
      removedPnlRecords: 0,
      skippedPnlRecords: 0,
      errors: [],
    };

    try {
      const result = await this.deps.pnlService.removePnlRecord({ quoteId: event.quoteId });
      if (result.removed) {
        report.removedPnlRecords += 1;
      } else {
        report.skippedPnlRecords += 1;
      }
    } catch (error) {
      report.errors.push({
        settlementEventId: event.settlementEventId,
        quoteId: event.quoteId,
        reason: error instanceof Error ? error.message : "RECONCILIATION_FAILED",
      });
    }

    return report;
  }

  async reconcileSettlementToHedge(
    filter?: SettlementReconciliationFilter,
  ): Promise<SettlementToHedgeReconciliationReport> {
    if (!this.deps.hedgeService) {
      throw new Error("ReconciliationService hedgeService is required for settlement-to-hedge reconciliation");
    }

    const events = await this.listSettlementEventsForReconciliation(filter);
    const report: SettlementToHedgeReconciliationReport = {
      scannedSettlementEvents: events.length,
      repairedHedgeIntents: 0,
      skippedHedgeIntents: 0,
      errors: [],
    };

    for (const event of events) {
      try {
        const existingIntent = await this.deps.hedgeService.getHedgeIntentBySettlementEvent(event.settlementEventId);
        const hedgeIntent = hedgeIntentFromSettlementEvent(event);
        await this.deps.hedgeService.createHedgeIntent(hedgeIntent);

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

  async reconcileRemovedSettlementToHedge(
    event: SettlementEventForReconciliation,
  ): Promise<RemovedSettlementToHedgeReconciliationReport> {
    if (!this.deps.hedgeService) {
      throw new Error("ReconciliationService hedgeService is required for removed-settlement-to-hedge reconciliation");
    }

    const report: RemovedSettlementToHedgeReconciliationReport = {
      scannedRemovedSettlementEvents: 1,
      removedHedgeIntents: 0,
      skippedHedgeIntents: 0,
      errors: [],
    };

    try {
      const result = await this.deps.hedgeService.removeHedgeIntentBySettlementEvent(event.settlementEventId);
      if (result.removed) {
        report.removedHedgeIntents += 1;
      } else {
        report.skippedHedgeIntents += 1;
      }
    } catch (error) {
      report.errors.push({
        settlementEventId: event.settlementEventId,
        quoteId: event.quoteId,
        reason: error instanceof Error ? error.message : "RECONCILIATION_FAILED",
      });
    }

    return report;
  }

  private async listSettlementEventsForReconciliation(
    filter: SettlementReconciliationFilter | undefined,
  ): Promise<SettlementEventForReconciliation[]> {
    if (filter === undefined) {
      return this.deps.settlementEventService.listSettlementEvents();
    }

    const normalizedFilter = normalizeSettlementReconciliationFilter(filter);
    return this.deps.settlementEventService.getSettlementEventsByQuoteHash(normalizedFilter);
  }
}

function isAlreadyReconciled(
  status: Awaited<ReturnType<QuoteRepository["findStatus"]>>,
  event: SettlementEventForReconciliation,
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
  assertDependencyMethod(deps.settlementEventService, "settlementEventService", "getSettlementEventsByQuoteHash");
  assertDependencyMethod(deps.quoteRepository, "quoteRepository", "findStatus");
  assertDependencyMethod(deps.quoteRepository, "quoteRepository", "markStatus");
  assertDependencyMethod(deps.quoteRepository, "quoteRepository", "clearSettlementStatus");
  assertDependencyMethod(deps.quoteRepository, "quoteRepository", "findSignedQuoteByQuoteId");
  assertOptionalDependencyMethod(deps.pnlService, "pnlService", "summary");
  assertOptionalDependencyMethod(deps.pnlService, "pnlService", "recordSettlement");
  assertOptionalDependencyMethod(deps.pnlService, "pnlService", "removePnlRecord");
  assertOptionalDependencyMethod(deps.hedgeService, "hedgeService", "getHedgeIntentBySettlementEvent");
  assertOptionalDependencyMethod(deps.hedgeService, "hedgeService", "createHedgeIntent");
  assertOptionalDependencyMethod(deps.hedgeService, "hedgeService", "removeHedgeIntentBySettlementEvent");
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

function assertRecord(value: unknown, field: string): void {
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

function normalizeSettlementReconciliationFilter(
  filter: SettlementReconciliationFilter,
): SettlementReconciliationFilter {
  assertRecord(filter, "filter");
  assertOwnFields(filter, settlementReconciliationFilterFields, "filter");
  assertPositiveSafeInteger(filter.chainId, "filter.chainId");

  return {
    chainId: filter.chainId,
    quoteHash: normalizeQuoteHash(filter.quoteHash),
  };
}

function normalizeQuoteHash(value: unknown): `0x${string}` {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error("ReconciliationService filter.quoteHash must be a 32-byte hex string");
  }

  return value.toLowerCase() as `0x${string}`;
}

function assertPositiveSafeInteger(value: unknown, field: string): void {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`ReconciliationService ${field} must be a positive safe integer`);
  }
}

function hedgeIntentFromSettlementEvent(
  event: SettlementEventForReconciliation,
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
