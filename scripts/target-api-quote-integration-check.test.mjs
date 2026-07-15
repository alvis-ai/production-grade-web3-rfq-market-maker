import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { buildQuoteTypedData } from "../sdk/dist/index.js";
import { runTargetApiQuoteIntegrationCheck } from "./target-api-quote-integration-check.mjs";

const requireFromBackend = createRequire(new URL("../backend/package.json", import.meta.url));
const { privateKeyToAccount } = await import(pathToFileURL(requireFromBackend.resolve("viem/accounts")).href);

const privateKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const otherPrivateKey = `0x${"11".repeat(32)}`;
const settlementAddress = "0x0000000000000000000000000000000000000004";
const trustedSignerAddress = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
const apiKey = `client_primary.${"a".repeat(32)}`;
const fixedNow = 1_700_000_000_000;
const baseEnvironment = {
  RFQ_API_INTEGRATION_CONFIRM: "request-and-replay-quote",
  RFQ_API_INTEGRATION_BASE_URL: "https://api.example/rfq",
  RFQ_API_INTEGRATION_API_KEY: apiKey,
  RFQ_SETTLEMENT_ADDRESS: settlementAddress,
  RFQ_TRUSTED_SIGNER_ADDRESS: trustedSignerAddress,
  RFQ_API_INTEGRATION_CHAIN_ID: "1",
  RFQ_API_INTEGRATION_USER: "0x0000000000000000000000000000000000000001",
  RFQ_API_INTEGRATION_TOKEN_IN: "0x0000000000000000000000000000000000000002",
  RFQ_API_INTEGRATION_TOKEN_OUT: "0x0000000000000000000000000000000000000003",
  RFQ_API_INTEGRATION_AMOUNT_IN: "1000",
  RFQ_API_INTEGRATION_SLIPPAGE_BPS: "10",
  RFQ_API_INTEGRATION_MAX_TTL_SECONDS: "60",
  RFQ_API_INTEGRATION_MAX_CLOCK_SKEW_SECONDS: "5",
};

test("target API quote canary verifies readiness, exact idempotency replay, status, and signer", async () => {
  const fixture = createApiFixture();
  const result = await runTargetApiQuoteIntegrationCheck(baseEnvironment, fixture.dependencies);

  assert.deepEqual(result, {
    status: "ok",
    mode: "target-api",
    readiness: "ready",
    chainId: 1,
    quoteId: "q_api_canary_fixture",
    snapshotId: "snapshot_api_canary_fixture",
    quoteStatus: "signed",
    deadline: 1_700_000_030,
    settlementAddress,
    signerAddress: trustedSignerAddress,
    quoteDigest: result.quoteDigest,
    signatureHash: result.signatureHash,
    idempotencyVerified: true,
  });
  assert.match(result.quoteDigest, /^0x[0-9a-f]{64}$/);
  assert.match(result.signatureHash, /^0x[0-9a-f]{64}$/);
  assert.equal(fixture.calls.length, 4);
  assert.equal(fixture.calls[0].url, "https://api.example/rfq/ready");
  assert.equal(fixture.calls[0].headers.get("x-api-key"), null);
  assert.equal(fixture.calls[1].url, "https://api.example/rfq/quote");
  assert.equal(fixture.calls[2].url, "https://api.example/rfq/quote");
  assert.equal(fixture.calls[3].url, "https://api.example/rfq/quote/q_api_canary_fixture");
  assert.equal(fixture.calls[1].headers.get("x-api-key"), apiKey);
  assert.equal(fixture.calls[3].headers.get("x-api-key"), apiKey);
  assert.equal(fixture.calls.every((call) => call.redirect === "error"), true);
  assert.equal(fixture.calls[1].headers.get("idempotency-key"), fixture.calls[2].headers.get("idempotency-key"));
  assert.match(fixture.calls[1].headers.get("idempotency-key"), /^api_canary_[a-z0-9]+_[0-9a-f]{12}$/);
  assert.match(fixture.calls[1].headers.get("x-trace-id"), /^tr_api_canary_[a-z0-9]+_[0-9a-f]{12}$/);
  assert.doesNotMatch(JSON.stringify(result), /client_primary|a{32}|signature"|api\.example/i);
});

test("target API quote canary rejects unsafe configuration before contacting the API", async () => {
  let fetchCalls = 0;
  const dependencies = { fetch: async () => { fetchCalls += 1; throw new Error("unreachable"); } };
  await assert.rejects(
    runTargetApiQuoteIntegrationCheck({ ...baseEnvironment, RFQ_API_INTEGRATION_CONFIRM: "no" }, dependencies),
    /request-and-replay-quote is required/,
  );
  await assert.rejects(
    runTargetApiQuoteIntegrationCheck({ ...baseEnvironment, RFQ_API_INTEGRATION_BASE_URL: "http:\/\/api.example" }, dependencies),
    /absolute HTTPS URL/,
  );
  await assert.rejects(
    runTargetApiQuoteIntegrationCheck({ ...baseEnvironment, RFQ_API_INTEGRATION_API_KEY: "not-a-key" }, dependencies),
    /keyId\.secret format/,
  );
  await assert.rejects(
    runTargetApiQuoteIntegrationCheck({
      ...baseEnvironment,
      RFQ_API_INTEGRATION_TOKEN_OUT: baseEnvironment.RFQ_API_INTEGRATION_TOKEN_IN,
    }, dependencies),
    /distinct addresses/,
  );
  assert.equal(fetchCalls, 0);
});

test("target API quote canary rejects an exact quote signed by an unexpected key", async () => {
  const fixture = createApiFixture({ signingKey: otherPrivateKey });
  await assert.rejects(
    runTargetApiQuoteIntegrationCheck(baseEnvironment, fixture.dependencies),
    /Target API quote integration check failed/,
  );
});

test("target API quote canary rejects mutated idempotency replay and status evidence", async () => {
  const replayFixture = createApiFixture({ mutateReplay: (quote) => ({ ...quote, nonce: "43" }) });
  await assert.rejects(
    runTargetApiQuoteIntegrationCheck(baseEnvironment, replayFixture.dependencies),
    /Target API quote integration check failed/,
  );

  const statusFixture = createApiFixture({ status: "expired" });
  await assert.rejects(
    runTargetApiQuoteIntegrationCheck(baseEnvironment, statusFixture.dependencies),
    /Target API quote integration check failed/,
  );

  const readinessFixture = createApiFixture({ degradedReadiness: true });
  await assert.rejects(
    runTargetApiQuoteIntegrationCheck(baseEnvironment, readinessFixture.dependencies),
    /Target API quote integration check failed/,
  );
  assert.equal(readinessFixture.calls.length, 1);
});

test("target API quote canary redacts transport and API failure details", async () => {
  const leakedDetails = `${baseEnvironment.RFQ_API_INTEGRATION_BASE_URL} ${apiKey} upstream-secret`;
  await assert.rejects(
    runTargetApiQuoteIntegrationCheck(baseEnvironment, {
      now: () => fixedNow,
      randomBytes: (size) => new Uint8Array(size).fill(1),
      fetch: async () => { throw new Error(leakedDetails); },
    }),
    (error) => {
      assert.equal(error.message, "Target API quote integration check failed");
      assert.doesNotMatch(error.stack ?? "", /api\.example|client_primary|upstream-secret|a{32}/i);
      return true;
    },
  );
});

function createApiFixture(options = {}) {
  const account = privateKeyToAccount(options.signingKey ?? privateKey);
  const calls = [];
  let quoteResponse;
  let quotePosts = 0;
  const dependencies = {
    now: () => fixedNow,
    randomBytes: (size) => Uint8Array.from({ length: size }, (_, index) => index + 1),
    async fetch(input, init = {}) {
      const call = {
        url: String(input),
        method: init.method ?? "GET",
        headers: new Headers(init.headers),
        body: init.body,
        redirect: init.redirect,
      };
      calls.push(call);
      const url = new URL(call.url);

      if (url.pathname === "/rfq/ready" && call.method === "GET") {
        return jsonResponse(readyResponse(options.degradedReadiness));
      }
      if (url.pathname === "/rfq/quote" && call.method === "POST") {
        assert.equal(call.headers.get("x-api-key"), apiKey);
        assert.match(call.headers.get("idempotency-key"), /^api_canary_/);
        const request = JSON.parse(String(call.body));
        assert.deepEqual(request, {
          chainId: 1,
          user: baseEnvironment.RFQ_API_INTEGRATION_USER,
          tokenIn: baseEnvironment.RFQ_API_INTEGRATION_TOKEN_IN,
          tokenOut: baseEnvironment.RFQ_API_INTEGRATION_TOKEN_OUT,
          amountIn: "1000",
          slippageBps: 10,
        });
        if (quoteResponse === undefined) {
          const quote = {
            user: request.user,
            tokenIn: request.tokenIn,
            tokenOut: request.tokenOut,
            amountIn: request.amountIn,
            amountOut: "998",
            minAmountOut: "990",
            nonce: "42",
            deadline: 1_700_000_030,
            chainId: request.chainId,
          };
          quoteResponse = {
            quoteId: "q_api_canary_fixture",
            snapshotId: "snapshot_api_canary_fixture",
            amountOut: quote.amountOut,
            minAmountOut: quote.minAmountOut,
            deadline: quote.deadline,
            nonce: quote.nonce,
            signature: await account.signTypedData(buildQuoteTypedData(quote, settlementAddress)),
          };
        }
        quotePosts += 1;
        return jsonResponse(quotePosts === 2 && options.mutateReplay
          ? options.mutateReplay(quoteResponse)
          : quoteResponse);
      }
      if (url.pathname === "/rfq/quote/q_api_canary_fixture" && call.method === "GET") {
        return jsonResponse({
          quoteId: "q_api_canary_fixture",
          status: options.status ?? "signed",
          snapshotId: "snapshot_api_canary_fixture",
          deadline: 1_700_000_030,
        });
      }
      return jsonResponse({ code: "QUOTE_NOT_FOUND", message: "Not found", traceId: "tr_fixture" }, 404);
    },
  };
  return { calls, dependencies };
}

function readyResponse(degraded = false) {
  const components = {};
  for (const component of [
    "marketData", "marketSnapshotStore", "routing", "pricing", "risk", "signer", "quoteRepository",
    "quoteControl", "riskDecisionStore", "rateLimitStore", "inventory", "execution", "settlementEventStore",
    "pnl", "metrics",
  ]) {
    components[component] = degraded && component === "marketData" ? "degraded" : "ok";
  }
  return { status: degraded ? "degraded" : "ready", components };
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}
