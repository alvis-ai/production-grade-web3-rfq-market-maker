import assert from "node:assert/strict";
import test from "node:test";
import { buildServer } from "../dist/main.js";
import { localTestSignerService } from "./helpers/signer-runtime-fixtures.mjs";

const quoteRequest = {
  chainId: 1,
  user: "0x0000000000000000000000000000000000000001",
  tokenIn: "0x0000000000000000000000000000000000000002",
  tokenOut: "0x0000000000000000000000000000000000000003",
  amountIn: "1000000000",
  slippageBps: 50,
};

test("POST /quote signs once and replays the exact response for one idempotency key", async () => {
  const signer = localTestSignerService();
  let signCalls = 0;
  const server = buildServer({
    logger: false,
    signerService: {
      async signQuote(input) {
        signCalls += 1;
        return signer.signQuote(input);
      },
      verifyQuoteSignature: signer.verifyQuoteSignature.bind(signer),
    },
  });
  await server.ready();
  try {
    const first = await injectQuote(server, quoteRequest, "quote_request_api_0001");
    const replay = await injectQuote(server, quoteRequest, "quote_request_api_0001");
    assert.equal(first.statusCode, 200);
    assert.equal(replay.statusCode, 200);
    assert.deepEqual(replay.body, first.body);
    assert.equal(replay.headers["idempotency-key"], "quote_request_api_0001");
    assert.equal(signCalls, 1);

    const conflict = await injectQuote(server, { ...quoteRequest, amountIn: "2" }, "quote_request_api_0001");
    assert.equal(conflict.statusCode, 409);
    assert.equal(conflict.body.code, "IDEMPOTENCY_KEY_CONFLICT");
  } finally {
    await server.close();
  }
});

test("POST /quote rejects invalid keys and fails closed on active or unavailable storage", async () => {
  const invalidServer = buildServer({ logger: false });
  await invalidServer.ready();
  try {
    const invalid = await injectQuote(invalidServer, quoteRequest, "short");
    assert.equal(invalid.statusCode, 400);
    assert.equal(invalid.body.code, "INVALID_REQUEST");
  } finally {
    await invalidServer.close();
  }

  for (const [claim, expectedCode, expectedStatus] of [
    [async () => ({ status: "in_progress" }), "IDEMPOTENCY_REQUEST_IN_PROGRESS", 409],
    [async () => { throw new Error("database unavailable"); }, "QUOTE_STORE_UNAVAILABLE", 503],
  ]) {
    const server = buildServer({ logger: false, quoteIdempotencyStore: stubStore(claim) });
    await server.ready();
    try {
      const response = await injectQuote(server, quoteRequest, "quote_request_api_0002");
      assert.equal(response.statusCode, expectedStatus);
      assert.equal(response.body.code, expectedCode);
    } finally {
      await server.close();
    }
  }
});

function stubStore(acquire) {
  return {
    acquire,
    async bindQuote() {},
    async complete() {},
    async fail() {},
    checkHealth() {},
  };
}

async function injectQuote(server, payload, idempotencyKey) {
  const response = await server.inject({
    method: "POST",
    url: "/quote",
    headers: {
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
    },
    payload: JSON.stringify(payload),
  });
  return {
    statusCode: response.statusCode,
    headers: response.headers,
    body: JSON.parse(response.payload),
  };
}
