import assert from "node:assert/strict";
import test from "node:test";
import { InventoryService } from "../dist/modules/inventory/inventory.service.js";
import { InMemoryQuoteRepository } from "../dist/modules/quote/quote.repository.js";
import { ReconciliationService } from "../dist/modules/reconciliation/reconciliation.service.js";
import { SettlementEventService } from "../dist/modules/settlement/settlement-event.service.js";

const quote = {
  user: "0x0000000000000000000000000000000000000001",
  tokenIn: "0x0000000000000000000000000000000000000002",
  tokenOut: "0x0000000000000000000000000000000000000003",
  amountIn: "1000",
  amountOut: "990",
  minAmountOut: "980",
  nonce: "1",
  deadline: 1893456000,
  chainId: 1,
};

test("ReconciliationService repairs quote status from settlement events", async () => {
  const quoteRepository = new InMemoryQuoteRepository();
  const settlementEventService = new SettlementEventService(new InventoryService());
  await saveSignedQuote(quoteRepository, "q_reconcile", quote);
  const settlement = settlementEventService.applySettlementEvent({
    quoteId: "q_reconcile",
    quote,
    txHash: `0x${"aa".repeat(32)}`,
    blockNumber: 100,
    logIndex: 3,
  });

  const reconciliation = new ReconciliationService({
    quoteRepository,
    settlementEventService,
  });

  const firstReport = await reconciliation.reconcileSettlementToQuote();
  assert.deepEqual(firstReport, {
    scannedSettlementEvents: 1,
    repairedQuoteStatuses: 1,
    skippedQuoteStatuses: 0,
    errors: [],
  });

  const status = await quoteRepository.findStatus("q_reconcile");
  assert.equal(status.status, "settled");
  assert.equal(status.txHash, settlement.event.txHash);
  assert.equal(status.settlementEventId, settlement.event.settlementEventId);

  const secondReport = await reconciliation.reconcileSettlementToQuote();
  assert.deepEqual(secondReport, {
    scannedSettlementEvents: 1,
    repairedQuoteStatuses: 0,
    skippedQuoteStatuses: 1,
    errors: [],
  });
});

test("ReconciliationService reports terminal quote conflicts without stopping later events", async () => {
  const quoteRepository = new InMemoryQuoteRepository();
  const settlementEventService = new SettlementEventService(new InventoryService());
  await saveSignedQuote(quoteRepository, "q_failed", quote);
  await quoteRepository.markFailed("q_failed", "SETTLEMENT_REVERTED");
  await saveSignedQuote(quoteRepository, "q_ok", { ...quote, nonce: "2" });

  const failedSettlement = settlementEventService.applySettlementEvent({
    quoteId: "q_failed",
    quote,
    txHash: `0x${"bb".repeat(32)}`,
    blockNumber: 100,
    logIndex: 0,
  });
  const okSettlement = settlementEventService.applySettlementEvent({
    quoteId: "q_ok",
    quote: { ...quote, nonce: "2" },
    txHash: `0x${"cc".repeat(32)}`,
    blockNumber: 101,
    logIndex: 0,
  });

  const report = await new ReconciliationService({
    quoteRepository,
    settlementEventService,
  }).reconcileSettlementToQuote();

  assert.equal(report.scannedSettlementEvents, 2);
  assert.equal(report.repairedQuoteStatuses, 1);
  assert.equal(report.skippedQuoteStatuses, 0);
  assert.deepEqual(report.errors, [
    {
      settlementEventId: failedSettlement.event.settlementEventId,
      quoteId: "q_failed",
      reason: "Quote q_failed cannot transition from terminal status failed to settled",
    },
  ]);

  const failedStatus = await quoteRepository.findStatus("q_failed");
  const okStatus = await quoteRepository.findStatus("q_ok");
  assert.equal(failedStatus.status, "failed");
  assert.equal(okStatus.status, "settled");
  assert.equal(okStatus.settlementEventId, okSettlement.event.settlementEventId);
});

test("ReconciliationService reports settlement events whose quotes are missing", async () => {
  const settlementEventService = new SettlementEventService(new InventoryService());
  const settlement = settlementEventService.applySettlementEvent({
    quoteId: "q_missing",
    quote,
    txHash: `0x${"dd".repeat(32)}`,
  });

  const report = await new ReconciliationService({
    quoteRepository: new InMemoryQuoteRepository(),
    settlementEventService,
  }).reconcileSettlementToQuote();

  assert.deepEqual(report, {
    scannedSettlementEvents: 1,
    repairedQuoteStatuses: 0,
    skippedQuoteStatuses: 0,
    errors: [
      {
        settlementEventId: settlement.event.settlementEventId,
        quoteId: "q_missing",
        reason: "QUOTE_NOT_FOUND",
      },
    ],
  });
});

async function saveSignedQuote(quoteRepository, quoteId, signedQuote) {
  await quoteRepository.saveSigned({
    quoteId,
    snapshotId: `snapshot_${quoteId}`,
    quote: signedQuote,
    pricingVersion: "test-pricing",
    riskPolicyVersion: "test-risk",
    signature: `0x${"11".repeat(65)}`,
  });
}
