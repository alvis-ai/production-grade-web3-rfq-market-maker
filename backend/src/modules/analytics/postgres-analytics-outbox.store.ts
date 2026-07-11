import pg from "pg";
import type { AnalyticsOutboxRecord } from "./analytics-event.js";

export interface AnalyticsOutboxStats {
  pendingCount: number;
  cleanupEligibleCount: number;
  oldestPendingCreatedAt?: string;
}

export interface AnalyticsOutboxStore {
  checkHealth(): Promise<void>;
  claimBatch(workerId: string, leaseMs: number, batchSize: number): Promise<AnalyticsOutboxRecord[]>;
  markPublished(outboxId: string, workerId: string): Promise<void>;
  releaseForRetry(outboxId: string, workerId: string, errorCode: string, retryDelayMs: number): Promise<void>;
  stats(retentionCutoff: string): Promise<AnalyticsOutboxStats>;
  deletePublishedBefore(cutoff: string, limit: number): Promise<number>;
}

const outboxColumns = `
  outbox.id::text AS id, outbox.topic, outbox.event_key, outbox.event_type, outbox.schema_version,
  outbox.aggregate_type, outbox.aggregate_id, outbox.payload, outbox.attempt_count, outbox.created_at
`;
const workerIdPattern = /^[A-Za-z0-9_:-]+$/;
const errorCodePattern = /^[A-Z0-9_:-]+$/;

export class PostgresAnalyticsOutboxStore implements AnalyticsOutboxStore {
  constructor(private readonly pool: pg.Pool) {
    assertPool(pool);
  }

  async checkHealth(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("SELECT id FROM analytics_outbox LIMIT 1");
    } finally {
      client.release();
    }
  }

  async claimBatch(workerId: string, leaseMs: number, batchSize: number): Promise<AnalyticsOutboxRecord[]> {
    assertWorkerId(workerId);
    assertInteger(leaseMs, 1_000, 300_000, "leaseMs");
    assertInteger(batchSize, 1, 500, "batchSize");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `WITH candidates AS (
           SELECT id
           FROM analytics_outbox
           WHERE published_at IS NULL
             AND available_at <= now()
             AND (lease_expires_at IS NULL OR lease_expires_at <= now())
           ORDER BY available_at ASC, id ASC
           FOR UPDATE SKIP LOCKED
           LIMIT $3
         )
         UPDATE analytics_outbox AS outbox
         SET lease_owner = $1,
             lease_expires_at = now() + $2 * interval '1 millisecond',
             attempt_count = outbox.attempt_count + 1
         FROM candidates
         WHERE outbox.id = candidates.id
         RETURNING ${outboxColumns}`,
        [workerId, leaseMs, batchSize],
      );
      await client.query("COMMIT");
      return result.rows.map(parseOutboxRecord);
    } catch (error) {
      await rollbackBestEffort(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async markPublished(outboxId: string, workerId: string): Promise<void> {
    assertOutboxId(outboxId);
    assertWorkerId(workerId);
    await this.updateLeaseOwned(
      `UPDATE analytics_outbox
       SET published_at = now(), lease_owner = NULL, lease_expires_at = NULL, last_error_code = NULL
       WHERE id = $1 AND published_at IS NULL AND lease_owner = $2`,
      [outboxId, workerId],
      outboxId,
    );
  }

  async releaseForRetry(
    outboxId: string,
    workerId: string,
    errorCode: string,
    retryDelayMs: number,
  ): Promise<void> {
    assertOutboxId(outboxId);
    assertWorkerId(workerId);
    if (typeof errorCode !== "string" || errorCode.length > 128 || !errorCodePattern.test(errorCode)) {
      throw new Error("Analytics outbox errorCode is invalid");
    }
    assertInteger(retryDelayMs, 1, 604_800_000, "retryDelayMs");
    await this.updateLeaseOwned(
      `UPDATE analytics_outbox
       SET available_at = now() + $3 * interval '1 millisecond',
           lease_owner = NULL, lease_expires_at = NULL, last_error_code = $4
       WHERE id = $1 AND published_at IS NULL AND lease_owner = $2`,
      [outboxId, workerId, retryDelayMs, errorCode],
      outboxId,
    );
  }

  async stats(retentionCutoff: string): Promise<AnalyticsOutboxStats> {
    const parsedCutoff = parseTimestamp(retentionCutoff);
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT COUNT(*) FILTER (WHERE published_at IS NULL)::text AS pending_count,
                MIN(created_at) FILTER (WHERE published_at IS NULL) AS oldest_created_at,
                COUNT(*) FILTER (WHERE published_at IS NOT NULL AND published_at < $1)::text
                  AS cleanup_eligible_count
         FROM analytics_outbox`,
        [parsedCutoff],
      );
      if (result.rows.length !== 1) throw new Error("Analytics outbox stats returned an invalid row count");
      const pendingCount = parseNonNegativeSafeInteger(result.rows[0]?.pending_count, "pending_count");
      const cleanupEligibleCount = parseNonNegativeSafeInteger(
        result.rows[0]?.cleanup_eligible_count,
        "cleanup_eligible_count",
      );
      const oldest = result.rows[0]?.oldest_created_at;
      return {
        pendingCount,
        cleanupEligibleCount,
        ...(oldest === null || oldest === undefined ? {} : { oldestPendingCreatedAt: parseTimestamp(oldest) }),
      };
    } finally {
      client.release();
    }
  }

  async deletePublishedBefore(cutoff: string, limit: number): Promise<number> {
    const parsedCutoff = parseTimestamp(cutoff);
    assertInteger(limit, 1, 10_000, "cleanup limit");
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `DELETE FROM analytics_outbox
         WHERE id IN (
           SELECT id
           FROM analytics_outbox
           WHERE published_at IS NOT NULL AND published_at < $1
           ORDER BY published_at ASC, id ASC
           LIMIT $2
         )`,
        [parsedCutoff, limit],
      );
      return result.rowCount ?? 0;
    } finally {
      client.release();
    }
  }

  private async updateLeaseOwned(sql: string, params: unknown[], outboxId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(sql, params);
      if (result.rowCount !== 1) throw new Error(`Analytics outbox lease conflict for ${outboxId}`);
    } finally {
      client.release();
    }
  }
}

function parseOutboxRecord(row: unknown): AnalyticsOutboxRecord {
  if (typeof row !== "object" || row === null || Array.isArray(row)) {
    throw new Error("Analytics outbox row must be an object");
  }
  const value = row as Record<string, unknown>;
  return {
    outboxId: parseOutboxId(value.id),
    topic: parsePatternString(value.topic, /^[A-Za-z0-9._-]+$/, 249, "topic"),
    eventKey: parsePatternString(value.event_key, workerIdPattern, 128, "event_key"),
    eventType: parsePatternString(value.event_type, /^[a-z][a-z0-9_.-]+$/, 128, "event_type"),
    schemaVersion: parsePositiveSafeInteger(value.schema_version, "schema_version"),
    aggregateType: parsePatternString(value.aggregate_type, /^[a-z][a-z0-9_-]+$/, 64, "aggregate_type"),
    aggregateId: parsePatternString(value.aggregate_id, workerIdPattern, 128, "aggregate_id"),
    payload: parsePayload(value.payload),
    attemptCount: parseNonNegativeSafeInteger(value.attempt_count, "attempt_count"),
    createdAt: parseTimestamp(value.created_at),
  };
}

function parsePayload(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Analytics outbox row payload must be an object");
  }
  return value as Readonly<Record<string, unknown>>;
}

function parseOutboxId(value: unknown): string {
  const parsed = typeof value === "bigint" ? value.toString() : value;
  assertOutboxId(parsed);
  return parsed as string;
}

function assertOutboxId(value: unknown): void {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value) || value.length > 19) {
    throw new Error("Analytics outbox id must be a positive decimal identifier");
  }
}

function assertWorkerId(value: unknown): void {
  if (typeof value !== "string" || value.length === 0 || value.length > 128 || !workerIdPattern.test(value)) {
    throw new Error("Analytics outbox workerId is invalid");
  }
}

function parsePatternString(value: unknown, pattern: RegExp, maxLength: number, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength || !pattern.test(value)) {
    throw new Error(`Analytics outbox row ${field} is invalid`);
  }
  return value;
}

function parsePositiveSafeInteger(value: unknown, field: string): number {
  const parsed = parseNonNegativeSafeInteger(value, field);
  if (parsed === 0) throw new Error(`Analytics outbox row ${field} must be positive`);
  return parsed;
}

function parseNonNegativeSafeInteger(value: unknown, field: string): number {
  const parsed = typeof value === "number" ? value :
    typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Analytics outbox row ${field} must be a non-negative safe integer`);
  }
  return parsed;
}

function parseTimestamp(value: unknown): string {
  const timestamp = value instanceof Date ? value.toISOString() : value;
  if (typeof timestamp !== "string" || Number.isNaN(Date.parse(timestamp)) || new Date(timestamp).toISOString() !== timestamp) {
    throw new Error("Analytics outbox timestamp must be a canonical UTC ISO timestamp");
  }
  return timestamp;
}

function assertInteger(value: unknown, min: number, max: number, field: string): void {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`Analytics outbox ${field} must be a safe integer between ${min} and ${max}`);
  }
}

function assertPool(pool: unknown): asserts pool is pg.Pool {
  if (typeof pool !== "object" || pool === null || Array.isArray(pool) ||
      typeof (pool as Record<string, unknown>).connect !== "function") {
    throw new Error("Analytics outbox pool.connect must be a function");
  }
}

async function rollbackBestEffort(client: pg.PoolClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {}
}
