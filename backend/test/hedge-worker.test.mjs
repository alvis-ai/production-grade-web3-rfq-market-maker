import assert from "node:assert/strict";
import test from "node:test";
import { CexVenueError } from "../dist/modules/hedge/binance-spot.adapter.js";
import { HedgeRouteTable } from "../dist/modules/hedge/hedge-route.js";
import { HedgeWorker, HedgeWorkerMetrics } from "../dist/modules/hedge/hedge-worker.js";

const token = "0x0000000000000000000000000000000000000003";
const job = {
  hedgeOrderId: "h_11111111111111111111111111111111",
  chainId: 1,
  token,
  side: "buy",
  amount: "1250000000000000000",
  attemptCount: 1,
  submissionAttempted: false,
  createdAt: "2026-07-11T00:00:00.000Z",
};
const routes = new HedgeRouteTable([{
  chainId: 1,
  token,
  venue: "binance",
  symbol: "ETHUSDT",
  tokenDecimals: 18,
  stepSizeRaw: "100000000000000",
}]);
const config = { workerId: "worker_1", leaseMs: 30000, pollIntervalMs: 10, retryDelayMs: 1000 };

test("HedgeWorker queries deterministic client id before submitting and completes an existing fill", async () => {
  const store = fakeStore(job);
  let submissions = 0;
  const adapter = {
    async queryOrder(input) {
      assert.match(input.clientOrderId, /^rfq_[a-f0-9]{32}$/);
      return {
        state: "filled",
        externalOrderId: input.clientOrderId,
        executedQuantity: "1.25",
        executedQuoteQuantity: "3125.5",
      };
    },
    async submitMarketOrder() { submissions += 1; throw new Error("must not submit"); },
  };
  const worker = new HedgeWorker(store, routes, new Map([["binance", adapter]]), config, silentLogger);

  assert.deepEqual(await worker.runOnce(), { status: "filled", hedgeOrderId: job.hedgeOrderId });
  assert.equal(submissions, 0);
  assert.equal(store.calls.prepareRoute.length, 1);
  assert.equal(store.calls.recordExternalOrderObserved.length, 1);
  assert.equal(store.calls.completeFilled[0][2], store.calls.prepareRoute[0][2].clientOrderId);
  assert.equal(store.calls.completeFilled[0][4], "3125.5");
});

test("HedgeWorker requires FILLED cumulative quantity to equal the quantized target", async () => {
  const store = fakeStore(job);
  const adapter = {
    async queryOrder(input) {
      return {
        state: "filled",
        externalOrderId: input.clientOrderId,
        executedQuantity: "0.5",
        executedQuoteQuantity: "1250",
      };
    },
    async submitMarketOrder() { throw new Error("must not submit"); },
  };
  const worker = new HedgeWorker(store, routes, new Map([["binance", adapter]]), config, silentLogger);

  assert.deepEqual(await worker.runOnce(), {
    status: "retry_scheduled",
    hedgeOrderId: job.hedgeOrderId,
    errorCode: "HEDGE_VENUE_RESPONSE_INVALID",
  });
  assert.equal(store.calls.completeFilled.length, 0);
  assert.equal(store.calls.releaseForRetry.length, 1);
});

test("HedgeWorker permits only sub-step dust between intent and a complete venue fill", async () => {
  const store = fakeStore({ ...job, amount: "1250090000000000000" });
  const adapter = {
    async queryOrder(input) {
      return {
        state: "filled",
        externalOrderId: input.clientOrderId,
        executedQuantity: "1.25",
        executedQuoteQuantity: "3125",
      };
    },
    async submitMarketOrder() { throw new Error("must not submit"); },
  };
  const worker = new HedgeWorker(store, routes, new Map([["binance", adapter]]), config, silentLogger);

  assert.equal((await worker.runOnce()).status, "filled");
  assert.equal(store.calls.completeFilled[0][3], "1250000000000000000");
});

test("HedgeWorker submits only after not-found and reschedules pending orders", async () => {
  const store = fakeStore(job);
  const adapter = {
    async queryOrder() { return undefined; },
    async submitMarketOrder(input) {
      assert.equal(input.quantity, "1.25");
      return {
        state: "pending",
        externalOrderId: input.clientOrderId,
        executedQuantity: "0.5",
        executedQuoteQuantity: "1250.25",
      };
    },
  };
  const worker = new HedgeWorker(store, routes, new Map([["binance", adapter]]), config, silentLogger);

  assert.deepEqual(await worker.runOnce(), {
    status: "retry_scheduled",
    hedgeOrderId: job.hedgeOrderId,
    errorCode: "HEDGE_ORDER_PENDING",
  });
  assert.deepEqual(store.calls.releaseForRetry[0].slice(0, 3), [job.hedgeOrderId, "worker_1", "HEDGE_ORDER_PENDING"]);
  assert.equal(store.calls.authorizeSubmission.length, 1);
  assert.equal(store.calls.recordExecutionProgress[0][3], "500000000000000000");
  assert.equal(store.calls.recordExecutionProgress[0][4], "1250.25");
});

test("HedgeWorker never marks ambiguous venue failures terminal", async () => {
  const adapter = {
    async queryOrder() { throw new CexVenueError("BINANCE_REQUEST_FAILED", true); },
    async submitMarketOrder() { throw new Error("unreachable"); },
  };
  const store = fakeStore({ ...job, attemptCount: 100 });
  const worker = new HedgeWorker(store, routes, new Map([["binance", adapter]]), config, silentLogger);
  assert.deepEqual(await worker.runOnce(), {
    status: "retry_scheduled",
    hedgeOrderId: job.hedgeOrderId,
    errorCode: "BINANCE_REQUEST_FAILED",
  });
  assert.equal(store.calls.completeFailed.length, 0);
  assert.equal(store.calls.releaseForRetry.length, 1);
});

test("HedgeWorker never resubmits an attempted order that is temporarily not found", async () => {
  const store = fakeStore({ ...job, submissionAttempted: true });
  let submissions = 0;
  const adapter = {
    async queryOrder() { return undefined; },
    async submitMarketOrder() { submissions += 1; throw new Error("must not resubmit"); },
  };
  const worker = new HedgeWorker(store, routes, new Map([["binance", adapter]]), config, silentLogger);

  assert.deepEqual(await worker.runOnce(), {
    status: "retry_scheduled",
    hedgeOrderId: job.hedgeOrderId,
    errorCode: "HEDGE_SUBMISSION_UNCONFIRMED",
  });
  assert.equal(submissions, 0);
  assert.equal(store.calls.authorizeSubmission.length, 0);
});

test("HedgeWorker honors venue Retry-After without changing terminal state", async () => {
  const store = fakeStore(job);
  const adapter = {
    async queryOrder() { throw new CexVenueError("BINANCE_CODE_1003", true, undefined, 7000); },
    async submitMarketOrder() { throw new Error("unreachable"); },
  };
  const worker = new HedgeWorker(store, routes, new Map([["binance", adapter]]), config, silentLogger);
  assert.equal((await worker.runOnce()).status, "retry_scheduled");
  assert.equal(store.calls.releaseForRetry[0][3], 7000);
});

test("HedgeWorker exponentially backs off repeated venue failures", async () => {
  const store = fakeStore({ ...job, attemptCount: 20 });
  const adapter = {
    async queryOrder() { throw new CexVenueError("BINANCE_HTTP_503", true); },
    async submitMarketOrder() { throw new Error("unreachable"); },
  };
  const worker = new HedgeWorker(store, routes, new Map([["binance", adapter]]), config, silentLogger);

  assert.equal((await worker.runOnce()).status, "retry_scheduled");
  assert.equal(store.calls.releaseForRetry[0][3], 60000);
});

test("HedgeWorker permanently fails unconfigured routes without venue calls", async () => {
  const store = fakeStore({ ...job, chainId: 2 });
  let venueCalls = 0;
  const adapter = {
    async queryOrder() { venueCalls += 1; },
    async submitMarketOrder() { venueCalls += 1; },
  };
  const worker = new HedgeWorker(store, routes, new Map([["binance", adapter]]), config, silentLogger);
  assert.equal((await worker.runOnce()).errorCode, "HEDGE_ROUTE_NOT_CONFIGURED");
  assert.equal(venueCalls, 0);
  assert.equal(store.calls.completeFailed.length, 1);
});

test("HedgeWorker never abandons a submission-attempted job on local route failure", async () => {
  const store = fakeStore({ ...job, chainId: 2, submissionAttempted: true });
  const worker = new HedgeWorker(store, routes, new Map([[
    "binance",
    { async queryOrder() {}, async submitMarketOrder() {} },
  ]]), config, silentLogger);

  assert.deepEqual(await worker.runOnce(), {
    status: "retry_scheduled",
    hedgeOrderId: job.hedgeOrderId,
    errorCode: "HEDGE_ROUTE_NOT_CONFIGURED",
  });
  assert.equal(store.calls.completeFailed.length, 0);
  assert.equal(store.calls.releaseForRetry.length, 1);
});

test("HedgeWorker blocks a new POST when submission authorization observes a reorg", async () => {
  const store = fakeStore(job);
  store.authorizeSubmission = async (...args) => {
    store.calls.authorizeSubmission.push(args);
    throw new Error("HEDGE_SETTLEMENT_NON_CANONICAL");
  };
  let submissions = 0;
  const adapter = {
    async queryOrder() { return undefined; },
    async submitMarketOrder() { submissions += 1; },
  };
  const worker = new HedgeWorker(store, routes, new Map([["binance", adapter]]), config, silentLogger);
  assert.deepEqual(await worker.runOnce(), {
    status: "failed",
    hedgeOrderId: job.hedgeOrderId,
    errorCode: "HEDGE_SETTLEMENT_NON_CANONICAL",
  });
  assert.equal(submissions, 0);
  assert.equal(store.calls.completeFailed.length, 1);
});

test("HedgeWorker persists terminal partial execution before marking venue failure", async () => {
  const store = fakeStore(job);
  const adapter = {
    async queryOrder(input) {
      return {
        state: "failed",
        externalOrderId: input.clientOrderId,
        executedQuantity: "0.5",
        executedQuoteQuantity: "1250",
        failureCode: "BINANCE_ORDER_EXPIRED",
      };
    },
    async submitMarketOrder() { throw new Error("must not submit"); },
  };
  const worker = new HedgeWorker(store, routes, new Map([["binance", adapter]]), config, silentLogger);
  assert.equal((await worker.runOnce()).status, "failed");
  assert.deepEqual(store.calls.completeFailed[0].slice(0, 3), [
    job.hedgeOrderId,
    "worker_1",
    "BINANCE_ORDER_EXPIRED",
  ]);
  assert.equal(store.calls.completeFailed[0][4], "500000000000000000");
  assert.equal(store.calls.completeFailed[0][5], "1250");
});

test("HedgeWorker rejects unpaired base and quote execution evidence", async () => {
  const store = fakeStore(job);
  const adapter = {
    async queryOrder(input) {
      return {
        state: "pending",
        externalOrderId: input.clientOrderId,
        executedQuantity: "0.5",
        executedQuoteQuantity: "0",
      };
    },
    async submitMarketOrder() { throw new Error("must not submit"); },
  };
  const worker = new HedgeWorker(store, routes, new Map([["binance", adapter]]), config, silentLogger);
  assert.equal((await worker.runOnce()).errorCode, "HEDGE_VENUE_RESPONSE_INVALID");
  assert.equal(store.calls.recordExecutionProgress.length, 0);
});

test("HedgeWorkerMetrics exposes bounded outcome labels", () => {
  const metrics = new HedgeWorkerMetrics();
  metrics.recordResult({ status: "idle" });
  metrics.recordResult({ status: "filled", hedgeOrderId: job.hedgeOrderId });
  metrics.recordResult({ status: "retry_scheduled", hedgeOrderId: job.hedgeOrderId, errorCode: "TEST" });
  metrics.recordIterationError();
  const output = metrics.renderPrometheus();
  assert.match(output, /rfq_hedge_worker_jobs_total\{status="filled"\} 1/);
  assert.match(output, /rfq_hedge_worker_jobs_total\{status="retry_scheduled"\} 1/);
  assert.match(output, /rfq_hedge_worker_iteration_errors_total 1/);
});

function fakeStore(claimedJob) {
  const calls = {
    prepareRoute: [],
    authorizeSubmission: [],
    recordExternalOrderObserved: [],
    recordExecutionProgress: [],
    completeFilled: [],
    completeFailed: [],
    releaseForRetry: [],
  };
  return {
    calls,
    async checkHealth() {},
    async claimNext() { return claimedJob; },
    async prepareRoute(...args) { calls.prepareRoute.push(args); },
    async authorizeSubmission(...args) { calls.authorizeSubmission.push(args); },
    async recordExternalOrderObserved(...args) { calls.recordExternalOrderObserved.push(args); },
    async recordExecutionProgress(...args) { calls.recordExecutionProgress.push(args); },
    async completeFilled(...args) { calls.completeFilled.push(args); },
    async completeFailed(...args) { calls.completeFailed.push(args); },
    async releaseForRetry(...args) { calls.releaseForRetry.push(args); },
  };
}

const silentLogger = { info() {}, error() {} };
