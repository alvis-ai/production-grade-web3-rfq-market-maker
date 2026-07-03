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

test("HedgeService rejects unsafe failure penalty configuration at construction", () => {
  assert.throws(
    () => new HedgeService(null),
    /Hedge config must be an object/,
  );
  assert.throws(
    () => new HedgeService([]),
    /Hedge config must be an object/,
  );

  assert.throws(
    () =>
      new HedgeService(
        Object.create({
          failurePenaltyBps: 25,
          maxFailurePenaltyBps: 100,
        }),
      ),
    /Hedge config.failurePenaltyBps must be an own field/,
  );

  assert.throws(
    () =>
      new HedgeService({
        failurePenaltyBps: 0,
        maxFailurePenaltyBps: 100,
      }),
    /Hedge failurePenaltyBps must be a positive safe integer/,
  );

  assert.throws(
    () =>
      new HedgeService({
        failurePenaltyBps: 25,
        maxFailurePenaltyBps: Number.MAX_SAFE_INTEGER + 1,
      }),
    /Hedge maxFailurePenaltyBps must be a positive safe integer/,
  );

  assert.throws(
    () =>
      new HedgeService({
        failurePenaltyBps: 25,
        maxFailurePenaltyBps: 10_001,
      }),
    /Hedge maxFailurePenaltyBps must be less than or equal to 10000 bps/,
  );

  assert.throws(
    () =>
      new HedgeService({
        failurePenaltyBps: 200,
        maxFailurePenaltyBps: 100,
      }),
    /Hedge failurePenaltyBps must be less than or equal to maxFailurePenaltyBps/,
  );
});

test("HedgeService rejects malformed intent and risk payload envelopes before state writes", () => {
  const service = new HedgeService();

  assert.throws(
    () => service.createHedgeIntent(undefined),
    /Hedge intent must be an object/,
  );
  assert.throws(
    () => service.createHedgeIntent([]),
    /Hedge intent must be an object/,
  );
  assert.throws(
    () => service.recordHedgeFailure(undefined, "HEDGE_INTENT_FAILED"),
    /Hedge intent must be an object/,
  );
  assert.throws(
    () => service.quoteRiskPenaltyBps(undefined),
    /Hedge risk input must be an object/,
  );

  assert.equal(service.getHedgeIntentBySettlementEvent(intent.settlementEventId), undefined);
  assert.equal(service.quoteRiskPenaltyBps({ chainId: intent.chainId, token: intent.token }), 0);

  const valid = service.createHedgeIntent(intent);
  assert.equal(valid.hedgeOrderId, "h_1_00000000_000001");
});

test("HedgeService rejects inherited intent and risk fields before state writes", () => {
  const service = new HedgeService();

  assert.throws(
    () => service.createHedgeIntent(Object.create(intent)),
    /Hedge intent.settlementEventId must be an own field/,
  );

  const inheritedAmountIntent = Object.create({ amount: intent.amount });
  Object.assign(inheritedAmountIntent, {
    settlementEventId: intent.settlementEventId,
    quoteId: intent.quoteId,
    chainId: intent.chainId,
    token: intent.token,
    side: intent.side,
    reason: intent.reason,
  });
  assert.throws(
    () => service.recordHedgeFailure(inheritedAmountIntent, "HEDGE_INTENT_FAILED"),
    /Hedge intent.amount must be an own field/,
  );

  assert.throws(
    () =>
      service.quoteRiskPenaltyBps(
        Object.create({
          chainId: intent.chainId,
          token: intent.token,
        }),
      ),
    /Hedge risk input.chainId must be an own field/,
  );

  assert.equal(service.getHedgeIntentBySettlementEvent(intent.settlementEventId), undefined);
  assert.equal(service.quoteRiskPenaltyBps({ chainId: intent.chainId, token: intent.token }), 0);
});

test("HedgeService rejects unsafe intent inputs before writing hedge state", () => {
  const service = new HedgeService();

  assert.throws(
    () => service.createHedgeIntent({ ...intent, settlementEventId: " " }),
    /Hedge settlementEventId must be a non-empty string/,
  );
  assert.throws(
    () => service.createHedgeIntent({ ...intent, settlementEventId: new String(intent.settlementEventId) }),
    /Hedge settlementEventId must be a primitive string/,
  );
  assert.throws(
    () => service.createHedgeIntent({ ...intent, settlementEventId: "se.bad" }),
    /Hedge settlementEventId must contain only letters, numbers, underscore, colon, or hyphen/,
  );
  assert.throws(
    () => service.createHedgeIntent({ ...intent, quoteId: new String(intent.quoteId) }),
    /Hedge quoteId must be a primitive string/,
  );
  assert.throws(
    () => service.createHedgeIntent({ ...intent, quoteId: "q".repeat(129) }),
    /Hedge quoteId must be 128 characters or fewer/,
  );
  assert.throws(
    () => service.createHedgeIntent({ ...intent, token: "0x1234" }),
    /Hedge token must be a 20-byte hex address/,
  );
  assert.throws(
    () => service.createHedgeIntent({ ...intent, token: new String(intent.token) }),
    /Hedge token must be a 20-byte hex address/,
  );
  assert.throws(
    () => service.createHedgeIntent({ ...intent, amount: "0" }),
    /Hedge amount must be a positive uint string/,
  );
  assert.throws(
    () => service.createHedgeIntent({ ...intent, amount: "0100" }),
    /Hedge amount must be a positive uint string/,
  );
  assert.throws(
    () => service.createHedgeIntent({ ...intent, side: "hold" }),
    /Hedge side must be buy or sell/,
  );
  assert.throws(
    () => service.createHedgeIntent({ ...intent, reason: "manual" }),
    /Hedge reason must be inventory_rebalance or risk_reduction/,
  );

  const valid = service.createHedgeIntent(intent);
  assert.equal(valid.hedgeOrderId, "h_1_00000000_000001");
});

test("HedgeService rejects unsafe hedge status lookup identifiers", () => {
  const service = new HedgeService();

  assert.throws(
    () => service.getHedgeIntent(" "),
    /Hedge hedgeOrderId must be a non-empty string/,
  );
  assert.throws(
    () => service.getHedgeIntent(new String("h_1_00000000_000001")),
    /Hedge hedgeOrderId must be a primitive string/,
  );
  assert.throws(
    () => service.getHedgeIntent("h/bad"),
    /Hedge hedgeOrderId must contain only letters, numbers, underscore, colon, or hyphen/,
  );
  assert.throws(
    () => service.getHedgeIntent("h".repeat(129)),
    /Hedge hedgeOrderId must be 128 characters or fewer/,
  );
  assert.throws(
    () => service.getHedgeIntentBySettlementEvent("se/bad"),
    /Hedge settlementEventId must contain only letters, numbers, underscore, colon, or hyphen/,
  );
  assert.throws(
    () => service.getHedgeIntentBySettlementEvent(new String(intent.settlementEventId)),
    /Hedge settlementEventId must be a primitive string/,
  );

  const valid = service.createHedgeIntent(intent);
  assert.deepEqual(service.getHedgeIntent(valid.hedgeOrderId), valid.record);
  assert.deepEqual(service.getHedgeIntentBySettlementEvent(intent.settlementEventId), valid.record);
});

test("HedgeService rejects unsafe risk feedback inputs before recording pressure", () => {
  const service = new HedgeService({
    failurePenaltyBps: 40,
    maxFailurePenaltyBps: 100,
  });

  assert.throws(
    () => service.recordHedgeFailure({ ...intent, chainId: 0 }, "HEDGE_INTENT_FAILED"),
    /Hedge chainId must be a positive safe integer/,
  );
  assert.throws(
    () => service.recordHedgeFailure({ ...intent, amount: "0100" }, "HEDGE_INTENT_FAILED"),
    /Hedge amount must be a positive uint string/,
  );
  assert.throws(
    () => service.quoteRiskPenaltyBps({ chainId: 1, token: "0x1234" }),
    /Hedge token must be a 20-byte hex address/,
  );
  assert.throws(
    () => service.quoteRiskPenaltyBps({ chainId: 1, token: new String(intent.token) }),
    /Hedge token must be a 20-byte hex address/,
  );
  assert.equal(service.quoteRiskPenaltyBps({ chainId: intent.chainId, token: intent.token }), 0);
});
