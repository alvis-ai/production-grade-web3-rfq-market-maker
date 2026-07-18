import assert from "node:assert/strict";
import test from "node:test";
import { parseRedisQuoteExposureRecord } from "../dist/modules/risk/redis-quote-exposure.store.js";

const tokenLow = "0x0000000000000000000000000000000000000011";
const tokenHigh = "0x0000000000000000000000000000000000000022";

test("Redis quote exposure records preserve exact integers beyond IEEE-754", () => {
  const value = record();
  const parsed = parseRedisQuoteExposureRecord(JSON.stringify(value));

  assert.equal(parsed.amountIn, "900719925474099312345678901234567890");
  assert.equal(parsed.notionalUsdE18, "900719925474099312345678901234567890");
});

test("Redis quote exposure records reject noncanonical pairs and metadata", () => {
  assert.throws(
    () => parseRedisQuoteExposureRecord(JSON.stringify({ ...record(), tokenLow: tokenHigh, tokenHigh: tokenLow })),
    /token pair is invalid/,
  );
  assert.throws(
    () => parseRedisQuoteExposureRecord(JSON.stringify({ ...record(), tokenOut: tokenLow })),
    /token pair is invalid/,
  );
  assert.throws(
    () => parseRedisQuoteExposureRecord(JSON.stringify({ ...record(), deadline: 0 })),
    /metadata is invalid/,
  );
  assert.throws(
    () => parseRedisQuoteExposureRecord(JSON.stringify({ ...record(), amountOut: "01" })),
    /positive decimal integer/,
  );
});

function record() {
  return {
    schemaVersion: 1,
    quoteId: "q_exact_record",
    chainId: 1,
    user: "0x00000000000000000000000000000000000000aa",
    tokenLow,
    tokenHigh,
    tokenIn: tokenLow,
    amountIn: "900719925474099312345678901234567890",
    tokenOut: tokenHigh,
    amountOut: "1",
    notionalUsdE18: "900719925474099312345678901234567890",
    deadline: 1_900_000_000,
    ledgerExpiresAt: 1_900_000_002,
  };
}
