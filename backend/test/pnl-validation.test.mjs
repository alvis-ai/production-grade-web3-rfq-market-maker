import assert from "node:assert/strict";
import test from "node:test";
import { PnlService } from "../dist/modules/pnl/pnl.service.js";
import { createTestPnlValuationProvider, pnlInput } from "./helpers/pnl-fixtures.mjs";

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

test("PnlService requires an explicit valuation provider before recording", async () => {
  const pnl = new PnlService();

  await assert.rejects(
    pnl.recordSettlement(pnlInput("q_missing_provider", baseQuote)),
    /valuationProvider is required/,
  );
  assert.equal(pnl.summary().totalTrades, 0);
});

test("PnlService rejects unsafe gross PnL bps before storing attribution", async () => {
  const pnl = new PnlService(createTestPnlValuationProvider());

  await assert.rejects(
    pnl.recordSettlement(pnlInput("q_unsafe_bps", {
      ...baseQuote,
      amountIn: "1",
      amountOut: "900719925476",
      minAmountOut: "1",
      nonce: "9",
    })),
    /Pnl grossPnlBps must be a safe integer/,
  );
  assert.equal(pnl.summary().totalTrades, 0);
});

test("PnlService rejects malformed attribution payload envelopes", async () => {
  const pnl = new PnlService(createTestPnlValuationProvider());

  await assert.rejects(pnl.recordSettlement(undefined), /Pnl input must be an object/);
  await assert.rejects(
    pnl.recordSettlement({
      quoteId: "q_missing_quote",
      settlementEventId: "se_missing_quote",
      snapshotId: "snapshot_missing_quote",
      realizedAt: "2026-07-11T00:00:01.000Z",
    }),
    /Pnl quote must be an object/,
  );
  await assert.rejects(
    pnl.recordSettlement({
      ...pnlInput("q_null_quote", baseQuote),
      quote: null,
    }),
    /Pnl quote must be an object/,
  );
  assert.equal(pnl.summary().totalTrades, 0);
});

test("PnlService rejects inherited attribution fields", async () => {
  const pnl = new PnlService(createTestPnlValuationProvider());

  await assert.rejects(
    pnl.recordSettlement(Object.create(pnlInput("q_inherited_root", baseQuote))),
    /Pnl input.quoteId must be an own field/,
  );
  await assert.rejects(
    pnl.recordSettlement({
      ...pnlInput("q_inherited_quote", baseQuote),
      quote: Object.create(baseQuote),
    }),
    /Pnl quote.user must be an own field/,
  );
  assert.equal(pnl.summary().totalTrades, 0);
});

test("PnlService rejects unsafe attribution identifiers, timestamps, and quote values", async () => {
  const pnl = new PnlService(createTestPnlValuationProvider());
  const cases = [
    [pnlInput(" ", baseQuote), /quoteId must be a non-empty string/],
    [pnlInput("q.bad", baseQuote), /quoteId must contain only letters/],
    [{ ...pnlInput("q_bad_event", baseQuote), settlementEventId: "se.bad" }, /settlementEventId must contain only letters/],
    [{ ...pnlInput("q_bad_snapshot", baseQuote), snapshotId: "snapshot.bad" }, /snapshotId must contain only letters/],
    [{ ...pnlInput("q_bad_time", baseQuote), realizedAt: "2026-01-01T00:00:00Z" }, /realizedAt must be a canonical/],
    [pnlInput("q_bad_chain", { ...baseQuote, chainId: 0 }), /quote.chainId must be a positive safe integer/],
    [pnlInput("q_bad_token", { ...baseQuote, tokenOut: "0x00000000000000000000000000000000000000zz" }), /quote.tokenOut must be a 20-byte/],
    [pnlInput("q_zero_amount", { ...baseQuote, amountIn: "0" }), /quote.amountIn must be a positive uint/],
    [pnlInput("q_nonce_leading_zero", { ...baseQuote, nonce: "01" }), /quote.nonce must be a positive uint/],
    [pnlInput("q_below_min", { ...baseQuote, amountOut: "970" }), /amountOut must be greater than or equal/],
  ];

  for (const [input, expected] of cases) {
    await assert.rejects(pnl.recordSettlement(input), expected);
  }
  assert.equal(pnl.summary().totalTrades, 0);
});

test("PnlService rejects malformed or conflicting valuation results", async () => {
  const valuationCases = [
    [{ snapshotId: "wrong_snapshot" }, /snapshotId must match/],
    [{ midPrice: "0" }, /midPrice must be a positive canonical decimal/],
    [{ tokenInDecimals: 37 }, /tokenInDecimals must be an integer between 0 and 36/],
    [{ tokenOutDecimals: -1 }, /tokenOutDecimals must be an integer between 0 and 36/],
    [{ observedAt: "2026-01-01T00:00:00Z" }, /observedAt must be a canonical/],
  ];

  for (const [overrides, expected] of valuationCases) {
    const pnl = new PnlService(createTestPnlValuationProvider(overrides));
    await assert.rejects(pnl.recordSettlement(pnlInput("q_bad_valuation", baseQuote)), expected);
    assert.equal(pnl.summary().totalTrades, 0);
  }
});

test("PnlService rejects unsafe PnL removal inputs before state mutation", async () => {
  const pnl = new PnlService(createTestPnlValuationProvider());
  await pnl.recordSettlement(pnlInput("q_remove_unsafe", baseQuote));

  assert.throws(() => pnl.removePnlRecord(undefined), /Pnl remove input must be an object/);
  assert.throws(
    () => pnl.removePnlRecord(Object.create({ quoteId: "q_remove_unsafe" })),
    /remove input.quoteId must be an own field/,
  );
  assert.throws(
    () => pnl.removePnlRecord({ quoteId: "q_remove_unsafe", model: "unsupported_model" }),
    /Pnl model must be quote_snapshot_edge_v1/,
  );
  assert.equal(pnl.summary().totalTrades, 1);
});
