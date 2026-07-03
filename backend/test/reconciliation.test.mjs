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

test("ReconciliationService snapshots dependency object at construction", async () => {
  const quoteRepository = new InMemoryQuoteRepository();
  const settlementEventService = new SettlementEventService(new InventoryService());
  await saveSignedQuote(quoteRepository, "q_snapshot_deps", quote);
  const settlement = settlementEventService.applySettlementEvent({
    quoteId: "q_snapshot_deps",
    quote,
    txHash: `0x${"ab".repeat(32)}`,
    blockNumber: 101,
    logIndex: 4,
  });
  const deps = {
    quoteRepository,
    settlementEventService,
  };
  const reconciliation = new ReconciliationService(deps);

  deps.quoteRepository = new InMemoryQuoteRepository();
  deps.settlementEventService = new SettlementEventService(new InventoryService());

  const report = await reconciliation.reconcileSettlementToQuote();

  assert.deepEqual(report, {
    scannedSettlementEvents: 1,
    repairedQuoteStatuses: 1,
    skippedQuoteStatuses: 0,
    errors: [],
  });
  const status = await quoteRepository.findStatus("q_snapshot_deps");
  assert.equal(status.status, "settled");
  assert.equal(status.settlementEventId, settlement.event.settlementEventId);
  assert.equal(await deps.quoteRepository.findStatus("q_snapshot_deps"), undefined);
});

test("ReconciliationService rejects unsafe dependency configuration at construction", () => {
  const deps = reconciliationServiceDeps();

  assert.throws(
    () => new ReconciliationService(undefined),
    /ReconciliationService deps must be an object/,
  );
  assert.throws(
    () => new ReconciliationService([]),
    /ReconciliationService deps must be an object/,
  );
  assert.throws(
    () => new ReconciliationService(Object.create(deps)),
    /ReconciliationService deps.quoteRepository must be an own field/,
  );

  const depsWithInheritedPnlService = {
    quoteRepository: deps.quoteRepository,
    settlementEventService: deps.settlementEventService,
  };
  Object.setPrototypeOf(depsWithInheritedPnlService, {
    pnlService: new PnlService(),
  });
  assert.throws(
    () => new ReconciliationService(depsWithInheritedPnlService),
    /ReconciliationService deps.pnlService must be an own field when provided/,
  );

  const depsWithInheritedHedgeService = {
    quoteRepository: deps.quoteRepository,
    settlementEventService: deps.settlementEventService,
  };
  Object.setPrototypeOf(depsWithInheritedHedgeService, {
    hedgeService: new HedgeService(),
  });
  assert.throws(
    () => new ReconciliationService(depsWithInheritedHedgeService),
    /ReconciliationService deps.hedgeService must be an own field when provided/,
  );
  assert.throws(
    () =>
      new ReconciliationService({
        ...deps,
        settlementEventService: [],
      }),
    /ReconciliationService settlementEventService must be an object/,
  );
  assert.throws(
    () =>
      new ReconciliationService({
        ...deps,
        quoteRepository: [],
      }),
    /ReconciliationService quoteRepository must be an object/,
  );
  assert.throws(
    () =>
      new ReconciliationService({
        ...deps,
        settlementEventService: {},
      }),
    /ReconciliationService settlementEventService.listSettlementEvents must be a function/,
  );
  assert.throws(
    () =>
      new ReconciliationService({
        ...deps,
        quoteRepository: {},
      }),
    /ReconciliationService quoteRepository.findStatus must be a function/,
  );
  assert.throws(
    () =>
      new ReconciliationService({
        ...deps,
        pnlService: "bad pnl dependency",
      }),
    /ReconciliationService pnlService must be an object when provided/,
  );
  assert.throws(
    () =>
      new ReconciliationService({
        ...deps,
        pnlService: [],
      }),
    /ReconciliationService pnlService must be an object when provided/,
  );
  assert.throws(
    () =>
      new ReconciliationService({
        ...deps,
        pnlService: {
          summary() {
            return { totalTrades: 0 };
          },
        },
      }),
    /ReconciliationService pnlService.recordSettlement must be a function when provided/,
  );
  assert.throws(
    () =>
      new ReconciliationService({
        ...deps,
        hedgeService: "bad hedge dependency",
      }),
    /ReconciliationService hedgeService must be an object when provided/,
  );
  assert.throws(
    () =>
      new ReconciliationService({
        ...deps,
        hedgeService: [],
      }),
    /ReconciliationService hedgeService must be an object when provided/,
  );
  assert.throws(
    () =>
      new ReconciliationService({
        ...deps,
        hedgeService: {
          createHedgeIntent() {
            throw new Error("unused");
          },
        },
      }),
    /ReconciliationService hedgeService.getHedgeIntentBySettlementEvent must be a function when provided/,
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

test("ReconciliationService repairs PnL records from settlement events and signed quotes", async () => {
  const quoteRepository = new InMemoryQuoteRepository();
  const pnlService = new PnlService();
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
    pnlService: new PnlService(),
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
  const pnlService = new PnlService();
  const settlementEventService = new SettlementEventService(new InventoryService());
  const conflictingQuote = { ...quote, amountOut: "985" };
  const laterQuote = { ...quote, amountOut: "970", minAmountOut: "960", nonce: "3" };
  await saveSignedQuote(quoteRepository, "q_pnl_conflict", quote);
  await saveSignedQuote(quoteRepository, "q_pnl_after_conflict", laterQuote);
  pnlService.recordSettlement({
    quoteId: "q_pnl_conflict",
    quote: conflictingQuote,
  });

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
});

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
