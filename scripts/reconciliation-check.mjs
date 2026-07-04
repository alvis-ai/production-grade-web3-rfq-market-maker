#!/usr/bin/env node

import assert from "node:assert/strict";
import { HedgeService } from "../backend/dist/modules/hedge/hedge.service.js";
import { InventoryService } from "../backend/dist/modules/inventory/inventory.service.js";
import { PnlService } from "../backend/dist/modules/pnl/pnl.service.js";
import { InMemoryQuoteRepository } from "../backend/dist/modules/quote/quote.repository.js";
import { ReconciliationService } from "../backend/dist/modules/reconciliation/reconciliation.service.js";
import { SettlementEventService } from "../backend/dist/modules/settlement/settlement-event.service.js";

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

const quoteRepository = new InMemoryQuoteRepository();
const settlementEventService = new SettlementEventService(new InventoryService());
const hedgeService = new HedgeService();
const pnlService = new PnlService();

await quoteRepository.saveSigned({
  quoteId: "q_reconciliation_check",
  snapshotId: "snapshot_reconciliation_check",
  slippageBps: 50,
  spreadBps: 8,
  sizeImpactBps: 0,
  inventorySkewBps: 0,
  quote,
  pricingVersion: "reconciliation-check-pricing",
  riskPolicyVersion: "reconciliation-check-risk",
  signature: `0x${"11".repeat(64)}1b`,
});

const settlement = settlementEventService.applySettlementEvent({
  quoteId: "q_reconciliation_check",
  quote,
  txHash: `0x${"ab".repeat(32)}`,
  blockNumber: 123456,
  logIndex: 7,
});

const beforeStatus = await quoteRepository.findStatus("q_reconciliation_check");
assert.equal(beforeStatus.status, "signed");
assert.equal(pnlService.summary().totalTrades, 0);

const reconciliation = new ReconciliationService({
  hedgeService,
  pnlService,
  quoteRepository,
  settlementEventService,
});

const quoteReport = await reconciliation.reconcileSettlementToQuote();
const hedgeReport = await reconciliation.reconcileSettlementToHedge();
const pnlReport = await reconciliation.reconcileSettlementToPnl();
const quoteRetryReport = await reconciliation.reconcileSettlementToQuote();
const hedgeRetryReport = await reconciliation.reconcileSettlementToHedge();
const pnlRetryReport = await reconciliation.reconcileSettlementToPnl();
const quoteHashFilter = {
  chainId: quote.chainId,
  quoteHash: settlement.event.quoteHash,
};
const quoteHashQuoteRetryReport = await reconciliation.reconcileSettlementToQuote(quoteHashFilter);
const quoteHashHedgeRetryReport = await reconciliation.reconcileSettlementToHedge(quoteHashFilter);
const quoteHashPnlRetryReport = await reconciliation.reconcileSettlementToPnl(quoteHashFilter);
const unmatchedQuoteHashReport = await reconciliation.reconcileSettlementToQuote({
  chainId: 2,
  quoteHash: settlement.event.quoteHash,
});

const afterStatus = await quoteRepository.findStatus("q_reconciliation_check");
const hedge = hedgeService.getHedgeIntentBySettlementEvent(settlement.event.settlementEventId);
const pnlSummary = pnlService.summary();

const reorgQuoteRepository = new InMemoryQuoteRepository();
const reorgSettlementEventService = new SettlementEventService(new InventoryService());
await reorgQuoteRepository.saveSigned({
  quoteId: "q_reconciliation_reorg_check",
  snapshotId: "snapshot_reconciliation_reorg_check",
  slippageBps: 50,
  spreadBps: 8,
  sizeImpactBps: 0,
  inventorySkewBps: 0,
  quote,
  pricingVersion: "reconciliation-check-pricing",
  riskPolicyVersion: "reconciliation-check-risk",
  signature: `0x${"11".repeat(64)}1b`,
});
const reorgSettlement = reorgSettlementEventService.applySettlementEvent({
  quoteId: "q_reconciliation_reorg_check",
  quote,
  txHash: `0x${"cd".repeat(32)}`,
  blockNumber: 123457,
  logIndex: 8,
});
await reorgQuoteRepository.markStatus("q_reconciliation_reorg_check", "settled", {
  txHash: reorgSettlement.event.txHash,
  settlementEventId: reorgSettlement.event.settlementEventId,
});
const removedSettlement = reorgSettlementEventService.removeSettlementEvent({
  chainId: reorgSettlement.event.chainId,
  txHash: reorgSettlement.event.txHash,
  blockNumber: reorgSettlement.event.blockNumber,
  logIndex: reorgSettlement.event.logIndex,
});
const reorgReconciliation = new ReconciliationService({
  quoteRepository: reorgQuoteRepository,
  settlementEventService: reorgSettlementEventService,
});
const removedQuoteReport = await reorgReconciliation.reconcileRemovedSettlementToQuote(removedSettlement.event);
const removedQuoteRetryReport = await reorgReconciliation.reconcileRemovedSettlementToQuote(removedSettlement.event);
const afterReorgStatus = await reorgQuoteRepository.findStatus("q_reconciliation_reorg_check");

assert.deepEqual(quoteReport, {
  scannedSettlementEvents: 1,
  repairedQuoteStatuses: 1,
  skippedQuoteStatuses: 0,
  errors: [],
});
assert.deepEqual(pnlReport, {
  scannedSettlementEvents: 1,
  repairedPnlRecords: 1,
  skippedPnlRecords: 0,
  errors: [],
});
assert.deepEqual(hedgeReport, {
  scannedSettlementEvents: 1,
  repairedHedgeIntents: 1,
  skippedHedgeIntents: 0,
  errors: [],
});
assert.deepEqual(quoteRetryReport, {
  scannedSettlementEvents: 1,
  repairedQuoteStatuses: 0,
  skippedQuoteStatuses: 1,
  errors: [],
});
assert.deepEqual(hedgeRetryReport, {
  scannedSettlementEvents: 1,
  repairedHedgeIntents: 0,
  skippedHedgeIntents: 1,
  errors: [],
});
assert.deepEqual(pnlRetryReport, {
  scannedSettlementEvents: 1,
  repairedPnlRecords: 0,
  skippedPnlRecords: 1,
  errors: [],
});
assert.deepEqual(quoteHashQuoteRetryReport, {
  scannedSettlementEvents: 1,
  repairedQuoteStatuses: 0,
  skippedQuoteStatuses: 1,
  errors: [],
});
assert.deepEqual(quoteHashHedgeRetryReport, {
  scannedSettlementEvents: 1,
  repairedHedgeIntents: 0,
  skippedHedgeIntents: 1,
  errors: [],
});
assert.deepEqual(quoteHashPnlRetryReport, {
  scannedSettlementEvents: 1,
  repairedPnlRecords: 0,
  skippedPnlRecords: 1,
  errors: [],
});
assert.deepEqual(unmatchedQuoteHashReport, {
  scannedSettlementEvents: 0,
  repairedQuoteStatuses: 0,
  skippedQuoteStatuses: 0,
  errors: [],
});
assert.equal(afterStatus.status, "settled");
assert.equal(afterStatus.txHash, settlement.event.txHash);
assert.equal(afterStatus.settlementEventId, settlement.event.settlementEventId);
assert.equal(hedge.quoteId, "q_reconciliation_check");
assert.equal(hedge.settlementEventId, settlement.event.settlementEventId);
assert.equal(pnlSummary.totalTrades, 1);
assert.equal(pnlSummary.trades[0].quoteId, "q_reconciliation_check");
assert.deepEqual(removedQuoteReport, {
  scannedRemovedSettlementEvents: 1,
  repairedQuoteStatuses: 1,
  skippedQuoteStatuses: 0,
  errors: [],
});
assert.deepEqual(removedQuoteRetryReport, {
  scannedRemovedSettlementEvents: 1,
  repairedQuoteStatuses: 0,
  skippedQuoteStatuses: 1,
  errors: [],
});
assert.equal(afterReorgStatus.status, "signed");
assert.equal(afterReorgStatus.txHash, undefined);
assert.equal(afterReorgStatus.settlementEventId, undefined);

console.log(JSON.stringify({
  status: "ok",
  quoteReport,
  hedgeReport,
  pnlReport,
  quoteRetryReport,
  hedgeRetryReport,
  pnlRetryReport,
  quoteHashQuoteRetryReport,
  quoteHashHedgeRetryReport,
  quoteHashPnlRetryReport,
  unmatchedQuoteHashReport,
  removedQuoteReport,
  removedQuoteRetryReport,
}, null, 2));
