import pg from "pg";
import type { Address } from "../../shared/types/rfq.js";
import {
  assertInventoryPositionKey,
  assertInventoryServiceConfig,
  assertInventorySkewInput,
  assertSettlementDelta,
  calculateInventorySkewBps,
  cloneInventoryServiceConfig,
  defaultInventoryServiceConfig,
  type IInventoryService,
  type InventoryPosition,
  type InventoryProjection,
  type InventoryProjectionInput,
  type InventoryServiceConfig,
  type InventorySkewInput,
  type SettlementDelta,
} from "./inventory.service.js";

const canonicalInventoryProjectionSql = `
  INSERT INTO inventory_positions (id, chain_id, token_address, balance, updated_at)
  SELECT
    'ip_' || chain_id::text || '_' || substring(token_address from 3),
    chain_id,
    token_address,
    SUM(delta),
    now()
  FROM (
    SELECT chain_id, lower(token_in) AS token_address, amount_in AS delta
    FROM settlement_events
    WHERE canonical = TRUE
    UNION ALL
    SELECT chain_id, lower(token_out) AS token_address, -amount_out AS delta
    FROM settlement_events
    WHERE canonical = TRUE
  ) AS inventory_deltas
  GROUP BY chain_id, token_address
`;

export class PostgresInventoryService implements IInventoryService {
  private readonly config: InventoryServiceConfig;

  constructor(
    private readonly pool: pg.Pool,
    config: InventoryServiceConfig = defaultInventoryServiceConfig,
  ) {
    assertPool(pool);
    assertInventoryServiceConfig(config);
    this.config = cloneInventoryServiceConfig(config);
  }

  async checkHealth(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("SELECT 1 FROM inventory_positions LIMIT 1");
    } finally {
      client.release();
    }
  }

  async applySettlement(delta: SettlementDelta): Promise<void> {
    assertSettlementDelta(delta);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.applySettlementWithClient(client, delta);
      await client.query("COMMIT");
    } catch (error) {
      await rollbackBestEffort(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async applySettlementWithClient(client: pg.PoolClient, delta: SettlementDelta): Promise<void> {
    assertPoolClient(client);
    assertSettlementDelta(delta);
    const tokenDeltas = [
      { token: delta.tokenIn.toLowerCase() as Address, amount: delta.amountIn },
      { token: delta.tokenOut.toLowerCase() as Address, amount: `-${delta.amountOut}` },
    ].sort((left, right) => left.token.localeCompare(right.token));

    for (const tokenDelta of tokenDeltas) {
      await client.query(
        `INSERT INTO inventory_positions (id, chain_id, token_address, balance, updated_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (chain_id, token_address) DO UPDATE SET
           balance = inventory_positions.balance + EXCLUDED.balance,
           updated_at = now()`,
        [inventoryPositionId(delta.chainId, tokenDelta.token), delta.chainId, tokenDelta.token, tokenDelta.amount],
      );
    }
  }

  async rebuildFromSettlements(deltas: readonly SettlementDelta[]): Promise<void> {
    if (!Array.isArray(deltas)) {
      throw new Error("Inventory settlement replay input must be an array");
    }
    for (const delta of deltas) assertSettlementDelta(delta);

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("LOCK TABLE inventory_positions IN EXCLUSIVE MODE");
      await client.query("DELETE FROM inventory_positions");
      for (const delta of deltas) await this.applySettlementWithClient(client, delta);
      await client.query("COMMIT");
    } catch (error) {
      await rollbackBestEffort(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async rebuildFromCanonicalSettlementEvents(client: pg.PoolClient): Promise<void> {
    assertPoolClient(client);
    await client.query("LOCK TABLE inventory_positions IN EXCLUSIVE MODE");
    await client.query("DELETE FROM inventory_positions");
    await client.query(canonicalInventoryProjectionSql);
  }

  async projectSettlement(input: InventoryProjectionInput): Promise<InventoryProjection> {
    assertSettlementDelta(input);
    const [tokenIn, tokenOut] = await Promise.all([
      this.getPosition(input.chainId, input.tokenIn),
      this.getPosition(input.chainId, input.tokenOut),
    ]);
    return {
      tokenIn: { ...tokenIn, balance: tokenIn.balance + BigInt(input.amountIn) },
      tokenOut: { ...tokenOut, balance: tokenOut.balance - BigInt(input.amountOut) },
    };
  }

  async calculateQuoteSkewBps(input: InventorySkewInput): Promise<number> {
    assertInventorySkewInput(input);
    const position = await this.getPosition(input.chainId, input.token);
    return calculateInventorySkewBps(position.balance, this.config);
  }

  async getPosition(chainId: number, token: Address): Promise<InventoryPosition> {
    assertInventoryPositionKey(chainId, token);
    const normalizedToken = token.toLowerCase() as Address;
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT balance::text AS balance
         FROM inventory_positions
         WHERE chain_id = $1 AND token_address = $2`,
        [chainId, normalizedToken],
      );
      if (result.rows.length > 1) {
        throw new Error("Postgres inventory query returned duplicate positions");
      }
      const balance = result.rows.length === 0 ? 0n : parseBalance(result.rows[0]?.balance);
      return { chainId, token, balance };
    } finally {
      client.release();
    }
  }
}

function inventoryPositionId(chainId: number, token: Address): string {
  return `ip_${chainId}_${token.slice(2).toLowerCase()}`;
}

function parseBalance(value: unknown): bigint {
  if (typeof value !== "string" || !/^(0|-?[1-9][0-9]*)$/.test(value)) {
    throw new Error("Postgres inventory balance must be a canonical integer string");
  }
  return BigInt(value);
}

function assertPool(pool: unknown): asserts pool is pg.Pool {
  if (typeof pool !== "object" || pool === null || Array.isArray(pool) ||
      typeof (pool as Record<string, unknown>).connect !== "function") {
    throw new Error("Postgres inventory pool.connect must be a function");
  }
}

function assertPoolClient(client: unknown): asserts client is pg.PoolClient {
  if (typeof client !== "object" || client === null || Array.isArray(client) ||
      typeof (client as Record<string, unknown>).query !== "function") {
    throw new Error("Postgres inventory client.query must be a function");
  }
}

async function rollbackBestEffort(client: pg.PoolClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {}
}
