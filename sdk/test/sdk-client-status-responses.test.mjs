import assert from "node:assert/strict";
import test from "node:test";
import { RFQClient, RFQClientError } from "../dist/index.js";

const quote = {
  user: "0x0000000000000000000000000000000000000001",
  tokenIn: "0x0000000000000000000000000000000000000002",
  tokenOut: "0x0000000000000000000000000000000000000003",
  amountIn: "1000000000",
  amountOut: "1000000000",
  minAmountOut: "995000000",
  nonce: "42",
  deadline: 1893456000,
  chainId: 1,
};

const readinessComponents = {
  marketData: "ok",
  marketSnapshotStore: "ok",
  routing: "ok",
  pricing: "ok",
  risk: "ok",
  signer: "ok",
  quoteRepository: "ok",
  riskDecisionStore: "ok",
  rateLimitStore: "ok",
  inventory: "ok",
  execution: "ok",
  settlementEventStore: "ok",
  pnl: "ok",
  metrics: "ok",
};

test("RFQClient rejects malformed health and readiness status responses", async () => {
  const malformedHealthCases = [
    Object.create({ status: "ok" }),
    {
      status: "ok",
      version: "debug-build",
    },
  ];

  for (const payload of malformedHealthCases) {
    const restoreHealthFetch = installFetch(async () => jsonResponse(200, payload));

    try {
      const client = new RFQClient("http://127.0.0.1:3000");

      await assert.rejects(
        client.health(),
        (error) => {
          assert.ok(error instanceof RFQClientError);
          assert.equal(error.status, 200);
          assert.equal(error.code, "RFQ_CLIENT_ERROR");
          assert.equal(error.message, "RFQ health response returned malformed status");
          return true;
        },
      );
    } finally {
      restoreHealthFetch();
    }
  }

  const malformedReadinessCases = [
    Object.create({
      status: "ready",
      components: readinessComponents,
    }),
    {
      status: "ready",
      generatedAt: "2026-06-27T00:00:00.000Z",
      components: readinessComponents,
    },
    {
      status: "ready",
      components: {
        ...readinessComponents,
        signer: "unknown",
      },
    },
    {
      status: "ready",
      components: {
        signer: "ok",
      },
    },
    {
      status: "ready",
      components: {
        ...readinessComponents,
        externalUrl: "ok",
      },
    },
  ];

  for (const payload of malformedReadinessCases) {
    const restoreReadyFetch = installFetch(async () => jsonResponse(200, payload));

    try {
      const client = new RFQClient("http://127.0.0.1:3000");

      await assert.rejects(
        client.ready(),
        (error) => {
          assert.ok(error instanceof RFQClientError);
          assert.equal(error.status, 200);
          assert.equal(error.code, "RFQ_CLIENT_ERROR");
          assert.equal(error.message, "RFQ readiness response returned malformed status");
          return true;
        },
      );
    } finally {
      restoreReadyFetch();
    }
  }
});

test("RFQClient rejects malformed hedge status responses", async () => {
  const hedgeResponse = {
    hedgeOrderId: "h_1_00000003_000001",
    status: "queued",
    settlementEventId: "se_1_22222222_0",
    quoteId: "q_test",
    chainId: quote.chainId,
    token: quote.tokenOut,
    side: "buy",
    amount: quote.amountOut,
    reason: "inventory_rebalance",
    createdAt: "2026-06-27T00:00:00.000Z",
  };

  const cases = [
    {
      payload: { ...hedgeResponse, hedgeOrderId: "" },
      message: "RFQ hedge status response returned malformed hedgeOrderId",
    },
    {
      payload: { ...hedgeResponse, hedgeOrderId: "h.bad" },
      message: "RFQ hedge status response returned malformed hedgeOrderId",
    },
    {
      payload: { ...hedgeResponse, settlementEventId: "se".repeat(65) },
      message: "RFQ hedge status response returned malformed settlementEventId",
    },
    {
      payload: { ...hedgeResponse, quoteId: "q/bad" },
      message: "RFQ hedge status response returned malformed quoteId",
    },
    {
      payload: { ...hedgeResponse, status: "submitted" },
      message: "RFQ hedge status response returned malformed status",
    },
    {
      payload: { ...hedgeResponse, venue: "CEX_A" },
      message: "RFQ hedge status response returned malformed venue",
    },
    {
      payload: { ...hedgeResponse, chainId: 0 },
      message: "RFQ hedge status response returned malformed chainId",
    },
    {
      payload: { ...hedgeResponse, chainId: "1" },
      message: "RFQ hedge status response returned malformed chainId",
    },
    {
      payload: { ...hedgeResponse, token: "0x1234" },
      message: "RFQ hedge status response returned malformed token",
    },
    {
      payload: { ...hedgeResponse, side: "hold" },
      message: "RFQ hedge status response returned malformed side",
    },
    {
      payload: { ...hedgeResponse, amount: "0" },
      message: "RFQ hedge status response returned malformed amount",
    },
    {
      payload: { ...hedgeResponse, reason: "manual" },
      message: "RFQ hedge status response returned malformed reason",
    },
    {
      payload: { ...hedgeResponse, createdAt: "not-a-date" },
      message: "RFQ hedge status response returned malformed createdAt",
    },
    {
      payload: { ...hedgeResponse, createdAt: "2026-06-27" },
      message: "RFQ hedge status response returned malformed createdAt",
    },
    {
      payload: { ...hedgeResponse, externalOrderId: " " },
      message: "RFQ hedge status response returned malformed externalOrderId",
    },
    {
      payload: { ...hedgeResponse, filledAmount: "0" },
      message: "RFQ hedge status response returned malformed filledAmount",
    },
    {
      payload: { ...hedgeResponse, failureCode: "bad failure" },
      message: "RFQ hedge status response returned malformed failureCode",
    },
    {
      payload: { ...hedgeResponse, updatedAt: "not-a-date" },
      message: "RFQ hedge status response returned malformed updatedAt",
    },
  ];

  for (const { payload, message } of cases) {
    const restoreFetch = installFetch(async () => jsonResponse(200, payload));

    try {
      const client = new RFQClient("http://127.0.0.1:3000");

      await assert.rejects(
        client.getHedge("h_1_00000003_000001"),
        (error) => {
          assert.ok(error instanceof RFQClientError);
          assert.equal(error.status, 200);
          assert.equal(error.code, "RFQ_CLIENT_ERROR");
          assert.equal(error.message, message);
          return true;
        },
      );
    } finally {
      restoreFetch();
    }
  }
});

test("RFQClient accepts terminal hedge status responses", async () => {
  const terminalResponses = [
    {
      hedgeOrderId: "h_1_00000003_000001",
      status: "filled",
      settlementEventId: "se_1_22222222_0",
      quoteId: "q_test",
      chainId: quote.chainId,
      token: quote.tokenOut,
      side: "buy",
      amount: quote.amountOut,
      reason: "inventory_rebalance",
      createdAt: "2026-06-27T00:00:00.000Z",
      externalOrderId: "cex_order_1",
      filledAmount: quote.amountOut,
      updatedAt: "2026-06-27T00:00:01.000Z",
    },
    {
      hedgeOrderId: "h_1_00000003_000002",
      status: "failed",
      settlementEventId: "se_1_33333333_0",
      quoteId: "q_failed",
      chainId: quote.chainId,
      token: quote.tokenOut,
      side: "buy",
      amount: quote.amountOut,
      reason: "risk_reduction",
      createdAt: "2026-06-27T00:00:00.000Z",
      failureCode: "BINANCE_ORDER_REJECTED",
      updatedAt: "2026-06-27T00:00:02.000Z",
    },
  ];
  let index = 0;
  const restoreFetch = installFetch(async () => jsonResponse(200, terminalResponses[index++]));

  try {
    const client = new RFQClient("http://127.0.0.1:3000");

    assert.deepEqual(await client.getHedge(terminalResponses[0].hedgeOrderId), terminalResponses[0]);
    assert.deepEqual(await client.getHedge(terminalResponses[1].hedgeOrderId), terminalResponses[1]);
  } finally {
    restoreFetch();
  }
});

test("RFQClient returns degraded readiness payloads from HTTP 503", async () => {
  const readinessResponse = {
    status: "degraded",
    components: {
      ...readinessComponents,
      marketData: "degraded",
    },
  };
  const restoreFetch = installFetch(async () => jsonResponse(503, readinessResponse));

  try {
    const client = new RFQClient("http://127.0.0.1:3000");

    assert.deepEqual(await client.ready(), readinessResponse);
  } finally {
    restoreFetch();
  }
});

function installFetch(fetchImpl) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

function jsonResponse(status, payload, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: responseHeaders(headers),
    async json() {
      return payload;
    },
  };
}

function responseHeaders(headers) {
  const normalized = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    get(name) {
      return normalized.get(name.toLowerCase()) ?? null;
    },
  };
}
