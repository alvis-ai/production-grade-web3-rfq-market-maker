import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { buildServer } from "../dist/main.js";
import { Sha256ApiKeyAuthenticator } from "../dist/modules/auth/api-key-auth.service.js";

const request = {
  chainId: 1,
  user: "0x0000000000000000000000000000000000000001",
  tokenIn: "0x0000000000000000000000000000000000000002",
  tokenOut: "0x0000000000000000000000000000000000000003",
  amountIn: "1000000000",
  slippageBps: 50,
};
const secrets = {
  primary: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  rotated: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  other: "cccccccccccccccccccccccccccccccccccccccc",
};
const keys = {
  primary: `institution_a_primary.${secrets.primary}`,
  rotated: `institution_a_rotated.${secrets.rotated}`,
  other: `institution_b_primary.${secrets.other}`,
};

test("RFQ API isolates quote and post-trade resources by stable principal", async () => {
  const server = buildServer({ logger: false, apiKeyAuthenticator: authenticator() });
  await server.ready();
  try {
    const quote = await injectJson(server, "POST", "/quote", request, keys.primary);
    assert.equal(quote.statusCode, 200);

    const rotatedStatus = await injectJson(server, "GET", `/quote/${quote.body.quoteId}`, undefined, keys.rotated);
    assert.equal(rotatedStatus.statusCode, 200);
    assert.equal(rotatedStatus.body.quoteId, quote.body.quoteId);

    const foreignStatus = await injectJson(server, "GET", `/quote/${quote.body.quoteId}`, undefined, keys.other);
    assertNotFound(foreignStatus, "QUOTE_NOT_FOUND");

    const submitPayload = {
      quote: {
        user: request.user,
        tokenIn: request.tokenIn,
        tokenOut: request.tokenOut,
        amountIn: request.amountIn,
        amountOut: quote.body.amountOut,
        minAmountOut: quote.body.minAmountOut,
        nonce: quote.body.nonce,
        deadline: quote.body.deadline,
        chainId: request.chainId,
      },
      signature: quote.body.signature,
    };
    const foreignSubmit = await injectJson(server, "POST", "/submit", submitPayload, keys.other);
    assertNotFound(foreignSubmit, "QUOTE_NOT_FOUND");

    const submit = await injectJson(server, "POST", "/submit", submitPayload, keys.rotated);
    assert.equal(submit.statusCode, 202);

    const foreignSettlement = await injectJson(
      server,
      "GET",
      `/settlements/${submit.body.settlementEventId}`,
      undefined,
      keys.other,
    );
    assertNotFound(foreignSettlement, "SETTLEMENT_EVENT_NOT_FOUND");
    const ownSettlement = await injectJson(
      server,
      "GET",
      `/settlements/${submit.body.settlementEventId}`,
      undefined,
      keys.primary,
    );
    assert.equal(ownSettlement.statusCode, 200);

    const foreignHedge = await injectJson(
      server,
      "GET",
      `/hedges/${submit.body.hedgeOrderId}`,
      undefined,
      keys.other,
    );
    assertNotFound(foreignHedge, "HEDGE_NOT_FOUND");
    const ownHedge = await injectJson(
      server,
      "GET",
      `/hedges/${submit.body.hedgeOrderId}`,
      undefined,
      keys.rotated,
    );
    assert.equal(ownHedge.statusCode, 200);

    const ownPnl = await injectJson(server, "GET", "/pnl", undefined, keys.primary);
    const foreignPnl = await injectJson(server, "GET", "/pnl", undefined, keys.other);
    assert.equal(ownPnl.statusCode, 200);
    assert.equal(ownPnl.body.totalTrades, 1);
    assert.equal(foreignPnl.statusCode, 200);
    assert.equal(foreignPnl.body.totalTrades, 0);
    assert.deepEqual(foreignPnl.body.trades, []);
  } finally {
    await server.close();
  }
});

function authenticator() {
  const scopes = ["quote:write", "submit:write", "status:read", "pnl:read"];
  return new Sha256ApiKeyAuthenticator({ keys: [
    keyConfig("institution_a_primary", "institution_a", secrets.primary, scopes),
    keyConfig("institution_a_rotated", "institution_a", secrets.rotated, scopes),
    keyConfig("institution_b_primary", "institution_b", secrets.other, scopes),
  ] });
}

function keyConfig(keyId, principalId, secret, scopes) {
  return {
    keyId,
    principalId,
    secretSha256: createHash("sha256").update(secret).digest("hex"),
    scopes,
    expiresAt: "2099-01-01T00:00:00.000Z",
  };
}

async function injectJson(server, method, url, payload, apiKey) {
  const response = await server.inject({
    method,
    url,
    headers: {
      "x-api-key": apiKey,
      ...(payload === undefined ? {} : { "content-type": "application/json" }),
    },
    payload: payload === undefined ? undefined : JSON.stringify(payload),
  });
  return {
    statusCode: response.statusCode,
    body: response.payload ? JSON.parse(response.payload) : undefined,
  };
}

function assertNotFound(response, code) {
  assert.equal(response.statusCode, 404);
  assert.equal(response.body.code, code);
}
