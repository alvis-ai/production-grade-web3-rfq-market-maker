import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateHedgeNetPnl,
  hedgeFillNetPnlModelDescription,
} from "../dist/modules/hedge/hedge-net-pnl.js";

const quoteToken = "0x0000000000000000000000000000000000000002";
const realizedAt = "2026-07-15T00:00:00.000Z";

test("calculateHedgeNetPnl values a buy hedge, sub-step residual, and quote/base commissions", () => {
  const result = calculateHedgeNetPnl({
    side: "buy",
    targetAmount: "1250090000000000000",
    filledAmount: "1250000000000000000",
    baseTokenDecimals: 18,
    settlementReferenceAmount: "3130000000",
    quoteTokenDecimals: 6,
    executedQuoteQuantity: "3125",
    baseAsset: "ETH",
    quoteAsset: "USDT",
    quoteToken,
    fills: [fill({
      venueTradeId: "1",
      quantity: "0.5",
      quoteQuantity: "1250",
      commissionQuantity: "0.0001",
      commissionAsset: "ETH",
    }), fill({
      venueTradeId: "2",
      quantity: "0.75",
      quoteQuantity: "1875",
      commissionQuantity: "1.875",
      commissionAsset: "USDT",
    })],
    realizedAt,
  });

  assert.equal(result.status, "complete");
  assert.equal(result.model, "hedge_fill_net_v1");
  assert.equal(result.modelDescription, hedgeFillNetPnlModelDescription);
  assert.equal(result.valuationToken, quoteToken);
  assert.equal(result.settlementReferenceQuantity, "3130");
  assert.equal(result.residualBaseAmount, "90000000000000");
  assert.equal(result.residualQuoteQuantity, "0.225");
  assert.equal(result.commissionQuoteQuantity, "2.125");
  assert.equal(result.netPnlQuoteQuantity, "2.65");
});

test("calculateHedgeNetPnl uses conservative residual valuation for a sell hedge", () => {
  const result = calculateHedgeNetPnl({
    side: "sell",
    targetAmount: "1000090000000000000",
    filledAmount: "1000000000000000000",
    baseTokenDecimals: 18,
    settlementReferenceAmount: "2490000000",
    quoteTokenDecimals: 6,
    executedQuoteQuantity: "2500",
    baseAsset: "ETH",
    quoteAsset: "USDT",
    quoteToken,
    fills: [fill({ commissionQuantity: "1", commissionAsset: "USDT" })],
    realizedAt,
  });

  assert.equal(result.status, "complete");
  assert.equal(result.residualQuoteQuantity, "0.225");
  assert.equal(result.netPnlQuoteQuantity, "9.225");
});

test("calculateHedgeNetPnl refuses to invent a value for third-asset commission", () => {
  const result = calculateHedgeNetPnl({
    side: "buy",
    targetAmount: "1000000000000000000",
    filledAmount: "1000000000000000000",
    baseTokenDecimals: 18,
    settlementReferenceAmount: "2510000000",
    quoteTokenDecimals: 6,
    executedQuoteQuantity: "2500",
    baseAsset: "ETH",
    quoteAsset: "USDT",
    quoteToken,
    fills: [fill({ commissionQuantity: "0.0001", commissionAsset: "BNB" })],
    realizedAt,
  });

  assert.deepEqual(result, {
    status: "unavailable",
    model: "hedge_fill_net_v1",
    modelDescription: hedgeFillNetPnlModelDescription,
    valuationToken: quoteToken,
    valuationAsset: "USDT",
    reasonCode: "UNVALUED_COMMISSION_ASSET",
    unvaluedCommissionAssets: ["BNB"],
    realizedAt,
  });
});

function fill(overrides = {}) {
  return {
    venueTradeId: "1",
    venueOrderId: "100234",
    price: "2500",
    quantity: "1",
    quoteQuantity: "2500",
    commissionQuantity: "0",
    commissionAsset: "USDT",
    executedAt: "2026-07-15T00:00:00.000Z",
    isBuyer: true,
    isMaker: false,
    ...overrides,
  };
}
