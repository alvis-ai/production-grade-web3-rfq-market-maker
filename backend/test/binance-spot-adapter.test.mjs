import { createHmac } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import {
  BinanceSpotAdapter,
  CexVenueError,
} from "../dist/modules/hedge/binance-spot.adapter.js";

const config = {
  apiKey: "test-api-key",
  apiSecret: "test-api-secret",
  baseUrl: "https://testnet.binance.vision",
  recvWindowMs: 5000,
  requestTimeoutMs: 1000,
};
const clientOrderId = "rfq_11111111111111111111111111111111";

test("BinanceSpotAdapter signs query-first bounded limit order execution", async () => {
  const calls = [];
  const fetchFn = async (input, init) => {
    const url = new URL(input);
    calls.push({ url, init });
    if (init.method === "GET") return jsonResponse({ code: -2013, msg: "Order does not exist." }, 400);
    return jsonResponse({
      symbol: "ETHUSDT",
      orderId: 100234,
      clientOrderId,
      status: "FILLED",
      executedQty: "1.25000000",
      cummulativeQuoteQty: "3125.50000000",
    });
  };
  const adapter = new BinanceSpotAdapter(config, fetchFn, () => 1_700_000_000_000);

  assert.equal(await adapter.queryOrder({ symbol: "ETHUSDT", clientOrderId }), undefined);
  const result = await adapter.submitLimitOrder({
    symbol: "ETHUSDT",
    side: "buy",
    quantity: "1.25",
    price: "2525.00",
    clientOrderId,
  });

  assert.deepEqual(result, {
    state: "filled",
    externalOrderId: clientOrderId,
    venueOrderId: "100234",
    executedQuantity: "1.25000000",
    executedQuoteQuantity: "3125.50000000",
  });
  assert.equal(calls[1].init.method, "POST");
  assert.equal(calls[1].init.headers["X-MBX-APIKEY"], config.apiKey);
  assert.equal(calls[1].url.searchParams.get("side"), "BUY");
  assert.equal(calls[1].url.searchParams.get("type"), "LIMIT");
  assert.equal(calls[1].url.searchParams.get("timeInForce"), "GTC");
  assert.equal(calls[1].url.searchParams.get("price"), "2525.00");
  assert.equal(calls[1].url.searchParams.get("newClientOrderId"), clientOrderId);
  const signed = new URLSearchParams(calls[1].url.searchParams);
  const signature = signed.get("signature");
  signed.delete("signature");
  assert.equal(signature, createHmac("sha256", config.apiSecret).update(signed.toString()).digest("hex"));
});

test("BinanceSpotAdapter classifies pending, terminal, retryable, and permanent responses", async () => {
  let response = jsonResponse({
    symbol: "ETHUSDT",
    orderId: 100234,
    clientOrderId,
    status: "PARTIALLY_FILLED",
    executedQty: "0.5",
    cummulativeQuoteQty: "1250.25",
  });
  const adapter = new BinanceSpotAdapter(config, async () => response, () => 1_700_000_000_000);
  assert.equal((await adapter.queryOrder({ symbol: "ETHUSDT", clientOrderId })).state, "pending");

  response = jsonResponse({
    symbol: "ETHUSDT",
    orderId: 100234,
    clientOrderId,
    status: "REJECTED",
    executedQty: "0",
    cummulativeQuoteQty: "0",
  });
  assert.deepEqual(await adapter.queryOrder({ symbol: "ETHUSDT", clientOrderId }), {
    state: "failed",
    externalOrderId: clientOrderId,
    venueOrderId: "100234",
    executedQuantity: "0",
    executedQuoteQuantity: "0",
    failureCode: "BINANCE_ORDER_REJECTED",
  });

  response = jsonResponse({ code: -1003, msg: "Too many requests" }, 429, { "retry-after": "7" });
  await assert.rejects(
    adapter.queryOrder({ symbol: "ETHUSDT", clientOrderId }),
    (error) => error instanceof CexVenueError && error.retryable &&
      error.errorCode === "BINANCE_CODE_1003" && error.retryAfterMs === 7000,
  );

  response = jsonResponse({ code: -1013, msg: "Invalid quantity" }, 400);
  await assert.rejects(
    adapter.submitLimitOrder({ symbol: "ETHUSDT", side: "sell", quantity: "1", price: "2475", clientOrderId }),
    (error) => error instanceof CexVenueError && !error.retryable && error.errorCode === "BINANCE_CODE_1013",
  );

  response = jsonResponse({ code: -2010, msg: "Duplicate order sent." }, 400);
  await assert.rejects(
    adapter.submitLimitOrder({ symbol: "ETHUSDT", side: "sell", quantity: "1", price: "2475", clientOrderId }),
    (error) => error instanceof CexVenueError && error.retryable && error.errorCode === "BINANCE_CODE_2010",
  );
});

test("BinanceSpotAdapter treats transport ambiguity and malformed venue data safely", async () => {
  const networkFailure = new BinanceSpotAdapter(config, async () => { throw new Error("timeout"); });
  await assert.rejects(
    networkFailure.queryOrder({ symbol: "ETHUSDT", clientOrderId }),
    (error) => error instanceof CexVenueError && error.retryable && error.errorCode === "BINANCE_REQUEST_FAILED",
  );

  const malformed = new BinanceSpotAdapter(config, async () => jsonResponse({
    symbol: "BTCUSDT",
    orderId: 100234,
    clientOrderId,
    status: "FILLED",
    executedQty: "1",
    cummulativeQuoteQty: "2500",
  }));
  await assert.rejects(
    malformed.queryOrder({ symbol: "ETHUSDT", clientOrderId }),
    /BINANCE_RESPONSE_INVALID/,
  );

  const missingQuoteEvidence = new BinanceSpotAdapter(config, async () => jsonResponse({
    symbol: "ETHUSDT",
    orderId: 100234,
    clientOrderId,
    status: "FILLED",
    executedQty: "1",
  }));
  await assert.rejects(
    missingQuoteEvidence.queryOrder({ symbol: "ETHUSDT", clientOrderId }),
    /BINANCE_RESPONSE_INVALID/,
  );
});

test("BinanceSpotAdapter resynchronizes clock once and retries timestamp-rejected requests", async () => {
  const localTime = 1_700_000_000_000;
  const serverTime = localTime + 2_500;
  const calls = [];
  let orderCalls = 0;
  const fetchFn = async (input, init) => {
    const url = new URL(input);
    calls.push({ url, init });
    if (url.pathname === "/api/v3/time") return jsonResponse({ serverTime });
    orderCalls += 1;
    if (orderCalls === 1) return jsonResponse({ code: -1021, msg: "Timestamp outside recvWindow." }, 400);
    return jsonResponse({
      symbol: "ETHUSDT",
      orderId: 100234,
      clientOrderId,
      status: "FILLED",
      executedQty: "1.25",
      cummulativeQuoteQty: "3125",
    });
  };
  const adapter = new BinanceSpotAdapter(config, fetchFn, () => localTime);

  assert.equal((await adapter.submitLimitOrder({
    symbol: "ETHUSDT",
    side: "buy",
    quantity: "1.25",
    price: "2525",
    clientOrderId,
  })).state, "filled");
  assert.deepEqual(calls.map(({ url }) => url.pathname), [
    "/api/v3/order",
    "/api/v3/time",
    "/api/v3/order",
  ]);
  assert.equal(calls[0].url.searchParams.get("timestamp"), String(localTime));
  assert.equal(calls[2].url.searchParams.get("timestamp"), String(serverTime));
  assert.notEqual(calls[0].url.searchParams.get("signature"), calls[2].url.searchParams.get("signature"));
  const retriedParams = new URLSearchParams(calls[2].url.searchParams);
  const retriedSignature = retriedParams.get("signature");
  retriedParams.delete("signature");
  assert.equal(
    retriedSignature,
    createHmac("sha256", config.apiSecret).update(retriedParams.toString()).digest("hex"),
  );
  assert.equal(calls[1].url.searchParams.has("signature"), false);
  assert.equal(calls[1].init.headers, undefined);
  assert.deepEqual(calls.map(({ init }) => init.method), ["POST", "GET", "POST"]);
  assert.equal(calls[0].url.searchParams.get("newClientOrderId"), clientOrderId);
  assert.equal(calls[2].url.searchParams.get("newClientOrderId"), clientOrderId);
});

test("BinanceSpotAdapter single-flights concurrent clock synchronization and fails closed on malformed time", async () => {
  const localTime = 1_700_000_000_000;
  const timeResponse = deferred();
  let timeCalls = 0;
  let signedCalls = 0;
  const fetchFn = async (input) => {
    const url = new URL(input);
    if (url.pathname === "/api/v3/time") {
      timeCalls += 1;
      return timeResponse.promise;
    }
    signedCalls += 1;
    if (signedCalls <= 2) return jsonResponse({ code: -1021, msg: "Invalid timestamp." }, 400);
    return jsonResponse({ code: -2013, msg: "Order does not exist." }, 400);
  };
  const adapter = new BinanceSpotAdapter(config, fetchFn, () => localTime);
  const first = adapter.queryOrder({ symbol: "ETHUSDT", clientOrderId });
  const second = adapter.queryOrder({ symbol: "ETHUSDT", clientOrderId });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(timeCalls, 1);
  timeResponse.resolve(jsonResponse({ serverTime: localTime + 100 }));
  assert.deepEqual(await Promise.all([first, second]), [undefined, undefined]);
  assert.equal(signedCalls, 4);

  const malformed = new BinanceSpotAdapter(config, async (input) => {
    return new URL(input).pathname === "/api/v3/time"
      ? jsonResponse({ serverTime: "not-a-number" })
      : jsonResponse({ code: -1021, msg: "Invalid timestamp." }, 400);
  }, () => localTime);
  await assert.rejects(
    malformed.queryOrder({ symbol: "ETHUSDT", clientOrderId }),
    (error) => error instanceof CexVenueError && error.retryable &&
      error.errorCode === "BINANCE_TIME_SYNC_FAILED",
  );

  const excessiveOffset = new BinanceSpotAdapter(config, async (input) => {
    return new URL(input).pathname === "/api/v3/time"
      ? jsonResponse({ serverTime: localTime + 86_400_001 })
      : jsonResponse({ code: -1021, msg: "Invalid timestamp." }, 400);
  }, () => localTime);
  await assert.rejects(
    excessiveOffset.queryOrder({ symbol: "ETHUSDT", clientOrderId }),
    (error) => error instanceof CexVenueError && error.retryable &&
      error.errorCode === "BINANCE_TIME_SYNC_FAILED",
  );
});

test("BinanceSpotAdapter rejects unsafe credentials, URLs, and order inputs", async () => {
  assert.throws(() => new BinanceSpotAdapter({ ...config, apiSecret: "bad secret" }), /apiSecret/);
  assert.throws(() => new BinanceSpotAdapter({ ...config, baseUrl: "http://api.binance.com" }), /HTTPS origin/);
  const adapter = new BinanceSpotAdapter(config, async () => jsonResponse({}));
  await assert.rejects(
    adapter.submitLimitOrder({ symbol: "ETHUSDT", side: "buy", quantity: "01", price: "2525", clientOrderId }),
    /quantity/,
  );
  await assert.rejects(
    adapter.submitLimitOrder({ symbol: "ETHUSDT", side: "buy", quantity: "1", price: "0", clientOrderId }),
    /price/,
  );
});

test("BinanceSpotAdapter retrieves and validates paginated account trade fees", async () => {
  const calls = [];
  const firstPage = Array.from({ length: 1000 }, (_, index) => trade(index + 1));
  const fetchFn = async (input, init) => {
    const url = new URL(input);
    calls.push({ url, init });
    return jsonResponse(url.searchParams.has("fromId") ? [trade(1001)] : firstPage);
  };
  const adapter = new BinanceSpotAdapter(config, fetchFn, () => 1_700_000_000_000);

  const fills = await adapter.queryOrderTrades({ symbol: "ETHUSDT", venueOrderId: "100234" });

  assert.equal(fills.length, 1001);
  assert.deepEqual(fills[0], {
    venueTradeId: "1",
    venueOrderId: "100234",
    price: "2500.5",
    quantity: "0.01",
    quoteQuantity: "25.005",
    commissionQuantity: "0.00001",
    commissionAsset: "BNB",
    executedAt: "2023-11-14T22:13:20.001Z",
    isBuyer: true,
    isMaker: false,
  });
  assert.equal(calls[0].url.pathname, "/api/v3/myTrades");
  assert.equal(calls[0].url.searchParams.get("orderId"), "100234");
  assert.equal(calls[0].url.searchParams.get("limit"), "1000");
  assert.equal(calls[1].url.searchParams.get("fromId"), "1001");
});

test("BinanceSpotAdapter rejects unsafe numeric identifiers and malformed trade evidence", async () => {
  let response = jsonResponse({
    symbol: "ETHUSDT",
    orderId: 9007199254740992,
    clientOrderId,
    status: "FILLED",
    executedQty: "1",
    cummulativeQuoteQty: "2500",
  });
  const adapter = new BinanceSpotAdapter(config, async () => response, () => 1_700_000_000_000);
  await assert.rejects(adapter.queryOrder({ symbol: "ETHUSDT", clientOrderId }), /BINANCE_RESPONSE_INVALID/);

  response = jsonResponse([{ ...trade(1), commission: "-1" }]);
  await assert.rejects(
    adapter.queryOrderTrades({ symbol: "ETHUSDT", venueOrderId: "100234" }),
    /BINANCE_RESPONSE_INVALID/,
  );
});

function trade(id) {
  return {
    symbol: "ETHUSDT",
    id,
    orderId: 100234,
    price: "2500.5",
    qty: "0.01",
    quoteQty: "25.005",
    commission: "0.00001",
    commissionAsset: "BNB",
    time: 1_700_000_000_000 + id,
    isBuyer: true,
    isMaker: false,
  };
}

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
