import assert from "node:assert/strict";
import test from "node:test";
import { buildServer } from "../dist/main.js";
import { APIError } from "../dist/shared/errors/api-error.js";

const quoteRequest = {
  chainId: 1,
  user: "0x0000000000000000000000000000000000000001",
  tokenIn: "0x0000000000000000000000000000000000000002",
  tokenOut: "0x0000000000000000000000000000000000000003",
  amountIn: "1000000000",
  slippageBps: 50,
};
const txHash = `0x${"ab".repeat(32)}`;

test("RFQ API applies receipt-confirmed settlement evidence from a wallet txHash", async () => {
  const originalDateNow = Date.now;
  const quotedAt = originalDateNow();
  const calls = [];
  const settlementEvidenceProvider = {
    async resolve(request, context) {
      calls.push({ request, context });
      return { txHash: request.txHash, blockNumber: 123, logIndex: 4 };
    },
  };
  const server = buildServer({ logger: false, settlementEvidenceProvider });
  await server.ready();

  try {
    const quoteResponse = await injectJson(server, "POST", "/quote", quoteRequest);
    assert.equal(quoteResponse.statusCode, 200);
    const signedQuote = {
      user: quoteRequest.user,
      tokenIn: quoteRequest.tokenIn,
      tokenOut: quoteRequest.tokenOut,
      amountIn: quoteRequest.amountIn,
      amountOut: quoteResponse.body.amountOut,
      minAmountOut: quoteResponse.body.minAmountOut,
      nonce: quoteResponse.body.nonce,
      deadline: quoteResponse.body.deadline,
      chainId: quoteRequest.chainId,
    };
    Date.now = () => quotedAt + 31_000;
    assert.ok(signedQuote.deadline < Math.floor(Date.now() / 1_000));
    const submit = await injectJson(server, "POST", "/submit", {
      quote: signedQuote,
      signature: quoteResponse.body.signature,
      txHash: txHash.toUpperCase().replace("0X", "0x"),
    });

    assert.equal(submit.statusCode, 202, JSON.stringify(submit.body));
    assert.equal(submit.body.txHash, txHash);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].request.txHash, txHash);
    assert.equal(calls[0].context.quoteId, quoteResponse.body.quoteId);

    const settlement = await injectJson(
      server,
      "GET",
      `/settlements/${encodeURIComponent(submit.body.settlementEventId)}`,
    );
    assert.equal(settlement.statusCode, 200);
    assert.equal(settlement.body.blockNumber, 123);
    assert.equal(settlement.body.logIndex, 4);
    assert.equal(settlement.body.txHash, txHash);

    const status = await injectJson(server, "GET", `/quote/${quoteResponse.body.quoteId}`);
    assert.equal(status.body.status, "settled");
    assert.equal(status.body.txHash, txHash);
  } finally {
    Date.now = originalDateNow;
    await server.close();
  }
});

test("RFQ API keeps quotes retryable when an untrusted txHash has mismatched evidence", async () => {
  const server = buildServer({
    logger: false,
    settlementEvidenceProvider: {
      async resolve() {
        throw new APIError(
          "SETTLEMENT_REVERTED",
          "Settlement transaction sender does not match quote user",
          409,
          undefined,
          "SETTLEMENT_SENDER_MISMATCH",
        );
      },
    },
  });
  await server.ready();
  try {
    const quoteResponse = await injectJson(server, "POST", "/quote", quoteRequest);
    const signedQuote = {
      ...quoteRequest,
      amountOut: quoteResponse.body.amountOut,
      minAmountOut: quoteResponse.body.minAmountOut,
      nonce: quoteResponse.body.nonce,
      deadline: quoteResponse.body.deadline,
    };
    delete signedQuote.slippageBps;
    const submit = await injectJson(server, "POST", "/submit", {
      quote: signedQuote,
      signature: quoteResponse.body.signature,
      txHash,
    });
    assert.equal(submit.statusCode, 409);

    const status = await injectJson(server, "GET", `/quote/${quoteResponse.body.quoteId}`);
    assert.equal(status.body.status, "signed");
    assert.equal(status.body.errorCode, undefined);
  } finally {
    await server.close();
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
    body: response.payload ? JSON.parse(response.payload) : undefined,
  };
}
