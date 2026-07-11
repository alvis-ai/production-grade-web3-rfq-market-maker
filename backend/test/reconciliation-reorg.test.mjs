import assert from "node:assert/strict";
import test from "node:test";
import { HedgeService } from "../dist/modules/hedge/hedge.service.js";
import { InventoryService } from "../dist/modules/inventory/inventory.service.js";
import { PnlService } from "../dist/modules/pnl/pnl.service.js";
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

test("ReconciliationService repairs quote status after a removed settlement event", async () => {
  const quoteRepository = new InMemoryQuoteRepository();
  const settlementEventService = new SettlementEventService(new InventoryService());
  const reorgedQuote = {
    ...quote,
    deadline: Math.floor(Date.now() / 1000) + 60,
  };
  await saveSignedQuote(quoteRepository, "q_reorg_quote", reorgedQuote);
  const settlement = settlementEventService.applySettlementEvent({
    quoteId: "q_reorg_quote",
    quote: reorgedQuote,
    txHash: `0x${"19".repeat(32)}`,
    blockNumber: 250,
    logIndex: 1,
  });
  await quoteRepository.markStatus("q_reorg_quote", "settled", {
    txHash: settlement.event.txHash,
    settlementEventId: settlement.event.settlementEventId,
    hedgeOrderId: "h_reorg_quote",
    pnlId: "pnl_reorg_quote",
  });
  const removed = settlementEventService.removeSettlementEvent({
    chainId: settlement.event.chainId,
    txHash: settlement.event.txHash,
    blockNumber: settlement.event.blockNumber,
    logIndex: settlement.event.logIndex,
  });

  const reconciliation = new ReconciliationService({
    quoteRepository,
    settlementEventService,
  });
  const firstReport = await reconciliation.reconcileRemovedSettlementToQuote(removed.event);
  const retryReport = await reconciliation.reconcileRemovedSettlementToQuote(removed.event);

  assert.deepEqual(firstReport, {
    scannedRemovedSettlementEvents: 1,
    repairedQuoteStatuses: 1,
    skippedQuoteStatuses: 0,
    errors: [],
  });
  assert.deepEqual(retryReport, {
    scannedRemovedSettlementEvents: 1,
    repairedQuoteStatuses: 0,
    skippedQuoteStatuses: 1,
    errors: [],
  });

  const status = await quoteRepository.findStatus("q_reorg_quote");
  assert.equal(status.status, "signed");
  assert.equal(status.txHash, undefined);
  assert.equal(status.settlementEventId, undefined);
  assert.equal(status.hedgeOrderId, undefined);
  assert.equal(status.pnlId, undefined);
});

test("ReconciliationService removes hedge and PnL records after a removed settlement event", async () => {
  const hedgeService = new HedgeService();
  const pnlService = new PnlService();
  const settlementEventService = new SettlementEventService(new InventoryService());
  const settlement = settlementEventService.applySettlementEvent({
    quoteId: "q_reorg_post_trade",
    quote,
    txHash: `0x${"23".repeat(32)}`,
    blockNumber: 260,
    logIndex: 0,
  });
  const hedge = hedgeService.createHedgeIntent({
    settlementEventId: settlement.event.settlementEventId,
    quoteId: settlement.event.quoteId,
    chainId: settlement.event.chainId,
    token: settlement.event.tokenOut,
    side: "buy",
    amount: settlement.event.amountOut,
    reason: "inventory_rebalance",
  });
  pnlService.recordSettlement({
    quoteId: settlement.event.quoteId,
    quote,
  });
  const removed = settlementEventService.removeSettlementEvent({
    chainId: settlement.event.chainId,
    txHash: settlement.event.txHash,
    blockNumber: settlement.event.blockNumber,
    logIndex: settlement.event.logIndex,
  });
  const reconciliation = new ReconciliationService({
    hedgeService,
    pnlService,
    quoteRepository: new InMemoryQuoteRepository(),
    settlementEventService,
  });

  const hedgeReport = await reconciliation.reconcileRemovedSettlementToHedge(removed.event);
  const pnlReport = await reconciliation.reconcileRemovedSettlementToPnl(removed.event);
  const hedgeRetryReport = await reconciliation.reconcileRemovedSettlementToHedge(removed.event);
  const pnlRetryReport = await reconciliation.reconcileRemovedSettlementToPnl(removed.event);

  assert.deepEqual(hedgeReport, {
    scannedRemovedSettlementEvents: 1,
    removedHedgeIntents: 1,
    skippedHedgeIntents: 0,
    errors: [],
  });
  assert.deepEqual(pnlReport, {
    scannedRemovedSettlementEvents: 1,
    removedPnlRecords: 1,
    skippedPnlRecords: 0,
    errors: [],
  });
  assert.deepEqual(hedgeRetryReport, {
    scannedRemovedSettlementEvents: 1,
    removedHedgeIntents: 0,
    skippedHedgeIntents: 1,
    errors: [],
  });
  assert.deepEqual(pnlRetryReport, {
    scannedRemovedSettlementEvents: 1,
    removedPnlRecords: 0,
    skippedPnlRecords: 1,
    errors: [],
  });
  assert.equal(hedgeService.getHedgeIntent(hedge.hedgeOrderId), undefined);
  assert.equal(hedgeService.getHedgeIntentBySettlementEvent(settlement.event.settlementEventId), undefined);
  assert.equal(pnlService.summary().totalTrades, 0);
});

test("ReconciliationService skips removed events when quote points at a replacement settlement", async () => {
  const quoteRepository = new InMemoryQuoteRepository();
  const settlementEventService = new SettlementEventService(new InventoryService());
  await saveSignedQuote(quoteRepository, "q_reorg_conflict", quote);
  await quoteRepository.markStatus("q_reorg_conflict", "settled", {
    txHash: `0x${"20".repeat(32)}`,
    settlementEventId: "se_reorg_actual",
  });
  const settlement = settlementEventService.applySettlementEvent({
    quoteId: "q_reorg_conflict",
    quote,
    txHash: `0x${"21".repeat(32)}`,
    blockNumber: 251,
    logIndex: 0,
  });
  const missingQuoteSettlement = settlementEventService.applySettlementEvent({
    quoteId: "q_reorg_missing",
    quote: {
      ...quote,
      nonce: "2",
    },
    txHash: `0x${"22".repeat(32)}`,
    blockNumber: 252,
    logIndex: 0,
  });
  const reconciliation = new ReconciliationService({
    quoteRepository,
    settlementEventService,
  });

  const conflictReport = await reconciliation.reconcileRemovedSettlementToQuote(settlement.event);
  const missingReport = await reconciliation.reconcileRemovedSettlementToQuote(missingQuoteSettlement.event);

  assert.deepEqual(conflictReport, {
    scannedRemovedSettlementEvents: 1,
    repairedQuoteStatuses: 0,
    skippedQuoteStatuses: 1,
    errors: [],
  });
  assert.deepEqual(missingReport, {
    scannedRemovedSettlementEvents: 1,
    repairedQuoteStatuses: 0,
    skippedQuoteStatuses: 0,
    errors: [
      {
        settlementEventId: missingQuoteSettlement.event.settlementEventId,
        quoteId: "q_reorg_missing",
        reason: "QUOTE_NOT_FOUND",
      },
    ],
  });
});

async function saveSignedQuote(quoteRepository, quoteId, signedQuote) {
  await quoteRepository.saveSigned({
    quoteId,
    snapshotId: `snapshot_${quoteId}`,
    slippageBps: 50,
    spreadBps: 8,
    sizeImpactBps: 0,
    inventorySkewBps: 0,
    quote: signedQuote,
    pricingVersion: "test-pricing",
    riskPolicyVersion: "test-risk",
    signature: `0x${"11".repeat(64)}1b`,
  });
}
