import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { buildServer } from "../dist/main.js";
import { Sha256ApiKeyAuthenticator } from "../dist/modules/auth/api-key-auth.service.js";
import { InMemoryQuoteControlStore } from "../dist/modules/quote-control/quote-control.store.js";

const quoteRequest = {
  chainId: 1,
  user: "0x0000000000000000000000000000000000000001",
  tokenIn: "0x0000000000000000000000000000000000000002",
  tokenOut: "0x0000000000000000000000000000000000000003",
  amountIn: "1000000000",
  slippageBps: 50,
};

test("quote control pauses and resumes quote creation with CAS semantics", async () => {
  let now = Date.parse("2026-07-14T00:00:00.000Z");
  const quoteControlStore = new InMemoryQuoteControlStore(() => now);
  const server = buildServer({ logger: false, quoteControlStore });

  try {
    await server.ready();
    const initial = await inject(server, "GET", "/admin/quote-control");
    assert.equal(initial.statusCode, 200);
    assert.deepEqual(initial.body, {
      paused: false,
      version: 0,
      reason: null,
      updatedBy: "system",
      updatedAt: "2026-07-14T00:00:00.000Z",
    });

    const issuedBeforePause = await inject(server, "POST", "/quote", quoteRequest);
    assert.equal(issuedBeforePause.statusCode, 200, JSON.stringify(issuedBeforePause.body));

    now += 1_000;
    const paused = await inject(server, "PUT", "/admin/quote-control", {
      paused: true,
      reason: "venue incident",
      expectedVersion: 0,
    });
    assert.equal(paused.statusCode, 200);
    assert.equal(paused.body.paused, true);
    assert.equal(paused.body.version, 1);
    assert.equal(paused.body.updatedBy, "local");

    const blocked = await inject(server, "POST", "/quote", quoteRequest);
    assert.equal(blocked.statusCode, 503);
    assert.equal(blocked.body.code, "QUOTE_PAUSED");

    const submitDuringPause = await inject(server, "POST", "/submit", {
      quote: {
        user: quoteRequest.user,
        tokenIn: quoteRequest.tokenIn,
        tokenOut: quoteRequest.tokenOut,
        amountIn: quoteRequest.amountIn,
        amountOut: issuedBeforePause.body.amountOut,
        minAmountOut: issuedBeforePause.body.minAmountOut,
        nonce: issuedBeforePause.body.nonce,
        deadline: issuedBeforePause.body.deadline,
        chainId: quoteRequest.chainId,
      },
      signature: issuedBeforePause.body.signature,
    });
    assert.equal(submitDuringPause.statusCode, 202, JSON.stringify(submitDuringPause.body));

    const conflict = await inject(server, "PUT", "/admin/quote-control", {
      paused: false,
      reason: "stale operator view",
      expectedVersion: 0,
    });
    assert.equal(conflict.statusCode, 409);
    assert.equal(conflict.body.code, "QUOTE_CONTROL_CONFLICT");

    now += 1_000;
    const resumed = await inject(server, "PUT", "/admin/quote-control", {
      paused: false,
      reason: "venue recovered",
      expectedVersion: 1,
    });
    assert.equal(resumed.statusCode, 200);
    assert.equal(resumed.body.paused, false);
    assert.equal(resumed.body.version, 2);

    const quote = await inject(server, "POST", "/quote", quoteRequest);
    assert.equal(quote.statusCode, 200, JSON.stringify(quote.body));
    const metrics = await server.inject({ method: "GET", url: "/metrics" });
    assert.match(metrics.payload, /rfq_quote_paused 0/);
    assert.match(metrics.payload, /rfq_quote_control_updates_total 2/);
  } finally {
    await server.close();
  }
});

test("pair quote control pauses both directions without blocking existing signed quote submission", async () => {
  let now = Date.parse("2026-07-14T00:00:00.000Z");
  const quoteControlStore = new InMemoryQuoteControlStore(() => now);
  const server = buildServer({ logger: false, quoteControlStore });
  const pairPath = `/admin/quote-control/pairs/${quoteRequest.chainId}/${quoteRequest.tokenOut}/${quoteRequest.tokenIn}`;

  try {
    await server.ready();
    const unconfigured = await inject(server, "GET", pairPath);
    assert.equal(unconfigured.statusCode, 200);
    assert.equal(unconfigured.body.state, null);
    assert.deepEqual(unconfigured.body.scope, {
      chainId: 1,
      tokenLow: quoteRequest.tokenIn,
      tokenHigh: quoteRequest.tokenOut,
    });
    const invalidScope = await inject(
      server,
      "GET",
      `/admin/quote-control/pairs/01/${quoteRequest.tokenIn}/${quoteRequest.tokenIn}`,
    );
    assert.equal(invalidScope.statusCode, 400);
    assert.equal(invalidScope.body.code, "INVALID_REQUEST");

    const issued = await inject(server, "POST", "/quote", quoteRequest);
    assert.equal(issued.statusCode, 200, JSON.stringify(issued.body));

    now += 1_000;
    const paused = await inject(server, "PUT", pairPath, {
      paused: true,
      reason: "pair venue incident",
      expectedVersion: 0,
    });
    assert.equal(paused.statusCode, 200);
    assert.equal(paused.body.paused, true);
    assert.equal(paused.body.version, 1);
    assert.equal(paused.body.tokenLow, quoteRequest.tokenIn);
    assert.equal((await inject(server, "GET", "/admin/quote-control")).body.paused, false);

    const blocked = await inject(server, "POST", "/quote", quoteRequest);
    assert.equal(blocked.statusCode, 503);
    assert.equal(blocked.body.code, "QUOTE_PAUSED");

    const blockedReverse = await inject(server, "POST", "/quote", {
      ...quoteRequest,
      tokenIn: quoteRequest.tokenOut,
      tokenOut: quoteRequest.tokenIn,
    });
    assert.equal(blockedReverse.statusCode, 503);
    assert.equal(blockedReverse.body.code, "QUOTE_PAUSED");

    const submit = await inject(server, "POST", "/submit", {
      quote: {
        user: quoteRequest.user,
        tokenIn: quoteRequest.tokenIn,
        tokenOut: quoteRequest.tokenOut,
        amountIn: quoteRequest.amountIn,
        amountOut: issued.body.amountOut,
        minAmountOut: issued.body.minAmountOut,
        nonce: issued.body.nonce,
        deadline: issued.body.deadline,
        chainId: quoteRequest.chainId,
      },
      signature: issued.body.signature,
    });
    assert.equal(submit.statusCode, 202, JSON.stringify(submit.body));

    const conflict = await inject(server, "PUT", pairPath, {
      paused: false,
      reason: "stale recovery",
      expectedVersion: 0,
    });
    assert.equal(conflict.statusCode, 409);
    assert.equal(conflict.body.code, "QUOTE_CONTROL_CONFLICT");

    now += 1_000;
    const resumed = await inject(server, "PUT", pairPath, {
      paused: false,
      reason: "pair venue recovered",
      expectedVersion: 1,
    });
    assert.equal(resumed.statusCode, 200);
    assert.equal(resumed.body.version, 2);
    assert.equal((await inject(server, "POST", "/quote", quoteRequest)).statusCode, 200);
  } finally {
    await server.close();
  }
});

test("quote creation and readiness fail closed when only pair control storage is unavailable", async () => {
  const store = new InMemoryQuoteControlStore();
  store.getPairState = async () => { throw new Error("pair table unavailable"); };
  store.getPausedPairCount = async () => { throw new Error("pair table unavailable"); };
  const server = buildServer({ logger: false, quoteControlStore: store });
  const pairPath = `/admin/quote-control/pairs/1/${quoteRequest.tokenIn}/${quoteRequest.tokenOut}`;

  try {
    await server.ready();
    assert.equal((await inject(server, "GET", "/admin/quote-control")).statusCode, 200);
    const readiness = await inject(server, "GET", "/ready");
    assert.equal(readiness.statusCode, 503);
    assert.equal(readiness.body.components.quoteControl, "degraded");
    const quote = await inject(server, "POST", "/quote", quoteRequest);
    assert.equal(quote.statusCode, 503);
    assert.equal(quote.body.code, "QUOTE_CONTROL_UNAVAILABLE");
    const pair = await inject(server, "GET", pairPath);
    assert.equal(pair.statusCode, 503);
    assert.equal(pair.body.code, "QUOTE_CONTROL_UNAVAILABLE");
  } finally {
    await server.close();
  }
});

test("quote control fails closed when shared state is unavailable", async () => {
  const unavailable = {
    async checkHealth() { throw new Error("database unavailable"); },
    async getState() { throw new Error("database unavailable"); },
    async updateState() { throw new Error("database unavailable"); },
    async getPairState() { throw new Error("database unavailable"); },
    async getPausedPairCount() { throw new Error("database unavailable"); },
    async updatePairState() { throw new Error("database unavailable"); },
  };
  const server = buildServer({ logger: false, quoteControlStore: unavailable });

  try {
    await server.ready();
    const readiness = await inject(server, "GET", "/ready");
    assert.equal(readiness.statusCode, 503);
    assert.equal(readiness.body.components.quoteControl, "degraded");

    const quote = await inject(server, "POST", "/quote", quoteRequest);
    assert.equal(quote.statusCode, 503);
    assert.equal(quote.body.code, "QUOTE_CONTROL_UNAVAILABLE");

    const control = await inject(server, "GET", "/admin/quote-control");
    assert.equal(control.statusCode, 503);
    assert.equal(control.body.code, "QUOTE_CONTROL_UNAVAILABLE");
  } finally {
    await server.close();
  }
});

test("quote control rejects malformed store state before quote or admin responses", async () => {
  const malformed = {
    checkHealth() {},
    async getState() { return { paused: false }; },
    async updateState() { return { paused: false }; },
    async getPairState() { return { paused: false }; },
    async getPausedPairCount() { return 0; },
    async updatePairState() { return { paused: false }; },
  };
  const server = buildServer({ logger: false, quoteControlStore: malformed });

  try {
    await server.ready();
    const quote = await inject(server, "POST", "/quote", quoteRequest);
    assert.equal(quote.statusCode, 503);
    assert.equal(quote.body.code, "QUOTE_CONTROL_UNAVAILABLE");

    const control = await inject(server, "GET", "/admin/quote-control");
    assert.equal(control.statusCode, 503);
    assert.equal(control.body.code, "QUOTE_CONTROL_UNAVAILABLE");
  } finally {
    await server.close();
  }
});

test("quote control admin routes enforce separate read and write scopes", async () => {
  const secrets = {
    read: "r".repeat(32),
    write: "w".repeat(32),
  };
  const authenticator = new Sha256ApiKeyAuthenticator({ keys: [
    key("ops_reader", secrets.read, ["admin:read"]),
    key("ops_writer", secrets.write, ["admin:write"]),
  ] });
  const server = buildServer({
    logger: false,
    apiKeyAuthenticator: authenticator,
    quoteControlStore: new InMemoryQuoteControlStore(() => Date.parse("2026-07-14T00:00:00.000Z")),
  });

  try {
    await server.ready();
    const unauthenticated = await inject(server, "GET", "/admin/quote-control");
    assert.equal(unauthenticated.statusCode, 401);
    assert.equal(unauthenticated.body.code, "AUTHENTICATION_REQUIRED");

    assert.equal((await inject(server, "GET", "/admin/quote-control", undefined, apiKey("ops_reader", secrets.read))).statusCode, 200);
    assert.equal((await inject(server, "GET", "/admin/quote-control", undefined, apiKey("ops_writer", secrets.write))).statusCode, 403);
    assert.equal((await inject(server, "PUT", "/admin/quote-control", {
      paused: true,
      reason: "risk incident",
      expectedVersion: 0,
    }, apiKey("ops_reader", secrets.read))).statusCode, 403);
    const pairPath = `/admin/quote-control/pairs/1/${quoteRequest.tokenIn}/${quoteRequest.tokenOut}`;
    assert.equal((await inject(server, "GET", pairPath, undefined, apiKey("ops_reader", secrets.read))).statusCode, 200);
    assert.equal((await inject(server, "GET", pairPath, undefined, apiKey("ops_writer", secrets.write))).statusCode, 403);
    assert.equal((await inject(server, "PUT", pairPath, {
      paused: true,
      reason: "risk incident",
      expectedVersion: 0,
    }, apiKey("ops_reader", secrets.read))).statusCode, 403);

    const invalid = await inject(server, "PUT", "/admin/quote-control", {
      paused: true,
      reason: "",
      expectedVersion: 0,
    }, apiKey("ops_writer", secrets.write));
    assert.equal(invalid.statusCode, 400);
    assert.equal(invalid.body.code, "INVALID_REQUEST");
    const unchanged = await inject(server, "GET", "/admin/quote-control", undefined, apiKey("ops_reader", secrets.read));
    assert.equal(unchanged.body.version, 0);
    assert.equal(unchanged.body.paused, false);

    const updated = await inject(server, "PUT", "/admin/quote-control", {
      paused: true,
      reason: "risk incident",
      expectedVersion: 0,
    }, apiKey("ops_writer", secrets.write));
    assert.equal(updated.statusCode, 200);
    assert.equal(updated.body.updatedBy, "institution_ops:ops_writer");
  } finally {
    await server.close();
  }
});

test("quote control admin routes share the distributed status rate-limit bucket", async () => {
  const server = buildServer({
    logger: false,
    quoteControlStore: new InMemoryQuoteControlStore(),
    rateLimit: {
      windowMs: 60_000,
      maxQuoteRequests: 120,
      maxSubmitRequests: 60,
      maxStatusRequests: 1,
    },
  });

  try {
    await server.ready();
    assert.equal((await inject(server, "GET", "/admin/quote-control")).statusCode, 200);
    const limited = await inject(server, "PUT", "/admin/quote-control", {
      paused: true,
      reason: "should not mutate",
      expectedVersion: 0,
    });
    assert.equal(limited.statusCode, 429);
    assert.equal(limited.body.code, "RATE_LIMITED");
  } finally {
    await server.close();
  }
});

function key(keyId, secret, scopes) {
  return {
    keyId,
    principalId: "institution_ops",
    secretSha256: createHash("sha256").update(secret).digest("hex"),
    scopes,
  };
}

function apiKey(keyId, secret) {
  return { "x-api-key": `${keyId}.${secret}` };
}

async function inject(server, method, url, payload, headers = {}) {
  const response = await server.inject({
    method,
    url,
    headers: payload === undefined ? headers : { "content-type": "application/json", ...headers },
    ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
  });
  return { statusCode: response.statusCode, body: JSON.parse(response.payload) };
}
