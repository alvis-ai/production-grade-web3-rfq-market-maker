#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { endPool, getPool } from "../backend/dist/db/pool.js";
import { readHedgeWorkerRuntimeConfig } from "../backend/dist/hedge-worker-main.js";
import { BinanceSpotAdapter } from "../backend/dist/modules/hedge/binance-spot.adapter.js";
import { BinanceSymbolRulesService } from "../backend/dist/modules/hedge/binance-symbol-rules.js";
import { HedgeFeeWorker } from "../backend/dist/modules/hedge/hedge-fee-worker.js";
import { PostgresHedgeService } from "../backend/dist/modules/hedge/postgres-hedge.service.js";
import { DeltaNeutralHedgePlanner } from "../backend/dist/modules/hedge/hedge-intent-planner.js";
import { HedgeWorker } from "../backend/dist/modules/hedge/hedge-worker.js";
import { PostgresHedgeFeeStore } from "../backend/dist/modules/hedge/postgres-hedge-fee.store.js";
import { PostgresHedgeJobStore } from "../backend/dist/modules/hedge/postgres-hedge-job.store.js";
import { PostgresInventoryService } from "../backend/dist/modules/inventory/postgres-inventory.service.js";
import { PostgresSettlementIndexerStore } from "../backend/dist/modules/indexer/postgres-settlement-indexer.store.js";
import { SettlementIndexerWorker } from "../backend/dist/modules/indexer/settlement-indexer.worker.js";
import { PostgresMarketSnapshotStore } from "../backend/dist/modules/market-data/postgres-market-snapshot.repository.js";
import { PostgresPnlStore } from "../backend/dist/modules/pnl/postgres-pnl.store.js";
import { QuoteSnapshotPnlValuationProvider } from "../backend/dist/modules/pnl/quote-snapshot-valuation.provider.js";
import { ConfiguredTokenRegistry } from "../backend/dist/modules/pricing/token-registry.js";
import { PostgresQuoteRepository } from "../backend/dist/modules/quote/postgres-quote.repository.js";
import { PostTradeReconciliationMetrics } from "../backend/dist/modules/reconciliation/post-trade-reconciliation.metrics.js";
import { PostTradeReconciliationWorker } from "../backend/dist/modules/reconciliation/post-trade-reconciliation.worker.js";
import { PostgresPostTradeReconciliationStore } from "../backend/dist/modules/reconciliation/postgres-post-trade-reconciliation.store.js";
import { ReconciliationService } from "../backend/dist/modules/reconciliation/reconciliation.service.js";
import { PostgresSettlementEventStore } from "../backend/dist/modules/settlement/postgres-settlement-event.store.js";

if (process.env.RFQ_SETTLEMENT_INDEXER_E2E_CONFIRM !== "yes") {
  throw new Error(
    "RFQ_SETTLEMENT_INDEXER_E2E_CONFIRM=yes is required because this check writes synthetic chain and database data",
  );
}
if (process.env.RFQ_BINANCE_TESTNET_FIXTURE_MODE !== "core-flow-filled") {
  throw new Error("RFQ_BINANCE_TESTNET_FIXTURE_MODE=core-flow-filled is required");
}
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
assertLoopbackDatabase(process.env.DATABASE_URL);

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

const chainId = parseChainId(process.env.RFQ_ANVIL_CHAIN_ID ?? "31338");
const rpcUrl = process.env.RFQ_ANVIL_RPC_URL ?? "http://127.0.0.1:18545";
const signerPrivateKey =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const userPrivateKey =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const signer = privateKeyToAccount(signerPrivateKey);
const user = privateKeyToAccount(userPrivateKey);
const chain = defineChain({
  id: chainId,
  name: "Anvil Settlement Indexer E2E",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});
const publicClient = createPublicClient({ chain, cacheTime: 0, transport: http(rpcUrl) });
const signerClient = createWalletClient({ account: signer, chain, transport: http(rpcUrl) });
const userClient = createWalletClient({ account: user, chain, transport: http(rpcUrl) });

const tokenArtifact = await loadArtifact("contracts/out/LocalE2EToken.s.sol/LocalE2EToken.json");
const settlementArtifact = await loadArtifact("contracts/out/RFQSettlement.sol/RFQSettlement.json");
const factoryArtifact = await loadArtifact("contracts/out/Deploy.s.sol/RFQDeploymentFactory.json");
const tokenIn = await deployContract(signerClient, tokenArtifact, ["Indexer Input", "IXIN"]);
const tokenOut = await deployContract(signerClient, tokenArtifact, ["Indexer Output", "IXOUT"]);
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
const deploymentBlock = Number(deploymentReceipt.blockNumber);
assert.match(settlement, /^0x[0-9a-f]{40}$/i);
assert.match(treasury, /^0x[0-9a-f]{40}$/i);
assert.equal(await publicClient.readContract({
  address: settlement,
  abi: settlementArtifact.abi,
  functionName: "treasury",
}), treasury);

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
  args: [settlement, amountIn * 2n],
});

configureBackendRuntime({ tokenIn, tokenOut, settlement });
const pool = getPool();
const quoteIds = [];
const runId = `${Date.now()}_${process.pid}`;
const idempotencyKeys = [
  `quote_indexer_e2e_callback_${runId}`,
  `quote_indexer_e2e_wallet_only_${runId}`,
];
const tokenRegistry = new ConfiguredTokenRegistry({
  tokens: [
    {
      chainId,
      tokenAddress: tokenIn,
      symbol: "IXIN",
      decimals: 18,
      isWhitelisted: true,
      riskTier: "low",
      usdReference: false,
    },
    {
      chainId,
      tokenAddress: tokenOut,
      symbol: "IXOUT",
      decimals: 18,
      isWhitelisted: true,
      riskTier: "low",
      usdReference: true,
    },
  ],
});
const inventory = new PostgresInventoryService(pool);
const settlementEvents = new PostgresSettlementEventStore(pool, inventory);
const quoteRepository = new PostgresQuoteRepository(pool);
const indexerStore = new PostgresSettlementIndexerStore(pool);
const indexerObserver = createIndexerObserver();
const indexerWorkerId = `indexer_e2e_${Date.now()}`;
const indexerWorker = new SettlementIndexerWorker(
  [{
    chainId,
    rpcUrl,
    settlementAddress: settlement,
    startBlock: deploymentBlock,
    confirmations: 1,
    maxBlockRange: 100,
    reorgLookbackBlocks: 100,
    requestTimeoutMs: 10_000,
  }],
  indexerStore,
  quoteRepository,
  settlementEvents,
  {
    workerId: indexerWorkerId,
    leaseMs: 30_000,
    pollIntervalMs: 10,
    readinessStaleMs: 60_000,
  },
  indexerObserver,
  { error() {} },
);
const marketSnapshots = new PostgresMarketSnapshotStore(pool);
const hedgeService = new PostgresHedgeService(pool);
const pnlService = new PostgresPnlStore(
  pool,
  new QuoteSnapshotPnlValuationProvider(marketSnapshots, tokenRegistry),
);
const reconciliationStore = new PostgresPostTradeReconciliationStore(pool);
const reconciliationWorker = new PostTradeReconciliationWorker(
  reconciliationStore,
  new ReconciliationService(
    {
      quoteRepository,
      settlementEventService: settlementEvents,
      hedgeService,
      pnlService,
    },
    new DeltaNeutralHedgePlanner(tokenRegistry),
  ),
  {
    workerId: `reconciliation_e2e_${Date.now()}`,
    leaseMs: 30_000,
    pollIntervalMs: 10,
    retryDelayMs: 100,
  },
  new PostTradeReconciliationMetrics(),
  { error() {} },
);
const hedgeRuntime = readHedgeWorkerRuntimeConfig();
const symbolRules = new BinanceSymbolRulesService(hedgeRuntime.symbolRules, hedgeRuntime.routes);
const binance = new BinanceSpotAdapter(hedgeRuntime.binance, symbolRules);
const hedgeAdapters = new Map([["binance", binance]]);
const hedgeWorker = new HedgeWorker(
  new PostgresHedgeJobStore(pool),
  hedgeRuntime.routes,
  hedgeAdapters,
  hedgeRuntime.worker,
  { info() {}, error() {} },
);
const feeWorker = new HedgeFeeWorker(
  new PostgresHedgeFeeStore(pool),
  hedgeRuntime.routes,
  hedgeAdapters,
  hedgeRuntime.worker,
  { info() {}, error() {} },
);
let server;
let ownsIndexerCursor = false;

try {
  await assertRequiredMigrations();
  await assertFixtureIsolation();
  ownsIndexerCursor = true;
  await settlementEvents.initialize();
  await indexerWorker.checkDependencies();
  assert.equal(await indexerWorker.runChainOnce(chainId), true, "initial indexer scan must create a checkpoint");

  const { buildServer } = await import("../backend/dist/main.js");
  server = buildServer({ logger: false, databasePool: pool });
  await server.ready();

  const userTokenInBefore = await readBalance(tokenArtifact.abi, tokenIn, user.address);
  const userTokenOutBefore = await readBalance(tokenArtifact.abi, tokenOut, user.address);
  const treasuryTokenInBefore = await readBalance(tokenArtifact.abi, tokenIn, treasury);
  const treasuryTokenOutBefore = await readBalance(tokenArtifact.abi, tokenOut, treasury);

  const callbackQuote = await requestQuote(server, idempotencyKeys[0]);
  quoteIds.push(callbackQuote.quoteId);
  const callbackReceipt = await broadcastQuote(callbackQuote);
  const callbackSubmit = await injectJson(server, "POST", "/submit", {
    quote: callbackQuote.quote,
    signature: callbackQuote.signature,
    txHash: callbackReceipt.transactionHash,
  });
  assert.equal(callbackSubmit.statusCode, 202, JSON.stringify(callbackSubmit.body));
  assert.equal(callbackSubmit.body.status, "accepted");

  await mineBlocks(1);
  const duplicateBefore = indexerObserver.events.duplicate;
  assert.equal(await indexerWorker.runChainOnce(chainId), true);
  assert.equal(
    indexerObserver.events.duplicate,
    duplicateBefore + 1,
    "indexer must converge with the event already applied through /submit",
  );
  await processReconciliationRevision(callbackQuote.quoteId);
  const callbackStatus = await quoteRepository.findStatus(callbackQuote.quoteId);
  assert.equal(callbackStatus?.status, "settled");
  assert.ok(callbackStatus?.hedgeOrderId);
  assert.equal((await inventory.getPosition(chainId, tokenIn)).balance, amountIn);
  const queued = await pool.query(
    `SELECT hedge.status, hedge.next_attempt_at <= now() AS due,
            hedge.lease_owner IS NULL AS unleased, settlement.canonical,
            hedge.submission_attempted_at IS NOT NULL AS submission_attempted
     FROM hedge_orders AS hedge
     INNER JOIN settlement_events AS settlement ON settlement.id = hedge.settlement_event_id
     WHERE hedge.id = $1`,
    [callbackStatus.hedgeOrderId],
  );
  assert.deepEqual(queued.rows, [{
    status: "queued",
    due: true,
    unleased: true,
    canonical: true,
    submission_attempted: false,
  }]);

  await symbolRules.checkHealth();
  assert.deepEqual(await hedgeWorker.runOnce(), {
    status: "filled",
    hedgeOrderId: callbackStatus.hedgeOrderId,
  });
  assert.equal(
    (await inventory.getPosition(chainId, tokenIn)).balance,
    0n,
    "canonical settlement base exposure must be neutral after the Binance fill",
  );
  assert.deepEqual(await feeWorker.runOnce(), {
    status: "reconciled",
    hedgeOrderId: callbackStatus.hedgeOrderId,
  });
  assert.deepEqual(await hedgeWorker.runOnce(), { status: "idle" });
  assert.deepEqual(await feeWorker.runOnce(), { status: "idle" });

  const callbackHedge = await hedgeService.getHedgeIntent(callbackStatus.hedgeOrderId);
  assert.equal(callbackHedge?.status, "filled");
  assert.equal(callbackHedge?.venue, "binance");
  assert.equal(callbackHedge?.venueSymbol, "BTCUSDT");
  assert.equal(callbackHedge?.filledAmount, amountIn.toString());
  assert.equal(callbackHedge?.executionEvidenceVersion, "base-and-quote-v2");
  assert.equal(callbackHedge?.feeReconciliationStatus, "complete");
  assert.equal(callbackHedge?.commissionTotals?.length, 1);
  assert.equal(callbackHedge?.commissionTotals?.[0]?.asset, "USDT");

  const callbackExecution = await pool.query(
    `SELECT execution_order_type, execution_time_in_force, execution_limit_price::text,
            execution_policy_version, executed_quote_quantity::text,
            hedge_commission_quote_quantity::text, hedge_net_pnl_quote_quantity::text,
            hedge_net_pnl_status, fee_reconciliation_status
     FROM hedge_orders WHERE id = $1`,
    [callbackStatus.hedgeOrderId],
  );
  assert.equal(callbackExecution.rows.length, 1);
  const execution = callbackExecution.rows[0];
  const executedQuoteScaled = decimalToScaled(execution.executed_quote_quantity, 18);
  const commissionScaled = decimalToScaled(execution.hedge_commission_quote_quantity, 18);
  const expectedCommissionScaled = executedQuoteScaled / 1_000n;
  const expectedNetPnlScaled = executedQuoteScaled - BigInt(callbackQuote.quote.amountOut) - expectedCommissionScaled;
  assert.deepEqual({
    orderType: execution.execution_order_type,
    timeInForce: execution.execution_time_in_force,
    policy: execution.execution_policy_version,
    feeStatus: execution.fee_reconciliation_status,
    pnlStatus: execution.hedge_net_pnl_status,
    commission: commissionScaled,
    netPnl: decimalToScaled(execution.hedge_net_pnl_quote_quantity, 18, true),
  }, {
    orderType: "LIMIT",
    timeInForce: "GTC",
    policy: "bounded-limit-v1",
    feeStatus: "complete",
    pnlStatus: "complete",
    commission: expectedCommissionScaled,
    netPnl: expectedNetPnlScaled,
  });
  assert.equal(
    executedQuoteScaled,
    decimalToScaled(execution.execution_limit_price, 18) * 10n,
    "fixture fill quote quantity must equal the submitted limit price times exact base quantity",
  );

  const callbackPnl = await injectJson(server, "GET", "/pnl");
  assert.equal(callbackPnl.statusCode, 200);
  assert.equal(callbackPnl.body.hedgeNet.completeTrades, 1);
  assert.equal(callbackPnl.body.hedgeNet.totals.length, 1);
  assert.equal(
    decimalToScaled(callbackPnl.body.hedgeNet.totals[0].netPnlQuoteQuantity, 18, true),
    expectedNetPnlScaled,
  );

  const reorgSnapshotId = await rpc("evm_snapshot", []);
  assert.match(reorgSnapshotId, /^0x[0-9a-f]+$/i);

  const walletOnlyQuote = await requestQuote(server, idempotencyKeys[1]);
  quoteIds.push(walletOnlyQuote.quoteId);
  const walletOnlyReceipt = await broadcastQuote(walletOnlyQuote);
  const signedBeforeIndexing = await injectJson(
    server,
    "GET",
    `/quote/${encodeURIComponent(walletOnlyQuote.quoteId)}`,
  );
  assert.equal(signedBeforeIndexing.statusCode, 200);
  assert.equal(signedBeforeIndexing.body.status, "signed");

  await mineBlocks(1);
  const appliedBefore = indexerObserver.events.applied;
  assert.equal(await indexerWorker.runChainOnce(chainId), true);
  assert.equal(
    indexerObserver.events.applied,
    appliedBefore + 1,
    "wallet-only settlement must be discovered without /submit",
  );
  await processReconciliationRevision(walletOnlyQuote.quoteId);

  const indexedStatus = await quoteRepository.findStatus(walletOnlyQuote.quoteId);
  assert.equal(indexedStatus?.status, "settled");
  assert.equal(indexedStatus?.txHash, walletOnlyReceipt.transactionHash.toLowerCase());
  assert.ok(indexedStatus?.settlementEventId);
  assert.ok(indexedStatus?.hedgeOrderId);
  assert.ok(indexedStatus?.pnlId);
  const indexedSettlementId = indexedStatus.settlementEventId;
  const indexedHedgeId = indexedStatus.hedgeOrderId;
  const indexedPnlId = indexedStatus.pnlId;

  const indexedSettlement = await injectJson(
    server,
    "GET",
    `/settlements/${encodeURIComponent(indexedSettlementId)}`,
  );
  const indexedHedge = await injectJson(
    server,
    "GET",
    `/hedges/${encodeURIComponent(indexedHedgeId)}`,
  );
  const indexedPnl = await injectJson(server, "GET", "/pnl");
  assert.equal(indexedSettlement.statusCode, 200);
  assert.equal(indexedSettlement.body.txHash, walletOnlyReceipt.transactionHash.toLowerCase());
  assert.equal(indexedHedge.statusCode, 200);
  assert.equal(indexedHedge.body.quoteId, walletOnlyQuote.quoteId);
  assert.ok(indexedPnl.body.trades.some((trade) => trade.pnlId === indexedPnlId));

  const callbackAmountOut = BigInt(callbackQuote.quote.amountOut);
  const walletOnlyAmountOut = BigInt(walletOnlyQuote.quote.amountOut);
  assert.equal((await inventory.getPosition(chainId, tokenIn)).balance, amountIn);
  assert.equal(
    (await inventory.getPosition(chainId, tokenOut)).balance,
    -(callbackAmountOut + walletOnlyAmountOut),
  );
  assert.equal(await readBalance(tokenArtifact.abi, tokenIn, user.address), userTokenInBefore - amountIn * 2n);
  assert.equal(
    await readBalance(tokenArtifact.abi, tokenOut, user.address),
    userTokenOutBefore + callbackAmountOut + walletOnlyAmountOut,
  );

  assert.equal(await rpc("evm_revert", [reorgSnapshotId]), true);
  await mineBlocks(2);
  const reorgsBefore = indexerObserver.reorgs.length;
  assert.equal(await indexerWorker.runChainOnce(chainId), true, "indexer must roll back the orphan checkpoint");
  assert.equal(indexerObserver.reorgs.length, reorgsBefore + 1);
  assert.equal(indexerObserver.reorgs.at(-1).removedEvents, 1);
  await processReconciliationRevision(walletOnlyQuote.quoteId);

  const rolledBackStatus = await quoteRepository.findStatus(walletOnlyQuote.quoteId);
  assert.equal(rolledBackStatus?.status, "signed");
  assert.equal(rolledBackStatus?.txHash, undefined);
  assert.equal(rolledBackStatus?.settlementEventId, undefined);
  assert.equal(await hedgeService.getHedgeIntent(indexedHedgeId), undefined);
  assert.equal(await pnlService.getPnlRecordByQuoteId(walletOnlyQuote.quoteId), undefined);
  assert.equal((await inventory.getPosition(chainId, tokenIn)).balance, 0n);
  assert.equal((await inventory.getPosition(chainId, tokenOut)).balance, -callbackAmountOut);
  assert.equal(await readBalance(tokenArtifact.abi, tokenIn, user.address), userTokenInBefore - amountIn);
  assert.equal(await readBalance(tokenArtifact.abi, tokenOut, user.address), userTokenOutBefore + callbackAmountOut);
  assert.equal(await readBalance(tokenArtifact.abi, tokenIn, treasury), treasuryTokenInBefore + amountIn);
  assert.equal(await readBalance(tokenArtifact.abi, tokenOut, treasury), treasuryTokenOutBefore - callbackAmountOut);
  assert.equal(await publicClient.readContract({
    address: settlement,
    abi: settlementArtifact.abi,
    functionName: "usedNonces",
    args: [user.address, BigInt(walletOnlyQuote.quote.nonce)],
  }), false);

  const orphaned = await pool.query(
    "SELECT canonical FROM settlement_events WHERE id = $1",
    [indexedSettlementId],
  );
  assert.equal(orphaned.rows.length, 1);
  assert.equal(orphaned.rows[0].canonical, false);
  assert.equal((await hedgeService.getHedgeIntent(callbackStatus.hedgeOrderId))?.status, "filled");
  const finalPnl = await injectJson(server, "GET", "/pnl");
  assert.equal(finalPnl.body.hedgeNet.completeTrades, 1);
  assert.equal(
    decimalToScaled(finalPnl.body.hedgeNet.totals[0].netPnlQuoteQuantity, 18, true),
    expectedNetPnlScaled,
  );
  assert.equal(await indexerWorker.runChainOnce(chainId), true, "indexer must advance over the replacement range");
  const cursor = (await indexerStore.stats()).find((item) => item.chainId === chainId);
  assert.ok(cursor && cursor.nextBlock > Number(walletOnlyReceipt.blockNumber));

  process.stdout.write(`${JSON.stringify({
    status: "ok",
    chainId,
    callbackConvergence: {
      quoteId: callbackQuote.quoteId,
      txHash: callbackReceipt.transactionHash,
      indexerOutcome: "duplicate",
      hedgeOrderId: callbackStatus.hedgeOrderId,
      hedgeExecution: "filled",
      feeReconciliation: "complete",
      hedgeNetPnlQuoteQuantity: formatScaled(expectedNetPnlScaled, 18),
    },
    walletRecovery: {
      quoteId: walletOnlyQuote.quoteId,
      txHash: walletOnlyReceipt.transactionHash,
      indexerOutcome: "applied",
      reconciliation: "settled",
    },
    reorgRecovery: {
      orphanedSettlementEventId: indexedSettlementId,
      removedEvents: 1,
      restoredQuoteStatus: "signed",
      replacementCursorNextBlock: cursor.nextBlock,
    },
  }, null, 2)}\n`);
} finally {
  try {
    if (server) await server.close();
  } finally {
    try {
      await indexerStore.releaseCursor(chainId, indexerWorkerId);
      await cleanup();
    } finally {
      await endPool();
    }
  }
}

async function requestQuote(serverInstance, idempotencyKey) {
  const request = {
    chainId,
    user: user.address,
    tokenIn,
    tokenOut,
    amountIn: amountIn.toString(),
    slippageBps: 50,
  };
  const response = await injectJson(serverInstance, "POST", "/quote", request, {
    "idempotency-key": idempotencyKey,
  });
  assert.equal(response.statusCode, 200, JSON.stringify(response.body));
  assert.match(response.body.signature, /^0x[0-9a-f]{130}$/i);
  return {
    quoteId: response.body.quoteId,
    signature: response.body.signature,
    quote: {
      user: request.user,
      tokenIn: request.tokenIn,
      tokenOut: request.tokenOut,
      amountIn: request.amountIn,
      amountOut: response.body.amountOut,
      minAmountOut: response.body.minAmountOut,
      nonce: response.body.nonce,
      deadline: response.body.deadline,
      chainId,
    },
  };
}

async function broadcastQuote(record) {
  const transactionHash = await userClient.writeContract({
    address: settlement,
    abi: settlementArtifact.abi,
    functionName: "submitQuote",
    args: [{
      ...record.quote,
      amountIn: BigInt(record.quote.amountIn),
      amountOut: BigInt(record.quote.amountOut),
      minAmountOut: BigInt(record.quote.minAmountOut),
      nonce: BigInt(record.quote.nonce),
      deadline: BigInt(record.quote.deadline),
      chainId: BigInt(record.quote.chainId),
    }, record.signature],
  });
  const receipt = await waitForSuccess(transactionHash);
  return { transactionHash, blockNumber: receipt.blockNumber };
}

async function processReconciliationRevision(quoteId) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await pool.query(
      `SELECT desired_revision::text, processed_revision::text
       FROM post_trade_reconciliation_jobs WHERE quote_id = $1`,
      [quoteId],
    );
    if (result.rows.length === 1 &&
        result.rows[0].desired_revision === result.rows[0].processed_revision) {
      return;
    }
    if (!await reconciliationWorker.runOnce()) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  const result = await pool.query(
    `SELECT desired_revision::text, processed_revision::text, last_error_code
     FROM post_trade_reconciliation_jobs WHERE quote_id = $1`,
    [quoteId],
  );
  assert.fail(`reconciliation job ${quoteId} did not converge: ${JSON.stringify(result.rows[0] ?? null)}`);
}

function createIndexerObserver() {
  return {
    cursors: [],
    events: { applied: 0, duplicate: 0 },
    ranges: 0,
    reorgs: [],
    errors: [],
    recordCursor(observedChainId, nextBlock, safeHead) {
      this.cursors.push({ chainId: observedChainId, nextBlock, safeHead });
    },
    recordEvent(_observedChainId, outcome) {
      this.events[outcome] += 1;
    },
    recordRange() {
      this.ranges += 1;
    },
    recordReorg(observedChainId, depth, removedEvents) {
      this.reorgs.push({ chainId: observedChainId, depth, removedEvents });
    },
    recordError(observedChainId, code) {
      this.errors.push({ chainId: observedChainId, code });
    },
  };
}

async function assertRequiredMigrations() {
  const migrations = await pool.query("SELECT version FROM _migrations ORDER BY version");
  const applied = new Set(migrations.rows.map((row) => row.version));
  for (const version of ["005", "006", "007", "017", "021", "023"]) {
    assert.equal(applied.has(version), true, `migration ${version} must be applied`);
  }
}

async function assertFixtureIsolation() {
  const cursor = await pool.query(
    "SELECT settlement_address FROM settlement_indexer_cursors WHERE chain_id = $1",
    [chainId],
  );
  assert.equal(
    cursor.rows.length,
    0,
    `chain ${chainId} already has a settlement indexer cursor; use a disposable database`,
  );
  const due = await pool.query(
    `SELECT
       (SELECT COUNT(*)::text FROM post_trade_reconciliation_jobs
        WHERE processed_revision < desired_revision AND next_attempt_at <= now()) AS reconciliation_jobs,
       (SELECT COUNT(*)::text FROM hedge_orders
        WHERE status = 'queued' AND next_attempt_at <= now()
          AND (lease_expires_at IS NULL OR lease_expires_at <= now())) AS hedge_jobs,
       (SELECT COUNT(*)::text FROM hedge_orders
        WHERE fee_reconciliation_status = 'pending' AND fee_next_attempt_at <= now()
          AND (fee_lease_expires_at IS NULL OR fee_lease_expires_at <= now())) AS fee_jobs`,
  );
  assert.deepEqual(due.rows[0], {
    reconciliation_jobs: "0",
    hedge_jobs: "0",
    fee_jobs: "0",
  }, "settlement indexer E2E requires a database without unrelated due worker jobs");
}

async function cleanup() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const snapshotRows = await client.query(
      `SELECT id FROM market_snapshots
       WHERE chain_id = $1 AND lower(token_in) = $2 AND lower(token_out) = $3`,
      [chainId, tokenIn.toLowerCase(), tokenOut.toLowerCase()],
    );
    const inventoryRows = await client.query(
      "SELECT id FROM inventory_positions WHERE chain_id = $1 AND lower(token_address) = ANY($2::text[])",
      [chainId, [tokenIn.toLowerCase(), tokenOut.toLowerCase()]],
    );
    const settlementRows = await client.query(
      "SELECT id FROM settlement_events WHERE quote_id = ANY($1::text[])",
      [quoteIds],
    );
    const hedgeRows = await client.query(
      "SELECT id FROM hedge_orders WHERE quote_id = ANY($1::text[])",
      [quoteIds],
    );
    const pnlRows = await client.query(
      "SELECT id FROM pnl_records WHERE quote_id = ANY($1::text[])",
      [quoteIds],
    );
    const riskRows = await client.query(
      "SELECT id FROM risk_decisions WHERE quote_id = ANY($1::text[])",
      [quoteIds],
    );
    const aggregateIds = [
      ...quoteIds,
      ...snapshotRows.rows.map((row) => row.id),
      ...inventoryRows.rows.map((row) => row.id),
      ...settlementRows.rows.map((row) => row.id),
      ...hedgeRows.rows.map((row) => row.id),
      ...pnlRows.rows.map((row) => row.id),
      ...riskRows.rows.map((row) => row.id),
    ];
    await client.query(
      `DELETE FROM analytics_outbox
       WHERE aggregate_id = ANY($1::text[]) OR payload->>'quoteId' = ANY($2::text[])`,
      [aggregateIds, quoteIds],
    );
    await client.query(
      "DELETE FROM hedge_execution_fills WHERE hedge_order_id IN (SELECT id FROM hedge_orders WHERE quote_id = ANY($1::text[]))",
      [quoteIds],
    );
    await client.query(
      `UPDATE quotes SET status = CASE WHEN signature IS NULL THEN 'requested' ELSE 'signed' END,
         tx_hash = NULL, settlement_event_id = NULL, hedge_order_id = NULL, pnl_id = NULL,
         updated_at = now()
       WHERE id = ANY($1::text[])`,
      [quoteIds],
    );
    await client.query("DELETE FROM post_trade_reconciliation_jobs WHERE quote_id = ANY($1::text[])", [quoteIds]);
    await client.query("DELETE FROM hedge_orders WHERE quote_id = ANY($1::text[])", [quoteIds]);
    await client.query("DELETE FROM pnl_records WHERE quote_id = ANY($1::text[])", [quoteIds]);
    await client.query("DELETE FROM settlement_events WHERE quote_id = ANY($1::text[])", [quoteIds]);
    await client.query("DELETE FROM quote_submit_reservations WHERE quote_id = ANY($1::text[])", [quoteIds]);
    await client.query("DELETE FROM quote_exposure_reservations WHERE quote_id = ANY($1::text[])", [quoteIds]);
    await client.query("DELETE FROM signer_audit_events WHERE quote_id = ANY($1::text[])", [quoteIds]);
    await client.query("DELETE FROM risk_decisions WHERE quote_id = ANY($1::text[])", [quoteIds]);
    await client.query(
      "DELETE FROM quote_idempotency_requests WHERE quote_id = ANY($1::text[]) OR idempotency_key = ANY($2::text[])",
      [quoteIds, idempotencyKeys],
    );
    await client.query("DELETE FROM quotes WHERE id = ANY($1::text[])", [quoteIds]);
    await client.query(
      `DELETE FROM market_snapshots
       WHERE chain_id = $1 AND lower(token_in) = $2 AND lower(token_out) = $3`,
      [chainId, tokenIn.toLowerCase(), tokenOut.toLowerCase()],
    );
    await client.query(
      "DELETE FROM inventory_positions WHERE chain_id = $1 AND lower(token_address) = ANY($2::text[])",
      [chainId, [tokenIn.toLowerCase(), tokenOut.toLowerCase()]],
    );
    if (ownsIndexerCursor) {
      await client.query("DELETE FROM settlement_indexer_cursors WHERE chain_id = $1", [chainId]);
    }
    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
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

async function readBalance(abi, token, account) {
  return publicClient.readContract({ address: token, abi, functionName: "balanceOf", args: [account] });
}

async function mineBlocks(count) {
  assert.equal(Number.isSafeInteger(count) && count > 0, true);
  await rpc("anvil_mine", [`0x${count.toString(16)}`]);
}

async function rpc(method, params) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  assert.equal(response.ok, true, `${method} HTTP request must succeed`);
  const payload = await response.json();
  assert.equal(payload.error, undefined, `${method} RPC must succeed: ${JSON.stringify(payload.error)}`);
  return payload.result;
}

async function injectJson(serverInstance, method, url, payload, headers = {}) {
  const response = await serverInstance.inject({
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

function configureBackendRuntime({ tokenIn: inputToken, tokenOut: outputToken, settlement: settlementAddress }) {
  for (const name of [
    "DB_HOST",
    "DB_PORT",
    "DB_NAME",
    "DB_USER",
    "DB_PASSWORD",
    "RFQ_API_KEY_CONFIG_JSON",
    "RFQ_API_KEYS_JSON",
    "RFQ_CEX_PAIRS",
    "RFQ_CHAINLINK_CONFIG_JSON",
    "RFQ_HEDGE_ROUTES_JSON",
    "RFQ_REDIS_URL",
    "RFQ_TRUSTED_SIGNER_OVERLAP_ADDRESSES",
  ]) delete process.env[name];

  process.env.NODE_ENV = "test";
  process.env.RFQ_MARKET_DATA_PROVIDER = "static";
  process.env.RFQ_MARKET_PAIRS = `${chainId}:${inputToken}:${outputToken}`;
  process.env.RFQ_SIGNER_MODE = "local";
  process.env.RFQ_SIGNER_PRIVATE_KEY = signerPrivateKey;
  process.env.RFQ_TRUSTED_SIGNER_ADDRESS = signer.address;
  process.env.RFQ_SETTLEMENT_ADDRESS = settlementAddress;
  process.env.RFQ_ALLOW_SIMULATED_SETTLEMENT = "false";
  process.env.RFQ_QUOTE_TTL_SECONDS = "300";
  process.env.RFQ_QUOTE_IDEMPOTENCY_LEASE_MS = "360000";
  process.env.RFQ_SETTLEMENT_INDEXER_MAX_CURSOR_AGE_MS = "600000";
  process.env.RFQ_SETTLEMENT_INDEXER_MAX_BLOCK_LAG = "0";
  process.env.RFQ_HEDGE_ROUTES_JSON = JSON.stringify({
    routes: [{
      chainId,
      token: inputToken,
      venue: "binance",
      symbol: "BTCUSDT",
      baseAsset: "BTC",
      quoteAsset: "USDT",
      quoteToken: outputToken,
      tokenDecimals: 18,
      quoteTokenDecimals: 18,
      stepSizeRaw: "1000000000000000",
      priceTick: "0.01",
      maxSlippageBps: 100,
    }],
  });
  process.env.RFQ_BINANCE_API_KEY = "testnet-api-key";
  process.env.RFQ_BINANCE_API_SECRET = "testnet-api-secret";
  process.env.RFQ_BINANCE_BASE_URL = "https://testnet.binance.vision";
  process.env.RFQ_BINANCE_REQUEST_TIMEOUT_MS = "1000";
  process.env.RFQ_BINANCE_SYMBOL_RULES_MAX_AGE_MS = "10000";
  process.env.RFQ_HEDGE_WORKER_ID = `hedge_indexer_e2e_${process.pid}`;
  process.env.RFQ_HEDGE_LEASE_MS = "6000";
  process.env.RFQ_HEDGE_POLL_INTERVAL_MS = "10";
  process.env.RFQ_HEDGE_RETRY_DELAY_MS = "10";
  process.env.RFQ_HEDGE_MAX_ORDER_AGE_MS = "30000";
  process.env.RFQ_RECEIPT_CONFIG_JSON = JSON.stringify({
    chains: [{
      chainId,
      rpcUrl,
      settlementAddress,
      confirmations: 1,
      receiptTimeoutMs: 30_000,
    }],
  });
  process.env.RFQ_TOKEN_REGISTRY_JSON = JSON.stringify({
    tokens: [
      {
        chainId,
        tokenAddress: inputToken,
        symbol: "IXIN",
        decimals: 18,
        isWhitelisted: true,
        riskTier: "low",
        usdReference: false,
      },
      {
        chainId,
        tokenAddress: outputToken,
        symbol: "IXOUT",
        decimals: 18,
        isWhitelisted: true,
        riskTier: "low",
        usdReference: true,
      },
    ],
  });
  process.env.RFQ_RISK_POLICY_JSON = JSON.stringify({
    policyVersion: "anvil-indexer-e2e-v1",
    enabledChainIds: [chainId],
    tokenLimits: [inputToken, outputToken].map((tokenAddress) => ({
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
      valuationPairs: [{
        chainId,
        tokenAddress: inputToken,
        usdReferenceTokenAddress: outputToken,
      }],
    },
    portfolioDelta: {
      modelVersion: "gross-net-asset-delta-v2",
      softGrossLimitUsd: "500000",
      hardGrossLimitUsd: "1000000",
      softNetLimitUsd: "250000",
      hardNetLimitUsd: "500000",
      assetLimits: [{
        chainId,
        tokenAddress: inputToken,
        softLimitUsd: "250000",
        hardLimitUsd: "500000",
      }],
    },
    gammaGuardrail: {
      modelVersion: "piecewise-convexity-v1",
      elevatedInventoryUtilizationBps: 6_000,
      criticalInventoryUtilizationBps: 8_500,
      largeTradeUtilizationBps: 2_500,
      blockTradeUtilizationBps: 7_000,
      elevatedVolatilityUtilizationBps: 5_000,
      extremeVolatilityUtilizationBps: 8_000,
      maxRiskMultiplierBps: 20_000,
    },
    minLiquidityUsd: "1000000",
    maxVolatilityBps: 500,
    maxSlippageBps: 500,
    maxQuotedSpreadBps: 1_000,
  });
}

function decimalToScaled(value, scale, allowNegative = false) {
  assert.equal(typeof value, "string", "decimal evidence must be a string");
  assert.equal(Number.isSafeInteger(scale) && scale >= 0 && scale <= 36, true);
  const pattern = allowNegative
    ? /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?$/
    : /^()(0|[1-9][0-9]*)(?:\.([0-9]+))?$/;
  const match = value.match(pattern);
  assert.ok(match && (match[3]?.length ?? 0) <= scale, `invalid decimal evidence ${value}`);
  const fraction = match[3] ?? "";
  const magnitude = BigInt(match[2]) * 10n ** BigInt(scale) +
    BigInt(`${fraction}${"0".repeat(scale - fraction.length)}` || "0");
  return match[1] === "-" ? -magnitude : magnitude;
}

function formatScaled(value, scale) {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  if (scale === 0) return `${sign}${absolute}`;
  const raw = absolute.toString().padStart(scale + 1, "0");
  const fraction = raw.slice(-scale).replace(/0+$/, "");
  return `${sign}${raw.slice(0, -scale)}${fraction ? `.${fraction}` : ""}`;
}

function assertLoopbackDatabase(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("DATABASE_URL must be a valid URL");
  }
  assert.ok(
    parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost" || parsed.hostname === "::1",
    "settlement indexer E2E refuses a non-loopback PostgreSQL host",
  );
}

function parseChainId(value) {
  if (!/^[1-9][0-9]*$/.test(value)) throw new Error("RFQ_ANVIL_CHAIN_ID must be a positive decimal integer");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error("RFQ_ANVIL_CHAIN_ID must be a positive safe integer");
  return parsed;
}
