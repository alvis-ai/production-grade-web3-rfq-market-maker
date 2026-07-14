import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { buildServer } from "../dist/main.js";
import { Sha256ApiKeyAuthenticator } from "../dist/modules/auth/api-key-auth.service.js";
import { InMemoryToxicFlowScoreStore } from "../dist/modules/risk/toxic-flow-score.store.js";

const user = "0x0000000000000000000000000000000000000001";
const quoteRequest = {
  chainId: 1,
  user,
  tokenIn: "0x0000000000000000000000000000000000000002",
  tokenOut: "0x0000000000000000000000000000000000000003",
  amountIn: "1000000000",
  slippageBps: 50,
};

test("dynamic toxic flow score updates drive default pre-trade risk with CAS", async () => {
  const now = Date.now();
  const store = new InMemoryToxicFlowScoreStore(() => now);
  const server = buildServer({ logger: false, toxicFlowScoreStore: store });
  const path = `/admin/toxic-flow/scores/1/${user}`;

  try {
    await server.ready();
    const missing = await inject(server, "GET", path);
    assert.equal(missing.statusCode, 200);
    assert.deepEqual(missing.body, { key: { chainId: 1, user }, state: null });

    const updated = await inject(server, "PUT", path, scoreUpdate({
      observedAt: new Date(now).toISOString(),
    }));
    assert.equal(updated.statusCode, 200);
    assert.equal(updated.body.version, 1);
    assert.equal(updated.body.updatedBy, "local");

    const rejected = await inject(server, "POST", "/quote", quoteRequest);
    assert.equal(rejected.statusCode, 409);
    assert.equal(rejected.body.code, "RISK_REJECTED");

    const conflict = await inject(server, "PUT", path, scoreUpdate({
      observedAt: new Date(now).toISOString(),
      expectedVersion: 0,
    }));
    assert.equal(conflict.statusCode, 409);
    assert.equal(conflict.body.code, "TOXIC_FLOW_SCORE_CONFLICT");

    const metrics = await server.inject({ method: "GET", url: "/metrics" });
    assert.match(metrics.payload, /rfq_toxic_flow_score_updates_total 1/);
    assert.match(metrics.payload, /rfq_toxic_flow_score_errors_total\{operation="update"\} 1/);
  } finally {
    await server.close();
  }
});

test("known stale toxic flow scores fail quote risk closed", async () => {
  const store = new InMemoryToxicFlowScoreStore();
  await store.updateScore({ chainId: 1, user }, scoreUpdate({
    observedAt: "2020-01-01T00:00:00.000Z",
  }), "risk_analyzer:writer_key");
  const server = buildServer({ logger: false, toxicFlowScoreStore: store });
  try {
    await server.ready();
    const response = await inject(server, "POST", "/quote", quoteRequest);
    assert.equal(response.statusCode, 409);
    assert.equal(response.body.code, "RISK_REJECTED");
    const metrics = await server.inject({ method: "GET", url: "/metrics" });
    assert.match(metrics.payload, /rfq_quote_rejections_total\{reason="RISK_ENGINE_UNAVAILABLE"\} 1/);
  } finally {
    await server.close();
  }
});

test("toxic flow score routes require admin scopes and reject malformed keys", async () => {
  const readSecret = "r".repeat(32);
  const writeSecret = "w".repeat(32);
  const authenticator = new Sha256ApiKeyAuthenticator({ keys: [
    key("risk_reader", readSecret, ["admin:read"]),
    key("risk_writer", writeSecret, ["admin:write"]),
  ] });
  const server = buildServer({ logger: false, apiKeyAuthenticator: authenticator });
  const path = `/admin/toxic-flow/scores/1/${user}`;

  try {
    await server.ready();
    assert.equal((await inject(server, "GET", path)).statusCode, 401);
    assert.equal((await inject(server, "GET", path, undefined, apiKey("risk_reader", readSecret))).statusCode, 200);
    assert.equal((await inject(server, "GET", path, undefined, apiKey("risk_writer", writeSecret))).statusCode, 403);
    assert.equal((await inject(server, "PUT", path, scoreUpdate(), apiKey("risk_reader", readSecret))).statusCode, 403);
    assert.equal((await inject(server, "PUT", path, scoreUpdate(), apiKey("risk_writer", writeSecret))).statusCode, 200);
    const invalid = await inject(
      server,
      "GET",
      `/admin/toxic-flow/scores/01/${user}`,
      undefined,
      apiKey("risk_reader", readSecret),
    );
    assert.equal(invalid.statusCode, 400);
    assert.equal(invalid.body.code, "INVALID_REQUEST");
  } finally {
    await server.close();
  }
});

function scoreUpdate(overrides = {}) {
  return {
    scoreBps: 9000,
    postTradeDriftBps: -50,
    sampleSize: 5,
    windowSeconds: 300,
    policyVersion: "markout-v1",
    observedAt: new Date().toISOString(),
    expectedVersion: 0,
    ...overrides,
  };
}

function key(keyId, secret, scopes) {
  return {
    keyId,
    principalId: "risk_analyzer",
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
