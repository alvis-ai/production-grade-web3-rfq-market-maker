import assert from "node:assert/strict";
import test from "node:test";
import { LocalEIP712SignerService } from "../dist/modules/signer/signer.service.js";
import { buildSignerServer } from "../dist/modules/signer/signer-server.js";
import { InMemorySignerAuditStore } from "../dist/modules/signer/signer-audit.store.js";
import { ConfiguredTokenRegistry } from "../dist/modules/pricing/token-registry.js";
import { defaultTokenLimitRiskPolicy } from "../dist/modules/risk/token-limit-risk.engine.js";

const privateKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const settlementAddress = "0x0000000000000000000000000000000000000004";
const authToken = "s".repeat(43);
const nowMs = 1_700_000_000_000;

test("signer server authenticates and signs only an approved envelope", async () => {
  const auditStore = new InMemorySignerAuditStore();
  const server = createServer(undefined, auditStore, {
    renderPrometheus: () => "rfq_signer_audit_stream_backlog 3\n",
  });
  const response = await server.inject({
    method: "POST",
    url: "/internal/sign",
    headers: { authorization: `Bearer ${authToken}` },
    payload: signInput(),
  });
  assert.equal(response.statusCode, 200);
  assert.match(response.json().signature, /^0x[0-9a-f]{130}$/i);
  assert.equal(auditStore.snapshot().length, 1);
  assert.equal(auditStore.snapshot()[0].outcome, "success");
  assert.equal(auditStore.snapshot()[0].riskDecisionId, "rd_q_signer_server");
  assert.equal(auditStore.snapshot()[0].riskPolicyVersion, "risk-v1");
  assert.equal(auditStore.snapshot()[0].traceId, "tr_signer_server");
  assert.match(auditStore.snapshot()[0].quoteDigest, /^0x[0-9a-f]{64}$/i);
  assert.match(auditStore.snapshot()[0].signatureHash, /^0x[0-9a-f]{64}$/i);

  const metrics = await server.inject({ method: "GET", url: "/metrics" });
  assert.match(metrics.body, /rfq_signer_service_requests_total\{outcome="success"\} 1/);
  assert.match(metrics.body, /rfq_signer_service_last_success_timestamp_seconds 1700000000/);
  assert.match(metrics.body, /rfq_signer_audit_stream_backlog 3/);

  const readiness = await server.inject({ method: "GET", url: "/ready" });
  assert.equal(readiness.statusCode, 200);
  assert.deepEqual(readiness.json(), { status: "ok" });
  await server.close();
});

test("signer server rejects missing or incorrect credentials before invoking the signer", async () => {
  let signerCalls = 0;
  const server = createServer({
    async signQuote() { signerCalls += 1; throw new Error("unreachable"); },
    async verifyQuoteSignature() { return false; },
  });
  for (const authorization of [undefined, "Bearer wrong", `Basic ${authToken}`]) {
    const response = await server.inject({
      method: "POST",
      url: "/internal/sign",
      ...(authorization ? { headers: { authorization } } : {}),
      payload: signInput(),
    });
    assert.equal(response.statusCode, 401);
    assert.deepEqual(response.json(), { error: "unauthorized" });
  }
  assert.equal(signerCalls, 0);
  await server.close();
});

test("signer server coalesces concurrent readiness signatures and caches success", async () => {
  const local = new LocalEIP712SignerService({ privateKey, settlementAddress });
  let signerCalls = 0;
  const server = createServer({
    async signQuote(input) {
      signerCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return local.signQuote(input);
    },
    verifyQuoteSignature: (quote, signature) => local.verifyQuoteSignature(quote, signature),
  });
  const responses = await Promise.all([
    server.inject({ method: "GET", url: "/ready" }),
    server.inject({ method: "GET", url: "/ready" }),
    server.inject({ method: "GET", url: "/ready" }),
  ]);
  assert.deepEqual(responses.map((response) => response.statusCode), [200, 200, 200]);
  assert.equal(signerCalls, 1);
  assert.equal((await server.inject({ method: "GET", url: "/ready" })).statusCode, 200);
  assert.equal(signerCalls, 1);
  await server.close();
});

test("signer server enforces TTL, chain, token, and raw amount limits independently", async () => {
  const server = createServer();
  const base = signInput();
  const invalidQuotes = [
    { ...base.quote, deadline: Math.floor(nowMs / 1000) - 6 },
    { ...base.quote, deadline: Math.floor(nowMs / 1000) + 36 },
    { ...base.quote, chainId: 2 },
    { ...base.quote, tokenOut: "0x0000000000000000000000000000000000000004" },
    { ...base.quote, amountIn: "1000000000000000000001" },
    { ...base.quote, amountOut: "1000000000000000000001", minAmountOut: "1" },
  ];
  for (const quote of invalidQuotes) {
    const response = await server.inject({
      method: "POST",
      url: "/internal/sign",
      headers: { authorization: `Bearer ${authToken}` },
      payload: { ...base, quote },
    });
    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json(), { error: "invalid_signing_request" });
  }
  await server.close();
});

test("signer server returns a closed unavailable response for signing failures", async () => {
  const auditStore = new InMemorySignerAuditStore();
  const server = createServer({
    async signQuote() { throw new Error("sensitive KMS detail"); },
    async verifyQuoteSignature() { return false; },
  }, auditStore);
  const response = await server.inject({
    method: "POST",
    url: "/internal/sign",
    headers: { authorization: `Bearer ${authToken}` },
    payload: signInput(),
  });
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), { error: "signer_unavailable" });
  assert.equal(auditStore.snapshot()[0].outcome, "signer_error");
  assert.equal(Object.hasOwn(auditStore.snapshot()[0], "signatureHash"), false);
  assert.doesNotMatch(response.body, /sensitive/);
  const readiness = await server.inject({ method: "GET", url: "/ready" });
  assert.equal(readiness.statusCode, 503);
  assert.deepEqual(readiness.json(), { status: "degraded" });
  await server.close();
});

test("signer server skips only explicitly self-verified signer recovery", async () => {
  const local = new LocalEIP712SignerService({ privateKey, settlementAddress });
  let ordinaryVerifications = 0;
  const ordinary = createServer({
    async signQuote(input) { return local.signQuote(input); },
    async verifyQuoteSignature() { ordinaryVerifications += 1; return false; },
  });
  const rejected = await ordinary.inject({
    method: "POST",
    url: "/internal/sign",
    headers: { authorization: `Bearer ${authToken}` },
    payload: signInput(),
  });
  assert.equal(rejected.statusCode, 503);
  assert.equal(ordinaryVerifications, 1);
  await ordinary.close();

  let fastVerifications = 0;
  const selfVerified = createServer({
    signaturesSelfVerified: true,
    async signQuote(input) { return local.signQuote(input); },
    async verifyQuoteSignature() { fastVerifications += 1; return false; },
  });
  const accepted = await selfVerified.inject({
    method: "POST",
    url: "/internal/sign",
    headers: { authorization: `Bearer ${authToken}` },
    payload: signInput(),
  });
  assert.equal(accepted.statusCode, 200);
  assert.equal(fastVerifications, 0);
  await selfVerified.close();

  assert.throws(() => createServer({
    signaturesSelfVerified: false,
    async signQuote(input) { return local.signQuote(input); },
    async verifyQuoteSignature() { return true; },
  }), /signaturesSelfVerified capability is invalid/);
});

test("signer server does not return a signature when durable audit fails", async () => {
  const server = createServer(undefined, {
    async append() { throw new Error("sensitive database detail"); },
    async checkHealth() {},
  });
  const response = await server.inject({
    method: "POST",
    url: "/internal/sign",
    headers: { authorization: `Bearer ${authToken}` },
    payload: signInput(),
  });
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), { error: "signer_unavailable" });
  assert.doesNotMatch(response.body, /signature|database detail/);
  const metrics = await server.inject({ method: "GET", url: "/metrics" });
  assert.match(metrics.body, /rfq_signer_service_audit_errors_total 1/);
  await server.close();
});

test("signer server readiness degrades when the audit store is unavailable", async () => {
  let signerCalls = 0;
  const local = new LocalEIP712SignerService({ privateKey, settlementAddress });
  const server = createServer({
    async signQuote(input) { signerCalls += 1; return local.signQuote(input); },
    verifyQuoteSignature: (quote, signature) => local.verifyQuoteSignature(quote, signature),
  }, {
    async append() {},
    async checkHealth() { throw new Error("audit unavailable"); },
  });
  const response = await server.inject({ method: "GET", url: "/ready" });
  assert.equal(response.statusCode, 503);
  assert.equal(signerCalls, 0);
  const metrics = await server.inject({ method: "GET", url: "/metrics" });
  assert.match(metrics.body, /rfq_signer_service_audit_errors_total 1/);
  await server.close();
});

function createServer(
  signerService = new LocalEIP712SignerService({ privateKey, settlementAddress }),
  auditStore = new InMemorySignerAuditStore(),
  auditMetrics = undefined,
) {
  return buildSignerServer({
    signerService,
    auditStore,
    auditMetrics,
    tokenRegistry: new ConfiguredTokenRegistry(),
    riskPolicy: defaultTokenLimitRiskPolicy,
    config: {
      authToken,
      settlementAddress,
      trustedSignerAddress: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
      maxQuoteTtlSeconds: 30,
      maxClockSkewSeconds: 5,
      bodyLimitBytes: 32768,
    },
    now: () => nowMs,
  });
}

function signInput() {
  return {
    quote: {
      user: "0x0000000000000000000000000000000000000001",
      tokenIn: "0x0000000000000000000000000000000000000002",
      tokenOut: "0x0000000000000000000000000000000000000003",
      amountIn: "1000",
      amountOut: "998",
      minAmountOut: "990",
      nonce: "42",
      deadline: Math.floor(nowMs / 1000) + 30,
      chainId: 1,
    },
    quoteId: "q_signer_server",
    snapshotId: "snapshot_signer_server",
    riskDecisionId: "rd_q_signer_server",
    riskPolicyVersion: "risk-v1",
    traceId: "tr_signer_server",
  };
}
