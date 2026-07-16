import pg from "pg";
import {
  hedgeFillNetPnlModelDescription,
  type Address,
  type HedgeNetPnlSummary,
  type HedgeNetPnlTotal,
  type PaginatedPnlSummaryResponse,
  type PnlSummaryResponse,
  type PnlTokenTotal,
  type PnlTradeRecord,
} from "../../shared/types/rfq.js";
import { assertPrincipalId } from "../../shared/validation/principal-id.js";
import {
  buildPnlSummary,
  buildPaginatedPnlSummary,
  buildPnlTradeRecord,
  clonePnlTradeRecord,
  matchesPnlInput,
  normalizeRemovePnlRecordInput,
  type PnlStore,
  type PnlValuationProvider,
  type RecordPnlInput,
  type RemovePnlRecordInput,
  type RemovePnlRecordResult,
} from "./pnl.service.js";
import { assertPnlPageRequest, type PnlPageRequest } from "./pnl-pagination.js";
import {
  normalizeSignedDecimal,
  parseAddress,
  parseHedgeNetPnlRow,
  parseIntString,
  parsePnlRow,
  parsePositiveSafeInteger,
  parseSafeInteger,
  parseTimestamp,
  parseVenueAsset,
  pnlAttributionMatches,
} from "./postgres-pnl-record.js";

const pnlColumns = `
  id, quote_id, settlement_event_id, snapshot_id, chain_id, user_address, token_in, token_out,
  amount_in, amount_out, min_amount_out, nonce, deadline,
  mid_price, token_in_decimals, token_out_decimals, fair_amount_out, valuation_observed_at,
  gross_pnl_token_out, gross_pnl_bps, model, model_description, realized_at
`;
const qualifiedPnlColumns = pnlColumns
  .split(",")
  .map((column) => `pnl.${column.trim()}`)
  .join(", ");
const hedgeNetColumns = `
  hedge.id AS hedge_order_id,
  hedge.status AS hedge_status,
  hedge.filled_amount::text AS hedge_filled_amount,
  hedge.fee_reconciliation_status AS hedge_fee_reconciliation_status,
  hedge.route_accounting_version AS hedge_route_accounting_version,
  hedge.venue_quote_asset AS hedge_valuation_asset,
  hedge.venue_quote_token_address AS hedge_valuation_token,
  hedge.hedge_net_pnl_model AS hedge_net_model,
  hedge.hedge_net_pnl_model_description AS hedge_net_model_description,
  hedge.hedge_net_pnl_status AS hedge_net_status,
  hedge.hedge_net_pnl_quote_quantity::text AS hedge_net_quantity,
  hedge.hedge_net_pnl_reason_code AS hedge_net_reason_code,
  hedge.hedge_unvalued_commission_assets AS hedge_unvalued_commission_assets,
  hedge.hedge_net_pnl_realized_at AS hedge_net_realized_at
`;

export class PostgresPnlStore implements PnlStore {
  private readonly valuationProvider: PnlValuationProvider;

  constructor(
    private readonly pool: pg.Pool,
    valuationProvider: PnlValuationProvider,
  ) {
    assertPool(pool);
    assertValuationProvider(valuationProvider);
    this.valuationProvider = { resolve: valuationProvider.resolve.bind(valuationProvider) };
  }

  async checkHealth(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("SELECT 1 FROM pnl_records LIMIT 1");
    } finally {
      client.release();
    }
  }

  async recordSettlement(input: RecordPnlInput): Promise<PnlTradeRecord> {
    const expected = buildPnlTradeRecord(input, await this.valuationProvider.resolve(input));
    const client = await this.pool.connect();
    try {
      const inserted = await client.query(
        `INSERT INTO pnl_records (
           id, quote_id, settlement_event_id, snapshot_id, chain_id, user_address, token_in, token_out,
           amount_in, amount_out, min_amount_out, nonce, deadline,
           mid_price, token_in_decimals, token_out_decimals, fair_amount_out, valuation_observed_at,
           gross_pnl_token_out, gross_pnl_bps, model, model_description, realized_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
           $14, $15, $16, $17, $18, $19, $20, $21, $22, $23
         )
         ON CONFLICT (quote_id, model) DO NOTHING
         RETURNING ${pnlColumns}`,
        pnlParams(expected),
      );
      let record: PnlTradeRecord;
      if (inserted.rows.length === 1) {
        record = parsePnlRow(inserted.rows[0]);
      } else if (inserted.rows.length === 0) {
        const existing = await client.query(
          `SELECT ${pnlColumns} FROM pnl_records WHERE quote_id = $1 AND model = $2`,
          [expected.quoteId, expected.model],
        );
        if (existing.rows.length !== 1) throw new Error(`Postgres PnL conflict for ${expected.pnlId}`);
        record = parsePnlRow(existing.rows[0]);
      } else {
        throw new Error("Postgres PnL insert returned multiple rows");
      }
      if (!matchesPnlInput(record, input) || !pnlAttributionMatches(record, expected)) {
        throw new Error(`Postgres PnL record conflict for ${expected.pnlId}`);
      }
      return clonePnlTradeRecord(record);
    } finally {
      client.release();
    }
  }

  async getPnlRecordByQuoteId(quoteId: string): Promise<PnlTradeRecord | undefined> {
    const normalized = normalizeRemovePnlRecordInput({ quoteId });
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT ${pnlColumns} FROM pnl_records WHERE quote_id = $1 AND model = $2`,
        [normalized.quoteId, normalized.model],
      );
      if (result.rows.length > 1) throw new Error(`Postgres PnL lookup returned multiple rows for ${quoteId}`);
      return result.rows[0] ? parsePnlRow(result.rows[0]) : undefined;
    } finally {
      client.release();
    }
  }

  async removePnlRecord(input: RemovePnlRecordInput): Promise<RemovePnlRecordResult> {
    const normalized = normalizeRemovePnlRecordInput(input);
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `DELETE FROM pnl_records WHERE quote_id = $1 AND model = $2 RETURNING ${pnlColumns}`,
        [normalized.quoteId, normalized.model],
      );
      if (result.rows.length === 0) return { removed: false };
      if (result.rows.length !== 1) throw new Error("Postgres PnL removal returned multiple rows");
      return { record: parsePnlRow(result.rows[0]), removed: true };
    } finally {
      client.release();
    }
  }

  async summary(): Promise<PnlSummaryResponse>;
  async summary(principalId: string): Promise<PnlSummaryResponse>;
  async summary(principalId: string, page: PnlPageRequest): Promise<PaginatedPnlSummaryResponse>;
  async summary(
    principalId?: string,
    page?: PnlPageRequest,
  ): Promise<PnlSummaryResponse | PaginatedPnlSummaryResponse> {
    if (principalId !== undefined) assertPrincipalId(principalId, "Postgres PnL summary principalId");
    if (page !== undefined) {
      if (principalId === undefined) throw new Error("Postgres PnL principalId is required for paginated summaries");
      assertPnlPageRequest(page);
    }
    const client = await this.pool.connect();
    try {
      if (page !== undefined && principalId !== undefined) {
        return await this.paginatedSummary(client, principalId, page);
      }
      const result = await client.query(
        `SELECT ${qualifiedPnlColumns}, ${hedgeNetColumns}
         FROM pnl_records pnl
         LEFT JOIN hedge_orders hedge ON hedge.quote_id = pnl.quote_id
         ${principalId === undefined ? "" : "JOIN quotes quote ON quote.id = pnl.quote_id"}
         ${principalId === undefined ? "" : "WHERE quote.principal_id = $1"}
         ORDER BY pnl.realized_at ASC, pnl.id ASC`,
        principalId === undefined ? [] : [principalId],
      );
      const trades = result.rows.map(parsePnlRow);
      return buildPnlSummary(trades, result.rows.map((row, index) => parseHedgeNetPnlRow(row, trades[index]!)));
    } finally {
      client.release();
    }
  }

  private async paginatedSummary(
    client: pg.PoolClient,
    principalId: string,
    page: PnlPageRequest,
  ): Promise<PaginatedPnlSummaryResponse> {
    let transactionOpen = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      transactionOpen = true;
      const asOf = page.cursor?.asOf ?? await readTransactionTimestamp(client);
      const boundaryRealizedAt = page.cursor?.realizedAt ?? null;
      const boundaryPnlId = page.cursor?.pnlId ?? null;
      const pageResult = await client.query(
        `SELECT ${qualifiedPnlColumns}, ${hedgeNetColumns}
         FROM pnl_records pnl
         JOIN quotes quote ON quote.id = pnl.quote_id
         LEFT JOIN hedge_orders hedge ON hedge.quote_id = pnl.quote_id
         WHERE quote.principal_id = $1
           AND pnl.created_at <= $2::timestamptz
           AND (
             $3::timestamptz IS NULL
             OR pnl.realized_at < $3::timestamptz
             OR (pnl.realized_at = $3::timestamptz AND pnl.id < $4)
           )
         ORDER BY pnl.realized_at DESC, pnl.id DESC
         LIMIT $5`,
        [principalId, asOf, boundaryRealizedAt, boundaryPnlId, page.limit + 1],
      );
      if (pageResult.rows.length > page.limit + 1) {
        throw new Error("Postgres PnL page query exceeded its requested bound");
      }
      const selectedRows = pageResult.rows.slice(0, page.limit);
      const trades = selectedRows.map(parsePnlRow);
      const hedgeRecords = selectedRows.map((row, index) => parseHedgeNetPnlRow(row, trades[index]!));

      const grossResult = await client.query(
        `SELECT pnl.chain_id, lower(pnl.token_out) AS token_out,
                count(*)::text AS total_trades,
                sum(pnl.gross_pnl_token_out)::text AS gross_pnl_token_out
         FROM pnl_records pnl
         JOIN quotes quote ON quote.id = pnl.quote_id
         WHERE quote.principal_id = $1 AND pnl.created_at <= $2::timestamptz
         GROUP BY pnl.chain_id, lower(pnl.token_out)
         ORDER BY pnl.chain_id ASC, lower(pnl.token_out) ASC`,
        [principalId, asOf],
      );
      const gross = parseGrossPnlAggregates(grossResult.rows);

      const hedgeCountsResult = await client.query(
        `WITH classified AS (
           SELECT CASE
             WHEN hedge.id IS NULL OR hedge.route_accounting_version IS NULL THEN 'unavailable'
             WHEN hedge.route_accounting_version IS DISTINCT FROM 'venue-assets-v1'
               OR hedge.hedge_net_pnl_model IS DISTINCT FROM 'hedge_fill_net_v1'
               OR hedge.hedge_net_pnl_model_description IS DISTINCT FROM $3 THEN 'invalid'
             WHEN hedge.venue_quote_asset IS NULL OR hedge.venue_quote_token_address IS NULL THEN 'invalid'
             WHEN hedge.hedge_net_pnl_status = 'pending'
               AND hedge.status = 'failed'
               AND hedge.filled_amount IS NULL
               AND hedge.fee_reconciliation_status IS NULL THEN 'unavailable'
             WHEN hedge.hedge_net_pnl_status IN ('pending', 'complete', 'unavailable')
               THEN hedge.hedge_net_pnl_status
             ELSE 'invalid'
           END AS effective_status
           FROM pnl_records pnl
           JOIN quotes quote ON quote.id = pnl.quote_id
           LEFT JOIN hedge_orders hedge ON hedge.quote_id = pnl.quote_id
           WHERE quote.principal_id = $1 AND pnl.created_at <= $2::timestamptz
         )
         SELECT count(*)::text AS total_trades,
                count(*) FILTER (WHERE effective_status = 'complete')::text AS complete_trades,
                count(*) FILTER (WHERE effective_status = 'pending')::text AS pending_trades,
                count(*) FILTER (WHERE effective_status = 'unavailable')::text AS unavailable_trades
         FROM classified`,
        [principalId, asOf, hedgeFillNetPnlModelDescription],
      );
      const hedgeCounts = parseHedgeNetCounts(hedgeCountsResult.rows);

      const hedgeTotalsResult = await client.query(
        `SELECT pnl.chain_id,
                lower(hedge.venue_quote_token_address) AS valuation_token,
                hedge.venue_quote_asset AS valuation_asset,
                count(*)::text AS total_trades,
                sum(hedge.hedge_net_pnl_quote_quantity)::text AS net_pnl_quote_quantity
         FROM pnl_records pnl
         JOIN quotes quote ON quote.id = pnl.quote_id
         JOIN hedge_orders hedge ON hedge.quote_id = pnl.quote_id
         WHERE quote.principal_id = $1
           AND pnl.created_at <= $2::timestamptz
           AND hedge.route_accounting_version = 'venue-assets-v1'
           AND hedge.hedge_net_pnl_model = 'hedge_fill_net_v1'
           AND hedge.hedge_net_pnl_model_description = $3
           AND hedge.hedge_net_pnl_status = 'complete'
         GROUP BY pnl.chain_id, lower(hedge.venue_quote_token_address), hedge.venue_quote_asset
         ORDER BY pnl.chain_id ASC, lower(hedge.venue_quote_token_address) ASC, hedge.venue_quote_asset ASC`,
        [principalId, asOf, hedgeFillNetPnlModelDescription],
      );
      const hedgeTotals = parseHedgeNetTotals(hedgeTotalsResult.rows);
      const aggregate: PnlSummaryResponse = {
        status: "ok",
        totalTrades: gross.totalTrades,
        totals: gross.totals,
        trades: [],
        hedgeNet: {
          model: "hedge_fill_net_v1",
          modelDescription: hedgeFillNetPnlModelDescription,
          ...hedgeCounts,
          totals: hedgeTotals,
          records: [],
        },
      };
      const response = buildPaginatedPnlSummary(aggregate, trades, hedgeRecords, {
        limit: page.limit,
        asOf,
        hasMore: pageResult.rows.length > page.limit,
      });
      await client.query("COMMIT");
      transactionOpen = false;
      return response;
    } catch (error) {
      if (transactionOpen) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // Preserve the query or validation failure that caused the rollback.
        }
      }
      throw error;
    }
  }
}

async function readTransactionTimestamp(client: pg.PoolClient): Promise<string> {
  const result = await client.query("SELECT transaction_timestamp() AS as_of");
  if (result.rows.length !== 1) throw new Error("Postgres PnL transaction timestamp query returned invalid rows");
  return parseTimestamp(result.rows[0]?.as_of, "as_of");
}

function parseGrossPnlAggregates(rows: unknown[]): { totalTrades: number; totals: PnlTokenTotal[] } {
  const totals: PnlTokenTotal[] = [];
  const keys = new Set<string>();
  let totalTrades = 0;
  for (const row of rows) {
    const value = parseAggregateRow(row, "gross aggregate");
    const chainId = parsePositiveSafeInteger(value.chain_id, "aggregate chain_id");
    const tokenOut = parseAddress(value.token_out, "aggregate token_out").toLowerCase() as Address;
    const count = parsePositiveSafeInteger(value.total_trades, "aggregate total_trades");
    const key = `${chainId}:${tokenOut}`;
    if (keys.has(key)) throw new Error("Postgres PnL gross aggregates contain duplicate groups");
    keys.add(key);
    totalTrades = addSafeCount(totalTrades, count, "gross aggregate totalTrades");
    totals.push({
      chainId,
      tokenOut,
      totalTrades: count,
      grossPnlTokenOut: parseIntString(value.gross_pnl_token_out, "aggregate gross_pnl_token_out"),
    });
  }
  totals.sort((left, right) => left.chainId - right.chainId || left.tokenOut.localeCompare(right.tokenOut));
  return { totalTrades, totals };
}

function parseHedgeNetCounts(rows: unknown[]): Pick<
  HedgeNetPnlSummary,
  "totalTrades" | "completeTrades" | "pendingTrades" | "unavailableTrades"
> {
  if (rows.length !== 1) throw new Error("Postgres hedge net PnL counts returned invalid rows");
  const value = parseAggregateRow(rows[0], "hedge count aggregate");
  const result = {
    totalTrades: parseNonNegativeSafeInteger(value.total_trades, "hedge aggregate total_trades"),
    completeTrades: parseNonNegativeSafeInteger(value.complete_trades, "hedge aggregate complete_trades"),
    pendingTrades: parseNonNegativeSafeInteger(value.pending_trades, "hedge aggregate pending_trades"),
    unavailableTrades: parseNonNegativeSafeInteger(value.unavailable_trades, "hedge aggregate unavailable_trades"),
  };
  if (result.completeTrades + result.pendingTrades + result.unavailableTrades !== result.totalTrades) {
    throw new Error("Postgres hedge net PnL counts are inconsistent");
  }
  return result;
}

function parseHedgeNetTotals(rows: unknown[]): HedgeNetPnlTotal[] {
  const totals: HedgeNetPnlTotal[] = [];
  const keys = new Set<string>();
  for (const row of rows) {
    const value = parseAggregateRow(row, "hedge total aggregate");
    const chainId = parsePositiveSafeInteger(value.chain_id, "hedge aggregate chain_id");
    const valuationToken = parseAddress(value.valuation_token, "hedge aggregate valuation_token")
      .toLowerCase() as Address;
    const valuationAsset = parseVenueAsset(value.valuation_asset, "hedge aggregate valuation_asset");
    const key = `${chainId}:${valuationToken}:${valuationAsset}`;
    if (keys.has(key)) throw new Error("Postgres hedge net PnL totals contain duplicate groups");
    keys.add(key);
    totals.push({
      chainId,
      valuationToken,
      valuationAsset,
      totalTrades: parsePositiveSafeInteger(value.total_trades, "hedge aggregate total_trades"),
      netPnlQuoteQuantity: normalizeSignedDecimal(
        value.net_pnl_quote_quantity,
        "hedge aggregate net_pnl_quote_quantity",
      ),
    });
  }
  totals.sort((left, right) => left.chainId - right.chainId ||
    left.valuationToken.localeCompare(right.valuationToken) || left.valuationAsset.localeCompare(right.valuationAsset));
  return totals;
}

function parseAggregateRow(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Postgres PnL ${label} row must be an object`);
  }
  return value as Record<string, unknown>;
}

function parseNonNegativeSafeInteger(value: unknown, field: string): number {
  const parsed = parseSafeInteger(value, field);
  if (parsed < 0) throw new Error(`Postgres PnL row ${field} must be non-negative`);
  return parsed;
}

function addSafeCount(left: number, right: number, field: string): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw new Error(`Postgres PnL ${field} must be a safe integer`);
  return result;
}

function pnlParams(record: PnlTradeRecord): unknown[] {
  return [
    record.pnlId,
    record.quoteId,
    record.settlementEventId,
    record.snapshotId,
    record.chainId,
    record.user,
    record.tokenIn,
    record.tokenOut,
    record.amountIn,
    record.amountOut,
    record.minAmountOut,
    record.nonce,
    record.deadline,
    record.midPrice,
    record.tokenInDecimals,
    record.tokenOutDecimals,
    record.fairAmountOut,
    record.valuationObservedAt,
    record.grossPnlTokenOut,
    record.grossPnlBps,
    record.model,
    record.modelDescription,
    record.realizedAt,
  ];
}

function assertPool(pool: unknown): asserts pool is pg.Pool {
  if (typeof pool !== "object" || pool === null || Array.isArray(pool) ||
      typeof (pool as Record<string, unknown>).connect !== "function") {
    throw new Error("Postgres PnL pool.connect must be a function");
  }
}

function assertValuationProvider(value: unknown): asserts value is PnlValuationProvider {
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
      typeof (value as Record<string, unknown>).resolve !== "function") {
    throw new Error("Postgres PnL valuationProvider.resolve must be a function");
  }
}
