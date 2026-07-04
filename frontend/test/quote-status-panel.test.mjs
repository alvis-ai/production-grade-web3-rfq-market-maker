import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../src/components/QuoteStatusPanel.tsx", import.meta.url), "utf8");

test("QuoteStatusPanel renders the quote TTL countdown field", () => {
  for (const expected of [
    "expiresInSeconds?: number;",
    "expiresInSeconds,",
    "<dt>Expires In</dt>",
    'expiresInSeconds === undefined ? "-" : `${expiresInSeconds}s`',
  ]) {
    assert.ok(source.includes(expected), expected);
  }
});

test("QuoteStatusPanel renders terminal hedge outcome fields", () => {
  for (const expected of [
    "<dt>Hedge External Order</dt>",
    "hedgeStatus?.externalOrderId",
    "<dt>Hedge Updated</dt>",
    "hedgeStatus?.updatedAt",
  ]) {
    assert.ok(source.includes(expected), expected);
  }
});
