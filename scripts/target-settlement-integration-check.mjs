#!/usr/bin/env node

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import {
  RFQClient,
  buildQuoteTypedData,
  buildSubmitQuoteWriteRequest,
  erc20Abi,
  hashSettlementQuote,
  rfqSettlementAbi,
} from "../sdk/dist/index.js";

const requireFromBackend = createRequire(new URL("../backend/package.json", import.meta.url));
const viem = await import(pathToFileURL(requireFromBackend.resolve("viem")).href);
const accounts = await import(pathToFileURL(requireFromBackend.resolve("viem/accounts")).href);
const {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  defineChain,
  encodeFunctionData,
  hashTypedData,
  http,
  keccak256,
  recoverTypedDataAddress,
} = viem;
const { privateKeyToAccount } = accounts;

const confirmation = "broadcast-one-settlement";
const apiKeyPattern = /^[A-Za-z0-9_-]{3,64}\.[A-Za-z0-9_-]{32,128}$/;
const productionChainIds = new Set([1, 10, 56, 100, 137, 250, 324, 1_101, 8_453, 42_161, 43_114, 59_144, 534_352]);
const balanceOfAbi = [{
  type: "function",
  name: "balanceOf",
  stateMutability: "view",
  inputs: [{ name: "account", type: "address" }],
  outputs: [{ name: "", type: "uint256" }],
}];

export async function runTargetSettlementIntegrationCheck(env = process.env, dependencies = {}) {
  assertObject(env, "Target settlement integration environment");
  assertObject(dependencies, "Target settlement integration dependencies");
  if (readOwn(env, "RFQ_SETTLEMENT_CANARY_CONFIRM") !== confirmation) {
    throw new Error(
      `RFQ_SETTLEMENT_CANARY_CONFIRM=${confirmation} is required because this check broadcasts one token settlement`,
    );
  }
  if (readOwn(env, "RFQ_SETTLEMENT_CANARY_ENVIRONMENT") !== "staging-testnet") {
    throw new Error("RFQ_SETTLEMENT_CANARY_ENVIRONMENT=staging-testnet is required");
  }

  const apiBaseUrl = readHttpsApiBaseUrl(env, "RFQ_SETTLEMENT_CANARY_API_BASE_URL");
  const apiKey = readApiKey(env, "RFQ_SETTLEMENT_CANARY_API_KEY");
  const rpcUrl = readHttpsRpcUrl(env, "RFQ_SETTLEMENT_CANARY_RPC_URL");
  const chainId = readInteger(env, "RFQ_SETTLEMENT_CANARY_CHAIN_ID", undefined, 1, Number.MAX_SAFE_INTEGER);
  if (productionChainIds.has(chainId)) {
    throw new Error("Target settlement canary refuses known production chain IDs");
  }
  const settlementAddress = readAddress(env, "RFQ_SETTLEMENT_CANARY_SETTLEMENT_ADDRESS");
  const trustedSignerAddress = readAddress(env, "RFQ_SETTLEMENT_CANARY_TRUSTED_SIGNER_ADDRESS");
  const expectedUserAddress = readAddress(env, "RFQ_SETTLEMENT_CANARY_EXPECTED_USER_ADDRESS");
  const userKeyFile = readAbsolutePath(env, "RFQ_SETTLEMENT_CANARY_USER_KEY_FILE");
  const tokenIn = readAddress(env, "RFQ_SETTLEMENT_CANARY_TOKEN_IN");
  const tokenOut = readAddress(env, "RFQ_SETTLEMENT_CANARY_TOKEN_OUT");
  assert.notEqual(tokenIn, tokenOut, "Target settlement canary token pair must contain distinct addresses");
  const amountIn = readPositiveUInt(env, "RFQ_SETTLEMENT_CANARY_AMOUNT_IN");
  const maxAmountIn = readPositiveUInt(env, "RFQ_SETTLEMENT_CANARY_MAX_AMOUNT_IN");
  const maxAmountOut = readPositiveUInt(env, "RFQ_SETTLEMENT_CANARY_MAX_AMOUNT_OUT");
  assert.equal(BigInt(amountIn) <= BigInt(maxAmountIn), true, "Target settlement amountIn exceeds its reviewed cap");
  const slippageBps = readInteger(env, "RFQ_SETTLEMENT_CANARY_SLIPPAGE_BPS", 10, 0, 10_000);
  const minTtlSeconds = readInteger(env, "RFQ_SETTLEMENT_CANARY_MIN_TTL_SECONDS", 15, 1, 3_600);
  const maxTtlSeconds = readInteger(env, "RFQ_SETTLEMENT_CANARY_MAX_TTL_SECONDS", 120, 1, 3_600);
  assert.equal(minTtlSeconds <= maxTtlSeconds, true, "Target settlement TTL bounds are inverted");
  const confirmations = readInteger(env, "RFQ_SETTLEMENT_CANARY_CONFIRMATIONS", 2, 1, 100);
  const receiptTimeoutMs = readInteger(env, "RFQ_SETTLEMENT_CANARY_RECEIPT_TIMEOUT_MS", 180_000, 1_000, 600_000);

  const now = dependencies.now ?? Date.now;
  const random = dependencies.randomBytes ?? randomBytes;
  const fetchImpl = dependencies.fetch ?? globalThis.fetch;
  const privateKeyLoader = dependencies.loadUserPrivateKey ?? loadUserPrivateKey;
  assert.equal(typeof now, "function", "Target settlement integration clock must be a function");
  assert.equal(typeof random, "function", "Target settlement integration randomBytes must be a function");
  assert.equal(typeof fetchImpl, "function", "Target settlement integration fetch must be a function");
  assert.equal(typeof privateKeyLoader, "function", "Target settlement integration private key loader must be a function");

  let account;
  try {
    const privateKey = await privateKeyLoader(userKeyFile);
    assertPrivateKey(privateKey);
    account = privateKeyToAccount(privateKey);
  } catch {
    throw new Error("Target settlement user key could not be loaded safely");
  }
  assert.equal(account.address.toLowerCase(), expectedUserAddress, "Target settlement canary key does not match expected user");

  const chain = defineChain({
    id: chainId,
    name: `RFQ Staging Chain ${chainId}`,
    nativeCurrency: { name: "Native Token", symbol: "NATIVE", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
  const suppliedPublicClient = dependencies.publicClient;
  const suppliedWalletClient = dependencies.walletClient;
  if ((suppliedPublicClient === undefined) !== (suppliedWalletClient === undefined)) {
    throw new Error("Target settlement integration clients must be supplied together");
  }
  const publicClient = suppliedPublicClient ?? createPublicClient({ chain, transport: http(rpcUrl) });
  const walletClient = suppliedWalletClient ?? createWalletClient({ account, chain, transport: http(rpcUrl) });
  assertPublicClient(publicClient);
  assertWalletClient(walletClient);

  const startedAtMs = readCurrentTime(now);
  const suffix = `${startedAtMs.toString(36)}_${readRandomHex(random, 6)}`;
  const idempotencyKey = `settlement_canary_${suffix}`;
  const traceId = `tr_settlement_canary_${suffix}`;
  const noRedirectFetch = (input, init) => fetchImpl(input, { ...init, redirect: "error" });
  const client = new RFQClient(apiBaseUrl, { apiKey, fetch: noRedirectFetch, traceId });
  let submittedTxHash;
  let broadcastAttempted = false;

  try {
    const observedChainId = await publicClient.getChainId();
    assert.equal(observedChainId, chainId, "Target settlement RPC chain ID");

    const [settlementCode, tokenInCode, tokenOutCode, treasury, paused, tokenInAllowed, tokenOutAllowed,
      signerAllowed, nativeBalance] = await Promise.all([
      publicClient.getBytecode({ address: settlementAddress }),
      publicClient.getBytecode({ address: tokenIn }),
      publicClient.getBytecode({ address: tokenOut }),
      publicClient.readContract({ address: settlementAddress, abi: rfqSettlementAbi, functionName: "treasury" }),
      publicClient.readContract({ address: settlementAddress, abi: rfqSettlementAbi, functionName: "paused" }),
      publicClient.readContract({
        address: settlementAddress, abi: rfqSettlementAbi, functionName: "tokenWhitelist", args: [tokenIn],
      }),
      publicClient.readContract({
        address: settlementAddress, abi: rfqSettlementAbi, functionName: "tokenWhitelist", args: [tokenOut],
      }),
      publicClient.readContract({
        address: settlementAddress, abi: rfqSettlementAbi, functionName: "trustedSigners", args: [trustedSignerAddress],
      }),
      publicClient.getBalance({ address: expectedUserAddress }),
    ]);
    assertContractCode(settlementCode, "Settlement");
    assertContractCode(tokenInCode, "tokenIn");
    assertContractCode(tokenOutCode, "tokenOut");
    assertAddressValue(treasury, "Target settlement Treasury");
    const treasuryAddress = treasury.toLowerCase();
    assert.equal(paused, false, "Target settlement contract must be unpaused");
    assert.equal(tokenInAllowed, true, "Target settlement tokenIn must be whitelisted");
    assert.equal(tokenOutAllowed, true, "Target settlement tokenOut must be whitelisted");
    assert.equal(signerAllowed, true, "Target settlement trusted signer must be authorized onchain");
    assertBigInt(nativeBalance, "Target settlement user native balance");
    assert.equal(nativeBalance > 0n, true, "Target settlement user must have native gas balance");
    assertContractCode(await publicClient.getBytecode({ address: treasuryAddress }), "Treasury");

    const before = await readSettlementBalances(publicClient, {
      settlementAddress, treasuryAddress, user: expectedUserAddress, tokenIn, tokenOut,
    });
    assert.equal(before.userTokenIn >= BigInt(amountIn), true, "Target settlement user tokenIn balance is insufficient");
    assert.equal(before.allowance >= BigInt(amountIn), true, "Target settlement requires pre-existing bounded allowance");
    assert.equal(before.allowance <= BigInt(maxAmountIn), true, "Target settlement allowance exceeds its reviewed cap");

    const readiness = await client.ready();
    if (readiness.status !== "ready" || Object.values(readiness.components).some((value) => value !== "ok")) {
      throw new Error("Target settlement API readiness is degraded");
    }

    const quoteRequest = {
      chainId,
      user: expectedUserAddress,
      tokenIn,
      tokenOut,
      amountIn,
      slippageBps,
    };
    const quoteResponse = await client.quote(quoteRequest, { idempotencyKey });
    const replayResponse = await client.quote(quoteRequest, { idempotencyKey });
    assert.deepEqual(replayResponse, quoteResponse, "Target settlement quote replay must be exact");
    assert.equal(
      BigInt(quoteResponse.amountOut) <= BigInt(maxAmountOut),
      true,
      "Target settlement amountOut exceeds its reviewed cap",
    );
    const remainingTtlSeconds = quoteResponse.deadline - Math.floor(readCurrentTime(now) / 1_000);
    assert.equal(remainingTtlSeconds >= minTtlSeconds, true, "Target settlement quote TTL is too short to broadcast safely");
    assert.equal(remainingTtlSeconds <= maxTtlSeconds, true, "Target settlement quote TTL exceeds its reviewed bound");

    const quote = {
      user: expectedUserAddress,
      tokenIn,
      tokenOut,
      amountIn,
      amountOut: quoteResponse.amountOut,
      minAmountOut: quoteResponse.minAmountOut,
      nonce: quoteResponse.nonce,
      deadline: quoteResponse.deadline,
      chainId,
    };
    const typedData = buildQuoteTypedData(quote, settlementAddress);
    const recoveredSigner = await recoverTypedDataAddress({ ...typedData, signature: quoteResponse.signature });
    assert.equal(recoveredSigner.toLowerCase(), trustedSignerAddress, "Target settlement quote signer");
    assert.equal(
      before.treasuryTokenOut >= BigInt(quote.amountOut),
      true,
      "Target settlement Treasury tokenOut balance is insufficient",
    );
    assert.equal(await publicClient.readContract({
      address: settlementAddress,
      abi: rfqSettlementAbi,
      functionName: "usedNonces",
      args: [expectedUserAddress, BigInt(quote.nonce)],
    }), false, "Target settlement quote nonce must be unused before simulation");

    const writeRequest = buildSubmitQuoteWriteRequest({
      settlementAddress,
      quote,
      signature: quoteResponse.signature,
    });
    const simulation = await publicClient.simulateContract({ ...writeRequest, account });
    assertObject(simulation, "Target settlement simulation");
    assert.equal(simulation.result, BigInt(quote.amountOut), "Target settlement simulation amountOut");

    broadcastAttempted = true;
    submittedTxHash = await walletClient.writeContract({ ...writeRequest, account });
    assertTxHash(submittedTxHash, "Target settlement broadcast transaction hash");
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: submittedTxHash,
      confirmations,
      timeout: receiptTimeoutMs,
    });
    const receiptEvidence = assertSuccessfulReceipt(receipt, submittedTxHash, settlementAddress, quote);
    const transaction = await publicClient.getTransaction({ hash: submittedTxHash });
    assertSettlementTransaction(transaction, submittedTxHash, expectedUserAddress, settlementAddress, writeRequest);

    const after = await readSettlementBalances(publicClient, {
      settlementAddress, treasuryAddress, user: expectedUserAddress, tokenIn, tokenOut,
    });
    assert.equal(after.userTokenIn, before.userTokenIn - BigInt(quote.amountIn), "user tokenIn settlement delta");
    assert.equal(after.userTokenOut, before.userTokenOut + BigInt(quote.amountOut), "user tokenOut settlement delta");
    assert.equal(
      after.treasuryTokenIn,
      before.treasuryTokenIn + BigInt(quote.amountIn),
      "Treasury tokenIn settlement delta",
    );
    assert.equal(
      after.treasuryTokenOut,
      before.treasuryTokenOut - BigInt(quote.amountOut),
      "Treasury tokenOut settlement delta",
    );
    assert.equal(await publicClient.readContract({
      address: settlementAddress,
      abi: rfqSettlementAbi,
      functionName: "usedNonces",
      args: [expectedUserAddress, BigInt(quote.nonce)],
    }), true, "Target settlement quote nonce must be consumed after confirmation");

    const submitResponse = await client.submit({ quote, signature: quoteResponse.signature, txHash: submittedTxHash });
    assert.equal(submitResponse.txHash?.toLowerCase(), submittedTxHash.toLowerCase(), "Target submit txHash");
    const quoteStatus = await client.getQuote(quoteResponse.quoteId);
    assert.equal(quoteStatus.status, "settled", "Target quote lifecycle after submit");
    assert.equal(quoteStatus.snapshotId, quoteResponse.snapshotId, "Target quote status snapshotId");
    assert.equal(quoteStatus.deadline, quoteResponse.deadline, "Target quote status deadline");
    assert.equal(quoteStatus.txHash?.toLowerCase(), submittedTxHash.toLowerCase(), "Target quote status txHash");
    assertString(quoteStatus.settlementEventId, "Target quote settlementEventId");
    assertString(quoteStatus.hedgeOrderId, "Target quote hedgeOrderId");
    assertString(quoteStatus.pnlId, "Target quote pnlId");

    const settlementStatus = await client.getSettlement(quoteStatus.settlementEventId);
    assert.equal(settlementStatus.quoteId, quoteResponse.quoteId, "Target settlement status quoteId");
    assert.equal(settlementStatus.chainId, chainId, "Target settlement status chainId");
    assert.equal(settlementStatus.user.toLowerCase(), expectedUserAddress, "Target settlement status user");
    assert.equal(settlementStatus.tokenIn.toLowerCase(), tokenIn, "Target settlement status tokenIn");
    assert.equal(settlementStatus.tokenOut.toLowerCase(), tokenOut, "Target settlement status tokenOut");
    assert.equal(settlementStatus.txHash.toLowerCase(), submittedTxHash.toLowerCase(), "Target settlement status txHash");
    assert.equal(settlementStatus.blockNumber, receiptEvidence.blockNumber, "Target settlement status blockNumber");
    assert.equal(settlementStatus.logIndex, receiptEvidence.logIndex, "Target settlement status logIndex");
    assert.equal(settlementStatus.quoteHash.toLowerCase(), receiptEvidence.quoteHash, "Target settlement status quoteHash");
    assert.equal(settlementStatus.amountIn, quote.amountIn, "Target settlement status amountIn");
    assert.equal(settlementStatus.amountOut, quote.amountOut, "Target settlement status amountOut");
    assert.equal(settlementStatus.nonce, quote.nonce, "Target settlement status nonce");

    const hedgeStatus = await client.getHedge(quoteStatus.hedgeOrderId);
    assert.equal(hedgeStatus.quoteId, quoteResponse.quoteId, "Target hedge status quoteId");
    assert.equal(hedgeStatus.settlementEventId, quoteStatus.settlementEventId, "Target hedge settlementEventId");
    assert.equal(hedgeStatus.status === "queued" || hedgeStatus.status === "filled", true,
      "Target hedge must be queued or filled");

    return {
      status: "ok",
      mode: "staging-testnet-settlement",
      chainId,
      quoteId: quoteResponse.quoteId,
      snapshotId: quoteResponse.snapshotId,
      txHash: submittedTxHash,
      blockNumber: receiptEvidence.blockNumber,
      logIndex: receiptEvidence.logIndex,
      settlementAddress,
      treasuryAddress,
      signerAddress: recoveredSigner.toLowerCase(),
      quoteHash: receiptEvidence.quoteHash,
      quoteDigest: hashTypedData(typedData),
      signatureHash: keccak256(quoteResponse.signature),
      settlementEventId: quoteStatus.settlementEventId,
      hedgeOrderId: quoteStatus.hedgeOrderId,
      hedgeStatus: hedgeStatus.status,
      pnlId: quoteStatus.pnlId,
      confirmations,
      idempotencyVerified: true,
    };
  } catch {
    if (submittedTxHash !== undefined) {
      throw new Error(
        `Target settlement integration check failed after broadcast ${submittedTxHash}; do not retry automatically`,
      );
    }
    if (broadcastAttempted) {
      throw new Error("Target settlement broadcast outcome is unknown; do not retry automatically");
    }
    throw new Error("Target settlement integration check failed before broadcast");
  }
}

async function readSettlementBalances(publicClient, input) {
  const [userTokenIn, userTokenOut, treasuryTokenIn, treasuryTokenOut, allowance] = await Promise.all([
    readTokenBalance(publicClient, input.tokenIn, input.user),
    readTokenBalance(publicClient, input.tokenOut, input.user),
    readTokenBalance(publicClient, input.tokenIn, input.treasuryAddress),
    readTokenBalance(publicClient, input.tokenOut, input.treasuryAddress),
    publicClient.readContract({
      address: input.tokenIn,
      abi: erc20Abi,
      functionName: "allowance",
      args: [input.user, input.settlementAddress],
    }),
  ]);
  for (const [label, value] of Object.entries({
    userTokenIn, userTokenOut, treasuryTokenIn, treasuryTokenOut, allowance,
  })) {
    assertBigInt(value, `Target settlement ${label}`);
  }
  return { userTokenIn, userTokenOut, treasuryTokenIn, treasuryTokenOut, allowance };
}

async function readTokenBalance(publicClient, token, account) {
  return publicClient.readContract({ address: token, abi: balanceOfAbi, functionName: "balanceOf", args: [account] });
}

function assertSuccessfulReceipt(receipt, txHash, settlementAddress, quote) {
  assertObject(receipt, "Target settlement receipt");
  assert.equal(receipt.status, "success", "Target settlement receipt status");
  assert.equal(receipt.transactionHash?.toLowerCase(), txHash.toLowerCase(), "Target settlement receipt txHash");
  const blockNumber = integerLikeToSafeInteger(receipt.blockNumber, "Target settlement receipt blockNumber");
  assert.equal(Array.isArray(receipt.logs), true, "Target settlement receipt logs must be an array");
  const expectedQuoteHash = hashSettlementQuote(quote).toLowerCase();
  const matching = [];
  for (const log of receipt.logs) {
    if (typeof log !== "object" || log === null || Array.isArray(log) ||
        typeof log.address !== "string" || log.address.toLowerCase() !== settlementAddress) continue;
    try {
      const event = decodeEventLog({ abi: rfqSettlementAbi, data: log.data, topics: log.topics });
      if (event.eventName !== "QuoteSettled") continue;
      if (event.args.quoteHash.toLowerCase() !== expectedQuoteHash ||
          event.args.user.toLowerCase() !== quote.user.toLowerCase() ||
          event.args.tokenIn.toLowerCase() !== quote.tokenIn.toLowerCase() ||
          event.args.tokenOut.toLowerCase() !== quote.tokenOut.toLowerCase() ||
          event.args.amountIn !== BigInt(quote.amountIn) ||
          event.args.amountOut !== BigInt(quote.amountOut) ||
          event.args.nonce !== BigInt(quote.nonce)) continue;
      matching.push({
        quoteHash: expectedQuoteHash,
        logIndex: integerLikeToSafeInteger(log.logIndex, "Target settlement QuoteSettled logIndex"),
      });
    } catch {}
  }
  assert.equal(matching.length, 1, "Target settlement receipt must contain exactly one matching QuoteSettled event");
  return { blockNumber, ...matching[0] };
}

function assertSettlementTransaction(transaction, txHash, user, settlementAddress, writeRequest) {
  assertObject(transaction, "Target settlement transaction");
  assert.equal(transaction.hash?.toLowerCase(), txHash.toLowerCase(), "Target settlement transaction hash");
  assert.equal(transaction.from?.toLowerCase(), user, "Target settlement transaction sender");
  assert.equal(transaction.to?.toLowerCase(), settlementAddress, "Target settlement transaction target");
  assert.equal(transaction.input?.toLowerCase(), encodeFunctionData(writeRequest).toLowerCase(),
    "Target settlement transaction calldata");
}

async function loadUserPrivateKey(path) {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error("Target settlement user key must be a regular non-symlink file");
  }
  if ((metadata.mode & 0o077) !== 0) {
    throw new Error("Target settlement user key file must not grant group or other permissions");
  }
  if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) {
    throw new Error("Target settlement user key file must be owned by the current user");
  }
  const raw = await readFile(path, "utf8");
  const value = raw.endsWith("\n") ? raw.slice(0, -1) : raw;
  if (value.includes("\n") || value.includes("\r")) {
    throw new Error("Target settlement user key file must contain exactly one key line");
  }
  return value;
}

function assertPublicClient(value) {
  assertObject(value, "Target settlement public client");
  for (const method of [
    "getBalance", "getBytecode", "getChainId", "getTransaction", "readContract", "simulateContract",
    "waitForTransactionReceipt",
  ]) {
    if (typeof value[method] !== "function") throw new Error(`Target settlement public client.${method} is required`);
  }
}

function assertWalletClient(value) {
  assertObject(value, "Target settlement wallet client");
  if (typeof value.writeContract !== "function") {
    throw new Error("Target settlement wallet client.writeContract is required");
  }
}

function assertObject(value, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function readOwn(env, field) {
  if (!Object.prototype.hasOwnProperty.call(env, field)) return undefined;
  const value = env[field];
  if (value !== undefined && typeof value !== "string") throw new Error(`${field} must be a primitive string`);
  return value;
}

function readRequired(env, field) {
  const value = readOwn(env, field);
  if (value === undefined || value.length === 0 || value.trim() !== value || value.startsWith("replace-with-")) {
    throw new Error(`${field} must be explicitly configured without surrounding whitespace`);
  }
  return value;
}

function readHttpsApiBaseUrl(env, field) {
  const parsed = readUrl(env, field);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash ||
      parsed.hostname.includes("*")) {
    throw new Error(`${field} must be an absolute HTTPS URL without credentials, wildcard, query, or fragment`);
  }
  const pathname = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/, "");
  return `${parsed.origin}${pathname}`;
}

function readHttpsRpcUrl(env, field) {
  const parsed = readUrl(env, field);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash || parsed.hostname.includes("*")) {
    throw new Error(`${field} must be an absolute HTTPS URL without credentials, wildcard, or fragment`);
  }
  return parsed.toString();
}

function readUrl(env, field) {
  const value = readRequired(env, field);
  try {
    return new URL(value);
  } catch {
    throw new Error(`${field} must be an absolute HTTPS URL`);
  }
}

function readApiKey(env, field) {
  const value = readRequired(env, field);
  if (!apiKeyPattern.test(value)) throw new Error(`${field} must use keyId.secret format`);
  return value;
}

function readAbsolutePath(env, field) {
  const value = readRequired(env, field);
  if (!isAbsolute(value) || value.includes("\0")) throw new Error(`${field} must be an absolute filesystem path`);
  return value;
}

function readAddress(env, field) {
  const value = readRequired(env, field);
  if (!/^0x[0-9a-fA-F]{40}$/.test(value) || /^0x0{40}$/i.test(value)) {
    throw new Error(`${field} must be a non-zero 20-byte hex address`);
  }
  return value.toLowerCase();
}

function readPositiveUInt(env, field) {
  const value = readRequired(env, field);
  if (!/^[1-9][0-9]*$/.test(value) || value.length > 78 || BigInt(value) >= 1n << 256n) {
    throw new Error(`${field} must be a canonical positive uint256 string`);
  }
  return value;
}

function readInteger(env, field, fallback, min, max) {
  const value = readOwn(env, field);
  if (value === undefined || value.length === 0) {
    if (fallback !== undefined) return fallback;
    throw new Error(`${field} is required`);
  }
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error(`${field} must be an integer between ${min} and ${max}`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${field} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

function assertPrivateKey(value) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error("Target settlement user key file must contain one 32-byte hex private key");
  }
}

function assertAddressValue(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value) || /^0x0{40}$/i.test(value)) {
    throw new Error(`${label} must be a non-zero address`);
  }
}

function assertContractCode(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value) || value === "0x") {
    throw new Error(`Target settlement ${label} must contain contract bytecode`);
  }
}

function assertBigInt(value, label) {
  if (typeof value !== "bigint" || value < 0n) throw new Error(`${label} must be a non-negative bigint`);
}

function assertTxHash(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${label} must be a 32-byte hex string`);
  }
}

function assertString(value, label) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a non-empty string`);
}

function integerLikeToSafeInteger(value, label) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === "bigint" && value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(value);
  throw new Error(`${label} must be a non-negative safe integer`);
}

function readCurrentTime(now) {
  const value = now();
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("Target settlement integration current time must be a positive safe integer");
  }
  return value;
}

function readRandomHex(random, size) {
  const value = random(size);
  if (!(value instanceof Uint8Array) || value.length !== size) {
    throw new Error(`Target settlement integration randomBytes must return ${size} bytes`);
  }
  return Buffer.from(value).toString("hex");
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : undefined;
if (invokedPath === import.meta.url) {
  const result = await runTargetSettlementIntegrationCheck();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
