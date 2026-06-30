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

const afterStatus = await quoteRepository.findStatus("q_reconciliation_check");
const hedge = hedgeService.getHedgeIntentBySettlementEvent(settlement.event.settlementEventId);
const pnlSummary = pnlService.summary();

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
assert.equal(afterStatus.status, "settled");
assert.equal(afterStatus.txHash, settlement.event.txHash);
assert.equal(afterStatus.settlementEventId, settlement.event.settlementEventId);
assert.equal(hedge.quoteId, "q_reconciliation_check");
assert.equal(hedge.settlementEventId, settlement.event.settlementEventId);
assert.equal(pnlSummary.totalTrades, 1);
assert.equal(pnlSummary.trades[0].quoteId, "q_reconciliation_check");

console.log(JSON.stringify({
  status: "ok",
  quoteReport,
  hedgeReport,
  pnlReport,
  quoteRetryReport,
  hedgeRetryReport,
  pnlRetryReport,
}, null, 2));
