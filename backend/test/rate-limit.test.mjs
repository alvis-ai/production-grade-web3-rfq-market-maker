import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryRateLimiter } from "../dist/modules/rate-limit/rate-limit.service.js";

test("InMemoryRateLimiter enforces endpoint-specific windows", () => {
  const limiter = new InMemoryRateLimiter({
    windowMs: 1000,
    maxQuoteRequests: 2,
    maxSubmitRequests: 1,
    maxStatusRequests: 1,
  });

  assert.deepEqual(limiter.check({ endpoint: "quote", clientId: "client-a" }, 1000), {
    allowed: true,
    remaining: 1,
    retryAfterSeconds: 1,
  });
  assert.deepEqual(limiter.check({ endpoint: "quote", clientId: "client-a" }, 1100), {
    allowed: true,
    remaining: 0,
    retryAfterSeconds: 1,
  });
  assert.deepEqual(limiter.check({ endpoint: "quote", clientId: "client-a" }, 1200), {
    allowed: false,
    remaining: 0,
    retryAfterSeconds: 1,
  });

  assert.deepEqual(limiter.check({ endpoint: "submit", clientId: "client-a" }, 1200), {
    allowed: true,
    remaining: 0,
    retryAfterSeconds: 1,
  });
  assert.deepEqual(limiter.check({ endpoint: "status", clientId: "client-a" }, 1200), {
    allowed: true,
    remaining: 0,
    retryAfterSeconds: 1,
  });
  assert.deepEqual(limiter.check({ endpoint: "status", clientId: "client-a" }, 1201), {
    allowed: false,
    remaining: 0,
    retryAfterSeconds: 1,
  });

  assert.deepEqual(limiter.check({ endpoint: "quote", clientId: "client-a" }, 2001), {
    allowed: true,
    remaining: 1,
    retryAfterSeconds: 1,
  });
});

test("InMemoryRateLimiter snapshots configuration at construction", () => {
  const mutableConfig = {
    windowMs: 1000,
    maxQuoteRequests: 2,
    maxSubmitRequests: 1,
    maxStatusRequests: 1,
  };
  const limiter = new InMemoryRateLimiter(mutableConfig);

  mutableConfig.windowMs = 10_000;
  mutableConfig.maxQuoteRequests = 100;
  mutableConfig.maxSubmitRequests = 100;
  mutableConfig.maxStatusRequests = 100;

  assert.deepEqual(limiter.check({ endpoint: "quote", clientId: "client-a" }, 1000), {
    allowed: true,
    remaining: 1,
    retryAfterSeconds: 1,
  });
  assert.deepEqual(limiter.check({ endpoint: "quote", clientId: "client-a" }, 1100), {
    allowed: true,
    remaining: 0,
    retryAfterSeconds: 1,
  });
  assert.deepEqual(limiter.check({ endpoint: "quote", clientId: "client-a" }, 1200), {
    allowed: false,
    remaining: 0,
    retryAfterSeconds: 1,
  });
});

test("InMemoryRateLimiter normalizes client identities before bucketing", () => {
  const limiter = new InMemoryRateLimiter({
    windowMs: 1000,
    maxQuoteRequests: 1,
    maxSubmitRequests: 1,
    maxStatusRequests: 1,
  });

  assert.deepEqual(limiter.check({ endpoint: "quote", clientId: " Client-A " }, 1000), {
    allowed: true,
    remaining: 0,
    retryAfterSeconds: 1,
  });
  assert.deepEqual(limiter.check({ endpoint: "quote", clientId: "client-a" }, 1001), {
    allowed: false,
    remaining: 0,
    retryAfterSeconds: 1,
  });

  assert.equal(limiter.buckets.has("quote:client-a"), true);
  assert.equal(limiter.buckets.has("quote: Client-A "), false);
});

test("InMemoryRateLimiter rejects unsafe configuration at construction", () => {
  assert.throws(
    () => new InMemoryRateLimiter({
      windowMs: 0,
      maxQuoteRequests: 2,
      maxSubmitRequests: 1,
      maxStatusRequests: 1,
    }),
    /Rate limit windowMs must be a positive safe integer/,
  );

  assert.throws(
    () => new InMemoryRateLimiter({
      windowMs: 1000,
      maxQuoteRequests: 0,
      maxSubmitRequests: 1,
      maxStatusRequests: 1,
    }),
    /Rate limit maxQuoteRequests must be a positive safe integer/,
  );

  assert.throws(
    () => new InMemoryRateLimiter({
      windowMs: 1000,
      maxQuoteRequests: 2,
      maxSubmitRequests: Number.MAX_SAFE_INTEGER + 1,
      maxStatusRequests: 1,
    }),
    /Rate limit maxSubmitRequests must be a positive safe integer/,
  );
});

test("InMemoryRateLimiter rejects unsafe request inputs before writing buckets", () => {
  const limiter = new InMemoryRateLimiter({
    windowMs: 1000,
    maxQuoteRequests: 2,
    maxSubmitRequests: 1,
    maxStatusRequests: 1,
  });

  assert.throws(
    () => limiter.check(undefined),
    /Rate limit input must be an object/,
  );

  assert.throws(
    () => limiter.check({ endpoint: "quote", clientId: " " }),
    /Rate limit clientId must be a non-empty string/,
  );

  assert.throws(
    () => limiter.check({ endpoint: "quote", clientId: "a".repeat(129) }),
    /Rate limit clientId must be 128 characters or fewer/,
  );

  assert.throws(
    () => limiter.check({ endpoint: "metrics", clientId: "client-a" }),
    /Rate limit endpoint must be quote, submit, or status/,
  );

  assert.equal(limiter.buckets.size, 0);

  assert.deepEqual(limiter.check({ endpoint: "quote", clientId: "client-a" }, 1000), {
    allowed: true,
    remaining: 1,
    retryAfterSeconds: 1,
  });
});

test("InMemoryRateLimiter rejects unsafe timestamps before writing buckets", () => {
  const limiter = new InMemoryRateLimiter({
    windowMs: 1000,
    maxQuoteRequests: 2,
    maxSubmitRequests: 1,
    maxStatusRequests: 1,
  });

  assert.throws(
    () => limiter.check({ endpoint: "quote", clientId: "client-a" }, Number.NaN),
    /Rate limit timestamp must be a non-negative safe integer/,
  );
  assert.throws(
    () => limiter.check({ endpoint: "quote", clientId: "client-a" }, -1),
    /Rate limit timestamp must be a non-negative safe integer/,
  );
  assert.equal(limiter.buckets.size, 0);

  assert.deepEqual(limiter.check({ endpoint: "quote", clientId: "client-a" }, 1000), {
    allowed: true,
    remaining: 1,
    retryAfterSeconds: 1,
  });
});

test("InMemoryRateLimiter rejects unsafe reset timestamps", () => {
  const limiter = new InMemoryRateLimiter({
    windowMs: Number.MAX_SAFE_INTEGER,
    maxQuoteRequests: 2,
    maxSubmitRequests: 1,
    maxStatusRequests: 1,
  });

  assert.throws(
    () => limiter.check({ endpoint: "quote", clientId: "client-a" }, 1),
    /Rate limit reset timestamp must be a safe integer/,
  );
  assert.equal(limiter.buckets.size, 0);
});

test("InMemoryRateLimiter evicts expired client buckets before checking", () => {
  const limiter = new InMemoryRateLimiter({
    windowMs: 1000,
    maxQuoteRequests: 2,
    maxSubmitRequests: 2,
    maxStatusRequests: 2,
  });

  assert.equal(limiter.check({ endpoint: "quote", clientId: "client-a" }, 1000).allowed, true);
  assert.equal(limiter.check({ endpoint: "quote", clientId: "client-b" }, 1100).allowed, true);
  assert.equal(limiter.buckets.size, 2);

  assert.equal(limiter.check({ endpoint: "submit", clientId: "client-c" }, 2001).allowed, true);
  assert.equal(limiter.buckets.has("quote:client-a"), false);
  assert.equal(limiter.buckets.has("quote:client-b"), true);
  assert.equal(limiter.buckets.has("submit:client-c"), true);
  assert.equal(limiter.buckets.size, 2);
});
