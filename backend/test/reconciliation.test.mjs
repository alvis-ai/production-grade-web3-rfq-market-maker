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

test("ReconciliationService scopes repairs by chain-scoped settlement quote hash", async () => {
  const hedgeService = new HedgeService();
  const pnlService = new PnlService();
  const quoteRepository = new InMemoryQuoteRepository();
  const settlementEventService = new SettlementEventService(new InventoryService());
  const unrelatedQuote = {
    ...quote,
    amountOut: "970",
    minAmountOut: "960",
    nonce: "2",
  };
  await saveSignedQuote(quoteRepository, "q_hash_target", quote);
  await saveSignedQuote(quoteRepository, "q_hash_unrelated", unrelatedQuote);

  const targetSettlement = settlementEventService.applySettlementEvent({
    quoteId: "q_hash_target",
    quote,
    txHash: `0x${"17".repeat(32)}`,
    blockNumber: 200,
    logIndex: 0,
  });
  const unrelatedSettlement = settlementEventService.applySettlementEvent({
    quoteId: "q_hash_unrelated",
    quote: unrelatedQuote,
    txHash: `0x${"18".repeat(32)}`,
    blockNumber: 201,
    logIndex: 0,
  });
  const reconciliation = new ReconciliationService({
    hedgeService,
    pnlService,
    quoteRepository,
    settlementEventService,
  });
  const filter = {
    chainId: quote.chainId,
    quoteHash: `0x${targetSettlement.event.quoteHash.slice(2).toUpperCase()}`,
  };

  const quoteReport = await reconciliation.reconcileSettlementToQuote(filter);
  const hedgeReport = await reconciliation.reconcileSettlementToHedge(filter);
  const pnlReport = await reconciliation.reconcileSettlementToPnl(filter);
  const noMatchReport = await reconciliation.reconcileSettlementToQuote({
    chainId: 2,
    quoteHash: targetSettlement.event.quoteHash,
  });

  assert.deepEqual(quoteReport, {
    scannedSettlementEvents: 1,
    repairedQuoteStatuses: 1,
    skippedQuoteStatuses: 0,
    errors: [],
  });
  assert.deepEqual(hedgeReport, {
    scannedSettlementEvents: 1,
    repairedHedgeIntents: 1,
    skippedHedgeIntents: 0,
    errors: [],
  });
  assert.deepEqual(pnlReport, {
    scannedSettlementEvents: 1,
    repairedPnlRecords: 1,
    skippedPnlRecords: 0,
    errors: [],
  });
  assert.deepEqual(noMatchReport, {
    scannedSettlementEvents: 0,
    repairedQuoteStatuses: 0,
    skippedQuoteStatuses: 0,
    errors: [],
  });

  const targetStatus = await quoteRepository.findStatus("q_hash_target");
  const unrelatedStatus = await quoteRepository.findStatus("q_hash_unrelated");
  const targetHedge = hedgeService.getHedgeIntentBySettlementEvent(targetSettlement.event.settlementEventId);
  const unrelatedHedge = hedgeService.getHedgeIntentBySettlementEvent(unrelatedSettlement.event.settlementEventId);
  const pnlSummary = pnlService.summary();

  assert.equal(targetStatus.status, "settled");
  assert.equal(targetStatus.settlementEventId, targetSettlement.event.settlementEventId);
  assert.equal(unrelatedStatus.status, "signed");
  assert.equal(unrelatedStatus.settlementEventId, undefined);
  assert.equal(targetHedge.quoteId, "q_hash_target");
  assert.equal(unrelatedHedge, undefined);
  assert.equal(pnlSummary.totalTrades, 1);
  assert.equal(pnlSummary.trades[0].quoteId, "q_hash_target");
});

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

test("ReconciliationService reports removed settlement quote repair conflicts", async () => {
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
    skippedQuoteStatuses: 0,
    errors: [
      {
        settlementEventId: settlement.event.settlementEventId,
        quoteId: "q_reorg_conflict",
        reason: "Quote q_reorg_conflict settlement status removal conflict",
      },
    ],
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

test("ReconciliationService rejects unsafe settlement quote hash filters before scanning", async () => {
  const reconciliation = new ReconciliationService(reconciliationServiceDeps());
  const quoteHash = `0x${"19".repeat(32)}`;

  await assert.rejects(
    reconciliation.reconcileSettlementToQuote([]),
    /ReconciliationService filter must be an object/,
  );
  await assert.rejects(
    reconciliation.reconcileSettlementToQuote(Object.create({ chainId: quote.chainId, quoteHash })),
    /ReconciliationService filter.chainId must be an own field/,
  );

  const inheritedQuoteHashFilter = Object.create({ quoteHash });
  Object.assign(inheritedQuoteHashFilter, { chainId: quote.chainId });
  await assert.rejects(
    reconciliation.reconcileSettlementToQuote(inheritedQuoteHashFilter),
    /ReconciliationService filter.quoteHash must be an own field/,
  );

  await assert.rejects(
    reconciliation.reconcileSettlementToHedge({
      chainId: 0,
      quoteHash,
    }),
    /ReconciliationService filter.chainId must be a positive safe integer/,
  );
  await assert.rejects(
    reconciliation.reconcileSettlementToPnl({
      chainId: quote.chainId,
      quoteHash: "0x1234",
    }),
    /ReconciliationService filter.quoteHash must be a 32-byte hex string/,
  );
  await assert.rejects(
    reconciliation.reconcileSettlementToPnl({
      chainId: quote.chainId,
      quoteHash: new String(quoteHash),
    }),
    /ReconciliationService filter.quoteHash must be a 32-byte hex string/,
  );
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

function reconciliationServiceDeps() {
  const inventoryService = new InventoryService();
  return {
    hedgeService: new HedgeService(),
    pnlService: new PnlService(),
    quoteRepository: new InMemoryQuoteRepository(),
    settlementEventService: new SettlementEventService(inventoryService),
  };
}
