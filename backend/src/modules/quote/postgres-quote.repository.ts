import pg from "pg";
import type {
  QuoteRecord,
  QuoteStatusMetadata,
  SaveRequestedQuoteInput,
  SaveRejectedQuoteInput,
  SaveSignedQuoteInput,
  QuoteRepository,
  ClearSettlementStatusInput,
  ClearSettlementStatusResult,
} from "./quote.repository.js";
import type {
  Address,
  QuoteLifecycleStatus,
  QuoteStatusResponse,
  SignedQuote,
  UIntString,
} from "../../shared/types/rfq.js";

const SECP256K1N_HALF = BigInt("0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0");
const maxSafeIdentifierLength = 128;
const safeIdentifierPattern = /^[A-Za-z0-9_:-]+$/;

const quoteSelectColumns = [
  "id AS quote_id",
  "chain_id",
  "user_address AS user",
  "token_in",
  "token_out",
  "amount_in",
  "slippage_bps",
  "amount_out",
  "min_amount_out",
  "nonce",
  "deadline",
  "snapshot_id",
  "pricing_version",
  "spread_bps",
  "size_impact_bps",
  "inventory_skew_bps",
  "risk_policy_version",
  "status",
  "signature",
  "reject_code",
  "tx_hash",
  "settlement_event_id",
  "hedge_order_id",
  "pnl_id",
].join(", ");

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
    const quoteId = assertNonEmptyString(input.quoteId, "quoteId");
    const chainId = assertPositiveSafeInteger(input.request.chainId, "chainId");
    const user = assertAddress(input.request.user, "user");
    const tokenIn = assertAddress(input.request.tokenIn, "tokenIn");
    const tokenOut = assertAddress(input.request.tokenOut, "tokenOut");
    const amountIn = assertPositiveUIntString(input.request.amountIn, "amountIn");
    const slippageBps = assertNonNegativeBps(input.request.slippageBps, "slippageBps");
    const snapshotId = assertNonEmptyString(input.snapshotId, "snapshotId");
    assertDistinctTokens(tokenIn, tokenOut);

    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `INSERT INTO quotes (id, chain_id, user_address, token_in, token_out, amount_in,
          slippage_bps, snapshot_id, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'requested', now(), now())
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
           AND quotes.chain_id = EXCLUDED.chain_id
           AND lower(quotes.user_address) = lower(EXCLUDED.user_address)
           AND lower(quotes.token_in) = lower(EXCLUDED.token_in)
           AND lower(quotes.token_out) = lower(EXCLUDED.token_out)
           AND quotes.amount_in = EXCLUDED.amount_in
           AND quotes.slippage_bps = EXCLUDED.slippage_bps
           AND quotes.snapshot_id = EXCLUDED.snapshot_id
        `,
        [quoteId, chainId, user, tokenIn, tokenOut, amountIn, slippageBps, snapshotId],
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

  async saveRejected(input: SaveRejectedQuoteInput): Promise<void> {
    const quoteId = assertNonEmptyString(input.quoteId, "quoteId");
    const chainId = assertPositiveSafeInteger(input.request.chainId, "chainId");
    const user = assertAddress(input.request.user, "user");
    const tokenIn = assertAddress(input.request.tokenIn, "tokenIn");
    const tokenOut = assertAddress(input.request.tokenOut, "tokenOut");
    const amountIn = assertPositiveUIntString(input.request.amountIn, "amountIn");
    const slippageBps = assertNonNegativeBps(input.request.slippageBps, "slippageBps");
    const snapshotId = assertNonEmptyString(input.snapshotId, "snapshotId");
    const rejectCode = assertNonEmptyString(input.rejectCode, "rejectCode");
    if (input.riskPolicyVersion !== undefined) {
      assertNonEmptyString(input.riskPolicyVersion, "riskPolicyVersion");
    }
    assertDistinctTokens(tokenIn, tokenOut);

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
        `INSERT INTO quotes (id, chain_id, user_address, token_in, token_out, amount_in,
          slippage_bps, amount_out, min_amount_out, nonce, deadline, snapshot_id,
          pricing_version, spread_bps, size_impact_bps, inventory_skew_bps,
          risk_policy_version, status, signature, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
           $13, $14, $15, $16, $17, 'signed', $18, now(), now())
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
           inventory_skew_bps = EXCLUDED.inventory_skew_bps,
           risk_policy_version = EXCLUDED.risk_policy_version,
           status = 'signed',
           signature = EXCLUDED.signature,
           updated_at = now()
         WHERE quotes.status = 'requested'
        `,
        [
          quoteId, chainId, user, tokenIn, tokenOut, amountIn,
          input.slippageBps, amountOut, minAmountOut, nonce, deadline,
          input.snapshotId, input.pricingVersion, input.spreadBps,
          input.sizeImpactBps, input.inventorySkewBps,
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

  async findStatus(quoteId: string): Promise<QuoteStatusResponse | undefined> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT ${quoteSelectColumns} FROM quotes WHERE id = $1`,
        [quoteId],
      );
      if (!result.rowCount) return undefined;

      return quoteStatusResponseFromRow(result.rows[0]);
    } finally {
      client.release();
    }
  }

  async markFailed(quoteId: string, errorCode: string): Promise<void> {
    assertNonEmptyString(errorCode, "errorCode");

    const client = await this.pool.connect();
    try {
      const existing = await client.query(
        "SELECT status, reject_code FROM quotes WHERE id = $1",
        [quoteId],
      );
      if (!existing.rowCount) return;

      const row = existing.rows[0];
      if (row.status === "failed") {
        if (row.reject_code === errorCode) return;
        throw new Error(`Failed quote errorCode cannot be changed for ${quoteId}`);
      }

      if (row.status === "requested" || row.status === "signed") {
        await client.query(
          "UPDATE quotes SET status = 'failed', reject_code = $2, updated_at = now() WHERE id = $1",
          [quoteId, errorCode],
        );
        return;
      }

      throw new Error(`Quote ${quoteId} cannot transition from ${row.status} to failed`);
    } finally {
      client.release();
    }
  }

  async markStatus(
    quoteId: string,
    status: QuoteLifecycleStatus,
    metadata?: QuoteStatusMetadata,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      const existing = await client.query(
        "SELECT status, tx_hash, settlement_event_id, hedge_order_id, pnl_id FROM quotes WHERE id = $1",
        [quoteId],
      );
      if (!existing.rowCount) return;

      const row = existing.rows[0];
      assertStatusTransition(row.status, status);

      // Validate metadata
      const meta = normalizeMetadata(metadata);
      assertMetadataDoesNotConflict(row, meta);
      assertSettlementStatusFields(row, status, meta);

      // Build update
      const updates: string[] = ["status = $2", "updated_at = now()"];
      const params: unknown[] = [quoteId, status];
      let paramIndex = 3;

      if (meta?.txHash !== undefined) {
        updates.push(`tx_hash = $${paramIndex++}`);
        params.push(meta.txHash.toLowerCase());
      }
      if (meta?.settlementEventId !== undefined) {
        updates.push(`settlement_event_id = $${paramIndex++}`);
        params.push(meta.settlementEventId);
      }
      if (meta?.hedgeOrderId !== undefined) {
        updates.push(`hedge_order_id = $${paramIndex++}`);
        params.push(meta.hedgeOrderId);
      }
      if (meta?.pnlId !== undefined) {
        updates.push(`pnl_id = $${paramIndex++}`);
        params.push(meta.pnlId);
      }

      await client.query(
        `UPDATE quotes SET ${updates.join(", ")} WHERE id = $1`,
        params,
      );
    } finally {
      client.release();
    }
  }

  async clearSettlementStatus(input: ClearSettlementStatusInput): Promise<ClearSettlementStatusResult> {
    const quoteId = input.quoteId;
    const txHash = input.txHash.toLowerCase();
    const settlementEventId = input.settlementEventId;
    const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000);

    const client = await this.pool.connect();
    try {
      const existing = await client.query(
        "SELECT status, tx_hash, settlement_event_id, deadline FROM quotes WHERE id = $1",
        [quoteId],
      );
      if (!existing.rowCount) {
        return { cleared: false };
      }

      const row = existing.rows[0];
      if (!row.tx_hash && !row.settlement_event_id) {
        const status = await this.findStatus(quoteId);
        return { status, cleared: false };
      }

      if (row.status !== "submitted" && row.status !== "settled") {
        throw new Error(`Quote ${quoteId} cannot clear settlement status from ${row.status}`);
      }
      if (row.tx_hash?.toLowerCase() !== txHash || row.settlement_event_id !== settlementEventId) {
        throw new Error(`Quote ${quoteId} settlement status removal conflict`);
      }

      const newStatus = row.deadline && row.deadline <= nowSeconds ? "expired" : "signed";

      await client.query(
        `UPDATE quotes SET status = $2, tx_hash = NULL, settlement_event_id = NULL,
          hedge_order_id = NULL, pnl_id = NULL, updated_at = now()
         WHERE id = $1`,
        [quoteId, newStatus],
      );

      const status = await this.findStatus(quoteId);
      return { status, cleared: true };
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

  async findSignedQuoteByQuoteId(quoteId: string): Promise<QuoteRecord | undefined> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT ${quoteSelectColumns} FROM quotes WHERE id = $1
         AND nonce IS NOT NULL
         AND amount_out IS NOT NULL
         AND min_amount_out IS NOT NULL
         AND deadline IS NOT NULL
         AND signature IS NOT NULL
         AND spread_bps IS NOT NULL
         AND size_impact_bps IS NOT NULL
         AND inventory_skew_bps IS NOT NULL`,
        [quoteId],
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
  ): Promise<QuoteRecord | undefined> {
    const quoteId = await this.findQuoteIdByChainUserNonce(chainId, user, nonce);
    if (!quoteId) return undefined;

    return this.findSignedQuoteByQuoteId(quoteId);
  }
}

// --- Row mappers ---

async function findQuoteRecordById(client: pg.PoolClient, quoteId: string): Promise<QuoteRecord | undefined> {
  const result = await client.query(
    `SELECT ${quoteSelectColumns} FROM quotes WHERE id = $1`,
    [quoteId],
  );
  if (!result.rowCount) return undefined;

  return quoteRecordFromRow(result.rows[0]);
}

function quoteStatusResponseFromRow(row: Record<string, unknown>): QuoteStatusResponse {
  return {
    quoteId: String(row.quote_id),
    status: String(row.status) as QuoteStatusResponse["status"],
    snapshotId: row.snapshot_id != null ? String(row.snapshot_id) : undefined,
    deadline: row.deadline != null ? Number(row.deadline) : undefined,
    txHash: row.tx_hash != null ? String(row.tx_hash) as `0x${string}` : undefined,
    settlementEventId: row.settlement_event_id != null ? String(row.settlement_event_id) : undefined,
    hedgeOrderId: row.hedge_order_id != null ? String(row.hedge_order_id) : undefined,
    pnlId: row.pnl_id != null ? String(row.pnl_id) : undefined,
    errorCode: row.reject_code != null ? String(row.reject_code) : undefined,
  };
}

function quoteRecordFromRow(row: Record<string, unknown>): QuoteRecord {
  return {
    quoteId: String(row.quote_id),
    chainId: Number(row.chain_id),
    user: String(row.user) as Address,
    tokenIn: String(row.token_in) as Address,
    tokenOut: String(row.token_out) as Address,
    amountIn: String(row.amount_in),
    slippageBps: Number(row.slippage_bps),
    amountOut: row.amount_out != null ? String(row.amount_out) : undefined,
    minAmountOut: row.min_amount_out != null ? String(row.min_amount_out) : undefined,
    nonce: row.nonce != null ? String(row.nonce) : undefined,
    deadline: row.deadline != null ? Number(row.deadline) : undefined,
    snapshotId: row.snapshot_id != null ? String(row.snapshot_id) : undefined,
    pricingVersion: row.pricing_version != null ? String(row.pricing_version) : undefined,
    spreadBps: row.spread_bps != null ? Number(row.spread_bps) : undefined,
    sizeImpactBps: row.size_impact_bps != null ? Number(row.size_impact_bps) : undefined,
    inventorySkewBps: row.inventory_skew_bps != null ? Number(row.inventory_skew_bps) : undefined,
    riskPolicyVersion: row.risk_policy_version != null ? String(row.risk_policy_version) : undefined,
    status: String(row.status) as QuoteRecord["status"],
    signature: row.signature != null ? String(row.signature) as `0x${string}` : undefined,
    rejectCode: row.reject_code != null ? String(row.reject_code) : undefined,
    txHash: row.tx_hash != null ? String(row.tx_hash) as `0x${string}` : undefined,
    settlementEventId: row.settlement_event_id != null ? String(row.settlement_event_id) : undefined,
    hedgeOrderId: row.hedge_order_id != null ? String(row.hedge_order_id) : undefined,
    pnlId: row.pnl_id != null ? String(row.pnl_id) : undefined,
  };
}

function assertCanSaveRequestedQuote(record: QuoteRecord, input: SaveRequestedQuoteInput): void {
  if (record.status === "requested") {
    if (isSameRequestedQuotePayload(record, input)) {
      return;
    }

    throw new Error(`Requested quote payload cannot be changed for ${input.quoteId}`);
  }

  throw new Error(`Quote ${input.quoteId} cannot save requested quote from ${record.status}`);
}

function assertCanSaveRejectedQuote(record: QuoteRecord, input: SaveRejectedQuoteInput): void {
  if (record.status === "requested") {
    if (isSameRequestedQuotePayload(record, input)) {
      return;
    }

    throw new Error(`Rejected quote request cannot differ from requested quote ${input.quoteId}`);
  }

  if (record.status === "rejected") {
    if (isSameRejectedQuotePayload(record, input)) {
      return;
    }

    throw new Error(`Rejected quote payload cannot be changed for ${input.quoteId}`);
  }

  throw new Error(`Quote ${input.quoteId} cannot save rejected quote from ${record.status}`);
}

function assertCanSaveSignedQuote(record: QuoteRecord, input: SaveSignedQuoteInput): void {
  if (record.status === "requested") {
    if (isSameRequestedQuotePayloadAsSigned(record, input)) {
      return;
    }

    throw new Error(`Signed quote request cannot differ from requested quote ${input.quoteId}`);
  }

  if (record.status === "signed") {
    if (isSameSignedQuotePayload(record, input)) {
      return;
    }

    throw new Error(`Signed quote payload cannot be changed for ${input.quoteId}`);
  }

  throw new Error(`Quote ${input.quoteId} cannot save signed quote from ${record.status}`);
}

function isSameRequestedQuotePayload(record: QuoteRecord, input: SaveRequestedQuoteInput | SaveRejectedQuoteInput): boolean {
  return (
    record.quoteId === input.quoteId &&
    record.chainId === input.request.chainId &&
    record.user.toLowerCase() === input.request.user.toLowerCase() &&
    record.tokenIn.toLowerCase() === input.request.tokenIn.toLowerCase() &&
    record.tokenOut.toLowerCase() === input.request.tokenOut.toLowerCase() &&
    record.amountIn === input.request.amountIn &&
    record.slippageBps === input.request.slippageBps &&
    record.snapshotId === input.snapshotId
  );
}

function isSameRejectedQuotePayload(record: QuoteRecord, input: SaveRejectedQuoteInput): boolean {
  return (
    isSameRequestedQuotePayload(record, input) &&
    record.rejectCode === input.rejectCode &&
    record.riskPolicyVersion === input.riskPolicyVersion
  );
}

function isSameRequestedQuotePayloadAsSigned(record: QuoteRecord, input: SaveSignedQuoteInput): boolean {
  return (
    record.quoteId === input.quoteId &&
    record.chainId === input.quote.chainId &&
    record.user.toLowerCase() === input.quote.user.toLowerCase() &&
    record.tokenIn.toLowerCase() === input.quote.tokenIn.toLowerCase() &&
    record.tokenOut.toLowerCase() === input.quote.tokenOut.toLowerCase() &&
    record.amountIn === input.quote.amountIn &&
    record.slippageBps === input.slippageBps &&
    record.snapshotId === input.snapshotId
  );
}

function isSameSignedQuotePayload(record: QuoteRecord, input: SaveSignedQuoteInput): boolean {
  return (
    record.quoteId === input.quoteId &&
    record.chainId === input.quote.chainId &&
    record.user.toLowerCase() === input.quote.user.toLowerCase() &&
    record.tokenIn.toLowerCase() === input.quote.tokenIn.toLowerCase() &&
    record.tokenOut.toLowerCase() === input.quote.tokenOut.toLowerCase() &&
    record.amountIn === input.quote.amountIn &&
    record.slippageBps === input.slippageBps &&
    record.amountOut === input.quote.amountOut &&
    record.minAmountOut === input.quote.minAmountOut &&
    record.nonce === input.quote.nonce &&
    record.deadline === input.quote.deadline &&
    record.snapshotId === input.snapshotId &&
    record.pricingVersion === input.pricingVersion &&
    record.spreadBps === input.spreadBps &&
    record.sizeImpactBps === input.sizeImpactBps &&
    record.inventorySkewBps === input.inventorySkewBps &&
    record.riskPolicyVersion === input.riskPolicyVersion &&
    record.signature?.toLowerCase() === input.signature.toLowerCase()
  );
}

function isSameSignedQuoteIdentity(record: QuoteRecord, quote: SignedQuote): boolean {
  return (
    record.chainId === quote.chainId &&
    record.user.toLowerCase() === quote.user.toLowerCase() &&
    record.nonce === quote.nonce
  );
}

// --- State machine validation ---

function assertStatusTransition(currentStatus: string, nextStatus: string): void {
  if (currentStatus === "expired" && nextStatus !== "expired") {
    throw new Error(`Quote cannot transition from terminal status expired to ${nextStatus}`);
  }
  if (currentStatus === "failed" || currentStatus === "rejected") {
    throw new Error(`Quote cannot transition from terminal status ${currentStatus} to ${nextStatus}`);
  }
  if (currentStatus === "signed" && !["submitted", "settled", "expired"].includes(nextStatus)) {
    throw new Error(`Quote cannot transition from signed to ${nextStatus}`);
  }
  if (currentStatus === "submitted" && nextStatus !== "settled") {
    throw new Error(`Quote cannot transition from submitted to ${nextStatus}`);
  }
  if (currentStatus === "settled" && nextStatus !== "settled") {
    throw new Error(`Quote cannot transition from settled to ${nextStatus}`);
  }
}

function normalizeMetadata(metadata: QuoteStatusMetadata | undefined): QuoteStatusMetadata | undefined {
  if (!metadata) return undefined;
  return {
    ...metadata,
    txHash: metadata.txHash?.toLowerCase() as `0x${string}` | undefined,
  };
}

function assertMetadataDoesNotConflict(
  row: Record<string, unknown>,
  metadata: QuoteStatusMetadata | undefined,
): void {
  if (!metadata) return;

  if (row.tx_hash && metadata.txHash && String(row.tx_hash).toLowerCase() !== metadata.txHash.toLowerCase()) {
    throw new Error("Quote status txHash cannot be changed once set");
  }
  if (row.settlement_event_id && metadata.settlementEventId && row.settlement_event_id !== metadata.settlementEventId) {
    throw new Error("Quote status settlementEventId cannot be changed once set");
  }
  if (row.hedge_order_id && metadata.hedgeOrderId && row.hedge_order_id !== metadata.hedgeOrderId) {
    throw new Error("Quote status hedgeOrderId cannot be changed once set");
  }
  if (row.pnl_id && metadata.pnlId && row.pnl_id !== metadata.pnlId) {
    throw new Error("Quote status pnlId cannot be changed once set");
  }
}

function assertSettlementStatusFields(
  row: Record<string, unknown>,
  status: string,
  metadata: QuoteStatusMetadata | undefined,
): void {
  if (status !== "submitted" && status !== "settled") {
    if (metadata?.txHash !== undefined || metadata?.settlementEventId !== undefined ||
        metadata?.hedgeOrderId !== undefined || metadata?.pnlId !== undefined) {
      throw new Error(`Quote ${row.id} ${status} status must not include settlement metadata`);
    }
    return;
  }

  const txHash = metadata?.txHash ?? (row.tx_hash != null ? String(row.tx_hash) : undefined);
  const settlementEventId = metadata?.settlementEventId ?? (row.settlement_event_id != null ? String(row.settlement_event_id) : undefined);

  if (txHash === undefined) {
    throw new Error(`Quote ${row.id} ${status} status requires txHash`);
  }
  if (settlementEventId === undefined) {
    throw new Error(`Quote ${row.id} ${status} status requires settlementEventId`);
  }
}

// --- Input validation ---

function assertSignedQuoteInput(input: SaveSignedQuoteInput): void {
  assertNonEmptyString(input.quoteId, "quoteId");
  assertNonEmptyString(input.snapshotId, "snapshotId");
  assertNonEmptyString(input.pricingVersion, "pricingVersion");
  assertNonEmptyString(input.riskPolicyVersion, "riskPolicyVersion");
  assertNonNegativeBps(input.slippageBps, "slippageBps");
  assertNonNegativeBps(input.spreadBps, "spreadBps");
  assertNonNegativeBps(input.sizeImpactBps, "sizeImpactBps");
  assertBpsMagnitude(input.inventorySkewBps, "inventorySkewBps");
  assertSignature(input.signature);

  const q = input.quote;
  assertPositiveSafeInteger(q.chainId, "chainId");
  assertAddress(q.user, "user");
  assertAddress(q.tokenIn, "tokenIn");
  assertAddress(q.tokenOut, "tokenOut");
  assertDistinctTokens(q.tokenIn, q.tokenOut);
  assertPositiveUIntString(q.amountIn, "amountIn");
  assertPositiveUIntString(q.amountOut, "amountOut");
  assertPositiveUIntString(q.minAmountOut, "minAmountOut");
  assertPositiveUIntString(q.nonce, "nonce");
  assertPositiveSafeInteger(q.deadline, "deadline");

  if (BigInt(q.amountOut) < BigInt(q.minAmountOut)) {
    throw new Error("Signed quote amountOut must be greater than or equal to minAmountOut");
  }
}

// --- Validation helpers ---

function assertNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Postgres quote ${field} must be a non-empty string`);
  }
  return value.trim();
}

function assertAddress(value: unknown, field: string): `0x${string}` {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`Postgres quote ${field} must be a 20-byte hex address`);
  }
  return value.toLowerCase() as `0x${string}`;
}

function assertPositiveSafeInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Postgres quote ${field} must be a positive safe integer`);
  }
  return value;
}

function assertPositiveUIntString(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`Postgres quote ${field} must be a positive uint string`);
  }
  return value;
}

function assertNonNegativeBps(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 10000) {
    throw new Error(`Postgres quote ${field} must be a non-negative bps integer`);
  }
  return value;
}

function assertBpsMagnitude(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || Math.abs(value) > 10000) {
    throw new Error(`Postgres quote ${field} must be a safe bps integer`);
  }
  return value;
}

function assertSignature(value: unknown): void {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(value)) {
    throw new Error("Postgres quote signature must be a 65-byte hex string");
  }
  const s = BigInt(`0x${value.slice(66, 130)}`);
  if (s > SECP256K1N_HALF) {
    throw new Error("Postgres quote signature s value must be in the lower half order");
  }
  const v = Number.parseInt(value.slice(130, 132), 16);
  const normalizedV = v < 27 ? v + 27 : v;
  if (normalizedV !== 27 && normalizedV !== 28) {
    throw new Error("Postgres quote signature v value must be 27 or 28");
  }
}

function assertDistinctTokens(tokenIn: string, tokenOut: string): void {
  if (tokenIn.toLowerCase() === tokenOut.toLowerCase()) {
    throw new Error("Postgres quote token pair must contain distinct tokens");
  }
}
