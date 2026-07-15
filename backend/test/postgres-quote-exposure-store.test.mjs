import assert from "node:assert/strict";
import test from "node:test";
import { ConfiguredTokenRegistry } from "../dist/modules/pricing/token-registry.js";
import { PostgresQuoteExposureStore } from "../dist/modules/risk/postgres-quote-exposure.store.js";

const tokenA = "0x0000000000000000000000000000000000000011";
const tokenB = "0x0000000000000000000000000000000000000022";
const user = "0x00000000000000000000000000000000000000a1";
const now = 1_700_000_000;

test("PostgresQuoteExposureStore locks both scopes before atomically inserting", async () => {
  const { pool, clients } = fakePool(async (sql) => {
    if (sql.includes("FROM quote_exposure_reservations") && sql.includes("COALESCE")) {
      return {
        rows: [{ user_open_notional_usd_e18: "0", pair_open_notional_usd_e18: "0" }],
        rowCount: 1,
      };
    }
    return { rows: [], rowCount: sql.includes("INSERT INTO quote_exposure_reservations") ? 1 : 0 };
  });
  const store = createStore(pool);

  assert.deepEqual(await store.reserve(input("q_pg_exposure")), {
    status: "reserved",
    notionalUsdE18: "101000000000000000000",
  });

  const queries = clients[0].queries;
  assert.equal(queries[0].sql, "BEGIN");
  const locks = queries.filter(({ sql }) => sql.includes("pg_advisory_xact_lock"));
  assert.deepEqual(locks.map(({ params }) => params[0]), [
    `quote-exposure:pair:1:${tokenA}:${tokenB}`,
    "quote-exposure:quote:q_pg_exposure",
    `quote-exposure:user:1:${user}`,
    `quote-liquidity:1:${tokenB}`,
  ]);
  const cleanup = queries.find(({ sql }) => sql.startsWith("DELETE FROM quote_exposure_reservations"));
  assert.match(cleanup.sql, /LIMIT 100/);
  assert.match(cleanup.sql, /FOR UPDATE SKIP LOCKED/);
  const insert = queries.find(({ sql }) => sql.startsWith("INSERT INTO quote_exposure_reservations"));
  assert.match(insert.sql, /EXISTS \(SELECT 1 FROM quotes WHERE id = \$1 AND status = 'requested'\)/);
  assert.deepEqual(insert.params, [
    "q_pg_exposure",
    1,
    user,
    tokenA,
    tokenB,
    tokenA,
    "100000000",
    tokenB,
    "101000000000000000000",
    "101000000000000000000",
    null,
    null,
    null,
    null,
    null,
    null,
    now + 30,
  ]);
  assert.equal(queries.at(-1).sql, "COMMIT");
  assert.equal(clients[0].released, true);
});

test("PostgresQuoteExposureStore serializes and rejects oversubscribed treasury output", async () => {
  const { pool, clients } = fakePool(async (sql) => {
    if (sql.includes("reserved_output_amount")) {
      return { rows: [{ reserved_output_amount: "60000000000000000000" }], rowCount: 1 };
    }
    if (sql.includes("user_open_notional_usd_e18")) {
      return {
        rows: [{ user_open_notional_usd_e18: "0", pair_open_notional_usd_e18: "0" }],
        rowCount: 1,
      };
    }
    return { rows: [], rowCount: 0 };
  });

  const result = await createStore(pool).reserve(withLiquidity(input("q_pg_liquidity"), "150000000000000000000"));
  assert.deepEqual(result, {
    status: "rejected",
    reasonCode: "TREASURY_LIQUIDITY_INSUFFICIENT",
  });
  const outputTotal = clients[0].queries.find(({ sql }) => sql.includes("reserved_output_amount"));
  assert.match(outputTotal.sql, /expires_at > now\(\)/);
  assert.doesNotMatch(outputTotal.sql, /quote\.status/);
  assert.deepEqual(outputTotal.params, [1, tokenB]);
  assert.equal(clients[0].queries.at(-1).sql, "ROLLBACK");
});

test("PostgresQuoteExposureStore rejects user and pair totals without inserting", async () => {
  for (const scenario of [
    {
      totals: { user_open_notional_usd_e18: "200000000000000000000", pair_open_notional_usd_e18: "0" },
      reasonCode: "USER_OPEN_NOTIONAL_LIMIT_EXCEEDED",
    },
    {
      totals: { user_open_notional_usd_e18: "0", pair_open_notional_usd_e18: "450000000000000000000" },
      reasonCode: "PAIR_OPEN_NOTIONAL_LIMIT_EXCEEDED",
    },
  ]) {
    const { pool, clients } = fakePool(async (sql) => {
      if (sql.includes("COALESCE")) return { rows: [scenario.totals], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const result = await createStore(pool).reserve(input(`q_${scenario.reasonCode}`));
    assert.deepEqual(result, { status: "rejected", reasonCode: scenario.reasonCode });
    assert.equal(clients[0].queries.some(({ sql }) => sql.startsWith("INSERT INTO")), false);
    assert.equal(clients[0].queries.at(-1).sql, "ROLLBACK");
  }
});

test("PostgresQuoteExposureStore sums unexpired potentially executable quotes", async () => {
  const { pool, clients } = fakePool(async (sql) => {
    if (sql.includes("COALESCE")) {
      return { rows: [{ user_open_notional_usd_e18: "0", pair_open_notional_usd_e18: "0" }], rowCount: 1 };
    }
    return { rows: [], rowCount: sql.includes("INSERT INTO quote_exposure_reservations") ? 1 : 0 };
  });

  await createStore(pool).reserve(input("q_open_status"));
  const totals = clients[0].queries.find(({ sql }) => sql.includes("COALESCE"));
  assert.match(totals.sql, /JOIN quotes quote ON quote.id = exposure.quote_id/);
  assert.match(totals.sql, /quote.status IN \('requested', 'signed', 'failed'\)/);
  assert.match(totals.sql, /exposure.expires_at > now\(\)/);
});

test("PostgresQuoteExposureStore validates pool, totals, and conditional release", async () => {
  assert.throws(
    () => new PostgresQuoteExposureStore({}, policy(), registry()),
    /pool.connect must be a function/,
  );
  const malformed = fakePool(async (sql) => {
    if (sql.includes("COALESCE")) {
      return { rows: [{ user_open_notional_usd_e18: "1.5", pair_open_notional_usd_e18: "0" }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
  await assert.rejects(createStore(malformed.pool).reserve(input("q_bad_total")), /canonical non-negative integer/);

  const released = fakePool(async () => ({ rows: [], rowCount: 1 }));
  await createStore(released.pool).release("q_release_pg");
  const releaseDelete = released.clients[0].queries.find(({ sql }) =>
    sql.startsWith("DELETE FROM quote_exposure_reservations WHERE quote_id"));
  assert.deepEqual(releaseDelete.params, ["q_release_pg"]);
  assert.equal(released.clients[0].queries[0].sql, "BEGIN");
  assert.equal(released.clients[0].queries.at(-1).sql, "COMMIT");
  assert.equal(released.clients[0].released, true);
});

test("PostgresQuoteExposureStore rolls back when database time considers the deadline expired", async () => {
  const { pool, clients } = fakePool(async (sql) => {
    if (sql.includes("COALESCE")) {
      return { rows: [{ user_open_notional_usd_e18: "0", pair_open_notional_usd_e18: "0" }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });

  await assert.rejects(createStore(pool).reserve(input("q_db_expired")), /deadline is not active by database time/);
  assert.equal(clients[0].queries.at(-1).sql, "ROLLBACK");
});

test("PostgresQuoteExposureStore evaluates inventory and active quotes under one portfolio lock", async () => {
  const { pool, clients } = portfolioPool();
  const store = new PostgresQuoteExposureStore(
    pool,
    { ...policy(), portfolioVar: portfolioVarPolicy("30") },
    registry(false),
    () => now,
  );

  assert.deepEqual(await store.reserve(input("q_pg_var_rejected")), {
    status: "rejected",
    reasonCode: "PORTFOLIO_VAR_LIMIT_EXCEEDED",
  });
  const queries = clients[0].queries;
  const lockScopes = queries
    .filter(({ sql }) => sql.includes("pg_advisory_xact_lock"))
    .map(({ params }) => params[0]);
  assert.ok(lockScopes.includes("quote-exposure:portfolio:1"));
  assert.ok(queries.some(({ sql }) => sql === "LOCK TABLE inventory_positions IN SHARE MODE"));
  assert.ok(queries.some(({ sql }) => sql.includes("SELECT lower(exposure.token_in)")));
  assert.ok(queries.some(({ sql }) => sql.includes("ranked_snapshots")));
  assert.equal(queries.some(({ sql }) => sql.startsWith("INSERT INTO quote_exposure_reservations")), false);
  assert.equal(queries.at(-1).sql, "ROLLBACK");
});

test("PostgresQuoteExposureStore persists replayable portfolio VaR evidence", async () => {
  const { pool, clients } = portfolioPool();
  const store = new PostgresQuoteExposureStore(
    pool,
    { ...policy(), portfolioVar: portfolioVarPolicy("50") },
    registry(false),
    () => now,
  );

  const result = await store.reserve(input("q_pg_var_reserved"));
  assert.equal(result.status, "reserved");
  assert.equal(result.portfolioVar.preTradeVarUsdE18, "20200000000000000000");
  assert.equal(result.portfolioVar.postTradeVarUsdE18, "40400000000000000000");
  const insert = clients[0].queries.find(({ sql }) => sql.startsWith("INSERT INTO quote_exposure_reservations"));
  assert.deepEqual(JSON.parse(insert.params[14]), result.portfolioVar);
  assert.equal(clients[0].queries.at(-1).sql, "COMMIT");
});

test("PostgresQuoteExposureStore rejects hard delta and persists accepted soft-breach evidence", async () => {
  const rejectedPool = portfolioPool();
  const rejectingStore = new PostgresQuoteExposureStore(
    rejectedPool.pool,
    {
      ...policy(),
      portfolioVar: portfolioVarPolicy("50"),
      portfolioDelta: portfolioDeltaPolicy("100", "150"),
    },
    registry(false),
    () => now,
  );
  assert.deepEqual(await rejectingStore.reserve(input("q_pg_delta_rejected")), {
    status: "rejected",
    reasonCode: "PORTFOLIO_DELTA_LIMIT_EXCEEDED",
  });
  assert.equal(
    rejectedPool.clients[0].queries.some(({ sql }) => sql.startsWith("INSERT INTO quote_exposure_reservations")),
    false,
  );

  const acceptedPool = portfolioPool();
  let softBreaches = 0;
  const acceptingStore = new PostgresQuoteExposureStore(
    acceptedPool.pool,
    {
      ...policy(),
      portfolioVar: portfolioVarPolicy("50"),
      portfolioDelta: portfolioDeltaPolicy("150", "300"),
    },
    registry(false),
    () => now,
    { recordPortfolioDeltaSoftBreach: () => { softBreaches += 1; } },
  );
  const result = await acceptingStore.reserve(input("q_pg_delta_reserved"));
  assert.equal(result.status, "reserved");
  assert.equal(result.portfolioDelta.softLimitBreached, true);
  assert.equal(result.portfolioDelta.preTradeGrossDeltaUsdE18, "101000000000000000000");
  assert.equal(result.portfolioDelta.postTradeGrossDeltaUsdE18, "202000000000000000000");
  const insert = acceptedPool.clients[0].queries.find(({ sql }) =>
    sql.startsWith("INSERT INTO quote_exposure_reservations"));
  assert.deepEqual(JSON.parse(insert.params[15]), result.portfolioDelta);
  assert.equal(softBreaches, 1);
});

test("PostgresQuoteExposureStore serializes portfolio reservation release on the same chain lock", async () => {
  const { pool, clients } = fakePool(async (sql) => {
    if (sql.startsWith("SELECT chain_id FROM quote_exposure_reservations")) {
      return { rows: [{ chain_id: "1" }], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  });
  const store = new PostgresQuoteExposureStore(
    pool,
    { ...policy(), portfolioVar: portfolioVarPolicy("50") },
    registry(false),
    () => now,
  );

  await store.release("q_pg_var_release");
  const scopes = clients[0].queries
    .filter(({ sql }) => sql.includes("pg_advisory_xact_lock"))
    .map(({ params }) => params[0]);
  assert.deepEqual(scopes, [
    "quote-exposure:portfolio:1",
    "quote-exposure:quote:q_pg_var_release",
  ]);
  assert.equal(clients[0].queries.at(-1).sql, "COMMIT");
});

function createStore(pool) {
  return new PostgresQuoteExposureStore(pool, policy(), registry(), () => now);
}

function input(quoteId) {
  return {
    quoteId,
    request: {
      chainId: 1,
      user,
      tokenIn: tokenA,
      tokenOut: tokenB,
      amountIn: "100000000",
      slippageBps: 50,
    },
    pricing: {
      amountOut: "101000000000000000000",
      minAmountOut: "100000000000000000000",
      spreadBps: 10,
      sizeImpactBps: 1,
      marketSpreadBps: 0,
      inventorySkewBps: 0,
      volatilityPremiumBps: 0,
      hedgeCostBps: 0,
      pricingVersion: "exposure-test-v1",
    },
    deadline: now + 30,
  };
}

function withLiquidity(value, availableBalance) {
  return {
    ...value,
    treasuryLiquidity: {
      chainId: 1,
      settlementAddress: "0x0000000000000000000000000000000000000044",
      treasuryAddress: "0x0000000000000000000000000000000000000055",
      token: tokenB,
      availableBalance,
      blockNumber: 123n,
    },
  };
}

function policy() {
  return { maxUserOpenNotionalUsd: "250", maxPairOpenNotionalUsd: "500" };
}

function registry(allUsdReference = true) {
  return new ConfiguredTokenRegistry({
    tokens: [
      token(tokenA, 6, allUsdReference),
      token(tokenB, 18, true),
    ],
  });
}

function token(tokenAddress, decimals, usdReference = true) {
  return {
    chainId: 1,
    tokenAddress,
    symbol: `T${decimals}`,
    decimals,
    isWhitelisted: true,
    riskTier: "low",
    usdReference,
  };
}

function portfolioVarPolicy(maxPortfolioVarUsd) {
  return {
    modelVersion: "component-sum-v1",
    maxPortfolioVarUsd,
    confidenceMultiplierBps: 20_000,
    horizonSeconds: 86_400,
    maxSnapshotAgeMs: 5_000,
    maxFutureSkewMs: 5_000,
    valuationPairs: [{
      chainId: 1,
      tokenAddress: tokenA,
      usdReferenceTokenAddress: tokenB,
    }],
  };
}

function portfolioDeltaPolicy(softLimitUsd, hardLimitUsd) {
  return {
    modelVersion: "gross-net-delta-v1",
    softGrossLimitUsd: softLimitUsd,
    hardGrossLimitUsd: hardLimitUsd,
    softNetLimitUsd: softLimitUsd,
    hardNetLimitUsd: hardLimitUsd,
  };
}

function portfolioPool() {
  return fakePool(async (sql) => {
    if (sql.includes("user_open_notional_usd_e18")) {
      return {
        rows: [{ user_open_notional_usd_e18: "0", pair_open_notional_usd_e18: "0" }],
        rowCount: 1,
      };
    }
    if (sql.includes("FROM inventory_positions")) {
      return { rows: [{ token_address: tokenA, balance: "50000000" }], rowCount: 1 };
    }
    if (sql.includes("SELECT lower(exposure.token_in)")) {
      return {
        rows: [{
          token_in: tokenA,
          amount_in: "50000000",
          token_out: tokenB,
          amount_out: "50500000000000000000",
        }],
        rowCount: 1,
      };
    }
    if (sql.includes("ranked_snapshots")) {
      return {
        rows: [{
          id: "snap_pg_var",
          chain_id: 1,
          token_in: tokenA,
          token_out: tokenB,
          mid_price: "1.01",
          volatility_bps: 1_000,
          observed_at: new Date(now * 1_000),
        }],
        rowCount: 1,
      };
    }
    return { rows: [], rowCount: sql.startsWith("INSERT INTO quote_exposure_reservations") ? 1 : 0 };
  });
}

function fakePool(handler) {
  const clients = [];
  return {
    clients,
    pool: {
      async connect() {
        const client = {
          queries: [],
          released: false,
          async query(sql, params = []) {
            const normalized = sql.trim();
            this.queries.push({ sql: normalized, params });
            return handler(normalized, params);
          },
          release() {
            this.released = true;
          },
        };
        clients.push(client);
        return client;
      },
    },
  };
}
