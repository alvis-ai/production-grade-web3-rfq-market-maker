import assert from "node:assert/strict";
import test from "node:test";
import { recoverTypedDataAddress, verifyTypedData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  RFQClient,
  RFQClientError,
  buildQuoteTypedData,
  buildRFQDomain,
  buildSubmitQuoteArgs,
  quoteTypes,
} from "../dist/index.js";

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

const verifyingContract = "0x0000000000000000000000000000000000000004";
const signature = `0x${"11".repeat(65)}`;
const signerPrivateKey = "0x59c6995e998f97a5a0044966f094538d9dae1ffc26a3b6d86dae8e3a0b97e6a0";

test("buildRFQDomain and buildQuoteTypedData preserve EIP-712 quote schema", () => {
  assert.deepEqual(buildRFQDomain(quote.chainId, verifyingContract), {
    name: "ProductionGradeRFQ",
    version: "1",
    chainId: quote.chainId,
    verifyingContract,
  });

  const typedData = buildQuoteTypedData(quote, verifyingContract);

  assert.equal(typedData.primaryType, "Quote");
  assert.deepEqual(typedData.message, quote);
  assert.deepEqual(typedData.types, quoteTypes);
  assert.deepEqual(
    typedData.types.Quote.map((field) => `${field.name}:${field.type}`),
    [
      "user:address",
      "tokenIn:address",
      "tokenOut:address",
      "amountIn:uint256",
      "amountOut:uint256",
      "minAmountOut:uint256",
      "nonce:uint256",
      "deadline:uint256",
      "chainId:uint256",
    ],
  );
});

test("buildQuoteTypedData produces viem-verifiable EIP-712 payloads", async () => {
  const account = privateKeyToAccount(signerPrivateKey);
  const typedData = buildQuoteTypedData(quote, verifyingContract);
  const signed = await account.signTypedData(typedData);

  assert.match(signed, /^0x[0-9a-fA-F]{130}$/);
  assert.equal(
    (await recoverTypedDataAddress({
      ...typedData,
      signature: signed,
    })).toLowerCase(),
    account.address.toLowerCase(),
  );
  assert.equal(
    await verifyTypedData({
      ...typedData,
      address: account.address,
      signature: signed,
    }),
    true,
  );
});

test("buildSubmitQuoteArgs converts string integer fields to settlement bigint fields", () => {
  const args = buildSubmitQuoteArgs(quote, signature);

  assert.equal(args[1], signature);
  assert.deepEqual(args[0], {
    user: quote.user,
    tokenIn: quote.tokenIn,
    tokenOut: quote.tokenOut,
    amountIn: 1000000000n,
    amountOut: 1000000000n,
    minAmountOut: 995000000n,
    nonce: 42n,
    deadline: 1893456000n,
    chainId: 1n,
  });
});

test("RFQClient sends quote, submit, status, health, and metrics requests with expected shapes", async () => {
  const calls = [];
  const quoteResponse = {
    quoteId: "q_test",
    snapshotId: "s_test",
    amountOut: "1000000000",
    minAmountOut: "995000000",
    deadline: 1893456000,
    nonce: "42",
    signature,
  };
  const submitResponse = {
    status: "accepted",
    txHash: `0x${"22".repeat(32)}`,
  };
  const statusResponse = {
    quoteId: "q_test",
    status: "settled",
    txHash: submitResponse.txHash,
  };
  const healthResponse = { status: "ok" };
  const readinessResponse = {
    status: "ready",
    components: {
      signer: "ok",
      marketData: "ok",
    },
  };
  const metricsResponse = [
    "# TYPE rfq_quote_requests_total counter",
    "rfq_quote_requests_total 1",
    "",
  ].join("\n");

  const restoreFetch = installFetch(async (url, init = {}) => {
    calls.push({ url, init });
    if (url.endsWith("/quote") && init.method === "POST") {
      return jsonResponse(200, quoteResponse);
    }
    if (url.endsWith("/submit") && init.method === "POST") {
      return jsonResponse(202, submitResponse);
    }
    if (url.endsWith("/quote/q_test")) {
      return jsonResponse(200, statusResponse);
    }
    if (url.endsWith("/health")) {
      return jsonResponse(200, healthResponse);
    }
    if (url.endsWith("/ready")) {
      return jsonResponse(200, readinessResponse);
    }
    if (url.endsWith("/metrics")) {
      return textResponse(200, metricsResponse);
    }
    return jsonResponse(404, { code: "NOT_FOUND", message: "not found", traceId: "trace_not_found" });
  });

  try {
    const client = new RFQClient("http://127.0.0.1:3000");

    assert.deepEqual(await client.quote({
      chainId: quote.chainId,
      user: quote.user,
      tokenIn: quote.tokenIn,
      tokenOut: quote.tokenOut,
      amountIn: quote.amountIn,
      slippageBps: 50,
    }), quoteResponse);
    assert.deepEqual(await client.submit({ quote, signature }), submitResponse);
    assert.deepEqual(await client.getQuote("q_test"), statusResponse);
    assert.deepEqual(await client.health(), healthResponse);
    assert.deepEqual(await client.ready(), readinessResponse);
    assert.equal(await client.metrics(), metricsResponse);

    assert.equal(calls.length, 6);
    assert.equal(calls[0].url, "http://127.0.0.1:3000/quote");
    assert.equal(calls[0].init.headers["content-type"], "application/json");
    assert.deepEqual(JSON.parse(calls[1].init.body), { quote, signature });
    assert.equal(calls[2].url, "http://127.0.0.1:3000/quote/q_test");
    assert.equal(calls[3].url, "http://127.0.0.1:3000/health");
    assert.equal(calls[4].url, "http://127.0.0.1:3000/ready");
    assert.equal(calls[5].url, "http://127.0.0.1:3000/metrics");
  } finally {
    restoreFetch();
  }
});

test("RFQClient throws structured RFQClientError for API errors", async () => {
  const restoreFetch = installFetch(async () =>
    jsonResponse(409, {
      code: "RISK_REJECTED",
      message: "Risk policy rejected quote",
      traceId: "trace_test",
    }),
  );

  try {
    const client = new RFQClient("http://127.0.0.1:3000");

    await assert.rejects(
      client.quote({
        chainId: quote.chainId,
        user: quote.user,
        tokenIn: quote.tokenIn,
        tokenOut: quote.tokenOut,
        amountIn: quote.amountIn,
        slippageBps: 999,
      }),
      (error) => {
        assert.ok(error instanceof RFQClientError);
        assert.equal(error.status, 409);
        assert.equal(error.code, "RISK_REJECTED");
        assert.equal(error.message, "Risk policy rejected quote");
        assert.equal(error.traceId, "trace_test");
        return true;
      },
    );
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

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    },
  };
}

function textResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      throw new Error("text response does not support json");
    },
    async text() {
      return payload;
    },
  };
}
