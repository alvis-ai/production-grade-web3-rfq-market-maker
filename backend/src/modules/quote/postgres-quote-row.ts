import type pg from "pg";
import type { Address, QuoteStatusResponse } from "../../shared/types/rfq.js";
import { assertPrincipalId } from "../../shared/validation/principal-id.js";
import type { QuoteRecord } from "./quote-repository-contract.js";

export const quoteSelectColumns = [
  "id AS quote_id",
  "principal_id",
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
  "route_id",
  "route_venue",
  "route_expected_liquidity_usd",
  "route_decided_at",
  "pricing_version",
  "spread_bps",
  "size_impact_bps",
  "market_spread_bps",
  "inventory_skew_bps",
  "volatility_premium_bps",
  "hedge_cost_bps",
  "risk_policy_version",
  "status",
  "signature",
  "reject_code",
  "tx_hash",
  "settlement_event_id",
  "hedge_order_id",
  "pnl_id",
].join(", ");

export async function findQuoteRecordById(
  client: pg.PoolClient,
  quoteId: string,
): Promise<QuoteRecord | undefined> {
  const result = await client.query(
    `SELECT ${quoteSelectColumns} FROM quotes WHERE id = $1`,
    [quoteId],
  );
  if (!result.rowCount) return undefined;

  return quoteRecordFromRow(result.rows[0]);
}

export function quoteStatusResponseFromRow(row: Record<string, unknown>): QuoteStatusResponse {
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

export function quoteRecordFromRow(row: Record<string, unknown>): QuoteRecord {
  const principalId = row.principal_id;
  assertPrincipalId(principalId, "Postgres quote row principal_id");
  return {
    quoteId: String(row.quote_id),
    principalId,
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
    routeId: row.route_id != null ? String(row.route_id) : undefined,
    routeVenue: row.route_venue != null ? String(row.route_venue) as QuoteRecord["routeVenue"] : undefined,
    routeExpectedLiquidityUsd: row.route_expected_liquidity_usd != null
      ? String(row.route_expected_liquidity_usd)
      : undefined,
    routeDecidedAt: row.route_decided_at != null ? new Date(String(row.route_decided_at)).toISOString() : undefined,
    pricingVersion: row.pricing_version != null ? String(row.pricing_version) : undefined,
    spreadBps: row.spread_bps != null ? Number(row.spread_bps) : undefined,
    sizeImpactBps: row.size_impact_bps != null ? Number(row.size_impact_bps) : undefined,
    marketSpreadBps: row.market_spread_bps != null ? Number(row.market_spread_bps) : undefined,
    inventorySkewBps: row.inventory_skew_bps != null ? Number(row.inventory_skew_bps) : undefined,
    volatilityPremiumBps: row.volatility_premium_bps != null ? Number(row.volatility_premium_bps) : undefined,
    hedgeCostBps: row.hedge_cost_bps != null ? Number(row.hedge_cost_bps) : undefined,
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
