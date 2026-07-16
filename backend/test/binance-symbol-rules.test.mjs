import assert from "node:assert/strict";
import test from "node:test";
import {
  BinanceSymbolRulesError,
  BinanceSymbolRulesService,
} from "../dist/modules/hedge/binance-symbol-rules.js";
import { MAX_BINANCE_HTTP_RESPONSE_BYTES } from "../dist/modules/hedge/binance-http-response.js";
import { HedgeRouteTable } from "../dist/modules/hedge/hedge-route.js";

const token = "0x0000000000000000000000000000000000000003";
const quoteToken = "0x0000000000000000000000000000000000000002";
const route = {
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
  priceTick: "0.01",
  maxSlippageBps: 100,
};
const config = {
  baseUrl: "https://testnet.binance.vision",
  requestTimeoutMs: 1000,
  maxAgeMs: 10000,
};

test("BinanceSymbolRulesService validates configured routes and refreshes its bounded cache", async () => {
  let now = 1_700_000_000_000;
  const calls = [];
  const service = new BinanceSymbolRulesService(config, new HedgeRouteTable([route]), async (input, init) => {
    calls.push({ url: new URL(input), init });
    return jsonResponse(exchangeInfo());
  }, () => now);

  await service.checkHealth();
  await service.checkHealth();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.pathname, "/api/v3/exchangeInfo");
  assert.equal(calls[0].url.searchParams.get("symbol"), "ETHUSDT");
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.headers, undefined);

  now += 10_000;
  await service.checkHealth();
  assert.equal(calls.length, 2);
});

test("BinanceSymbolRulesService enforces LOT_SIZE, PRICE_FILTER and NOTIONAL exactly", async () => {
  const service = serviceFor(exchangeInfo());
  await service.validateLimitOrder({ symbol: "ETHUSDT", quantity: "1.25", price: "2500" });

  await rejectsCode(service, { symbol: "ETHUSDT", quantity: "0.00005", price: "2500" },
    "HEDGE_ORDER_BELOW_MIN_QUANTITY");
  await rejectsCode(service, { symbol: "ETHUSDT", quantity: "1.25005", price: "2500" },
    "HEDGE_ORDER_STEP_SIZE_INVALID");
  await rejectsCode(service, { symbol: "ETHUSDT", quantity: "1.25", price: "2500.005" },
    "HEDGE_ORDER_PRICE_TICK_INVALID");
  await rejectsCode(service, { symbol: "ETHUSDT", quantity: "0.001", price: "2500" },
    "HEDGE_ORDER_BELOW_MIN_NOTIONAL");
  await rejectsCode(service, { symbol: "ETHUSDT", quantity: "5", price: "2500" },
    "HEDGE_ORDER_ABOVE_MAX_NOTIONAL");
});

test("BinanceSymbolRulesService fails closed on route drift and malformed venue rules", async () => {
  await assert.rejects(
    serviceFor(exchangeInfo({ status: "HALT" })).checkHealth(),
    (error) => code(error) === "HEDGE_ROUTE_NOT_TRADING" && error.retryable,
  );
  await assert.rejects(
    serviceFor(exchangeInfo({ isSpotTradingAllowed: false })).checkHealth(),
    (error) => code(error) === "HEDGE_ROUTE_UNSUPPORTED" && !error.retryable,
  );
  await assert.rejects(
    serviceFor(exchangeInfo({ baseAsset: "BTC" })).checkHealth(),
    (error) => code(error) === "HEDGE_ROUTE_ASSET_MISMATCH" && !error.retryable,
  );
  await assert.rejects(
    serviceFor(exchangeInfo({ stepSize: "0.00100000" })).checkHealth(),
    (error) => code(error) === "HEDGE_ROUTE_STEP_SIZE_MISMATCH" && !error.retryable,
  );
  await assert.rejects(
    serviceFor(exchangeInfo({ tickSize: "0.10000000" })).checkHealth(),
    (error) => code(error) === "HEDGE_ROUTE_PRICE_TICK_MISMATCH" && !error.retryable,
  );
  await assert.rejects(
    serviceFor({ symbols: [] }).checkHealth(),
    (error) => code(error) === "BINANCE_SYMBOL_RULES_INVALID" && error.retryable,
  );
});

test("BinanceSymbolRulesService single-flights fetches and classifies transport failures", async () => {
  let calls = 0;
  let resolve;
  const pending = new Promise((done) => { resolve = done; });
  const service = new BinanceSymbolRulesService(config, new HedgeRouteTable([route]), async () => {
    calls += 1;
    return pending;
  });
  const first = service.checkHealth();
  const second = service.checkHealth();
  await new Promise((done) => setImmediate(done));
  assert.equal(calls, 1);
  resolve(jsonResponse(exchangeInfo()));
  await Promise.all([first, second]);

  const unavailable = new BinanceSymbolRulesService(config, new HedgeRouteTable([route]), async () => {
    throw new Error("network unavailable");
  });
  await assert.rejects(
    unavailable.checkHealth(),
    (error) => code(error) === "BINANCE_SYMBOL_RULES_UNAVAILABLE" && error.retryable,
  );
  let rejectedBodyCanceled = false;
  const rejected = new BinanceSymbolRulesService(config, new HedgeRouteTable([route]), async () =>
    cancelableResponse(400, () => { rejectedBodyCanceled = true; }));
  await assert.rejects(
    rejected.checkHealth(),
    (error) => code(error) === "BINANCE_SYMBOL_RULES_HTTP_400" && error.retryable,
  );
  assert.equal(rejectedBodyCanceled, true);
});

test("BinanceSymbolRulesService bounds exchangeInfo responses before JSON decoding", async () => {
  const service = new BinanceSymbolRulesService(
    config,
    new HedgeRouteTable([route]),
    async () => new Response("{}", {
      headers: { "content-length": String(MAX_BINANCE_HTTP_RESPONSE_BYTES + 1) },
    }),
  );

  await assert.rejects(
    service.checkHealth(),
    (error) => code(error) === "BINANCE_SYMBOL_RULES_INVALID" && error.retryable,
  );
});

test("BinanceSymbolRulesService bounds stalled exchangeInfo bodies by request timeout", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let requestSignal;
  const service = new BinanceSymbolRulesService(
    { ...config, requestTimeoutMs: 100 },
    new HedgeRouteTable([route]),
    async (_input, init) => {
      requestSignal = init.signal;
      return stallingJsonResponse(init.signal);
    },
  );

  const pending = service.checkHealth();
  const rejected = assert.rejects(
    pending,
    (error) => code(error) === "BINANCE_SYMBOL_RULES_UNAVAILABLE" && error.retryable,
  );
  await settle();
  context.mock.timers.tick(100);
  await rejected;
  assert.equal(requestSignal.aborted, true);
});

test("BinanceSymbolRulesService rejects unsafe configuration", () => {
  const routes = new HedgeRouteTable([route]);
  assert.throws(() => new BinanceSymbolRulesService({ ...config, baseUrl: "http://api.binance.com" }, routes),
    /HTTPS origin/);
  assert.throws(() => new BinanceSymbolRulesService({ ...config, maxAgeMs: 9999 }, routes), /maxAgeMs/);
  assert.throws(() => new BinanceSymbolRulesService({ ...config, requestTimeoutMs: 99 }, routes), /requestTimeoutMs/);
});

function serviceFor(response) {
  return new BinanceSymbolRulesService(config, new HedgeRouteTable([route]), async () => jsonResponse(response));
}

async function rejectsCode(service, input, expected) {
  await assert.rejects(
    service.validateLimitOrder(input),
    (error) => error instanceof BinanceSymbolRulesError && error.errorCode === expected && !error.retryable,
  );
}

function code(error) {
  return error instanceof BinanceSymbolRulesError && error.errorCode;
}

function exchangeInfo(overrides = {}) {
  const { stepSize = "0.00010000", tickSize = "0.01000000", ...symbolOverrides } = overrides;
  return {
    symbols: [{
      symbol: "ETHUSDT",
      status: "TRADING",
      baseAsset: "ETH",
      quoteAsset: "USDT",
      isSpotTradingAllowed: true,
      orderTypes: ["LIMIT", "MARKET"],
      filters: [
        { filterType: "PRICE_FILTER", minPrice: "0.01000000", maxPrice: "100000.00000000", tickSize },
        { filterType: "LOT_SIZE", minQty: "0.00010000", maxQty: "100.00000000", stepSize },
        { filterType: "MIN_NOTIONAL", minNotional: "5.00000000" },
        { filterType: "NOTIONAL", minNotional: "10.00000000", maxNotional: "10000.00000000" },
      ],
      ...symbolOverrides,
    }],
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function cancelableResponse(status, onCancel) {
  return new Response(new ReadableStream({
    cancel() { onCancel(); },
  }), { status });
}

function stallingJsonResponse(signal) {
  return new Response(new ReadableStream({
    start(controller) {
      const abort = () => controller.error(new DOMException("aborted", "AbortError"));
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort, { once: true });
    },
  }));
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
}
