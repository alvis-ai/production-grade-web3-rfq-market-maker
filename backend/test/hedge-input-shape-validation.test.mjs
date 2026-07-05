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
