import type { HedgeIntentService } from "../hedge/hedge.service.js";
import type { PnlStore } from "../pnl/pnl.service.js";
import type { QuoteRecord, QuoteRepository } from "../quote/quote.repository.js";
import type { SettlementEventStore } from "../settlement/settlement-event.service.js";
import type { SignedQuote } from "../../shared/types/rfq.js";

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
  constructor(private readonly deps: ReconciliationServiceDeps) {}

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
        if (this.deps.hedgeService.getHedgeIntentBySettlementEvent(event.settlementEventId)) {
          report.skippedHedgeIntents += 1;
          continue;
        }

        this.deps.hedgeService.createHedgeIntent({
          settlementEventId: event.settlementEventId,
          quoteId: event.quoteId,
          chainId: event.chainId,
          token: event.tokenOut,
          side: "buy",
          amount: event.amountOut,
          reason: "inventory_rebalance",
        });
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
