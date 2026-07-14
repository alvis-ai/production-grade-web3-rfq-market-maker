import pg from "pg";
import type { Address } from "../../shared/types/rfq.js";
import { isCanonicalUtcIsoTimestamp } from "../../shared/validation/timestamp.js";
import type {
  ToxicFlowAggregate,
  ToxicFlowMarkoutJob,
  ToxicFlowMarkoutResult,
  ToxicFlowMarkoutSnapshot,
  ToxicFlowMarkoutStats,
  ToxicFlowMarkoutStore,
} from "./toxic-flow-markout.js";

const safeIdentifierPattern = /^[A-Za-z0-9_:-]+$/;
const errorCodePattern = /^[A-Z0-9_:-]+$/;

export class PostgresToxicFlowMarkoutStore implements ToxicFlowMarkoutStore {
  constructor(private readonly pool: pg.Pool) {
    if (typeof pool !== "object" || pool === null || typeof pool.connect !== "function") {
      throw new Error("Toxic-flow markout pool.connect must be a function");
    }
  }

  async checkHealth(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("SELECT settlement_event_id FROM toxic_flow_markout_jobs LIMIT 1");
    } finally {
      client.release();
    }
  }

  async claimNext(
    workerId: string,
    leaseMs: number,
    horizonSeconds: number,
  ): Promise<ToxicFlowMarkoutJob | undefined> {
    assertIdentifier(workerId, "workerId");
    assertInteger(leaseMs, 1_000, 300_000, "leaseMs");
    assertInteger(horizonSeconds, 1, 604_800, "horizonSeconds");
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `WITH candidate AS (
           SELECT job.settlement_event_id
           FROM toxic_flow_markout_jobs AS job
           WHERE job.processed_revision < job.desired_revision
             AND job.next_attempt_at <= now()
             AND (job.lease_expires_at IS NULL OR job.lease_expires_at <= now())
             AND (job.desired_canonical = FALSE OR job.settled_at + $3 * interval '1 second' <= now())
           ORDER BY job.next_attempt_at, job.settled_at, job.settlement_event_id
           FOR UPDATE SKIP LOCKED LIMIT 1
         )
         UPDATE toxic_flow_markout_jobs AS job
         SET lease_owner = $1, lease_expires_at = now() + $2 * interval '1 millisecond',
             attempt_count = job.attempt_count + 1, updated_at = now()
         FROM candidate, settlement_events AS settlement
         WHERE job.settlement_event_id = candidate.settlement_event_id
           AND settlement.id = job.settlement_event_id
         RETURNING job.settlement_event_id, settlement.quote_id, settlement.chain_id::text AS chain_id,
           lower(settlement.user_address) AS user_address, lower(settlement.token_in) AS token_in,
           lower(settlement.token_out) AS token_out, settlement.amount_in::text AS amount_in,
           settlement.amount_out::text AS amount_out, job.settled_at, job.desired_canonical,
           job.desired_revision::text AS desired_revision, job.attempt_count`,
        [workerId, leaseMs, horizonSeconds],
      );
      if (result.rows.length > 1) throw new Error("Toxic-flow markout claim returned multiple jobs");
      return result.rows[0] ? parseJob(result.rows[0]) : undefined;
    } finally {
      client.release();
    }
  }

  async findPostTradeSnapshot(
    job: ToxicFlowMarkoutJob,
    horizonSeconds: number,
    maxSnapshotLagSeconds: number,
  ): Promise<ToxicFlowMarkoutSnapshot | undefined> {
    assertJob(job);
    assertInteger(horizonSeconds, 1, 604_800, "horizonSeconds");
    assertInteger(maxSnapshotLagSeconds, 0, 604_800, "maxSnapshotLagSeconds");
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT id, mid_price::text AS mid_price, observed_at
         FROM market_snapshots
         WHERE chain_id = $1 AND lower(token_in) = $2 AND lower(token_out) = $3
           AND observed_at >= $4::timestamptz + $5 * interval '1 second'
           AND observed_at <= $4::timestamptz + ($5 + $6) * interval '1 second'
         ORDER BY observed_at ASC, id ASC LIMIT 1`,
        [
          job.chainId,
          job.tokenIn,
          job.tokenOut,
          job.settledAt,
          horizonSeconds,
          maxSnapshotLagSeconds,
        ],
      );
      if (result.rows.length > 1) throw new Error("Toxic-flow markout snapshot query returned multiple rows");
      if (!result.rows[0]) return undefined;
      return {
        snapshotId: identifier(result.rows[0].id, "snapshotId"),
        midPrice: positiveDecimal(result.rows[0].mid_price, "midPrice"),
        observedAt: timestamp(result.rows[0].observed_at, "observedAt"),
      };
    } finally {
      client.release();
    }
  }

  async upsertMarkout(
    job: ToxicFlowMarkoutJob,
    snapshot: ToxicFlowMarkoutSnapshot,
    result: ToxicFlowMarkoutResult,
    horizonSeconds: number,
    policyVersion: string,
  ): Promise<void> {
    assertJob(job);
    assertSnapshot(snapshot);
    assertResult(result);
    assertInteger(horizonSeconds, 1, 604_800, "horizonSeconds");
    assertIdentifier(policyVersion, "policyVersion");
    if (Date.parse(snapshot.observedAt) < Date.parse(job.settledAt) + horizonSeconds * 1_000) {
      throw new Error("Toxic-flow markout snapshot precedes the policy horizon");
    }
    const client = await this.pool.connect();
    try {
      const queryResult = await client.query(
        `INSERT INTO toxic_flow_markouts (
           settlement_event_id, quote_id, post_snapshot_id, chain_id, user_address, token_in, token_out,
           execution_price, post_mid_price, post_trade_drift_bps, toxicity_score_bps,
           horizon_seconds, policy_version, observed_at, canonical
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,TRUE)
         ON CONFLICT (settlement_event_id) DO UPDATE SET
           post_snapshot_id = EXCLUDED.post_snapshot_id, execution_price = EXCLUDED.execution_price,
           post_mid_price = EXCLUDED.post_mid_price, post_trade_drift_bps = EXCLUDED.post_trade_drift_bps,
           toxicity_score_bps = EXCLUDED.toxicity_score_bps, horizon_seconds = EXCLUDED.horizon_seconds,
           policy_version = EXCLUDED.policy_version, observed_at = EXCLUDED.observed_at,
           canonical = TRUE, updated_at = now()
         WHERE toxic_flow_markouts.quote_id = EXCLUDED.quote_id
           AND toxic_flow_markouts.chain_id = EXCLUDED.chain_id
           AND toxic_flow_markouts.user_address = EXCLUDED.user_address
           AND toxic_flow_markouts.token_in = EXCLUDED.token_in
           AND toxic_flow_markouts.token_out = EXCLUDED.token_out
         RETURNING settlement_event_id`,
        [
          job.settlementEventId,
          job.quoteId,
          snapshot.snapshotId,
          job.chainId,
          job.user,
          job.tokenIn,
          job.tokenOut,
          result.executionPrice,
          result.postMidPrice,
          result.postTradeDriftBps,
          result.toxicityScoreBps,
          horizonSeconds,
          policyVersion,
          snapshot.observedAt,
        ],
      );
      if (queryResult.rows.length !== 1) {
        throw new Error(`Toxic-flow markout identity conflict for ${job.settlementEventId}`);
      }
    } finally {
      client.release();
    }
  }

  async invalidateMarkout(job: ToxicFlowMarkoutJob): Promise<void> {
    assertJob(job);
    const client = await this.pool.connect();
    try {
      await client.query(
        "UPDATE toxic_flow_markouts SET canonical = FALSE, updated_at = now() WHERE settlement_event_id = $1",
        [job.settlementEventId],
      );
    } finally {
      client.release();
    }
  }

  async aggregateUser(
    chainId: number,
    user: Address,
    windowSeconds: number,
  ): Promise<ToxicFlowAggregate> {
    assertInteger(chainId, 1, Number.MAX_SAFE_INTEGER, "chainId");
    if (typeof user !== "string" || !/^0x[0-9a-f]{40}$/.test(user)) {
      throw new Error("Toxic-flow markout user is invalid");
    }
    assertInteger(windowSeconds, 1, 604_800, "windowSeconds");
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT COUNT(*)::text AS sample_size,
                COALESCE(ROUND(AVG(post_trade_drift_bps)), 0)::text AS average_drift_bps,
                COALESCE(ROUND(AVG(toxicity_score_bps)), 0)::text AS score_bps,
                COALESCE(MAX(observed_at), now()) AS observed_at
         FROM toxic_flow_markouts
         WHERE chain_id = $1 AND user_address = $2 AND canonical = TRUE
           AND observed_at >= now() - $3 * interval '1 second'`,
        [chainId, user, windowSeconds],
      );
      if (result.rows.length !== 1) {
        throw new Error("Toxic-flow markout aggregate returned invalid row count");
      }
      return {
        sampleSize: nonNegativeInteger(result.rows[0].sample_size, "sampleSize"),
        averagePostTradeDriftBps: signedInteger(result.rows[0].average_drift_bps, "averageDriftBps"),
        scoreBps: nonNegativeInteger(result.rows[0].score_bps, "scoreBps"),
        observedAt: timestamp(result.rows[0].observed_at, "observedAt"),
      };
    } finally {
      client.release();
    }
  }

  async complete(job: ToxicFlowMarkoutJob, workerId: string): Promise<void> {
    await this.finish(
      job,
      workerId,
      `processed_revision = CASE WHEN desired_revision = $3 THEN $3 ELSE processed_revision END,
       next_attempt_at = CASE WHEN desired_revision = $3 THEN next_attempt_at ELSE now() END,
       last_error_code = NULL`,
      [],
    );
  }

  async releaseForRetry(
    job: ToxicFlowMarkoutJob,
    workerId: string,
    errorCode: string,
    delayMs: number,
  ): Promise<void> {
    if (typeof errorCode !== "string" || !errorCodePattern.test(errorCode) ||
        errorCode.length > 128) {
      throw new Error("Toxic-flow markout errorCode is invalid");
    }
    assertInteger(delayMs, 1, 3_600_000, "delayMs");
    await this.finish(
      job,
      workerId,
      `next_attempt_at = CASE WHEN desired_revision = $3 THEN now() + $4 * interval '1 millisecond' ELSE now() END,
       last_error_code = CASE WHEN desired_revision = $3 THEN $5 ELSE NULL END`,
      [delayMs, errorCode],
    );
  }

  async stats(horizonSeconds: number): Promise<ToxicFlowMarkoutStats> {
    assertInteger(horizonSeconds, 1, 604_800, "horizonSeconds");
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT COUNT(*)::text AS pending_count,
                MIN(CASE WHEN desired_canonical THEN settled_at + $1 * interval '1 second' ELSE settled_at END) AS oldest_eligible_at
         FROM toxic_flow_markout_jobs WHERE processed_revision < desired_revision`,
        [horizonSeconds],
      );
      if (result.rows.length !== 1) {
        throw new Error("Toxic-flow markout stats returned invalid row count");
      }
      const count = nonNegativeInteger(result.rows[0]?.pending_count, "pendingCount");
      return {
        pendingCount: count,
        ...(count === 0 ? {} : {
          oldestEligibleAt: timestamp(result.rows[0].oldest_eligible_at, "oldestEligibleAt"),
        }),
      };
    } finally {
      client.release();
    }
  }

  private async finish(
    job: ToxicFlowMarkoutJob,
    workerId: string,
    assignments: string,
    extra: unknown[],
  ): Promise<void> {
    assertJob(job);
    assertIdentifier(workerId, "workerId");
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `UPDATE toxic_flow_markout_jobs SET ${assignments}, lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
         WHERE settlement_event_id = $1 AND lease_owner = $2 RETURNING settlement_event_id`,
        [job.settlementEventId, workerId, job.desiredRevision, ...extra],
      );
      if (result.rows.length !== 1) {
        throw new Error(`Toxic-flow markout lease conflict for ${job.settlementEventId}`);
      }
    } finally {
      client.release();
    }
  }
}

function parseJob(row: Record<string, unknown>): ToxicFlowMarkoutJob {
  const job = {
    settlementEventId: identifier(row.settlement_event_id, "settlementEventId"),
    quoteId: identifier(row.quote_id, "quoteId"),
    chainId: nonNegativeInteger(row.chain_id, "chainId"),
    user: row.user_address as Address,
    tokenIn: row.token_in as Address,
    tokenOut: row.token_out as Address,
    amountIn: positiveUint(row.amount_in, "amountIn"),
    amountOut: positiveUint(row.amount_out, "amountOut"),
    settledAt: timestamp(row.settled_at, "settledAt"),
    desiredCanonical: booleanValue(row.desired_canonical, "desiredCanonical"),
    desiredRevision: nonNegativeInteger(row.desired_revision, "desiredRevision"),
    attemptCount: nonNegativeInteger(row.attempt_count, "attemptCount"),
  };
  assertJob(job);
  return job;
}

function assertJob(job: ToxicFlowMarkoutJob): void {
  if (typeof job !== "object" || job === null ||
      !Number.isSafeInteger(job.chainId) || job.chainId < 1 ||
      typeof job.desiredCanonical !== "boolean" ||
      !/^0x[0-9a-f]{40}$/.test(job.user) ||
      !/^0x[0-9a-f]{40}$/.test(job.tokenIn) ||
      !/^0x[0-9a-f]{40}$/.test(job.tokenOut) ||
      job.tokenIn === job.tokenOut ||
      !Number.isSafeInteger(job.desiredRevision) || job.desiredRevision < 1 ||
      !Number.isSafeInteger(job.attemptCount) || job.attemptCount < 1) {
    throw new Error("Toxic-flow markout job is invalid");
  }
  identifier(job.settlementEventId, "settlementEventId");
  identifier(job.quoteId, "quoteId");
  positiveUint(job.amountIn, "amountIn");
  positiveUint(job.amountOut, "amountOut");
  timestamp(job.settledAt, "settledAt");
}

function assertSnapshot(value: ToxicFlowMarkoutSnapshot): void {
  identifier(value.snapshotId, "snapshotId");
  positiveDecimal(value.midPrice, "midPrice");
  timestamp(value.observedAt, "observedAt");
}

function assertResult(value: ToxicFlowMarkoutResult): void {
  positiveDecimal(value.executionPrice, "executionPrice");
  positiveDecimal(value.postMidPrice, "postMidPrice");
  assertInteger(value.postTradeDriftBps, -10_000, 10_000, "postTradeDriftBps");
  assertInteger(value.toxicityScoreBps, 0, 10_000, "toxicityScoreBps");
}

function identifier(value: unknown, field: string): string {
  assertIdentifier(value, field);
  return value;
}

function assertIdentifier(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.length < 1 || value.length > 128 ||
      !safeIdentifierPattern.test(value)) {
    throw new Error(`Toxic-flow markout ${field} is invalid`);
  }
}

function positiveUint(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`Toxic-flow markout ${field} is invalid`);
  }
  return value;
}

function positiveDecimal(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value) ||
      Number(value) <= 0) {
    throw new Error(`Toxic-flow markout ${field} is invalid`);
  }
  return value;
}

function timestamp(value: unknown, field: string): string {
  const serialized = value instanceof Date ? value.toISOString() : value;
  if (typeof serialized !== "string" || !isCanonicalUtcIsoTimestamp(serialized)) {
    throw new Error(`Toxic-flow markout ${field} is invalid`);
  }
  return serialized;
}

function nonNegativeInteger(value: unknown, field: string): number {
  const parsed = typeof value === "string" && /^[0-9]+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(parsed) || Number(parsed) < 0) {
    throw new Error(`Toxic-flow markout ${field} is invalid`);
  }
  return Number(parsed);
}

function signedInteger(value: unknown, field: string): number {
  const parsed = typeof value === "string" && /^-?[0-9]+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(parsed) || Number(parsed) < -10_000 || Number(parsed) > 10_000) {
    throw new Error(`Toxic-flow markout ${field} is invalid`);
  }
  return Number(parsed);
}

function booleanValue(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new Error(`Toxic-flow markout ${field} is invalid`);
  return value;
}

function assertInteger(
  value: unknown,
  min: number,
  max: number,
  field: string,
): void {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) {
    throw new Error(`Toxic-flow markout ${field} must be an integer from ${min} to ${max}`);
  }
}
