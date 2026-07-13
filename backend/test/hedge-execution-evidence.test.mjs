import assert from "node:assert/strict";
import test from "node:test";
import {
  compareCexQuoteQuantities,
  parseCexQuoteQuantity,
} from "../dist/modules/hedge/hedge-execution-evidence.js";

test("CEX quote execution evidence normalizes exact positive decimals", () => {
  assert.equal(parseCexQuoteQuantity("3125.500000000000000000"), "3125.5");
  assert.equal(parseCexQuoteQuantity("0.000000000000000000"), undefined);
  assert.equal(compareCexQuoteQuantities(parseCexQuoteQuantity("1.1"), parseCexQuoteQuantity("1.10")), 0);
  assert.equal(compareCexQuoteQuantities(parseCexQuoteQuantity("1.100000000000000001"), parseCexQuoteQuantity("1.1")), 1);
});

test("CEX quote execution evidence rejects values outside NUMERIC(78,18)", () => {
  assert.throws(() => parseCexQuoteQuantity("01"), /HEDGE_EXECUTED_QUOTE_QUANTITY_INVALID/);
  assert.throws(() => parseCexQuoteQuantity("1.0000000000000000001"), /HEDGE_EXECUTED_QUOTE_QUANTITY_INVALID/);
  assert.throws(() => parseCexQuoteQuantity(`${"9".repeat(61)}.1`), /HEDGE_EXECUTED_QUOTE_QUANTITY_INVALID/);
});
