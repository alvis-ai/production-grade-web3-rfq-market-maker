import assert from "node:assert/strict";
import test from "node:test";
import { HedgeService } from "../dist/modules/hedge/hedge.service.js";
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

test("ReconciliationService repairs hedge intents from settlement events", async () => {
  const hedgeService = new HedgeService();
  const settlementEventService = new SettlementEventService(new InventoryService());
  const settlement = settlementEventService.applySettlementEvent({
    quoteId: "q_hedge",
    quote,
    txHash: `0x${"12".repeat(32)}`,
  });

  const reconciliation = new ReconciliationService({
    hedgeService,
    quoteRepository: new InMemoryQuoteRepository(),
    settlementEventService,
  });

  const firstReport = await reconciliation.reconcileSettlementToHedge();
  assert.deepEqual(firstReport, {
    scannedSettlementEvents: 1,
    repairedHedgeIntents: 1,
    skippedHedgeIntents: 0,
    errors: [],
  });
  const hedge = hedgeService.getHedgeIntentBySettlementEvent(settlement.event.settlementEventId);
  assert.equal(hedge.quoteId, "q_hedge");
  assert.equal(hedge.token, quote.tokenOut);
  assert.equal(hedge.amount, quote.amountOut);
  assert.equal(hedge.reason, "inventory_rebalance");

  const secondReport = await reconciliation.reconcileSettlementToHedge();
  assert.deepEqual(secondReport, {
    scannedSettlementEvents: 1,
    repairedHedgeIntents: 0,
    skippedHedgeIntents: 1,
    errors: [],
  });
});

test("ReconciliationService reports hedge intent conflicts without stopping later events", async () => {
  const hedgeService = new HedgeService();
  const settlementEventService = new SettlementEventService(new InventoryService());
  const laterQuote = { ...quote, amountOut: "970", minAmountOut: "960", nonce: "4" };
  const conflictSettlement = settlementEventService.applySettlementEvent({
    quoteId: "q_hedge_conflict",
    quote,
    txHash: `0x${"15".repeat(32)}`,
  });
  const laterSettlement = settlementEventService.applySettlementEvent({
    quoteId: "q_hedge_after_conflict",
    quote: laterQuote,
    txHash: `0x${"16".repeat(32)}`,
  });
  const conflictingHedge = hedgeService.createHedgeIntent({
    settlementEventId: conflictSettlement.event.settlementEventId,
    quoteId: "q_different_hedge_quote",
    chainId: quote.chainId,
    token: quote.tokenOut,
    side: "buy",
    amount: "1",
    reason: "inventory_rebalance",
  });

  const report = await new ReconciliationService({
    hedgeService,
    quoteRepository: new InMemoryQuoteRepository(),
    settlementEventService,
  }).reconcileSettlementToHedge();

  assert.equal(report.scannedSettlementEvents, 2);
  assert.equal(report.repairedHedgeIntents, 1);
  assert.equal(report.skippedHedgeIntents, 0);
  assert.deepEqual(report.errors, [
    {
      settlementEventId: conflictSettlement.event.settlementEventId,
      quoteId: "q_hedge_conflict",
      reason: `Hedge intent conflict for ${conflictingHedge.hedgeOrderId}`,
    },
  ]);

  const conflictHedge = hedgeService.getHedgeIntentBySettlementEvent(conflictSettlement.event.settlementEventId);
  const laterHedge = hedgeService.getHedgeIntentBySettlementEvent(laterSettlement.event.settlementEventId);
  assert.equal(conflictHedge.quoteId, "q_different_hedge_quote");
  assert.equal(conflictHedge.amount, "1");
  assert.equal(laterHedge.quoteId, "q_hedge_after_conflict");
  assert.equal(laterHedge.amount, "970");
});

test("ReconciliationService requires hedge service for settlement-to-hedge repair", async () => {
  const reconciliation = new ReconciliationService({
    quoteRepository: new InMemoryQuoteRepository(),
    settlementEventService: new SettlementEventService(new InventoryService()),
  });

  await assert.rejects(
    reconciliation.reconcileSettlementToHedge(),
    /hedgeService is required for settlement-to-hedge reconciliation/,
  );
  await assert.rejects(
    reconciliation.reconcileRemovedSettlementToHedge({
      settlementEventId: "se_removed_hedge",
      status: "applied",
      quoteId: "q_removed_hedge",
      chainId: quote.chainId,
      txHash: `0x${"26".repeat(32)}`,
      quoteHash: `0x${"27".repeat(32)}`,
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
    /hedgeService is required for removed-settlement-to-hedge reconciliation/,
  );
});
