import pg from "pg";
import { isCanonicalUtcIsoTimestamp } from "../../shared/validation/timestamp.js";
import type { Address } from "../../shared/types/rfq.js";
import {
  SettlementIndexerLeaseError,
  type AdvanceSettlementIndexerCursorInput,
  type ClaimSettlementIndexerCursorInput,
  type RollbackSettlementIndexerCursorInput,
  type SettlementIndexerCheckpoint,
  type SettlementIndexerCursor,
  type SettlementIndexerCursorStats,
  type SettlementIndexerEventRef,
  type SettlementIndexerStore,
} from "./settlement-indexer.store.js";

const cursorColumns = `
  chain_id, settlement_address, start_block, next_block, revision,
  lease_owner, lease_expires_at, updated_at
`;
const workerIdPattern = /^[A-Za-z0-9_:-]+$/;

export class PostgresSettlementIndexerStore implements SettlementIndexerStore {
  constructor(private readonly pool: pg.Pool) {
    assertPool(pool);
  }

  async checkHealth(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("SELECT chain_id FROM settlement_indexer_cursors LIMIT 1");
    } finally {
      client.release();
    }
  }

  async claimCursor(input: ClaimSettlementIndexerCursorInput): Promise<SettlementIndexerCursor | undefined> {
    assertClaimInput(input);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO settlement_indexer_cursors (
           chain_id, settlement_address, start_block, next_block
         ) VALUES ($1, $2, $3, $3)
         ON CONFLICT (chain_id) DO NOTHING`,
        [input.chainId, input.settlementAddress.toLowerCase(), input.startBlock],
      );
      const selected = await client.query(
        `SELECT ${cursorColumns}
         FROM settlement_indexer_cursors
         WHERE chain_id = $1
         FOR UPDATE`,
        [input.chainId],
      );
      if (selected.rows.length !== 1) throw new Error("Settlement indexer cursor row is missing after initialization");
      const stored = parseCursorRow(selected.rows[0], false);
      if (
        stored.settlementAddress.toLowerCase() !== input.settlementAddress.toLowerCase() ||
        stored.startBlock !== input.startBlock
      ) {
        throw new Error("Settlement indexer cursor immutable chain configuration does not match runtime config");
      }

      const claimed = await client.query(
        `UPDATE settlement_indexer_cursors
         SET lease_owner = $2,
             lease_expires_at = now() + ($3::bigint * interval '1 millisecond'),
             updated_at = now()
         WHERE chain_id = $1
           AND (
             lease_owner IS NULL
             OR lease_owner = $2
             OR lease_expires_at <= now()
           )
         RETURNING ${cursorColumns}`,
        [input.chainId, input.workerId, input.leaseMs],
      );
      await client.query("COMMIT");
      if (claimed.rows.length === 0) return undefined;
      if (claimed.rows.length !== 1) throw new Error("Settlement indexer cursor claim returned multiple rows");
      return parseCursorRow(claimed.rows[0], true);
    } catch (error) {
      await rollbackBestEffort(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async advanceCursor(input: AdvanceSettlementIndexerCursorInput): Promise<SettlementIndexerCursor> {
    assertAdvanceInput(input);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query(
        `INSERT INTO settlement_indexer_checkpoints (chain_id, block_number, block_hash)
         VALUES ($1, $2, $3)
         ON CONFLICT (chain_id, block_number) DO NOTHING
         RETURNING block_hash`,
        [input.chainId, input.checkpoint.blockNumber, input.checkpoint.blockHash],
      );
      if (inserted.rows.length === 0) {
        const existing = await client.query(
          `SELECT block_hash
           FROM settlement_indexer_checkpoints
           WHERE chain_id = $1 AND block_number = $2
           FOR UPDATE`,
          [input.chainId, input.checkpoint.blockNumber],
        );
        if (existing.rows.length !== 1 || normalizeHash(existing.rows[0].block_hash, "checkpoint block_hash") !== input.checkpoint.blockHash.toLowerCase()) {
          throw new Error("Settlement indexer checkpoint hash conflicts with stored canonical history");
        }
      } else if (inserted.rows.length !== 1) {
        throw new Error("Settlement indexer checkpoint insert returned multiple rows");
      }

      const advanced = await client.query(
        `UPDATE settlement_indexer_cursors
         SET next_block = $6,
             revision = revision + 1,
             lease_expires_at = now() + ($3::bigint * interval '1 millisecond'),
             updated_at = now()
         WHERE chain_id = $1
           AND lease_owner = $2
           AND lease_expires_at > now()
           AND revision = $4
           AND next_block = $5
         RETURNING ${cursorColumns}`,
        [
          input.chainId,
          input.workerId,
          input.leaseMs,
          input.expectedRevision,
          input.expectedNextBlock,
          input.nextBlock,
        ],
      );
      if (advanced.rows.length !== 1) throw new SettlementIndexerLeaseError();
      await client.query("COMMIT");
      return parseCursorRow(advanced.rows[0], true);
    } catch (error) {
      await rollbackBestEffort(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async rollbackCursor(input: RollbackSettlementIndexerCursorInput): Promise<SettlementIndexerCursor> {
    assertRollbackInput(input);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const rolledBack = await client.query(
        `UPDATE settlement_indexer_cursors
         SET next_block = $6,
             revision = revision + 1,
             lease_expires_at = now() + ($3::bigint * interval '1 millisecond'),
             updated_at = now()
         WHERE chain_id = $1
           AND lease_owner = $2
           AND lease_expires_at > now()
           AND revision = $4
           AND next_block = $5
           AND start_block <= $6
         RETURNING ${cursorColumns}`,
        [
          input.chainId,
          input.workerId,
          input.leaseMs,
          input.expectedRevision,
          input.expectedNextBlock,
          input.nextBlock,
        ],
      );
      if (rolledBack.rows.length !== 1) throw new SettlementIndexerLeaseError();
      await client.query(
        `DELETE FROM settlement_indexer_checkpoints
         WHERE chain_id = $1 AND block_number >= $2`,
        [input.chainId, input.nextBlock],
      );
      await client.query("COMMIT");
      return parseCursorRow(rolledBack.rows[0], true);
    } catch (error) {
      await rollbackBestEffort(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async releaseCursor(chainId: number, workerId: string): Promise<void> {
    assertChainId(chainId);
    assertWorkerId(workerId);
    const client = await this.pool.connect();
    try {
      await client.query(
        `UPDATE settlement_indexer_cursors
         SET lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
         WHERE chain_id = $1 AND lease_owner = $2`,
        [chainId, workerId],
      );
    } finally {
      client.release();
    }
  }

  async listCheckpoints(
    chainId: number,
    fromBlock: number,
    beforeBlock: number,
  ): Promise<SettlementIndexerCheckpoint[]> {
    assertChainId(chainId);
    assertBlockNumber(fromBlock, "fromBlock");
    assertBlockNumber(beforeBlock, "beforeBlock");
    if (beforeBlock < fromBlock) throw new Error("Settlement indexer checkpoint block range is reversed");
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT chain_id, block_number, block_hash
         FROM settlement_indexer_checkpoints
         WHERE chain_id = $1 AND block_number >= $2 AND block_number < $3
         ORDER BY block_number DESC`,
        [chainId, fromBlock, beforeBlock],
      );
      return result.rows.map(parseCheckpointRow);
    } finally {
      client.release();
    }
  }

  async listCanonicalEventRefs(
    chainId: number,
    fromBlock: number,
    toBlock: number,
  ): Promise<SettlementIndexerEventRef[]> {
    assertChainId(chainId);
    assertBlockRange(fromBlock, toBlock);
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT chain_id, tx_hash, block_number, log_index
         FROM settlement_events
         WHERE chain_id = $1
           AND block_number BETWEEN $2 AND $3
           AND canonical = TRUE
         ORDER BY block_number DESC, log_index DESC`,
        [chainId, fromBlock, toBlock],
      );
      return result.rows.map(parseEventRefRow);
    } finally {
      client.release();
    }
  }

  async stats(): Promise<SettlementIndexerCursorStats[]> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT chain_id, next_block, updated_at
         FROM settlement_indexer_cursors
         ORDER BY chain_id ASC`,
      );
      return result.rows.map((row) => ({
        chainId: parseSafeInteger(row.chain_id, "stats chain_id", true),
        nextBlock: parseSafeInteger(row.next_block, "stats next_block", false),
        updatedAt: parseTimestamp(row.updated_at, "stats updated_at"),
      }));
    } finally {
      client.release();
    }
  }
}

function parseCursorRow(value: unknown, requireLease: boolean): SettlementIndexerCursor {
  assertRecord(value, "Settlement indexer cursor row");
  const leaseOwner = value.lease_owner;
  const leaseExpiresAt = value.lease_expires_at;
  if (requireLease) {
    assertWorkerId(leaseOwner);
    if (leaseExpiresAt === null || leaseExpiresAt === undefined) {
      throw new Error("Settlement indexer cursor row lease_expires_at is missing");
    }
  }
  return {
    chainId: parseSafeInteger(value.chain_id, "cursor chain_id", true),
    settlementAddress: normalizeAddress(value.settlement_address, "cursor settlement_address"),
    startBlock: parseSafeInteger(value.start_block, "cursor start_block", false),
    nextBlock: parseSafeInteger(value.next_block, "cursor next_block", false),
    revision: parseSafeInteger(value.revision, "cursor revision", false),
    leaseOwner: requireLease ? leaseOwner as string : typeof leaseOwner === "string" ? leaseOwner : "unclaimed",
    leaseExpiresAt: requireLease
      ? parseTimestamp(leaseExpiresAt, "cursor lease_expires_at")
      : leaseExpiresAt == null ? new Date(0).toISOString() : parseTimestamp(leaseExpiresAt, "cursor lease_expires_at"),
  };
}

function parseCheckpointRow(value: unknown): SettlementIndexerCheckpoint {
  assertRecord(value, "Settlement indexer checkpoint row");
  return {
    chainId: parseSafeInteger(value.chain_id, "checkpoint chain_id", true),
    blockNumber: parseSafeInteger(value.block_number, "checkpoint block_number", false),
    blockHash: normalizeHash(value.block_hash, "checkpoint block_hash"),
  };
}

function parseEventRefRow(value: unknown): SettlementIndexerEventRef {
  assertRecord(value, "Settlement indexer event reference row");
  return {
    chainId: parseSafeInteger(value.chain_id, "event chain_id", true),
    txHash: normalizeHash(value.tx_hash, "event tx_hash"),
    blockNumber: parseSafeInteger(value.block_number, "event block_number", false),
    logIndex: parseSafeInteger(value.log_index, "event log_index", false),
  };
}

function assertClaimInput(input: ClaimSettlementIndexerCursorInput): void {
  assertRecord(input, "Settlement indexer claim input");
  assertExactFields(input, ["chainId", "settlementAddress", "startBlock", "workerId", "leaseMs"], "claim input");
  assertChainId(input.chainId);
  normalizeAddress(input.settlementAddress, "claim settlementAddress");
  assertBlockNumber(input.startBlock, "claim startBlock");
  assertWorkerId(input.workerId);
  assertInteger(input.leaseMs, 1_000, 300_000, "claim leaseMs");
}

function assertAdvanceInput(input: AdvanceSettlementIndexerCursorInput): void {
  assertRecord(input, "Settlement indexer advance input");
  assertExactFields(
    input,
    ["chainId", "workerId", "leaseMs", "expectedRevision", "expectedNextBlock", "nextBlock", "checkpoint"],
    "advance input",
  );
  assertCursorMutation(input);
  assertRecord(input.checkpoint, "Settlement indexer advance checkpoint");
  assertExactFields(input.checkpoint, ["chainId", "blockNumber", "blockHash"], "advance checkpoint");
  if (input.nextBlock <= input.expectedNextBlock || input.checkpoint.chainId !== input.chainId ||
      input.checkpoint.blockNumber !== input.nextBlock - 1) {
    throw new Error("Settlement indexer advance input range and checkpoint are inconsistent");
  }
  normalizeHash(input.checkpoint.blockHash, "advance checkpoint blockHash");
}

function assertRollbackInput(input: RollbackSettlementIndexerCursorInput): void {
  assertRecord(input, "Settlement indexer rollback input");
  assertExactFields(
    input,
    ["chainId", "workerId", "leaseMs", "expectedRevision", "expectedNextBlock", "nextBlock"],
    "rollback input",
  );
  assertCursorMutation(input);
  if (input.nextBlock >= input.expectedNextBlock) {
    throw new Error("Settlement indexer rollback must move the cursor backwards");
  }
}

function assertCursorMutation(input: {
  chainId: number;
  workerId: string;
  leaseMs: number;
  expectedRevision: number;
  expectedNextBlock: number;
  nextBlock: number;
}): void {
  assertChainId(input.chainId);
  assertWorkerId(input.workerId);
  assertInteger(input.leaseMs, 1_000, 300_000, "cursor leaseMs");
  assertBlockNumber(input.expectedRevision, "cursor expectedRevision");
  assertBlockNumber(input.expectedNextBlock, "cursor expectedNextBlock");
  assertBlockNumber(input.nextBlock, "cursor nextBlock");
}

function assertBlockRange(fromBlock: number, toBlock: number): void {
  assertBlockNumber(fromBlock, "fromBlock");
  assertBlockNumber(toBlock, "toBlock");
  if (toBlock < fromBlock) throw new Error("Settlement indexer event block range is reversed");
}

function assertChainId(value: unknown): asserts value is number {
  assertInteger(value, 1, Number.MAX_SAFE_INTEGER, "chainId");
}

function assertBlockNumber(value: unknown, field: string): asserts value is number {
  assertInteger(value, 0, Number.MAX_SAFE_INTEGER, field);
}

function assertInteger(value: unknown, min: number, max: number, field: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`Settlement indexer ${field} must be an integer between ${min} and ${max}`);
  }
}

function assertWorkerId(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 128 || !workerIdPattern.test(value)) {
    throw new Error("Settlement indexer workerId must be a safe identifier up to 128 characters");
  }
}

function normalizeAddress(value: unknown, field: string): Address {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value) || /^0x0{40}$/i.test(value)) {
    throw new Error(`Settlement indexer ${field} must be a non-zero 20-byte hex address`);
  }
  return value.toLowerCase() as Address;
}

function normalizeHash(value: unknown, field: string): `0x${string}` {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`Settlement indexer ${field} must be a 32-byte hex string`);
  }
  return value.toLowerCase() as `0x${string}`;
}

function parseSafeInteger(value: unknown, field: string, positive: boolean): number {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value)
      ? Number(value)
      : Number.NaN;
  if (!Number.isSafeInteger(parsed) || (positive ? parsed <= 0 : parsed < 0)) {
    throw new Error(`Settlement indexer ${field} must be a ${positive ? "positive" : "non-negative"} safe integer`);
  }
  return parsed;
}

function parseTimestamp(value: unknown, field: string): string {
  const normalized = value instanceof Date ? value.toISOString() : value;
  if (typeof normalized !== "string" || !isCanonicalUtcIsoTimestamp(normalized)) {
    throw new Error(`Settlement indexer ${field} must be a canonical UTC timestamp`);
  }
  return normalized;
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function assertExactFields(value: object, fields: readonly string[], label: string): void {
  const record = value as Record<string, unknown>;
  const allowed = new Set(fields);
  for (const field of Object.keys(record)) {
    if (!allowed.has(field)) throw new Error(`Settlement indexer ${label} must not include unknown field ${field}`);
  }
  for (const field of fields) {
    if (!Object.hasOwn(record, field)) throw new Error(`Settlement indexer ${label}.${field} must be an own field`);
  }
}

function assertPool(value: unknown): asserts value is pg.Pool {
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
      typeof (value as Record<string, unknown>).connect !== "function") {
    throw new Error("Postgres settlement indexer pool.connect must be a function");
  }
}

async function rollbackBestEffort(client: pg.PoolClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {}
}
