import { InMemoryQuoteControlStore } from "../../dist/modules/quote-control/quote-control.store.js";
import { InMemoryToxicFlowScoreStore } from "../../dist/modules/risk/toxic-flow-score.store.js";

export function unusedTreasuryLiquidityProvider() {
  return {
    async checkHealth() {},
    async getLiquidity() {
      throw new Error("unused Treasury liquidity provider");
    },
  };
}

export function isolatedGatewayHotStateDependencies() {
  return {
    quoteControlStore: new InMemoryQuoteControlStore(),
    toxicFlowScoreStore: new InMemoryToxicFlowScoreStore(),
    riskEngine: {
      async evaluate() { return { status: "approved", policyVersion: "test-risk-v1" }; },
    },
    settlementIndexerRiskGuard: {
      checkHealth() {},
      async assertQuoteSafe() {},
    },
  };
}
