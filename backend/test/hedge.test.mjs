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
