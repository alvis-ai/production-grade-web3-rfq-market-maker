import assert from "node:assert/strict";
import test from "node:test";
import { buildServer } from "../dist/main.js";
import { simulatedPnlModelDescription } from "../dist/shared/types/rfq.js";

const baseQuoteRequest = {
  chainId: 1,
  user: "0x0000000000000000000000000000000000000001",
  tokenIn: "0x0000000000000000000000000000000000000002",
  tokenOut: "0x0000000000000000000000000000000000000003",
  amountIn: "1000000000",
  slippageBps: 50,
};

test("RFQ API keeps settlement accepted when PnL record creation fails", async () => {
  const server = buildServer({
    logger: false,
    pnlService: {
      checkHealth() {},
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

test("RFQ API treats malformed PnL store results as post-settlement PnL failures", async () => {
  const malformedPnlRecordBuilders = [
    () => undefined,
    (validRecord) => Object.create(validRecord),
    (validRecord) => ({ ...validRecord, internalState: "unsafe" }),
    (validRecord) => ({ ...validRecord, pnlId: "pnl.bad" }),
    (validRecord) => ({ ...validRecord, amountOut: "1" }),
    (validRecord) => ({ ...validRecord, grossPnlTokenOut: "0" }),
    (validRecord) => ({ ...validRecord, modelDescription: "unsupported PnL model" }),
    (validRecord) => ({ ...validRecord, realizedAt: "2026-01-01T00:00:00Z" }),
  ];

  for (const buildMalformedPnlRecord of malformedPnlRecordBuilders) {
    const server = buildServer({
      logger: false,
      pnlService: {
        checkHealth() {},
        recordSettlement(input) {
          const grossPnl = BigInt(input.quote.amountIn) - BigInt(input.quote.amountOut);
          const validRecord = {
            pnlId: `pnl_${input.quoteId}`,
            quoteId: input.quoteId,
            chainId: input.quote.chainId,
            user: input.quote.user,
            tokenIn: input.quote.tokenIn,
            tokenOut: input.quote.tokenOut,
            amountIn: input.quote.amountIn,
            amountOut: input.quote.amountOut,
            minAmountOut: input.quote.minAmountOut,
            nonce: input.quote.nonce,
            deadline: input.quote.deadline,
            grossPnlTokenOut: grossPnl.toString(),
            grossPnlBps: Number((grossPnl * 10_000n) / BigInt(input.quote.amountIn)),
            model: "simulated_mid_price_v1",
            modelDescription: simulatedPnlModelDescription,
            realizedAt: "2026-01-01T00:00:00.000Z",
          };

          return buildMalformedPnlRecord(validRecord);
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

      const status = await injectJson(server, "GET", `/quote/${quote.body.quoteId}`);
      assert.equal(status.statusCode, 200);
      assert.equal(status.body.status, "settled");
      assert.equal(status.body.settlementEventId, submit.body.settlementEventId);
      assert.equal(status.body.pnlId, undefined);

      const pnl = await injectJson(server, "GET", "/pnl");
      assert.equal(pnl.statusCode, 200);
      assert.equal(pnl.body.totalTrades, 0);

      const metrics = await server.inject({ method: "GET", url: "/metrics" });
      assert.equal(metrics.statusCode, 200);
      assert.match(metrics.payload, /rfq_submit_accepted_total 1/);
      assert.match(metrics.payload, /rfq_submit_errors_total 0/);
      assert.match(metrics.payload, /rfq_settlements_total 1/);
      assert.match(metrics.payload, /rfq_pnl_trades_total 0/);
      assert.match(metrics.payload, /rfq_pnl_record_errors_total\{reason="PNL_RECORD_FAILED"\} 1/);
    } finally {
      await server.close();
    }
  }
});

test("RFQ API maps PnL summary store failures to structured errors", async () => {
  const server = buildServer({
    logger: false,
    pnlService: {
      checkHealth() {},
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
