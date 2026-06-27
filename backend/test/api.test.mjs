import assert from "node:assert/strict";
import test from "node:test";
import { buildServer } from "../dist/main.js";
import { BasicRiskEngine, defaultBasicRiskPolicy } from "../dist/modules/risk/risk.engine.js";
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

test("RFQ API accepts quote, submit, status, and metrics flow", async () => {
  const server = buildServer({ logger: false });
  await server.ready();

  try {
    const health = await injectJson(server, "GET", "/health");
    assert.equal(health.statusCode, 200);
    assert.equal(health.body.status, "ok");

    const ready = await injectJson(server, "GET", "/ready");
    assert.equal(ready.statusCode, 200);
    assert.equal(ready.body.status, "ready");
    assert.equal(ready.body.components.signer, "ok");
    assert.equal(ready.body.components.marketData, "ok");

    const quote = await injectJson(server, "POST", "/quote", baseQuoteRequest);
    assert.equal(quote.statusCode, 200);
    assert.match(quote.body.quoteId, /^q_/);
    assert.equal(quote.body.amountOut, "998400000");
    assert.equal(quote.body.minAmountOut, "993408000");
    assert.match(quote.body.signature, /^0x[0-9a-fA-F]+$/);

    const submit = await injectJson(server, "POST", "/submit", {
      quote: {
        user: baseQuoteRequest.user,
        tokenIn: baseQuoteRequest.tokenIn,
        tokenOut: baseQuoteRequest.tokenOut,
        amountIn: baseQuoteRequest.amountIn,
        amountOut: quote.body.amountOut,
        minAmountOut: quote.body.minAmountOut,
        nonce: quote.body.nonce,
        deadline: quote.body.deadline,
        chainId: baseQuoteRequest.chainId,
      },
      signature: uppercaseHex(quote.body.signature),
    });
    assert.equal(submit.statusCode, 202);
    assert.equal(submit.body.status, "accepted");
    assert.match(submit.body.txHash, /^0x[0-9a-fA-F]+$/);
    assert.match(submit.body.settlementEventId, /^se_/);
    assert.match(submit.body.hedgeOrderId, /^h_/);
    assert.equal(submit.body.pnlId, `pnl_${quote.body.quoteId}`);

    const status = await injectJson(server, "GET", `/quote/${quote.body.quoteId}`);
    assert.equal(status.statusCode, 200);
    assert.equal(status.body.status, "settled");
    assert.equal(status.body.txHash, submit.body.txHash);

    const settlement = await injectJson(server, "GET", `/settlements/${submit.body.settlementEventId}`);
    assert.equal(settlement.statusCode, 200);
    assert.equal(settlement.body.settlementEventId, submit.body.settlementEventId);
    assert.equal(settlement.body.status, "applied");
    assert.equal(settlement.body.quoteId, quote.body.quoteId);
    assert.equal(settlement.body.chainId, baseQuoteRequest.chainId);
    assert.equal(settlement.body.txHash, submit.body.txHash);
    assert.equal(settlement.body.logIndex, 0);
    assert.equal(settlement.body.user, baseQuoteRequest.user);
    assert.equal(settlement.body.tokenIn, baseQuoteRequest.tokenIn);
    assert.equal(settlement.body.tokenOut, baseQuoteRequest.tokenOut);
    assert.equal(settlement.body.amountIn, baseQuoteRequest.amountIn);
    assert.equal(settlement.body.amountOut, quote.body.amountOut);
    assert.match(settlement.body.observedAt, /^\d{4}-\d{2}-\d{2}T/);

    const hedge = await injectJson(server, "GET", `/hedges/${submit.body.hedgeOrderId}`);
    assert.equal(hedge.statusCode, 200);
    assert.equal(hedge.body.hedgeOrderId, submit.body.hedgeOrderId);
    assert.equal(hedge.body.status, "queued");
    assert.equal(hedge.body.quoteId, quote.body.quoteId);
    assert.equal(hedge.body.chainId, baseQuoteRequest.chainId);
    assert.equal(hedge.body.token, baseQuoteRequest.tokenOut);
    assert.equal(hedge.body.side, "buy");
    assert.equal(hedge.body.amount, quote.body.amountOut);
    assert.equal(hedge.body.reason, "inventory_rebalance");
    assert.match(hedge.body.createdAt, /^\d{4}-\d{2}-\d{2}T/);

    const pnl = await injectJson(server, "GET", "/pnl");
    assert.equal(pnl.statusCode, 200);
    assert.equal(pnl.body.status, "ok");
    assert.equal(pnl.body.totalTrades, 1);
    assert.equal(pnl.body.grossPnlTokenOut, "1600000");
    assert.equal(pnl.body.trades.length, 1);
    assert.equal(pnl.body.trades[0].pnlId, submit.body.pnlId);
    assert.equal(pnl.body.trades[0].quoteId, quote.body.quoteId);
    assert.equal(pnl.body.trades[0].amountIn, baseQuoteRequest.amountIn);
    assert.equal(pnl.body.trades[0].amountOut, quote.body.amountOut);
    assert.equal(pnl.body.trades[0].grossPnlTokenOut, "1600000");
    assert.equal(pnl.body.trades[0].grossPnlBps, 16);
    assert.equal(pnl.body.trades[0].model, "simulated_mid_price_v1");
    assert.match(pnl.body.trades[0].realizedAt, /^\d{4}-\d{2}-\d{2}T/);

    const metrics = await server.inject({ method: "GET", url: "/metrics" });
    assert.equal(metrics.statusCode, 200);
    assert.match(metrics.payload, /rfq_quote_requests_total 1/);
    assert.match(metrics.payload, /rfq_quote_latency_seconds_count 1/);
    assert.match(metrics.payload, /rfq_quote_latency_seconds_bucket\{le="\+Inf"\} 1/);
    assert.match(metrics.payload, /rfq_signer_requests_total\{operation="sign"\} 1/);
    assert.match(metrics.payload, /rfq_signer_requests_total\{operation="verify"\} 1/);
    assert.match(metrics.payload, /rfq_signer_errors_total\{operation="sign"\} 0/);
    assert.match(metrics.payload, /rfq_signer_latency_seconds_count\{operation="sign"\} 1/);
    assert.match(metrics.payload, /rfq_signer_latency_seconds_count\{operation="verify"\} 1/);
    assert.match(metrics.payload, /rfq_submit_accepted_total 1/);
    assert.match(metrics.payload, /rfq_submit_latency_seconds_count 1/);
    assert.match(metrics.payload, /rfq_submit_latency_seconds_bucket\{le="\+Inf"\} 1/);
    assert.match(metrics.payload, /rfq_settlements_total 1/);
    assert.match(metrics.payload, /rfq_hedge_intents_total 1/);
    assert.match(
      metrics.payload,
      new RegExp(`rfq_inventory_balance\\{chain_id="1",token="${baseQuoteRequest.tokenIn}"\\} ${baseQuoteRequest.amountIn}`),
    );
    assert.match(
      metrics.payload,
      new RegExp(`rfq_inventory_balance\\{chain_id="1",token="${baseQuoteRequest.tokenOut}"\\} -${quote.body.amountOut}`),
    );
    assert.match(metrics.payload, /rfq_pnl_trades_total 1/);
    assert.match(
      metrics.payload,
      new RegExp(`rfq_realized_pnl_token_out\\{chain_id="1",token="${baseQuoteRequest.tokenOut}"\\} 1600000`),
    );
  } finally {
    await server.close();
  }
});

test("RFQ API records signer errors and rejects quote when signing is unavailable", async () => {
  const server = buildServer({
    logger: false,
    signerService: {
      async signQuote() {
        throw new Error("signer offline");
      },
      async verifyQuoteSignature() {
        return false;
      },
    },
  });
  await server.ready();

  try {
    const response = await injectJson(server, "POST", "/quote", baseQuoteRequest);

    assert.equal(response.statusCode, 503);
    assert.equal(response.body.code, "SIGNER_UNAVAILABLE");
    assert.match(response.body.traceId, /^tr_/);
    assert.equal(response.headers["x-trace-id"], response.body.traceId);

    const metrics = await server.inject({ method: "GET", url: "/metrics" });
    assert.equal(metrics.statusCode, 200);
    assert.match(metrics.payload, /rfq_quote_requests_total 1/);
    assert.match(metrics.payload, /rfq_quote_errors_total 1/);
    assert.match(metrics.payload, /rfq_quote_responses_total 0/);
    assert.match(metrics.payload, /rfq_signer_requests_total\{operation="sign"\} 1/);
    assert.match(metrics.payload, /rfq_signer_errors_total\{operation="sign"\} 1/);
    assert.match(metrics.payload, /rfq_signer_requests_total\{operation="verify"\} 0/);
    assert.match(metrics.payload, /rfq_signer_latency_seconds_count\{operation="sign"\} 1/);
  } finally {
    await server.close();
  }
});

test("RFQ API returns structured errors for missing settlement events", async () => {
  const server = buildServer({ logger: false });
  await server.ready();

  try {
    const response = await injectJson(server, "GET", "/settlements/se_missing");

    assert.equal(response.statusCode, 404);
    assert.equal(response.body.code, "SETTLEMENT_EVENT_NOT_FOUND");
    assert.match(response.body.traceId, /^tr_/);
    assert.equal(response.headers["x-trace-id"], response.body.traceId);
  } finally {
    await server.close();
  }
});

test("RFQ API degrades readiness when market data is stale", async () => {
  const server = buildServer({
    logger: false,
    marketDataService: {
      async getSnapshot() {
        return {
          snapshotId: "snapshot_stale",
          midPrice: "1",
          liquidityUsd: "10000000000000",
          volatilityBps: 25,
          observedAt: new Date(Date.now() - 60_000).toISOString(),
        };
      },
    },
  });
  await server.ready();

  try {
    const response = await injectJson(server, "GET", "/ready");

    assert.equal(response.statusCode, 503);
    assert.equal(response.body.status, "degraded");
    assert.equal(response.body.components.marketData, "degraded");
    assert.equal(response.body.components.signer, "ok");
  } finally {
    await server.close();
  }
});

test("RFQ API degrades readiness when market data shape is invalid", async () => {
  const server = buildServer({
    logger: false,
    marketDataService: {
      async getSnapshot() {
        return {
          snapshotId: "snapshot_invalid",
          midPrice: "0",
          liquidityUsd: "10000000000000",
          volatilityBps: 25,
          observedAt: new Date().toISOString(),
        };
      },
    },
  });
  await server.ready();

  try {
    const response = await injectJson(server, "GET", "/ready");

    assert.equal(response.statusCode, 503);
    assert.equal(response.body.status, "degraded");
    assert.equal(response.body.components.marketData, "degraded");
    assert.equal(response.body.components.signer, "ok");
  } finally {
    await server.close();
  }
});

test("RFQ API degrades readiness when signer probe fails", async () => {
  const server = buildServer({
    logger: false,
    signerService: {
      async signQuote() {
        throw new Error("signer readiness probe failed");
      },
      async verifyQuoteSignature() {
        return false;
      },
    },
  });
  await server.ready();

  try {
    const response = await injectJson(server, "GET", "/ready");

    assert.equal(response.statusCode, 503);
    assert.equal(response.body.status, "degraded");
    assert.equal(response.body.components.marketData, "ok");
    assert.equal(response.body.components.signer, "degraded");
  } finally {
    await server.close();
  }
});

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

test("RFQ API keeps settlement accepted when hedge intent creation fails", async () => {
  const server = buildServer({
    logger: false,
    hedgeService: {
      createHedgeIntent() {
        throw new Error("hedge venue offline");
      },
      getHedgeIntent() {
        return undefined;
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
    assert.match(submit.body.txHash, /^0x[0-9a-fA-F]+$/);
    assert.match(submit.body.settlementEventId, /^se_/);
    assert.equal(submit.body.hedgeOrderId, undefined);
    assert.equal(submit.body.pnlId, `pnl_${quote.body.quoteId}`);

    const status = await injectJson(server, "GET", `/quote/${quote.body.quoteId}`);
    assert.equal(status.statusCode, 200);
    assert.equal(status.body.status, "settled");
    assert.equal(status.body.txHash, submit.body.txHash);

    const settlement = await injectJson(server, "GET", `/settlements/${submit.body.settlementEventId}`);
    assert.equal(settlement.statusCode, 200);
    assert.equal(settlement.body.status, "applied");
    assert.equal(settlement.body.quoteId, quote.body.quoteId);

    const pnl = await injectJson(server, "GET", "/pnl");
    assert.equal(pnl.statusCode, 200);
    assert.equal(pnl.body.totalTrades, 1);
    assert.equal(pnl.body.trades[0].quoteId, quote.body.quoteId);

    const metrics = await server.inject({ method: "GET", url: "/metrics" });
    assert.equal(metrics.statusCode, 200);
    assert.match(metrics.payload, /rfq_submit_accepted_total 1/);
    assert.match(metrics.payload, /rfq_submit_errors_total 0/);
    assert.match(metrics.payload, /rfq_settlements_total 1/);
    assert.match(metrics.payload, /rfq_hedge_intents_total 0/);
    assert.match(metrics.payload, /rfq_hedge_intent_errors_total\{reason="HEDGE_INTENT_FAILED"\} 1/);
    assert.match(metrics.payload, /rfq_pnl_trades_total 1/);
  } finally {
    await server.close();
  }
});

test("RFQ API rejects quotes that fail pre-trade risk policy", async () => {
  const server = buildServer({ logger: false });
  await server.ready();

  try {
    const response = await injectJson(server, "POST", "/quote", {
      ...baseQuoteRequest,
      slippageBps: 999,
    });

    assert.equal(response.statusCode, 409);
    assert.equal(response.body.code, "RISK_REJECTED");
    assert.match(response.body.traceId, /^tr_/);
    assert.equal(response.headers["x-trace-id"], response.body.traceId);

    const metrics = await server.inject({ method: "GET", url: "/metrics" });
    assert.equal(metrics.statusCode, 200);
    assert.match(metrics.payload, /rfq_quote_requests_total 1/);
    assert.match(metrics.payload, /rfq_quote_errors_total 1/);
    assert.match(metrics.payload, /rfq_quote_rejections_total\{reason="SLIPPAGE_TOO_WIDE"\} 1/);
  } finally {
    await server.close();
  }
});

test("RFQ API rejects stale market data before pricing and signing", async () => {
  const server = buildServer({
    logger: false,
    marketDataService: {
      async getSnapshot(request) {
        return {
          snapshotId: "snapshot_stale",
          midPrice: "1",
          liquidityUsd: "10000000000000",
          volatilityBps: 25,
          observedAt: new Date(Date.now() - 60_000).toISOString(),
        };
      },
    },
  });
  await server.ready();

  try {
    const response = await injectJson(server, "POST", "/quote", baseQuoteRequest);

    assert.equal(response.statusCode, 503);
    assert.equal(response.body.code, "MARKET_DATA_UNAVAILABLE");
    assert.match(response.body.message, /stale/);
    assert.match(response.body.traceId, /^tr_/);
    assert.equal(response.headers["x-trace-id"], response.body.traceId);

    const metrics = await server.inject({ method: "GET", url: "/metrics" });
    assert.equal(metrics.statusCode, 200);
    assert.match(metrics.payload, /rfq_quote_requests_total 1/);
    assert.match(metrics.payload, /rfq_quote_errors_total 1/);
    assert.match(metrics.payload, /rfq_quote_responses_total 0/);
    assert.doesNotMatch(metrics.payload, /rfq_settlements_total 1/);
  } finally {
    await server.close();
  }
});

test("RFQ API rejects invalid market data before pricing and signing", async () => {
  const server = buildServer({
    logger: false,
    marketDataService: {
      async getSnapshot() {
        return {
          snapshotId: "snapshot_invalid_mid",
          midPrice: "not-a-price",
          liquidityUsd: "10000000000000",
          volatilityBps: 25,
          observedAt: new Date().toISOString(),
        };
      },
    },
  });
  await server.ready();

  try {
    const response = await injectJson(server, "POST", "/quote", baseQuoteRequest);

    assert.equal(response.statusCode, 503);
    assert.equal(response.body.code, "MARKET_DATA_UNAVAILABLE");
    assert.match(response.body.message, /mid price/);
    assert.match(response.body.traceId, /^tr_/);
    assert.equal(response.headers["x-trace-id"], response.body.traceId);

    const metrics = await server.inject({ method: "GET", url: "/metrics" });
    assert.equal(metrics.statusCode, 200);
    assert.match(metrics.payload, /rfq_quote_requests_total 1/);
    assert.match(metrics.payload, /rfq_quote_errors_total 1/);
    assert.match(metrics.payload, /rfq_quote_responses_total 0/);
    assert.match(metrics.payload, /rfq_settlements_total 0/);
    assert.doesNotMatch(metrics.payload, /rfq_inventory_balance\{chain_id=/);
  } finally {
    await server.close();
  }
});

test("RFQ API maps pricing engine failures to dependency errors before signing", async () => {
  const server = buildServer({
    logger: false,
    pricingEngine: {
      async price() {
        throw new Error("pricing backend offline");
      },
    },
  });
  await server.ready();

  try {
    const response = await injectJson(server, "POST", "/quote", baseQuoteRequest);

    assert.equal(response.statusCode, 503);
    assert.equal(response.body.code, "PRICING_UNAVAILABLE");
    assert.match(response.body.traceId, /^tr_/);
    assert.equal(response.headers["x-trace-id"], response.body.traceId);

    const metrics = await server.inject({ method: "GET", url: "/metrics" });
    assert.equal(metrics.statusCode, 200);
    assert.match(metrics.payload, /rfq_quote_requests_total 1/);
    assert.match(metrics.payload, /rfq_quote_errors_total 1/);
    assert.match(metrics.payload, /rfq_quote_responses_total 0/);
    assert.match(metrics.payload, /rfq_signer_requests_total\{operation="sign"\} 0/);
    assert.match(metrics.payload, /rfq_settlements_total 0/);
  } finally {
    await server.close();
  }
});

test("RFQ API rejects toxic-flow users before signing", async () => {
  const server = buildServer({
    logger: false,
    riskEngine: new BasicRiskEngine({
      ...defaultBasicRiskPolicy,
      toxicFlowScores: [
        {
          user: baseQuoteRequest.user,
          scoreBps: 9500,
        },
      ],
    }),
  });
  await server.ready();

  try {
    const response = await injectJson(server, "POST", "/quote", baseQuoteRequest);

    assert.equal(response.statusCode, 409);
    assert.equal(response.body.code, "RISK_REJECTED");
    assert.match(response.body.traceId, /^tr_/);
    assert.equal(response.headers["x-trace-id"], response.body.traceId);

    const metrics = await server.inject({ method: "GET", url: "/metrics" });
    assert.equal(metrics.statusCode, 200);
    assert.match(metrics.payload, /rfq_quote_requests_total 1/);
    assert.match(metrics.payload, /rfq_quote_errors_total 1/);
    assert.match(metrics.payload, /rfq_quote_responses_total 0/);
    assert.match(metrics.payload, /rfq_quote_rejections_total\{reason="TOXIC_FLOW_SCORE_EXCEEDED"\} 1/);
  } finally {
    await server.close();
  }
});

test("RFQ API fails closed when risk engine is unavailable", async () => {
  const server = buildServer({
    logger: false,
    riskEngine: {
      async evaluate() {
        throw new Error("risk backend offline");
      },
    },
  });
  await server.ready();

  try {
    const response = await injectJson(server, "POST", "/quote", baseQuoteRequest);

    assert.equal(response.statusCode, 409);
    assert.equal(response.body.code, "RISK_REJECTED");
    assert.match(response.body.traceId, /^tr_/);
    assert.equal(response.headers["x-trace-id"], response.body.traceId);

    const metrics = await server.inject({ method: "GET", url: "/metrics" });
    assert.equal(metrics.statusCode, 200);
    assert.match(metrics.payload, /rfq_quote_requests_total 1/);
    assert.match(metrics.payload, /rfq_quote_errors_total 1/);
    assert.match(metrics.payload, /rfq_quote_responses_total 0/);
    assert.match(metrics.payload, /rfq_quote_rejections_total\{reason="RISK_ENGINE_UNAVAILABLE"\} 1/);
    assert.match(metrics.payload, /rfq_signer_requests_total\{operation="sign"\} 0/);
  } finally {
    await server.close();
  }
});

test("RFQ API prices later quotes with inventory skew after settlement", async () => {
  const server = buildServer({ logger: false });
  await server.ready();

  try {
    const firstQuote = await injectJson(server, "POST", "/quote", baseQuoteRequest);
    assert.equal(firstQuote.statusCode, 200);
    assert.equal(firstQuote.body.amountOut, "998400000");

    const submit = await injectJson(server, "POST", "/submit", {
      quote: quotePayloadFromResponse(firstQuote.body),
      signature: firstQuote.body.signature,
    });
    assert.equal(submit.statusCode, 202);

    const secondQuote = await injectJson(server, "POST", "/quote", baseQuoteRequest);
    assert.equal(secondQuote.statusCode, 200);
    assert.equal(secondQuote.body.amountOut, "996500000");
    assert.equal(secondQuote.body.minAmountOut, "991517500");
  } finally {
    await server.close();
  }
});

test("RFQ API rejects quotes that would exceed projected inventory limits", async () => {
  const server = buildServer({ logger: false });
  await server.ready();

  try {
    const response = await injectJson(server, "POST", "/quote", {
      ...baseQuoteRequest,
      amountIn: "2100000000",
    });

    assert.equal(response.statusCode, 409);
    assert.equal(response.body.code, "RISK_REJECTED");
    assert.match(response.body.traceId, /^tr_/);

    const metrics = await server.inject({ method: "GET", url: "/metrics" });
    assert.equal(metrics.statusCode, 200);
    assert.match(metrics.payload, /rfq_quote_requests_total 1/);
    assert.match(metrics.payload, /rfq_quote_errors_total 1/);
    assert.match(metrics.payload, /rfq_quote_responses_total 0/);
    assert.match(metrics.payload, /rfq_quote_rejections_total\{reason="TOKEN_IN_INVENTORY_LIMIT_EXCEEDED"\} 1/);
  } finally {
    await server.close();
  }
});

test("RFQ API rate limits quote requests by client", async () => {
  const server = buildServer({
    logger: false,
    rateLimit: {
      windowMs: 60_000,
      maxQuoteRequests: 1,
      maxSubmitRequests: 100,
      maxStatusRequests: 100,
    },
  });
  await server.ready();

  try {
    const firstQuote = await injectJson(server, "POST", "/quote", baseQuoteRequest);
    assert.equal(firstQuote.statusCode, 200);
    assert.equal(firstQuote.headers["x-ratelimit-remaining"], "0");

    const secondQuote = await injectJson(server, "POST", "/quote", baseQuoteRequest);
    assert.equal(secondQuote.statusCode, 429);
    assert.equal(secondQuote.body.code, "RATE_LIMITED");
    assert.equal(secondQuote.headers["retry-after"], "60");
    assert.match(secondQuote.body.traceId, /^tr_/);
    assert.equal(secondQuote.headers["x-trace-id"], secondQuote.body.traceId);

    const metrics = await server.inject({ method: "GET", url: "/metrics" });
    assert.equal(metrics.statusCode, 200);
    assert.match(metrics.payload, /rfq_quote_requests_total 2/);
    assert.match(metrics.payload, /rfq_quote_responses_total 1/);
    assert.match(metrics.payload, /rfq_quote_errors_total 1/);
    assert.match(metrics.payload, /rfq_quote_latency_seconds_count 2/);
  } finally {
    await server.close();
  }
});

test("RFQ API rate limits submit requests before validation and settlement", async () => {
  const server = buildServer({
    logger: false,
    rateLimit: {
      windowMs: 60_000,
      maxQuoteRequests: 100,
      maxSubmitRequests: 1,
      maxStatusRequests: 100,
    },
  });
  await server.ready();

  try {
    const quote = {
      user: baseQuoteRequest.user,
      tokenIn: baseQuoteRequest.tokenIn,
      tokenOut: baseQuoteRequest.tokenOut,
      amountIn: baseQuoteRequest.amountIn,
      amountOut: "1000000000",
      minAmountOut: "995000000",
      nonce: "1",
      deadline: Math.floor(Date.now() / 1000) + 30,
      chainId: baseQuoteRequest.chainId,
    };

    const firstSubmit = await injectJson(server, "POST", "/submit", {
      quote,
      signature: fixedSignature(),
    });
    assert.equal(firstSubmit.statusCode, 404);
    assert.equal(firstSubmit.body.code, "QUOTE_NOT_FOUND");

    const secondSubmit = await injectJson(server, "POST", "/submit", {
      quote,
      signature: fixedSignature(),
    });
    assert.equal(secondSubmit.statusCode, 429);
    assert.equal(secondSubmit.body.code, "RATE_LIMITED");
    assert.equal(secondSubmit.headers["retry-after"], "60");
    assert.match(secondSubmit.body.traceId, /^tr_/);

    const metrics = await server.inject({ method: "GET", url: "/metrics" });
    assert.equal(metrics.statusCode, 200);
    assert.match(metrics.payload, /rfq_submit_requests_total 2/);
    assert.match(metrics.payload, /rfq_submit_errors_total 2/);
    assert.match(metrics.payload, /rfq_submit_accepted_total 0/);
    assert.match(metrics.payload, /rfq_submit_latency_seconds_count 2/);
    assert.match(metrics.payload, /rfq_settlements_total 0/);
  } finally {
    await server.close();
  }
});

test("RFQ API rate limits quote status requests by client", async () => {
  const server = buildServer({
    logger: false,
    rateLimit: {
      windowMs: 60_000,
      maxQuoteRequests: 100,
      maxSubmitRequests: 100,
      maxStatusRequests: 1,
    },
  });
  await server.ready();

  try {
    const firstStatus = await injectJson(server, "GET", "/quote/q_missing");
    assert.equal(firstStatus.statusCode, 404);
    assert.equal(firstStatus.body.code, "QUOTE_NOT_FOUND");

    const secondStatus = await injectJson(server, "GET", "/quote/q_missing");
    assert.equal(secondStatus.statusCode, 429);
    assert.equal(secondStatus.body.code, "RATE_LIMITED");
    assert.equal(secondStatus.headers["retry-after"], "60");
    assert.match(secondStatus.body.traceId, /^tr_/);
  } finally {
    await server.close();
  }
});

test("RFQ API includes trace ids on validation and not found errors", async () => {
  const server = buildServer({ logger: false });
  await server.ready();

  try {
    const invalid = await injectJson(server, "POST", "/quote", {
      ...baseQuoteRequest,
      tokenIn: "not-an-address",
    });
    assert.equal(invalid.statusCode, 400);
    assert.equal(invalid.body.code, "INVALID_REQUEST");
    assert.match(invalid.body.traceId, /^tr_/);
    assert.equal(invalid.headers["x-trace-id"], invalid.body.traceId);

    const notFound = await injectJson(server, "GET", "/quote/q_missing");
    assert.equal(notFound.statusCode, 404);
    assert.equal(notFound.body.code, "QUOTE_NOT_FOUND");
    assert.match(notFound.body.traceId, /^tr_/);
    assert.equal(notFound.headers["x-trace-id"], notFound.body.traceId);
  } finally {
    await server.close();
  }
});

test("RFQ API rejects submit payloads that violate settlement shape", async () => {
  const server = buildServer({ logger: false });
  await server.ready();

  try {
    const quote = {
      user: baseQuoteRequest.user,
      tokenIn: baseQuoteRequest.tokenIn,
      tokenOut: baseQuoteRequest.tokenOut,
      amountIn: baseQuoteRequest.amountIn,
      amountOut: "1000000000",
      minAmountOut: "995000000",
      nonce: "1",
      deadline: Math.floor(Date.now() / 1000) + 30,
      chainId: baseQuoteRequest.chainId,
    };

    const invalidSignature = await injectJson(server, "POST", "/submit", {
      quote,
      signature: "0x1234",
    });
    assert.equal(invalidSignature.statusCode, 400);
    assert.equal(invalidSignature.body.code, "INVALID_REQUEST");
    assert.match(invalidSignature.body.message, /65 bytes/);
    assert.match(invalidSignature.body.traceId, /^tr_/);

    const sameTokenPair = await injectJson(server, "POST", "/submit", {
      quote: {
        ...quote,
        tokenOut: quote.tokenIn,
      },
      signature: fixedSignature(),
    });
    assert.equal(sameTokenPair.statusCode, 400);
    assert.equal(sameTokenPair.body.code, "INVALID_REQUEST");
    assert.match(sameTokenPair.body.message, /tokenIn and quote\.tokenOut must be different/);

    const zeroAmount = await injectJson(server, "POST", "/submit", {
      quote: {
        ...quote,
        amountIn: "0",
      },
      signature: fixedSignature(),
    });
    assert.equal(zeroAmount.statusCode, 400);
    assert.equal(zeroAmount.body.code, "INVALID_REQUEST");
    assert.match(zeroAmount.body.message, /positive uint string/);

    const belowMinimum = await injectJson(server, "POST", "/submit", {
      quote: {
        ...quote,
        amountOut: "994999999",
      },
      signature: fixedSignature(),
    });
    assert.equal(belowMinimum.statusCode, 400);
    assert.equal(belowMinimum.body.code, "INVALID_REQUEST");
    assert.match(belowMinimum.body.message, /greater than or equal/);
  } finally {
    await server.close();
  }
});

test("RFQ API rejects expired submit quotes before simulated settlement", async () => {
  const server = buildServer({ logger: false });
  await server.ready();

  try {
    const response = await injectJson(server, "POST", "/submit", {
      quote: {
        user: baseQuoteRequest.user,
        tokenIn: baseQuoteRequest.tokenIn,
        tokenOut: baseQuoteRequest.tokenOut,
        amountIn: baseQuoteRequest.amountIn,
        amountOut: "1000000000",
        minAmountOut: "995000000",
        nonce: "1",
        deadline: Math.floor(Date.now() / 1000) - 1,
        chainId: baseQuoteRequest.chainId,
      },
      signature: fixedSignature(),
    });

    assert.equal(response.statusCode, 409);
    assert.equal(response.body.code, "QUOTE_EXPIRED");
    assert.match(response.body.traceId, /^tr_/);

    const metrics = await server.inject({ method: "GET", url: "/metrics" });
    assert.equal(metrics.statusCode, 200);
    assert.match(metrics.payload, /rfq_submit_requests_total 1/);
    assert.match(metrics.payload, /rfq_submit_errors_total 1/);
    assert.match(metrics.payload, /rfq_submit_accepted_total 0/);
    assert.match(metrics.payload, /rfq_settlements_total 0/);
    assert.doesNotMatch(metrics.payload, /rfq_inventory_balance\{chain_id=/);
  } finally {
    await server.close();
  }
});

test("RFQ API rejects unissued submit quotes before simulated settlement", async () => {
  const server = buildServer({ logger: false });
  await server.ready();

  try {
    const response = await injectJson(server, "POST", "/submit", {
      quote: {
        user: baseQuoteRequest.user,
        tokenIn: baseQuoteRequest.tokenIn,
        tokenOut: baseQuoteRequest.tokenOut,
        amountIn: baseQuoteRequest.amountIn,
        amountOut: "1000000000",
        minAmountOut: "995000000",
        nonce: "999",
        deadline: Math.floor(Date.now() / 1000) + 30,
        chainId: baseQuoteRequest.chainId,
      },
      signature: fixedSignature(),
    });

    assert.equal(response.statusCode, 404);
    assert.equal(response.body.code, "QUOTE_NOT_FOUND");
    assert.match(response.body.traceId, /^tr_/);

    const metrics = await server.inject({ method: "GET", url: "/metrics" });
    assert.equal(metrics.statusCode, 200);
    assert.match(metrics.payload, /rfq_submit_requests_total 1/);
    assert.match(metrics.payload, /rfq_submit_errors_total 1/);
    assert.match(metrics.payload, /rfq_submit_accepted_total 0/);
    assert.match(metrics.payload, /rfq_settlements_total 0/);
    assert.doesNotMatch(metrics.payload, /rfq_inventory_balance\{chain_id=/);
  } finally {
    await server.close();
  }
});

test("RFQ API rejects issued quotes with invalid trusted signer signature", async () => {
  const server = buildServer({ logger: false });
  await server.ready();

  try {
    const quote = await injectJson(server, "POST", "/quote", baseQuoteRequest);
    assert.equal(quote.statusCode, 200);

    const response = await injectJson(server, "POST", "/submit", {
      quote: {
        user: baseQuoteRequest.user,
        tokenIn: baseQuoteRequest.tokenIn,
        tokenOut: baseQuoteRequest.tokenOut,
        amountIn: baseQuoteRequest.amountIn,
        amountOut: quote.body.amountOut,
        minAmountOut: quote.body.minAmountOut,
        nonce: quote.body.nonce,
        deadline: quote.body.deadline,
        chainId: baseQuoteRequest.chainId,
      },
      signature: fixedSignature(),
    });

    assert.equal(response.statusCode, 409);
    assert.equal(response.body.code, "INVALID_SIGNATURE");
    assert.match(response.body.traceId, /^tr_/);

    const status = await injectJson(server, "GET", `/quote/${quote.body.quoteId}`);
    assert.equal(status.statusCode, 200);
    assert.equal(status.body.status, "signed");

    const metrics = await server.inject({ method: "GET", url: "/metrics" });
    assert.equal(metrics.statusCode, 200);
    assert.match(metrics.payload, /rfq_submit_requests_total 1/);
    assert.match(metrics.payload, /rfq_submit_errors_total 1/);
    assert.match(metrics.payload, /rfq_submit_accepted_total 0/);
    assert.match(metrics.payload, /rfq_settlements_total 0/);
    assert.doesNotMatch(metrics.payload, /rfq_inventory_balance\{chain_id=/);
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
    assert.equal(status.body.errorCode, "SETTLEMENT_REVERTED");

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

test("RFQ API maps settlement verifier failures to dependency errors before settlement", async () => {
  const server = buildServer({
    logger: false,
    settlementVerifier: {
      async verify() {
        throw new Error("chain rpc offline");
      },
    },
  });
  await server.ready();

  try {
    const quote = await injectJson(server, "POST", "/quote", baseQuoteRequest);
    assert.equal(quote.statusCode, 200);

    const response = await injectJson(server, "POST", "/submit", {
      quote: quotePayloadFromResponse(quote.body),
      signature: quote.body.signature,
    });

    assert.equal(response.statusCode, 503);
    assert.equal(response.body.code, "SETTLEMENT_UNAVAILABLE");
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
    assert.match(metrics.payload, /rfq_hedge_intents_total 0/);
    assert.match(metrics.payload, /rfq_pnl_trades_total 0/);
    assert.doesNotMatch(metrics.payload, /rfq_inventory_balance\{chain_id=/);
  } finally {
    await server.close();
  }
});

test("RFQ API rejects replayed submit quotes", async () => {
  const server = buildServer({ logger: false });
  await server.ready();

  try {
    const quote = await injectJson(server, "POST", "/quote", baseQuoteRequest);
    assert.equal(quote.statusCode, 200);
    const submitPayload = {
      quote: {
        user: baseQuoteRequest.user,
        tokenIn: baseQuoteRequest.tokenIn,
        tokenOut: baseQuoteRequest.tokenOut,
        amountIn: baseQuoteRequest.amountIn,
        amountOut: quote.body.amountOut,
        minAmountOut: quote.body.minAmountOut,
        nonce: quote.body.nonce,
        deadline: quote.body.deadline,
        chainId: baseQuoteRequest.chainId,
      },
      signature: quote.body.signature,
    };

    const firstSubmit = await injectJson(server, "POST", "/submit", submitPayload);
    assert.equal(firstSubmit.statusCode, 202);

    const replay = await injectJson(server, "POST", "/submit", submitPayload);
    assert.equal(replay.statusCode, 409);
    assert.equal(replay.body.code, "QUOTE_ALREADY_USED");
    assert.match(replay.body.traceId, /^tr_/);

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

test("RFQ API generates unique quote ids and nonces within the same millisecond", async () => {
  const originalDateNow = Date.now;
  Date.now = () => 1893456000000;

  const server = buildServer({
    logger: false,
    marketDataService: {
      async getSnapshot(request) {
        return {
          snapshotId: [
            "snapshot",
            request.chainId.toString(),
            request.tokenIn.slice(2, 10).toLowerCase(),
            request.tokenOut.slice(2, 10).toLowerCase(),
          ].join("_"),
          midPrice: "1",
          liquidityUsd: "10000000000000",
          volatilityBps: 25,
          observedAt: new Date(Date.now()).toISOString(),
        };
      },
    },
  });
  await server.ready();

  try {
    const responses = [];
    for (let index = 0; index < 5; index += 1) {
      responses.push(await injectJson(server, "POST", "/quote", baseQuoteRequest));
    }

    const quoteIds = new Set();
    const nonces = new Set();
    for (const response of responses) {
      assert.equal(response.statusCode, 200);
      assert.match(response.body.quoteId, /^q_[0-9]+$/);
      assert.match(response.body.nonce, /^[0-9]+$/);
      quoteIds.add(response.body.quoteId);
      nonces.add(response.body.nonce);
    }

    assert.equal(quoteIds.size, responses.length);
    assert.equal(nonces.size, responses.length);
  } finally {
    await server.close();
    Date.now = originalDateNow;
  }
});

async function injectJson(server, method, url, payload) {
  const response = await server.inject({
    method,
    url,
    headers: payload ? { "content-type": "application/json" } : undefined,
    payload: payload ? JSON.stringify(payload) : undefined,
  });

  return {
    statusCode: response.statusCode,
    headers: response.headers,
    body: response.payload ? JSON.parse(response.payload) : undefined,
  };
}

function fixedSignature() {
  return `0x${"11".repeat(65)}`;
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

function uppercaseHex(value) {
  return `0x${value.slice(2).toUpperCase()}`;
}
