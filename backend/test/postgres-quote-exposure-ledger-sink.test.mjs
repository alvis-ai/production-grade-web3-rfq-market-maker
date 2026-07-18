import assert from "node:assert/strict";
import test from "node:test";
import { PostgresQuoteExposureLedgerSink } from "../dist/modules/risk/postgres-quote-exposure-ledger.sink.js";

test("PostgresQuoteExposureLedgerSink applies an ordered event with configured timeouts", async () => {
  const queries = [];
  const pool = fakePool(queries, (text) => {
    if (text.includes("INSERT INTO quote_exposure_ledger_events")) {
      return { rows: [{ source_stream_id: "epoch_v1:100-0" }], rowCount: 1 };
    }
    if (text.includes("SELECT source_epoch")) return { rows: [], rowCount: 0 };
    if (text.includes("INSERT INTO quote_exposure_reservations")) return { rows: [], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  });
  const sink = new PostgresQuoteExposureLedgerSink(pool, 777);

  assert.deepEqual(await sink.applyMirrored("reserve", record(), "epoch_v1:100-0"), {
    inserted: true,
    applied: true,
  });
  const configured = queries.filter((query) => typeof query !== "string");
  assert.ok(configured.length >= 4);
  assert.equal(configured.every((query) => query.query_timeout === 777), true);
  assert.equal(configured.some((query) => query.text.includes("ledger_expires_at")), true);
});

test("PostgresQuoteExposureLedgerSink retains audit but ignores stale projection positions", async () => {
  const queries = [];
  const pool = fakePool(queries, (text) => {
    if (text.includes("INSERT INTO quote_exposure_ledger_events")) {
      return { rows: [{ source_stream_id: "epoch_v1:100-0" }], rowCount: 1 };
    }
    if (text.includes("SELECT source_epoch")) {
      return {
        rows: [{ source_epoch: "epoch_v1", stream_milliseconds: "200", stream_sequence: "0" }],
        rowCount: 1,
      };
    }
    return { rows: [], rowCount: 1 };
  });
  const sink = new PostgresQuoteExposureLedgerSink(pool, 500);

  assert.deepEqual(await sink.applyMirrored("reserve", record(), "epoch_v1:100-0"), {
    inserted: true,
    applied: false,
  });
  assert.equal(queryTexts(queries).some((text) => text.includes("INSERT INTO quote_exposure_reservations")), false);
});

test("PostgresQuoteExposureLedgerSink cleans only a bounded expired batch", async () => {
  const queries = [];
  const pool = fakePool(queries, () => ({ rows: [], rowCount: 7 }));
  const sink = new PostgresQuoteExposureLedgerSink(pool, 900);

  assert.equal(await sink.deleteExpired(25), 7);
  const cleanup = queries.at(-1);
  assert.equal(cleanup.query_timeout, 900);
  assert.deepEqual(cleanup.values, [25]);
  assert.match(cleanup.text, /ledger_expires_at <= now\(\)/);
  await assert.rejects(sink.deleteExpired(0), /between 1 and 10000/);
});

function fakePool(queries, handler) {
  const query = async (statement) => {
    queries.push(statement);
    const text = typeof statement === "string" ? statement : statement.text;
    return handler(text, typeof statement === "string" ? [] : statement.values);
  };
  return {
    async connect() {
      return { query, release() {} };
    },
    query,
  };
}

function queryTexts(queries) {
  return queries.map((query) => typeof query === "string" ? query : query.text);
}

function record() {
  return {
    schemaVersion: 1,
    quoteId: "q_sink",
    chainId: 1,
    user: "0x00000000000000000000000000000000000000aa",
    tokenLow: "0x0000000000000000000000000000000000000011",
    tokenHigh: "0x0000000000000000000000000000000000000022",
    tokenIn: "0x0000000000000000000000000000000000000011",
    amountIn: "1",
    tokenOut: "0x0000000000000000000000000000000000000022",
    amountOut: "1",
    notionalUsdE18: "1",
    deadline: 1_900_000_000,
    ledgerExpiresAt: 1_900_000_002,
  };
}
