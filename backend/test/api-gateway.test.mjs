import assert from "node:assert/strict";
import test from "node:test";
import { buildServer, readServerListenConfig } from "../dist/main.js";

test("RFQ API validates standalone listen configuration", () => {
  assert.deepEqual(readServerListenConfig({ env: {} }), {
    host: "127.0.0.1",
    port: 3000,
  });
  assert.deepEqual(readServerListenConfig({ env: { HOST: " 0.0.0.0 ", PORT: "8080" } }), {
    host: "0.0.0.0",
    port: 8080,
  });

  assert.throws(
    () => readServerListenConfig({ env: { PORT: "65536" } }),
    /PORT must be a base-10 integer between 1 and 65535/,
  );
  assert.throws(
    () => readServerListenConfig({ env: { PORT: "3000.5" } }),
    /PORT must be a base-10 integer between 1 and 65535/,
  );
  assert.throws(
    () => readServerListenConfig({ env: { PORT: "3e3" } }),
    /PORT must be a base-10 integer between 1 and 65535/,
  );
  assert.throws(
    () => readServerListenConfig({ env: { PORT: "0x0bb8" } }),
    /PORT must be a base-10 integer between 1 and 65535/,
  );
  assert.throws(
    () => readServerListenConfig({ env: { HOST: "127.0.0.1 local" } }),
    /HOST must be a non-empty hostname or IP address without whitespace/,
  );
});

test("RFQ API rejects unsafe rate limit configuration at startup", () => {
  assert.throws(
    () => buildServer({
      logger: false,
      rateLimit: {
        windowMs: 0,
      },
    }),
    /Rate limit windowMs must be a positive safe integer/,
  );

  assert.throws(
    () => buildServer({
      logger: false,
      rateLimit: {
        maxSubmitRequests: 0,
      },
    }),
    /Rate limit maxSubmitRequests must be a positive safe integer/,
  );
});

test("RFQ API rejects unsafe direct runtime options at startup", () => {
  assert.throws(
    () => buildServer(null),
    /buildServer options must be an object/,
  );
  assert.throws(
    () => buildServer([]),
    /buildServer options must be an object/,
  );
  assert.throws(
    () => buildServer(Object.create({ logger: false })),
    /buildServer options.logger must be an own field when provided/,
  );
  assert.throws(
    () => buildServer({ logger: "false" }),
    /logger must be a boolean/,
  );
  assert.throws(
    () => buildServer({ logger: false, bodyLimitBytes: 1023 }),
    /bodyLimitBytes must be an integer between 1024 and 1048576/,
  );
  assert.throws(
    () => buildServer({ logger: false, quoteTtlSeconds: 3601 }),
    /quoteTtlSeconds must be an integer between 1 and 3600/,
  );
  assert.throws(
    () => buildServer({ logger: false, quoteTtlSeconds: 30.5 }),
    /quoteTtlSeconds must be an integer between 1 and 3600/,
  );
  assert.throws(
    () => buildServer({ logger: false, enableHsts: "true" }),
    /enableHsts must be a boolean/,
  );
  assert.throws(
    () => buildServer({ logger: false, trustProxy: "true" }),
    /trustProxy must be a boolean/,
  );
  assert.throws(
    () => buildServer({ logger: false, rateLimit: "enabled" }),
    /buildServer rateLimit must be an object or false/,
  );
  assert.throws(
    () => buildServer({ logger: false, rateLimit: Object.create({ windowMs: 60_000 }) }),
    /buildServer rateLimit.windowMs must be an own field when provided/,
  );
});
