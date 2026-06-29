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

test("PnlService records signed realized PnL and aggregates summary", () => {
  const pnl = new PnlService();

  const gain = pnl.recordSettlement({
    quoteId: "q_gain",
    quote: baseQuote,
  });
  assert.equal(gain.pnlId, "pnl_q_gain");
  assert.equal(gain.grossPnlTokenOut, "10");
  assert.equal(gain.grossPnlBps, 100);
  assert.equal(gain.model, "simulated_mid_price_v1");

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
    quote: {
      ...baseQuote,
      amountOut: "985",
      nonce: "2",
    },
  });

  assert.deepEqual(retry, first);

  const summary = pnl.summary();
  assert.equal(summary.totalTrades, 1);
  assert.equal(summary.grossPnlTokenOut, first.grossPnlTokenOut);
  assert.deepEqual(summary.trades, [first]);
});

test("PnlService rejects unsafe attribution inputs before recording", () => {
  const pnl = new PnlService();

  assert.throws(
    () =>
      pnl.recordSettlement({
        quoteId: " ",
        quote: baseQuote,
      }),
    /Pnl quoteId must be a non-empty string/,
  );

  assert.throws(
    () =>
      pnl.recordSettlement({
        quoteId: "q_bad_chain",
        quote: {
          ...baseQuote,
          chainId: 0,
        },
      }),
    /Pnl quote.chainId must be a positive safe integer/,
  );

  assert.throws(
    () =>
      pnl.recordSettlement({
        quoteId: "q_bad_token",
        quote: {
          ...baseQuote,
          tokenOut: "0x00000000000000000000000000000000000000zz",
        },
      }),
    /Pnl quote.tokenOut must be a 20-byte hex address/,
  );

  assert.throws(
    () =>
      pnl.recordSettlement({
        quoteId: "q_zero_amount",
        quote: {
          ...baseQuote,
          amountIn: "0",
        },
      }),
    /Pnl quote.amountIn must be a positive uint string/,
  );

  assert.throws(
    () =>
      pnl.recordSettlement({
        quoteId: "q_below_min",
        quote: {
          ...baseQuote,
          amountOut: "970",
        },
      }),
    /Pnl quote.amountOut must be greater than or equal to quote.minAmountOut/,
  );

  assert.equal(pnl.summary().totalTrades, 0);
});
