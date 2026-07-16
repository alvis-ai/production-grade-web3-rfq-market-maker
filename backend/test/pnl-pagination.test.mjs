import assert from "node:assert/strict";
import test from "node:test";
import { parsePnlPageQuery, encodePnlCursor } from "../dist/modules/pnl/pnl-pagination.js";
import { PnlService } from "../dist/modules/pnl/pnl.service.js";
import { createTestPnlValuationProvider, pnlInput } from "./helpers/pnl-fixtures.mjs";

const baseQuote = {
  user: "0x0000000000000000000000000000000000000001",
  tokenIn: "0x0000000000000000000000000000000000000002",
  tokenOut: "0x0000000000000000000000000000000000000003",
  amountIn: "1000",
  amountOut: "990",
  minAmountOut: "980",
  nonce: "1",
  deadline: 4_102_444_800,
  chainId: 1,
};

test("PnL page query uses closed bounded parameters and canonical opaque cursors", () => {
  assert.deepEqual(parsePnlPageQuery({}), { limit: 50 });
  const cursor = encodePnlCursor({
    asOf: "2026-07-16T00:00:00.000Z",
    realizedAt: "2026-07-11T00:00:01.000Z",
    pnlId: "pnl_q_1",
  });
  assert.deepEqual(parsePnlPageQuery({ limit: "100", cursor }), {
    limit: 100,
    cursor: {
      version: 1,
      asOf: "2026-07-16T00:00:00.000Z",
      realizedAt: "2026-07-11T00:00:01.000Z",
      pnlId: "pnl_q_1",
    },
  });

  for (const query of [
    { limit: "0" },
    { limit: "01" },
    { limit: "101" },
    { limit: 10 },
    { cursor: "pnl1_***" },
    { cursor: `${cursor}x` },
    { cursor: [cursor] },
    { offset: "1" },
  ]) {
    assert.throws(
      () => parsePnlPageQuery(query),
      (error) => error?.code === "INVALID_REQUEST" && error?.statusCode === 400,
    );
  }
});

test("PnlService pages newest-first over a stable principal-scoped creation snapshot", async () => {
  const owners = new Map();
  const service = new PnlService(createTestPnlValuationProvider(), {
    async findPrincipalId(quoteId) { return owners.get(quoteId); },
  });
  for (const [index, quoteId] of ["q_old", "q_middle", "q_new"].entries()) {
    owners.set(quoteId, "institution_a");
    await service.recordSettlement(pnlInput(quoteId, { ...baseQuote, nonce: String(index + 1) }, {
      realizedAt: `2026-07-11T00:00:0${index + 1}.000Z`,
    }));
  }
  owners.set("q_foreign", "institution_b");
  await service.recordSettlement(pnlInput("q_foreign", { ...baseQuote, nonce: "4" }, {
    realizedAt: "2026-07-11T00:00:04.000Z",
  }));

  const first = await service.summary("institution_a", { limit: 2 });
  assert.equal(first.totalTrades, 3);
  assert.deepEqual(first.trades.map(({ quoteId }) => quoteId), ["q_new", "q_middle"]);
  assert.deepEqual(first.hedgeNet.records.map(({ quoteId }) => quoteId), ["q_new", "q_middle"]);
  assert.equal(first.totals[0].totalTrades, 3);
  assert.deepEqual(first.page, {
    limit: 2,
    returned: 2,
    hasMore: true,
    asOf: first.page.asOf,
    nextCursor: first.page.nextCursor,
  });

  owners.set("q_backfill", "institution_a");
  await service.recordSettlement(pnlInput("q_backfill", { ...baseQuote, nonce: "5" }, {
    realizedAt: "2026-07-11T00:00:01.500Z",
  }));
  const secondRequest = parsePnlPageQuery({ limit: "2", cursor: first.page.nextCursor });
  const second = await service.summary("institution_a", secondRequest);
  assert.equal(second.totalTrades, 3);
  assert.deepEqual(second.trades.map(({ quoteId }) => quoteId), ["q_old"]);
  assert.equal(second.page.asOf, first.page.asOf);
  assert.equal(second.page.hasMore, false);
  assert.equal(second.page.nextCursor, undefined);

  const fresh = await service.summary("institution_a", { limit: 10 });
  assert.equal(fresh.totalTrades, 4);
  assert.deepEqual(fresh.trades.map(({ quoteId }) => quoteId), ["q_new", "q_middle", "q_backfill", "q_old"]);
  const foreign = await service.summary("institution_b", { limit: 10 });
  assert.deepEqual(foreign.trades.map(({ quoteId }) => quoteId), ["q_foreign"]);
});
