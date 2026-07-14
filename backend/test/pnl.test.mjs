import assert from "node:assert/strict";
import test from "node:test";
import { PnlService } from "../dist/modules/pnl/pnl.service.js";
import {
  createTestPnlValuationProvider,
  pnlInput,
  quoteSnapshotPnlModelDescription,
} from "./helpers/pnl-fixtures.mjs";

const baseQuote = {
  user: "0x0000000000000000000000000000000000000001",
  tokenIn: "0x0000000000000000000000000000000000000002",
  tokenOut: "0x0000000000000000000000000000000000000003",
  amountIn: "1000",
  amountOut: "990",
  minAmountOut: "980",
  nonce: "1",
  deadline: 1893456000,
  chainId: 1,
};
test("PnlService records quote-snapshot PnL and aggregates by output token", async () => {
  const pnl = new PnlService(createTestPnlValuationProvider());

  const gain = await pnl.recordSettlement(pnlInput("q_gain", baseQuote));
  assert.equal(gain.pnlId, "pnl_q_gain");
  assert.equal(gain.settlementEventId, "se_q_gain");
  assert.equal(gain.snapshotId, "snapshot_q_gain");
  assert.equal(gain.user, baseQuote.user);
  assert.equal(gain.fairAmountOut, "1000");
  assert.equal(gain.grossPnlTokenOut, "10");
  assert.equal(gain.grossPnlBps, 100);
  assert.equal(gain.minAmountOut, baseQuote.minAmountOut);
  assert.equal(gain.nonce, baseQuote.nonce);
  assert.equal(gain.deadline, baseQuote.deadline);
  assert.equal(gain.model, "quote_snapshot_edge_v1");
  assert.equal(gain.modelDescription, quoteSnapshotPnlModelDescription);

  const loss = await pnl.recordSettlement(
    pnlInput("q_loss", {
      ...baseQuote,
      amountOut: "1015",
      nonce: "2",
    }),
  );
  assert.equal(loss.grossPnlTokenOut, "-15");
  assert.equal(loss.grossPnlBps, -150);

  const summary = pnl.summary();
  assert.equal(summary.status, "ok");
  assert.equal(summary.totalTrades, 2);
  assert.deepEqual(summary.totals, [{
    chainId: 1,
    tokenOut: baseQuote.tokenOut,
    totalTrades: 2,
    grossPnlTokenOut: "-5",
  }]);
  assert.deepEqual(summary.trades.map((trade) => trade.pnlId).sort(), ["pnl_q_gain", "pnl_q_loss"]);
});

test("PnlService scopes summaries through quote ownership", async () => {
  const owners = new Map([["q_owned", "institution_a"], ["q_foreign", "institution_b"]]);
  const pnl = new PnlService(createTestPnlValuationProvider(), {
    async findPrincipalId(quoteId) { return owners.get(quoteId); },
  });
  await pnl.recordSettlement(pnlInput("q_owned", baseQuote));
  await pnl.recordSettlement(pnlInput("q_foreign", { ...baseQuote, nonce: "2" }));

  const owned = await pnl.summary("institution_a");
  const foreign = await pnl.summary("institution_b");
  assert.equal(owned.totalTrades, 1);
  assert.deepEqual(owned.trades.map(({ quoteId }) => quoteId), ["q_owned"]);
  assert.equal(foreign.totalTrades, 1);
  assert.deepEqual(foreign.trades.map(({ quoteId }) => quoteId), ["q_foreign"]);
});

test("PnlService normalizes cross-decimal valuation before calculating PnL", async () => {
  const pnl = new PnlService(createTestPnlValuationProvider({
    midPrice: "2000",
    tokenInDecimals: 18,
    tokenOutDecimals: 6,
  }));
  const quote = {
    ...baseQuote,
    amountIn: "1000000000000000000",
    amountOut: "1998000000",
    minAmountOut: "1980000000",
  };

  const record = await pnl.recordSettlement(pnlInput("q_cross_decimals", quote));

  assert.equal(record.fairAmountOut, "2000000000");
  assert.equal(record.grossPnlTokenOut, "2000000");
  assert.equal(record.grossPnlBps, 10);
  assert.equal(record.tokenInDecimals, 18);
  assert.equal(record.tokenOutDecimals, 6);
});

test("PnlService returns the existing attribution record for quote retries", async () => {
  const pnl = new PnlService(createTestPnlValuationProvider());

  const input = pnlInput("q_retry", baseQuote);
  const first = await pnl.recordSettlement(input);
  const retry = await pnl.recordSettlement(input);

  assert.deepEqual(retry, first);

  const summary = pnl.summary();
  assert.equal(summary.totalTrades, 1);
  assert.equal(summary.totals[0].grossPnlTokenOut, first.grossPnlTokenOut);
  assert.deepEqual(summary.trades, [first]);
});

test("PnlService returns defensive copies of PnL trade records", async () => {
  const pnl = new PnlService(createTestPnlValuationProvider());

  const input = pnlInput("q_copy", baseQuote);
  const first = await pnl.recordSettlement(input);
  first.grossPnlTokenOut = "999999";
  first.amountOut = "1";

  const retry = await pnl.recordSettlement(input);

  assert.notEqual(retry, first);
  assert.equal(retry.grossPnlTokenOut, "10");
  assert.equal(retry.amountOut, baseQuote.amountOut);

  const found = pnl.getPnlRecordByQuoteId("q_copy");
  found.amountOut = "2";
  assert.equal(pnl.getPnlRecordByQuoteId("q_copy").amountOut, baseQuote.amountOut);
  assert.equal(pnl.getPnlRecordByQuoteId("q_missing"), undefined);

  const summary = pnl.summary();
  summary.trades[0].grossPnlTokenOut = "888888";

  const reloaded = pnl.summary();
  assert.equal(reloaded.totals[0].grossPnlTokenOut, "10");
  assert.equal(reloaded.trades[0].grossPnlTokenOut, "10");
});

test("PnlService removes PnL records by quote and model after reorgs", async () => {
  const pnl = new PnlService(createTestPnlValuationProvider());
  const input = pnlInput("q_remove", baseQuote);
  const first = await pnl.recordSettlement(input);

  const removed = pnl.removePnlRecord({ quoteId: "q_remove" });
  assert.equal(removed.removed, true);
  assert.equal(removed.record.pnlId, first.pnlId);
  assert.equal(removed.record.amountOut, baseQuote.amountOut);

  removed.record.amountOut = "1";
  const retry = pnl.removePnlRecord({ quoteId: "q_remove" });

  assert.deepEqual(retry, { removed: false });
  assert.equal(pnl.summary().totalTrades, 0);
  assert.deepEqual(pnl.summary().totals, []);

  const recreated = await pnl.recordSettlement(input);
  assert.equal(recreated.pnlId, first.pnlId);
  assert.equal(pnl.summary().totalTrades, 1);
});

test("PnlService rejects conflicting retry payloads for the same quote and model", async () => {
  const pnl = new PnlService(createTestPnlValuationProvider());

  await pnl.recordSettlement(pnlInput("q_conflict", baseQuote));

  await assert.rejects(
    pnl.recordSettlement(
      pnlInput("q_conflict", {
          ...baseQuote,
          amountOut: "985",
          nonce: "2",
      }),
    ),
    /PnL record conflict/,
  );

  const summary = pnl.summary();
  assert.equal(summary.totalTrades, 1);
  assert.equal(summary.trades[0].amountOut, baseQuote.amountOut);
});

test("PnlService rejects signed quote metadata conflicts for the same quote and model", async () => {
  const pnl = new PnlService(createTestPnlValuationProvider());

  await pnl.recordSettlement(pnlInput("q_metadata_conflict", baseQuote));

  await assert.rejects(
    pnl.recordSettlement(
      pnlInput("q_metadata_conflict", {
          ...baseQuote,
          nonce: "2",
          deadline: baseQuote.deadline + 60,
      }),
    ),
    /PnL record conflict/,
  );

  const summary = pnl.summary();
  assert.equal(summary.totalTrades, 1);
  assert.equal(summary.trades[0].nonce, baseQuote.nonce);
  assert.equal(summary.trades[0].deadline, baseQuote.deadline);
});
