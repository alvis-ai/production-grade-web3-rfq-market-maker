import pg from "pg";
import type { Address, UIntString } from "../../shared/types/rfq.js";
import { isCanonicalUtcIsoTimestamp } from "../../shared/validation/timestamp.js";
import {
  compareCexQuoteQuantities,
  parseCexQuoteQuantity,
  type CexQuoteQuantity,
} from "./hedge-execution-evidence.js";

export interface HedgeJob {
  hedgeOrderId: string;
  chainId: number;
  token: Address;
  side: "buy" | "sell";
  amount: UIntString;
  attemptCount: number;
  submissionAttempted: boolean;
  createdAt: string;
}

export interface HedgeJobRoute {
  venue: "binance";
  symbol: string;
  clientOrderId: string;
}

export interface HedgeJobStore {
  checkHealth(): Promise<void>;
  claimNext(workerId: string, leaseMs: number): Promise<HedgeJob | undefined>;
  prepareRoute(hedgeOrderId: string, workerId: string, route: HedgeJobRoute): Promise<void>;
  authorizeSubmission(hedgeOrderId: string, workerId: string): Promise<void>;
  recordExternalOrderObserved(hedgeOrderId: string, workerId: string): Promise<void>;
  recordExecutionProgress(
    hedgeOrderId: string,
    workerId: string,
    externalOrderId: string,
    filledAmount: UIntString,
    executedQuoteQuantity: CexQuoteQuantity,
  ): Promise<void>;
  completeFilled(
    hedgeOrderId: string,
    workerId: string,
    externalOrderId: string,
    filledAmount: UIntString,
    executedQuoteQuantity: CexQuoteQuantity,
  ): Promise<void>;
  completeFailed(
    hedgeOrderId: string,
    workerId: string,
    errorCode: string,
    externalOrderId?: string,
    filledAmount?: UIntString,
    executedQuoteQuantity?: CexQuoteQuantity,
  ): Promise<void>;
  releaseForRetry(hedgeOrderId: string, workerId: string, errorCode: string, retryDelayMs: number): Promise<void>;
}

const jobColumns = `
  id, chain_id, token_address, side, amount, attempt_count,
  submission_attempted_at IS NOT NULL AS submission_attempted, created_at
`;
const maxLeaseMs = 300_000;
const maxRetryDelayMs = 604_800_000;

export class PostgresHedgeJobStore implements HedgeJobStore {
  constructor(private readonly pool: pg.Pool) {
    assertPool(pool);
  }

  async checkHealth(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("SELECT attempt_count FROM hedge_orders LIMIT 1");
    } finally {
      client.release();
    }
  }

  async claimNext(workerId: string, leaseMs: number): Promise<HedgeJob | undefined> {
    assertSafeIdentifier(workerId, "workerId");
    assertBoundedInteger(leaseMs, "leaseMs", 1_000, maxLeaseMs);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `WITH candidate AS (
           SELECT id
           FROM hedge_orders AS hedge
           INNER JOIN settlement_events AS settlement ON settlement.id = hedge.settlement_event_id
           WHERE hedge.status = 'queued'
             AND (settlement.canonical = TRUE OR hedge.submission_attempted_at IS NOT NULL)
             AND hedge.next_attempt_at <= now()
             AND (hedge.lease_expires_at IS NULL OR hedge.lease_expires_at <= now())
           ORDER BY hedge.next_attempt_at ASC, hedge.created_at ASC, hedge.id ASC
           FOR UPDATE SKIP LOCKED
           LIMIT 1
         )
         UPDATE hedge_orders AS hedge
         SET lease_owner = $1,
             lease_expires_at = now() + $2 * interval '1 millisecond',
             attempt_count = hedge.attempt_count + 1,
             updated_at = now()
         FROM candidate
         WHERE hedge.id = candidate.id
         RETURNING ${jobColumns}`,
        [workerId, leaseMs],
      );
      if (result.rows.length > 1) throw new Error("Postgres hedge claim returned multiple jobs");
      await client.query("COMMIT");
      return result.rows[0] ? parseHedgeJob(result.rows[0]) : undefined;
    } catch (error) {
      await rollbackBestEffort(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async prepareRoute(hedgeOrderId: string, workerId: string, route: HedgeJobRoute): Promise<void> {
    assertLeaseMutation(hedgeOrderId, workerId);
    assertHedgeJobRoute(route);
    await this.updateLeasedJob(
      `UPDATE hedge_orders
       SET venue = $3, venue_symbol = $4, client_order_id = $5, updated_at = now()
       WHERE id = $1 AND status = 'queued' AND lease_owner = $2
         AND (
           (venue = 'internal' AND venue_symbol IS NULL AND client_order_id IS NULL)
           OR (venue = $3 AND venue_symbol = $4 AND client_order_id = $5)
         )`,
      [hedgeOrderId, workerId, route.venue, route.symbol, route.clientOrderId],
      hedgeOrderId,
    );
  }

  async authorizeSubmission(hedgeOrderId: string, workerId: string): Promise<void> {
    assertLeaseMutation(hedgeOrderId, workerId);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const settlement = await client.query(
        `SELECT settlement.canonical
         FROM settlement_events AS settlement
         INNER JOIN hedge_orders AS hedge ON hedge.settlement_event_id = settlement.id
         WHERE hedge.id = $1
         FOR UPDATE OF settlement`,
        [hedgeOrderId],
      );
      if (settlement.rows.length !== 1 || settlement.rows[0]?.canonical !== true) {
        throw new Error("HEDGE_SETTLEMENT_NON_CANONICAL");
      }
      const updated = await client.query(
        `UPDATE hedge_orders
         SET submission_attempted_at = COALESCE(submission_attempted_at, now()), updated_at = now()
         WHERE id = $1 AND status = 'queued' AND lease_owner = $2
           AND venue <> 'internal' AND venue_symbol IS NOT NULL AND client_order_id IS NOT NULL`,
        [hedgeOrderId, workerId],
      );
      if (updated.rowCount !== 1) throw new Error(`Postgres hedge lease conflict for ${hedgeOrderId}`);
      await client.query("COMMIT");
    } catch (error) {
      await rollbackBestEffort(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async recordExternalOrderObserved(hedgeOrderId: string, workerId: string): Promise<void> {
    assertLeaseMutation(hedgeOrderId, workerId);
    await this.updateLeasedJob(
      `UPDATE hedge_orders
       SET submission_attempted_at = COALESCE(submission_attempted_at, now()), updated_at = now()
       WHERE id = $1 AND status = 'queued' AND lease_owner = $2
         AND venue <> 'internal' AND venue_symbol IS NOT NULL AND client_order_id IS NOT NULL`,
      [hedgeOrderId, workerId],
      hedgeOrderId,
    );
  }

  async recordExecutionProgress(
    hedgeOrderId: string,
    workerId: string,
    externalOrderId: string,
    filledAmount: UIntString,
    executedQuoteQuantity: CexQuoteQuantity,
  ): Promise<void> {
    assertLeaseMutation(hedgeOrderId, workerId);
    assertNonEmptyBoundedString(externalOrderId, "externalOrderId", 128);
    assertPositiveUInt(filledAmount, "filledAmount");
    assertPositiveQuoteQuantity(executedQuoteQuantity);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await lockSettlementForHedge(client, hedgeOrderId);
      const selected = await client.query(
        `SELECT chain_id, token_address, side, amount::text AS amount,
                filled_amount::text AS filled_amount,
                executed_quote_quantity::text AS executed_quote_quantity, external_order_id
         FROM hedge_orders
         WHERE id = $1 AND status = 'queued' AND lease_owner = $2
         FOR UPDATE`,
        [hedgeOrderId, workerId],
      );
      if (selected.rows.length !== 1) throw new Error(`Postgres hedge lease conflict for ${hedgeOrderId}`);
      const position = parseTerminalPosition(selected.rows[0]);
      const previous = parseOptionalPositiveUInt((selected.rows[0] as Record<string, unknown>).filled_amount);
      assertCumulativeFill(hedgeOrderId, filledAmount, position.amount, previous);
      const previousQuoteQuantity = parseOptionalQuoteQuantity(
        (selected.rows[0] as Record<string, unknown>).executed_quote_quantity,
      );
      assertCumulativeExecutionEvidence(
        hedgeOrderId,
        filledAmount,
        executedQuoteQuantity,
        previous,
        previousQuoteQuantity,
      );
      const previousExternalOrderId = (selected.rows[0] as Record<string, unknown>).external_order_id;
      if (previousExternalOrderId !== null && previousExternalOrderId !== externalOrderId) {
        throw new Error(`Postgres hedge external order conflict for ${hedgeOrderId}`);
      }
      await client.query(
        `UPDATE hedge_orders
         SET submission_attempted_at = COALESCE(submission_attempted_at, now()),
             external_order_id = $3, filled_amount = $4,
             executed_quote_quantity = $5, execution_evidence_version = 'base-and-quote-v2', updated_at = now()
         WHERE id = $1 AND status = 'queued' AND lease_owner = $2`,
        [hedgeOrderId, workerId, externalOrderId, filledAmount, executedQuoteQuantity],
      );
      await applyInventoryFillDelta(client, position, BigInt(filledAmount) - BigInt(previous ?? "0"));
      await client.query("COMMIT");
    } catch (error) {
      await rollbackBestEffort(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async completeFilled(
    hedgeOrderId: string,
    workerId: string,
    externalOrderId: string,
    filledAmount: UIntString,
    executedQuoteQuantity: CexQuoteQuantity,
  ): Promise<void> {
    assertLeaseMutation(hedgeOrderId, workerId);
    assertNonEmptyBoundedString(externalOrderId, "externalOrderId", 128);
    assertPositiveUInt(filledAmount, "filledAmount");
    assertPositiveQuoteQuantity(executedQuoteQuantity);
    await this.completeTerminal(
      hedgeOrderId,
      workerId,
      "filled",
      undefined,
      externalOrderId,
      filledAmount,
      executedQuoteQuantity,
    );
  }

  async completeFailed(
    hedgeOrderId: string,
    workerId: string,
    errorCode: string,
    externalOrderId?: string,
    filledAmount?: UIntString,
    executedQuoteQuantity?: CexQuoteQuantity,
  ): Promise<void> {
    assertLeaseMutation(hedgeOrderId, workerId);
    assertErrorCode(errorCode);
    if (externalOrderId !== undefined) assertNonEmptyBoundedString(externalOrderId, "externalOrderId", 128);
    if (filledAmount !== undefined) {
      assertPositiveUInt(filledAmount, "filledAmount");
      if (externalOrderId === undefined) throw new Error("Hedge job partial fill requires externalOrderId");
    }
    if ((filledAmount === undefined) !== (executedQuoteQuantity === undefined)) {
      throw new Error("Hedge job partial fill requires paired quote quantity evidence");
    }
    if (executedQuoteQuantity !== undefined) assertPositiveQuoteQuantity(executedQuoteQuantity);
    await this.completeTerminal(
      hedgeOrderId,
      workerId,
      "failed",
      errorCode,
      externalOrderId,
      filledAmount,
      executedQuoteQuantity,
    );
  }

  async releaseForRetry(
    hedgeOrderId: string,
    workerId: string,
    errorCode: string,
    retryDelayMs: number,
  ): Promise<void> {
    assertLeaseMutation(hedgeOrderId, workerId);
    assertErrorCode(errorCode);
    assertBoundedInteger(retryDelayMs, "retryDelayMs", 1, maxRetryDelayMs);
    await this.updateLeasedJob(
      `UPDATE hedge_orders
       SET last_error_code = $3,
           next_attempt_at = now() + $4 * interval '1 millisecond',
           lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
       WHERE id = $1 AND status = 'queued' AND lease_owner = $2`,
      [hedgeOrderId, workerId, errorCode, retryDelayMs],
      hedgeOrderId,
    );
  }

  private async updateLeasedJob(sql: string, params: unknown[], hedgeOrderId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(sql, params);
      if (result.rowCount !== 1) {
        throw new Error(`Postgres hedge lease conflict for ${hedgeOrderId}`);
      }
    } finally {
      client.release();
    }
  }

  private async completeTerminal(
    hedgeOrderId: string,
    workerId: string,
    status: "filled" | "failed",
    errorCode?: string,
    externalOrderId?: string,
    filledAmount?: UIntString,
    executedQuoteQuantity?: CexQuoteQuantity,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await lockSettlementForHedge(client, hedgeOrderId);
      const selected = await client.query(
        `SELECT chain_id, token_address, side, amount::text AS amount,
                filled_amount::text AS filled_amount,
                executed_quote_quantity::text AS executed_quote_quantity, external_order_id
         FROM hedge_orders
         WHERE id = $1 AND status = 'queued' AND lease_owner = $2
         FOR UPDATE`,
        [hedgeOrderId, workerId],
      );
      if (selected.rows.length !== 1) throw new Error(`Postgres hedge lease conflict for ${hedgeOrderId}`);
      const position = parseTerminalPosition(selected.rows[0]);
      const previous = parseOptionalPositiveUInt((selected.rows[0] as Record<string, unknown>).filled_amount);
      if (filledAmount !== undefined) assertCumulativeFill(hedgeOrderId, filledAmount, position.amount, previous);
      const previousQuoteQuantity = parseOptionalQuoteQuantity(
        (selected.rows[0] as Record<string, unknown>).executed_quote_quantity,
      );
      const previousExternalOrderId = (selected.rows[0] as Record<string, unknown>).external_order_id;
      if (externalOrderId !== undefined && previousExternalOrderId !== null &&
          previousExternalOrderId !== externalOrderId) {
        throw new Error(`Postgres hedge external order conflict for ${hedgeOrderId}`);
      }
      if (externalOrderId !== undefined && previous !== undefined && filledAmount === undefined) {
        throw new Error(`Postgres hedge cumulative execution evidence disappeared for ${hedgeOrderId}`);
      }
      if (filledAmount !== undefined && executedQuoteQuantity !== undefined) {
        assertCumulativeExecutionEvidence(
          hedgeOrderId,
          filledAmount,
          executedQuoteQuantity,
          previous,
          previousQuoteQuantity,
        );
      }
      const updated = await client.query(
        `UPDATE hedge_orders
         SET status = $3, external_order_id = COALESCE($4, external_order_id),
             filled_amount = COALESCE($5, filled_amount), last_error_code = $6,
             executed_quote_quantity = COALESCE($7, executed_quote_quantity),
             execution_evidence_version = CASE
               WHEN $7 IS NOT NULL THEN 'base-and-quote-v2'
               ELSE execution_evidence_version
             END,
             lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
         WHERE id = $1 AND status = 'queued' AND lease_owner = $2
           AND ($3 <> 'filled' OR (venue <> 'internal' AND venue_symbol IS NOT NULL AND client_order_id IS NOT NULL))`,
        [
          hedgeOrderId,
          workerId,
          status,
          externalOrderId ?? null,
          filledAmount ?? null,
          errorCode ?? null,
          executedQuoteQuantity ?? null,
        ],
      );
      if (updated.rowCount !== 1) throw new Error(`Postgres hedge lease conflict for ${hedgeOrderId}`);
      if (filledAmount !== undefined) {
        await applyInventoryFillDelta(client, position, BigInt(filledAmount) - BigInt(previous ?? "0"));
      }
      await client.query("COMMIT");
    } catch (error) {
      await rollbackBestEffort(client);
      throw error;
    } finally {
      client.release();
    }
  }
}

function parseTerminalPosition(row: unknown): { chainId: number; token: Address; side: "buy" | "sell"; amount: UIntString } {
  if (typeof row !== "object" || row === null || Array.isArray(row)) {
    throw new Error("Postgres hedge terminal row must be an object");
  }
  const value = row as Record<string, unknown>;
  const side = value.side;
  if (side !== "buy" && side !== "sell") throw new Error("Postgres hedge terminal side is invalid");
  return {
    chainId: parsePositiveSafeInteger(value.chain_id, "chain_id"),
    token: parseAddress(value.token_address),
    side,
    amount: parsePositiveUInt(value.amount),
  };
}

function parseHedgeJob(row: unknown): HedgeJob {
  if (typeof row !== "object" || row === null || Array.isArray(row)) {
    throw new Error("Postgres hedge job row must be an object");
  }
  const value = row as Record<string, unknown>;
  const side = value.side;
  if (side !== "buy" && side !== "sell") throw new Error("Postgres hedge job side is invalid");
  return {
    hedgeOrderId: parseIdentifier(value.id, "id"),
    chainId: parsePositiveSafeInteger(value.chain_id, "chain_id"),
    token: parseAddress(value.token_address),
    side,
    amount: parsePositiveUInt(value.amount),
    attemptCount: parseNonNegativeSafeInteger(value.attempt_count, "attempt_count"),
    submissionAttempted: parseBoolean(value.submission_attempted, "submission_attempted"),
    createdAt: parseTimestamp(value.created_at),
  };
}

function assertHedgeJobRoute(route: HedgeJobRoute): void {
  if (typeof route !== "object" || route === null || Array.isArray(route)) {
    throw new Error("Hedge job route must be an object");
  }
  const keys = Object.keys(route);
  if (keys.length !== 3 || !Object.prototype.hasOwnProperty.call(route, "venue") ||
      !Object.prototype.hasOwnProperty.call(route, "symbol") ||
      !Object.prototype.hasOwnProperty.call(route, "clientOrderId")) {
    throw new Error("Hedge job route must contain venue, symbol, and clientOrderId");
  }
  if (route.venue !== "binance") throw new Error("Hedge job route venue must be binance");
  if (typeof route.symbol !== "string" || !/^[A-Z0-9._-]{3,32}$/.test(route.symbol)) {
    throw new Error("Hedge job route symbol is invalid");
  }
  if (typeof route.clientOrderId !== "string" || !/^[A-Za-z0-9._-]{1,36}$/.test(route.clientOrderId)) {
    throw new Error("Hedge job route clientOrderId is invalid");
  }
}

function assertLeaseMutation(hedgeOrderId: string, workerId: string): void {
  assertSafeIdentifier(hedgeOrderId, "hedgeOrderId");
  assertSafeIdentifier(workerId, "workerId");
}

function assertErrorCode(value: string): void {
  if (typeof value !== "string" || !/^[A-Z0-9_:-]{1,128}$/.test(value)) {
    throw new Error("Hedge job errorCode is invalid");
  }
}

function assertNonEmptyBoundedString(value: string, field: string, maxLength: number): void {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength) {
    throw new Error(`Hedge job ${field} must be a non-empty string no longer than ${maxLength} characters`);
  }
}

function assertPositiveUInt(value: unknown, field: string): asserts value is UIntString {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`Hedge job ${field} must be a canonical positive uint string`);
  }
}

function assertBoundedInteger(value: number, field: string, min: number, max: number): void {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`Hedge job ${field} must be a safe integer between ${min} and ${max}`);
  }
}

function parseIdentifier(value: unknown, field: string): string {
  assertSafeIdentifier(value, field);
  return value as string;
}

function assertSafeIdentifier(value: unknown, field: string): void {
  if (typeof value !== "string" || value.length === 0 || value.length > 128 ||
      !/^[A-Za-z0-9_:-]+$/.test(value)) {
    throw new Error(`Hedge job ${field} must be a safe identifier`);
  }
}

function parseAddress(value: unknown): Address {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error("Postgres hedge job token_address must be a 20-byte hex address");
  }
  return value as Address;
}

function parsePositiveUInt(value: unknown): UIntString {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) {
    throw new Error("Postgres hedge job amount must be a canonical positive uint string");
  }
  return value as UIntString;
}

function parseOptionalPositiveUInt(value: unknown): UIntString | undefined {
  if (value === null || value === undefined) return undefined;
  return parsePositiveUInt(value);
}

function assertCumulativeFill(
  hedgeOrderId: string,
  filledAmount: UIntString,
  requestedAmount: UIntString,
  previous?: UIntString,
): void {
  if (BigInt(filledAmount) > BigInt(requestedAmount)) {
    throw new Error(`Postgres hedge fill exceeds requested amount for ${hedgeOrderId}`);
  }
  if (previous !== undefined && BigInt(filledAmount) < BigInt(previous)) {
    throw new Error(`Postgres hedge cumulative fill regressed for ${hedgeOrderId}`);
  }
}

function assertCumulativeExecutionEvidence(
  hedgeOrderId: string,
  filledAmount: UIntString,
  quoteQuantity: CexQuoteQuantity,
  previousFilledAmount?: UIntString,
  previousQuoteQuantity?: CexQuoteQuantity,
): void {
  if (previousQuoteQuantity === undefined) return;
  const fillComparison = BigInt(filledAmount) === BigInt(previousFilledAmount ?? "0") ? 0 : 1;
  const quoteComparison = compareCexQuoteQuantities(quoteQuantity, previousQuoteQuantity);
  if (quoteComparison < 0 || (fillComparison === 0 && quoteComparison !== 0) ||
      (fillComparison > 0 && quoteComparison <= 0)) {
    throw new Error(`Postgres hedge cumulative execution evidence is inconsistent for ${hedgeOrderId}`);
  }
}

function parseOptionalQuoteQuantity(value: unknown): CexQuoteQuantity | undefined {
  if (value === null || value === undefined) return undefined;
  return parseCexQuoteQuantity(value);
}

function assertPositiveQuoteQuantity(value: unknown): asserts value is CexQuoteQuantity {
  if (parseCexQuoteQuantity(value) === undefined) {
    throw new Error("Hedge executedQuoteQuantity must be positive");
  }
}

function parsePositiveSafeInteger(value: unknown, field: string): number {
  const parsed = parseNonNegativeSafeInteger(value, field);
  if (parsed === 0) throw new Error(`Postgres hedge job ${field} must be positive`);
  return parsed;
}

function parseNonNegativeSafeInteger(value: unknown, field: string): number {
  const parsed = typeof value === "number" ? value :
    typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Postgres hedge job ${field} must be a non-negative safe integer`);
  }
  return parsed;
}

function parseBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`Postgres hedge job ${field} must be a boolean`);
  }
  return value;
}

function parseTimestamp(value: unknown): string {
  const timestamp = value instanceof Date ? value.toISOString() : value;
  if (typeof timestamp !== "string" || !isCanonicalUtcIsoTimestamp(timestamp)) {
    throw new Error("Postgres hedge job created_at must be a canonical UTC ISO timestamp");
  }
  return timestamp;
}

function inventoryPositionId(chainId: number, token: Address): string {
  return `ip_${chainId}_${token.slice(2).toLowerCase()}`;
}

async function lockSettlementForHedge(client: pg.PoolClient, hedgeOrderId: string): Promise<void> {
  const settlement = await client.query(
    `SELECT settlement.id, settlement.canonical
     FROM settlement_events AS settlement
     INNER JOIN hedge_orders AS hedge ON hedge.settlement_event_id = settlement.id
     WHERE hedge.id = $1
     FOR UPDATE OF settlement`,
    [hedgeOrderId],
  );
  if (settlement.rows.length !== 1 || typeof settlement.rows[0]?.canonical !== "boolean") {
    throw new Error(`Postgres hedge settlement is unavailable for ${hedgeOrderId}`);
  }
}

async function applyInventoryFillDelta(
  client: pg.PoolClient,
  position: { chainId: number; token: Address; side: "buy" | "sell" },
  rawDelta: bigint,
): Promise<void> {
  if (rawDelta === 0n) return;
  const signedDelta = position.side === "buy" ? rawDelta : -rawDelta;
  await client.query(
    `INSERT INTO inventory_positions (id, chain_id, token_address, balance, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (chain_id, token_address) DO UPDATE SET
       balance = inventory_positions.balance + EXCLUDED.balance,
       updated_at = now()`,
    [inventoryPositionId(position.chainId, position.token), position.chainId, position.token, signedDelta.toString()],
  );
}

function assertPool(pool: unknown): asserts pool is pg.Pool {
  if (typeof pool !== "object" || pool === null || Array.isArray(pool) ||
      typeof (pool as Record<string, unknown>).connect !== "function") {
    throw new Error("Postgres hedge job pool.connect must be a function");
  }
}

async function rollbackBestEffort(client: pg.PoolClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {}
}
