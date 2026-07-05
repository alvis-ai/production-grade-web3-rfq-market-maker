import assert from "node:assert/strict";
import test from "node:test";
import { buildServer } from "../dist/main.js";
import { InMemoryQuoteRepository } from "../dist/modules/quote/quote.repository.js";
import {
  LocalSettlementVerifier,
  defaultLocalSettlementVerifierPolicy,
} from "../dist/modules/settlement/settlement-verifier.service.js";

const baseQuoteRequest = {
  chainId: 1,
  user: "0x0000000000000000000000000000000000000001",
  tokenIn: "0x0000000000000000000000000000000000000002",
  tokenOut: "0x0000000000000000000000000000000000000003",
  amountIn: "1000000000",
  slippageBps: 50,
};
test("RFQ API keeps settlement accepted when post-settlement quote status persistence fails", async () => {
  class FailingStatusQuoteRepository extends InMemoryQuoteRepository {
    async markStatus() {
      throw new Error("quote status store offline");
    }
  }

  const server = buildServer({
    logger: false,
    quoteRepository: new FailingStatusQuoteRepository(),
  });
  await server.ready();

  try {
    const quote = await injectJson(server, "POST", "/quote", baseQuoteRequest);
    assert.equal(quote.statusCode, 200);

    const submitPayload = {
      quote: quotePayloadFromResponse(quote.body),
      signature: quote.body.signature,
    };
    const submit = await injectJson(server, "POST", "/submit", submitPayload);

    assert.equal(submit.statusCode, 202);
    assert.equal(submit.body.status, "accepted");
    assert.match(submit.body.settlementEventId, /^se_/);
    assert.match(submit.body.hedgeOrderId, /^h_/);
    assert.equal(submit.body.pnlId, `pnl_${quote.body.quoteId}`);

    const replay = await injectJson(server, "POST", "/submit", submitPayload);
    assert.equal(replay.statusCode, 202);
    assert.equal(replay.body.status, "accepted");
    assert.equal(replay.body.settlementEventId, submit.body.settlementEventId);
    assert.equal(replay.body.hedgeOrderId, undefined);
    assert.equal(replay.body.pnlId, undefined);

    const pnl = await injectJson(server, "GET", "/pnl");
    assert.equal(pnl.statusCode, 200);
    assert.equal(pnl.body.totalTrades, 1);
    assert.equal(pnl.body.trades[0].quoteId, quote.body.quoteId);

    const metrics = await server.inject({ method: "GET", url: "/metrics" });
    assert.equal(metrics.statusCode, 200);
    assert.match(metrics.payload, /rfq_submit_requests_total 2/);
    assert.match(metrics.payload, /rfq_submit_accepted_total 2/);
    assert.match(metrics.payload, /rfq_submit_errors_total 0/);
    assert.match(metrics.payload, /rfq_settlements_total 1/);
    assert.match(metrics.payload, /rfq_hedge_intents_total 1/);
    assert.match(metrics.payload, /rfq_hedge_lag_seconds_count 1/);
    assert.match(metrics.payload, /rfq_pnl_trades_total 1/);
    assert.match(metrics.payload, /rfq_quote_status_update_errors_total\{target_status="SUBMITTED"\} 2/);
    assert.match(metrics.payload, /rfq_quote_status_update_errors_total\{target_status="SETTLED"\} 2/);
  } finally {
    await server.close();
  }
});

test("RFQ API verifies settlement constraints before simulated settlement", async () => {
  const server = buildServer({
    logger: false,
    settlementVerifier: new LocalSettlementVerifier({
      ...defaultLocalSettlementVerifierPolicy,
      tokenWhitelist: [baseQuoteRequest.tokenIn],
    }),
  });
  await server.ready();

  try {
    const quote = await injectJson(server, "POST", "/quote", baseQuoteRequest);
    assert.equal(quote.statusCode, 200);

    const response = await injectJson(server, "POST", "/submit", {
      quote: quotePayloadFromResponse(quote.body),
      signature: quote.body.signature,
    });

    assert.equal(response.statusCode, 409);
    assert.equal(response.body.code, "SETTLEMENT_REVERTED");
    assert.match(response.body.message, /not whitelisted/);
    assert.match(response.body.traceId, /^tr_/);
    assert.equal(response.headers["x-trace-id"], response.body.traceId);

    const status = await injectJson(server, "GET", `/quote/${quote.body.quoteId}`);
    assert.equal(status.statusCode, 200);
    assert.equal(status.body.status, "failed");
    assert.equal(status.body.errorCode, "TOKEN_NOT_WHITELISTED");

    const retry = await injectJson(server, "POST", "/submit", {
      quote: quotePayloadFromResponse(quote.body),
      signature: quote.body.signature,
    });
    assert.equal(retry.statusCode, 409);
    assert.equal(retry.body.code, "QUOTE_FAILED");
    assert.match(retry.body.traceId, /^tr_/);

    const metrics = await server.inject({ method: "GET", url: "/metrics" });
    assert.equal(metrics.statusCode, 200);
    assert.match(metrics.payload, /rfq_submit_requests_total 2/);
    assert.match(metrics.payload, /rfq_submit_errors_total 2/);
    assert.match(metrics.payload, /rfq_submit_accepted_total 0/);
    assert.match(metrics.payload, /rfq_settlements_total 0/);
    assert.match(metrics.payload, /rfq_hedge_intents_total 0/);
    assert.match(metrics.payload, /rfq_pnl_trades_total 0/);
    assert.doesNotMatch(metrics.payload, /rfq_inventory_balance\{chain_id=/);
  } finally {
    await server.close();
  }
});

test("RFQ API preserves settlement rejection when failed quote status persistence fails", async () => {
  class FailingFailedStatusQuoteRepository extends InMemoryQuoteRepository {
    async markFailed() {
      throw new Error("quote failed status store offline");
    }
  }

  const server = buildServer({
    logger: false,
    quoteRepository: new FailingFailedStatusQuoteRepository(),
    settlementVerifier: new LocalSettlementVerifier({
      ...defaultLocalSettlementVerifierPolicy,
      tokenWhitelist: [baseQuoteRequest.tokenIn],
    }),
  });
  await server.ready();

  try {
    const quote = await injectJson(server, "POST", "/quote", baseQuoteRequest);
    assert.equal(quote.statusCode, 200);

    const response = await injectJson(server, "POST", "/submit", {
      quote: quotePayloadFromResponse(quote.body),
      signature: quote.body.signature,
    });

    assert.equal(response.statusCode, 409);
    assert.equal(response.body.code, "SETTLEMENT_REVERTED");
    assert.match(response.body.message, /not whitelisted/);
    assert.match(response.body.traceId, /^tr_/);
    assert.equal(response.headers["x-trace-id"], response.body.traceId);

    const status = await injectJson(server, "GET", `/quote/${quote.body.quoteId}`);
    assert.equal(status.statusCode, 200);
    assert.equal(status.body.status, "signed");

    const metrics = await server.inject({ method: "GET", url: "/metrics" });
    assert.equal(metrics.statusCode, 200);
    assert.match(metrics.payload, /rfq_submit_requests_total 1/);
    assert.match(metrics.payload, /rfq_submit_errors_total 1/);
    assert.match(metrics.payload, /rfq_submit_accepted_total 0/);
    assert.match(metrics.payload, /rfq_settlements_total 0/);
    assert.match(metrics.payload, /rfq_quote_status_update_errors_total\{target_status="FAILED"\} 1/);
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
