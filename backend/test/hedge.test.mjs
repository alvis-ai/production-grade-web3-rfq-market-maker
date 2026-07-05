import assert from "node:assert/strict";
import test from "node:test";
import { HedgeService } from "../dist/modules/hedge/hedge.service.js";

const intent = {
  settlementEventId: "se_1_22222222_0",
  quoteId: "q_1",
  chainId: 1,
  token: "0x0000000000000000000000000000000000000003",
  side: "buy",
  amount: "1000000000",
  reason: "inventory_rebalance",
};

test("HedgeService accumulates bounded quote risk penalty after hedge failures", () => {
  const service = new HedgeService({
    failurePenaltyBps: 40,
    maxFailurePenaltyBps: 100,
  });

  assert.equal(service.quoteRiskPenaltyBps({ chainId: intent.chainId, token: intent.token }), 0);

  service.recordHedgeFailure(intent, "HEDGE_INTENT_FAILED");
  service.recordHedgeFailure(intent, "HEDGE_INTENT_FAILED");
  service.recordHedgeFailure(intent, "HEDGE_INTENT_FAILED");

  assert.equal(service.quoteRiskPenaltyBps({ chainId: intent.chainId, token: intent.token }), 100);
  assert.equal(
    service.quoteRiskPenaltyBps({
      chainId: intent.chainId,
      token: "0x0000000000000000000000000000000000000002",
    }),
    0,
  );
});

test("HedgeService snapshots failure penalty configuration at construction", () => {
  const mutableConfig = {
    failurePenaltyBps: 40,
    maxFailurePenaltyBps: 100,
  };
  const service = new HedgeService(mutableConfig);

  mutableConfig.failurePenaltyBps = 1;
  mutableConfig.maxFailurePenaltyBps = 1;

  service.recordHedgeFailure(intent, "HEDGE_INTENT_FAILED");
  service.recordHedgeFailure(intent, "HEDGE_INTENT_FAILED");
  service.recordHedgeFailure(intent, "HEDGE_INTENT_FAILED");

  assert.equal(service.quoteRiskPenaltyBps({ chainId: intent.chainId, token: intent.token }), 100);
});

test("HedgeService returns the existing hedge intent for settlement retries", () => {
  const service = new HedgeService();

  const first = service.createHedgeIntent(intent);
  const retry = service.createHedgeIntent(intent);

  assert.equal(retry.hedgeOrderId, first.hedgeOrderId);
  assert.deepEqual(retry.record, first.record);
  assert.notEqual(retry.record, first.record);
  assert.deepEqual(service.getHedgeIntent(first.hedgeOrderId), first.record);
  assert.deepEqual(service.getHedgeIntentBySettlementEvent(intent.settlementEventId), first.record);

  const next = service.createHedgeIntent({
    ...intent,
    settlementEventId: "se_1_33333333_0",
  });
  assert.notEqual(next.hedgeOrderId, first.hedgeOrderId);
});

test("HedgeService rejects conflicting retry payloads for the same settlement event", () => {
  const service = new HedgeService();
  const first = service.createHedgeIntent(intent);

  assert.throws(
    () =>
      service.createHedgeIntent({
        ...intent,
        quoteId: "q_retry_should_not_replace_original",
        amount: "2000000000",
      }),
    /Hedge intent conflict/,
  );

  assert.deepEqual(service.getHedgeIntent(first.hedgeOrderId), first.record);
});

test("HedgeService returns defensive copies of hedge intent status records", () => {
  const service = new HedgeService();
  const created = service.createHedgeIntent(intent);

  created.record.status = "failed";
  created.record.amount = "1";

  const loaded = service.getHedgeIntent(created.hedgeOrderId);
  assert.equal(loaded.status, "queued");
  assert.equal(loaded.amount, intent.amount);

  loaded.status = "failed";
  const bySettlement = service.getHedgeIntentBySettlementEvent(intent.settlementEventId);
  assert.equal(bySettlement.status, "queued");
  assert.equal(bySettlement.amount, intent.amount);
});

test("HedgeService records filled and failed hedge outcomes as terminal status", () => {
  const filledService = new HedgeService();
  const filledCreated = filledService.createHedgeIntent(intent);

  const filled = filledService.markHedgeIntentFilled({
    hedgeOrderId: filledCreated.hedgeOrderId,
    externalOrderId: "cex_order_1",
  });

  assert.equal(filled.updated, true);
  assert.equal(filled.record.hedgeOrderId, filledCreated.hedgeOrderId);
  assert.equal(filled.record.status, "filled");
  assert.equal(filled.record.externalOrderId, "cex_order_1");
  assert.match(filled.record.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(filledService.getHedgeIntent(filledCreated.hedgeOrderId), filled.record);

  filled.record.status = "failed";
  filled.record.externalOrderId = "mutated";
  const loadedFilled = filledService.getHedgeIntentBySettlementEvent(intent.settlementEventId);
  assert.equal(loadedFilled.status, "filled");
  assert.equal(loadedFilled.externalOrderId, "cex_order_1");
  assert.equal(filledService.createHedgeIntent(intent).status, "filled");

  const duplicateFill = filledService.markHedgeIntentFilled({
    hedgeOrderId: filledCreated.hedgeOrderId,
    externalOrderId: "cex_order_1",
  });
  assert.equal(duplicateFill.updated, false);
  assert.deepEqual(duplicateFill.record, loadedFilled);

  assert.throws(
    () =>
      filledService.markHedgeIntentFilled({
        hedgeOrderId: filledCreated.hedgeOrderId,
        externalOrderId: "cex_order_2",
      }),
    /filled externalOrderId conflict/,
  );
  assert.throws(
    () => filledService.markHedgeIntentFailed(filledCreated.hedgeOrderId),
    /cannot transition from filled to failed/,
  );

  const failedService = new HedgeService();
  const failedCreated = failedService.createHedgeIntent(intent);
  const failed = failedService.markHedgeIntentFailed(failedCreated.hedgeOrderId);

  assert.equal(failed.updated, true);
  assert.equal(failed.record.status, "failed");
  assert.equal(failed.record.externalOrderId, undefined);
  assert.match(failed.record.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(failedService.createHedgeIntent(intent).status, "failed");

  const duplicateFailed = failedService.markHedgeIntentFailed(failedCreated.hedgeOrderId);
  assert.equal(duplicateFailed.updated, false);
  assert.deepEqual(duplicateFailed.record, failedService.getHedgeIntent(failedCreated.hedgeOrderId));
  assert.throws(
    () =>
      failedService.markHedgeIntentFilled({
        hedgeOrderId: failedCreated.hedgeOrderId,
        externalOrderId: "cex_order_1",
      }),
    /cannot transition from failed to filled/,
  );

  assert.deepEqual(
    failedService.markHedgeIntentFilled({
      hedgeOrderId: "h_missing",
      externalOrderId: "cex_order_missing",
    }),
    { updated: false },
  );
  assert.deepEqual(failedService.markHedgeIntentFailed("h_missing"), { updated: false });
});

test("HedgeService removes hedge intents by settlement event after reorgs", () => {
  const service = new HedgeService();
  const created = service.createHedgeIntent(intent);

  const removed = service.removeHedgeIntentBySettlementEvent(intent.settlementEventId);
  assert.equal(removed.removed, true);
  assert.equal(removed.record.hedgeOrderId, created.hedgeOrderId);
  assert.equal(removed.record.amount, intent.amount);

  removed.record.amount = "1";
  const retry = service.removeHedgeIntentBySettlementEvent(intent.settlementEventId);

  assert.deepEqual(retry, { removed: false });
  assert.equal(service.getHedgeIntent(created.hedgeOrderId), undefined);
  assert.equal(service.getHedgeIntentBySettlementEvent(intent.settlementEventId), undefined);

  const recreated = service.createHedgeIntent(intent);
  assert.notEqual(recreated.hedgeOrderId, created.hedgeOrderId);
  assert.deepEqual(service.getHedgeIntentBySettlementEvent(intent.settlementEventId), recreated.record);
});