import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { installGatewayBoundary } from "../dist/api/http-boundary.js";
import { MetricsService } from "../dist/modules/metrics/metrics.service.js";
import {
  createStructuredLogger,
  readLogLevel,
} from "../dist/shared/logger/structured-logger.js";

test("structured logger validates RFQ_LOG_LEVEL from own environment fields", () => {
  assert.equal(readLogLevel({}), "info");
  assert.equal(readLogLevel({ RFQ_LOG_LEVEL: " WARN " }), "warn");
  assert.equal(readLogLevel(Object.create({ RFQ_LOG_LEVEL: "debug" })), "info");
  assert.throws(() => readLogLevel({ RFQ_LOG_LEVEL: "trace" }), /RFQ_LOG_LEVEL/);
});

test("structured logger emits service-bound JSON and filters below-threshold records", () => {
  const lines = [];
  const logger = createStructuredLogger("rfq-api", {
    level: "info",
    stream: { write(line) { lines.push(line); } },
  });

  logger.debug({ quoteId: "q_hidden" }, "debug record");
  logger.info({ traceId: "tr_log_1", statusCode: 200 }, "request completed");

  assert.equal(lines.length, 1);
  const record = JSON.parse(lines[0]);
  assert.equal(record.level, "info");
  assert.equal(record.service, "rfq-api");
  assert.equal(record.message, "request completed");
  assert.equal(record.traceId, "tr_log_1");
  assert.equal(record.statusCode, 200);
  assert.match(record.time, /^\d{4}-\d{2}-\d{2}T/);
});

test("structured logger redacts credentials and never serializes request headers or raw exception messages", () => {
  const lines = [];
  const logger = createStructuredLogger("hedge-worker", {
    level: "debug",
    stream: { write(line) { lines.push(line); } },
  });

  logger.info({
    apiSecret: "top-level-secret",
    credentials: { apiKey: "nested-key", password: "nested-password" },
    req: {
      method: "POST",
      url: "/quote",
      remoteAddress: "127.0.0.1",
      headers: { "x-api-key": "client.plaintext", authorization: "Bearer token" },
    },
  }, "safe record");
  const failure = new Error("postgres://operator:database-secret@db.internal/rfq?apiKey=query-secret");
  failure.code = "DATABASE_UNAVAILABLE";
  logger.error({ err: failure }, "dependency failed");

  const serialized = lines[0];
  const record = JSON.parse(serialized);
  assert.equal(record.apiSecret, "[REDACTED]");
  assert.equal(record.credentials.apiKey, "[REDACTED]");
  assert.equal(record.credentials.password, "[REDACTED]");
  assert.deepEqual(record.req, {
    method: "POST",
    route: "/quote",
    remoteAddress: "127.0.0.1",
  });
  assert.ok(!serialized.includes("top-level-secret"));
  assert.ok(!serialized.includes("nested-key"));
  assert.ok(!serialized.includes("nested-password"));
  assert.ok(!serialized.includes("client.plaintext"));
  assert.ok(!serialized.includes("Bearer token"));

  const failureSerialized = lines[1];
  const failureRecord = JSON.parse(failureSerialized);
  assert.deepEqual(failureRecord.err, { type: "Error", code: "DATABASE_UNAVAILABLE" });
  assert.ok(!failureSerialized.includes("database-secret"));
  assert.ok(!failureSerialized.includes("query-secret"));
});

test("structured logger rejects unsafe service names and malformed options", () => {
  assert.throws(() => createStructuredLogger("RFQ API"), /service/);
  assert.throws(() => createStructuredLogger("rfq-api", { level: "trace" }), /level/);
  assert.throws(() => createStructuredLogger("rfq-api", { unknown: true }), /not supported/);
  assert.throws(() => createStructuredLogger("rfq-api", { stream: {} }), /stream/);
});

test("gateway request logs correlate route templates with trace ids without credential leakage", async () => {
  const lines = [];
  const logger = createStructuredLogger("rfq-api", {
    level: "debug",
    stream: { write(line) { lines.push(line); } },
  });
  const server = Fastify({ logger, disableRequestLogging: true });
  installGatewayBoundary(server, {
    allowedOrigins: [],
    enableHsts: false,
    metricsService: new MetricsService(),
  });
  server.post("/quote", async () => ({ accepted: true }));
  server.get("/fail", async () => {
    throw new Error("database password=internal-secret");
  });
  await server.ready();

  try {
    const traceId = "tr_structured_log_1";
    const secret = "client.plaintext-secret";
    const response = await server.inject({
      method: "POST",
      url: "/quote",
      headers: { "x-trace-id": traceId, "x-api-key": secret },
    });
    assert.equal(response.statusCode, 200);

    const records = lines.map((line) => JSON.parse(line));
    const completion = records.find((record) => record.message === "HTTP request completed");
    assert.deepEqual({
      level: completion.level,
      service: completion.service,
      traceId: completion.traceId,
      method: completion.method,
      route: completion.route,
      statusCode: completion.statusCode,
    }, {
      level: "info",
      service: "rfq-api",
      traceId,
      method: "POST",
      route: "/quote",
      statusCode: 200,
    });
    assert.ok(Number.isSafeInteger(completion.durationMs) && completion.durationMs >= 0);

    await server.inject({
      method: "GET",
      url: "/missing/client-secret-in-url",
      headers: { "x-trace-id": "tr_missing_1" },
    });
    await server.inject({
      method: "GET",
      url: "/fail",
      headers: { "x-trace-id": "tr_failure_1" },
    });

    const allRecords = lines.map((line) => JSON.parse(line));
    assert.ok(allRecords.some((record) =>
      record.level === "warn" &&
      record.message === "HTTP request rejected" &&
      record.route === "unmatched" &&
      record.errorCode === "INVALID_REQUEST" &&
      record.traceId === "tr_missing_1"));
    assert.ok(allRecords.some((record) =>
      record.level === "error" &&
      record.message === "HTTP request failed" &&
      record.route === "/fail" &&
      record.errorCode === "INTERNAL_ERROR" &&
      record.traceId === "tr_failure_1"));
    const serialized = lines.join("\n");
    assert.ok(!serialized.includes(secret));
    assert.ok(!serialized.includes("client-secret-in-url"));
    assert.ok(!serialized.includes("internal-secret"));
  } finally {
    await server.close();
  }
});
