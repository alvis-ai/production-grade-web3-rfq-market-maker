import assert from "node:assert/strict";
import test from "node:test";
import { buildServer } from "../dist/main.js";
import { InMemoryQuoteRepository } from "../dist/modules/quote/quote.repository.js";
import { BasicRiskEngine, defaultBasicRiskPolicy } from "../dist/modules/risk/risk.engine.js";
import {
  TokenLimitRiskEngine,
  defaultTokenLimitRiskPolicy,
} from "../dist/modules/risk/token-limit-risk.engine.js";

const baseQuoteRequest = {
  chainId: 1,
  user: "0x0000000000000000000000000000000000000001",
  tokenIn: "0x0000000000000000000000000000000000000002",
  tokenOut: "0x0000000000000000000000000000000000000003",
  amountIn: "1000000000",
  slippageBps: 50,
};

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

test("RFQ API rejects quotes when pricing spread exceeds risk guard before signing", async () => {
  const server = buildServer({
    logger: false,
    pricingEngine: {
      async price() {
        return {
          amountOut: "900000000",
          minAmountOut: "895500000",
          spreadBps: 1500,
          sizeImpactBps: 250,
          inventorySkewBps: 0,
          volatilityPremiumBps: 0,
          hedgeCostBps: 0,
          pricingVersion: "formula-v1:test-extreme-spread",
        };
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
    assert.match(metrics.payload, /rfq_quote_rejections_total\{reason="QUOTED_SPREAD_TOO_WIDE"\} 1/);
    assert.match(metrics.payload, /rfq_signer_requests_total\{operation="sign"\} 0/);
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

test("RFQ API rejects quotes that would exceed projected inventory limits", async () => {
  const server = buildServer({
    logger: false,
    riskEngine: new TokenLimitRiskEngine({
      ...defaultTokenLimitRiskPolicy,
      policyVersion: "api-inventory-limit-v1",
      tokenLimits: defaultTokenLimitRiskPolicy.tokenLimits.map((limit) => ({
        ...limit,
        maxAbsoluteInventory: "2000000000",
      })),
    }),
  });
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
