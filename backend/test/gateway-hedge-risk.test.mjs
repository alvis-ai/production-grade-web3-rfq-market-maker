import assert from "node:assert/strict";
import test from "node:test";
import { HedgeService } from "../dist/modules/hedge/hedge.service.js";
import { readGatewayHedgeServiceConfig } from "../dist/runtime/gateway-hedge-risk.js";

test("gateway hedge risk config uses bounded defaults and explicit overrides", () => {
  assert.deepEqual(readGatewayHedgeServiceConfig({}), {
    failurePenaltyBps: 25,
    maxFailurePenaltyBps: 150,
    failureLookbackMs: 300_000,
  });
  assert.deepEqual(readGatewayHedgeServiceConfig({
    RFQ_HEDGE_FAILURE_PENALTY_BPS: "40",
    RFQ_HEDGE_MAX_FAILURE_PENALTY_BPS: "200",
    RFQ_HEDGE_FAILURE_LOOKBACK_MS: "600000",
  }), {
    failurePenaltyBps: 40,
    maxFailurePenaltyBps: 200,
    failureLookbackMs: 600_000,
  });
});

test("gateway hedge risk config rejects unsafe values and inherited environment fields", () => {
  assert.throws(
    () => readGatewayHedgeServiceConfig({ RFQ_HEDGE_FAILURE_LOOKBACK_MS: "300000ms" }),
    /RFQ_HEDGE_FAILURE_LOOKBACK_MS must be a base-10 integer between 1000 and 86400000/,
  );
  assert.throws(
    () => new HedgeService(readGatewayHedgeServiceConfig({
      RFQ_HEDGE_FAILURE_PENALTY_BPS: "200",
      RFQ_HEDGE_MAX_FAILURE_PENALTY_BPS: "100",
    })),
    /failurePenaltyBps must be less than or equal to maxFailurePenaltyBps/,
  );

  const inherited = Object.create({
    RFQ_HEDGE_FAILURE_PENALTY_BPS: "999",
    RFQ_HEDGE_MAX_FAILURE_PENALTY_BPS: "999",
    RFQ_HEDGE_FAILURE_LOOKBACK_MS: "999000",
  });
  assert.deepEqual(readGatewayHedgeServiceConfig(inherited), {
    failurePenaltyBps: 25,
    maxFailurePenaltyBps: 150,
    failureLookbackMs: 300_000,
  });
});
