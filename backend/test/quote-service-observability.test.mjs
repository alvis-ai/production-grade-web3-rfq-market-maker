import assert from "node:assert/strict";
import test from "node:test";
import {
  observeQuoteServiceDependencies,
  quoteLatencyStages,
} from "../dist/modules/quote/quote-service-observability.js";

class StatefulMarketDataService {
  #calls = 0;

  async getSnapshot() {
    this.#calls += 1;
    return this.#calls;
  }
}

test("quote dependency observability records bounded stages and preserves method receivers", async () => {
  const observedStages = [];
  const marketDataService = new StatefulMarketDataService();
  const deps = createDependencies(marketDataService);
  const observed = observeQuoteServiceDependencies(deps, {
    recordQuoteStageLatency(stage, seconds) {
      observedStages.push(stage);
      assert.equal(quoteLatencyStages.includes(stage), true);
      assert.equal(Number.isFinite(seconds), true);
      assert.equal(seconds >= 0, true);
    },
  });

  assert.equal(observed.marketDataService.getSnapshot, observed.marketDataService.getSnapshot);
  assert.equal(await observed.marketDataService.getSnapshot(), 1);
  assert.equal(await observed.marketSnapshotStore.saveSnapshot(), "ok");
  assert.equal(await observed.quoteRepository.saveRequested(), "ok");
  assert.equal(await observed.routingEngine.selectRoute(), "ok");
  assert.equal(await observed.inventoryService.calculateQuoteSkewBps(), "ok");
  assert.equal(await observed.inventoryService.projectSettlement(), "ok");
  assert.equal(await observed.pricingEngine.price(), "ok");
  assert.equal(await observed.riskEngine.evaluate(), "ok");
  assert.equal(await observed.riskDecisionStore.saveDecision(), "ok");
  assert.equal(await observed.signerService.signQuote(), "ok");
  assert.equal(await observed.hedgeService.quoteRiskPenaltyBps(), "ok");
  assert.equal(await observed.quoteIdempotencyStore.acquire(), "ok");
  assert.equal(await observed.quoteExposureStore.reserve(), "ok");
  assert.equal(await observed.treasuryLiquidityProvider.getLiquidity(), "ok");
  assert.equal(await observed.settlementIndexerRiskGuard.assertQuoteSafe(), "ok");

  assert.deepEqual(observedStages, [
    "market_data",
    "market_snapshot_persistence",
    "quote_persistence",
    "routing",
    "pricing_inputs",
    "inventory_projection",
    "pricing",
    "risk",
    "risk_persistence",
    "signing",
    "pricing_inputs",
    "idempotency",
    "exposure_reservation",
    "treasury_liquidity",
    "indexer_guard",
  ]);
});

test("quote dependency observability never changes dependency availability", async () => {
  const observed = observeQuoteServiceDependencies(createDependencies(new StatefulMarketDataService()), {
    recordQuoteStageLatency() {
      throw new Error("metrics unavailable");
    },
  });

  assert.equal(await observed.marketDataService.getSnapshot(), 1);
  await assert.rejects(
    observeQuoteServiceDependencies({
      ...createDependencies(new StatefulMarketDataService()),
      pricingEngine: {
        async price() {
          throw new Error("pricing unavailable");
        },
      },
    }, {
      recordQuoteStageLatency() {
        throw new Error("metrics unavailable");
      },
    }).pricingEngine.price(),
    /pricing unavailable/,
  );
});

function createDependencies(marketDataService) {
  const ok = async () => "ok";
  return {
    inventoryService: {
      calculateQuoteSkewBps: ok,
      projectSettlement: ok,
    },
    marketDataService,
    marketSnapshotStore: { saveSnapshot: ok },
    pricingEngine: { price: ok },
    hedgeService: { quoteRiskPenaltyBps: ok },
    quoteIdempotencyStore: {
      acquire: ok,
      bindQuote: ok,
      complete: ok,
      fail: ok,
      checkHealth: ok,
    },
    quoteRepository: {
      saveRequested: ok,
      saveRouteDecision: ok,
      saveRejected: ok,
      saveSigned: ok,
      findStatus: ok,
      findPrincipalId: ok,
      markStatus: ok,
      markFailed: ok,
      findSignedQuoteByChainUserNonce: ok,
    },
    quoteExposureStore: { reserve: ok, release: ok },
    treasuryLiquidityProvider: { getLiquidity: ok },
    riskDecisionStore: { saveDecision: ok },
    riskEngine: { evaluate: ok },
    routingEngine: { selectRoute: ok },
    settlementIndexerRiskGuard: { checkHealth: ok, assertQuoteSafe: ok },
    signerService: { signQuote: ok, verifyQuoteSignature: ok },
  };
}
