import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

const apiKey = "testnet-api-key";
const apiSecret = "testnet-api-secret";
const symbol = "BTCUSDT";
const orderId = 123;
const fixtureMode = process.env.RFQ_BINANCE_TESTNET_FIXTURE_MODE;
const workerFilledMode = fixtureMode === "worker-filled";
let clientOrderId;
let orderState = "absent";

process.on("exit", () => {
  if (fixtureMode === "submit-response-invalid") {
    assert.equal(orderState, "canceled", "canary must clean up an accepted order after an invalid submit response");
  }
});

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  assert.equal(url.origin, "https://testnet.binance.vision");
  const method = init.method ?? "GET";

  if (url.pathname === "/api/v3/ticker/bookTicker") {
    assert.equal(method, "GET");
    assert.equal(url.searchParams.get("symbol"), symbol);
    return jsonResponse(200, {
      symbol,
      bidPrice: "100.00",
      bidQty: "10.00",
      askPrice: "101.00",
      askQty: "10.00",
    });
  }

  if (url.pathname === "/api/v3/exchangeInfo") {
    assert.equal(method, "GET");
    assert.equal(url.searchParams.get("symbol"), symbol);
    return jsonResponse(200, {
      timezone: "UTC",
      serverTime: Date.now(),
      symbols: [{
        symbol,
        status: "TRADING",
        baseAsset: "BTC",
        quoteAsset: "USDT",
        isSpotTradingAllowed: true,
        orderTypes: ["LIMIT"],
        filters: [
          { filterType: "PRICE_FILTER", minPrice: "0.01", maxPrice: "1000000.00", tickSize: "0.01" },
          { filterType: "LOT_SIZE", minQty: "0.001", maxQty: "100.000", stepSize: "0.001" },
          { filterType: "MIN_NOTIONAL", minNotional: "10.00" },
        ],
      }],
    });
  }

  assert.equal(new Headers(init.headers).get("x-mbx-apikey"), apiKey);
  assertSigned(url);
  assert.equal(url.searchParams.get("symbol"), symbol);

  if (url.pathname === "/api/v3/order" && method === "GET") {
    const requestedId = url.searchParams.get("origClientOrderId");
    if (orderState === "absent") {
      return jsonResponse(400, { code: -2013, msg: "Order does not exist." });
    }
    assert.equal(requestedId, clientOrderId);
    return jsonResponse(200, orderResponse(
      orderState === "canceled" ? "CANCELED" : orderState === "filled" ? "FILLED" : "NEW",
    ));
  }

  if (url.pathname === "/api/v3/order" && method === "POST") {
    assert.equal(orderState, "absent");
    assert.equal(url.searchParams.get("side"), "BUY");
    assert.equal(url.searchParams.get("type"), "LIMIT");
    assert.equal(url.searchParams.get("timeInForce"), "GTC");
    assert.equal(url.searchParams.get("quantity"), "0.2");
    assert.equal(url.searchParams.get("price"), "90");
    clientOrderId = url.searchParams.get("newClientOrderId");
    assert.match(clientOrderId, workerFilledMode ? /^rfq_[0-9a-f]{32}$/ : /^rfq_canary_[a-z0-9]+_[0-9a-f]{8}$/);
    orderState = workerFilledMode ? "filled" : "pending";
    if (fixtureMode === "submit-response-invalid") {
      const response = orderResponse("NEW");
      delete response.status;
      return jsonResponse(200, response);
    }
    return jsonResponse(200, orderResponse(workerFilledMode ? "FILLED" : "NEW"));
  }

  if (url.pathname === "/api/v3/order" && method === "DELETE") {
    assert.equal(orderState, "pending");
    assert.equal(url.searchParams.get("origClientOrderId"), clientOrderId);
    orderState = "canceled";
    return jsonResponse(200, orderResponse("CANCELED"));
  }

  if (url.pathname === "/api/v3/myTrades" && method === "GET") {
    assert.equal(orderState, workerFilledMode ? "filled" : "canceled");
    assert.equal(url.searchParams.get("orderId"), String(orderId));
    assert.equal(url.searchParams.get("limit"), "1000");
    return jsonResponse(200, workerFilledMode ? [tradeResponse()] : []);
  }

  throw new Error(`Unexpected Binance Testnet request ${method} ${url.pathname}`);
};

function assertSigned(url) {
  const signature = url.searchParams.get("signature");
  assert.match(signature ?? "", /^[0-9a-f]{64}$/);
  const unsigned = new URLSearchParams(url.searchParams);
  unsigned.delete("signature");
  const expected = createHmac("sha256", apiSecret).update(unsigned.toString()).digest("hex");
  assert.equal(signature, expected);
  assert.match(unsigned.get("timestamp") ?? "", /^[1-9][0-9]+$/);
  assert.equal(unsigned.get("recvWindow"), "5000");
}

function orderResponse(status) {
  const filled = status === "FILLED";
  return {
    symbol,
    orderId,
    clientOrderId,
    status,
    executedQty: filled ? "0.20000000" : "0.00000000",
    cummulativeQuoteQty: filled ? "18.00000000" : "0.00000000",
  };
}

function tradeResponse() {
  return {
    symbol,
    id: 456,
    orderId,
    price: "90.00000000",
    qty: "0.20000000",
    quoteQty: "18.00000000",
    commission: "0.01800000",
    commissionAsset: "USDT",
    time: 1_700_000_000_000,
    isBuyer: true,
    isMaker: false,
  };
}

function jsonResponse(status, value) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}
