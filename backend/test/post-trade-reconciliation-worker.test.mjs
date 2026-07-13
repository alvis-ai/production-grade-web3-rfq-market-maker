import assert from "node:assert/strict";
import test from "node:test";
import { HedgeService } from "../dist/modules/hedge/hedge.service.js";
import { InventoryService } from "../dist/modules/inventory/inventory.service.js";
import { PnlService } from "../dist/modules/pnl/pnl.service.js";
import { InMemoryQuoteRepository } from "../dist/modules/quote/quote.repository.js";
import { PostTradeReconciliationWorker } from "../dist/modules/reconciliation/post-trade-reconciliation.worker.js";
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
  deadline: 4_102_444_800,
  chainId: 1,
};
const config = {
  workerId: "reconciliation_worker_1",
  leaseMs: 30_000,
  pollIntervalMs: 10,
  retryDelayMs: 1_000,
};

test("PostTradeReconciliationWorker repairs canonical hedge, PnL, and complete quote pointers", async () => {
  const deps = await scenario("q_worker_canonical");
  const settlement = deps.settlementEvents.applySettlementEvent({
    quoteId: deps.quoteId,
    quote,
    txHash: `0x${"41".repeat(32)}`,
    blockNumber: 100,
    logIndex: 2,
  });
  const store = fakeStore(jobFor(deps.quoteId, settlement.event.settlementEventId), [
    { canonical: true, event: settlement.event },
  ]);
  const observer = fakeObserver();
  const worker = new PostTradeReconciliationWorker(store, deps.reconciliation, config, observer, quietLogger());

  assert.equal(await worker.runOnce(), true);

  const status = await deps.quoteRepository.findStatus(deps.quoteId);
  const hedge = deps.hedgeService.getHedgeIntentBySettlementEvent(settlement.event.settlementEventId);
  const pnl = deps.pnlService.getPnlRecordByQuoteId(deps.quoteId);
  assert.equal(status.status, "settled");
  assert.equal(status.settlementEventId, settlement.event.settlementEventId);
  assert.equal(status.hedgeOrderId, hedge.hedgeOrderId);
  assert.equal(status.pnlId, pnl.pnlId);
  assert.deepEqual(observer.jobs, ["repaired"]);
  assert.equal(store.calls.markProcessed.length, 1);
});

test("PostTradeReconciliationWorker removes reversible projections for a non-canonical quote", async () => {
  const deps = await scenario("q_worker_removed");
  const settlement = deps.settlementEvents.applySettlementEvent({
    quoteId: deps.quoteId,
    quote,
    txHash: `0x${"42".repeat(32)}`,
    blockNumber: 101,
    logIndex: 0,
  });
  const hedge = deps.hedgeService.createHedgeIntent({
    settlementEventId: settlement.event.settlementEventId,
    quoteId: deps.quoteId,
    chainId: quote.chainId,
    token: quote.tokenOut,
    side: "buy",
    amount: quote.amountOut,
    reason: "inventory_rebalance",
  });
  const pnl = await deps.pnlService.recordSettlement({
    quoteId: deps.quoteId,
    settlementEventId: settlement.event.settlementEventId,
    snapshotId: `snapshot_${deps.quoteId}`,
    realizedAt: settlement.event.observedAt,
    quote,
  });
  await deps.quoteRepository.markStatus(deps.quoteId, "settled", {
    txHash: settlement.event.txHash,
    settlementEventId: settlement.event.settlementEventId,
    hedgeOrderId: hedge.hedgeOrderId,
    pnlId: pnl.pnlId,
  });
  deps.settlementEvents.removeSettlementEvent({
    chainId: quote.chainId,
    txHash: settlement.event.txHash,
    blockNumber: settlement.event.blockNumber,
    logIndex: settlement.event.logIndex,
  });
  const store = fakeStore(jobFor(deps.quoteId), [{ canonical: false, event: settlement.event }]);
  const observer = fakeObserver();
  const worker = new PostTradeReconciliationWorker(store, deps.reconciliation, config, observer, quietLogger());

  await worker.runOnce();

  const status = await deps.quoteRepository.findStatus(deps.quoteId);
  assert.equal(status.status, "signed");
  assert.equal(status.settlementEventId, undefined);
  assert.equal(deps.hedgeService.getHedgeIntentBySettlementEvent(settlement.event.settlementEventId), undefined);
  assert.equal(deps.pnlService.getPnlRecordByQuoteId(deps.quoteId), undefined);
  assert.deepEqual(observer.jobs, ["repaired"]);
});

test("PostTradeReconciliationWorker preserves a newer desired revision and retries bounded failures", async () => {
  const baseJob = jobFor("q_worker_retry", `se_1_${"43".repeat(32)}_0`);
  const staleStore = fakeStore(baseJob, [{ canonical: true, event: settlementEvent(baseJob) }]);
  staleStore.markProcessed = async (...args) => {
    staleStore.calls.markProcessed.push(args);
    return false;
  };
  const observer = fakeObserver();
  const consistent = fakeReconciliation();
  await new PostTradeReconciliationWorker(staleStore, consistent, config, observer, quietLogger()).runOnce();
  assert.deepEqual(observer.jobs, ["stale_revision"]);

  const retryStore = fakeStore({ ...baseJob, attemptCount: 4 }, [{ canonical: true, event: settlementEvent(baseJob) }]);
  const failing = fakeReconciliation({ hedgeErrors: [{ reason: "offline" }] });
  const retryObserver = fakeObserver();
  await new PostTradeReconciliationWorker(retryStore, failing, config, retryObserver, quietLogger()).runOnce();
  assert.equal(retryStore.calls.releaseForRetry[0][2], "RECONCILIATION_HEDGE_FAILED");
  assert.equal(retryStore.calls.releaseForRetry[0][3], 8_000);
  assert.deepEqual(retryObserver.jobs, ["retry_scheduled"]);
});

test("PostTradeReconciliationWorker stop wakes a long idle poll", async () => {
  const store = fakeStore(undefined, []);
  const worker = new PostTradeReconciliationWorker(
    store,
    fakeReconciliation(),
    { ...config, pollIntervalMs: 60_000 },
    fakeObserver(),
    quietLogger(),
  );
  const task = worker.run();
  await new Promise((resolve) => setImmediate(resolve));
  worker.stop();
  await withTimeout(task, 250);
});

test("PostTradeReconciliationWorker clears quote pointers before deleting referenced projections", async () => {
  const job = jobFor("q_worker_order");
  const store = fakeStore(job, [{ canonical: false, event: settlementEvent({
    ...job,
    desiredSettlementEventId: `se_1_${"45".repeat(32)}_0`,
  }) }]);
  const reconciliation = fakeReconciliation();
  const worker = new PostTradeReconciliationWorker(
    store,
    reconciliation,
    config,
    fakeObserver(),
    quietLogger(),
  );

  await worker.runOnce();

  assert.deepEqual(reconciliation.calls, ["remove_quote", "remove_hedge", "remove_pnl"]);
});

async function scenario(quoteId) {
  const quoteRepository = new InMemoryQuoteRepository();
  await quoteRepository.saveSigned({
    quoteId,
    snapshotId: `snapshot_${quoteId}`,
    slippageBps: 50,
    spreadBps: 8,
    sizeImpactBps: 0,
    marketSpreadBps: 0,
    inventorySkewBps: 0,
    volatilityPremiumBps: 0,
    hedgeCostBps: 0,
    quote,
    pricingVersion: "test-pricing",
    riskPolicyVersion: "test-risk",
    signature: `0x${"11".repeat(64)}1b`,
  });
  const settlementEvents = new SettlementEventService(new InventoryService());
  const hedgeService = new HedgeService();
  const pnlService = new PnlService(createTestPnlValuationProvider());
  return {
    quoteId,
    quoteRepository,
    settlementEvents,
    hedgeService,
    pnlService,
    reconciliation: new ReconciliationService({
      quoteRepository,
      settlementEventService: settlementEvents,
      hedgeService,
      pnlService,
    }),
  };
}

function jobFor(quoteId, desiredSettlementEventId) {
  return {
    quoteId,
    ...(desiredSettlementEventId ? { desiredSettlementEventId } : {}),
    revision: 1,
    attemptCount: 1,
    requestedAt: "2026-07-11T00:00:00.000Z",
  };
}

function settlementEvent(job) {
  return {
    settlementEventId: job.desiredSettlementEventId,
    status: "applied",
    quoteId: job.quoteId,
    chainId: quote.chainId,
    txHash: `0x${"43".repeat(32)}`,
    quoteHash: `0x${"44".repeat(32)}`,
    blockNumber: 1,
    logIndex: 0,
    user: quote.user,
    tokenIn: quote.tokenIn,
    tokenOut: quote.tokenOut,
    amountIn: quote.amountIn,
    amountOut: quote.amountOut,
    nonce: quote.nonce,
    observedAt: "2026-07-11T00:00:00.000Z",
  };
}

function fakeStore(job, events) {
  const calls = { markProcessed: [], releaseForRetry: [] };
  let claimed = false;
  return {
    calls,
    async checkHealth() {},
    async claimNext() {
      if (claimed) return undefined;
      claimed = true;
      return job;
    },
    async listSettlementEvents() { return events; },
    async markProcessed(...args) { calls.markProcessed.push(args); return true; },
    async releaseForRetry(...args) { calls.releaseForRetry.push(args); return true; },
    async stats() { return { pendingCount: job ? 1 : 0 }; },
  };
}

function fakeReconciliation({ hedgeErrors = [] } = {}) {
  const empty = { errors: [] };
  const reconciliation = {
    calls: [],
    async reconcileSettlementEventToHedge() {
      this.calls.push("canonical_hedge");
      return { repairedHedgeIntents: 0, errors: hedgeErrors };
    },
    async reconcileSettlementEventToPnl() { this.calls.push("canonical_pnl"); return { repairedPnlRecords: 0, ...empty }; },
    async reconcileSettlementEventToQuote() { this.calls.push("canonical_quote"); return { repairedQuoteStatuses: 0, ...empty }; },
    async reconcileRemovedSettlementToHedge() { this.calls.push("remove_hedge"); return { removedHedgeIntents: 0, ...empty }; },
    async reconcileRemovedSettlementToPnl() { this.calls.push("remove_pnl"); return { removedPnlRecords: 0, ...empty }; },
    async reconcileRemovedSettlementToQuote() { this.calls.push("remove_quote"); return { repairedQuoteStatuses: 0, ...empty }; },
  };
  return reconciliation;
}

function fakeObserver() {
  return {
    jobs: [],
    iterationErrors: 0,
    recordJob(outcome) { this.jobs.push(outcome); },
    recordIterationError() { this.iterationErrors += 1; },
  };
}

function quietLogger() {
  return { error() {} };
}

async function withTimeout(promise, timeoutMs) {
  let timer;
  try {
    await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("worker did not stop promptly")), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
