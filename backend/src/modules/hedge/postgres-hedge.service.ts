import { createHash } from "node:crypto";
import pg from "pg";
import type { Address, HedgeIntentStatusResponse } from "../../shared/types/rfq.js";
import { isCanonicalUtcIsoTimestamp } from "../../shared/validation/timestamp.js";
import {
  assertHedgeIntent,
  assertHedgeRiskInput,
  assertHedgeServiceConfig,
  assertSafeIdentifier,
  cloneHedgeIntentStatus,
  cloneHedgeServiceConfig,
  defaultHedgeServiceConfig,
  matchesHedgeIntent,
  type HedgeFailureReasonCode,
  type HedgeIntent,
  type HedgeIntentService,
  type HedgeResult,
  type HedgeRiskInput,
  type HedgeServiceConfig,
  type MarkHedgeIntentFilledInput,
  type RemoveHedgeIntentResult,
  type UpdateHedgeIntentResult,
} from "./hedge.service.js";

const hedgeColumns = `
  id, settlement_event_id, quote_id, chain_id, token_address, side, amount,
  status, reason, external_order_id, filled_amount, last_error_code,
  created_at, updated_at
`;

export class PostgresHedgeService implements HedgeIntentService {
  private readonly config: HedgeServiceConfig;

  constructor(private readonly pool: pg.Pool, config: HedgeServiceConfig = defaultHedgeServiceConfig) {
    assertPool(pool);
    assertHedgeServiceConfig(config);
    this.config = cloneHedgeServiceConfig(config);
  }

  async checkHealth(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("SELECT 1 FROM hedge_orders LIMIT 1");
    } finally {
      client.release();
    }
  }

  async createHedgeIntent(intent: HedgeIntent): Promise<HedgeResult> {
    assertHedgeIntent(intent);
    const hedgeOrderId = buildPostgresHedgeOrderId(intent.settlementEventId);
    const client = await this.pool.connect();
    try {
      const inserted = await client.query(
        `INSERT INTO hedge_orders (
           id, settlement_event_id, quote_id, chain_id, token_address,
           side, amount, venue, status, reason
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'internal', 'queued', $8)
         ON CONFLICT DO NOTHING
         RETURNING ${hedgeColumns}`,
        [
          hedgeOrderId,
          intent.settlementEventId,
          intent.quoteId,
          intent.chainId,
          intent.token.toLowerCase(),
          intent.side,
          intent.amount,
          intent.reason,
        ],
      );
      let record: HedgeIntentStatusResponse;
      if (inserted.rows.length === 1) {
        record = parseHedgeRow(inserted.rows[0]);
      } else if (inserted.rows.length === 0) {
        const existing = await client.query(
          `SELECT ${hedgeColumns} FROM hedge_orders WHERE settlement_event_id = $1`,
          [intent.settlementEventId],
        );
        if (existing.rows.length !== 1) {
          throw new Error(`Postgres hedge conflict for ${intent.settlementEventId}`);
        }
        record = parseHedgeRow(existing.rows[0]);
      } else {
        throw new Error("Postgres hedge insert returned multiple rows");
      }
      if (!matchesHedgeIntent(record, intent)) {
        throw new Error(`Postgres hedge intent conflict for ${intent.settlementEventId}`);
      }
      return { status: record.status, hedgeOrderId: record.hedgeOrderId, record: cloneHedgeIntentStatus(record) };
    } finally {
      client.release();
    }
  }

  async getHedgeIntent(hedgeOrderId: string): Promise<HedgeIntentStatusResponse | undefined> {
    assertSafeIdentifier(hedgeOrderId, "hedgeOrderId");
    return this.findOne("id", hedgeOrderId);
  }

  async getHedgeIntentBySettlementEvent(
    settlementEventId: string,
  ): Promise<HedgeIntentStatusResponse | undefined> {
    assertSafeIdentifier(settlementEventId, "settlementEventId");
    return this.findOne("settlement_event_id", settlementEventId);
  }

  async removeHedgeIntentBySettlementEvent(settlementEventId: string): Promise<RemoveHedgeIntentResult> {
    assertSafeIdentifier(settlementEventId, "settlementEventId");
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `DELETE FROM hedge_orders
         WHERE settlement_event_id = $1 AND status = 'queued'
           AND submission_attempted_at IS NULL AND filled_amount IS NULL
           AND lease_owner IS NULL
         RETURNING ${hedgeColumns}`,
        [settlementEventId],
      );
      if (result.rows.length === 0) {
        const existing = await client.query(
          `SELECT ${hedgeColumns} FROM hedge_orders WHERE settlement_event_id = $1`,
          [settlementEventId],
        );
        if (existing.rows.length > 1) throw new Error("Postgres hedge reorg lookup returned multiple rows");
        return { ...(existing.rows[0] ? { record: parseHedgeRow(existing.rows[0]) } : {}), removed: false };
      }
      if (result.rows.length !== 1) throw new Error("Postgres hedge removal returned multiple rows");
      return { record: parseHedgeRow(result.rows[0]), removed: true };
    } finally {
      client.release();
    }
  }

  async markHedgeIntentFilled(input: MarkHedgeIntentFilledInput): Promise<UpdateHedgeIntentResult> {
    assertFilledInput(input);
    return this.updateStatus(input.hedgeOrderId, "filled", input.externalOrderId);
  }

  async markHedgeIntentFailed(hedgeOrderId: string): Promise<UpdateHedgeIntentResult> {
    assertSafeIdentifier(hedgeOrderId, "hedgeOrderId");
    return this.updateStatus(hedgeOrderId, "failed");
  }

  async recordHedgeFailure(intent: HedgeIntent, reasonCode: HedgeFailureReasonCode): Promise<void> {
    assertHedgeIntent(intent);
    if (reasonCode !== "HEDGE_INTENT_FAILED") {
      throw new Error("Postgres hedge failure reason must be HEDGE_INTENT_FAILED");
    }
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `INSERT INTO hedge_orders (
           id, settlement_event_id, quote_id, chain_id, token_address,
           side, amount, venue, status, reason, last_error_code
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'internal', 'failed', $8, 'HEDGE_INTENT_FAILED')
         ON CONFLICT (settlement_event_id) DO UPDATE SET
           status = CASE WHEN hedge_orders.status = 'filled' THEN 'filled' ELSE 'failed' END,
           last_error_code = CASE
             WHEN hedge_orders.status = 'filled' THEN hedge_orders.last_error_code
             ELSE EXCLUDED.last_error_code
           END,
           updated_at = now()
         WHERE hedge_orders.id = EXCLUDED.id
           AND hedge_orders.quote_id = EXCLUDED.quote_id
           AND hedge_orders.chain_id = EXCLUDED.chain_id
           AND lower(hedge_orders.token_address) = lower(EXCLUDED.token_address)
           AND hedge_orders.side = EXCLUDED.side
           AND hedge_orders.amount = EXCLUDED.amount
           AND hedge_orders.reason = EXCLUDED.reason
         RETURNING ${hedgeColumns}`,
        [
          buildPostgresHedgeOrderId(intent.settlementEventId),
          intent.settlementEventId,
          intent.quoteId,
          intent.chainId,
          intent.token.toLowerCase(),
          intent.side,
          intent.amount,
          intent.reason,
        ],
      );
      if (result.rows.length !== 1) {
        throw new Error(`Postgres hedge failure conflict for ${intent.settlementEventId}`);
      }
      const record = parseHedgeRow(result.rows[0]);
      if (!matchesHedgeIntent(record, intent)) {
        throw new Error(`Postgres hedge failure conflict for ${intent.settlementEventId}`);
      }
    } finally {
      client.release();
    }
  }

  async quoteRiskPenaltyBps(input: HedgeRiskInput): Promise<number> {
    assertHedgeRiskInput(input);
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT COUNT(*)::text AS failures
         FROM hedge_orders
         WHERE chain_id = $1 AND token_address = $2 AND status = 'failed'`,
        [input.chainId, input.token.toLowerCase()],
      );
      const failures = parseNonNegativeSafeInteger(result.rows[0]?.failures, "failures");
      return Math.min(failures * this.config.failurePenaltyBps, this.config.maxFailurePenaltyBps);
    } finally {
      client.release();
    }
  }

  private async findOne(field: "id" | "settlement_event_id", value: string): Promise<HedgeIntentStatusResponse | undefined> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(`SELECT ${hedgeColumns} FROM hedge_orders WHERE ${field} = $1`, [value]);
      if (result.rows.length > 1) throw new Error("Postgres hedge lookup returned multiple rows");
      return result.rows[0] ? parseHedgeRow(result.rows[0]) : undefined;
    } finally {
      client.release();
    }
  }

  private async updateStatus(
    hedgeOrderId: string,
    status: "filled" | "failed",
    externalOrderId?: string,
  ): Promise<UpdateHedgeIntentResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const settlement = await client.query(
        `SELECT settlement.id, settlement.canonical
         FROM settlement_events AS settlement
         INNER JOIN hedge_orders AS hedge ON hedge.settlement_event_id = settlement.id
         WHERE hedge.id = $1
         FOR UPDATE OF settlement`,
        [hedgeOrderId],
      );
      if (settlement.rows.length === 0) {
        await client.query("COMMIT");
        return { updated: false };
      }
      if (settlement.rows.length !== 1 || typeof settlement.rows[0]?.canonical !== "boolean") {
        throw new Error(`Postgres hedge settlement is unavailable for ${hedgeOrderId}`);
      }
      const selected = await client.query(
        `SELECT ${hedgeColumns}, lease_owner FROM hedge_orders WHERE id = $1 FOR UPDATE`,
        [hedgeOrderId],
      );
      if (selected.rows.length > 1) throw new Error("Postgres hedge status lookup returned multiple rows");
      if (selected.rows.length === 0) {
        await client.query("COMMIT");
        return { updated: false };
      }
      const existing = parseHedgeRow(selected.rows[0]);
      if (existing && status === "filled") {
        if (existing.status === "failed") {
          throw new Error(`Hedge intent ${hedgeOrderId} cannot transition from failed to filled`);
        }
        if (existing.status === "filled" && existing.externalOrderId !== externalOrderId) {
          throw new Error(`Hedge intent ${hedgeOrderId} filled externalOrderId conflict`);
        }
      }
      if (existing?.status === "filled" && status === "failed") {
        throw new Error(`Hedge intent ${hedgeOrderId} cannot transition from filled to failed`);
      }
      if (existing.status === status) {
        await client.query("COMMIT");
        return { record: existing, updated: false };
      }
      if ((selected.rows[0] as Record<string, unknown>).lease_owner !== null &&
          (selected.rows[0] as Record<string, unknown>).lease_owner !== undefined) {
        throw new Error(`Hedge intent ${hedgeOrderId} is leased by a worker`);
      }
      const result = await client.query(
        `UPDATE hedge_orders
         SET status = $2,
             external_order_id = CASE WHEN $2 = 'filled' THEN $3 ELSE external_order_id END,
             filled_amount = CASE WHEN $2 = 'filled' THEN amount ELSE filled_amount END,
             last_error_code = CASE
               WHEN $2 = 'failed' THEN COALESCE(last_error_code, 'HEDGE_MANUAL_FAILURE')
               ELSE NULL
             END,
             updated_at = now()
         WHERE id = $1 AND status = 'queued' AND lease_owner IS NULL
         RETURNING ${hedgeColumns}`,
        [hedgeOrderId, status, externalOrderId ?? null],
      );
      if (result.rows.length !== 1) throw new Error(`Postgres hedge status conflict for ${hedgeOrderId}`);
      const record = parseHedgeRow(result.rows[0]);
      if (status === "filled") {
        const delta = record.side === "buy" ? record.amount : `-${record.amount}`;
        await client.query(
          `INSERT INTO inventory_positions (id, chain_id, token_address, balance, updated_at)
           VALUES ($1, $2, $3, $4, now())
           ON CONFLICT (chain_id, token_address) DO UPDATE SET
             balance = inventory_positions.balance + EXCLUDED.balance,
             updated_at = now()`,
          [inventoryPositionId(record.chainId, record.token), record.chainId, record.token.toLowerCase(), delta],
        );
      }
      await client.query("COMMIT");
      return { record, updated: true };
    } catch (error) {
      await rollbackBestEffort(client);
      throw error;
    } finally {
      client.release();
    }
  }
}

function buildPostgresHedgeOrderId(settlementEventId: string): string {
  const digest = createHash("sha256").update(settlementEventId).digest("hex").slice(0, 32);
  return `h_${digest}`;
}

function inventoryPositionId(chainId: number, token: Address): string {
  return `ip_${chainId}_${token.slice(2).toLowerCase()}`;
}

function parseHedgeRow(row: unknown): HedgeIntentStatusResponse {
  if (typeof row !== "object" || row === null || Array.isArray(row)) {
    throw new Error("Postgres hedge row must be an object");
  }
  const value = row as Record<string, unknown>;
  const status = value.status;
  if (status !== "queued" && status !== "filled" && status !== "failed") {
    throw new Error("Postgres hedge row status is invalid");
  }
  const side = value.side;
  if (side !== "buy" && side !== "sell") throw new Error("Postgres hedge row side is invalid");
  const reason = value.reason;
  if (reason !== "inventory_rebalance" && reason !== "risk_reduction") {
    throw new Error("Postgres hedge row reason is invalid");
  }
  const externalOrderId = value.external_order_id;
  if (externalOrderId !== null && externalOrderId !== undefined &&
      (typeof externalOrderId !== "string" || externalOrderId.trim().length === 0)) {
    throw new Error("Postgres hedge row external_order_id is invalid");
  }
  const filledAmount = value.filled_amount;
  if (filledAmount !== null && filledAmount !== undefined &&
      (typeof filledAmount !== "string" || !/^[1-9][0-9]*$/.test(filledAmount))) {
    throw new Error("Postgres hedge row filled_amount is invalid");
  }
  const failureCode = value.last_error_code;
  if (failureCode !== null && failureCode !== undefined &&
      (typeof failureCode !== "string" || !/^[A-Z0-9_:-]{1,128}$/.test(failureCode))) {
    throw new Error("Postgres hedge row last_error_code is invalid");
  }
  const record: HedgeIntentStatusResponse = {
    hedgeOrderId: parseIdentifier(value.id, "id"),
    status,
    settlementEventId: parseIdentifier(value.settlement_event_id, "settlement_event_id"),
    quoteId: parseIdentifier(value.quote_id, "quote_id"),
    chainId: parsePositiveSafeInteger(value.chain_id, "chain_id"),
    token: parseAddress(value.token_address, "token_address"),
    side,
    amount: parsePositiveUInt(value.amount, "amount"),
    reason,
    createdAt: parseTimestamp(value.created_at, "created_at"),
    ...(externalOrderId ? { externalOrderId } : {}),
    ...(filledAmount ? { filledAmount } : {}),
    ...(failureCode ? { failureCode } : {}),
    ...(value.updated_at ? { updatedAt: parseTimestamp(value.updated_at, "updated_at") } : {}),
  };
  if (status === "filled" && (!record.externalOrderId || !record.filledAmount)) {
    throw new Error("Postgres hedge filled row requires external order and filled amount");
  }
  return record;
}

function assertFilledInput(input: MarkHedgeIntentFilledInput): void {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Hedge filled input must be an object");
  }
  const keys = Object.keys(input);
  if (keys.length !== 2 || !Object.prototype.hasOwnProperty.call(input, "hedgeOrderId") ||
      !Object.prototype.hasOwnProperty.call(input, "externalOrderId")) {
    throw new Error("Hedge filled input must contain hedgeOrderId and externalOrderId");
  }
  assertSafeIdentifier(input.hedgeOrderId, "hedgeOrderId");
  if (typeof input.externalOrderId !== "string" || input.externalOrderId.trim().length === 0) {
    throw new Error("Hedge externalOrderId must be a non-empty string");
  }
}

function parseIdentifier(value: unknown, field: string): string {
  assertSafeIdentifier(value, field as "hedgeOrderId");
  return value as string;
}

function parseAddress(value: unknown, field: string): Address {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`Postgres hedge row ${field} must be a 20-byte hex address`);
  }
  return value as Address;
}

function parsePositiveUInt(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`Postgres hedge row ${field} must be a canonical positive uint string`);
  }
  return value;
}

function parsePositiveSafeInteger(value: unknown, field: string): number {
  const parsed = typeof value === "number" ? value :
    typeof value === "string" && /^[1-9][0-9]*$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Postgres hedge row ${field} must be a positive safe integer`);
  }
  return parsed;
}

function parseNonNegativeSafeInteger(value: unknown, field: string): number {
  const parsed = typeof value === "number" ? value :
    typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Postgres hedge ${field} must be a non-negative safe integer`);
  }
  return parsed;
}

function parseTimestamp(value: unknown, field: string): string {
  const timestamp = value instanceof Date ? value.toISOString() : value;
  if (typeof timestamp !== "string" || !isCanonicalUtcIsoTimestamp(timestamp)) {
    throw new Error(`Postgres hedge row ${field} must be a canonical UTC ISO timestamp`);
  }
  return timestamp;
}

function assertPool(pool: unknown): asserts pool is pg.Pool {
  if (typeof pool !== "object" || pool === null || Array.isArray(pool) ||
      typeof (pool as Record<string, unknown>).connect !== "function") {
    throw new Error("Postgres hedge pool.connect must be a function");
  }
}

async function rollbackBestEffort(client: pg.PoolClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {}
}
