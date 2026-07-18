import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { endPool, getPool } from "../backend/dist/db/pool.js";
import { ConfiguredTokenRegistry } from "../backend/dist/modules/pricing/token-registry.js";
import { PostgresQuoteRepository } from "../backend/dist/modules/quote/postgres-quote.repository.js";
import { PostgresQuoteExposureStore } from "../backend/dist/modules/risk/postgres-quote-exposure.store.js";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
if (process.env.RFQ_QUOTE_EXPOSURE_INTEGRATION_CONFIRM !== "yes") {
  throw new Error(
    "RFQ_QUOTE_EXPOSURE_INTEGRATION_CONFIRM=yes is required because this check writes synthetic quote data",
  );
}

const pool = getPool();
const runId = randomBytes(8).toString("hex");
const snapshotId = `s_exposure_${runId}`;
const principalId = `principal_exposure_${runId}`;
const chainId = 1;
const tokenIn = randomAddress();
const tokenOut = randomAddress();
const settlementAddress = randomAddress();
const treasuryAddress = randomAddress();
const amount = "100000000000000000000";
const deadline = Math.floor(Date.now() / 1_000) + 300;
const quoteIds = {
  stale: `q_exposure_stale_${runId}`,
  userA: `q_exposure_user_a_${runId}`,
  userB: `q_exposure_user_b_${runId}`,
  pairA: `q_exposure_pair_a_${runId}`,
  pairB: `q_exposure_pair_b_${runId}`,
  treasuryA: `q_exposure_treasury_a_${runId}`,
  treasuryB: `q_exposure_treasury_b_${runId}`,
};
const allQuoteIds = Object.values(quoteIds);
const sharedUser = randomAddress();
const requests = {
  [quoteIds.stale]: quoteRequest(randomAddress()),
  [quoteIds.userA]: quoteRequest(sharedUser),
  [quoteIds.userB]: quoteRequest(sharedUser),
  [quoteIds.pairA]: quoteRequest(randomAddress()),
  [quoteIds.pairB]: quoteRequest(randomAddress()),
  [quoteIds.treasuryA]: quoteRequest(randomAddress()),
  [quoteIds.treasuryB]: quoteRequest(randomAddress()),
};
const pricing = {
  amountOut: amount,
  minAmountOut: "99000000000000000000",
  spreadBps: 10,
  sizeImpactBps: 0,
  marketSpreadBps: 10,
  inventorySkewBps: 0,
  volatilityPremiumBps: 0,
  hedgeCostBps: 0,
  pricingVersion: "exposure-integration-v1",
};
const tokenRegistry = new ConfiguredTokenRegistry({
  tokens: [
    {
      chainId,
      tokenAddress: tokenIn,
      symbol: "USD_IN",
      decimals: 18,
      isWhitelisted: true,
      riskTier: "low",
      usdReference: true,
    },
    {
      chainId,
      tokenAddress: tokenOut,
      symbol: "USD_OUT",
      decimals: 18,
      isWhitelisted: true,
      riskTier: "low",
      usdReference: true,
    },
  ],
});
const quoteRepository = new PostgresQuoteRepository(pool);
let fixtureStarted = false;

try {
  await assertRequiredMigrations();
  await assertIndependentDatabaseSessions();
  await pool.query(
    `INSERT INTO market_snapshots (
       id, chain_id, token_in, token_out, mid_price, bid_price, ask_price,
       liquidity_usd, market_spread_bps, volatility_bps, source, observed_at
     ) VALUES ($1, $2, $3, $4, '1.000000000000000000', '0.999000000000000000',
       '1.001000000000000000', 1000000, 20, 25, 'quote-exposure-integration', now())`,
    [snapshotId, chainId, tokenIn, tokenOut],
  );
  fixtureStarted = true;

  for (const quoteId of allQuoteIds) {
    await quoteRepository.saveRequested({
      quoteId,
      principalId,
      request: requests[quoteId],
      snapshotId,
    });
  }

  await quoteRepository.saveRequested({
    quoteId: quoteIds.userA,
    principalId,
    request: requests[quoteIds.userA],
    snapshotId,
  });
  assert.equal((await quoteRepository.findStatus(quoteIds.userA, principalId))?.status, "requested");
  assert.equal(await quoteRepository.findStatus(quoteIds.userA, `other_${runId}`), undefined);
  assert.equal(
    Number((await pool.query("SELECT count(*) FROM quotes WHERE id = $1", [quoteIds.userA])).rows[0].count),
    1,
  );

  await insertExpiredReservation();

  const userStore = new PostgresQuoteExposureStore(
    pool,
    { maxUserOpenNotionalUsd: "150", maxPairOpenNotionalUsd: "1000" },
    tokenRegistry,
  );
  const userResult = await assertExclusiveRace({
    store: userStore,
    inputs: [reserveInput(quoteIds.userA), reserveInput(quoteIds.userB)],
    reasonCode: "USER_OPEN_NOTIONAL_LIMIT_EXCEEDED",
  });
  assert.equal(
    Number((await pool.query(
      "SELECT count(*) FROM quote_exposure_reservations WHERE quote_id = $1",
      [quoteIds.stale],
    )).rows[0].count),
    0,
    "a normal reservation must clean expired exposure rows",
  );

  const pairStore = new PostgresQuoteExposureStore(
    pool,
    { maxUserOpenNotionalUsd: "1000", maxPairOpenNotionalUsd: "150" },
    tokenRegistry,
  );
  const pairResult = await assertExclusiveRace({
    store: pairStore,
    inputs: [reserveInput(quoteIds.pairA), reserveInput(quoteIds.pairB)],
    reasonCode: "PAIR_OPEN_NOTIONAL_LIMIT_EXCEEDED",
  });

  const treasuryLiquidity = {
    chainId,
    settlementAddress,
    treasuryAddress,
    token: tokenOut,
    availableBalance: "150000000000000000000",
    blockNumber: 12_345n,
  };
  const treasuryStore = new PostgresQuoteExposureStore(
    pool,
    { maxUserOpenNotionalUsd: "1000", maxPairOpenNotionalUsd: "1000" },
    tokenRegistry,
  );
  const treasuryResult = await assertExclusiveRace({
    store: treasuryStore,
    inputs: [
      reserveInput(quoteIds.treasuryA, treasuryLiquidity),
      reserveInput(quoteIds.treasuryB, treasuryLiquidity),
    ],
    reasonCode: "TREASURY_LIQUIDITY_INSUFFICIENT",
  });

  const remaining = await pool.query(
    "SELECT quote_id FROM quote_exposure_reservations WHERE quote_id = ANY($1::text[])",
    [allQuoteIds],
  );
  assert.equal(remaining.rowCount, 0, "the integration check must release every active reservation");

  process.stdout.write(`${JSON.stringify({
    status: "ok",
    checks: {
      requestedQuoteIdempotency: true,
      expiredReservationCleanup: true,
      userConcurrency: userResult,
      pairConcurrency: pairResult,
      treasuryConcurrency: treasuryResult,
    },
  }, null, 2)}\n`);
} finally {
  try {
    if (fixtureStarted) await cleanup();
  } finally {
    await endPool();
  }
}

function quoteRequest(user) {
  return {
    chainId,
    user,
    tokenIn,
    tokenOut,
    amountIn: amount,
    slippageBps: 50,
  };
}

function reserveInput(quoteId, treasuryLiquidity) {
  return {
    quoteId,
    request: requests[quoteId],
    pricing,
    deadline,
    ...(treasuryLiquidity ? { treasuryLiquidity } : {}),
  };
}

async function assertExclusiveRace({ store, inputs, reasonCode }) {
  const results = await Promise.all(inputs.map((input) => store.reserve(input)));
  assert.deepEqual(
    results.map((result) => result.status).sort(),
    ["rejected", "reserved"],
    `${reasonCode} race must allow exactly one reservation`,
  );
  const winnerIndex = results.findIndex((result) => result.status === "reserved");
  const loserIndex = winnerIndex === 0 ? 1 : 0;
  assert.equal(results[loserIndex].reasonCode, reasonCode);

  const rows = await pool.query(
    `SELECT quote_id, notional_usd_e18::text
     FROM quote_exposure_reservations
     WHERE quote_id = ANY($1::text[])`,
    [inputs.map((input) => input.quoteId)],
  );
  assert.equal(rows.rowCount, 1, `${reasonCode} race must persist one database row`);
  assert.equal(rows.rows[0].quote_id, inputs[winnerIndex].quoteId);
  assert.equal(rows.rows[0].notional_usd_e18, amount);

  const replay = await store.reserve(inputs[winnerIndex]);
  assert.equal(replay.status, "reserved", `${reasonCode} winner replay must be idempotent`);
  assert.equal(
    Number((await pool.query(
      "SELECT count(*) FROM quote_exposure_reservations WHERE quote_id = ANY($1::text[])",
      [inputs.map((input) => input.quoteId)],
    )).rows[0].count),
    1,
  );

  await store.release(inputs[winnerIndex].quoteId);
  const retry = await store.reserve(inputs[loserIndex]);
  assert.equal(retry.status, "reserved", `${reasonCode} release must restore capacity`);
  await store.release(inputs[loserIndex].quoteId);

  return {
    exactlyOneReserved: true,
    rejectedReasonCode: reasonCode,
    replayIdempotent: true,
    releaseRestoresCapacity: true,
  };
}

async function assertRequiredMigrations() {
  const migrations = await pool.query("SELECT version FROM _migrations ORDER BY version");
  const applied = new Set(migrations.rows.map((row) => row.version));
  for (const version of ["011", "016", "017", "022", "037"]) {
    assert.equal(applied.has(version), true, `migration ${version} must be applied`);
  }
}

async function assertIndependentDatabaseSessions() {
  const clients = await Promise.all([pool.connect(), pool.connect()]);
  try {
    const pids = await Promise.all(clients.map(async (client) => {
      const result = await client.query("SELECT pg_backend_pid()::text AS pid");
      return result.rows[0].pid;
    }));
    assert.notEqual(pids[0], pids[1], "concurrency check requires two PostgreSQL sessions");
  } finally {
    for (const client of clients) client.release();
  }
}

async function insertExpiredReservation() {
  const [tokenLow, tokenHigh] = [tokenIn, tokenOut].sort();
  await pool.query(
    `INSERT INTO quote_exposure_reservations (
       quote_id, chain_id, user_address, token_low, token_high, token_in, amount_in,
       token_out, amount_out, notional_usd_e18, expires_at, ledger_expires_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
       now() - interval '5 seconds', now() - interval '5 seconds'
     )`,
    [
      quoteIds.stale,
      chainId,
      requests[quoteIds.stale].user,
      tokenLow,
      tokenHigh,
      tokenIn,
      amount,
      tokenOut,
      amount,
      amount,
    ],
  );
}

async function cleanup() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "DELETE FROM quote_exposure_reservations WHERE quote_id = ANY($1::text[])",
      [allQuoteIds],
    );
    await client.query("DELETE FROM quotes WHERE id = ANY($1::text[])", [allQuoteIds]);
    await client.query("DELETE FROM market_snapshots WHERE id = $1", [snapshotId]);
    await client.query(
      `DELETE FROM analytics_outbox
       WHERE aggregate_id = ANY($1::text[]) OR payload->>'quoteId' = ANY($1::text[])`,
      [[snapshotId, ...allQuoteIds]],
    );
    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

function randomAddress() {
  return `0x${randomBytes(20).toString("hex")}`;
}
