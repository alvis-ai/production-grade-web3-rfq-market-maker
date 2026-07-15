import assert from "node:assert/strict";
import test from "node:test";
import {
  InMemoryQuoteIdempotencyStore,
  quoteRequestHash,
} from "../dist/modules/quote/quote-idempotency.store.js";

const request = {
  chainId: 1,
  user: "0x0000000000000000000000000000000000000001",
  tokenIn: "0x0000000000000000000000000000000000000002",
  tokenOut: "0x0000000000000000000000000000000000000003",
  amountIn: "1000000000",
  slippageBps: 50,
};
const response = {
  quoteId: "q_idempotent_1",
  snapshotId: "snapshot_1",
  amountOut: "998400000",
  minAmountOut: "993408000",
  deadline: 1_893_456_030,
  nonce: "42",
  signature: `0x${"11".repeat(65)}`,
};

test("InMemoryQuoteIdempotencyStore replays success and rejects fingerprint reuse", async () => {
  const store = new InMemoryQuoteIdempotencyStore(
    { leaseMs: 60_000 },
    { now: () => 1_700_000_000_000, ownerToken: () => "quote_idem_owner_1" },
  );
  const hash = quoteRequestHash(request);
  const acquired = await store.acquire("principal_1", "quote_request_0001", hash);
  assert.equal(acquired.status, "acquired");
  assert.equal((await store.acquire("principal_1", "quote_request_0001", hash)).status, "in_progress");
  assert.equal(
    (await store.acquire("principal_1", "quote_request_0001", quoteRequestHash({ ...request, amountIn: "2" }))).status,
    "conflict",
  );

  await store.bindQuote(acquired.reservation, response.quoteId);
  await store.complete(acquired.reservation, response);
  const replay = await store.acquire("principal_1", "quote_request_0001", hash);
  assert.deepEqual(replay, { status: "replay", response });
  replay.response.amountOut = "1";
  assert.deepEqual(await store.acquire("principal_1", "quote_request_0001", hash), {
    status: "replay",
    response,
  });
});

test("InMemoryQuoteIdempotencyStore scopes keys by principal and caches failures", async () => {
  let owner = 0;
  const store = new InMemoryQuoteIdempotencyStore(
    { leaseMs: 60_000 },
    { now: () => 1_700_000_000_000, ownerToken: () => `quote_idem_owner_${++owner}` },
  );
  const hash = quoteRequestHash(request);
  const first = await store.acquire("principal_1", "quote_request_0002", hash);
  const second = await store.acquire("principal_2", "quote_request_0002", hash);
  assert.equal(first.status, "acquired");
  assert.equal(second.status, "acquired");

  const failure = { code: "MARKET_DATA_UNAVAILABLE", message: "Market data unavailable", statusCode: 503 };
  await store.fail(first.reservation, failure);
  assert.deepEqual(await store.acquire("principal_1", "quote_request_0002", hash), {
    status: "failed",
    error: failure,
  });
  assert.equal((await store.acquire("principal_2", "quote_request_0002", hash)).status, "in_progress");
});

test("InMemoryQuoteIdempotencyStore reclaims only expired unbound work", async () => {
  let now = 1_700_000_000_000;
  let owner = 0;
  const store = new InMemoryQuoteIdempotencyStore(
    { leaseMs: 10_000 },
    { now: () => now, ownerToken: () => `quote_idem_owner_${++owner}` },
  );
  const hash = quoteRequestHash(request);
  const first = await store.acquire("principal_1", "quote_request_0003", hash);
  assert.equal(first.status, "acquired");
  now += 10_001;
  const reclaimed = await store.acquire("principal_1", "quote_request_0003", hash);
  assert.equal(reclaimed.status, "acquired");
  assert.notEqual(reclaimed.reservation.ownerToken, first.reservation.ownerToken);

  await store.bindQuote(reclaimed.reservation, "q_bound");
  now += 10_001;
  assert.equal((await store.acquire("principal_1", "quote_request_0003", hash)).status, "in_progress");
});

test("quoteRequestHash canonicalizes address case and preserves economic fields", () => {
  assert.equal(quoteRequestHash(request), quoteRequestHash({
    ...request,
    user: request.user.toUpperCase().replace("0X", "0x"),
    tokenIn: request.tokenIn.toUpperCase().replace("0X", "0x"),
  }));
  assert.notEqual(quoteRequestHash(request), quoteRequestHash({ ...request, slippageBps: 51 }));
});
