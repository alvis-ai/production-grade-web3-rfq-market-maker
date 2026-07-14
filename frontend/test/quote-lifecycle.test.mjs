import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function importQuoteLifecycleModule() {
  const source = await readFile(new URL("../src/lib/quote-lifecycle.ts", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      isolatedModules: true,
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: "quote-lifecycle.ts",
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
}

const {
  firstQuoteLifecycleResourceError,
  isQuoteLifecycleComplete,
  loadQuoteLifecycle,
  nextQuoteLifecyclePollDelayMs,
  pollQuoteLifecycle,
} = await importQuoteLifecycleModule();

const settledStatus = Object.freeze({
  quoteId: "q_lifecycle",
  status: "settled",
  settlementEventId: "se_lifecycle",
  hedgeOrderId: "h_lifecycle",
  pnlId: "pnl_lifecycle",
});

test("loadQuoteLifecycle hydrates authoritative post-trade pointers concurrently", async () => {
  const calls = [];
  const client = {
    async getQuote(quoteId) {
      calls.push(["quote", quoteId]);
      return settledStatus;
    },
    async getSettlement(settlementEventId) {
      calls.push(["settlement", settlementEventId]);
      return { settlementEventId, status: "applied" };
    },
    async getHedge(hedgeOrderId) {
      calls.push(["hedge", hedgeOrderId]);
      return { hedgeOrderId, status: "filled", feeReconciliationStatus: "complete" };
    },
    async pnl() {
      calls.push(["pnl"]);
      return { status: "ok", totalTrades: 1, totals: [], trades: [{ pnlId: "pnl_lifecycle" }] };
    },
  };

  const snapshot = await loadQuoteLifecycle(client, "q_lifecycle");
  assert.equal(snapshot.quoteStatus, settledStatus);
  assert.equal(snapshot.settlementStatus.settlementEventId, "se_lifecycle");
  assert.equal(snapshot.hedgeStatus.hedgeOrderId, "h_lifecycle");
  assert.equal(snapshot.pnlSummary.trades[0].pnlId, "pnl_lifecycle");
  assert.deepEqual(calls[0], ["quote", "q_lifecycle"]);
  assert.deepEqual(new Set(calls.slice(1).map(([kind]) => kind)), new Set(["settlement", "hedge", "pnl"]));
  assert.equal(isQuoteLifecycleComplete(snapshot), true);
});

test("loadQuoteLifecycle uses submit pointers until quote status converges", async () => {
  const client = {
    async getQuote() {
      return { quoteId: "q_lifecycle", status: "submitted" };
    },
    async getSettlement(settlementEventId) {
      return { settlementEventId, status: "applied" };
    },
    async getHedge(hedgeOrderId) {
      return { hedgeOrderId, status: "queued" };
    },
    async pnl() {
      return { status: "ok", totalTrades: 0, totals: [], trades: [] };
    },
  };

  const snapshot = await loadQuoteLifecycle(client, "q_lifecycle", {
    status: "accepted",
    settlementEventId: "se_fallback",
    hedgeOrderId: "h_fallback",
    pnlId: "pnl_fallback",
  });
  assert.equal(snapshot.settlementStatus.settlementEventId, "se_fallback");
  assert.equal(snapshot.hedgeStatus.hedgeOrderId, "h_fallback");
  assert.equal(isQuoteLifecycleComplete(snapshot), false);
  assert.equal(isQuoteLifecycleComplete({
    ...snapshot,
    quoteStatus: { quoteId: "q_lifecycle", status: "settled" },
  }), false);
});

test("loadQuoteLifecycle preserves successful surfaces when one projection is unavailable", async () => {
  const client = {
    async getQuote() {
      return {
        quoteId: "q_partial",
        status: "settled",
        settlementEventId: "se_partial",
        hedgeOrderId: "h_partial",
      };
    },
    async getSettlement(settlementEventId) {
      return { settlementEventId, status: "applied" };
    },
    async getHedge() {
      throw new Error("hedge projection pending");
    },
    async pnl() {
      throw new Error("not expected");
    },
  };

  const snapshot = await loadQuoteLifecycle(client, "q_partial");
  assert.equal(snapshot.quoteStatus.status, "settled");
  assert.equal(snapshot.settlementStatus.settlementEventId, "se_partial");
  assert.equal(snapshot.hedgeStatus, undefined);
  assert.equal(firstQuoteLifecycleResourceError(snapshot).message, "hedge projection pending");
  assert.equal(isQuoteLifecycleComplete(snapshot), false);
});

test("isQuoteLifecycleComplete waits for settlement, PnL, hedge, and fee convergence", () => {
  const base = {
    quoteStatus: settledStatus,
    settlementStatus: { settlementEventId: "se_lifecycle", status: "applied" },
    pnlSummary: { trades: [{ pnlId: "pnl_lifecycle" }] },
  };
  assert.equal(isQuoteLifecycleComplete(base), false);
  assert.equal(isQuoteLifecycleComplete({
    ...base,
    hedgeStatus: { hedgeOrderId: "h_lifecycle", status: "queued" },
  }), false);
  assert.equal(isQuoteLifecycleComplete({
    ...base,
    hedgeStatus: {
      hedgeOrderId: "h_lifecycle",
      status: "filled",
      feeReconciliationStatus: "pending",
    },
  }), false);
  assert.equal(isQuoteLifecycleComplete({
    ...base,
    hedgeStatus: {
      hedgeOrderId: "h_lifecycle",
      status: "filled",
      feeReconciliationStatus: "complete",
    },
  }), true);
  assert.equal(isQuoteLifecycleComplete({
    quoteStatus: { quoteId: "q_failed", status: "failed" },
  }), true);
});

test("pollQuoteLifecycle retries transient failures and stops at a terminal snapshot", async () => {
  const controller = new AbortController();
  const updates = [];
  const errors = [];
  const delays = [];
  let attempt = 0;

  await pollQuoteLifecycle({
    async load() {
      attempt += 1;
      if (attempt === 1) throw new Error("temporary gateway failure");
      if (attempt === 2) return { quoteStatus: { quoteId: "q_poll", status: "submitted" } };
      return { quoteStatus: { quoteId: "q_poll", status: "settled" } };
    },
    onUpdate(snapshot) {
      updates.push(snapshot.quoteStatus.status);
    },
    onError(error) {
      errors.push(error.message);
    },
    signal: controller.signal,
    baseDelayMs: 10,
    maxDelayMs: 40,
    async wait(delayMs) {
      delays.push(delayMs);
      return true;
    },
  });

  assert.equal(attempt, 3);
  assert.deepEqual(updates, ["submitted", "settled"]);
  assert.deepEqual(errors, ["temporary gateway failure"]);
  assert.deepEqual(delays, [10, 20]);
});

test("poll delay applies bounded exponential backoff and rejects invalid bounds", () => {
  assert.equal(nextQuoteLifecyclePollDelayMs(0, 1_000, 8_000), 1_000);
  assert.equal(nextQuoteLifecyclePollDelayMs(1, 1_000, 8_000), 1_000);
  assert.equal(nextQuoteLifecyclePollDelayMs(2, 1_000, 8_000), 2_000);
  assert.equal(nextQuoteLifecyclePollDelayMs(5, 1_000, 8_000), 8_000);
  assert.throws(() => nextQuoteLifecyclePollDelayMs(-1), /non-negative safe integer/);
  assert.throws(() => nextQuoteLifecyclePollDelayMs(0, 2_000, 1_000), /must not exceed/);
});

test("pollQuoteLifecycle stops without another request when the quote session aborts", async () => {
  const controller = new AbortController();
  let loads = 0;
  await pollQuoteLifecycle({
    async load() {
      loads += 1;
      return { quoteStatus: { quoteId: "q_abort", status: "submitted" } };
    },
    onUpdate() {},
    onError(error) {
      throw error;
    },
    signal: controller.signal,
    async wait() {
      controller.abort();
      return false;
    },
  });
  assert.equal(loads, 1);
});

test("loadQuoteLifecycle rejects mismatched resource identities", async () => {
  const client = {
    async getQuote() {
      return { quoteId: "q_wrong", status: "signed" };
    },
    async getSettlement() {
      throw new Error("not expected");
    },
    async getHedge() {
      throw new Error("not expected");
    },
    async pnl() {
      throw new Error("not expected");
    },
  };
  await assert.rejects(
    loadQuoteLifecycle(client, "q_lifecycle"),
    /quoteId does not match/,
  );

  const mismatchedSettlementClient = {
    ...client,
    async getQuote() {
      return { quoteId: "q_lifecycle", status: "settled", settlementEventId: "se_expected" };
    },
    async getSettlement() {
      return { settlementEventId: "se_wrong", status: "applied" };
    },
  };
  const mismatch = await loadQuoteLifecycle(mismatchedSettlementClient, "q_lifecycle");
  assert.equal(mismatch.settlementStatus, undefined);
  assert.match(firstQuoteLifecycleResourceError(mismatch).message, /settlement response does not match/);
  assert.equal(isQuoteLifecycleComplete(mismatch), false);
});
