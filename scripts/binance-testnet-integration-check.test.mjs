import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const command = [
  "--import",
  "./scripts/fixtures/binance-testnet-live-api.mjs",
  "./scripts/binance-testnet-integration-check.mjs",
];
const baseEnvironment = {
  ...process.env,
  RFQ_BINANCE_TESTNET_INTEGRATION_CONFIRM: "place-and-cancel",
  RFQ_BINANCE_TESTNET_API_KEY: "testnet-api-key",
  RFQ_BINANCE_TESTNET_API_SECRET: "testnet-api-secret",
  RFQ_BINANCE_TESTNET_SYMBOL: "BTCUSDT",
  RFQ_BINANCE_TESTNET_SIDE: "buy",
  RFQ_BINANCE_TESTNET_QUANTITY: "0.2",
  RFQ_BINANCE_TESTNET_PRICE: "90",
  RFQ_BINANCE_TESTNET_BASE_ASSET: "BTC",
  RFQ_BINANCE_TESTNET_QUOTE_ASSET: "USDT",
  RFQ_BINANCE_TESTNET_TOKEN_DECIMALS: "18",
  RFQ_BINANCE_TESTNET_QUOTE_TOKEN_DECIMALS: "6",
  RFQ_BINANCE_TESTNET_STEP_SIZE_RAW: "1000000000000000",
  RFQ_BINANCE_TESTNET_PRICE_TICK: "0.01",
};

test("Binance Spot Testnet canary validates, places, queries, cancels, and proves zero fills", async () => {
  const { stdout, stderr } = await execFileAsync(process.execPath, command, {
    cwd: new URL("..", import.meta.url),
    env: baseEnvironment,
    timeout: 10_000,
  });

  assert.equal(stderr, "");
  const result = JSON.parse(stdout);
  assert.equal(result.status, "ok");
  assert.equal(result.venue, "binance-spot-testnet");
  assert.equal(result.symbol, "BTCUSDT");
  assert.equal(result.side, "buy");
  assert.equal(result.quantity, "0.2");
  assert.equal(result.price, "90");
  assert.deepEqual(result.lifecycle, ["absent", "pending", "queried", "canceled", "terminal", "zero-fills"]);
  assert.equal(result.venueOrderId, "123");
  assert.equal(result.ticker.bestBid, "100.00");
  assert.equal(result.ticker.bestAsk, "101.00");
});

test("Binance Spot Testnet canary rejects a marketable-risk price before signing an order", async () => {
  await assert.rejects(
    execFileAsync(process.execPath, command, {
      cwd: new URL("..", import.meta.url),
      env: { ...baseEnvironment, RFQ_BINANCE_TESTNET_PRICE: "100" },
      timeout: 10_000,
    }),
    (error) => {
      assert.match(error.stderr, /buy price must be at least 100 bps below best bid/);
      assert.doesNotMatch(error.stderr, /testnet-api-key|testnet-api-secret/);
      return true;
    },
  );
});

test("Binance Spot Testnet canary queries and cancels after an accepted order returns an invalid response", async () => {
  await assert.rejects(
    execFileAsync(process.execPath, command, {
      cwd: new URL("..", import.meta.url),
      env: { ...baseEnvironment, RFQ_BINANCE_TESTNET_FIXTURE_MODE: "submit-response-invalid" },
      timeout: 10_000,
    }),
    (error) => {
      assert.match(error.stderr, /BINANCE_RESPONSE_INVALID/);
      assert.doesNotMatch(error.stderr, /cleanup cancellation was not confirmed/);
      assert.doesNotMatch(error.stderr, /testnet-api-key|testnet-api-secret/);
      return true;
    },
  );
});
