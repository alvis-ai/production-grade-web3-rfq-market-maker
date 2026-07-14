import pg from "pg";
import type { SettlementEventStatusResponse } from "../../shared/types/rfq.js";
import { isCanonicalUtcIsoTimestamp } from "../../shared/validation/timestamp.js";
import { PostgresInventoryService } from "../inventory/postgres-inventory.service.js";
import type { SettlementDelta } from "../inventory/inventory.service.js";
import {
  assertRemoveSettlementEventInput,
  assertSafeIdentifier,
  assertSettlementQuoteHashLookupInput,
  buildSettlementEvent,
  cloneSettlementEvent,
  normalizeEventOrdinal,
  normalizeQuoteHash,
  normalizeTxHash,
  settlementEventsMatch,
  type ApplySettlementEventInput,
  type ApplySettlementEventResult,
  type GetSettlementEventsByQuoteHashInput,
  type RemoveSettlementEventInput,
  type RemoveSettlementEventResult,
  type SettlementEventStore,
} from "./settlement-event.service.js";

const settlementColumns = `
  id, quote_id, chain_id, tx_hash, quote_hash, log_index, block_number,
  user_address, token_in, token_out, amount_in, amount_out, nonce,
  settled_at, created_at, canonical
`;
const inventoryProjectionLockId = 1_384_717_921;

interface StoredSettlementEvent {
  canonical: boolean;
  event: SettlementEventStatusResponse;
}

export class PostgresSettlementEventStore implements SettlementEventStore {
  constructor(
    private readonly pool: pg.Pool,
    private readonly inventoryService: PostgresInventoryService,
  ) {
    assertPool(pool);
    if (!(inventoryService instanceof PostgresInventoryService)) {
      throw new Error("Postgres settlement store requires PostgresInventoryService");
    }
  }

  async initialize(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1)", [inventoryProjectionLockId]);
      await client.query("LOCK TABLE settlement_events IN SHARE MODE");
      await this.inventoryService.rebuildFromCanonicalSettlementEvents(client);
      await client.query("COMMIT");
    } catch (error) {
      await rollbackBestEffort(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async checkHealth(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("SELECT canonical FROM settlement_events LIMIT 1");
    } finally {
      client.release();
    }
  }

  async applySettlementEvent(input: ApplySettlementEventInput): Promise<ApplySettlementEventResult> {
    const candidate = buildSettlementEvent(input);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query(
        `INSERT INTO settlement_events (
           id, quote_id, chain_id, tx_hash, quote_hash, log_index, block_number,
           user_address, token_in, token_out, amount_in, amount_out, nonce, settled_at, canonical
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, TRUE)
         ON CONFLICT DO NOTHING
         RETURNING ${settlementColumns}`,
        eventParams(candidate),
      );

      if (inserted.rows.length === 1) {
        const stored = parseStoredSettlementEvent(inserted.rows[0]);
        await this.inventoryService.applySettlementWithClient(client, settlementDelta(stored.event));
        await client.query("COMMIT");
        return { event: cloneSettlementEvent(stored.event), duplicate: false };
      }
      if (inserted.rows.length !== 0) {
        throw new Error("Postgres settlement insert returned multiple rows");
      }

      const conflicts = await client.query(
        `SELECT ${settlementColumns}
         FROM settlement_events
         WHERE (chain_id = $1 AND tx_hash = $2 AND log_index = $3) OR quote_id = $4
         FOR UPDATE`,
        [candidate.chainId, candidate.txHash, candidate.logIndex, candidate.quoteId],
      );
      const matching = conflicts.rows
        .map(parseStoredSettlementEvent)
        .find((stored) => settlementEventsMatch(stored.event, candidate));
      if (!matching) {
        throw new Error(`Postgres settlement event conflict for ${candidate.settlementEventId}`);
      }
      if (matching.canonical) {
        await client.query("COMMIT");
        return { event: cloneSettlementEvent(matching.event), duplicate: true };
      }

      const reactivated = await client.query(
        `UPDATE settlement_events
         SET canonical = TRUE, removed_at = NULL
         WHERE id = $1 AND canonical = FALSE
         RETURNING ${settlementColumns}`,
        [matching.event.settlementEventId],
      );
      if (reactivated.rows.length !== 1) {
        throw new Error(`Postgres settlement reactivation conflict for ${candidate.settlementEventId}`);
      }
      const stored = parseStoredSettlementEvent(reactivated.rows[0]);
      await this.inventoryService.rebuildFromCanonicalSettlementEvents(client);
      await client.query("COMMIT");
      return { event: cloneSettlementEvent(stored.event), duplicate: false };
    } catch (error) {
      await rollbackBestEffort(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async removeSettlementEvent(input: RemoveSettlementEventInput): Promise<RemoveSettlementEventResult> {
    assertRemoveSettlementEventInput(input);
    const txHash = normalizeTxHash(input.txHash);
    const logIndex = normalizeEventOrdinal(input.logIndex, "logIndex");
    const blockNumber = normalizeEventOrdinal(input.blockNumber, "blockNumber");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const selected = await client.query(
        `SELECT ${settlementColumns}
         FROM settlement_events
         WHERE chain_id = $1 AND tx_hash = $2 AND log_index = $3 AND canonical = TRUE
         FOR UPDATE`,
        [input.chainId, txHash, logIndex],
      );
      if (selected.rows.length === 0) {
        await client.query("COMMIT");
        return { removed: false };
      }
      if (selected.rows.length !== 1) {
        throw new Error("Postgres settlement removal returned duplicate events");
      }
      const stored = parseStoredSettlementEvent(selected.rows[0]);
      if (stored.event.blockNumber !== blockNumber) {
        throw new Error(`Settlement event reorg block conflict for ${stored.event.settlementEventId}`);
      }

      const updated = await client.query(
        `UPDATE settlement_events
         SET canonical = FALSE, removed_at = now()
         WHERE id = $1 AND canonical = TRUE`,
        [stored.event.settlementEventId],
      );
      if (updated.rowCount !== 1) {
        throw new Error(`Postgres settlement removal conflict for ${stored.event.settlementEventId}`);
      }
      await this.inventoryService.rebuildFromCanonicalSettlementEvents(client);
      await client.query("COMMIT");
      return { event: cloneSettlementEvent(stored.event), removed: true };
    } catch (error) {
      await rollbackBestEffort(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async getSettlementEvent(settlementEventId: string): Promise<SettlementEventStatusResponse | undefined> {
    assertSafeIdentifier(settlementEventId, "settlementEventId");
    const rows = await this.queryEvents(
      `SELECT ${settlementColumns} FROM settlement_events WHERE id = $1 AND canonical = TRUE`,
      [settlementEventId],
    );
    if (rows.length > 1) throw new Error("Postgres settlement id query returned duplicate events");
    return rows[0] ? cloneSettlementEvent(rows[0]) : undefined;
  }

  async getSettlementEventsByQuoteHash(
    input: GetSettlementEventsByQuoteHashInput,
  ): Promise<SettlementEventStatusResponse[]> {
    assertSettlementQuoteHashLookupInput(input);
    return this.queryEvents(
      `SELECT ${settlementColumns}
       FROM settlement_events
       WHERE chain_id = $1 AND quote_hash = $2 AND canonical = TRUE
       ORDER BY block_number ASC, log_index ASC`,
      [input.chainId, normalizeQuoteHash(input.quoteHash)],
    );
  }

  async listSettlementEvents(): Promise<SettlementEventStatusResponse[]> {
    return this.queryEvents(
      `SELECT ${settlementColumns}
       FROM settlement_events
       WHERE canonical = TRUE
       ORDER BY block_number ASC, log_index ASC`,
      [],
    );
  }

  private async queryEvents(sql: string, params: unknown[]): Promise<SettlementEventStatusResponse[]> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(sql, params);
      return result.rows.map(parseStoredSettlementEvent).map(({ event }) => cloneSettlementEvent(event));
    } finally {
      client.release();
    }
  }
}

function eventParams(event: SettlementEventStatusResponse): unknown[] {
  return [
    event.settlementEventId,
    event.quoteId,
    event.chainId,
    event.txHash,
    event.quoteHash,
    event.logIndex,
    event.blockNumber,
    event.user,
    event.tokenIn,
    event.tokenOut,
    event.amountIn,
    event.amountOut,
    event.nonce,
    event.observedAt,
  ];
}

function settlementDelta(event: SettlementEventStatusResponse): SettlementDelta {
  return {
    chainId: event.chainId,
    tokenIn: event.tokenIn,
    tokenOut: event.tokenOut,
    amountIn: event.amountIn,
    amountOut: event.amountOut,
  };
}

function parseStoredSettlementEvent(row: unknown): StoredSettlementEvent {
  if (typeof row !== "object" || row === null || Array.isArray(row)) {
    throw new Error("Postgres settlement row must be an object");
  }
  const value = row as Record<string, unknown>;
  const observedAt = parseTimestamp(value.settled_at ?? value.created_at);
  const event: SettlementEventStatusResponse = {
    settlementEventId: parseSafeIdentifier(value.id, "id"),
    status: "applied",
    quoteId: parseSafeIdentifier(value.quote_id, "quote_id"),
    chainId: parseSafeInteger(value.chain_id, "chain_id", true),
    txHash: parseHash(value.tx_hash, "tx_hash"),
    quoteHash: parseHash(value.quote_hash, "quote_hash"),
    blockNumber: parseSafeInteger(value.block_number, "block_number", false),
    logIndex: parseSafeInteger(value.log_index, "log_index", false),
    user: parseAddress(value.user_address, "user_address"),
    tokenIn: parseAddress(value.token_in, "token_in"),
    tokenOut: parseAddress(value.token_out, "token_out"),
    amountIn: parsePositiveUInt(value.amount_in, "amount_in"),
    amountOut: parsePositiveUInt(value.amount_out, "amount_out"),
    nonce: parsePositiveUInt(value.nonce, "nonce"),
    observedAt,
  };
  if (event.tokenIn.toLowerCase() === event.tokenOut.toLowerCase()) {
    throw new Error("Postgres settlement row tokens must be distinct");
  }
  if (typeof value.canonical !== "boolean") {
    throw new Error("Postgres settlement row canonical must be a boolean");
  }
  return { event, canonical: value.canonical };
}

function parseTimestamp(value: unknown): string {
  const timestamp = value instanceof Date ? value.toISOString() : value;
  if (typeof timestamp !== "string" || !isCanonicalUtcIsoTimestamp(timestamp)) {
    throw new Error("Postgres settlement row created_at must be a canonical UTC ISO timestamp");
  }
  return timestamp;
}

function parseSafeIdentifier(value: unknown, field: string): string {
  assertSafeIdentifier(value, field);
  return value as string;
}

function parseSafeInteger(value: unknown, field: string, positive: boolean): number {
  const normalized = typeof value === "number" ? value :
    typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(normalized) || (positive ? normalized <= 0 : normalized < 0)) {
    throw new Error(`Postgres settlement row ${field} must be a ${positive ? "positive" : "non-negative"} safe integer`);
  }
  return normalized;
}

function parseHash(value: unknown, field: string): `0x${string}` {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`Postgres settlement row ${field} must be a 32-byte hex string`);
  }
  return value.toLowerCase() as `0x${string}`;
}

function parseAddress(value: unknown, field: string): `0x${string}` {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`Postgres settlement row ${field} must be a 20-byte hex address`);
  }
  return value as `0x${string}`;
}

function parsePositiveUInt(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`Postgres settlement row ${field} must be a canonical positive uint string`);
  }
  return value;
}

function assertPool(pool: unknown): asserts pool is pg.Pool {
  if (typeof pool !== "object" || pool === null || Array.isArray(pool) ||
      typeof (pool as Record<string, unknown>).connect !== "function") {
    throw new Error("Postgres settlement pool.connect must be a function");
  }
}

async function rollbackBestEffort(client: pg.PoolClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {}
}
