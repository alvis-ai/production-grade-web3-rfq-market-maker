import type pg from "pg";
import {
  toMarketSnapshotRecord,
  type MarketSnapshotRecord,
} from "../market-data/market-snapshot.repository.js";
import {
  assertRiskDecisionInput,
  assertRiskDecisionRecord,
  type RiskDecisionRecord,
} from "../risk/risk-decision.repository.js";
import {
  assertQuoteIdempotencyReservation,
  assertQuoteResponse,
} from "./quote-idempotency.store.js";
import type {
  AuthorizeQuoteIssuanceInput,
  FinalizeQuoteIssuanceInput,
  PrepareQuoteIssuanceInput,
  QuoteIssuanceStore,
} from "./quote-issuance.store.js";
import {
  assertRequestedQuoteInput,
  assertRouteDecisionInput,
  assertSignedQuoteInput,
} from "./quote-repository-invariants.js";

const postgresMarketSnapshotSource = "postgres-market-data-v1";

export class PostgresQuoteIssuanceStore implements QuoteIssuanceStore {
  constructor(private readonly pool: pg.Pool) {
    if (typeof pool !== "object" || pool === null || typeof pool.query !== "function") {
      throw new Error("Postgres quote issuance pool must expose query");
    }
  }

  async prepare(input: PrepareQuoteIssuanceInput): Promise<void> {
    const normalized = normalizePreparation(input);
    const result = await this.pool.query(
      preparationSql(input.idempotency !== undefined),
      preparationParams(normalized, input),
    );
    if (result.rows.length !== 1 || result.rows[0]?.quote_id !== input.requestedQuote.quoteId) {
      throw new Error(`Quote issuance preparation failed for ${input.requestedQuote.quoteId}`);
    }
  }

  async authorize(input: AuthorizeQuoteIssuanceInput): Promise<RiskDecisionRecord> {
    assertRiskDecisionInput(input);
    const result = await this.pool.query(authorizationSql(), authorizationParams(input));
    if (result.rows.length !== 1) {
      throw new Error(`Quote issuance authorization failed for ${input.quoteId}`);
    }
    const row = result.rows[0] as Record<string, unknown>;
    const record: RiskDecisionRecord = {
      riskDecisionId: String(row.risk_decision_id),
      quoteId: String(row.quote_id),
      decision: String(row.decision) as RiskDecisionRecord["decision"],
      ...(row.reason_code == null ? {} : {
        reasonCode: String(row.reason_code) as RiskDecisionRecord["reasonCode"],
      }),
      policyVersion: String(row.policy_version),
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    };
    assertRiskDecisionRecord(record, input);
    return record;
  }

  async finalize(input: FinalizeQuoteIssuanceInput): Promise<void> {
    normalizeFinalization(input);
    const result = await this.pool.query(
      finalizationSql(input.idempotency !== undefined),
      finalizationParams(input),
    );
    if (result.rows.length !== 1 || result.rows[0]?.quote_id !== input.signedQuote.quoteId) {
      throw new Error(`Quote issuance finalization failed for ${input.signedQuote.quoteId}`);
    }
  }
}

export function assertQuoteIssuancePreparation(input: PrepareQuoteIssuanceInput): void {
  normalizePreparation(input);
}

export function assertQuoteIssuanceFinalization(input: FinalizeQuoteIssuanceInput): void {
  normalizeFinalization(input);
}

interface NormalizedPreparation {
  snapshot: MarketSnapshotRecord;
}

function normalizePreparation(input: PrepareQuoteIssuanceInput): NormalizedPreparation {
  assertExactObject(input, [
    "marketSnapshot",
    "requestedQuote",
    "routeDecision",
  ], ["idempotency"], "preparation");
  assertRequestedQuoteInput(input.requestedQuote);
  assertRouteDecisionInput(input.routeDecision);
  if (input.idempotency !== undefined) assertQuoteIdempotencyReservation(input.idempotency);
  const snapshot = toMarketSnapshotRecord(input.marketSnapshot, postgresMarketSnapshotSource);
  const requested = input.requestedQuote;
  const route = input.routeDecision;
  if (route.quoteId !== requested.quoteId ||
      route.principalId !== requested.principalId ||
      route.snapshotId !== requested.snapshotId ||
      snapshot.snapshotId !== requested.snapshotId ||
      snapshot.chainId !== requested.request.chainId ||
      snapshot.tokenIn.toLowerCase() !== requested.request.tokenIn.toLowerCase() ||
      snapshot.tokenOut.toLowerCase() !== requested.request.tokenOut.toLowerCase() ||
      route.routePlan.tokenIn.toLowerCase() !== requested.request.tokenIn.toLowerCase() ||
      route.routePlan.tokenOut.toLowerCase() !== requested.request.tokenOut.toLowerCase()) {
    throw new Error("Quote issuance preparation inputs must describe one quote");
  }
  if (input.idempotency && input.idempotency.principalId !== requested.principalId) {
    throw new Error("Quote issuance idempotency principal must match quote principal");
  }
  return { snapshot };
}

function normalizeFinalization(input: FinalizeQuoteIssuanceInput): void {
  assertExactObject(input, ["signedQuote", "response"], ["idempotency"], "finalization");
  assertSignedQuoteInput(input.signedQuote);
  assertQuoteResponse(input.response);
  if (input.idempotency !== undefined) assertQuoteIdempotencyReservation(input.idempotency);
  const signed = input.signedQuote;
  const response = input.response;
  if (response.quoteId !== signed.quoteId || response.snapshotId !== signed.snapshotId ||
      response.amountOut !== signed.quote.amountOut || response.minAmountOut !== signed.quote.minAmountOut ||
      response.deadline !== signed.quote.deadline || response.nonce !== signed.quote.nonce ||
      response.signature.toLowerCase() !== signed.signature.toLowerCase()) {
    throw new Error("Quote issuance response must match signed quote");
  }
  if (input.idempotency && input.idempotency.principalId !== signed.principalId) {
    throw new Error("Quote issuance idempotency principal must match signed quote principal");
  }
}

function preparationParams(
  normalized: NormalizedPreparation,
  input: PrepareQuoteIssuanceInput,
): unknown[] {
  const snapshot = normalized.snapshot;
  const requested = input.requestedQuote;
  const route = input.routeDecision.routePlan;
  const params: unknown[] = [
    snapshot.snapshotId,
    snapshot.chainId,
    snapshot.tokenIn.toLowerCase(),
    snapshot.tokenOut.toLowerCase(),
    snapshot.midPrice,
    snapshot.liquidityUsd,
    snapshot.marketSpreadBps,
    snapshot.volatilityBps,
    snapshot.source,
    snapshot.observedAt,
    requested.quoteId,
    requested.principalId,
    requested.request.user.toLowerCase(),
    requested.request.amountIn,
    requested.request.slippageBps,
    route.routeId,
    route.venue,
    route.expectedLiquidityUsd,
  ];
  if (input.idempotency) {
    params.push(
      input.idempotency.key,
      input.idempotency.requestHash,
      input.idempotency.ownerToken,
    );
  }
  return params;
}

function authorizationParams(input: AuthorizeQuoteIssuanceInput): unknown[] {
  const risk = input.decision;
  return [
    input.quoteId,
    `rd_${input.quoteId}`,
    risk.status,
    risk.status === "rejected" ? risk.reasonCode : null,
    risk.policyVersion,
    risk.status === "approved" ? "requested" : "rejected",
    risk.status === "approved" ? null : risk.reasonCode,
  ];
}

function finalizationParams(input: FinalizeQuoteIssuanceInput): unknown[] {
  const signed = input.signedQuote;
  const quote = signed.quote;
  const params: unknown[] = [
    signed.quoteId,
    signed.principalId,
    quote.chainId,
    quote.user.toLowerCase(),
    quote.tokenIn.toLowerCase(),
    quote.tokenOut.toLowerCase(),
    quote.amountIn,
    signed.slippageBps,
    quote.amountOut,
    quote.minAmountOut,
    quote.nonce,
    quote.deadline,
    signed.snapshotId,
    signed.pricingVersion,
    signed.spreadBps,
    signed.sizeImpactBps,
    signed.marketSpreadBps,
    signed.inventorySkewBps,
    signed.volatilityPremiumBps,
    signed.hedgeCostBps,
    signed.riskPolicyVersion,
    signed.signature.toLowerCase(),
  ];
  if (input.idempotency) {
    params.push(
      input.idempotency.key,
      input.idempotency.requestHash,
      input.idempotency.ownerToken,
      JSON.stringify(input.response),
    );
  }
  return params;
}

function preparationSql(withIdempotency: boolean): string {
  const idempotencyCte = withIdempotency
    ? `, idempotency_write AS (
         UPDATE quote_idempotency_requests
         SET quote_id = $11, updated_at = now()
         WHERE principal_id = $12 AND idempotency_key = $19 AND request_hash = $20
           AND owner_token = $21 AND state = 'processing'
           AND (quote_id IS NULL OR quote_id = $11)
           AND EXISTS (SELECT 1 FROM quote_write)
         RETURNING quote_id
       )`
    : "";
  const idempotencyGuard = withIdempotency
    ? "AND (SELECT count(*) FROM idempotency_write) = 1"
    : "";
  return `WITH snapshot_write AS (
      INSERT INTO market_snapshots (
        id, chain_id, token_in, token_out, mid_price, liquidity_usd,
        market_spread_bps, volatility_bps, source, observed_at, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
      ON CONFLICT (id) DO UPDATE SET id = EXCLUDED.id
      WHERE market_snapshots.chain_id = EXCLUDED.chain_id
        AND lower(market_snapshots.token_in) = lower(EXCLUDED.token_in)
        AND lower(market_snapshots.token_out) = lower(EXCLUDED.token_out)
        AND market_snapshots.mid_price = EXCLUDED.mid_price
        AND market_snapshots.liquidity_usd = EXCLUDED.liquidity_usd
        AND market_snapshots.market_spread_bps = EXCLUDED.market_spread_bps
        AND market_snapshots.volatility_bps = EXCLUDED.volatility_bps
        AND market_snapshots.source = EXCLUDED.source
        AND market_snapshots.observed_at = EXCLUDED.observed_at
      RETURNING id
    ), quote_write AS (
      INSERT INTO quotes (
        id, principal_id, chain_id, user_address, token_in, token_out, amount_in,
        slippage_bps, snapshot_id, route_id, route_venue, route_expected_liquidity_usd,
        route_decided_at, status, created_at, updated_at
      )
      SELECT $11, $12, $2, $13, $3, $4, $14, $15, $1, $16, $17, $18,
        now(), 'requested', now(), now()
      FROM snapshot_write
      ON CONFLICT (id) DO UPDATE SET id = EXCLUDED.id
      WHERE quotes.principal_id = EXCLUDED.principal_id
        AND quotes.chain_id = EXCLUDED.chain_id
        AND lower(quotes.user_address) = lower(EXCLUDED.user_address)
        AND lower(quotes.token_in) = lower(EXCLUDED.token_in)
        AND lower(quotes.token_out) = lower(EXCLUDED.token_out)
        AND quotes.amount_in = EXCLUDED.amount_in
        AND quotes.slippage_bps = EXCLUDED.slippage_bps
        AND quotes.snapshot_id = EXCLUDED.snapshot_id
        AND quotes.route_id = EXCLUDED.route_id
        AND quotes.route_venue = EXCLUDED.route_venue
        AND quotes.route_expected_liquidity_usd = EXCLUDED.route_expected_liquidity_usd
        AND quotes.status = 'requested'
        AND quotes.risk_policy_version IS NULL
        AND quotes.reject_code IS NULL
        AND quotes.signature IS NULL
      RETURNING id
    )${idempotencyCte}
    SELECT
      1 / CASE WHEN
        (SELECT count(*) FROM snapshot_write) = 1
        AND (SELECT count(*) FROM quote_write) = 1
        ${idempotencyGuard}
      THEN 1 ELSE 0 END AS consistency_guard,
      (SELECT id FROM quote_write) AS quote_id`;
}

function authorizationSql(): string {
  return `WITH quote_write AS (
      UPDATE quotes SET
        risk_policy_version = $5,
        status = $6,
        reject_code = $7,
        updated_at = now()
      WHERE id = $1
        AND route_id IS NOT NULL
        AND route_venue IS NOT NULL
        AND route_expected_liquidity_usd IS NOT NULL
        AND signature IS NULL
        AND (
          (status = 'requested' AND risk_policy_version IS NULL AND reject_code IS NULL)
          OR (status = $6 AND risk_policy_version = $5 AND reject_code IS NOT DISTINCT FROM $7)
        )
      RETURNING id
    ), risk_write AS (
      INSERT INTO risk_decisions (id, quote_id, decision, reason_code, policy_version, created_at)
      SELECT $2, $1, $3, $4, $5, now() FROM quote_write
      ON CONFLICT (id) DO UPDATE SET id = EXCLUDED.id
      WHERE risk_decisions.quote_id = EXCLUDED.quote_id
        AND risk_decisions.decision = EXCLUDED.decision
        AND risk_decisions.reason_code IS NOT DISTINCT FROM EXCLUDED.reason_code
        AND risk_decisions.policy_version = EXCLUDED.policy_version
      RETURNING id, quote_id, decision, reason_code, policy_version, created_at
    )
    SELECT
      1 / CASE WHEN
        (SELECT count(*) FROM quote_write) = 1
        AND (SELECT count(*) FROM risk_write) = 1
      THEN 1 ELSE 0 END AS consistency_guard,
      (SELECT id FROM risk_write) AS risk_decision_id,
      (SELECT quote_id FROM risk_write) AS quote_id,
      (SELECT decision FROM risk_write) AS decision,
      (SELECT reason_code FROM risk_write) AS reason_code,
      (SELECT policy_version FROM risk_write) AS policy_version,
      (SELECT created_at FROM risk_write) AS created_at`;
}

function finalizationSql(withIdempotency: boolean): string {
  const idempotencyCte = withIdempotency
    ? `, idempotency_write AS (
         UPDATE quote_idempotency_requests
         SET state = 'succeeded', response = $26::jsonb,
             owner_token = NULL, lease_expires_at = NULL,
             completed_at = COALESCE(completed_at, now()), updated_at = now()
         WHERE principal_id = $2 AND idempotency_key = $23 AND request_hash = $24
           AND quote_id = $1
           AND (
             (state = 'processing' AND owner_token = $25)
             OR (state = 'succeeded' AND response = $26::jsonb)
           )
           AND EXISTS (SELECT 1 FROM quote_write)
         RETURNING quote_id
       )`
    : "";
  const idempotencyGuard = withIdempotency
    ? "AND (SELECT count(*) FROM idempotency_write) = 1"
    : "";
  return `WITH quote_write AS (
      UPDATE quotes SET
        amount_out = $9,
        min_amount_out = $10,
        nonce = $11,
        deadline = $12,
        pricing_version = $14,
        spread_bps = $15,
        size_impact_bps = $16,
        market_spread_bps = $17,
        inventory_skew_bps = $18,
        volatility_premium_bps = $19,
        hedge_cost_bps = $20,
        risk_policy_version = $21,
        status = 'signed',
        signature = $22,
        updated_at = now()
      WHERE id = $1
        AND principal_id = $2
        AND chain_id = $3
        AND lower(user_address) = $4
        AND lower(token_in) = $5
        AND lower(token_out) = $6
        AND amount_in = $7
        AND slippage_bps = $8
        AND snapshot_id = $13
        AND risk_policy_version = $21
        AND status IN ('requested', 'signed')
        AND (status = 'requested' OR (
          amount_out = $9 AND min_amount_out = $10 AND nonce = $11 AND deadline = $12
          AND pricing_version = $14 AND spread_bps = $15 AND size_impact_bps = $16
          AND market_spread_bps = $17 AND inventory_skew_bps = $18
          AND volatility_premium_bps = $19 AND hedge_cost_bps = $20
          AND lower(signature) = $22
        ))
      RETURNING id
    )${idempotencyCte}
    SELECT
      1 / CASE WHEN
        (SELECT count(*) FROM quote_write) = 1
        ${idempotencyGuard}
      THEN 1 ELSE 0 END AS consistency_guard,
      id AS quote_id
    FROM quote_write`;
}

function assertExactObject(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
  operation: "preparation" | "finalization",
): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Quote issuance ${operation} input must be an object`);
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set([...required, ...optional]);
  if (required.some((field) => !Object.prototype.hasOwnProperty.call(record, field)) ||
      optional.some((field) => field in record && !Object.prototype.hasOwnProperty.call(record, field)) ||
      Object.keys(record).some((field) => !allowed.has(field))) {
    throw new Error(`Quote issuance ${operation} input fields are invalid`);
  }
}
