import assert from "node:assert/strict";
import test from "node:test";
import { buildServer } from "../dist/main.js";
import { HedgeService } from "../dist/modules/hedge/hedge.service.js";

const baseQuoteRequest = {
  chainId: 1,
  user: "0x0000000000000000000000000000000000000001",
  tokenIn: "0x0000000000000000000000000000000000000002",
  tokenOut: "0x0000000000000000000000000000000000000003",
  amountIn: "1000000000",
  slippageBps: 50,
};

test("RFQ API returns structured errors for missing hedge intents", async () => {
  const server = buildServer({ logger: false });
  await server.ready();

  try {
    const response = await injectJson(server, "GET", "/hedges/h_missing");

    assert.equal(response.statusCode, 404);
    assert.equal(response.body.code, "HEDGE_NOT_FOUND");
    assert.match(response.body.traceId, /^tr_/);
    assert.equal(response.headers["x-trace-id"], response.body.traceId);
  } finally {
    await server.close();
  }
});

test("RFQ API returns filled and failed hedge outcomes from the hedge status store", async () => {
  const hedgeService = new HedgeService();
  const server = buildServer({ logger: false, hedgeService });
  await server.ready();

  try {
    const filledQuote = await injectJson(server, "POST", "/quote", baseQuoteRequest);
    assert.equal(filledQuote.statusCode, 200);

    const filledSubmit = await injectJson(server, "POST", "/submit", {
      quote: quotePayloadFromResponse(filledQuote.body),
      signature: filledQuote.body.signature,
    });
    assert.equal(filledSubmit.statusCode, 202);

    const filled = hedgeService.markHedgeIntentFilled({
      hedgeOrderId: filledSubmit.body.hedgeOrderId,
      externalOrderId: "cex_order_api_1",
    });
    assert.equal(filled.updated, true);

    const filledResponse = await injectJson(server, "GET", `/hedges/${filledSubmit.body.hedgeOrderId}`);
    assert.equal(filledResponse.statusCode, 200);
    assertTraceHeader(filledResponse);
    assertResponseFields(filledResponse.body, [
      "hedgeOrderId",
      "status",
      "settlementEventId",
      "quoteId",
      "chainId",
      "token",
      "side",
      "amount",
      "reason",
      "createdAt",
      "externalOrderId",
      "updatedAt",
    ]);
    assert.equal(filledResponse.body.hedgeOrderId, filledSubmit.body.hedgeOrderId);
    assert.equal(filledResponse.body.status, "filled");
    assert.equal(filledResponse.body.externalOrderId, "cex_order_api_1");
    assert.equal(filledResponse.body.updatedAt, filled.record.updatedAt);

    const failedQuote = await injectJson(server, "POST", "/quote", baseQuoteRequest);
    assert.equal(failedQuote.statusCode, 200);

    const failedSubmit = await injectJson(server, "POST", "/submit", {
      quote: quotePayloadFromResponse(failedQuote.body),
      signature: failedQuote.body.signature,
    });
    assert.equal(failedSubmit.statusCode, 202);

    const failed = hedgeService.markHedgeIntentFailed(failedSubmit.body.hedgeOrderId);
    assert.equal(failed.updated, true);

    const failedResponse = await injectJson(server, "GET", `/hedges/${failedSubmit.body.hedgeOrderId}`);
    assert.equal(failedResponse.statusCode, 200);
    assertTraceHeader(failedResponse);
    assertResponseFields(failedResponse.body, [
      "hedgeOrderId",
      "status",
      "settlementEventId",
      "quoteId",
      "chainId",
      "token",
      "side",
      "amount",
      "reason",
      "createdAt",
      "updatedAt",
    ]);
    assert.equal(failedResponse.body.hedgeOrderId, failedSubmit.body.hedgeOrderId);
    assert.equal(failedResponse.body.status, "failed");
    assert.equal(failedResponse.body.updatedAt, failed.record.updatedAt);
  } finally {
    await server.close();
  }
});

test("RFQ API maps hedge status store failures to structured errors", async () => {
  const server = buildServer({
    logger: false,
    hedgeService: {
      checkHealth() {},
      createHedgeIntent() {
        throw new Error("not used");
      },
      getHedgeIntent() {
        throw new Error("hedge store offline");
      },
    },
  });
  await server.ready();

  try {
    const response = await injectJson(server, "GET", "/hedges/h_missing");

    assert.equal(response.statusCode, 503);
    assert.equal(response.body.code, "HEDGE_STORE_UNAVAILABLE");
    assert.match(response.body.traceId, /^tr_/);
    assert.equal(response.headers["x-trace-id"], response.body.traceId);
  } finally {
    await server.close();
  }
});

test("RFQ API keeps settlement accepted when hedge intent creation fails", async () => {
  let failurePressureBps = 0;
  let lastPenaltyRead = 0;
  const server = buildServer({
    logger: false,
    hedgeService: {
      checkHealth() {},
      createHedgeIntent() {
        throw new Error("hedge venue offline");
      },
      getHedgeIntent() {
        return undefined;
      },
      recordHedgeFailure(_intent, reasonCode) {
        assert.equal(reasonCode, "HEDGE_INTENT_FAILED");
        failurePressureBps = 75;
      },
      quoteRiskPenaltyBps() {
        lastPenaltyRead = failurePressureBps;
        return failurePressureBps;
      },
    },
  });
  await server.ready();

  try {
    const quote = await injectJson(server, "POST", "/quote", baseQuoteRequest);
    assert.equal(quote.statusCode, 200);

    const submit = await injectJson(server, "POST", "/submit", {
      quote: quotePayloadFromResponse(quote.body),
      signature: quote.body.signature,
    });

    assert.equal(submit.statusCode, 202);
    assert.equal(submit.body.status, "accepted");
    assert.match(submit.body.txHash, /^0x[0-9a-fA-F]{64}$/);
    assert.match(submit.body.settlementEventId, /^se_/);
    assert.equal(submit.body.hedgeOrderId, undefined);
    assert.equal(submit.body.pnlId, `pnl_${quote.body.quoteId}`);

    const status = await injectJson(server, "GET", `/quote/${quote.body.quoteId}`);
    assert.equal(status.statusCode, 200);
    assert.equal(status.body.status, "settled");
    assert.equal(status.body.txHash, submit.body.txHash);
    assert.equal(status.body.settlementEventId, submit.body.settlementEventId);
    assert.equal(status.body.hedgeOrderId, undefined);
    assert.equal(status.body.pnlId, submit.body.pnlId);

    const settlement = await injectJson(server, "GET", `/settlements/${submit.body.settlementEventId}`);
    assert.equal(settlement.statusCode, 200);
    assert.equal(settlement.body.status, "applied");
    assert.equal(settlement.body.quoteId, quote.body.quoteId);
    assert.match(settlement.body.quoteHash, /^0x[0-9a-fA-F]{64}$/);
    assert.equal(settlement.body.blockNumber, 0);

    const pnl = await injectJson(server, "GET", "/pnl");
    assert.equal(pnl.statusCode, 200);
    assert.equal(pnl.body.totalTrades, 1);
    assert.equal(pnl.body.trades[0].quoteId, quote.body.quoteId);

    const followupQuote = await injectJson(server, "POST", "/quote", baseQuoteRequest);
    assert.equal(followupQuote.statusCode, 200);
    assert.equal(lastPenaltyRead, 75);
    assert.ok(BigInt(followupQuote.body.amountOut) < BigInt(quote.body.amountOut));

    const metrics = await server.inject({ method: "GET", url: "/metrics" });
    assert.equal(metrics.statusCode, 200);
    assert.match(metrics.payload, /rfq_submit_accepted_total 1/);
    assert.match(metrics.payload, /rfq_submit_errors_total 0/);
    assert.match(metrics.payload, /rfq_settlements_total 1/);
    assert.match(metrics.payload, /rfq_hedge_intents_total 0/);
    assert.match(metrics.payload, /rfq_hedge_lag_seconds_count 0/);
    assert.match(metrics.payload, /rfq_hedge_intent_errors_total\{reason="HEDGE_INTENT_FAILED"\} 1/);
    assert.match(metrics.payload, /rfq_pnl_trades_total 1/);
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

function assertTraceHeader(response) {
  assert.match(String(response.headers["x-trace-id"]), /^tr_/);
}

function assertResponseFields(body, fields) {
  assert.deepEqual(Object.keys(body).sort(), [...fields].sort());
}
