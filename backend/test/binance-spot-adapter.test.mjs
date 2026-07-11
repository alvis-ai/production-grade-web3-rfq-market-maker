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

test("BinanceSpotAdapter signs query-first market order execution", async () => {
  const calls = [];
  const fetchFn = async (input, init) => {
    const url = new URL(input);
    calls.push({ url, init });
    if (init.method === "GET") return jsonResponse({ code: -2013, msg: "Order does not exist." }, 400);
    return jsonResponse({ symbol: "ETHUSDT", clientOrderId, status: "FILLED", executedQty: "1.25000000" });
  };
  const adapter = new BinanceSpotAdapter(config, fetchFn, () => 1_700_000_000_000);

  assert.equal(await adapter.queryOrder({ symbol: "ETHUSDT", clientOrderId }), undefined);
  const result = await adapter.submitMarketOrder({
    symbol: "ETHUSDT",
    side: "buy",
    quantity: "1.25",
    clientOrderId,
  });

  assert.deepEqual(result, { state: "filled", externalOrderId: clientOrderId, executedQuantity: "1.25000000" });
  assert.equal(calls[1].init.method, "POST");
  assert.equal(calls[1].init.headers["X-MBX-APIKEY"], config.apiKey);
  assert.equal(calls[1].url.searchParams.get("side"), "BUY");
  assert.equal(calls[1].url.searchParams.get("type"), "MARKET");
  assert.equal(calls[1].url.searchParams.get("newClientOrderId"), clientOrderId);
  const signed = new URLSearchParams(calls[1].url.searchParams);
  const signature = signed.get("signature");
  signed.delete("signature");
  assert.equal(signature, createHmac("sha256", config.apiSecret).update(signed.toString()).digest("hex"));
});

test("BinanceSpotAdapter classifies pending, terminal, retryable, and permanent responses", async () => {
  let response = jsonResponse({ symbol: "ETHUSDT", clientOrderId, status: "PARTIALLY_FILLED", executedQty: "0.5" });
  const adapter = new BinanceSpotAdapter(config, async () => response, () => 1_700_000_000_000);
  assert.equal((await adapter.queryOrder({ symbol: "ETHUSDT", clientOrderId })).state, "pending");

  response = jsonResponse({ symbol: "ETHUSDT", clientOrderId, status: "REJECTED", executedQty: "0" });
  assert.deepEqual(await adapter.queryOrder({ symbol: "ETHUSDT", clientOrderId }), {
    state: "failed",
    externalOrderId: clientOrderId,
    executedQuantity: "0",
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
    adapter.submitMarketOrder({ symbol: "ETHUSDT", side: "sell", quantity: "1", clientOrderId }),
    (error) => error instanceof CexVenueError && !error.retryable && error.errorCode === "BINANCE_CODE_1013",
  );

  response = jsonResponse({ code: -2010, msg: "Duplicate order sent." }, 400);
  await assert.rejects(
    adapter.submitMarketOrder({ symbol: "ETHUSDT", side: "sell", quantity: "1", clientOrderId }),
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
    clientOrderId,
    status: "FILLED",
    executedQty: "1",
  }));
  await assert.rejects(
    malformed.queryOrder({ symbol: "ETHUSDT", clientOrderId }),
    /BINANCE_RESPONSE_INVALID/,
  );
});

test("BinanceSpotAdapter rejects unsafe credentials, URLs, and order inputs", async () => {
  assert.throws(() => new BinanceSpotAdapter({ ...config, apiSecret: "bad secret" }), /apiSecret/);
  assert.throws(() => new BinanceSpotAdapter({ ...config, baseUrl: "http://api.binance.com" }), /HTTPS origin/);
  const adapter = new BinanceSpotAdapter(config, async () => jsonResponse({}));
  await assert.rejects(
    adapter.submitMarketOrder({ symbol: "ETHUSDT", side: "buy", quantity: "01", clientOrderId }),
    /quantity/,
  );
});

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}
