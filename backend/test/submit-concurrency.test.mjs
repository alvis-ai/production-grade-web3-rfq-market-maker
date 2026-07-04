import assert from "node:assert/strict";
import test from "node:test";
import { buildServer } from "../dist/main.js";
import { LocalSettlementVerifier } from "../dist/modules/settlement/settlement-verifier.service.js";

const baseQuoteRequest = {
  chainId: 1,
  user: "0x0000000000000000000000000000000000000001",
  tokenIn: "0x0000000000000000000000000000000000000002",
  tokenOut: "0x0000000000000000000000000000000000000003",
  amountIn: "1000000000",
  slippageBps: 50,
};

test("RFQ API rejects replayed submit quotes", async () => {
  const server = buildServer({ logger: false });
  await server.ready();

  try {
    const quote = await injectJson(server, "POST", "/quote", baseQuoteRequest);
    assert.equal(quote.statusCode, 200);
    const submitPayload = {
      quote: quotePayloadFromResponse(quote.body),
      signature: quote.body.signature,
    };

    const firstSubmit = await injectJson(server, "POST", "/submit", submitPayload);
    assert.equal(firstSubmit.statusCode, 202);

    const replay = await injectJson(server, "POST", "/submit", submitPayload);
    assert.equal(replay.statusCode, 409);
    assert.equal(replay.body.code, "QUOTE_ALREADY_USED");
    assert.match(replay.body.traceId, /^tr_/);

    const status = await injectJson(server, "GET", `/quote/${quote.body.quoteId}`);
    assert.equal(status.statusCode, 200);
    assert.equal(status.body.status, "settled");
    assert.equal(status.body.txHash, firstSubmit.body.txHash);
    assert.equal(status.body.settlementEventId, firstSubmit.body.settlementEventId);
    assert.equal(status.body.hedgeOrderId, firstSubmit.body.hedgeOrderId);
    assert.equal(status.body.pnlId, firstSubmit.body.pnlId);

    const metrics = await server.inject({ method: "GET", url: "/metrics" });
    assert.equal(metrics.statusCode, 200);
    assert.match(metrics.payload, /rfq_submit_requests_total 2/);
    assert.match(metrics.payload, /rfq_submit_accepted_total 1/);
    assert.match(metrics.payload, /rfq_submit_errors_total 1/);
    assert.match(metrics.payload, /rfq_settlements_total 1/);
    assert.match(
      metrics.payload,
      new RegExp(`rfq_inventory_balance\\{chain_id="1",token="${baseQuoteRequest.tokenIn}"\\} ${baseQuoteRequest.amountIn}`),
    );
  } finally {
    await server.close();
  }
});

test("RFQ API rejects concurrent submit attempts for the same signed quote", async () => {
  let resolveFirstVerifierStarted;
  let releaseFirstVerifier;
  const firstVerifierStarted = new Promise((resolve) => {
    resolveFirstVerifierStarted = resolve;
  });
  const firstVerifierGate = new Promise((resolve) => {
    releaseFirstVerifier = resolve;
  });
  const localVerifier = new LocalSettlementVerifier();
  let verifyCalls = 0;
  const server = buildServer({
    logger: false,
    settlementVerifier: {
      async verify(input) {
        verifyCalls += 1;
        if (verifyCalls === 1) {
          resolveFirstVerifierStarted();
          await firstVerifierGate;
        }

        return localVerifier.verify(input);
      },
    },
  });
  await server.ready();

  try {
    const quote = await injectJson(server, "POST", "/quote", baseQuoteRequest);
    assert.equal(quote.statusCode, 200);
    const submitPayload = {
      quote: quotePayloadFromResponse(quote.body),
      signature: quote.body.signature,
    };

    const firstSubmitPromise = injectJson(server, "POST", "/submit", submitPayload);
    await firstVerifierStarted;
    const concurrentReplay = await injectJson(server, "POST", "/submit", submitPayload);
    releaseFirstVerifier();
    const firstSubmit = await firstSubmitPromise;

    assert.equal(firstSubmit.statusCode, 202);
    assert.equal(concurrentReplay.statusCode, 409);
    assert.equal(concurrentReplay.body.code, "QUOTE_ALREADY_USED");
    assert.equal(verifyCalls, 1);

    const status = await injectJson(server, "GET", `/quote/${quote.body.quoteId}`);
    assert.equal(status.statusCode, 200);
    assert.equal(status.body.status, "settled");
    assert.equal(status.body.txHash, firstSubmit.body.txHash);
    assert.equal(status.body.settlementEventId, firstSubmit.body.settlementEventId);
    assert.equal(status.body.hedgeOrderId, firstSubmit.body.hedgeOrderId);
    assert.equal(status.body.pnlId, firstSubmit.body.pnlId);

    const settlement = await injectJson(server, "GET", `/settlements/${firstSubmit.body.settlementEventId}`);
    assert.equal(settlement.statusCode, 200);
    assert.equal(settlement.body.quoteId, quote.body.quoteId);

    const metrics = await server.inject({ method: "GET", url: "/metrics" });
    assert.equal(metrics.statusCode, 200);
    assert.match(metrics.payload, /rfq_submit_requests_total 2/);
    assert.match(metrics.payload, /rfq_submit_accepted_total 1/);
    assert.match(metrics.payload, /rfq_submit_errors_total 1/);
    assert.match(metrics.payload, /rfq_settlements_total 1/);
    assert.match(metrics.payload, /rfq_hedge_intents_total 1/);
    assert.match(metrics.payload, /rfq_pnl_trades_total 1/);
  } finally {
    releaseFirstVerifier?.();
    await server.close();
  }
});

async function injectJson(server, method, url, payload, headers = {}) {
  const response = await server.inject({
    method,
    url,
    headers: {
      ...(payload ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    payload: payload === undefined ? undefined : JSON.stringify(payload),
  });

  return {
    statusCode: response.statusCode,
    headers: response.headers,
    body: response.payload ? JSON.parse(response.payload) : undefined,
  };
}

function quotePayloadFromResponse(quote) {
  return {
    user: baseQuoteRequest.user,
    tokenIn: baseQuoteRequest.tokenIn,
    tokenOut: baseQuoteRequest.tokenOut,
    amountIn: baseQuoteRequest.amountIn,
    amountOut: quote.amountOut,
    minAmountOut: quote.minAmountOut,
    nonce: quote.nonce,
    deadline: quote.deadline,
    chainId: baseQuoteRequest.chainId,
  };
}
