import pg from "pg";
import type { SettlementEventStatusResponse } from "../../shared/types/rfq.js";
import { isCanonicalUtcIsoTimestamp } from "../../shared/validation/timestamp.js";

export interface PostTradeReconciliationJob {
  quoteId: string;
  desiredSettlementEventId?: string;
  revision: number;
  attemptCount: number;
  requestedAt: string;
}

export interface ReconciliationSettlementEvent {
  canonical: boolean;
  event: SettlementEventStatusResponse;
}

export interface PostTradeReconciliationStats {
  pendingCount: number;
  oldestPendingRequestedAt?: string;
}

export interface PostTradeReconciliationJobStore {
  checkHealth(): Promise<void>;
  claimNext(workerId: string, leaseMs: number): Promise<PostTradeReconciliationJob | undefined>;
  listSettlementEvents(quoteId: string): Promise<ReconciliationSettlementEvent[]>;
  markProcessed(job: PostTradeReconciliationJob, workerId: string): Promise<boolean>;
  releaseForRetry(
    job: PostTradeReconciliationJob,
    workerId: string,
    errorCode: string,
    retryDelayMs: number,
  ): Promise<boolean>;
  stats(): Promise<PostTradeReconciliationStats>;
}

const jobColumns = `
  job.quote_id, job.desired_settlement_event_id, job.desired_revision,
  job.attempt_count, job.requested_at
`;
const settlementColumns = `
  settlement.id, settlement.quote_id, settlement.chain_id, settlement.tx_hash,
  settlement.quote_hash, settlement.log_index, settlement.block_number,
  settlement.user_address, settlement.token_in, settlement.token_out,
  settlement.amount_in, settlement.amount_out, settlement.nonce,
  settlement.created_at, settlement.canonical
`;
const safeIdentifierPattern = /^[A-Za-z0-9_:-]+$/;
const errorCodePattern = /^[A-Z0-9_:-]+$/;

export class PostgresPostTradeReconciliationStore implements PostTradeReconciliationJobStore {
  constructor(private readonly pool: pg.Pool) {
    assertPool(pool);
  }

  async checkHealth(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("SELECT quote_id FROM post_trade_reconciliation_jobs LIMIT 1");
    } finally {
      client.release();
    }
  }

  async claimNext(workerId: string, leaseMs: number): Promise<PostTradeReconciliationJob | undefined> {
    assertSafeIdentifier(workerId, "workerId");
    assertInteger(leaseMs, 1_000, 300_000, "leaseMs");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `WITH candidate AS (
           SELECT quote_id
           FROM post_trade_reconciliation_jobs
           WHERE processed_revision < desired_revision
             AND next_attempt_at <= now()
             AND (lease_expires_at IS NULL OR lease_expires_at <= now())
           ORDER BY next_attempt_at ASC, requested_at ASC, quote_id ASC
           FOR UPDATE SKIP LOCKED
           LIMIT 1
         )
         UPDATE post_trade_reconciliation_jobs AS job
         SET lease_owner = $1,
             lease_expires_at = now() + $2 * interval '1 millisecond',
             attempt_count = job.attempt_count + 1,
             updated_at = now()
         FROM candidate
         WHERE job.quote_id = candidate.quote_id
         RETURNING ${jobColumns}`,
        [workerId, leaseMs],
      );
      if (result.rows.length > 1) {
        throw new Error("Post-trade reconciliation claim returned multiple jobs");
      }
      await client.query("COMMIT");
      return result.rows[0] ? parseJob(result.rows[0]) : undefined;
    } catch (error) {
      await rollbackBestEffort(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async listSettlementEvents(quoteId: string): Promise<ReconciliationSettlementEvent[]> {
    assertSafeIdentifier(quoteId, "quoteId");
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT ${settlementColumns}
         FROM settlement_events AS settlement
         WHERE settlement.quote_id = $1
         ORDER BY settlement.block_number ASC, settlement.log_index ASC, settlement.id ASC`,
        [quoteId],
      );
      return result.rows.map(parseSettlementEvent);
    } finally {
      client.release();
    }
  }

  async markProcessed(job: PostTradeReconciliationJob, workerId: string): Promise<boolean> {
    assertJob(job);
    assertSafeIdentifier(workerId, "workerId");
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `UPDATE post_trade_reconciliation_jobs
         SET processed_revision = CASE
               WHEN desired_revision = $3 THEN $3
               ELSE processed_revision
             END,
             lease_owner = NULL,
             lease_expires_at = NULL,
             last_error_code = CASE WHEN desired_revision = $3 THEN NULL ELSE last_error_code END,
             updated_at = now()
         WHERE quote_id = $1 AND lease_owner = $2
         RETURNING desired_revision = $3 AS completed`,
        [job.quoteId, workerId, job.revision],
      );
      if (result.rows.length !== 1 || typeof result.rows[0]?.completed !== "boolean") {
        throw new Error(`Post-trade reconciliation lease conflict for ${job.quoteId}`);
      }
      return result.rows[0].completed;
    } finally {
      client.release();
    }
  }

  async releaseForRetry(
    job: PostTradeReconciliationJob,
    workerId: string,
    errorCode: string,
    retryDelayMs: number,
  ): Promise<boolean> {
    assertJob(job);
    assertSafeIdentifier(workerId, "workerId");
    if (typeof errorCode !== "string" || errorCode.length === 0 || errorCode.length > 128 ||
        !errorCodePattern.test(errorCode)) {
      throw new Error("Post-trade reconciliation errorCode is invalid");
    }
    assertInteger(retryDelayMs, 1, 3_600_000, "retryDelayMs");
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `UPDATE post_trade_reconciliation_jobs
         SET next_attempt_at = CASE
               WHEN desired_revision = $3 THEN now() + $4 * interval '1 millisecond'
               ELSE now()
             END,
             lease_owner = NULL,
             lease_expires_at = NULL,
             last_error_code = CASE WHEN desired_revision = $3 THEN $5 ELSE NULL END,
             updated_at = now()
         WHERE quote_id = $1 AND lease_owner = $2
         RETURNING desired_revision = $3 AS retry_scheduled`,
        [job.quoteId, workerId, job.revision, retryDelayMs, errorCode],
      );
      if (result.rows.length !== 1 || typeof result.rows[0]?.retry_scheduled !== "boolean") {
        throw new Error(`Post-trade reconciliation lease conflict for ${job.quoteId}`);
      }
      return result.rows[0].retry_scheduled;
    } finally {
      client.release();
    }
  }

  async stats(): Promise<PostTradeReconciliationStats> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT COUNT(*)::text AS pending_count,
                MIN(requested_at) AS oldest_requested_at
         FROM post_trade_reconciliation_jobs
         WHERE processed_revision < desired_revision`,
      );
      if (result.rows.length !== 1) {
        throw new Error("Post-trade reconciliation stats returned an invalid row count");
      }
      const pendingCount = parseNonNegativeSafeInteger(result.rows[0]?.pending_count, "pending_count");
      const oldest = result.rows[0]?.oldest_requested_at;
      return {
        pendingCount,
        ...(oldest === null || oldest === undefined ? {} : { oldestPendingRequestedAt: parseTimestamp(oldest) }),
      };
    } finally {
      client.release();
    }
  }
}

function parseJob(row: unknown): PostTradeReconciliationJob {
  const value = assertRow(row, "job");
  const desiredSettlementEventId = value.desired_settlement_event_id;
  if (desiredSettlementEventId !== null && desiredSettlementEventId !== undefined) {
    assertSafeIdentifier(desiredSettlementEventId, "desired_settlement_event_id");
  }
  return {
    quoteId: parseSafeIdentifier(value.quote_id, "quote_id"),
    ...(desiredSettlementEventId === null || desiredSettlementEventId === undefined
      ? {}
      : { desiredSettlementEventId: desiredSettlementEventId as string }),
    revision: parsePositiveSafeInteger(value.desired_revision, "desired_revision"),
    attemptCount: parsePositiveSafeInteger(value.attempt_count, "attempt_count"),
    requestedAt: parseTimestamp(value.requested_at),
  };
}

function parseSettlementEvent(row: unknown): ReconciliationSettlementEvent {
  const value = assertRow(row, "settlement event");
  if (typeof value.canonical !== "boolean") {
    throw new Error("Post-trade reconciliation settlement canonical is invalid");
  }
  const event: SettlementEventStatusResponse = {
    settlementEventId: parseSafeIdentifier(value.id, "id"),
    status: "applied",
    quoteId: parseSafeIdentifier(value.quote_id, "quote_id"),
    chainId: parsePositiveSafeInteger(value.chain_id, "chain_id"),
    txHash: parseHash(value.tx_hash, "tx_hash"),
    quoteHash: parseHash(value.quote_hash, "quote_hash"),
    blockNumber: parseNonNegativeSafeInteger(value.block_number, "block_number"),
    logIndex: parseNonNegativeSafeInteger(value.log_index, "log_index"),
    user: parseAddress(value.user_address, "user_address"),
    tokenIn: parseAddress(value.token_in, "token_in"),
    tokenOut: parseAddress(value.token_out, "token_out"),
    amountIn: parsePositiveUInt(value.amount_in, "amount_in"),
    amountOut: parsePositiveUInt(value.amount_out, "amount_out"),
    nonce: parsePositiveUInt(value.nonce, "nonce"),
    observedAt: parseTimestamp(value.created_at),
  };
  if (event.tokenIn.toLowerCase() === event.tokenOut.toLowerCase()) {
    throw new Error("Post-trade reconciliation settlement tokens must be distinct");
  }
  return { canonical: value.canonical, event };
}

function assertJob(job: PostTradeReconciliationJob): void {
  const value = assertRow(job, "job input");
  assertSafeIdentifier(value.quoteId, "quoteId");
  if (value.desiredSettlementEventId !== undefined) {
    assertSafeIdentifier(value.desiredSettlementEventId, "desiredSettlementEventId");
  }
  parsePositiveSafeInteger(value.revision, "revision");
  parsePositiveSafeInteger(value.attemptCount, "attemptCount");
  parseTimestamp(value.requestedAt);
}

function assertRow(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Post-trade reconciliation ${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function parseSafeIdentifier(value: unknown, field: string): string {
  assertSafeIdentifier(value, field);
  return value as string;
}

function assertSafeIdentifier(value: unknown, field: string): void {
  if (typeof value !== "string" || value.length === 0 || value.length > 128 || !safeIdentifierPattern.test(value)) {
    throw new Error(`Post-trade reconciliation ${field} is invalid`);
  }
}

function parseHash(value: unknown, field: string): `0x${string}` {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`Post-trade reconciliation ${field} must be a 32-byte hex string`);
  }
  return value.toLowerCase() as `0x${string}`;
}

function parseAddress(value: unknown, field: string): `0x${string}` {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`Post-trade reconciliation ${field} must be a 20-byte hex address`);
  }
  return value as `0x${string}`;
}

function parsePositiveUInt(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`Post-trade reconciliation ${field} must be a positive uint string`);
  }
  return value;
}

function parsePositiveSafeInteger(value: unknown, field: string): number {
  const parsed = parseNonNegativeSafeInteger(value, field);
  if (parsed === 0) {
    throw new Error(`Post-trade reconciliation ${field} must be positive`);
  }
  return parsed;
}

function parseNonNegativeSafeInteger(value: unknown, field: string): number {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value)
      ? Number(value)
      : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Post-trade reconciliation ${field} must be a non-negative safe integer`);
  }
  return parsed;
}

function parseTimestamp(value: unknown): string {
  const timestamp = value instanceof Date ? value.toISOString() : value;
  if (typeof timestamp !== "string" || !isCanonicalUtcIsoTimestamp(timestamp)) {
    throw new Error("Post-trade reconciliation timestamp must be canonical UTC ISO");
  }
  return timestamp;
}

function assertInteger(value: unknown, min: number, max: number, field: string): void {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`Post-trade reconciliation ${field} must be between ${min} and ${max}`);
  }
}

function assertPool(pool: unknown): asserts pool is pg.Pool {
  if (typeof pool !== "object" || pool === null || Array.isArray(pool) ||
      typeof (pool as Record<string, unknown>).connect !== "function") {
    throw new Error("Post-trade reconciliation pool.connect must be a function");
  }
}

async function rollbackBestEffort(client: pg.PoolClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {}
}
