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
const simulatedPnlModelDescription =
  "Simulated same-decimal quote attribution where grossPnlTokenOut equals amountIn minus amountOut and is not cross-token accounting PnL";
const secp256k1n = BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141");

test("RFQ API accepts quote, submit, status, and metrics flow", async () => {
  const server = buildServer({ logger: false });
  await server.ready();

  try {
    const health = await injectJson(server, "GET", "/health");
    assert.equal(health.statusCode, 200);
    assertTraceHeader(health);
    assertResponseFields(health.body, ["status"]);
    assert.equal(health.body.status, "ok");

    const ready = await injectJson(server, "GET", "/ready");
    assert.equal(ready.statusCode, 200);
    assertTraceHeader(ready);
    assertResponseFields(ready.body, ["status", "components"]);
    assertResponseFields(ready.body.components, [
      "marketData",
      "marketSnapshotStore",
      "routing",
      "pricing",
      "risk",
      "signer",
      "quoteRepository",
      "riskDecisionStore",
      "inventory",
      "execution",
      "settlementEventStore",
      "pnl",
      "metrics",
    ]);
    assert.equal(ready.body.status, "ready");
    assert.equal(ready.body.components.signer, "ok");
    assert.equal(ready.body.components.marketData, "ok");
    assert.equal(ready.body.components.routing, "ok");
    assert.equal(ready.body.components.pricing, "ok");
    assert.equal(ready.body.components.risk, "ok");
    assert.equal(ready.body.components.marketSnapshotStore, "ok");
    assert.equal(ready.body.components.quoteRepository, "ok");
    assert.equal(ready.body.components.riskDecisionStore, "ok");
    assert.equal(ready.body.components.inventory, "ok");
    assert.equal(ready.body.components.execution, "ok");
    assert.equal(ready.body.components.settlementEventStore, "ok");
    assert.equal(ready.body.components.pnl, "ok");
    assert.equal(ready.body.components.metrics, "ok");

    const quote = await injectJson(server, "POST", "/quote", baseQuoteRequest);
    assert.equal(quote.statusCode, 200);
    assertTraceHeader(quote);
    assertResponseFields(quote.body, ["quoteId", "snapshotId", "amountOut", "minAmountOut", "deadline", "nonce", "signature"]);
    assert.match(quote.body.quoteId, /^q_/);
    assert.equal(quote.body.amountOut, "998400000");
    assert.equal(quote.body.minAmountOut, "993408000");
    assert.match(quote.body.signature, /^0x[0-9a-fA-F]{130}$/);

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
    assertTraceHeader(submit);
    assertResponseFields(submit.body, ["status", "txHash", "settlementEventId", "hedgeOrderId", "pnlId"]);
    assert.equal(submit.body.status, "accepted");
    assert.match(submit.body.txHash, /^0x[0-9a-fA-F]{64}$/);
    assert.match(submit.body.settlementEventId, /^se_/);
    assert.match(submit.body.hedgeOrderId, /^h_/);
    assert.equal(submit.body.pnlId, `pnl_${quote.body.quoteId}`);

    const status = await injectJson(server, "GET", `/quote/${quote.body.quoteId}`);
    assert.equal(status.statusCode, 200);
    assertTraceHeader(status);
    assertResponseFields(status.body, [
      "quoteId",
      "status",
      "snapshotId",
      "deadline",
      "txHash",
      "settlementEventId",
      "hedgeOrderId",
      "pnlId",
    ]);
    assert.equal(status.body.quoteId, quote.body.quoteId);
    assert.equal(status.body.snapshotId, quote.body.snapshotId);
    assert.equal(status.body.deadline, quote.body.deadline);
    assert.equal(status.body.status, "settled");
    assert.equal(status.body.txHash, submit.body.txHash);
    assert.equal(status.body.settlementEventId, submit.body.settlementEventId);
    assert.equal(status.body.hedgeOrderId, submit.body.hedgeOrderId);
    assert.equal(status.body.pnlId, submit.body.pnlId);

    const settlement = await injectJson(server, "GET", `/settlements/${submit.body.settlementEventId}`);
    assert.equal(settlement.statusCode, 200);
    assertTraceHeader(settlement);
    assertResponseFields(settlement.body, [
      "settlementEventId",
      "status",
      "quoteId",
      "chainId",
      "txHash",
      "quoteHash",
      "blockNumber",
      "logIndex",
      "user",
      "tokenIn",
      "tokenOut",
      "amountIn",
      "amountOut",
      "nonce",
      "observedAt",
    ]);
    assert.equal(settlement.body.settlementEventId, submit.body.settlementEventId);
    assert.equal(settlement.body.status, "applied");
    assert.equal(settlement.body.quoteId, quote.body.quoteId);
    assert.equal(settlement.body.chainId, baseQuoteRequest.chainId);
    assert.equal(settlement.body.txHash, submit.body.txHash);
    assert.match(settlement.body.quoteHash, /^0x[0-9a-fA-F]{64}$/);
    assert.equal(settlement.body.blockNumber, 0);
    assert.equal(settlement.body.logIndex, 0);
    assert.equal(settlement.body.user, baseQuoteRequest.user);
    assert.equal(settlement.body.tokenIn, baseQuoteRequest.tokenIn);
    assert.equal(settlement.body.tokenOut, baseQuoteRequest.tokenOut);
    assert.equal(settlement.body.amountIn, baseQuoteRequest.amountIn);
    assert.equal(settlement.body.amountOut, quote.body.amountOut);
    assert.equal(settlement.body.nonce, quote.body.nonce);
    assert.match(settlement.body.observedAt, /^\d{4}-\d{2}-\d{2}T/);

    const hedge = await injectJson(server, "GET", `/hedges/${submit.body.hedgeOrderId}`);
    assert.equal(hedge.statusCode, 200);
    assertTraceHeader(hedge);
    assertResponseFields(hedge.body, [
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
    ]);
    assert.equal(hedge.body.hedgeOrderId, submit.body.hedgeOrderId);
    assert.equal(hedge.body.status, "queued");
    assert.equal(hedge.body.settlementEventId, submit.body.settlementEventId);
    assert.equal(hedge.body.quoteId, quote.body.quoteId);
    assert.equal(hedge.body.chainId, baseQuoteRequest.chainId);
    assert.equal(hedge.body.token, baseQuoteRequest.tokenOut);
    assert.equal(hedge.body.side, "buy");
    assert.equal(hedge.body.amount, quote.body.amountOut);
    assert.equal(hedge.body.reason, "inventory_rebalance");
    assert.match(hedge.body.createdAt, /^\d{4}-\d{2}-\d{2}T/);

    const pnl = await injectJson(server, "GET", "/pnl");
    assert.equal(pnl.statusCode, 200);
    assertTraceHeader(pnl);
    assertResponseFields(pnl.body, ["status", "totalTrades", "grossPnlTokenOut", "trades"]);
    assert.equal(pnl.body.status, "ok");
    assert.equal(pnl.body.totalTrades, 1);
    assert.equal(pnl.body.grossPnlTokenOut, "1600000");
    assert.equal(pnl.body.trades.length, 1);
    assertResponseFields(pnl.body.trades[0], [
      "pnlId",
      "quoteId",
      "chainId",
      "user",
      "tokenIn",
      "tokenOut",
      "amountIn",
      "amountOut",
      "minAmountOut",
      "nonce",
      "deadline",
      "grossPnlTokenOut",
      "grossPnlBps",
      "model",
      "modelDescription",
      "realizedAt",
    ]);
    assert.equal(pnl.body.trades[0].pnlId, submit.body.pnlId);
    assert.equal(pnl.body.trades[0].quoteId, quote.body.quoteId);
    assert.equal(pnl.body.trades[0].amountIn, baseQuoteRequest.amountIn);
    assert.equal(pnl.body.trades[0].amountOut, quote.body.amountOut);
    assert.equal(pnl.body.trades[0].grossPnlTokenOut, "1600000");
    assert.equal(pnl.body.trades[0].grossPnlBps, 16);
    assert.equal(pnl.body.trades[0].model, "simulated_mid_price_v1");
    assert.equal(pnl.body.trades[0].modelDescription, simulatedPnlModelDescription);
    assert.match(pnl.body.trades[0].realizedAt, /^\d{4}-\d{2}-\d{2}T/);

    const metrics = await server.inject({ method: "GET", url: "/metrics" });
    assert.equal(metrics.statusCode, 200);
    assertTraceHeader(metrics);
    assert.match(metrics.payload, /rfq_readiness_status\{status="ready"\} 1/);
    assert.match(metrics.payload, /rfq_readiness_status\{status="degraded"\} 0/);
    assert.match(metrics.payload, /rfq_dependency_status\{component="marketData",status="ok"\} 1/);
    assert.match(metrics.payload, /rfq_dependency_status\{component="signer",status="ok"\} 1/);
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
    assert.match(metrics.payload, /rfq_hedge_lag_seconds_count 1/);
    assert.match(metrics.payload, /rfq_hedge_lag_seconds_bucket\{le="\+Inf"\} 1/);
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

test("RFQ API rejects issued quotes with high-s malleated signatures", async () => {
  const server = buildServer({ logger: false });
  await server.ready();

  try {
    const quote = await injectJson(server, "POST", "/quote", baseQuoteRequest);
    assert.equal(quote.statusCode, 200);

    const response = await injectJson(server, "POST", "/submit", {
      quote: quotePayloadFromResponse(quote.body),
      signature: malleateSignature(quote.body.signature),
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.body.code, "INVALID_REQUEST");
    assert.equal(response.body.message, "signature s value must be in the lower half order");
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

test("RFQ API maps settlement event write failures before inventory updates", async () => {
  const server = buildServer({
    logger: false,
    settlementEventService: {
      checkHealth() {},
      applySettlementEvent() {
        throw new Error("settlement event store offline");
      },
      getSettlementEvent() {
        return undefined;
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
    assert.equal(response.body.code, "SETTLEMENT_EVENT_STORE_UNAVAILABLE");
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

function fixedSignature() {
  return `0x${"11".repeat(64)}1b`;
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

function uppercaseHex(value) {
  return `0x${value.slice(2).toUpperCase()}`;
}

function malleateSignature(signature) {
  const r = signature.slice(2, 66);
  const s = BigInt(`0x${signature.slice(66, 130)}`);
  const v = Number.parseInt(signature.slice(130, 132), 16);
  const highS = (secp256k1n - s).toString(16).padStart(64, "0");
  const flippedV = v === 27 ? 28 : 27;

  return `0x${r}${highS}${flippedV.toString(16).padStart(2, "0")}`;
}
