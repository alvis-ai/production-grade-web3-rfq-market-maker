import assert from "node:assert/strict";
import test from "node:test";
import { buildServer } from "../dist/main.js";
import { InMemorySubmitReservationStore } from "../dist/modules/execution/submit-reservation.store.js";

const quoteRequest = {
  chainId: 1,
  user: "0x0000000000000000000000000000000000000001",
  tokenIn: "0x0000000000000000000000000000000000000002",
  tokenOut: "0x0000000000000000000000000000000000000003",
  amountIn: "1000000000",
  slippageBps: 50,
};

test("RFQ API fails closed when submit reservation acquisition is unavailable", async () => {
  const server = buildServer({
    logger: false,
    submitReservationStore: {
      checkHealth() {},
      async acquire() {
        throw new Error("database unavailable");
      },
      async release() {},
    },
  });
  await server.ready();
  try {
    const quote = await requestQuote(server);
    const response = await submitQuote(server, quote);
    assert.equal(response.statusCode, 503);
    assert.equal(response.body.code, "SUBMIT_RESERVATION_UNAVAILABLE");

    const metrics = await server.inject({ method: "GET", url: "/metrics" });
    assert.match(metrics.payload, /rfq_submit_reservation_errors_total\{operation="acquire"\} 1/);
  } finally {
    await server.close();
  }
});

test("RFQ API preserves accepted settlement when reservation release fails", async () => {
  const inner = new InMemorySubmitReservationStore();
  const server = buildServer({
    logger: false,
    submitReservationStore: {
      checkHealth: () => inner.checkHealth(),
      acquire: (quoteId) => inner.acquire(quoteId),
      async release() {
        throw new Error("release unavailable");
      },
    },
  });
  await server.ready();
  try {
    const quote = await requestQuote(server);
    const response = await submitQuote(server, quote);
    assert.equal(response.statusCode, 202);
    assert.equal(response.body.status, "accepted");

    const metrics = await server.inject({ method: "GET", url: "/metrics" });
    assert.match(metrics.payload, /rfq_submit_reservation_errors_total\{operation="release"\} 1/);
  } finally {
    await server.close();
  }
});

async function requestQuote(server) {
  const response = await injectJson(server, "POST", "/quote", quoteRequest);
  assert.equal(response.statusCode, 200);
  return response.body;
}

async function submitQuote(server, response) {
  return injectJson(server, "POST", "/submit", {
    quote: {
      user: quoteRequest.user,
      tokenIn: quoteRequest.tokenIn,
      tokenOut: quoteRequest.tokenOut,
      amountIn: quoteRequest.amountIn,
      amountOut: response.amountOut,
      minAmountOut: response.minAmountOut,
      nonce: response.nonce,
      deadline: response.deadline,
      chainId: quoteRequest.chainId,
    },
    signature: response.signature,
  });
}

async function injectJson(server, method, url, payload) {
  const response = await server.inject({
    method,
    url,
    headers: { "content-type": "application/json" },
    payload: JSON.stringify(payload),
  });
  return {
    statusCode: response.statusCode,
    body: JSON.parse(response.payload),
  };
}
