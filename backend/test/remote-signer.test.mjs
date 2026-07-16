import assert from "node:assert/strict";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import { LocalEIP712SignerService } from "../dist/modules/signer/signer.service.js";
import { RemoteSignerService } from "../dist/modules/signer/remote-signer.service.js";

const privateKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const settlementAddress = "0x0000000000000000000000000000000000000004";
const trustedSignerAddress = privateKeyToAccount(privateKey).address;
const authToken = "a".repeat(43);
const config = {
  baseUrl: "https://rfq-signer.example.internal",
  allowInsecureHttp: false,
  authToken,
  requestTimeoutMs: 1000,
  settlementAddress,
  trustedSignerAddress,
};
const input = {
  quote: {
    user: "0x0000000000000000000000000000000000000001",
    tokenIn: "0x0000000000000000000000000000000000000002",
    tokenOut: "0x0000000000000000000000000000000000000003",
    amountIn: "1000",
    amountOut: "998",
    minAmountOut: "990",
    nonce: "42",
    deadline: 4_102_444_800,
    chainId: 1,
  },
  quoteId: "q_remote",
  snapshotId: "snapshot_remote",
  riskDecisionId: "rd_q_remote",
  riskPolicyVersion: "risk-v1",
  traceId: "tr_remote",
};

test("RemoteSignerService authenticates an exact sign request and verifies the returned signer", async () => {
  const local = new LocalEIP712SignerService({ privateKey, settlementAddress });
  const calls = [];
  const remote = new RemoteSignerService(config, async (url, init) => {
    calls.push({ url: new URL(url), init });
    const request = JSON.parse(init.body);
    const signature = await local.signQuote(request);
    return jsonResponse({ signature });
  });

  const signature = await remote.signQuote(input);
  assert.equal(await remote.verifyQuoteSignature(input.quote, signature), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.href, "https://rfq-signer.example.internal/internal/sign");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.authorization, `Bearer ${authToken}`);
  assert.deepEqual(JSON.parse(calls[0].init.body), input);
});

test("RemoteSignerService fails closed on transport, status, response, and signer mismatches", async () => {
  const failures = [
    async () => { throw new Error("network"); },
    async () => jsonResponse({ error: "forbidden" }, 403),
    async () => jsonResponse({ signature: "0x00" }),
    async () => jsonResponse({ signature: "0x" + "00".repeat(65) }),
    async () => new Response("x".repeat(1025), { status: 200 }),
  ];
  for (const fetchFn of failures) {
    const remote = new RemoteSignerService(config, fetchFn);
    await assert.rejects(
      remote.signQuote(input),
      (error) => error?.code === "SIGNER_UNAVAILABLE" && error?.statusCode === 503,
    );
  }
});

test("RemoteSignerService cancels oversized response streams before complete buffering", async () => {
  let bodyCanceled = false;
  const remote = new RemoteSignerService(config, async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(1_025));
    },
    cancel() {
      bodyCanceled = true;
    },
  })));

  await assert.rejects(
    remote.signQuote(input),
    (error) => error?.code === "SIGNER_UNAVAILABLE" && error?.statusCode === 503,
  );
  assert.equal(bodyCanceled, true);
});

test("RemoteSignerService keeps stalled response bodies inside the request timeout", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let requestSignal;
  const remote = new RemoteSignerService(
    { ...config, requestTimeoutMs: 100 },
    async (_url, init) => {
      requestSignal = init.signal;
      return stallingJsonResponse(init.signal);
    },
  );

  const pending = remote.signQuote(input);
  const rejected = assert.rejects(
    pending,
    (error) => error?.code === "SIGNER_UNAVAILABLE" && error?.statusCode === 503,
  );
  await settle();
  context.mock.timers.tick(100);
  await rejected;
  assert.equal(requestSignal.aborted, true);
});

test("RemoteSignerService cancels unused sign and readiness error bodies", async () => {
  const canceledPaths = [];
  const remote = new RemoteSignerService(config, async (url) => {
    const path = new URL(url).pathname;
    return cancelableResponse(503, () => canceledPaths.push(path));
  });

  await assert.rejects(remote.signQuote(input), (error) => error?.code === "SIGNER_UNAVAILABLE");
  await assert.rejects(remote.checkHealth(), (error) => error?.code === "SIGNER_UNAVAILABLE");
  assert.deepEqual(canceledPaths, ["/internal/sign", "/ready"]);
});

test("RemoteSignerService requires a complete risk authorization context", async () => {
  const remote = new RemoteSignerService(config, async () => jsonResponse({ signature: "unreachable" }));
  const { riskDecisionId: _riskDecisionId, ...missingDecision } = input;
  await assert.rejects(remote.signQuote(missingDecision), /authorization context/);
  await assert.rejects(remote.signQuote({ ...input, riskDecisionId: "rd_other" }), /must match quoteId/);
});

test("RemoteSignerService rejects unsafe transport and credential configuration", () => {
  assert.throws(() => new RemoteSignerService({ ...config, baseUrl: "http://signer.example.com" }), /HTTPS origin/);
  assert.doesNotThrow(() => new RemoteSignerService({
    ...config,
    baseUrl: "http://signer-service:3006",
    allowInsecureHttp: true,
  }));
  assert.throws(() => new RemoteSignerService({ ...config, baseUrl: "https://user@signer.example.com" }), /HTTPS origin/);
  assert.throws(() => new RemoteSignerService({ ...config, authToken: "short" }), /authToken/);
  assert.throws(() => new RemoteSignerService({ ...config, requestTimeoutMs: 99 }), /requestTimeoutMs/);
  assert.throws(() => new RemoteSignerService({ ...config, unexpected: true }), /fields are invalid/);
});

test("RemoteSignerService probes the isolated signer readiness without requesting a signature", async () => {
  const calls = [];
  const remote = new RemoteSignerService(config, async (url, init) => {
    calls.push({ url: new URL(url), init });
    return jsonResponse({ status: "ok" });
  });
  await remote.checkHealth();
  assert.equal(calls[0].url.pathname, "/ready");
  assert.equal(calls[0].init.method, "GET");

  const degraded = new RemoteSignerService(config, async () => jsonResponse({ status: "degraded" }, 503));
  await assert.rejects(degraded.checkHealth(), (error) => error?.code === "SIGNER_UNAVAILABLE");
});

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function cancelableResponse(status, onCancel) {
  return new Response(new ReadableStream({
    cancel() { onCancel(); },
  }), { status });
}

function stallingJsonResponse(signal) {
  return new Response(new ReadableStream({
    start(controller) {
      const abort = () => controller.error(new DOMException("aborted", "AbortError"));
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort, { once: true });
    },
  }));
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}
