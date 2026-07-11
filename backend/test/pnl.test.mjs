import assert from "node:assert/strict";
import test from "node:test";
import { PnlService } from "../dist/modules/pnl/pnl.service.js";

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
const simulatedPnlModelDescription =
  "Simulated same-decimal quote attribution where grossPnlTokenOut equals amountIn minus amountOut and is not cross-token accounting PnL";

test("PnlService records signed realized PnL and aggregates summary", () => {
  const pnl = new PnlService();

  const gain = pnl.recordSettlement({
    quoteId: "q_gain",
    quote: baseQuote,
  });
  assert.equal(gain.pnlId, "pnl_q_gain");
  assert.equal(gain.user, baseQuote.user);
  assert.equal(gain.grossPnlTokenOut, "10");
  assert.equal(gain.grossPnlBps, 100);
  assert.equal(gain.minAmountOut, baseQuote.minAmountOut);
  assert.equal(gain.nonce, baseQuote.nonce);
  assert.equal(gain.deadline, baseQuote.deadline);
  assert.equal(gain.model, "simulated_mid_price_v1");
  assert.equal(gain.modelDescription, simulatedPnlModelDescription);

  const loss = pnl.recordSettlement({
    quoteId: "q_loss",
    quote: {
      ...baseQuote,
      amountOut: "1015",
      nonce: "2",
    },
  });
  assert.equal(loss.grossPnlTokenOut, "-15");
  assert.equal(loss.grossPnlBps, -150);

  const summary = pnl.summary();
  assert.equal(summary.status, "ok");
  assert.equal(summary.totalTrades, 2);
  assert.equal(summary.grossPnlTokenOut, "-5");
  assert.deepEqual(summary.trades.map((trade) => trade.pnlId).sort(), ["pnl_q_gain", "pnl_q_loss"]);
});
test("PnlService returns the existing attribution record for quote retries", () => {
  const pnl = new PnlService();

  const first = pnl.recordSettlement({
    quoteId: "q_retry",
    quote: baseQuote,
  });
  const retry = pnl.recordSettlement({
    quoteId: "q_retry",
    quote: baseQuote,
  });

  assert.deepEqual(retry, first);

  const summary = pnl.summary();
  assert.equal(summary.totalTrades, 1);
  assert.equal(summary.grossPnlTokenOut, first.grossPnlTokenOut);
  assert.deepEqual(summary.trades, [first]);
});

test("PnlService returns defensive copies of PnL trade records", () => {
  const pnl = new PnlService();

  const first = pnl.recordSettlement({
    quoteId: "q_copy",
    quote: baseQuote,
  });
  first.grossPnlTokenOut = "999999";
  first.amountOut = "1";

  const retry = pnl.recordSettlement({
    quoteId: "q_copy",
    quote: baseQuote,
  });

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
  assert.equal(reloaded.grossPnlTokenOut, "10");
  assert.equal(reloaded.trades[0].grossPnlTokenOut, "10");
});

test("PnlService removes PnL records by quote and model after reorgs", () => {
  const pnl = new PnlService();
  const first = pnl.recordSettlement({
    quoteId: "q_remove",
    quote: baseQuote,
  });

  const removed = pnl.removePnlRecord({ quoteId: "q_remove" });
  assert.equal(removed.removed, true);
  assert.equal(removed.record.pnlId, first.pnlId);
  assert.equal(removed.record.amountOut, baseQuote.amountOut);

  removed.record.amountOut = "1";
  const retry = pnl.removePnlRecord({ quoteId: "q_remove" });

  assert.deepEqual(retry, { removed: false });
  assert.equal(pnl.summary().totalTrades, 0);
  assert.equal(pnl.summary().grossPnlTokenOut, "0");

  const recreated = pnl.recordSettlement({
    quoteId: "q_remove",
    quote: baseQuote,
  });
  assert.equal(recreated.pnlId, first.pnlId);
  assert.equal(pnl.summary().totalTrades, 1);
});

test("PnlService rejects conflicting retry payloads for the same quote and model", () => {
  const pnl = new PnlService();

  pnl.recordSettlement({
    quoteId: "q_conflict",
    quote: baseQuote,
  });

  assert.throws(
    () =>
      pnl.recordSettlement({
        quoteId: "q_conflict",
        quote: {
          ...baseQuote,
          amountOut: "985",
          nonce: "2",
        },
      }),
    /PnL record conflict/,
  );

  const summary = pnl.summary();
  assert.equal(summary.totalTrades, 1);
  assert.equal(summary.trades[0].amountOut, baseQuote.amountOut);
});

test("PnlService rejects signed quote metadata conflicts for the same quote and model", () => {
  const pnl = new PnlService();

  pnl.recordSettlement({
    quoteId: "q_metadata_conflict",
    quote: baseQuote,
  });

  assert.throws(
    () =>
      pnl.recordSettlement({
        quoteId: "q_metadata_conflict",
        quote: {
          ...baseQuote,
          nonce: "2",
          deadline: baseQuote.deadline + 60,
        },
      }),
    /PnL record conflict/,
  );

  const summary = pnl.summary();
  assert.equal(summary.totalTrades, 1);
  assert.equal(summary.trades[0].nonce, baseQuote.nonce);
  assert.equal(summary.trades[0].deadline, baseQuote.deadline);
});
