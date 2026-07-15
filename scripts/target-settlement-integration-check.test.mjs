import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import {
  buildQuoteTypedData,
  hashSettlementQuote,
  rfqSettlementAbi,
} from "../sdk/dist/index.js";
import { runTargetSettlementIntegrationCheck } from "./target-settlement-integration-check.mjs";

const requireFromBackend = createRequire(new URL("../backend/package.json", import.meta.url));
const viem = await import(pathToFileURL(requireFromBackend.resolve("viem")).href);
const accounts = await import(pathToFileURL(requireFromBackend.resolve("viem/accounts")).href);
const { encodeAbiParameters, encodeEventTopics, encodeFunctionData } = viem;
const { privateKeyToAccount } = accounts;

const userPrivateKey = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const signerPrivateKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const otherSignerPrivateKey = `0x${"11".repeat(32)}`;
const user = privateKeyToAccount(userPrivateKey).address.toLowerCase();
const trustedSigner = privateKeyToAccount(signerPrivateKey).address.toLowerCase();
const settlementAddress = "0x1000000000000000000000000000000000000001";
const treasuryAddress = "0x2000000000000000000000000000000000000002";
const tokenIn = "0x3000000000000000000000000000000000000003";
const tokenOut = "0x4000000000000000000000000000000000000004";
const txHash = `0x${"99".repeat(32)}`;
const apiKey = `settlement_canary.${"a".repeat(32)}`;
const fixedNow = 1_700_000_000_000;
const chainId = 11_155_111;
const quote = {
  user,
  tokenIn,
  tokenOut,
  amountIn: "1000",
  amountOut: "998",
  minAmountOut: "990",
  nonce: "42",
  deadline: 1_700_000_060,
  chainId,
};
const quoteHash = hashSettlementQuote(quote).toLowerCase();
const baseEnvironment = {
  RFQ_SETTLEMENT_CANARY_CONFIRM: "broadcast-one-settlement",
  RFQ_SETTLEMENT_CANARY_ENVIRONMENT: "staging-testnet",
  RFQ_SETTLEMENT_CANARY_API_BASE_URL: "https://api.example/rfq",
  RFQ_SETTLEMENT_CANARY_API_KEY: apiKey,
  RFQ_SETTLEMENT_CANARY_RPC_URL: "https://rpc.example/v1/credential",
  RFQ_SETTLEMENT_CANARY_CHAIN_ID: String(chainId),
  RFQ_SETTLEMENT_CANARY_SETTLEMENT_ADDRESS: settlementAddress,
  RFQ_SETTLEMENT_CANARY_TRUSTED_SIGNER_ADDRESS: trustedSigner,
  RFQ_SETTLEMENT_CANARY_EXPECTED_USER_ADDRESS: user,
  RFQ_SETTLEMENT_CANARY_USER_KEY_FILE: "/secure/rfq-canary-user-key",
  RFQ_SETTLEMENT_CANARY_TOKEN_IN: tokenIn,
  RFQ_SETTLEMENT_CANARY_TOKEN_OUT: tokenOut,
  RFQ_SETTLEMENT_CANARY_AMOUNT_IN: "1000",
  RFQ_SETTLEMENT_CANARY_MAX_AMOUNT_IN: "1000",
  RFQ_SETTLEMENT_CANARY_MAX_AMOUNT_OUT: "1000",
  RFQ_SETTLEMENT_CANARY_SLIPPAGE_BPS: "10",
  RFQ_SETTLEMENT_CANARY_MIN_TTL_SECONDS: "15",
  RFQ_SETTLEMENT_CANARY_MAX_TTL_SECONDS: "120",
  RFQ_SETTLEMENT_CANARY_CONFIRMATIONS: "2",
  RFQ_SETTLEMENT_CANARY_RECEIPT_TIMEOUT_MS: "180000",
};

test("target settlement canary proves one exact chain and backend settlement lifecycle", async () => {
  const fixture = await createFixture();
  const result = await runTargetSettlementIntegrationCheck(baseEnvironment, fixture.dependencies);

  assert.deepEqual(result, {
    status: "ok",
    mode: "staging-testnet-settlement",
    chainId,
    quoteId: "q_settlement_canary_fixture",
    snapshotId: "snapshot_settlement_canary_fixture",
    txHash,
    blockNumber: 256,
    logIndex: 3,
    settlementAddress,
    treasuryAddress,
    signerAddress: trustedSigner,
    quoteHash,
    quoteDigest: result.quoteDigest,
    signatureHash: result.signatureHash,
    settlementEventId: "se_settlement_canary_fixture",
    hedgeOrderId: "hedge_settlement_canary_fixture",
    hedgeStatus: "queued",
    pnlId: "pnl_settlement_canary_fixture",
    confirmations: 2,
    idempotencyVerified: true,
  });
  assert.match(result.quoteDigest, /^0x[0-9a-f]{64}$/);
  assert.match(result.signatureHash, /^0x[0-9a-f]{64}$/);
  assert.equal(fixture.walletCalls, 1);
  assert.equal(fixture.simulationCalls, 1);
  assert.equal(fixture.receiptInput.confirmations, 2);
  assert.equal(fixture.receiptInput.timeout, 180_000);
  assert.equal(fixture.apiCalls.length, 7);
  assert.equal(fixture.apiCalls.every((call) => call.redirect === "error"), true);
  assert.equal(fixture.apiCalls[0].headers.get("x-api-key"), null);
  assert.equal(fixture.apiCalls[1].headers.get("x-api-key"), apiKey);
  assert.equal(fixture.apiCalls[3].url, "https://api.example/rfq/submit");
  assert.doesNotMatch(
    JSON.stringify(result),
    /59c699|settlement_canary\.a|rpc\.example|signature"|credential/i,
  );
});

test("target settlement canary rejects unsafe environment before loading a key or contacting dependencies", async () => {
  let keyLoads = 0;
  const dependencies = { loadUserPrivateKey: async () => { keyLoads += 1; return userPrivateKey; } };
  await assert.rejects(
    runTargetSettlementIntegrationCheck({ ...baseEnvironment, RFQ_SETTLEMENT_CANARY_CONFIRM: "no" }, dependencies),
    /broadcast-one-settlement is required/,
  );
  await assert.rejects(
    runTargetSettlementIntegrationCheck({ ...baseEnvironment, RFQ_SETTLEMENT_CANARY_ENVIRONMENT: "production" }, dependencies),
    /staging-testnet is required/,
  );
  await assert.rejects(
    runTargetSettlementIntegrationCheck({ ...baseEnvironment, RFQ_SETTLEMENT_CANARY_CHAIN_ID: "1" }, dependencies),
    /refuses known production chain IDs/,
  );
  await assert.rejects(
    runTargetSettlementIntegrationCheck({ ...baseEnvironment, RFQ_SETTLEMENT_CANARY_AMOUNT_IN: "1001" }, dependencies),
    /amountIn exceeds its reviewed cap/,
  );
  assert.equal(keyLoads, 0);
});

test("target settlement canary rejects a user key file readable by group or other users", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rfq-settlement-key-"));
  const keyFile = join(directory, "user-key");
  try {
    await writeFile(keyFile, `${userPrivateKey}\n`, { mode: 0o600 });
    await chmod(keyFile, 0o644);
    await assert.rejects(
      runTargetSettlementIntegrationCheck({
        ...baseEnvironment,
        RFQ_SETTLEMENT_CANARY_USER_KEY_FILE: keyFile,
      }),
      /user key could not be loaded safely/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("target settlement canary fails before quote and broadcast for unsafe balances or allowance", async () => {
  const insufficient = await createFixture({ userTokenIn: 999n });
  await assert.rejects(
    runTargetSettlementIntegrationCheck(baseEnvironment, insufficient.dependencies),
    /failed before broadcast/,
  );
  assert.equal(insufficient.walletCalls, 0);
  assert.equal(insufficient.apiCalls.length, 0);

  const excessiveAllowance = await createFixture({ allowance: 1001n });
  await assert.rejects(
    runTargetSettlementIntegrationCheck(baseEnvironment, excessiveAllowance.dependencies),
    /failed before broadcast/,
  );
  assert.equal(excessiveAllowance.walletCalls, 0);
  assert.equal(excessiveAllowance.apiCalls.length, 0);

  const excessiveOutput = await createFixture();
  await assert.rejects(
    runTargetSettlementIntegrationCheck({
      ...baseEnvironment,
      RFQ_SETTLEMENT_CANARY_MAX_AMOUNT_OUT: "997",
    }, excessiveOutput.dependencies),
    /failed before broadcast/,
  );
  assert.equal(excessiveOutput.walletCalls, 0);
  assert.equal(excessiveOutput.simulationCalls, 0);
  assert.equal(excessiveOutput.apiCalls.length, 3);

  const insufficientTreasury = await createFixture({ treasuryTokenOut: 997n });
  await assert.rejects(
    runTargetSettlementIntegrationCheck(baseEnvironment, insufficientTreasury.dependencies),
    /failed before broadcast/,
  );
  assert.equal(insufficientTreasury.walletCalls, 0);
  assert.equal(insufficientTreasury.simulationCalls, 0);
  assert.equal(insufficientTreasury.apiCalls.length, 3);
});

test("target settlement canary rejects wrong signer and simulation failure without broadcasting", async () => {
  const wrongSigner = await createFixture({ signingKey: otherSignerPrivateKey });
  await assert.rejects(
    runTargetSettlementIntegrationCheck(baseEnvironment, wrongSigner.dependencies),
    /failed before broadcast/,
  );
  assert.equal(wrongSigner.walletCalls, 0);

  const simulationFailure = await createFixture({ simulationFailure: "rpc credential should not leak" });
  await assert.rejects(
    runTargetSettlementIntegrationCheck(baseEnvironment, simulationFailure.dependencies),
    (error) => {
      assert.equal(error.message, "Target settlement integration check failed before broadcast");
      assert.doesNotMatch(error.stack ?? "", /credential should not leak/);
      return true;
    },
  );
  assert.equal(simulationFailure.walletCalls, 0);
});

test("target settlement canary treats an ambiguous broadcast as non-retryable", async () => {
  const fixture = await createFixture({ ambiguousBroadcast: true });
  await assert.rejects(
    runTargetSettlementIntegrationCheck(baseEnvironment, fixture.dependencies),
    (error) => {
      assert.equal(error.message, "Target settlement broadcast outcome is unknown; do not retry automatically");
      assert.doesNotMatch(error.stack ?? "", /wallet-provider-secret/);
      return true;
    },
  );
  assert.equal(fixture.walletCalls, 1);
});

test("target settlement canary preserves the transaction hash after post-broadcast API failure", async () => {
  const fixture = await createFixture({ submitFailure: true });
  await assert.rejects(
    runTargetSettlementIntegrationCheck(baseEnvironment, fixture.dependencies),
    (error) => {
      assert.equal(
        error.message,
        `Target settlement integration check failed after broadcast ${txHash}; do not retry automatically`,
      );
      assert.doesNotMatch(error.stack ?? "", /settlement_canary\.a|upstream-secret|api\.example/);
      return true;
    },
  );
  assert.equal(fixture.walletCalls, 1);
});

async function createFixture(options = {}) {
  const signer = privateKeyToAccount(options.signingKey ?? signerPrivateKey);
  const signature = await signer.signTypedData(buildQuoteTypedData(quote, settlementAddress));
  let settled = false;
  let walletCalls = 0;
  let simulationCalls = 0;
  let transactionInput;
  let receiptInput;
  let quotePosts = 0;
  const apiCalls = [];
  const initial = {
    userTokenIn: options.userTokenIn ?? 5_000n,
    userTokenOut: 0n,
    treasuryTokenIn: 0n,
    treasuryTokenOut: options.treasuryTokenOut ?? 10_000n,
    allowance: options.allowance ?? 1_000n,
  };

  const publicClient = {
    async getChainId() { return chainId; },
    async getBytecode() { return "0x60006000"; },
    async getBalance() { return 1n; },
    async readContract(request) {
      if (request.address.toLowerCase() === settlementAddress) {
        if (request.functionName === "treasury") return treasuryAddress;
        if (request.functionName === "paused") return false;
        if (request.functionName === "tokenWhitelist") return true;
        if (request.functionName === "trustedSigners") return true;
        if (request.functionName === "usedNonces") return settled;
      }
      if (request.functionName === "allowance") return settled ? 0n : initial.allowance;
      if (request.functionName === "balanceOf") {
        const token = request.address.toLowerCase();
        const account = request.args[0].toLowerCase();
        if (token === tokenIn && account === user) return initial.userTokenIn - (settled ? 1_000n : 0n);
        if (token === tokenOut && account === user) return initial.userTokenOut + (settled ? 998n : 0n);
        if (token === tokenIn && account === treasuryAddress) return initial.treasuryTokenIn + (settled ? 1_000n : 0n);
        if (token === tokenOut && account === treasuryAddress) return initial.treasuryTokenOut - (settled ? 998n : 0n);
      }
      throw new Error(`unexpected read ${request.functionName}`);
    },
    async simulateContract(request) {
      simulationCalls += 1;
      assert.equal(request.functionName, "submitQuote");
      if (options.simulationFailure) throw new Error(options.simulationFailure);
      return { request, result: 998n };
    },
    async waitForTransactionReceipt(input) {
      receiptInput = input;
      assert.equal(settled, true);
      return settlementReceipt();
    },
    async getTransaction() {
      return { hash: txHash, from: user, to: settlementAddress, input: transactionInput };
    },
  };
  const walletClient = {
    async writeContract(request) {
      walletCalls += 1;
      transactionInput = encodeFunctionData(request);
      if (options.ambiguousBroadcast) throw new Error("wallet-provider-secret");
      settled = true;
      return txHash;
    },
  };
  const dependencies = {
    now: () => fixedNow,
    randomBytes: (size) => Uint8Array.from({ length: size }, (_, index) => index + 1),
    loadUserPrivateKey: async (path) => {
      assert.equal(path, "/secure/rfq-canary-user-key");
      return userPrivateKey;
    },
    publicClient,
    walletClient,
    async fetch(input, init = {}) {
      const call = {
        url: String(input),
        method: init.method ?? "GET",
        headers: new Headers(init.headers),
        body: init.body,
        redirect: init.redirect,
      };
      apiCalls.push(call);
      const path = new URL(call.url).pathname;
      if (path === "/rfq/ready" && call.method === "GET") return jsonResponse(readyResponse());
      if (path === "/rfq/quote" && call.method === "POST") {
        quotePosts += 1;
        assert.equal(call.headers.get("x-api-key"), apiKey);
        assert.match(call.headers.get("idempotency-key"), /^settlement_canary_/);
        return jsonResponse({
          quoteId: "q_settlement_canary_fixture",
          snapshotId: "snapshot_settlement_canary_fixture",
          amountOut: quote.amountOut,
          minAmountOut: quote.minAmountOut,
          deadline: quote.deadline,
          nonce: quote.nonce,
          signature,
        });
      }
      if (path === "/rfq/submit" && call.method === "POST") {
        assert.equal(quotePosts, 2);
        if (options.submitFailure) {
          return jsonResponse({
            code: "SETTLEMENT_UNAVAILABLE",
            message: `upstream-secret ${apiKey}`,
            traceId: "tr_submit_failure",
          }, 503);
        }
        return jsonResponse({
          status: "accepted",
          txHash,
          settlementEventId: "se_settlement_canary_fixture",
          hedgeOrderId: "hedge_settlement_canary_fixture",
          pnlId: "pnl_settlement_canary_fixture",
        }, 202);
      }
      if (path === "/rfq/quote/q_settlement_canary_fixture" && call.method === "GET") {
        return jsonResponse({
          quoteId: "q_settlement_canary_fixture",
          status: "settled",
          snapshotId: "snapshot_settlement_canary_fixture",
          deadline: quote.deadline,
          txHash,
          settlementEventId: "se_settlement_canary_fixture",
          hedgeOrderId: "hedge_settlement_canary_fixture",
          pnlId: "pnl_settlement_canary_fixture",
        });
      }
      if (path === "/rfq/settlements/se_settlement_canary_fixture" && call.method === "GET") {
        return jsonResponse({
          settlementEventId: "se_settlement_canary_fixture",
          status: "applied",
          quoteId: "q_settlement_canary_fixture",
          chainId,
          txHash,
          quoteHash,
          blockNumber: 256,
          logIndex: 3,
          user,
          tokenIn,
          tokenOut,
          amountIn: quote.amountIn,
          amountOut: quote.amountOut,
          nonce: quote.nonce,
          observedAt: "2023-11-14T22:13:20.000Z",
        });
      }
      if (path === "/rfq/hedges/hedge_settlement_canary_fixture" && call.method === "GET") {
        return jsonResponse({
          hedgeOrderId: "hedge_settlement_canary_fixture",
          status: "queued",
          settlementEventId: "se_settlement_canary_fixture",
          quoteId: "q_settlement_canary_fixture",
          chainId,
          token: tokenIn,
          side: "sell",
          amount: quote.amountIn,
          reason: "inventory_rebalance",
          createdAt: "2023-11-14T22:13:20.000Z",
        });
      }
      return jsonResponse({ code: "QUOTE_NOT_FOUND", message: "Not found", traceId: "tr_not_found" }, 404);
    },
  };
  return {
    dependencies,
    apiCalls,
    get walletCalls() { return walletCalls; },
    get simulationCalls() { return simulationCalls; },
    get receiptInput() { return receiptInput; },
  };
}

function settlementReceipt() {
  return {
    status: "success",
    transactionHash: txHash,
    blockNumber: 256n,
    logs: [{
      address: settlementAddress,
      topics: encodeEventTopics({
        abi: rfqSettlementAbi,
        eventName: "QuoteSettled",
        args: { quoteHash, user, tokenIn },
      }),
      data: encodeAbiParameters(
        [
          { name: "tokenOut", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "amountOut", type: "uint256" },
          { name: "nonce", type: "uint256" },
        ],
        [tokenOut, 1_000n, 998n, 42n],
      ),
      logIndex: 3,
    }],
  };
}

function readyResponse() {
  const components = {};
  for (const component of [
    "marketData", "marketSnapshotStore", "routing", "pricing", "risk", "signer", "quoteRepository",
    "quoteControl", "riskDecisionStore", "rateLimitStore", "inventory", "execution", "settlementEventStore",
    "pnl", "metrics",
  ]) components[component] = "ok";
  return { status: "ready", components };
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}
