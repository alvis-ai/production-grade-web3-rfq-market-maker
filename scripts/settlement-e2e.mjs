#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const requireFromBackend = createRequire(new URL("../backend/package.json", import.meta.url));
const viem = await import(pathToFileURL(requireFromBackend.resolve("viem")).href);
const accounts = await import(pathToFileURL(requireFromBackend.resolve("viem/accounts")).href);
const {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  defineChain,
  http,
} = viem;
const { privateKeyToAccount } = accounts;
const execFileAsync = promisify(execFile);

const chainId = 31_337;
const rpcUrl = process.env.RFQ_ANVIL_RPC_URL ?? "http://127.0.0.1:18545";
const signerPrivateKey =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const userPrivateKey =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const signer = privateKeyToAccount(signerPrivateKey);
const user = privateKeyToAccount(userPrivateKey);
const chain = defineChain({
  id: chainId,
  name: "Anvil RFQ E2E",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const signerClient = createWalletClient({ account: signer, chain, transport: http(rpcUrl) });
const userClient = createWalletClient({ account: user, chain, transport: http(rpcUrl) });

const tokenArtifact = await loadArtifact("contracts/out/LocalE2EToken.s.sol/LocalE2EToken.json");
const settlementArtifact = await loadArtifact("contracts/out/RFQSettlement.sol/RFQSettlement.json");
const factoryArtifact = await loadArtifact("contracts/out/Deploy.s.sol/RFQDeploymentFactory.json");

const tokenIn = await deployContract(signerClient, tokenArtifact, ["Input Token", "TIN"]);
const tokenOut = await deployContract(signerClient, tokenArtifact, ["Output Token", "TOUT"]);
const factory = await deployContract(signerClient, factoryArtifact, []);
const deploymentReceipt = await writeContract(signerClient, {
  address: factory,
  abi: factoryArtifact.abi,
  functionName: "deploy",
  args: [signer.address, signer.address, [tokenIn, tokenOut]],
});
const deploymentEvent = deploymentReceipt.logs.map((log) => {
  try {
    return decodeEventLog({ abi: factoryArtifact.abi, data: log.data, topics: log.topics });
  } catch {
    return undefined;
  }
}).find((event) => event?.eventName === "DeploymentCompleted");
assert.ok(deploymentEvent, "RFQDeploymentFactory must emit DeploymentCompleted");
const settlement = deploymentEvent.args.settlement;
const treasury = deploymentEvent.args.treasury;
assert.match(settlement, /^0x[0-9a-f]{40}$/i);
assert.match(treasury, /^0x[0-9a-f]{40}$/i);

const deploymentCanary = await runContractDeploymentCanary({
  settlement,
  treasury,
  factory,
  tokenIn,
  tokenOut,
});
assert.equal(deploymentCanary.status, "ok");
assert.equal(deploymentCanary.contracts.settlement.toLowerCase(), settlement.toLowerCase());

const amountIn = 10n * 10n ** 18n;
const initialLiquidity = 1_000n * 10n ** 18n;
await writeContract(signerClient, {
  address: tokenIn,
  abi: tokenArtifact.abi,
  functionName: "mint",
  args: [user.address, initialLiquidity],
});
await writeContract(signerClient, {
  address: tokenOut,
  abi: tokenArtifact.abi,
  functionName: "mint",
  args: [treasury, initialLiquidity],
});
await writeContract(userClient, {
  address: tokenIn,
  abi: tokenArtifact.abi,
  functionName: "approve",
  args: [settlement, amountIn],
});

configureBackendRuntime({ tokenIn, tokenOut, settlement });
const { buildServer } = await import("../backend/dist/main.js");
const server = buildServer({ logger: false });
await server.ready();

try {
  const quoteRequest = {
    chainId,
    user: user.address,
    tokenIn,
    tokenOut,
    amountIn: amountIn.toString(),
    slippageBps: 50,
  };
  const quoteResponse = await injectJson(server, "POST", "/quote", quoteRequest, {
    "idempotency-key": "quote_settlement_e2e_0001",
  });
  assert.equal(quoteResponse.statusCode, 200, JSON.stringify(quoteResponse.body));
  assert.match(quoteResponse.body.signature, /^0x[0-9a-f]{130}$/i);

  const signedQuote = {
    user: quoteRequest.user,
    tokenIn: quoteRequest.tokenIn,
    tokenOut: quoteRequest.tokenOut,
    amountIn: quoteRequest.amountIn,
    amountOut: quoteResponse.body.amountOut,
    minAmountOut: quoteResponse.body.minAmountOut,
    nonce: quoteResponse.body.nonce,
    deadline: quoteResponse.body.deadline,
    chainId,
  };
  const userTokenInBefore = await readBalance(tokenArtifact.abi, tokenIn, user.address);
  const userTokenOutBefore = await readBalance(tokenArtifact.abi, tokenOut, user.address);
  const treasuryTokenInBefore = await readBalance(tokenArtifact.abi, tokenIn, treasury);
  const treasuryTokenOutBefore = await readBalance(tokenArtifact.abi, tokenOut, treasury);

  const settlementTxHash = await userClient.writeContract({
    address: settlement,
    abi: settlementArtifact.abi,
    functionName: "submitQuote",
    args: [{
      ...signedQuote,
      amountIn: BigInt(signedQuote.amountIn),
      amountOut: BigInt(signedQuote.amountOut),
      minAmountOut: BigInt(signedQuote.minAmountOut),
      nonce: BigInt(signedQuote.nonce),
      deadline: BigInt(signedQuote.deadline),
      chainId: BigInt(signedQuote.chainId),
    }, quoteResponse.body.signature],
  });
  const settlementReceipt = await waitForSuccess(settlementTxHash);

  const submitResponse = await injectJson(server, "POST", "/submit", {
    quote: signedQuote,
    signature: quoteResponse.body.signature,
    txHash: settlementTxHash,
  });
  assert.equal(submitResponse.statusCode, 202, JSON.stringify(submitResponse.body));
  assert.equal(submitResponse.body.status, "accepted");
  assert.equal(submitResponse.body.txHash, settlementTxHash);
  assert.equal(submitResponse.body.pnlId, `pnl_${quoteResponse.body.quoteId}`);

  const quoteStatus = await injectJson(
    server,
    "GET",
    `/quote/${encodeURIComponent(quoteResponse.body.quoteId)}`,
  );
  const settlementStatus = await injectJson(
    server,
    "GET",
    `/settlements/${encodeURIComponent(submitResponse.body.settlementEventId)}`,
  );
  const hedgeStatus = await injectJson(
    server,
    "GET",
    `/hedges/${encodeURIComponent(submitResponse.body.hedgeOrderId)}`,
  );
  const pnl = await injectJson(server, "GET", "/pnl");

  assert.equal(quoteStatus.body.status, "settled");
  assert.equal(quoteStatus.body.txHash, settlementTxHash);
  assert.equal(settlementStatus.body.status, "applied");
  assert.equal(settlementStatus.body.blockNumber, Number(settlementReceipt.blockNumber));
  assert.equal(settlementStatus.body.txHash, settlementTxHash);
  assert.equal(hedgeStatus.body.status, "queued");
  assert.equal(hedgeStatus.body.quoteId, quoteResponse.body.quoteId);
  assert.ok(pnl.body.trades.some((trade) => trade.pnlId === submitResponse.body.pnlId));

  const amountOut = BigInt(signedQuote.amountOut);
  assert.equal(await readBalance(tokenArtifact.abi, tokenIn, user.address), userTokenInBefore - amountIn);
  assert.equal(await readBalance(tokenArtifact.abi, tokenOut, user.address), userTokenOutBefore + amountOut);
  assert.equal(await readBalance(tokenArtifact.abi, tokenIn, treasury), treasuryTokenInBefore + amountIn);
  assert.equal(await readBalance(tokenArtifact.abi, tokenOut, treasury), treasuryTokenOutBefore - amountOut);
  assert.equal(await publicClient.readContract({
    address: settlement,
    abi: settlementArtifact.abi,
    functionName: "usedNonces",
    args: [user.address, BigInt(signedQuote.nonce)],
  }), true);

  const metrics = await server.inject({ method: "GET", url: "/metrics" });
  assert.match(metrics.payload, /rfq_settlements_total 1/);
  assert.match(metrics.payload, /rfq_hedge_intents_total 1/);
  assert.match(metrics.payload, /rfq_pnl_trades_total 1/);

  console.log(JSON.stringify({
    ok: true,
    chainId,
    settlement,
    treasury,
    factory,
    tokenIn,
    tokenOut,
    quoteId: quoteResponse.body.quoteId,
    txHash: settlementTxHash,
    blockNumber: Number(settlementReceipt.blockNumber),
    deploymentCanaryBlock: deploymentCanary.block.number,
    settlementEventId: submitResponse.body.settlementEventId,
    hedgeOrderId: submitResponse.body.hedgeOrderId,
    pnlId: submitResponse.body.pnlId,
  }, null, 2));
} finally {
  await server.close();
}

async function loadArtifact(path) {
  const artifact = JSON.parse(await readFile(path, "utf8"));
  assert.ok(Array.isArray(artifact.abi) && artifact.abi.length > 0, `${path} must contain an ABI`);
  assert.match(artifact.bytecode?.object ?? "", /^0x[0-9a-f]+$/i, `${path} must contain bytecode`);
  return artifact;
}

async function deployContract(client, artifact, args) {
  const hash = await client.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode.object,
    args,
  });
  const receipt = await waitForSuccess(hash);
  assert.match(receipt.contractAddress ?? "", /^0x[0-9a-f]{40}$/i);
  return receipt.contractAddress;
}

async function writeContract(client, request) {
  return waitForSuccess(await client.writeContract(request));
}

async function waitForSuccess(hash) {
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
  assert.equal(receipt.status, "success", `transaction ${hash} must succeed`);
  return receipt;
}

async function runContractDeploymentCanary({ settlement, treasury, factory, tokenIn, tokenOut }) {
  const { stdout, stderr } = await execFileAsync(process.execPath, [
    "scripts/contract-deployment-integration-check.mjs",
  ], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      RFQ_CHAIN_INTEGRATION_CONFIRM: "yes",
      RFQ_CHAIN_INTEGRATION_RPC_URL: rpcUrl,
      RFQ_CHAIN_INTEGRATION_CHAIN_ID: chainId.toString(),
      RFQ_CHAIN_INTEGRATION_SETTLEMENT_ADDRESS: settlement,
      RFQ_CHAIN_INTEGRATION_TREASURY_ADDRESS: treasury,
      RFQ_CHAIN_INTEGRATION_FACTORY_ADDRESS: factory,
      RFQ_CHAIN_INTEGRATION_ADMIN_ADDRESS: signer.address,
      RFQ_CHAIN_INTEGRATION_TRUSTED_SIGNERS_JSON: JSON.stringify({
        primary: signer.address,
        authorized: [signer.address],
      }),
      RFQ_CHAIN_INTEGRATION_TOKEN_WHITELIST_JSON: JSON.stringify({ tokens: [tokenIn, tokenOut] }),
      RFQ_CHAIN_INTEGRATION_EXPECT_PAUSED: "false",
    },
    timeout: 30_000,
  });
  assert.equal(stderr, "");
  return JSON.parse(stdout);
}

async function readBalance(abi, token, account) {
  return publicClient.readContract({ address: token, abi, functionName: "balanceOf", args: [account] });
}

async function injectJson(server, method, url, payload, headers = {}) {
  const response = await server.inject({
    method,
    url,
    headers: payload ? { "content-type": "application/json", ...headers } : headers,
    payload: payload ? JSON.stringify(payload) : undefined,
  });
  return {
    statusCode: response.statusCode,
    body: response.payload ? JSON.parse(response.payload) : undefined,
  };
}

function configureBackendRuntime({ tokenIn, tokenOut, settlement }) {
  for (const name of [
    "DATABASE_URL",
    "DB_HOST",
    "DB_PORT",
    "DB_NAME",
    "DB_USER",
    "DB_PASSWORD",
    "RFQ_API_KEYS_JSON",
    "RFQ_CEX_PAIRS",
    "RFQ_CHAINLINK_CONFIG_JSON",
    "RFQ_REDIS_URL",
    "RFQ_TRUSTED_SIGNER_OVERLAP_ADDRESSES",
  ]) delete process.env[name];

  process.env.NODE_ENV = "test";
  process.env.RFQ_MARKET_DATA_PROVIDER = "static";
  process.env.RFQ_MARKET_PAIRS = `${chainId}:${tokenIn}:${tokenOut}`;
  process.env.RFQ_SIGNER_MODE = "local";
  process.env.RFQ_SIGNER_PRIVATE_KEY = signerPrivateKey;
  process.env.RFQ_TRUSTED_SIGNER_ADDRESS = signer.address;
  process.env.RFQ_SETTLEMENT_ADDRESS = settlement;
  process.env.RFQ_ALLOW_SIMULATED_SETTLEMENT = "false";
  process.env.RFQ_QUOTE_TTL_SECONDS = "300";
  process.env.RFQ_RECEIPT_CONFIG_JSON = JSON.stringify({
    chains: [{ chainId, rpcUrl, settlementAddress: settlement, confirmations: 1, receiptTimeoutMs: 30_000 }],
  });
  process.env.RFQ_TOKEN_REGISTRY_JSON = JSON.stringify({
    tokens: [
      { chainId, tokenAddress: tokenIn, symbol: "TIN", decimals: 18, isWhitelisted: true, riskTier: "low", usdReference: false },
      { chainId, tokenAddress: tokenOut, symbol: "TOUT", decimals: 18, isWhitelisted: true, riskTier: "low", usdReference: true },
    ],
  });
  process.env.RFQ_RISK_POLICY_JSON = JSON.stringify({
    policyVersion: "anvil-settlement-e2e-v1",
    enabledChainIds: [chainId],
    tokenLimits: [tokenIn, tokenOut].map((tokenAddress) => ({
      chainId,
      tokenAddress,
      maxAmountIn: "1000000000000000000000",
      minAmountOut: "1",
      maxNotionalUsd: "1000000",
      maxAbsoluteInventory: "10000000000000000000000",
    })),
    restrictedUsers: [],
    toxicFlowScores: [],
    maxToxicScoreBps: 8_000,
    maxUserOpenNotionalUsd: "2000000",
    maxPairOpenNotionalUsd: "5000000",
    portfolioVar: {
      modelVersion: "component-sum-v1",
      maxPortfolioVarUsd: "500000",
      confidenceMultiplierBps: 23_300,
      horizonSeconds: 86_400,
      maxSnapshotAgeMs: 5_000,
      maxFutureSkewMs: 5_000,
      valuationPairs: [{ chainId, tokenAddress: tokenIn, usdReferenceTokenAddress: tokenOut }],
    },
    portfolioDelta: {
      modelVersion: "gross-net-asset-delta-v2",
      softGrossLimitUsd: "500000",
      hardGrossLimitUsd: "1000000",
      softNetLimitUsd: "250000",
      hardNetLimitUsd: "500000",
      assetLimits: [{
        chainId,
        tokenAddress: tokenIn,
        softLimitUsd: "250000",
        hardLimitUsd: "500000",
      }],
    },
    minLiquidityUsd: "1000000",
    maxVolatilityBps: 500,
    maxSlippageBps: 500,
    maxQuotedSpreadBps: 1_000,
  });
}
