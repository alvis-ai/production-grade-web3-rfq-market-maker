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
        settlementEventService: {
          listSettlementEvents() {
            return [];
          },
        },
      }),
    /ReconciliationService settlementEventService.getSettlementEventsByQuoteHash must be a function/,
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
        quoteRepository: {
          async findStatus() {
            return undefined;
          },
          async markStatus() {},
          async restoreSettlementStatus() {},
        },
      }),
    /ReconciliationService quoteRepository.clearSettlementStatus must be a function/,
  );
  assert.throws(
    () =>
      new ReconciliationService({
        ...deps,
        quoteRepository: {
          async findStatus() {
            return undefined;
          },
          async markStatus() {},
        },
      }),
    /ReconciliationService quoteRepository.restoreSettlementStatus must be a function/,
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
        pnlService: {
          summary() {
            return { totalTrades: 0 };
          },
          recordSettlement() {
            throw new Error("unused");
          },
          getPnlRecordByQuoteId() {
            return undefined;
          },
        },
      }),
    /ReconciliationService pnlService.removePnlRecord must be a function when provided/,
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
  assert.throws(
    () =>
      new ReconciliationService({
        ...deps,
        hedgeService: {
          getHedgeIntentBySettlementEvent() {
            return undefined;
          },
          createHedgeIntent() {
            throw new Error("unused");
          },
        },
      }),
    /ReconciliationService hedgeService.removeHedgeIntentBySettlementEvent must be a function when provided/,
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

function reconciliationServiceDeps() {
  const inventoryService = new InventoryService();
  return {
    hedgeService: new HedgeService(),
    pnlService: new PnlService(),
    quoteRepository: new InMemoryQuoteRepository(),
    settlementEventService: new SettlementEventService(inventoryService),
  };
}
