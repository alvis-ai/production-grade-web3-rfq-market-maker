import assert from "node:assert/strict";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import {
  RFQClient,
  RFQClientError,
  buildQuoteTypedData,
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
const signature = `0x${"11".repeat(64)}1b`;
const signerPrivateKey = "0x59c6995e998f97a5a0044966f094538d9dae1ffc26a3b6d86dae8e3a0b97e6a0";
const secp256k1n = BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141");

test("RFQClient rejects unsafe quote requests before sending HTTP", async () => {
  const calls = [];
  const restoreFetch = installFetch(async (url, init = {}) => {
    calls.push({ url, init });
    return jsonResponse(500, { code: "INTERNAL_ERROR", message: "unexpected", traceId: "tr_unexpected" });
  });
  const quoteRequest = {
    chainId: quote.chainId,
    user: quote.user,
    tokenIn: quote.tokenIn,
    tokenOut: quote.tokenOut,
    amountIn: quote.amountIn,
    slippageBps: 50,
  };
  const cases = [
    {
      request: undefined,
      message: "RFQ quote request must be an object",
    },
    {
      request: { ...quoteRequest, extra: true },
      message: "RFQ quote request must not include unknown field extra",
    },
    {
      request: Object.create(quoteRequest),
      message: "RFQ quote request missing required field chainId",
    },
    {
      request: { ...quoteRequest, chainId: 0 },
      message: "RFQ quote request chainId must be a positive safe integer",
    },
    {
      request: { ...quoteRequest, user: "0x1234" },
      message: "RFQ quote request user must be a 20-byte hex address",
    },
    {
      request: { ...quoteRequest, tokenOut: quoteRequest.tokenIn },
      message: "RFQ quote request tokenIn and tokenOut must be different",
    },
    {
      request: { ...quoteRequest, amountIn: "0" },
      message: "RFQ quote request amountIn must be a positive uint string",
    },
    {
      request: { ...quoteRequest, amountIn: "01000000000" },
      message: "RFQ quote request amountIn must be a positive uint string",
    },
    {
      request: { ...quoteRequest, slippageBps: 10_001 },
      message: "RFQ quote request slippageBps must be an integer from 0 to 10000",
    },
  ];

  try {
    const client = new RFQClient("http://127.0.0.1:3000");

    for (const { request, message } of cases) {
      await assert.rejects(
        client.quote(request),
        (error) => {
          assert.ok(error instanceof RFQClientError);
          assert.equal(error.status, 0);
          assert.equal(error.message, message);
          return true;
        },
      );
    }

    assert.equal(calls.length, 0);
  } finally {
    restoreFetch();
  }
});

test("RFQClient rejects unsafe submit requests before sending HTTP", async () => {
  const calls = [];
  const restoreFetch = installFetch(async (url, init = {}) => {
    calls.push({ url, init });
    return jsonResponse(500, { code: "INTERNAL_ERROR", message: "unexpected", traceId: "tr_unexpected" });
  });

  try {
    const client = new RFQClient("http://127.0.0.1:3000");

    await assert.rejects(
      client.submit(undefined),
      (error) => {
        assert.ok(error instanceof RFQClientError);
        assert.equal(error.status, 0);
        assert.equal(error.message, "RFQ submit request must be an object");
        return true;
      },
    );

    await assert.rejects(
      client.submit({ quote, signature, relayer: quote.user }),
      (error) => {
        assert.ok(error instanceof RFQClientError);
        assert.equal(error.status, 0);
        assert.equal(error.message, "RFQ submit request must not include unknown field relayer");
        return true;
      },
    );

    await assert.rejects(
      client.submit({ quote }),
      (error) => {
        assert.ok(error instanceof RFQClientError);
        assert.equal(error.status, 0);
        assert.equal(error.message, "RFQ submit request missing required field signature");
        return true;
      },
    );

    await assert.rejects(
      client.submit(Object.create({ quote, signature })),
      (error) => {
        assert.ok(error instanceof RFQClientError);
        assert.equal(error.status, 0);
        assert.equal(error.message, "RFQ submit request missing required field quote");
        return true;
      },
    );

    await assert.rejects(
      client.submit({ quote, signature: `0x${"11".repeat(64)}02` }),
      (error) => {
        assert.ok(error instanceof RFQClientError);
        assert.equal(error.status, 0);
        assert.equal(error.message, "RFQ submit request signature v value must be 27 or 28");
        return true;
      },
    );

    await assert.rejects(
      client.submit({ quote, signature, txHash: "0x1234" }),
      (error) => {
        assert.ok(error instanceof RFQClientError);
        assert.equal(error.status, 0);
        assert.equal(error.message, "RFQ submit request txHash must be a 32-byte hex string");
        return true;
      },
    );

    await assert.rejects(
      client.submit({ quote, signature: malleateSignature(await validTypedDataSignature()) }),
      (error) => {
        assert.ok(error instanceof RFQClientError);
        assert.equal(error.status, 0);
        assert.equal(error.message, "RFQ submit request signature s value must be in the lower half order");
        return true;
      },
    );

    await assert.rejects(
      client.submit({
        quote: {
          ...quote,
          tokenOut: quote.tokenIn,
        },
        signature,
      }),
      (error) => {
        assert.ok(error instanceof RFQClientError);
        assert.equal(error.status, 0);
        assert.equal(error.message, "RFQ submit request quote.tokenIn and quote.tokenOut must be different");
        return true;
      },
    );

    assert.equal(calls.length, 0);
  } finally {
    restoreFetch();
  }
});

test("RFQClient percent-encodes safe dynamic status path identifiers", async () => {
  const calls = [];
  const quoteId = "q:test-id";
  const hedgeOrderId = "h:test-id";
  const settlementEventId = "se:test-id";
  const restoreFetch = installFetch(async (url) => {
    calls.push(url);
    if (url.endsWith(`/quote/${encodeURIComponent(quoteId)}`)) {
      return jsonResponse(200, {
        quoteId,
        status: "settled",
        txHash: `0x${"22".repeat(32)}`,
        settlementEventId,
      });
    }
    if (url.endsWith(`/hedges/${encodeURIComponent(hedgeOrderId)}`)) {
      return jsonResponse(200, {
        hedgeOrderId,
        status: "queued",
        settlementEventId,
        quoteId,
        chainId: quote.chainId,
        token: quote.tokenOut,
        side: "buy",
        amount: quote.amountOut,
        reason: "inventory_rebalance",
        createdAt: "2026-06-27T00:00:00.000Z",
      });
    }
    if (url.endsWith(`/settlements/${encodeURIComponent(settlementEventId)}`)) {
      return jsonResponse(200, {
        settlementEventId,
        status: "applied",
        quoteId,
        chainId: quote.chainId,
        txHash: `0x${"22".repeat(32)}`,
        quoteHash: `0x${"33".repeat(32)}`,
        blockNumber: 123456,
        logIndex: 0,
        user: quote.user,
        tokenIn: quote.tokenIn,
        tokenOut: quote.tokenOut,
        amountIn: quote.amountIn,
        amountOut: quote.amountOut,
        nonce: quote.nonce,
        observedAt: "2026-06-27T00:00:00.000Z",
      });
    }

    return jsonResponse(404, { code: "QUOTE_NOT_FOUND", message: "not found", traceId: "trace_not_found" });
  });

  try {
    const client = new RFQClient("http://127.0.0.1:3000");

    await client.getQuote(quoteId);
    await client.getHedge(hedgeOrderId);
    await client.getSettlement(settlementEventId);

    assert.deepEqual(calls, [
      "http://127.0.0.1:3000/quote/q%3Atest-id",
      "http://127.0.0.1:3000/hedges/h%3Atest-id",
      "http://127.0.0.1:3000/settlements/se%3Atest-id",
    ]);
  } finally {
    restoreFetch();
  }
});

test("RFQClient rejects unsafe dynamic status identifiers before fetch", async () => {
  const calls = [];
  const restoreFetch = installFetch(async (url) => {
    calls.push(url);
    return jsonResponse(500, {
      code: "INTERNAL_ERROR",
      message: "unexpected fetch",
      traceId: "trace_unexpected_fetch",
    });
  });

  try {
    const client = new RFQClient("http://127.0.0.1:3000");

    for (const [operation, expectedMessage] of [
      [() => client.getQuote(new String("q_test")), "quoteId must be a primitive string"],
      [() => client.getQuote(" "), "quoteId must be a non-empty string"],
      [() => client.getQuote("q/bad"), "quoteId must contain only letters, numbers, underscore, colon, or hyphen"],
      [() => client.getQuote("q".repeat(129)), "quoteId must be 128 characters or fewer"],
      [() => client.getHedge(new String("h_test")), "hedgeOrderId must be a primitive string"],
      [() => client.getHedge(""), "hedgeOrderId must be a non-empty string"],
      [() => client.getHedge("h/bad"), "hedgeOrderId must contain only letters, numbers, underscore, colon, or hyphen"],
      [() => client.getHedge("h".repeat(129)), "hedgeOrderId must be 128 characters or fewer"],
      [() => client.getSettlement(new String("se_test")), "settlementEventId must be a primitive string"],
      [() => client.getSettlement(" \n "), "settlementEventId must be a non-empty string"],
      [
        () => client.getSettlement("se/bad"),
        "settlementEventId must contain only letters, numbers, underscore, colon, or hyphen",
      ],
      [() => client.getSettlement("s".repeat(129)), "settlementEventId must be 128 characters or fewer"],
    ]) {
      await assert.rejects(operation(), (error) => {
        assert.ok(error instanceof RFQClientError);
        assert.equal(error.status, 0);
        assert.equal(error.code, "RFQ_CLIENT_ERROR");
        assert.equal(error.message, expectedMessage);
        return true;
      });
    }

    assert.deepEqual(calls, []);
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

function jsonResponse(status, payload, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: responseHeaders(headers),
    async json() {
      return payload;
    },
  };
}

function responseHeaders(headers) {
  const normalized = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    get(name) {
      return normalized.get(name.toLowerCase()) ?? null;
    },
  };
}

function malleateSignature(value) {
  const r = value.slice(2, 66);
  const s = BigInt(`0x${value.slice(66, 130)}`);
  const v = Number.parseInt(value.slice(130, 132), 16);
  const highS = (secp256k1n - s).toString(16).padStart(64, "0");
  const flippedV = v === 27 ? 28 : 27;

  return `0x${r}${highS}${flippedV.toString(16).padStart(2, "0")}`;
}

async function validTypedDataSignature() {
  const account = privateKeyToAccount(signerPrivateKey);
  return account.signTypedData(buildQuoteTypedData(quote, verifyingContract));
}
