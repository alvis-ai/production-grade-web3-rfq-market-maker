import assert from "node:assert/strict";
import test from "node:test";
import { QuoteIdentityGenerator } from "../dist/modules/quote/quote-identity.js";

test("QuoteIdentityGenerator creates monotonic unique nonces within one millisecond", () => {
  const originalDateNow = Date.now;
  Date.now = () => 1893456000000;

  try {
    const generator = new QuoteIdentityGenerator();
    const first = generator.next();
    const second = generator.next();
    const third = generator.next();

    assert.match(first.nonce, /^[0-9]+$/);
    assert.equal(first.quoteId, `q_${first.nonce}`);
    assert.equal(second.quoteId, `q_${second.nonce}`);
    assert.equal(third.quoteId, `q_${third.nonce}`);
    assert.equal(BigInt(second.nonce) - BigInt(first.nonce), 1n);
    assert.equal(BigInt(third.nonce) - BigInt(second.nonce), 1n);
    assert.equal(new Set([first.quoteId, second.quoteId, third.quoteId]).size, 3);
    assert.equal(new Set([first.nonce, second.nonce, third.nonce]).size, 3);
  } finally {
    Date.now = originalDateNow;
  }
});

test("QuoteIdentityGenerator keeps nonces monotonic when the system clock moves backward", () => {
  const originalDateNow = Date.now;
  let now = 1893456000000;
  Date.now = () => now;

  try {
    const generator = new QuoteIdentityGenerator();
    const first = generator.next();
    now -= 1;
    const second = generator.next();

    assert.ok(BigInt(second.nonce) > BigInt(first.nonce));
    assert.equal(BigInt(second.nonce) - BigInt(first.nonce), 1n);
    assert.equal(second.quoteId, `q_${second.nonce}`);
  } finally {
    Date.now = originalDateNow;
  }
});

test("QuoteIdentityGenerator advances logical time when the per-millisecond sequence wraps", () => {
  const originalDateNow = Date.now;
  Date.now = () => 1893456000000;

  try {
    const generator = new QuoteIdentityGenerator();
    const first = generator.next();

    generator.sequence = (1n << 20n) - 1n;
    const afterWrap = generator.next();

    assert.ok(BigInt(afterWrap.nonce) > BigInt(first.nonce));
    assert.equal(BigInt(afterWrap.nonce) & ((1n << 20n) - 1n), 1n);
    assert.equal(afterWrap.quoteId, `q_${afterWrap.nonce}`);
  } finally {
    Date.now = originalDateNow;
  }
});
