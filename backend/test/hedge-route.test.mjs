import assert from "node:assert/strict";
import test from "node:test";
import {
  HedgeRouteTable,
  buildHedgeClientOrderId,
  formatHedgeQuantity,
  parseHedgeExecutedQuantity,
  parseHedgeRoutesJson,
  quantizeHedgeAmount,
} from "../dist/modules/hedge/hedge-route.js";
import { ConfiguredTokenRegistry } from "../dist/modules/pricing/token-registry.js";

const token = "0x0000000000000000000000000000000000000003";
const route = {
  chainId: 1,
  token,
  venue: "binance",
  symbol: "ETHUSDT",
  tokenDecimals: 18,
  stepSizeRaw: "100000000000000",
};

test("HedgeRouteTable normalizes token lookup and isolates returned routes", () => {
  const table = new HedgeRouteTable([{ ...route, token: token.toUpperCase().replace("0X", "0x") }]);
  const found = table.find(1, token);
  assert.equal(found.symbol, "ETHUSDT");
  found.symbol = "MUTATED";
  assert.equal(table.find(1, token).symbol, "ETHUSDT");
});

test("formatHedgeQuantity quantizes raw token units down to venue step size", () => {
  assert.equal(quantizeHedgeAmount("1234567890123456789", route), "1234500000000000000");
  assert.equal(formatHedgeQuantity("1234567890123456789", route), "1.2345");
  assert.throws(() => formatHedgeQuantity("99999999999999", route), /HEDGE_AMOUNT_BELOW_STEP_SIZE/);
});

test("HedgeRouteTable binds route decimals to the shared token registry", () => {
  const table = new HedgeRouteTable([route]);
  assert.doesNotThrow(() => table.validateTokenRegistry(new ConfiguredTokenRegistry({
    tokens: [{
      chainId: 1,
      tokenAddress: token,
      symbol: "WETH",
      decimals: 18,
      isWhitelisted: false,
      riskTier: "medium",
      usdReference: false,
    }],
  })));
  assert.throws(() => table.validateTokenRegistry(new ConfiguredTokenRegistry({
    tokens: [{
      chainId: 1,
      tokenAddress: token,
      symbol: "WETH",
      decimals: 6,
      isWhitelisted: true,
      riskTier: "medium",
      usdReference: false,
    }],
  })), /does not match token registry decimals/);
  assert.throws(
    () => table.validateTokenRegistry(new ConfiguredTokenRegistry({
      tokens: [{
        chainId: 1,
        tokenAddress: "0x0000000000000000000000000000000000000004",
        symbol: "OTHER",
        decimals: 18,
        isWhitelisted: true,
        riskTier: "low",
        usdReference: false,
      }],
    })),
    /is not configured/,
  );
});

test("parseHedgeExecutedQuantity converts terminal venue quantities back to raw units", () => {
  assert.equal(parseHedgeExecutedQuantity("1.23450000", route), "1234500000000000000");
  assert.equal(parseHedgeExecutedQuantity("0.00000000", route), undefined);
  assert.throws(() => parseHedgeExecutedQuantity("1.23456", route), /HEDGE_EXECUTED_QUANTITY_INVALID/);
});

test("buildHedgeClientOrderId is deterministic and Binance-bounded", () => {
  const first = buildHedgeClientOrderId("h_11111111111111111111111111111111");
  assert.equal(first, buildHedgeClientOrderId("h_11111111111111111111111111111111"));
  assert.match(first, /^rfq_[a-f0-9]{32}$/);
  assert.equal(first.length, 36);
});

test("parseHedgeRoutesJson rejects malformed and duplicate production routes", () => {
  assert.equal(parseHedgeRoutesJson(JSON.stringify({ routes: [route] })).find(1, token).symbol, "ETHUSDT");
  assert.throws(() => parseHedgeRoutesJson("[]"), /root must be an object/);
  assert.throws(
    () => parseHedgeRoutesJson(JSON.stringify({ routes: [route, route] })),
    /Duplicate hedge route/,
  );
  assert.throws(
    () => new HedgeRouteTable([{ ...route, stepSizeRaw: "0" }]),
    /stepSizeRaw/,
  );
});
