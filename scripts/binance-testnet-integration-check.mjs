#!/usr/bin/env node

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { BinanceSpotAdapter } from "../backend/dist/modules/hedge/binance-spot.adapter.js";
import { HedgeRouteTable } from "../backend/dist/modules/hedge/hedge-route.js";
import { BinanceSymbolRulesService } from "../backend/dist/modules/hedge/binance-symbol-rules.js";
import { parseCexDecimal } from "../backend/dist/modules/market-data/cex-orderbook/decimal.js";

const testnetBaseUrl = "https://testnet.binance.vision";
if (process.env.RFQ_BINANCE_TESTNET_INTEGRATION_CONFIRM !== "place-and-cancel") {
  throw new Error(
    "RFQ_BINANCE_TESTNET_INTEGRATION_CONFIRM=place-and-cancel is required because this check places a Spot Testnet order",
  );
}

const apiKey = readCredential("RFQ_BINANCE_TESTNET_API_KEY");
const apiSecret = readCredential("RFQ_BINANCE_TESTNET_API_SECRET");
const symbol = readSymbol("RFQ_BINANCE_TESTNET_SYMBOL");
const side = readSide("RFQ_BINANCE_TESTNET_SIDE");
const quantity = readDecimal("RFQ_BINANCE_TESTNET_QUANTITY", 36);
const price = readDecimal("RFQ_BINANCE_TESTNET_PRICE", 18);
const baseAsset = readAsset("RFQ_BINANCE_TESTNET_BASE_ASSET");
const quoteAsset = readAsset("RFQ_BINANCE_TESTNET_QUOTE_ASSET");
const tokenDecimals = readInteger("RFQ_BINANCE_TESTNET_TOKEN_DECIMALS", undefined, 0, 36);
const quoteTokenDecimals = readInteger("RFQ_BINANCE_TESTNET_QUOTE_TOKEN_DECIMALS", undefined, 0, 18);
const stepSizeRaw = readPositiveInteger("RFQ_BINANCE_TESTNET_STEP_SIZE_RAW");
const priceTick = readDecimal("RFQ_BINANCE_TESTNET_PRICE_TICK", 18);
const minBookDistanceBps = readInteger("RFQ_BINANCE_TESTNET_MIN_BOOK_DISTANCE_BPS", 100, 10, 5_000);
const requestTimeoutMs = readInteger("RFQ_BINANCE_TESTNET_REQUEST_TIMEOUT_MS", 10_000, 1_000, 60_000);
assert.notEqual(baseAsset, quoteAsset, "Binance Testnet base and quote assets must be distinct");

const ticker = await readBookTicker(symbol, requestTimeoutMs);
assertNonMarketablePrice(side, price, ticker, minBookDistanceBps);

const routes = new HedgeRouteTable([{
  chainId: 1,
  token: "0x0000000000000000000000000000000000000001",
  venue: "binance",
  symbol,
  baseAsset,
  quoteAsset,
  quoteToken: "0x0000000000000000000000000000000000000002",
  tokenDecimals,
  quoteTokenDecimals,
  stepSizeRaw,
  priceTick,
  maxSlippageBps: 0,
}]);
const rules = new BinanceSymbolRulesService({
  baseUrl: testnetBaseUrl,
  requestTimeoutMs,
  maxAgeMs: 10_000,
}, routes);
const adapter = new BinanceSpotAdapter({
  apiKey,
  apiSecret,
  baseUrl: testnetBaseUrl,
  recvWindowMs: 5_000,
  requestTimeoutMs,
}, rules);
const clientOrderId = `rfq_canary_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;
const orderInput = { symbol, side, quantity, price, clientOrderId };
let orderMayExist = false;

await rules.checkHealth();
await adapter.validateLimitOrder({ symbol, quantity, price });
assert.equal(await adapter.queryOrder({ symbol, clientOrderId }), undefined,
  "Binance Testnet canary client order id must be absent before submission");

try {
  orderMayExist = true;
  const submitted = await adapter.submitLimitOrder(orderInput);
  assertPendingZeroFill(submitted, clientOrderId, "submitted");

  const queried = await adapter.queryOrder({ symbol, clientOrderId });
  assert.ok(queried, "Binance Testnet canary order must be queryable after submission");
  assertPendingZeroFill(queried, clientOrderId, "queried");
  assert.equal(queried.venueOrderId, submitted.venueOrderId,
    "Binance Testnet query must preserve venue order identity");

  const canceled = await adapter.cancelOrder({ symbol, clientOrderId });
  assertCanceledZeroFill(canceled, clientOrderId, "canceled");
  orderMayExist = false;
  assert.equal(canceled.venueOrderId, submitted.venueOrderId,
    "Binance Testnet cancellation must preserve venue order identity");

  const terminal = await adapter.queryOrder({ symbol, clientOrderId });
  assert.ok(terminal, "Binance Testnet canceled order must remain queryable");
  assertCanceledZeroFill(terminal, clientOrderId, "terminal query");
  assert.equal(terminal.venueOrderId, submitted.venueOrderId,
    "Binance Testnet terminal query must preserve venue order identity");

  const fills = await adapter.queryOrderTrades({ symbol, venueOrderId: submitted.venueOrderId });
  assert.deepEqual(fills, [], "Binance Testnet non-marketable canary must have no fills");

  process.stdout.write(`${JSON.stringify({
    status: "ok",
    venue: "binance-spot-testnet",
    symbol,
    side,
    quantity,
    price,
    clientOrderId,
    venueOrderId: submitted.venueOrderId,
    lifecycle: ["absent", "pending", "queried", "canceled", "terminal", "zero-fills"],
    ticker: {
      bestBid: ticker.bestBid,
      bestAsk: ticker.bestAsk,
      minBookDistanceBps,
    },
  }, null, 2)}\n`);
} catch (error) {
  if (orderMayExist) {
    try {
      const observed = await adapter.queryOrder({ symbol, clientOrderId });
      if (observed?.state === "pending") {
        const canceled = await adapter.cancelOrder({ symbol, clientOrderId });
        assertCanceledZeroFill(canceled, clientOrderId, "cleanup cancellation");
      } else if (observed !== undefined) {
        assertCanceledZeroFill(observed, clientOrderId, "cleanup terminal query");
      } else {
        throw new Error(
          `Binance Testnet cleanup could not confirm terminal state for client order ${clientOrderId}`,
        );
      }
      orderMayExist = false;
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError],
        "Binance Testnet canary failed and cleanup cancellation was not confirmed");
    }
  }
  throw error;
}

async function readBookTicker(expectedSymbol, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref();
  try {
    const url = new URL("/api/v3/ticker/bookTicker", testnetBaseUrl);
    url.searchParams.set("symbol", expectedSymbol);
    const response = await fetch(url, { method: "GET", signal: controller.signal });
    assert.equal(response.ok, true, `Binance Testnet book ticker returned HTTP ${response.status}`);
    const value = await response.json();
    if (typeof value !== "object" || value === null || Array.isArray(value) || value.symbol !== expectedSymbol) {
      throw new Error("Binance Testnet book ticker payload is invalid");
    }
    const bestBid = readVenueDecimal(value.bidPrice, "Binance Testnet best bid");
    const bestAsk = readVenueDecimal(value.askPrice, "Binance Testnet best ask");
    if (bestAsk.value <= bestBid.value) throw new Error("Binance Testnet book ticker is crossed or empty");
    return { bestBid: bestBid.raw, bestBidValue: bestBid.value, bestAsk: bestAsk.raw, bestAskValue: bestAsk.value };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Binance Testnet book ticker request timed out");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function assertNonMarketablePrice(orderSide, orderPrice, tickerValue, distanceBps) {
  const orderPriceValue = parseCexDecimal(orderPrice, "Binance Testnet canary price", false);
  if (orderSide === "buy") {
    assert.equal(
      orderPriceValue * 10_000n <= tickerValue.bestBidValue * BigInt(10_000 - distanceBps),
      true,
      `Binance Testnet buy price must be at least ${distanceBps} bps below best bid`,
    );
    return;
  }
  assert.equal(
    orderPriceValue * 10_000n >= tickerValue.bestAskValue * BigInt(10_000 + distanceBps),
    true,
    `Binance Testnet sell price must be at least ${distanceBps} bps above best ask`,
  );
}

function assertPendingZeroFill(order, expectedClientOrderId, stage) {
  assert.equal(order.state, "pending", `Binance Testnet ${stage} order must be pending`);
  assert.equal(order.externalOrderId, expectedClientOrderId,
    `Binance Testnet ${stage} order client id mismatch`);
  assert.equal(isZeroDecimal(order.executedQuantity), true,
    `Binance Testnet ${stage} order must have zero executed quantity`);
  assert.equal(isZeroDecimal(order.executedQuoteQuantity), true,
    `Binance Testnet ${stage} order must have zero executed quote quantity`);
}

function assertCanceledZeroFill(order, expectedClientOrderId, stage) {
  assert.equal(order.state, "failed", `Binance Testnet ${stage} order must be terminal`);
  assert.equal(order.failureCode, "BINANCE_ORDER_CANCELED",
    `Binance Testnet ${stage} order must be canceled`);
  assert.equal(order.externalOrderId, expectedClientOrderId,
    `Binance Testnet ${stage} order client id mismatch`);
  assert.equal(isZeroDecimal(order.executedQuantity), true,
    `Binance Testnet ${stage} order must have zero executed quantity`);
  assert.equal(isZeroDecimal(order.executedQuoteQuantity), true,
    `Binance Testnet ${stage} order must have zero executed quote quantity`);
}

function isZeroDecimal(value) {
  return typeof value === "string" && /^0(?:\.0+)?$/.test(value);
}

function readVenueDecimal(value, field) {
  if (typeof value !== "string") throw new Error(`${field} must be a decimal string`);
  return { raw: value, value: parseCexDecimal(value, field, false) };
}

function readCredential(field) {
  const value = process.env[field];
  if (typeof value !== "string" || value.length === 0 || value.length > 256 || /\s/.test(value)) {
    throw new Error(`${field} must be a non-empty whitespace-free string no longer than 256 characters`);
  }
  return value;
}

function readSymbol(field) {
  const value = process.env[field];
  if (typeof value !== "string" || !/^[A-Z0-9._-]{3,32}$/.test(value)) {
    throw new Error(`${field} must be a 3-32 character uppercase exchange symbol`);
  }
  return value;
}

function readSide(field) {
  const value = process.env[field];
  if (value !== "buy" && value !== "sell") throw new Error(`${field} must be buy or sell`);
  return value;
}

function readAsset(field) {
  const value = process.env[field];
  if (typeof value !== "string" || !/^[A-Z0-9._-]{1,32}$/.test(value)) {
    throw new Error(`${field} must be a 1-32 character uppercase venue asset`);
  }
  return value;
}

function readDecimal(field, maxFractionDigits) {
  const value = process.env[field];
  const match = typeof value === "string" ? /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/.exec(value) : null;
  if (!match || value.length > 80 || (match[2]?.length ?? 0) > maxFractionDigits || isZeroDecimal(value)) {
    throw new Error(`${field} must be a positive canonical decimal with at most ${maxFractionDigits} fractional digits`);
  }
  return value;
}

function readPositiveInteger(field) {
  const value = process.env[field];
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value) || value.length > 80) {
    throw new Error(`${field} must be a canonical positive integer`);
  }
  return value;
}

function readInteger(field, fallback, min, max) {
  const value = process.env[field];
  if (value === undefined || value.length === 0) {
    if (fallback !== undefined) return fallback;
    throw new Error(`${field} is required`);
  }
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error(`${field} must be an integer between ${min} and ${max}`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${field} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}
