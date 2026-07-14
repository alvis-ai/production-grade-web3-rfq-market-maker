import assert from "node:assert/strict";
import test from "node:test";
import { InventoryService } from "../dist/modules/inventory/inventory.service.js";
import { PnlService } from "../dist/modules/pnl/pnl.service.js";
import { InMemoryQuoteRepository } from "../dist/modules/quote/quote.repository.js";
import { ReconciliationService } from "../dist/modules/reconciliation/reconciliation.service.js";
import { SettlementEventService } from "../dist/modules/settlement/settlement-event.service.js";
import { createTestPnlValuationProvider } from "./helpers/pnl-fixtures.mjs";

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

test("ReconciliationService repairs PnL records from settlement events and signed quotes", async () => {
  const quoteRepository = new InMemoryQuoteRepository();
  const pnlService = new PnlService(createTestPnlValuationProvider());
  const settlementEventService = new SettlementEventService(new InventoryService());
  await saveSignedQuote(quoteRepository, "q_pnl", quote);
  const settlement = settlementEventService.applySettlementEvent({
    quoteId: "q_pnl",
    quote,
    txHash: `0x${"ee".repeat(32)}`,
  });

  const reconciliation = new ReconciliationService({
    pnlService,
    quoteRepository,
    settlementEventService,
  });

  const firstReport = await reconciliation.reconcileSettlementToPnl();
  assert.deepEqual(firstReport, {
    scannedSettlementEvents: 1,
    repairedPnlRecords: 1,
    skippedPnlRecords: 0,
    errors: [],
  });
  assert.equal(pnlService.summary().totalTrades, 1);
  assert.equal(pnlService.summary().trades[0].pnlId, "pnl_q_pnl");
  assert.equal(pnlService.summary().trades[0].quoteId, settlement.event.quoteId);

  const secondReport = await reconciliation.reconcileSettlementToPnl();
  assert.deepEqual(secondReport, {
    scannedSettlementEvents: 1,
    repairedPnlRecords: 0,
    skippedPnlRecords: 1,
    errors: [],
  });
  assert.equal(pnlService.summary().totalTrades, 1);
});

test("ReconciliationService reports PnL reconciliation events whose signed quote is missing", async () => {
  const settlementEventService = new SettlementEventService(new InventoryService());
  const settlement = settlementEventService.applySettlementEvent({
    quoteId: "q_missing_pnl",
    quote,
    txHash: `0x${"ff".repeat(32)}`,
  });

  const report = await new ReconciliationService({
    pnlService: new PnlService(createTestPnlValuationProvider()),
    quoteRepository: new InMemoryQuoteRepository(),
    settlementEventService,
  }).reconcileSettlementToPnl();

  assert.deepEqual(report, {
    scannedSettlementEvents: 1,
    repairedPnlRecords: 0,
    skippedPnlRecords: 0,
    errors: [
      {
        settlementEventId: settlement.event.settlementEventId,
        quoteId: "q_missing_pnl",
        reason: "SIGNED_QUOTE_NOT_FOUND",
      },
    ],
  });
});

test("ReconciliationService reports PnL conflicts without stopping later events", async () => {
  const quoteRepository = new InMemoryQuoteRepository();
  const pnlService = new PnlService(createTestPnlValuationProvider());
  const settlementEventService = new SettlementEventService(new InventoryService());
  const conflictingQuote = { ...quote, amountOut: "985" };
  const laterQuote = { ...quote, amountOut: "970", minAmountOut: "960", nonce: "3" };
  await saveSignedQuote(quoteRepository, "q_pnl_conflict", quote);
  await saveSignedQuote(quoteRepository, "q_pnl_after_conflict", laterQuote);
  const conflictSettlement = settlementEventService.applySettlementEvent({
    quoteId: "q_pnl_conflict",
    quote,
    txHash: `0x${"13".repeat(32)}`,
  });
  const laterSettlement = settlementEventService.applySettlementEvent({
    quoteId: "q_pnl_after_conflict",
    quote: laterQuote,
    txHash: `0x${"14".repeat(32)}`,
  });
  await pnlService.recordSettlement({
    quoteId: "q_pnl_conflict",
    settlementEventId: conflictSettlement.event.settlementEventId,
    snapshotId: "snapshot_q_pnl_conflict",
    realizedAt: conflictSettlement.event.observedAt,
    quote: conflictingQuote,
  });

  const report = await new ReconciliationService({
    pnlService,
    quoteRepository,
    settlementEventService,
  }).reconcileSettlementToPnl();

  assert.equal(report.scannedSettlementEvents, 2);
  assert.equal(report.repairedPnlRecords, 1);
  assert.equal(report.skippedPnlRecords, 0);
  assert.deepEqual(report.errors, [
    {
      settlementEventId: conflictSettlement.event.settlementEventId,
      quoteId: "q_pnl_conflict",
      reason: "PnL record conflict for pnl_q_pnl_conflict",
    },
  ]);

  const summary = pnlService.summary();
  assert.equal(summary.totalTrades, 2);
  assert.equal(summary.trades.find((trade) => trade.quoteId === "q_pnl_conflict").amountOut, "985");
  assert.equal(summary.trades.find((trade) => trade.quoteId === "q_pnl_after_conflict").pnlId, "pnl_q_pnl_after_conflict");
  assert.equal(laterSettlement.event.quoteId, "q_pnl_after_conflict");
});

test("ReconciliationService requires PnL service for settlement-to-PnL repair", async () => {
  const reconciliation = new ReconciliationService({
    quoteRepository: new InMemoryQuoteRepository(),
    settlementEventService: new SettlementEventService(new InventoryService()),
  });

  await assert.rejects(
    reconciliation.reconcileSettlementToPnl(),
    /pnlService is required for settlement-to-PnL reconciliation/,
  );
  await assert.rejects(
    reconciliation.reconcileRemovedSettlementToPnl({
      settlementEventId: "se_removed_pnl",
      status: "applied",
      quoteId: "q_removed_pnl",
      chainId: quote.chainId,
      txHash: `0x${"24".repeat(32)}`,
      quoteHash: `0x${"25".repeat(32)}`,
      blockNumber: 1,
      logIndex: 0,
      user: quote.user,
      tokenIn: quote.tokenIn,
      tokenOut: quote.tokenOut,
      amountIn: quote.amountIn,
      amountOut: quote.amountOut,
      nonce: quote.nonce,
      observedAt: new Date().toISOString(),
    }),
    /pnlService is required for removed-settlement-to-PnL reconciliation/,
  );
});

async function saveSignedQuote(quoteRepository, quoteId, signedQuote) {
  await quoteRepository.saveSigned({
    quoteId,
    principalId: "local",
    snapshotId: `snapshot_${quoteId}`,
    slippageBps: 50,
    spreadBps: 8,
    sizeImpactBps: 0,
    marketSpreadBps: 0,
    inventorySkewBps: 0,
    volatilityPremiumBps: 0,
    hedgeCostBps: 0,
    quote: signedQuote,
    pricingVersion: "test-pricing",
    riskPolicyVersion: "test-risk",
    signature: `0x${"11".repeat(64)}1b`,
  });
}
