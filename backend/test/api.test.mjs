import assert from "node:assert/strict";
import test from "node:test";
import { buildServer, installGracefulShutdown } from "../dist/main.js";
import { InMemoryQuoteRepository } from "../dist/modules/quote/quote.repository.js";
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

test("production startup requires explicit signer configuration", () => {
  const originalEnv = {
    NODE_ENV: process.env.NODE_ENV,
    RFQ_SIGNER_PRIVATE_KEY: process.env.RFQ_SIGNER_PRIVATE_KEY,
    RFQ_SETTLEMENT_ADDRESS: process.env.RFQ_SETTLEMENT_ADDRESS,
    RFQ_QUOTE_TTL_SECONDS: process.env.RFQ_QUOTE_TTL_SECONDS,
    RFQ_BODY_LIMIT_BYTES: process.env.RFQ_BODY_LIMIT_BYTES,
    RFQ_CORS_ALLOWED_ORIGINS: process.env.RFQ_CORS_ALLOWED_ORIGINS,
    RFQ_ENABLE_HSTS: process.env.RFQ_ENABLE_HSTS,
  };

  try {
    process.env.NODE_ENV = "production";
    delete process.env.RFQ_SIGNER_PRIVATE_KEY;
    delete process.env.RFQ_SETTLEMENT_ADDRESS;
    delete process.env.RFQ_QUOTE_TTL_SECONDS;
    delete process.env.RFQ_BODY_LIMIT_BYTES;
    delete process.env.RFQ_CORS_ALLOWED_ORIGINS;
    delete process.env.RFQ_ENABLE_HSTS;

    assert.throws(
      () => buildServer({ logger: false }),
      /RFQ_SIGNER_PRIVATE_KEY is required when NODE_ENV=production/,
    );

    process.env.RFQ_SIGNER_PRIVATE_KEY =
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

    assert.throws(
      () => buildServer({ logger: false }),
      /RFQ_SETTLEMENT_ADDRESS is required when NODE_ENV=production/,
    );

    process.env.RFQ_SIGNER_PRIVATE_KEY = "replace-with-production-signer-private-key";
    process.env.RFQ_SETTLEMENT_ADDRESS = "0x0000000000000000000000000000000000000004";

    assert.throws(
      () => buildServer({ logger: false }),
      /RFQ_SIGNER_PRIVATE_KEY must be a 32-byte hex string when NODE_ENV=production/,
    );

    process.env.RFQ_SIGNER_PRIVATE_KEY =
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    process.env.RFQ_SETTLEMENT_ADDRESS = "replace-with-rfq-settlement-address";

    assert.throws(
      () => buildServer({ logger: false }),
      /RFQ_SETTLEMENT_ADDRESS must be a 20-byte hex address when NODE_ENV=production/,
    );
  } finally {
    restoreEnv("NODE_ENV", originalEnv.NODE_ENV);
    restoreEnv("RFQ_SIGNER_PRIVATE_KEY", originalEnv.RFQ_SIGNER_PRIVATE_KEY);
    restoreEnv("RFQ_SETTLEMENT_ADDRESS", originalEnv.RFQ_SETTLEMENT_ADDRESS);
    restoreEnv("RFQ_QUOTE_TTL_SECONDS", originalEnv.RFQ_QUOTE_TTL_SECONDS);
    restoreEnv("RFQ_BODY_LIMIT_BYTES", originalEnv.RFQ_BODY_LIMIT_BYTES);
    restoreEnv("RFQ_CORS_ALLOWED_ORIGINS", originalEnv.RFQ_CORS_ALLOWED_ORIGINS);
    restoreEnv("RFQ_ENABLE_HSTS", originalEnv.RFQ_ENABLE_HSTS);
  }
});

test("RFQ API uses RFQ_QUOTE_TTL_SECONDS for signed quote deadlines", async () => {
  const originalTtl = process.env.RFQ_QUOTE_TTL_SECONDS;
  const originalDateNow = Date.now;
  const fixedNow = originalDateNow();
  process.env.RFQ_QUOTE_TTL_SECONDS = "120";
  Date.now = () => fixedNow;

  const server = buildServer({ logger: false });
  await server.ready();

  try {
    const quote = await injectJson(server, "POST", "/quote", baseQuoteRequest);

    assert.equal(quote.statusCode, 200);
    assert.equal(quote.body.deadline, Math.floor(fixedNow / 1000) + 120);
  } finally {
    await server.close();
    Date.now = originalDateNow;
    restoreEnv("RFQ_QUOTE_TTL_SECONDS", originalTtl);
  }
});

test("RFQ API rejects invalid RFQ_QUOTE_TTL_SECONDS at startup", () => {
  const originalTtl = process.env.RFQ_QUOTE_TTL_SECONDS;

  try {
    process.env.RFQ_QUOTE_TTL_SECONDS = "0";

    assert.throws(
      () => buildServer({ logger: false }),
      /RFQ_QUOTE_TTL_SECONDS must be an integer between 1 and 3600/,
    );
  } finally {
    restoreEnv("RFQ_QUOTE_TTL_SECONDS", originalTtl);
  }
});

test("RFQ API rejects invalid RFQ_BODY_LIMIT_BYTES at startup", () => {
  const originalBodyLimit = process.env.RFQ_BODY_LIMIT_BYTES;

  try {
    process.env.RFQ_BODY_LIMIT_BYTES = "1023";

    assert.throws(
      () => buildServer({ logger: false }),
      /RFQ_BODY_LIMIT_BYTES must be an integer between 1024 and 1048576/,
    );
  } finally {
    restoreEnv("RFQ_BODY_LIMIT_BYTES", originalBodyLimit);
  }
});

test("RFQ API rejects invalid RFQ_CORS_ALLOWED_ORIGINS at startup", () => {
  const originalOrigins = process.env.RFQ_CORS_ALLOWED_ORIGINS;

  try {
    process.env.RFQ_CORS_ALLOWED_ORIGINS = "not-an-origin";

    assert.throws(
      () => buildServer({ logger: false }),
      /RFQ_CORS_ALLOWED_ORIGINS must be a comma-separated list of HTTP\(S\) origins/,
    );
  } finally {
    restoreEnv("RFQ_CORS_ALLOWED_ORIGINS", originalOrigins);
  }
});

test("RFQ API rejects invalid RFQ_ENABLE_HSTS at startup", () => {
  const originalHsts = process.env.RFQ_ENABLE_HSTS;

  try {
    process.env.RFQ_ENABLE_HSTS = "sometimes";

    assert.throws(
      () => buildServer({ logger: false }),
      /RFQ_ENABLE_HSTS must be true or false/,
    );
  } finally {
    restoreEnv("RFQ_ENABLE_HSTS", originalHsts);
  }
});

test("RFQ API emits baseline security headers on successful responses", async () => {
  const server = buildServer({ logger: false });
  await server.ready();

  try {
    const response = await server.inject({ method: "GET", url: "/health" });

    assert.equal(response.statusCode, 200);
    assertSecurityHeaders(response, { hsts: false });
  } finally {
    await server.close();
  }
});

test("RFQ API emits HSTS when enabled", async () => {
  const server = buildServer({ logger: false, enableHsts: true });
  await server.ready();

  try {
    const response = await server.inject({ method: "GET", url: "/health" });

    assert.equal(response.statusCode, 200);
    assertSecurityHeaders(response, { hsts: true });
  } finally {
    await server.close();
  }
});

test("RFQ API registers graceful shutdown handlers for termination signals", async () => {
  const listeners = new Map();
  const fakeProcess = {
    exitCode: undefined,
    on(signal, listener) {
      listeners.set(signal, listener);
    },
  };
  let closeCount = 0;
  const fakeServer = {
    async close() {
      closeCount += 1;
    },
  };

  installGracefulShutdown(fakeServer, fakeProcess);

  assert.equal(typeof listeners.get("SIGTERM"), "function");
  assert.equal(typeof listeners.get("SIGINT"), "function");

  listeners.get("SIGTERM")();
  listeners.get("SIGINT")();
  await flushMicrotasks();

  assert.equal(closeCount, 1);
  assert.equal(fakeProcess.exitCode, 0);
});

test("RFQ API marks graceful shutdown failures as process failures", async () => {
  const listeners = new Map();
  const fakeProcess = {
    exitCode: undefined,
    on(signal, listener) {
      listeners.set(signal, listener);
    },
  };
  const logged = [];
  const fakeServer = {
    async close() {
      throw new Error("close failed");
    },
  };

  installGracefulShutdown(fakeServer, fakeProcess, {
    error(input) {
      logged.push(input);
    },
  });

  listeners.get("SIGTERM")();
  await flushMicrotasks();

  assert.equal(fakeProcess.exitCode, 1);
  assert.match(String(logged[0]), /close failed/);
});

test("RFQ API emits CORS headers for allowed browser origins", async () => {
  const server = buildServer({
    logger: false,
    corsAllowedOrigins: ["https://app.example.com"],
  });
  await server.ready();

  try {
    const response = await server.inject({
      method: "GET",
      url: "/health",
      headers: { origin: "https://app.example.com" },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["access-control-allow-origin"], "https://app.example.com");
    assert.equal(response.headers.vary, "Origin");
    assert.equal(response.headers["access-control-allow-methods"], "GET,POST,OPTIONS");
    assert.equal(response.headers["access-control-allow-headers"], "content-type,x-trace-id");
    assert.equal(response.headers["access-control-max-age"], "600");
  } finally {
    await server.close();
  }
});

test("RFQ API answers CORS preflight for allowed origins", async () => {
  const server = buildServer({
    logger: false,
    corsAllowedOrigins: ["https://app.example.com"],
  });
  await server.ready();

  try {
    const response = await server.inject({
      method: "OPTIONS",
      url: "/quote",
      headers: {
        origin: "https://app.example.com",
        "access-control-request-method": "POST",
      },
    });

    assert.equal(response.statusCode, 204);
    assert.equal(response.headers["access-control-allow-origin"], "https://app.example.com");
    assert.equal(response.headers["access-control-allow-methods"], "GET,POST,OPTIONS");
    assert.equal(response.payload, "");
  } finally {
    await server.close();
  }
});

test("RFQ API rejects CORS preflight for disallowed origins", async () => {
  const server = buildServer({
    logger: false,
    corsAllowedOrigins: ["https://app.example.com"],
  });
  await server.ready();

  try {
    const response = await server.inject({
      method: "OPTIONS",
      url: "/quote",
      headers: {
        origin: "https://evil.example.com",
        "access-control-request-method": "POST",
      },
    });
    const body = JSON.parse(response.payload);

    assert.equal(response.statusCode, 403);
    assert.equal(body.code, "INVALID_REQUEST");
    assert.equal(body.message, "CORS origin is not allowed");
    assert.match(body.traceId, /^tr_/);
    assert.equal(response.headers["x-trace-id"], body.traceId);
    assert.equal(response.headers["access-control-allow-origin"], undefined);
  } finally {
    await server.close();
  }
});

test("RFQ API accepts quote, submit, status, and metrics flow", async () => {
  const server = buildServer({ logger: false });
  await server.ready();

  try {
    const health = await injectJson(server, "GET", "/health");
    assert.equal(health.statusCode, 200);
    assertTraceHeader(health);
    assert.equal(health.body.status, "ok");

    const ready = await injectJson(server, "GET", "/ready");
    assert.equal(ready.statusCode, 200);
    assertTraceHeader(ready);
    assert.equal(ready.body.status, "ready");
    assert.equal(ready.body.components.signer, "ok");
    assert.equal(ready.body.components.marketData, "ok");
    assert.equal(ready.body.components.routing, "ok");
    assert.equal(ready.body.components.pricing, "ok");
    assert.equal(ready.body.components.risk, "ok");
    assert.equal(ready.body.components.quoteRepository, "ok");
    assert.equal(ready.body.components.inventory, "ok");
    assert.equal(ready.body.components.execution, "ok");
    assert.equal(ready.body.components.settlementEventStore, "ok");
    assert.equal(ready.body.components.pnl, "ok");
    assert.equal(ready.body.components.metrics, "ok");

    const quote = await injectJson(server, "POST", "/quote", baseQuoteRequest);
    assert.equal(quote.statusCode, 200);
    assertTraceHeader(quote);
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
    assert.equal(submit.body.status, "accepted");
    assert.match(submit.body.txHash, /^0x[0-9a-fA-F]{64}$/);
    assert.match(submit.body.settlementEventId, /^se_/);
    assert.match(submit.body.hedgeOrderId, /^h_/);
    assert.equal(submit.body.pnlId, `pnl_${quote.body.quoteId}`);

    const status = await injectJson(server, "GET", `/quote/${quote.body.quoteId}`);
    assert.equal(status.statusCode, 200);
    assertTraceHeader(status);
    assert.equal(status.body.status, "settled");
    assert.equal(status.body.txHash, submit.body.txHash);
    assert.equal(status.body.settlementEventId, submit.body.settlementEventId);
    assert.equal(status.body.hedgeOrderId, submit.body.hedgeOrderId);
    assert.equal(status.body.pnlId, submit.body.pnlId);

    const settlement = await injectJson(server, "GET", `/settlements/${submit.body.settlementEventId}`);
    assert.equal(settlement.statusCode, 200);
    assertTraceHeader(settlement);
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
    assert.match(settlement.body.observedAt, /^\d{4}-\d{2}-\d{2}T/);

    const hedge = await injectJson(server, "GET", `/hedges/${submit.body.hedgeOrderId}`);
    assert.equal(hedge.statusCode, 200);
    assertTraceHeader(hedge);
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

test("RFQ API preserves signer errors when failed quote persistence fails", async () => {
  class FailingFailedStatusQuoteRepository extends InMemoryQuoteRepository {
    requestedQuoteId;

    async saveRequested(input) {
      this.requestedQuoteId = input.quoteId;
      await super.saveRequested(input);
    }

    async markFailed() {
      throw new Error("quote failed status store offline");
    }
  }

  const quoteRepository = new FailingFailedStatusQuoteRepository();
  const server = buildServer({
    logger: false,
    quoteRepository,
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
    assert.match(quoteRepository.requestedQuoteId, /^q_/);

    const status = await injectJson(server, "GET", `/quote/${quoteRepository.requestedQuoteId}`);
    assert.equal(status.statusCode, 200);
    assert.equal(status.body.status, "requested");
    assert.equal(status.body.errorCode, undefined);

    const metrics = await server.inject({ method: "GET", url: "/metrics" });
    assert.equal(metrics.statusCode, 200);
    assert.match(metrics.payload, /rfq_quote_requests_total 1/);
    assert.match(metrics.payload, /rfq_quote_errors_total 1/);
    assert.match(metrics.payload, /rfq_quote_responses_total 0/);
    assert.match(metrics.payload, /rfq_signer_requests_total\{operation="sign"\} 1/);
    assert.match(metrics.payload, /rfq_signer_errors_total\{operation="sign"\} 1/);
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

test("RFQ API maps settlement event store failures to structured errors", async () => {
  const server = buildServer({
    logger: false,
    settlementEventService: {
      applySettlementEvent() {
        throw new Error("not used");
      },
      getSettlementEvent() {
        throw new Error("settlement event store offline");
      },
    },
  });
  await server.ready();

  try {
    const response = await injectJson(server, "GET", "/settlements/se_missing");

    assert.equal(response.statusCode, 503);
    assert.equal(response.body.code, "SETTLEMENT_EVENT_STORE_UNAVAILABLE");
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

    const metrics = await server.inject({ method: "GET", url: "/metrics" });
    assert.equal(metrics.statusCode, 200);
    assert.match(metrics.payload, /rfq_readiness_status\{status="ready"\} 0/);
    assert.match(metrics.payload, /rfq_readiness_status\{status="degraded"\} 1/);
    assert.match(metrics.payload, /rfq_dependency_status\{component="marketData",status="degraded"\} 1/);
    assert.match(metrics.payload, /rfq_dependency_status\{component="signer",status="ok"\} 1/);
  } finally {
    await server.close();
  }
});

test("RFQ API degrades readiness when market data timestamp is too far in the future", async () => {
  const server = buildServer({
    logger: false,
    marketDataService: {
      async getSnapshot() {
        return {
          snapshotId: "snapshot_future",
          midPrice: "1",
          liquidityUsd: "10000000000000",
          volatilityBps: 25,
          observedAt: new Date(Date.now() + 60_000).toISOString(),
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

    const metrics = await server.inject({ method: "GET", url: "/metrics" });
    assert.equal(metrics.statusCode, 200);
    assert.match(metrics.payload, /rfq_readiness_status\{status="ready"\} 0/);
    assert.match(metrics.payload, /rfq_readiness_status\{status="degraded"\} 1/);
    assert.match(metrics.payload, /rfq_dependency_status\{component="marketData",status="ok"\} 1/);
    assert.match(metrics.payload, /rfq_dependency_status\{component="signer",status="degraded"\} 1/);
  } finally {
    await server.close();
  }
});

test("RFQ API degrades readiness when pricing probe fails", async () => {
  const server = buildServer({
    logger: false,
    pricingEngine: {
      async price() {
        throw new Error("pricing readiness probe failed");
      },
    },
  });
  await server.ready();

  try {
    const response = await injectJson(server, "GET", "/ready");

    assert.equal(response.statusCode, 503);
    assert.equal(response.body.status, "degraded");
    assert.equal(response.body.components.marketData, "ok");
    assert.equal(response.body.components.pricing, "degraded");
    assert.equal(response.body.components.risk, "ok");
    assert.equal(response.body.components.signer, "ok");

    const metrics = await server.inject({ method: "GET", url: "/metrics" });
    assert.equal(metrics.statusCode, 200);
    assert.match(metrics.payload, /rfq_dependency_status\{component="pricing",status="degraded"\} 1/);
    assert.match(metrics.payload, /rfq_dependency_status\{component="risk",status="ok"\} 1/);
  } finally {
    await server.close();
  }
});

test("RFQ API degrades readiness when routing probe fails", async () => {
  const server = buildServer({
    logger: false,
    routingEngine: {
      async selectRoute() {
        throw new Error("routing readiness probe failed");
      },
    },
  });
  await server.ready();

  try {
    const response = await injectJson(server, "GET", "/ready");

    assert.equal(response.statusCode, 503);
    assert.equal(response.body.status, "degraded");
    assert.equal(response.body.components.marketData, "ok");
    assert.equal(response.body.components.routing, "degraded");
    assert.equal(response.body.components.pricing, "ok");
    assert.equal(response.body.components.risk, "ok");
    assert.equal(response.body.components.signer, "ok");

    const metrics = await server.inject({ method: "GET", url: "/metrics" });
    assert.equal(metrics.statusCode, 200);
    assert.match(metrics.payload, /rfq_dependency_status\{component="routing",status="degraded"\} 1/);
    assert.match(metrics.payload, /rfq_dependency_status\{component="pricing",status="ok"\} 1/);
    assert.match(metrics.payload, /rfq_dependency_status\{component="risk",status="ok"\} 1/);
  } finally {
    await server.close();
  }
});

test("RFQ API degrades readiness when risk probe fails", async () => {
  const server = buildServer({
    logger: false,
    riskEngine: {
      async evaluate() {
        throw new Error("risk readiness probe failed");
      },
    },
  });
  await server.ready();

  try {
    const response = await injectJson(server, "GET", "/ready");

    assert.equal(response.statusCode, 503);
    assert.equal(response.body.status, "degraded");
    assert.equal(response.body.components.marketData, "ok");
    assert.equal(response.body.components.pricing, "ok");
    assert.equal(response.body.components.risk, "degraded");
    assert.equal(response.body.components.signer, "ok");

    const metrics = await server.inject({ method: "GET", url: "/metrics" });
    assert.equal(metrics.statusCode, 200);
    assert.match(metrics.payload, /rfq_dependency_status\{component="pricing",status="ok"\} 1/);
    assert.match(metrics.payload, /rfq_dependency_status\{component="risk",status="degraded"\} 1/);
  } finally {
    await server.close();
  }
});

test("RFQ API degrades readiness when storage dependency probes fail", async () => {
  const quoteRepository = new InMemoryQuoteRepository();
  quoteRepository.checkHealth = async () => {
    throw new Error("quote store offline");
  };
  const server = buildServer({
    logger: false,
    quoteRepository,
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
    assert.equal(response.body.components.quoteRepository, "degraded");
    assert.equal(response.body.components.execution, "degraded");
    assert.equal(response.body.components.settlementEventStore, "degraded");
    assert.equal(response.body.components.pnl, "degraded");

    const metrics = await server.inject({ method: "GET", url: "/metrics" });
    assert.equal(metrics.statusCode, 200);
    assert.match(metrics.payload, /rfq_dependency_status\{component="quoteRepository",status="degraded"\} 1/);
    assert.match(metrics.payload, /rfq_dependency_status\{component="execution",status="degraded"\} 1/);
    assert.match(metrics.payload, /rfq_dependency_status\{component="settlementEventStore",status="degraded"\} 1/);
    assert.match(metrics.payload, /rfq_dependency_status\{component="pnl",status="degraded"\} 1/);
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

test("RFQ API maps hedge status store failures to structured errors", async () => {
  const server = buildServer({
    logger: false,
    hedgeService: {
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

test("RFQ API keeps settlement accepted when PnL record creation fails", async () => {
  const server = buildServer({
    logger: false,
    pnlService: {
      recordSettlement() {
        throw new Error("pnl store offline");
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
    const quote = await injectJson(server, "POST", "/quote", baseQuoteRequest);
    assert.equal(quote.statusCode, 200);

    const submit = await injectJson(server, "POST", "/submit", {
      quote: quotePayloadFromResponse(quote.body),
      signature: quote.body.signature,
    });

    assert.equal(submit.statusCode, 202);
    assert.equal(submit.body.status, "accepted");
    assert.match(submit.body.settlementEventId, /^se_/);
    assert.match(submit.body.hedgeOrderId, /^h_/);
    assert.equal(submit.body.pnlId, undefined);

    const settlement = await injectJson(server, "GET", `/settlements/${submit.body.settlementEventId}`);
    assert.equal(settlement.statusCode, 200);
    assert.equal(settlement.body.status, "applied");
    assert.equal(settlement.body.quoteId, quote.body.quoteId);
    assert.match(settlement.body.quoteHash, /^0x[0-9a-fA-F]{64}$/);
    assert.equal(settlement.body.blockNumber, 0);

    const status = await injectJson(server, "GET", `/quote/${quote.body.quoteId}`);
    assert.equal(status.statusCode, 200);
    assert.equal(status.body.status, "settled");
    assert.equal(status.body.settlementEventId, submit.body.settlementEventId);
    assert.equal(status.body.hedgeOrderId, submit.body.hedgeOrderId);
    assert.equal(status.body.pnlId, undefined);

    const pnl = await injectJson(server, "GET", "/pnl");
    assert.equal(pnl.statusCode, 200);
    assert.equal(pnl.body.totalTrades, 0);

    const metrics = await server.inject({ method: "GET", url: "/metrics" });
    assert.equal(metrics.statusCode, 200);
    assert.match(metrics.payload, /rfq_submit_accepted_total 1/);
    assert.match(metrics.payload, /rfq_submit_errors_total 0/);
    assert.match(metrics.payload, /rfq_settlements_total 1/);
    assert.match(metrics.payload, /rfq_hedge_intents_total 1/);
    assert.match(metrics.payload, /rfq_pnl_trades_total 0/);
    assert.match(metrics.payload, /rfq_pnl_record_errors_total\{reason="PNL_RECORD_FAILED"\} 1/);
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

test("RFQ API rejects market data timestamps too far in the future", async () => {
  const server = buildServer({
    logger: false,
    marketDataService: {
      async getSnapshot() {
        return {
          snapshotId: "snapshot_future",
          midPrice: "1",
          liquidityUsd: "10000000000000",
          volatilityBps: 25,
          observedAt: new Date(Date.now() + 60_000).toISOString(),
        };
      },
    },
  });
  await server.ready();

  try {
    const response = await injectJson(server, "POST", "/quote", baseQuoteRequest);

    assert.equal(response.statusCode, 503);
    assert.equal(response.body.code, "MARKET_DATA_UNAVAILABLE");
    assert.match(response.body.message, /future/);
    assert.match(response.body.traceId, /^tr_/);
    assert.equal(response.headers["x-trace-id"], response.body.traceId);

    const metrics = await server.inject({ method: "GET", url: "/metrics" });
    assert.equal(metrics.statusCode, 200);
    assert.match(metrics.payload, /rfq_quote_requests_total 1/);
    assert.match(metrics.payload, /rfq_quote_errors_total 1/);
    assert.match(metrics.payload, /rfq_quote_responses_total 0/);
    assert.match(metrics.payload, /rfq_signer_requests_total\{operation="sign"\} 0/);
  } finally {
    await server.close();
  }
});

test("RFQ API maps market data failures to dependency errors before routing and signing", async () => {
  const server = buildServer({
    logger: false,
    marketDataService: {
      async getSnapshot() {
        throw new Error("market data backend offline");
      },
    },
  });
  await server.ready();

  try {
    const response = await injectJson(server, "POST", "/quote", baseQuoteRequest);

    assert.equal(response.statusCode, 503);
    assert.equal(response.body.code, "MARKET_DATA_UNAVAILABLE");
    assert.match(response.body.traceId, /^tr_/);
    assert.equal(response.headers["x-trace-id"], response.body.traceId);

    const metrics = await server.inject({ method: "GET", url: "/metrics" });
    assert.equal(metrics.statusCode, 200);
    assert.match(metrics.payload, /rfq_quote_requests_total 1/);
    assert.match(metrics.payload, /rfq_quote_errors_total 1/);
    assert.match(metrics.payload, /rfq_quote_responses_total 0/);
    assert.match(metrics.payload, /rfq_signer_requests_total\{operation="sign"\} 0/);
    assert.match(metrics.payload, /rfq_settlements_total 0/);
    assert.doesNotMatch(metrics.payload, /rfq_inventory_balance\{chain_id=/);
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

test("RFQ API maps routing engine failures to dependency errors before pricing and signing", async () => {
  const server = buildServer({
    logger: false,
    routingEngine: {
      async selectRoute() {
        throw new Error("routing backend offline");
      },
    },
  });
  await server.ready();

  try {
    const response = await injectJson(server, "POST", "/quote", baseQuoteRequest);

    assert.equal(response.statusCode, 503);
    assert.equal(response.body.code, "ROUTING_UNAVAILABLE");
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

test("RFQ API maps quote store failures before signing", async () => {
  const server = buildServer({
    logger: false,
    quoteRepository: {
      async saveRequested() {
        throw new Error("quote store offline");
      },
      async saveRejected() {},
      async saveSigned() {},
      async findStatus() {
        return undefined;
      },
      async markFailed() {},
      async markStatus() {},
      async findQuoteIdByChainUserNonce() {
        return undefined;
      },
      async findSignedQuoteByChainUserNonce() {
        return undefined;
      },
    },
  });
  await server.ready();

  try {
    const response = await injectJson(server, "POST", "/quote", baseQuoteRequest);

    assert.equal(response.statusCode, 503);
    assert.equal(response.body.code, "QUOTE_STORE_UNAVAILABLE");
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

test("RFQ API maps quote status store failures to structured errors", async () => {
  class FailingStatusQuoteRepository extends InMemoryQuoteRepository {
    async findStatus() {
      throw new Error("quote status store offline");
    }
  }

  const server = buildServer({
    logger: false,
    quoteRepository: new FailingStatusQuoteRepository(),
  });
  await server.ready();

  try {
    const response = await injectJson(server, "GET", "/quote/q_missing");

    assert.equal(response.statusCode, 503);
    assert.equal(response.body.code, "QUOTE_STORE_UNAVAILABLE");
    assert.match(response.body.traceId, /^tr_/);
    assert.equal(response.headers["x-trace-id"], response.body.traceId);
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

test("RFQ API preserves risk rejection when rejected quote persistence fails", async () => {
  class FailingRejectedQuoteRepository extends InMemoryQuoteRepository {
    requestedQuoteId;

    async saveRequested(input) {
      this.requestedQuoteId = input.quoteId;
      await super.saveRequested(input);
    }

    async saveRejected() {
      throw new Error("rejected quote store offline");
    }
  }

  const quoteRepository = new FailingRejectedQuoteRepository();
  const server = buildServer({
    logger: false,
    quoteRepository,
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
    assert.match(quoteRepository.requestedQuoteId, /^q_/);

    const status = await injectJson(server, "GET", `/quote/${quoteRepository.requestedQuoteId}`);
    assert.equal(status.statusCode, 200);
    assert.equal(status.body.status, "requested");
    assert.equal(status.body.errorCode, undefined);

    const metrics = await server.inject({ method: "GET", url: "/metrics" });
    assert.equal(metrics.statusCode, 200);
    assert.match(metrics.payload, /rfq_quote_requests_total 1/);
    assert.match(metrics.payload, /rfq_quote_errors_total 1/);
    assert.match(metrics.payload, /rfq_quote_responses_total 0/);
    assert.match(metrics.payload, /rfq_quote_rejections_total\{reason="TOXIC_FLOW_SCORE_EXCEEDED"\} 1/);
    assert.match(metrics.payload, /rfq_signer_requests_total\{operation="sign"\} 0/);
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
    assert.match(metrics.payload, /rfq_rate_limited_total\{endpoint="quote"\} 1/);
    assert.match(metrics.payload, /rfq_rate_limited_total\{endpoint="submit"\} 0/);
    assert.match(metrics.payload, /rfq_rate_limited_total\{endpoint="status"\} 0/);
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
    assert.match(metrics.payload, /rfq_rate_limited_total\{endpoint="quote"\} 0/);
    assert.match(metrics.payload, /rfq_rate_limited_total\{endpoint="submit"\} 1/);
    assert.match(metrics.payload, /rfq_rate_limited_total\{endpoint="status"\} 0/);
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

    const metrics = await server.inject({ method: "GET", url: "/metrics" });
    assert.equal(metrics.statusCode, 200);
    assert.match(metrics.payload, /rfq_rate_limited_total\{endpoint="quote"\} 0/);
    assert.match(metrics.payload, /rfq_rate_limited_total\{endpoint="submit"\} 0/);
    assert.match(metrics.payload, /rfq_rate_limited_total\{endpoint="status"\} 1/);
  } finally {
    await server.close();
  }
});

test("RFQ API maps PnL summary store failures to structured errors", async () => {
  const server = buildServer({
    logger: false,
    pnlService: {
      recordSettlement() {
        throw new Error("not used");
      },
      summary() {
        throw new Error("pnl store offline");
      },
    },
  });
  await server.ready();

  try {
    const response = await injectJson(server, "GET", "/pnl");

    assert.equal(response.statusCode, 503);
    assert.equal(response.body.code, "PNL_STORE_UNAVAILABLE");
    assert.match(response.body.traceId, /^tr_/);
    assert.equal(response.headers["x-trace-id"], response.body.traceId);
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
    assertSecurityHeaders(invalid, { hsts: false });

    const unsafeChainId = await injectJson(server, "POST", "/quote", {
      ...baseQuoteRequest,
      chainId: Number.MAX_SAFE_INTEGER + 1,
    });
    assert.equal(unsafeChainId.statusCode, 400);
    assert.equal(unsafeChainId.body.code, "INVALID_REQUEST");
    assert.match(unsafeChainId.body.message, /chainId must be a positive safe integer/);

    const notFound = await injectJson(server, "GET", "/quote/q_missing");
    assert.equal(notFound.statusCode, 404);
    assert.equal(notFound.body.code, "QUOTE_NOT_FOUND");
    assert.match(notFound.body.traceId, /^tr_/);
    assert.equal(notFound.headers["x-trace-id"], notFound.body.traceId);
  } finally {
    await server.close();
  }
});

test("RFQ API rejects unknown request fields", async () => {
  const server = buildServer({ logger: false });
  await server.ready();

  try {
    const quoteWithUnknownField = await injectJson(server, "POST", "/quote", {
      ...baseQuoteRequest,
      routeHint: "ignored-by-old-clients",
    });
    assert.equal(quoteWithUnknownField.statusCode, 400);
    assert.equal(quoteWithUnknownField.body.code, "INVALID_REQUEST");
    assert.equal(quoteWithUnknownField.body.message, "Quote request contains unknown field routeHint");
    assert.match(quoteWithUnknownField.body.traceId, /^tr_/);

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

    const submitWithUnknownField = await injectJson(server, "POST", "/submit", {
      quote,
      signature: fixedSignature(),
      relayer: baseQuoteRequest.user,
    });
    assert.equal(submitWithUnknownField.statusCode, 400);
    assert.equal(submitWithUnknownField.body.code, "INVALID_REQUEST");
    assert.equal(submitWithUnknownField.body.message, "Submit request contains unknown field relayer");

    const signedQuoteWithUnknownField = await injectJson(server, "POST", "/submit", {
      quote: {
        ...quote,
        permit: "unexpected",
      },
      signature: fixedSignature(),
    });
    assert.equal(signedQuoteWithUnknownField.statusCode, 400);
    assert.equal(signedQuoteWithUnknownField.body.code, "INVALID_REQUEST");
    assert.equal(signedQuoteWithUnknownField.body.message, "Submit quote contains unknown field permit");
  } finally {
    await server.close();
  }
});

test("RFQ API maps unmatched routes to structured errors", async () => {
  const server = buildServer({ logger: false });
  await server.ready();

  try {
    const missingRoute = await injectJson(server, "GET", "/not-a-real-route");

    assert.equal(missingRoute.statusCode, 404);
    assert.equal(missingRoute.body.code, "INVALID_REQUEST");
    assert.equal(missingRoute.body.message, "Route not found");
    assert.match(missingRoute.body.traceId, /^tr_/);
    assert.equal(missingRoute.headers["x-trace-id"], missingRoute.body.traceId);
    assertSecurityHeaders(missingRoute, { hsts: false });

    const unsupportedMethod = await injectJson(server, "PATCH", "/quote/q_missing");

    assert.equal(unsupportedMethod.statusCode, 404);
    assert.equal(unsupportedMethod.body.code, "INVALID_REQUEST");
    assert.equal(unsupportedMethod.body.message, "Route not found");
    assert.match(unsupportedMethod.body.traceId, /^tr_/);
    assert.equal(unsupportedMethod.headers["x-trace-id"], unsupportedMethod.body.traceId);
  } finally {
    await server.close();
  }
});

test("RFQ API maps malformed JSON bodies to structured errors", async () => {
  const server = buildServer({ logger: false });
  await server.ready();

  try {
    const response = await injectRaw(server, "POST", "/quote", '{"chainId":');

    assert.equal(response.statusCode, 400);
    assert.equal(response.body.code, "INVALID_REQUEST");
    assert.equal(response.body.message, "Malformed JSON request body");
    assert.match(response.body.traceId, /^tr_/);
    assert.equal(response.headers["x-trace-id"], response.body.traceId);
  } finally {
    await server.close();
  }
});

test("RFQ API maps oversized JSON bodies to structured errors", async () => {
  const server = buildServer({ logger: false, bodyLimitBytes: 128 });
  await server.ready();

  try {
    const response = await injectRaw(server, "POST", "/quote", JSON.stringify({
      ...baseQuoteRequest,
      amountIn: "1".repeat(256),
    }));

    assert.equal(response.statusCode, 413);
    assert.equal(response.body.code, "INVALID_REQUEST");
    assert.equal(response.body.message, "Request body too large");
    assert.match(response.body.traceId, /^tr_/);
    assert.equal(response.headers["x-trace-id"], response.body.traceId);
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

    const unsafeDeadline = await injectJson(server, "POST", "/submit", {
      quote: {
        ...quote,
        deadline: Number.MAX_SAFE_INTEGER + 1,
      },
      signature: fixedSignature(),
    });
    assert.equal(unsafeDeadline.statusCode, 400);
    assert.equal(unsafeDeadline.body.code, "INVALID_REQUEST");
    assert.match(unsafeDeadline.body.message, /quote\.deadline must be a positive safe integer/);

    const unsafeChainId = await injectJson(server, "POST", "/submit", {
      quote: {
        ...quote,
        chainId: Number.MAX_SAFE_INTEGER + 1,
      },
      signature: fixedSignature(),
    });
    assert.equal(unsafeChainId.statusCode, 400);
    assert.equal(unsafeChainId.body.code, "INVALID_REQUEST");
    assert.match(unsafeChainId.body.message, /quote\.chainId must be a positive safe integer/);
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

async function injectRaw(server, method, url, payload) {
  const response = await server.inject({
    method,
    url,
    headers: { "content-type": "application/json" },
    payload,
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

function assertTraceHeader(response) {
  assert.match(String(response.headers["x-trace-id"]), /^tr_/);
}

function assertSecurityHeaders(response, { hsts }) {
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  assert.equal(response.headers["x-frame-options"], "DENY");
  assert.equal(response.headers["referrer-policy"], "no-referrer");
  assert.equal(response.headers["permissions-policy"], "camera=(), microphone=(), geolocation=()");
  if (hsts) {
    assert.equal(response.headers["strict-transport-security"], "max-age=31536000; includeSubDomains");
  } else {
    assert.equal(response.headers["strict-transport-security"], undefined);
  }
}

function uppercaseHex(value) {
  return `0x${value.slice(2).toUpperCase()}`;
}

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}
