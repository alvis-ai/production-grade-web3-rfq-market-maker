import assert from "node:assert/strict";
import test from "node:test";
import { PostgresInventoryService } from "../dist/modules/inventory/postgres-inventory.service.js";

const tokenA = "0x0000000000000000000000000000000000000002";
const tokenB = "0x0000000000000000000000000000000000000003";

test("PostgresInventoryService applies token deltas in one transaction and deterministic lock order", async () => {
  const { pool, client } = fakePool(async () => ({ rows: [], rowCount: 1 }));
  const service = new PostgresInventoryService(pool);

  await service.applySettlement({
    chainId: 1,
    tokenIn: tokenB,
    tokenOut: tokenA,
    amountIn: "1000",
    amountOut: "990",
  });

  assert.equal(client.queries[0].sql, "BEGIN");
  assert.match(client.queries[1].sql, /INSERT INTO inventory_positions/);
  assert.equal(client.queries[1].params[2], tokenA);
  assert.equal(client.queries[1].params[3], "-990");
  assert.equal(client.queries[2].params[2], tokenB);
  assert.equal(client.queries[2].params[3], "1000");
  assert.equal(client.queries[3].sql, "COMMIT");
  assert.equal(client.released, true);
});

test("PostgresInventoryService rolls back partial settlement updates", async () => {
  let inventoryWrites = 0;
  const { pool, client } = fakePool(async (sql) => {
    if (sql.includes("INSERT INTO inventory_positions") && ++inventoryWrites === 2) {
      throw new Error("write failed");
    }
    return { rows: [], rowCount: 1 };
  });
  const service = new PostgresInventoryService(pool);

  await assert.rejects(
    service.applySettlement({
      chainId: 1,
      tokenIn: tokenA,
      tokenOut: tokenB,
      amountIn: "1000",
      amountOut: "990",
    }),
    /write failed/,
  );

  assert.equal(client.queries.at(-1).sql, "ROLLBACK");
  assert.equal(client.released, true);
});

test("PostgresInventoryService reads shared balances for projection and skew", async () => {
  const balances = new Map([[tokenA, "1000"], [tokenB, "-100000000"]]);
  const { pool } = fakePool(async (sql, params) => {
    if (sql.includes("SELECT balance::text")) {
      const balance = balances.get(params[1]);
      return { rows: balance === undefined ? [] : [{ balance }], rowCount: balance === undefined ? 0 : 1 };
    }
    return { rows: [], rowCount: 0 };
  });
  const service = new PostgresInventoryService(pool);

  assert.deepEqual(await service.getPosition(1, tokenA), { chainId: 1, token: tokenA, balance: 1000n });
  assert.deepEqual(await service.projectSettlement({
    chainId: 1,
    tokenIn: tokenA,
    tokenOut: tokenB,
    amountIn: "20",
    amountOut: "10",
  }), {
    tokenIn: { chainId: 1, token: tokenA, balance: 1020n },
    tokenOut: { chainId: 1, token: tokenB, balance: -100000010n },
  });
  assert.equal(await service.calculateQuoteSkewBps({ chainId: 1, token: tokenB }), 2);
});

test("PostgresInventoryService rebuilds canonical settlement and terminal hedge projection", async () => {
  const { pool, client } = fakePool(async () => ({ rows: [], rowCount: 1 }));
  const service = new PostgresInventoryService(pool);

  await service.rebuildFromCanonicalSettlementEvents(client);

  assert.equal(client.queries[0].sql, "LOCK TABLE inventory_positions IN EXCLUSIVE MODE");
  assert.equal(client.queries[1].sql, "DELETE FROM inventory_positions");
  assert.match(client.queries[2].sql, /WHERE canonical = TRUE/);
  assert.match(client.queries[2].sql, /FROM hedge_orders AS hedge/);
  assert.match(client.queries[2].sql, /WHERE hedge\.filled_amount IS NOT NULL/);
  assert.match(client.queries[2].sql, /SUM\(delta\)/);
});

test("PostgresInventoryService lists a chain portfolio in deterministic token order", async () => {
  const { pool, client } = fakePool(async (sql, params) => {
    assert.match(sql, /ORDER BY token_address/);
    assert.deepEqual(params, [1]);
    return {
      rows: [
        { token_address: tokenA, balance: "1000" },
        { token_address: tokenB, balance: "-990" },
      ],
      rowCount: 2,
    };
  });
  const positions = await new PostgresInventoryService(pool).listPositions(1);
  assert.deepEqual(positions, [
    { chainId: 1, token: tokenA, balance: 1000n },
    { chainId: 1, token: tokenB, balance: -990n },
  ]);
  assert.equal(client.released, true);
});

test("PostgresInventoryService rejects unsafe dependencies and malformed rows", async () => {
  assert.throws(() => new PostgresInventoryService(null), /pool\.connect must be a function/);
  const { pool } = fakePool(async () => ({ rows: [{ balance: "01" }], rowCount: 1 }));
  const service = new PostgresInventoryService(pool);
  await assert.rejects(service.getPosition(1, tokenA), /canonical integer string/);
});

function fakePool(handler) {
  const client = {
    queries: [],
    released: false,
    async query(sql, params = []) {
      this.queries.push({ sql: sql.trim(), params });
      return handler(sql, params);
    },
    release() {
      this.released = true;
    },
  };
  return {
    client,
    pool: {
      async connect() {
        return client;
      },
    },
  };
}
