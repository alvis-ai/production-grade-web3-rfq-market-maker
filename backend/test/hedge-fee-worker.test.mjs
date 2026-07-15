import assert from "node:assert/strict";
import test from "node:test";
import { HedgeFeeWorker, HedgeFeeWorkerMetrics } from "../dist/modules/hedge/hedge-fee-worker.js";
import { HedgeRouteTable } from "../dist/modules/hedge/hedge-route.js";

const token = "0x0000000000000000000000000000000000000003";
const quoteToken = "0x0000000000000000000000000000000000000002";
const job = {
  hedgeOrderId: "h_11111111111111111111111111111111",
  chainId: 1,
  token,
  side: "buy",
  amount: "1250000000000000000",
  filledAmount: "1250000000000000000",
  executedQuoteQuantity: "3125.5",
  symbol: "ETHUSDT",
  clientOrderId: "rfq_11111111111111111111111111111111",
  venueOrderId: "100234",
  attemptCount: 1,
  createdAt: "2026-07-14T00:00:00.000Z",
};
const routes = new HedgeRouteTable([{
  chainId: 1,
  token,
  venue: "binance",
  symbol: "ETHUSDT",
  baseAsset: "ETH",
  quoteAsset: "USDT",
  quoteToken,
  tokenDecimals: 18,
  quoteTokenDecimals: 6,
  stepSizeRaw: "100000000000000",
}]);
const config = { workerId: "worker_1", leaseMs: 30000, pollIntervalMs: 10, retryDelayMs: 1000 };

test("HedgeFeeWorker reconciles exact account fills without delaying inventory execution", async () => {
  const store = fakeStore(job);
  const fills = tradeFills();
  const adapter = {
    async queryOrder() { return orderResult(); },
    async queryOrderTrades(input) {
      assert.deepEqual(input, { symbol: "ETHUSDT", venueOrderId: "100234" });
      return fills;
    },
    async submitMarketOrder() { throw new Error("unreachable"); },
  };
  const worker = new HedgeFeeWorker(store, routes, new Map([["binance", adapter]]), config, silentLogger);

  assert.deepEqual(await worker.runOnce(), { status: "reconciled", hedgeOrderId: job.hedgeOrderId });
  assert.equal(store.calls.completeReconciliation.length, 1);
  assert.deepEqual(store.calls.completeReconciliation[0].slice(0, 5), [
    job.hedgeOrderId,
    "worker_1",
    job.filledAmount,
    "100234",
    "3125.5",
  ]);
  assert.equal(store.calls.completeReconciliation[0][5], fills);
  assert.equal(store.calls.releaseForRetry.length, 0);
});

test("HedgeFeeWorker retries while myTrades lags cumulative order execution", async () => {
  const store = fakeStore(job);
  const adapter = {
    async queryOrder() { return orderResult(); },
    async queryOrderTrades() { return tradeFills().slice(0, 1); },
    async submitMarketOrder() { throw new Error("unreachable"); },
  };
  const worker = new HedgeFeeWorker(store, routes, new Map([["binance", adapter]]), config, silentLogger);

  assert.deepEqual(await worker.runOnce(), {
    status: "retry_scheduled",
    hedgeOrderId: job.hedgeOrderId,
    errorCode: "HEDGE_TRADE_FILLS_INCOMPLETE",
  });
  assert.equal(store.calls.completeReconciliation.length, 0);
  assert.equal(store.calls.releaseForRetry[0][3], 1000);
});

test("HedgeFeeWorker rejects a changed venue order identity and honors retry backoff", async () => {
  const store = fakeStore({ ...job, attemptCount: 20 });
  const adapter = {
    async queryOrder() { return { ...orderResult(), venueOrderId: "100235" }; },
    async queryOrderTrades() { throw new Error("unreachable"); },
    async submitMarketOrder() { throw new Error("unreachable"); },
  };
  const worker = new HedgeFeeWorker(store, routes, new Map([["binance", adapter]]), config, silentLogger);

  assert.equal((await worker.runOnce()).errorCode, "HEDGE_VENUE_RESPONSE_INVALID");
  assert.equal(store.calls.releaseForRetry[0][3], 60000);
});

test("HedgeFeeWorkerMetrics exposes outcomes and current reconciliation backlog", () => {
  const metrics = new HedgeFeeWorkerMetrics();
  metrics.recordResult({ status: "reconciled", hedgeOrderId: job.hedgeOrderId });
  metrics.recordResult({ status: "retry_scheduled", hedgeOrderId: job.hedgeOrderId, errorCode: "TEST" });
  metrics.recordIterationError();
  const output = metrics.renderPrometheus({
    pendingCount: 3,
    oldestDueAt: "2026-07-14T00:00:00.000Z",
  }, Date.parse("2026-07-14T00:01:00.000Z"));
  assert.match(output, /rfq_hedge_fee_reconciliations_total\{status="reconciled"\} 1/);
  assert.match(output, /rfq_hedge_fee_reconciliations_total\{status="retry_scheduled"\} 1/);
  assert.match(output, /rfq_hedge_fee_iteration_errors_total 1/);
  assert.match(output, /rfq_hedge_fee_pending 3/);
  assert.match(output, /rfq_hedge_fee_oldest_due_age_seconds 60/);
  assert.throws(() => metrics.renderPrometheus({ pendingCount: -1 }), /stats/);
  assert.throws(
    () => metrics.renderPrometheus({ pendingCount: 1, oldestDueAt: "2026-07-14" }),
    /oldestDueAt/,
  );
  assert.throws(() => metrics.renderPrometheus({ pendingCount: 0, oldestDueAt: job.createdAt }), /inconsistent/);
});

function orderResult() {
  return {
    state: "filled",
    externalOrderId: job.clientOrderId,
    venueOrderId: "100234",
    executedQuantity: "1.25",
    executedQuoteQuantity: "3125.5",
  };
}

function tradeFills() {
  return [{
    venueTradeId: "28457",
    venueOrderId: "100234",
    price: "2500",
    quantity: "0.5",
    quoteQuantity: "1250",
    commissionQuantity: "0.0001",
    commissionAsset: "BNB",
    executedAt: "2026-07-14T00:00:01.000Z",
    isBuyer: true,
    isMaker: false,
  }, {
    venueTradeId: "28458",
    venueOrderId: "100234",
    price: "2500.666666666666666667",
    quantity: "0.75",
    quoteQuantity: "1875.5",
    commissionQuantity: "1.8755",
    commissionAsset: "USDT",
    executedAt: "2026-07-14T00:00:02.000Z",
    isBuyer: true,
    isMaker: false,
  }];
}

function fakeStore(claimedJob) {
  const calls = { completeReconciliation: [], releaseForRetry: [] };
  return {
    calls,
    async checkHealth() {},
    async stats() { return { pendingCount: claimedJob ? 1 : 0, ...(claimedJob ? { oldestDueAt: claimedJob.createdAt } : {}) }; },
    async claimNext() { return claimedJob; },
    async completeReconciliation(...args) { calls.completeReconciliation.push(args); },
    async releaseForRetry(...args) { calls.releaseForRetry.push(args); },
  };
}

const silentLogger = { info() {}, error() {} };
