import assert from "node:assert/strict";
import test from "node:test";
import { buildServer } from "../dist/main.js";
import { InMemoryQuoteRepository } from "../dist/modules/quote/quote.repository.js";

test("RFQ API returns structured errors for missing settlement events", async () => {
  const server = buildServer({ logger: false });
  await server.ready();

  try {
    const response = await injectJson(server, "GET", "/settlements/se_missing");

    assert.equal(response.statusCode, 404);
    assert.equal(response.body.code, "SETTLEMENT_EVENT_NOT_FOUND");
    assert.match(response.body.traceId, /^tr_/);
    assert.equal(response.headers["x-trace-id"], response.body.traceId);
  } finally {
    await server.close();
  }
});

test("RFQ API rejects unsafe status path identifiers before store lookup", async () => {
  const server = buildServer({ logger: false });
  await server.ready();

  try {
    for (const [url, expectedMessage] of [
      ["/quote/%20", "quoteId must be a non-empty string"],
      ["/quote/q.bad", "quoteId must contain only letters, numbers, underscore, colon, or hyphen"],
      [`/quote/${"q".repeat(129)}`, "quoteId must be 128 characters or fewer"],
      ["/hedges/%20", "hedgeOrderId must be a non-empty string"],
      ["/hedges/h.bad", "hedgeOrderId must contain only letters, numbers, underscore, colon, or hyphen"],
      [`/hedges/${"h".repeat(129)}`, "hedgeOrderId must be 128 characters or fewer"],
      ["/settlements/%20", "settlementEventId must be a non-empty string"],
      [
        "/settlements/se.bad",
        "settlementEventId must contain only letters, numbers, underscore, colon, or hyphen",
      ],
      [`/settlements/${"s".repeat(129)}`, "settlementEventId must be 128 characters or fewer"],
    ]) {
      const response = await injectJson(server, "GET", url);

      assert.equal(response.statusCode, 400);
      assert.equal(response.body.code, "INVALID_REQUEST");
      assert.equal(response.body.message, expectedMessage);
      assert.match(response.body.traceId, /^tr_/);
      assert.equal(response.headers["x-trace-id"], response.body.traceId);
    }
  } finally {
    await server.close();
  }
});

test("RFQ API maps settlement event store failures to structured errors", async () => {
  const server = buildServer({
    logger: false,
    settlementEventService: {
      checkHealth() {},
      applySettlementEvent() {
        throw new Error("not used");
      },
      getSettlementEvent() {
        throw new Error("settlement event store offline");
      },
    },
  });
  await server.ready();

  try {
    const response = await injectJson(server, "GET", "/settlements/se_missing");

    assert.equal(response.statusCode, 503);
    assert.equal(response.body.code, "SETTLEMENT_EVENT_STORE_UNAVAILABLE");
    assert.match(response.body.traceId, /^tr_/);
    assert.equal(response.headers["x-trace-id"], response.body.traceId);
  } finally {
    await server.close();
  }
});

test("RFQ API maps quote status store failures to structured errors", async () => {
  class FailingStatusQuoteRepository extends InMemoryQuoteRepository {
    async findStatus() {
      throw new Error("quote status store offline");
    }
  }

  const server = buildServer({
    logger: false,
    quoteRepository: new FailingStatusQuoteRepository(),
  });
  await server.ready();

  try {
    const response = await injectJson(server, "GET", "/quote/q_missing");

    assert.equal(response.statusCode, 503);
    assert.equal(response.body.code, "QUOTE_STORE_UNAVAILABLE");
    assert.match(response.body.traceId, /^tr_/);
    assert.equal(response.headers["x-trace-id"], response.body.traceId);
  } finally {
    await server.close();
  }
});

async function injectJson(server, method, url, payload, headers = {}) {
  const requestHeaders = { ...headers };
  if (payload) {
    requestHeaders["content-type"] = "application/json";
  }

  const response = await server.inject({
    method,
    url,
    headers: Object.keys(requestHeaders).length > 0 ? requestHeaders : undefined,
    payload: payload ? JSON.stringify(payload) : undefined,
  });

  return {
    statusCode: response.statusCode,
    headers: response.headers,
    body: response.payload ? JSON.parse(response.payload) : undefined,
  };
}
