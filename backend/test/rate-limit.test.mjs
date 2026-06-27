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
