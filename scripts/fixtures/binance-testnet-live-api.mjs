import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

const apiKey = "testnet-api-key";
const apiSecret = "testnet-api-secret";
const symbol = "BTCUSDT";
const orderId = 123;
const fixtureMode = process.env.RFQ_BINANCE_TESTNET_FIXTURE_MODE;
const workerFilledMode = fixtureMode === "worker-filled";
const coreFlowFilledMode = fixtureMode === "core-flow-filled";
const originalFetch = globalThis.fetch;
let clientOrderId;
let orderState = "absent";
let orderSide;
let orderQuantity;
let orderPrice;
let executedQuoteQuantity;
let commissionQuantity;
let tradeQueried = false;

process.on("exit", () => {
  if (fixtureMode === "submit-response-invalid") {
    assert.equal(orderState, "canceled", "canary must clean up an accepted order after an invalid submit response");
  }
  if (coreFlowFilledMode) {
    assert.equal(orderState, "filled", "core-flow fixture must execute exactly one hedge order");
    assert.equal(tradeQueried, true, "core-flow fixture must reconcile exact trade evidence");
  }
});

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  if (url.origin !== "https://testnet.binance.vision") {
    return originalFetch(input, init);
  }
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
          { filterType: "MIN_NOTIONAL", minNotional: coreFlowFilledMode ? "0.01" : "10.00" },
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
    orderSide = url.searchParams.get("side");
    orderQuantity = url.searchParams.get("quantity");
    orderPrice = url.searchParams.get("price");
    assert.equal(orderSide, coreFlowFilledMode ? "SELL" : "BUY");
    assert.equal(url.searchParams.get("type"), "LIMIT");
    assert.equal(url.searchParams.get("timeInForce"), "GTC");
    if (coreFlowFilledMode) {
      assert.equal(orderQuantity, "10");
      assert.match(orderPrice ?? "", /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/);
      assert.ok(decimalToScaled(orderPrice, 18) > 0n);
      executedQuoteQuantity = multiplyDecimals(orderQuantity, orderPrice);
      commissionQuantity = divideDecimal(executedQuoteQuantity, 1_000n);
    } else {
      assert.equal(orderQuantity, "0.2");
      assert.equal(orderPrice, "90");
      executedQuoteQuantity = "18.00000000";
      commissionQuantity = "0.01800000";
    }
    clientOrderId = url.searchParams.get("newClientOrderId");
    assert.match(clientOrderId, workerFilledMode || coreFlowFilledMode
      ? /^rfq_[0-9a-f]{32}$/
      : /^rfq_canary_[a-z0-9]+_[0-9a-f]{8}$/);
    orderState = workerFilledMode || coreFlowFilledMode ? "filled" : "pending";
    if (fixtureMode === "submit-response-invalid") {
      const response = orderResponse("NEW");
      delete response.status;
      return jsonResponse(200, response);
    }
    return jsonResponse(200, orderResponse(workerFilledMode || coreFlowFilledMode ? "FILLED" : "NEW"));
  }

  if (url.pathname === "/api/v3/order" && method === "DELETE") {
    assert.equal(orderState, "pending");
    assert.equal(url.searchParams.get("origClientOrderId"), clientOrderId);
    orderState = "canceled";
    return jsonResponse(200, orderResponse("CANCELED"));
  }

  if (url.pathname === "/api/v3/myTrades" && method === "GET") {
    assert.equal(orderState, workerFilledMode || coreFlowFilledMode ? "filled" : "canceled");
    assert.equal(url.searchParams.get("orderId"), String(orderId));
    assert.equal(url.searchParams.get("limit"), "1000");
    tradeQueried = true;
    return jsonResponse(200, workerFilledMode || coreFlowFilledMode ? [tradeResponse()] : []);
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
    executedQty: filled ? orderQuantity : "0.00000000",
    cummulativeQuoteQty: filled ? executedQuoteQuantity : "0.00000000",
  };
}

function tradeResponse() {
  return {
    symbol,
    id: 456,
    orderId,
    price: orderPrice,
    qty: orderQuantity,
    quoteQty: executedQuoteQuantity,
    commission: commissionQuantity,
    commissionAsset: "USDT",
    time: 1_700_000_000_000,
    isBuyer: orderSide === "BUY",
    isMaker: false,
  };
}

function multiplyDecimals(left, right) {
  const scale = 10n ** 18n;
  const product = decimalToScaled(left, 18) * decimalToScaled(right, 18);
  assert.equal(product % scale, 0n, "fixture product must fit 18 decimal places exactly");
  return formatScaled(product / scale, 18);
}

function divideDecimal(value, divisor) {
  const scaled = decimalToScaled(value, 18);
  assert.equal(scaled % divisor, 0n, "fixture commission must fit 18 decimal places exactly");
  return formatScaled(scaled / divisor, 18);
}

function decimalToScaled(value, scale) {
  assert.equal(typeof value, "string");
  const match = value.match(/^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/);
  assert.ok(match && (match[2]?.length ?? 0) <= scale, "fixture decimal is invalid");
  const fraction = match[2] ?? "";
  return BigInt(match[1]) * 10n ** BigInt(scale) +
    BigInt(`${fraction}${"0".repeat(scale - fraction.length)}` || "0");
}

function formatScaled(value, scale) {
  const raw = value.toString().padStart(scale + 1, "0");
  const fraction = raw.slice(-scale).replace(/0+$/, "");
  return `${raw.slice(0, -scale)}${fraction ? `.${fraction}` : ""}`;
}

function jsonResponse(status, value) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}
