import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeRedisUrl,
  RedisRateLimiter,
} from "../dist/modules/rate-limit/redis-rate-limit.service.js";

const config = {
  windowMs: 60_000,
  maxQuoteRequests: 2,
  maxSubmitRequests: 1,
  maxStatusRequests: 3,
};

test("RedisRateLimiter maps atomic script results to endpoint decisions", async () => {
  const calls = [];
  const results = [[1, 1, 60_000], [1, 2, 59_500], [0, 2, 59_000]];
  const client = fakeClient({
    async eval(...args) {
      calls.push(args);
      return results.shift();
    },
  });
  const limiter = new RedisRateLimiter(client, config);

  assert.deepEqual(await limiter.check({ endpoint: "quote", clientId: " Client-A " }), {
    allowed: true,
    remaining: 1,
    retryAfterSeconds: 60,
  });
  assert.deepEqual(await limiter.check({ endpoint: "quote", clientId: "client-a" }), {
    allowed: true,
    remaining: 0,
    retryAfterSeconds: 60,
  });
  assert.deepEqual(await limiter.check({ endpoint: "quote", clientId: "CLIENT-A" }), {
    allowed: false,
    remaining: 0,
    retryAfterSeconds: 59,
  });

  for (const call of calls) {
    assert.match(call[0], /redis\.call\("GET"/);
    assert.equal(call[1], 1);
    assert.equal(call[2], "rfq:rate-limit:v1:quote:client-a");
    assert.equal(call[3], 60_000);
    assert.equal(call[4], 2);
  }
});

test("RedisRateLimiter snapshots configuration and supports bounded key prefixes", async () => {
  const mutableConfig = { ...config };
  const calls = [];
  const limiter = new RedisRateLimiter(fakeClient({
    async eval(...args) {
      calls.push(args);
      return [1, 1, 1_000];
    },
  }), mutableConfig, { keyPrefix: " RFQ:Tenant_1 " });
  mutableConfig.windowMs = 1;
  mutableConfig.maxSubmitRequests = 99;

  await limiter.check({ endpoint: "submit", clientId: "127.0.0.1" });

  assert.equal(calls[0][2], "rfq:tenant_1:submit:127.0.0.1");
  assert.equal(calls[0][3], 60_000);
  assert.equal(calls[0][4], 1);
});

test("RedisRateLimiter validates dependencies, config, inputs and script output", async () => {
  assert.throws(() => new RedisRateLimiter(null, config), /client must be an object/);
  assert.throws(
    () => new RedisRateLimiter({ eval() {}, ping() {}, quit: null }, config),
    /client.quit must be a function/,
  );
  assert.throws(
    () => new RedisRateLimiter(fakeClient(), { ...config, windowMs: 0 }),
    /windowMs must be a positive safe integer/,
  );
  assert.throws(
    () => new RedisRateLimiter(fakeClient(), config, { keyPrefix: "unsafe space" }),
    /keyPrefix must contain 1-64/,
  );
  assert.throws(
    () => new RedisRateLimiter(fakeClient(), config, { keyPrefix: "ok", extra: true }),
    /must not include unknown field extra/,
  );

  const limiter = new RedisRateLimiter(fakeClient({ async eval() { return [1, "1", 1000]; } }), config);
  await assert.rejects(
    limiter.check({ endpoint: "quote", clientId: "client-a" }),
    /script returned invalid values/,
  );
  await assert.rejects(
    limiter.check({ endpoint: "metrics", clientId: "client-a" }),
    /endpoint must be quote, submit, or status/,
  );
});

test("RedisRateLimiter probes health, connects lazily and closes clients", async () => {
  let connects = 0;
  let pings = 0;
  let quits = 0;
  const client = fakeClient({
    status: "wait",
    async connect() {
      connects += 1;
      this.status = "ready";
    },
    async ping() {
      pings += 1;
      return "PONG";
    },
    async quit() {
      quits += 1;
      this.status = "end";
      return "OK";
    },
  });
  const limiter = new RedisRateLimiter(client, config);

  await limiter.checkHealth();
  await limiter.checkHealth();
  await limiter.close();

  assert.equal(connects, 1);
  assert.equal(pings, 2);
  assert.equal(quits, 1);
});

test("normalizeRedisUrl accepts Redis URLs and rejects unsafe schemes or fragments", () => {
  assert.equal(normalizeRedisUrl("redis://localhost:6379/0"), "redis://localhost:6379/0");
  assert.equal(normalizeRedisUrl(" rediss://user:pass@redis.example.com:6380/1 "),
    "rediss://user:pass@redis.example.com:6380/1");
  for (const value of ["", "http://localhost:6379", "redis://", "redis://localhost:6379/0#secret"]) {
    assert.throws(() => normalizeRedisUrl(value), /RFQ_REDIS_URL/);
  }
});

function fakeClient(overrides = {}) {
  return {
    async eval() {
      return [1, 1, 60_000];
    },
    async ping() {
      return "PONG";
    },
    async quit() {
      return "OK";
    },
    ...overrides,
  };
}
