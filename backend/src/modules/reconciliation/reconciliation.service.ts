import type { QuoteRepository } from "../quote/quote.repository.js";
import type { SettlementEventStore } from "../settlement/settlement-event.service.js";

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

export interface ReconciliationServiceDeps {
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
