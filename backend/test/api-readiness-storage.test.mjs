import assert from "node:assert/strict";
import test from "node:test";
import { buildServer } from "../dist/main.js";
import { InMemoryQuoteRepository } from "../dist/modules/quote/quote.repository.js";

test("RFQ API degrades readiness when storage dependency probes fail", async () => {
  const quoteRepository = new InMemoryQuoteRepository();
  quoteRepository.checkHealth = async () => {
    throw new Error("quote store offline");
  };
  const server = buildServer({
    logger: false,
    quoteRepository,
    marketSnapshotStore: {
      checkHealth() {
        throw new Error("market snapshot store offline");
      },
      async saveSnapshot() {
        throw new Error("unused");
      },
      async findBySnapshotId() {
        return undefined;
      },
    },
    riskDecisionStore: {
      checkHealth() {
        throw new Error("risk decision store offline");
      },
      async saveDecision() {
        throw new Error("unused");
      },
      async findByQuoteId() {
        return undefined;
      },
    },
    hedgeService: {
      checkHealth() {
        throw new Error("hedge store offline");
      },
      createHedgeIntent() {
        throw new Error("unused");
      },
      getHedgeIntent() {
        return undefined;
      },
      quoteRiskPenaltyBps() {
        return 0;
      },
    },
    settlementEventService: {
      checkHealth() {
        throw new Error("settlement event store offline");
      },
      applySettlementEvent() {
        throw new Error("unused");
      },
      getSettlementEvent() {
        return undefined;
      },
    },
    pnlService: {
      checkHealth() {
        throw new Error("pnl store offline");
      },
      recordSettlement() {
        throw new Error("unused");
      },
      summary() {
        return {
          status: "ok",
          totalTrades: 0,
          grossPnlTokenOut: "0",
          trades: [],
        };
      },
    },
  });
  await server.ready();

  try {
    const response = await injectJson(server, "GET", "/ready");

    assert.equal(response.statusCode, 503);
    assert.equal(response.body.status, "degraded");
    assert.equal(response.body.components.marketData, "ok");
    assert.equal(response.body.components.signer, "ok");
    assert.equal(response.body.components.marketSnapshotStore, "degraded");
    assert.equal(response.body.components.quoteRepository, "degraded");
    assert.equal(response.body.components.riskDecisionStore, "degraded");
    assert.equal(response.body.components.rateLimitStore, "ok");
    assert.equal(response.body.components.execution, "degraded");
    assert.equal(response.body.components.settlementEventStore, "degraded");
    assert.equal(response.body.components.pnl, "degraded");

    const metrics = await server.inject({ method: "GET", url: "/metrics" });
    assert.equal(metrics.statusCode, 200);
    assert.match(metrics.payload, /rfq_dependency_status\{component="marketSnapshotStore",status="degraded"\} 1/);
    assert.match(metrics.payload, /rfq_dependency_status\{component="quoteRepository",status="degraded"\} 1/);
    assert.match(metrics.payload, /rfq_dependency_status\{component="riskDecisionStore",status="degraded"\} 1/);
    assert.match(metrics.payload, /rfq_dependency_status\{component="execution",status="degraded"\} 1/);
    assert.match(metrics.payload, /rfq_dependency_status\{component="settlementEventStore",status="degraded"\} 1/);
    assert.match(metrics.payload, /rfq_dependency_status\{component="pnl",status="degraded"\} 1/);
  } finally {
    await server.close();
  }
});

async function injectJson(server, method, url, payload, headers = {}) {
  const requestHeaders = { ...headers };
  if (payload) {
    requestHeaders["content-type"] = "application/json";
  }

  const response = await server.inject({
    method,
    url,
    headers: Object.keys(requestHeaders).length > 0 ? requestHeaders : undefined,
    payload: payload ? JSON.stringify(payload) : undefined,
  });

  return {
    statusCode: response.statusCode,
    headers: response.headers,
    body: response.payload ? JSON.parse(response.payload) : undefined,
  };
}
