import pg from "pg";
import type {
  ClearSettlementStatusInput,
  ClearSettlementStatusResult,
  QuoteRecord,
  QuoteRepository,
  QuoteStatusMetadata,
  SaveRejectedQuoteInput,
  SaveRequestedQuoteInput,
  SaveRouteDecisionInput,
  SaveSignedQuoteInput,
} from "./quote-repository-contract.js";
import type {
  Address,
  QuoteLifecycleStatus,
  QuoteStatusResponse,
  UIntString,
} from "../../shared/types/rfq.js";
import { assertPrincipalId } from "../../shared/validation/principal-id.js";
import {
  assertCanMarkFailed,
  assertCanSaveRejectedQuote,
  assertCanSaveRequestedQuote,
  assertCanSaveRouteDecision,
  assertCanSaveSignedQuote,
  assertNonEmptyString,
  assertNonSettlementStatusMetadata,
  assertQuoteStatusMetadata,
  assertQuoteStatusMetadataDoesNotConflict,
  assertRejectedQuoteInput,
  assertRequestedQuoteInput,
  assertRouteDecisionInput,
  assertSafeIdentifier,
  assertSettlementStatusMetadata,
  assertSignedQuoteInput,
  assertStatusTransition,
  isSameSignedQuoteIdentity,
  normalizeClearSettlementStatusInput,
  normalizeQuoteStatusMetadata,
} from "./quote-repository-invariants.js";
import {
  findQuoteRecordById,
  quoteRecordFromRow,
  quoteSelectColumns,
  quoteStatusResponseFromRow,
} from "./postgres-quote-row.js";

export class PostgresQuoteRepository implements QuoteRepository {
  private readonly pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  async checkHealth(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("SELECT 1");
    } finally {
      client.release();
    }
  }

  async saveRequested(input: SaveRequestedQuoteInput): Promise<void> {
    assertRequestedQuoteInput(input);
    const quoteId = input.quoteId;
    const chainId = input.request.chainId;
    const user = input.request.user.toLowerCase();
    const tokenIn = input.request.tokenIn.toLowerCase();
    const tokenOut = input.request.tokenOut.toLowerCase();
    const amountIn = input.request.amountIn;
    const slippageBps = input.request.slippageBps;
    const snapshotId = input.snapshotId;

    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `INSERT INTO quotes (id, principal_id, chain_id, user_address, token_in, token_out, amount_in,
          slippage_bps, snapshot_id, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'requested', now(), now())
         ON CONFLICT (id) DO UPDATE SET
           chain_id = EXCLUDED.chain_id,
           user_address = EXCLUDED.user_address,
           token_in = EXCLUDED.token_in,
           token_out = EXCLUDED.token_out,
           amount_in = EXCLUDED.amount_in,
           slippage_bps = EXCLUDED.slippage_bps,
           snapshot_id = EXCLUDED.snapshot_id,
           updated_at = now()
         WHERE quotes.status = 'requested'
           AND quotes.principal_id = EXCLUDED.principal_id
           AND quotes.chain_id = EXCLUDED.chain_id
           AND lower(quotes.user_address) = lower(EXCLUDED.user_address)
           AND lower(quotes.token_in) = lower(EXCLUDED.token_in)
           AND lower(quotes.token_out) = lower(EXCLUDED.token_out)
           AND quotes.amount_in = EXCLUDED.amount_in
           AND quotes.slippage_bps = EXCLUDED.slippage_bps
           AND quotes.snapshot_id = EXCLUDED.snapshot_id
        `,
        [quoteId, input.principalId, chainId, user, tokenIn, tokenOut, amountIn, slippageBps, snapshotId],
      );

      if (result.rowCount === 0) {
        const existing = await findQuoteRecordById(client, quoteId);
        if (!existing) {
          throw new Error(`Quote ${quoteId} requested quote conflict could not be resolved`);
        }
        assertCanSaveRequestedQuote(existing, input);
      }
    } finally {
      client.release();
    }
  }

  async saveRouteDecision(input: SaveRouteDecisionInput): Promise<void> {
    assertRouteDecisionInput(input);
    const quoteId = input.quoteId;
    const snapshotId = input.snapshotId;
    const routePlan = input.routePlan;
    const routeId = routePlan.routeId;
    const tokenIn = routePlan.tokenIn.toLowerCase();
    const tokenOut = routePlan.tokenOut.toLowerCase();
    const expectedLiquidityUsd = routePlan.expectedLiquidityUsd;

    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `UPDATE quotes SET
           route_id = $4,
           route_venue = $5,
           route_expected_liquidity_usd = $6,
           route_decided_at = now(),
           updated_at = now()
         WHERE id = $1
           AND status = 'requested'
           AND principal_id = $2
           AND snapshot_id = $3
           AND lower(token_in) = $7
           AND lower(token_out) = $8
           AND route_id IS NULL
           AND route_venue IS NULL
           AND route_expected_liquidity_usd IS NULL
           AND route_decided_at IS NULL`,
        [
          quoteId,
          input.principalId,
          snapshotId,
          routeId,
          routePlan.venue,
          expectedLiquidityUsd,
          tokenIn,
          tokenOut,
        ],
      );
      if (result.rowCount === 1) return;
      if (result.rowCount !== 0) {
        throw new Error(`Quote ${quoteId} route decision updated multiple rows`);
      }

      const existing = await findQuoteRecordById(client, quoteId);
      assertCanSaveRouteDecision(existing, input);
    } finally {
      client.release();
    }
  }

  async saveRejected(input: SaveRejectedQuoteInput): Promise<void> {
    assertRejectedQuoteInput(input);
    const quoteId = input.quoteId;
    const rejectCode = input.rejectCode;

    const client = await this.pool.connect();
    try {
      const existing = await findQuoteRecordById(client, quoteId);
      if (!existing) {
        throw new Error(`Quote ${input.quoteId} cannot save rejected quote without requested state`);
      }

      assertCanSaveRejectedQuote(existing, input);
      if (existing.status === "rejected") {
        return;
      }

      const result = await client.query(
        `UPDATE quotes SET status = 'rejected', reject_code = $2,
          risk_policy_version = COALESCE($3, risk_policy_version),
          updated_at = now()
         WHERE id = $1 AND status = 'requested'`,
        [quoteId, rejectCode, input.riskPolicyVersion ?? null],
      );
      if (result.rowCount === 0) {
        const current = await findQuoteRecordById(client, quoteId);
        if (!current) {
          throw new Error(`Quote ${quoteId} cannot save rejected quote without requested state`);
        }
        assertCanSaveRejectedQuote(current, input);
      }
    } finally {
      client.release();
    }
  }

  async saveSigned(input: SaveSignedQuoteInput): Promise<void> {
    assertSignedQuoteInput(input);

    const { quote } = input;
    const quoteId = input.quoteId;
    const chainId = quote.chainId;
    const user = quote.user.toLowerCase();
    const tokenIn = quote.tokenIn.toLowerCase();
    const tokenOut = quote.tokenOut.toLowerCase();
    const nonce = quote.nonce;
    const amountIn = quote.amountIn;
    const amountOut = quote.amountOut;
    const minAmountOut = quote.minAmountOut;
    const deadline = quote.deadline;

    const client = await this.pool.connect();
    try {
      const existing = await findQuoteRecordById(client, quoteId);

      // Check nonce uniqueness
      const nonceCheck = await client.query(
        `SELECT id FROM quotes WHERE chain_id = $1 AND lower(user_address) = $2 AND nonce = $3 AND id != $4 AND nonce IS NOT NULL`,
        [chainId, user, nonce, quoteId],
      );
      if (nonceCheck.rowCount && nonceCheck.rowCount > 0) {
        throw new Error(`Signed quote nonce key already exists for ${nonceCheck.rows[0].id}`);
      }

      if (existing) {
        if (existing.nonce && !isSameSignedQuoteIdentity(existing, quote)) {
          throw new Error(`Signed quote identity cannot be changed for ${quoteId}`);
        }
        assertCanSaveSignedQuote(existing, input);
        if (existing.status === "signed") {
          return;
        }
      }

      // Upsert: INSERT or UPDATE from requested
      const result = await client.query(
        `INSERT INTO quotes (id, principal_id, chain_id, user_address, token_in, token_out, amount_in,
          slippage_bps, amount_out, min_amount_out, nonce, deadline, snapshot_id,
          pricing_version, spread_bps, size_impact_bps, market_spread_bps, inventory_skew_bps,
          volatility_premium_bps, hedge_cost_bps, risk_policy_version,
          status, signature, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
           $14, $15, $16, $17, $18, $19, $20, $21, 'signed', $22, now(), now())
         ON CONFLICT (id) DO UPDATE SET
           chain_id = EXCLUDED.chain_id,
           user_address = EXCLUDED.user_address,
           token_in = EXCLUDED.token_in,
           token_out = EXCLUDED.token_out,
           amount_in = EXCLUDED.amount_in,
           slippage_bps = EXCLUDED.slippage_bps,
           amount_out = EXCLUDED.amount_out,
           min_amount_out = EXCLUDED.min_amount_out,
           nonce = EXCLUDED.nonce,
           deadline = EXCLUDED.deadline,
           snapshot_id = EXCLUDED.snapshot_id,
           pricing_version = EXCLUDED.pricing_version,
           spread_bps = EXCLUDED.spread_bps,
           size_impact_bps = EXCLUDED.size_impact_bps,
           market_spread_bps = EXCLUDED.market_spread_bps,
           inventory_skew_bps = EXCLUDED.inventory_skew_bps,
           volatility_premium_bps = EXCLUDED.volatility_premium_bps,
           hedge_cost_bps = EXCLUDED.hedge_cost_bps,
           risk_policy_version = EXCLUDED.risk_policy_version,
           status = 'signed',
           signature = EXCLUDED.signature,
           updated_at = now()
         WHERE quotes.status = 'requested'
           AND quotes.principal_id = EXCLUDED.principal_id
        `,
        [
          quoteId, input.principalId, chainId, user, tokenIn, tokenOut, amountIn,
          input.slippageBps, amountOut, minAmountOut, nonce, deadline,
          input.snapshotId, input.pricingVersion, input.spreadBps,
          input.sizeImpactBps, input.marketSpreadBps, input.inventorySkewBps,
          input.volatilityPremiumBps, input.hedgeCostBps,
          input.riskPolicyVersion, input.signature,
        ],
      );
      if (result.rowCount === 0) {
        const current = await findQuoteRecordById(client, quoteId);
        if (!current) {
          throw new Error(`Quote ${quoteId} signed quote conflict could not be resolved`);
        }
        if (current.nonce && !isSameSignedQuoteIdentity(current, quote)) {
          throw new Error(`Signed quote identity cannot be changed for ${quoteId}`);
        }
        assertCanSaveSignedQuote(current, input);
      }
    } finally {
      client.release();
    }
  }

  async findStatus(quoteId: string, principalId?: string): Promise<QuoteStatusResponse | undefined> {
    if (principalId !== undefined) assertPrincipalId(principalId, "Postgres quote status principalId");
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT ${quoteSelectColumns} FROM quotes WHERE id = $1${principalId === undefined ? "" : " AND principal_id = $2"}`,
        principalId === undefined ? [quoteId] : [quoteId, principalId],
      );
      if (!result.rowCount) return undefined;

      return quoteStatusResponseFromRow(result.rows[0]);
    } finally {
      client.release();
    }
  }

  async findPrincipalId(quoteId: string): Promise<string | undefined> {
    assertSafeIdentifier(quoteId, "quoteId", "Quote ownership");
    const client = await this.pool.connect();
    try {
      const result = await client.query("SELECT principal_id FROM quotes WHERE id = $1", [quoteId]);
      if (!result.rowCount) return undefined;
      const principalId = result.rows[0]?.principal_id;
      assertPrincipalId(principalId, "Postgres quote row principal_id");
      return principalId;
    } finally {
      client.release();
    }
  }

  async markFailed(quoteId: string, errorCode: string): Promise<void> {
    assertNonEmptyString(errorCode, "errorCode", "Failed quote");

    const client = await this.pool.connect();
    try {
      const updated = await client.query(
        `UPDATE quotes
         SET status = 'failed', reject_code = $2, updated_at = now()
         WHERE id = $1 AND status IN ('requested', 'signed')`,
        [quoteId, errorCode],
      );
      if (updated.rowCount === 1) {
        return;
      }
      if (updated.rowCount !== 0) {
        throw new Error(`Quote ${quoteId} failed transition updated multiple rows`);
      }

      const current = await findQuoteRecordById(client, quoteId);
      if (!current) return;
      assertCanMarkFailed(current, errorCode);
    } finally {
      client.release();
    }
  }

  async markStatus(
    quoteId: string,
    status: QuoteLifecycleStatus,
    metadata?: QuoteStatusMetadata,
  ): Promise<void> {
    assertQuoteStatusMetadata(metadata);
    const normalizedMetadata = normalizeQuoteStatusMetadata(metadata);
    const client = await this.pool.connect();
    try {
      const current = await findQuoteRecordById(client, quoteId);
      if (!current) return;
      assertStatusTransition(current, status);
      assertQuoteStatusMetadataDoesNotConflict(current, normalizedMetadata);
      assertNonSettlementStatusMetadata(current, status, normalizedMetadata);
      assertSettlementStatusMetadata(current, status, normalizedMetadata);

      const updates: string[] = ["status = $2", "updated_at = now()"];
      const params: unknown[] = [quoteId, status];
      let paramIndex = 3;

      if (normalizedMetadata?.txHash !== undefined) {
        updates.push(`tx_hash = $${paramIndex++}`);
        params.push(normalizedMetadata.txHash);
      }
      if (normalizedMetadata?.settlementEventId !== undefined) {
        updates.push(`settlement_event_id = $${paramIndex++}`);
        params.push(normalizedMetadata.settlementEventId);
      }
      if (normalizedMetadata?.hedgeOrderId !== undefined) {
        updates.push(`hedge_order_id = $${paramIndex++}`);
        params.push(normalizedMetadata.hedgeOrderId);
      }
      if (normalizedMetadata?.pnlId !== undefined) {
        updates.push(`pnl_id = $${paramIndex++}`);
        params.push(normalizedMetadata.pnlId);
      }

      const expectedStatusIndex = paramIndex++;
      params.push(current.status);
      const expectedTxHashIndex = paramIndex++;
      params.push(current.txHash ?? null);
      const expectedSettlementEventIdIndex = paramIndex++;
      params.push(current.settlementEventId ?? null);
      const expectedHedgeOrderIdIndex = paramIndex++;
      params.push(current.hedgeOrderId ?? null);
      const expectedPnlIdIndex = paramIndex;
      params.push(current.pnlId ?? null);

      const result = await client.query(
        `UPDATE quotes SET ${updates.join(", ")}
         WHERE id = $1
           AND status = $${expectedStatusIndex}
           AND tx_hash IS NOT DISTINCT FROM $${expectedTxHashIndex}
           AND settlement_event_id IS NOT DISTINCT FROM $${expectedSettlementEventIdIndex}
           AND hedge_order_id IS NOT DISTINCT FROM $${expectedHedgeOrderIdIndex}
           AND pnl_id IS NOT DISTINCT FROM $${expectedPnlIdIndex}`,
        params,
      );
      if (result.rowCount !== 1) {
        throw new Error(`Quote ${quoteId} status update conflict`);
      }
    } finally {
      client.release();
    }
  }

  async restoreSettlementStatus(quoteId: string, metadata: QuoteStatusMetadata): Promise<void> {
    assertQuoteStatusMetadata(metadata);
    const normalizedMetadata = normalizeQuoteStatusMetadata(metadata);
    const client = await this.pool.connect();
    try {
      const current = await findQuoteRecordById(client, quoteId);
      if (!current) return;
      if (current.status !== "expired") {
        assertStatusTransition(current, "settled");
      }

      assertQuoteStatusMetadataDoesNotConflict(current, normalizedMetadata);
      assertSettlementStatusMetadata(current, "settled", normalizedMetadata);

      const updates: string[] = ["status = 'settled'", "updated_at = now()"];
      const params: unknown[] = [quoteId];
      let paramIndex = 2;
      if (normalizedMetadata?.txHash !== undefined) {
        updates.push(`tx_hash = $${paramIndex++}`);
        params.push(normalizedMetadata.txHash);
      }
      if (normalizedMetadata?.settlementEventId !== undefined) {
        updates.push(`settlement_event_id = $${paramIndex++}`);
        params.push(normalizedMetadata.settlementEventId);
      }
      if (normalizedMetadata?.hedgeOrderId !== undefined) {
        updates.push(`hedge_order_id = $${paramIndex++}`);
        params.push(normalizedMetadata.hedgeOrderId);
      }
      if (normalizedMetadata?.pnlId !== undefined) {
        updates.push(`pnl_id = $${paramIndex++}`);
        params.push(normalizedMetadata.pnlId);
      }
      const expectedStatusIndex = paramIndex;
      params.push(current.status);
      const expectedTxHashIndex = ++paramIndex;
      params.push(current.txHash ?? null);
      const expectedSettlementEventIdIndex = ++paramIndex;
      params.push(current.settlementEventId ?? null);
      const expectedHedgeOrderIdIndex = ++paramIndex;
      params.push(current.hedgeOrderId ?? null);
      const expectedPnlIdIndex = ++paramIndex;
      params.push(current.pnlId ?? null);

      const result = await client.query(
        `UPDATE quotes SET ${updates.join(", ")}
         WHERE id = $1
           AND status = $${expectedStatusIndex}
           AND tx_hash IS NOT DISTINCT FROM $${expectedTxHashIndex}
           AND settlement_event_id IS NOT DISTINCT FROM $${expectedSettlementEventIdIndex}
           AND hedge_order_id IS NOT DISTINCT FROM $${expectedHedgeOrderIdIndex}
           AND pnl_id IS NOT DISTINCT FROM $${expectedPnlIdIndex}`,
        params,
      );
      if (result.rowCount !== 1) {
        throw new Error(`Quote ${quoteId} canonical settlement restoration conflict`);
      }
    } finally {
      client.release();
    }
  }

  async clearSettlementStatus(input: ClearSettlementStatusInput): Promise<ClearSettlementStatusResult> {
    const normalizedInput = normalizeClearSettlementStatusInput(input);
    const { quoteId, txHash, settlementEventId, nowSeconds } = normalizedInput;

    const client = await this.pool.connect();
    try {
      const cleared = await client.query(
        `UPDATE quotes
         SET status = CASE WHEN deadline <= $4 THEN 'expired' ELSE 'signed' END,
             tx_hash = NULL,
             settlement_event_id = NULL,
             hedge_order_id = NULL,
             pnl_id = NULL,
             updated_at = now()
         WHERE id = $1
           AND status IN ('submitted', 'settled')
           AND lower(tx_hash) = $2
           AND settlement_event_id = $3
         RETURNING ${quoteSelectColumns}`,
        [quoteId, txHash, settlementEventId, nowSeconds],
      );
      if (cleared.rowCount === 1) {
        return { status: quoteStatusResponseFromRow(cleared.rows[0]), cleared: true };
      }
      if (cleared.rowCount !== 0) {
        throw new Error(`Quote ${quoteId} settlement status removal updated multiple rows`);
      }

      const existing = await client.query(
        `SELECT ${quoteSelectColumns} FROM quotes WHERE id = $1`,
        [quoteId],
      );
      if (!existing.rowCount) return { cleared: false };
      const row = existing.rows[0];
      if (!row.tx_hash && !row.settlement_event_id) {
        return { status: quoteStatusResponseFromRow(row), cleared: false };
      }

      if (row.status !== "submitted" && row.status !== "settled") {
        throw new Error(`Quote ${quoteId} cannot clear settlement status from ${row.status}`);
      }
      if (row.tx_hash?.toLowerCase() !== txHash || row.settlement_event_id !== settlementEventId) {
        throw new Error(`Quote ${quoteId} settlement status removal conflict`);
      }
      throw new Error(`Quote ${quoteId} settlement status removal conflict`);
    } finally {
      client.release();
    }
  }

  async findQuoteIdByChainUserNonce(
    chainId: number,
    user: Address,
    nonce: UIntString,
  ): Promise<string | undefined> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT id FROM quotes WHERE chain_id = $1 AND lower(user_address) = $2 AND nonce = $3 AND nonce IS NOT NULL`,
        [chainId, user.toLowerCase(), nonce],
      );
      return result.rowCount ? result.rows[0].id : undefined;
    } finally {
      client.release();
    }
  }

  async findSignedQuoteByQuoteId(quoteId: string, principalId?: string): Promise<QuoteRecord | undefined> {
    if (principalId !== undefined) assertPrincipalId(principalId, "Postgres signed quote principalId");
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT ${quoteSelectColumns} FROM quotes WHERE id = $1
         ${principalId === undefined ? "" : "AND principal_id = $2"}
         AND nonce IS NOT NULL
         AND amount_out IS NOT NULL
         AND min_amount_out IS NOT NULL
         AND deadline IS NOT NULL
         AND signature IS NOT NULL
         AND spread_bps IS NOT NULL
         AND size_impact_bps IS NOT NULL
         AND market_spread_bps IS NOT NULL
         AND inventory_skew_bps IS NOT NULL
         AND volatility_premium_bps IS NOT NULL
         AND hedge_cost_bps IS NOT NULL`,
        principalId === undefined ? [quoteId] : [quoteId, principalId],
      );
      if (!result.rowCount) return undefined;

      return quoteRecordFromRow(result.rows[0]);
    } finally {
      client.release();
    }
  }

  async findSignedQuoteByChainUserNonce(
    chainId: number,
    user: Address,
    nonce: UIntString,
    principalId?: string,
  ): Promise<QuoteRecord | undefined> {
    const quoteId = await this.findQuoteIdByChainUserNonce(chainId, user, nonce);
    if (!quoteId) return undefined;

    return this.findSignedQuoteByQuoteId(quoteId, principalId);
  }
}
