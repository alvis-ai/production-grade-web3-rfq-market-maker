#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const paths = {
  route: "backend/src/modules/hedge/hedge-route.ts",
  worker: "backend/src/modules/hedge/hedge-worker.ts",
  adapter: "backend/src/modules/hedge/binance-spot.adapter.ts",
  store: "backend/src/modules/hedge/postgres-hedge-job.store.ts",
  migration: "backend/src/db/migrations/014-hedge-execution-evidence.sql",
  boundedLimitMigration: "backend/src/db/migrations/025-bounded-hedge-limit.sql",
  expiryMigration: "backend/src/db/migrations/026-hedge-order-expiry.sql",
  feeWorker: "backend/src/modules/hedge/hedge-fee-worker.ts",
  feeStore: "backend/src/modules/hedge/postgres-hedge-fee.store.ts",
  feeMigration: "backend/src/db/migrations/015-hedge-fee-reconciliation.sql",
  runtime: "backend/src/hedge-worker-main.ts",
  adapterTest: "backend/test/binance-spot-adapter.test.mjs",
  routeTest: "backend/test/hedge-route.test.mjs",
  workerTest: "backend/test/hedge-worker.test.mjs",
  feeWorkerTest: "backend/test/hedge-fee-worker.test.mjs",
  feeStoreTest: "backend/test/postgres-hedge-fee-store.test.mjs",
  runtimeTest: "backend/test/hedge-worker-runtime.test.mjs",
  compose: "docker-compose.yml",
  k8sConfig: "infra/k8s/configmap.yaml",
  k8sDeployment: "infra/k8s/hedge-worker-deployment.yaml",
  helmDeployment: "infra/helm/rfq-market-maker/templates/hedge-worker-deployment.yaml",
  helmValues: "infra/helm/rfq-market-maker/values.yaml",
  readme: "README.md",
  hedgeBook: "book/Volume5-BackendEngineering/Chapter07-Hedge-Service.md",
  kubernetesBook: "book/Volume7-ProductionDeployment/Chapter02-Kubernetes.md",
  runbook: "book/Volume7-ProductionDeployment/Chapter05-Runbook.md",
};

const entries = await Promise.all(
  Object.entries(paths).map(async ([name, path]) => [name, await readFile(path, "utf8")]),
);
const source = Object.fromEntries(entries);

assert.match(source.route, /validateTokenRegistry\(registry: TokenRegistry\)/);
assert.match(source.route, /metadata\.decimals !== route\.tokenDecimals/);
assert.match(source.route, /export function quantizeHedgeAmount/);
assert.match(source.route, /quantized\.toString\(\) as UIntString/);
assert.match(source.worker, /const targetAmount = quantizeHedgeAmount\(job\.amount, route\)/);
assert.match(source.worker, /filledAmount === undefined \|\| filledAmount !== targetAmount/);
assert.match(source.worker, /completeFilled[\s\S]*filledAmount/);
assert.match(source.adapter, /cummulativeQuoteQty/);
assert.match(source.worker, /parseCexQuoteQuantity\(order\.executedQuoteQuantity\)/);
assert.match(source.worker, /if \(job\.submissionAttempted\)[\s\S]*scheduleRetry/);
assert.match(source.worker, /if \(!job\.submissionAttempted\) \{[\s\S]*prepareRoute/);
assert.match(source.worker, /calculateHedgeLimitPrice\(job\.side, job\.amount, job\.referenceAmount, route\)/);
assert.match(source.worker, /adapter\.submitLimitOrder/);
assert.match(source.adapter, /type: "LIMIT"/);
assert.match(source.adapter, /timeInForce: "GTC"/);
assert.match(source.adapter, /async cancelOrder/);
assert.match(source.adapter, /signedRequest\("DELETE", "\/api\/v3\/order"/);
assert.doesNotMatch(source.adapter, /type: "MARKET"/);
assert.match(source.store, /execution_policy_version = 'bounded-limit-v1'/);
assert.match(source.boundedLimitMigration, /chk_hedge_orders_execution_policy/);
assert.match(source.boundedLimitMigration, /mod\(execution_limit_price, execution_price_tick\) = 0/);
assert.match(source.expiryMigration, /execution_max_order_age_ms BETWEEN 1000 AND 3600000/);
assert.match(source.expiryMigration, /idx_hedge_orders_cancel_requested/);
assert.match(source.store, /async authorizeCancelIfDue/);
assert.match(source.store, /execution_max_order_age_ms \* interval '1 millisecond' <= now\(\)/);
assert.match(source.store, /cancel_requested_at = COALESCE\(cancel_requested_at, now\(\)\)/);
assert.match(source.worker, /adapter\.cancelOrder/);
assert.match(source.worker, /recordCancelAttempt/);
assert.match(source.store, /execution_evidence_version = 'base-and-quote-v2'/);
assert.match(source.store, /assertCumulativeExecutionEvidence/);
assert.match(source.migration, /execution_evidence_version/);
assert.match(source.migration, /executed_quote_quantity/);
assert.match(source.migration, /hedge\.lifecycle\.v2/);
assert.match(source.adapter, /\/api\/v3\/myTrades/);
assert.match(source.adapter, /orderId: input\.venueOrderId/);
assert.match(source.adapter, /fromId/);
assert.match(source.adapter, /hasVenueErrorCode\(response, -1021\)/);
assert.match(source.adapter, /\/api\/v3\/time/);
assert.match(source.adapter, /clockSyncPromise/);
assert.match(source.feeWorker, /sumCexTradeQuantity\(fills, "quantity"\)/);
assert.match(source.feeWorker, /sumCexTradeQuantity\(fills, "quoteQuantity"\)/);
assert.match(source.feeStore, /ON CONFLICT \(hedge_order_id, venue_trade_id\) DO UPDATE/);
assert.match(source.feeStore, /fee_reconciliation_status = 'complete'/);
assert.match(source.feeMigration, /CREATE TABLE hedge_execution_fills/);
assert.match(source.feeMigration, /hedge\.execution-fill\.v1/);
assert.match(source.feeMigration, /hedge\.lifecycle\.v3/);

assert.match(source.runtime, /readRequired\(env, "RFQ_TOKEN_REGISTRY_JSON"\)/);
assert.match(source.runtime, /routes\.validateTokenRegistry\(tokenRegistry\)/);
assert.match(source.runtime, /must exceed four RFQ_BINANCE_REQUEST_TIMEOUT_MS windows/);
assert.match(source.runtime, /RFQ_HEDGE_MAX_ORDER_AGE_MS/);
assert.match(source.adapterTest, /resynchronizes clock once and retries timestamp-rejected requests/);
assert.match(source.adapterTest, /single-flights concurrent clock synchronization/);
assert.match(source.adapterTest, /signs cancellation and preserves cumulative execution evidence/);
assert.match(source.routeTest, /binds route decimals to the shared token registry/);
assert.match(source.routeTest, /applies slippage and tick rounding conservatively/);
assert.match(source.workerTest, /requires FILLED cumulative quantity to equal the quantized target/);
assert.match(source.workerTest, /permits only sub-step dust between intent and a complete venue fill/);
assert.match(source.workerTest, /cancels an aged GTC order/);
assert.match(source.workerTest, /retries an ambiguous cancel/);
assert.match(source.feeWorkerTest, /retries while myTrades lags cumulative order execution/);
assert.match(source.feeStoreTest, /idempotently persists fills and completes reconciliation atomically/);
assert.match(source.runtimeTest, /RFQ_TOKEN_REGISTRY_JSON is required/);
assert.match(source.runtimeTest, /does not match token registry decimals/);

assert.match(source.compose, /hedge-worker:[\s\S]*RFQ_TOKEN_REGISTRY_JSON:[\s\S]*RFQ_HEDGE_ROUTES_JSON:/);
assert.match(source.compose, /hedge-worker:[\s\S]*RFQ_HEDGE_MAX_ORDER_AGE_MS:/);
assert.match(source.k8sConfig, /RFQ_TOKEN_REGISTRY_JSON:/);
assert.match(source.k8sConfig, /RFQ_HEDGE_ROUTES_JSON:/);
assert.match(source.k8sConfig, /RFQ_HEDGE_MAX_ORDER_AGE_MS:/);
assert.match(source.k8sDeployment, /configMapRef:[\s\S]*name: rfq-backend-config/);
assert.match(source.helmDeployment, /name: RFQ_TOKEN_REGISTRY_JSON/);
assert.match(source.helmDeployment, /env\.RFQ_TOKEN_REGISTRY_JSON is required for hedge route decimals/);
assert.match(source.helmDeployment, /name: RFQ_HEDGE_ROUTES_JSON/);
assert.match(source.helmDeployment, /index \.Values\.env "RFQ_HEDGE_ROUTES_JSON"/);
const helmSharedEnv = source.helmValues.match(/^env:\n([\s\S]*?)^signerSecret:/m)?.[1] ?? "";
const helmWorkerEnv = source.helmValues.match(/^hedgeWorker:\n[\s\S]*?^  env:\n([\s\S]*?)^  secret:/m)?.[1] ?? "";
assert.match(helmSharedEnv, /RFQ_HEDGE_ROUTES_JSON:/);
assert.match(helmWorkerEnv, /RFQ_HEDGE_MAX_ORDER_AGE_MS:/);
assert.doesNotMatch(helmWorkerEnv, /RFQ_HEDGE_ROUTES_JSON:/);

for (const [name, needle] of [
  ["readme", /quantized target/],
  ["readme", /base-and-quote-v2/],
  ["hedgeBook", /quantized target/],
  ["hedgeBook", /cummulativeQuoteQty/],
  ["kubernetesBook", /route decimals/],
  ["runbook", /registry\/route decimals mismatch/],
  ["readme", /commissionTotals/],
  ["hedgeBook", /commissionAsset/],
  ["runbook", /fee_reconciliation_status='pending'/],
  ["runbook", /BINANCE_TIME_SYNC_FAILED/],
  ["readme", /four configured request-timeout windows/],
  ["hedgeBook", /GET \/api\/v3\/time/],
  ["readme", /cancel_requested_at/],
  ["hedgeBook", /DELETE \/api\/v3\/order/],
  ["kubernetesBook", /Migration 026/],
  ["runbook", /rfq_hedge_worker_order_cancellations_total/],
]) {
  assert.match(source[name], needle, `${paths[name]} must document hedge quantity integrity`);
}

console.log("Hedge execution consistency check passed");
