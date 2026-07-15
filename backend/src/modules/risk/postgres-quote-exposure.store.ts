import type pg from "pg";
import type { TokenRegistry } from "../pricing/token-registry.js";
import {
  assertSameReservation,
  notifyPortfolioDeltaSoftBreach,
  normalizeQuoteExposurePolicy,
  normalizeQuoteExposureReservation,
  type NormalizedQuoteExposureReservation,
  type QuoteExposurePolicy,
  type QuoteExposureObserver,
  type QuoteExposureReservationResult,
  type QuoteExposureStore,
  type ReserveQuoteExposureInput,
} from "./quote-exposure.store.js";
import { PostgresPortfolioVarEvaluator } from "./postgres-portfolio-var.js";
import {
  assertPortfolioDeltaEvaluation,
  assertPortfolioDeltaEvaluationMatchesPolicy,
  evaluatePortfolioDelta,
  exceedsPortfolioDeltaHardLimit,
  normalizePortfolioDeltaPolicy,
  type NormalizedPortfolioDeltaPolicy,
  type PortfolioDeltaEvaluation,
} from "./portfolio-delta.js";
import type { PortfolioVarEvaluation } from "./portfolio-var.js";

interface ExposureTotalsRow {
  user_open_notional_usd_e18: string;
  pair_open_notional_usd_e18: string;
}

interface OutputReservationTotalRow {
  reserved_output_amount: string;
}

export class PostgresQuoteExposureStore implements QuoteExposureStore {
  private readonly maxUserOpenNotionalUsdE18: bigint;
  private readonly maxPairOpenNotionalUsdE18: bigint;
  private readonly portfolioVarEvaluator?: PostgresPortfolioVarEvaluator;
  private readonly portfolioDeltaPolicy?: NormalizedPortfolioDeltaPolicy;

  constructor(
    private readonly pool: pg.Pool,
    policy: QuoteExposurePolicy,
    private readonly tokenRegistry: TokenRegistry,
    private readonly nowSeconds: () => number = () => Math.floor(Date.now() / 1_000),
    private readonly observer?: QuoteExposureObserver,
  ) {
    if (!pool || typeof pool.connect !== "function") {
      throw new Error("Postgres quote exposure pool.connect must be a function");
    }
    if (typeof nowSeconds !== "function") {
      throw new Error("Postgres quote exposure nowSeconds must be a function");
    }
    const limits = normalizeQuoteExposurePolicy(policy);
    this.maxUserOpenNotionalUsdE18 = limits.maxUserOpenNotionalUsdE18;
    this.maxPairOpenNotionalUsdE18 = limits.maxPairOpenNotionalUsdE18;
    if (policy.portfolioVar) {
      this.portfolioVarEvaluator = new PostgresPortfolioVarEvaluator(
        policy.portfolioVar,
        tokenRegistry,
        () => this.nowSeconds() * 1_000,
      );
    }
    if (policy.portfolioDelta) {
      if (!policy.portfolioVar) {
        throw new Error("Postgres quote exposure portfolio delta requires portfolio VaR");
      }
      this.portfolioDeltaPolicy = normalizePortfolioDeltaPolicy(policy.portfolioDelta);
    }
  }

  async checkHealth(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("SELECT 1 FROM quote_exposure_reservations LIMIT 1");
    } finally {
      client.release();
    }
  }

  async reserve(input: ReserveQuoteExposureInput): Promise<QuoteExposureReservationResult> {
    const reservation = normalizeQuoteExposureReservation(input, this.tokenRegistry, this.nowSeconds());
    const client = await this.pool.connect();
    let transactionOpen = false;
    try {
      await client.query("BEGIN");
      transactionOpen = true;
      const scopes = exposureLockScopes(reservation, this.portfolioVarEvaluator !== undefined).sort();
      for (const scope of scopes) {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [scope]);
      }
      await client.query(
        `DELETE FROM quote_exposure_reservations
         WHERE quote_id IN (
           SELECT quote_id
           FROM quote_exposure_reservations
           WHERE expires_at <= now()
           ORDER BY expires_at
           LIMIT 100
           FOR UPDATE SKIP LOCKED
         )`,
      );

      const existingResult = await client.query(
        `SELECT exposure.quote_id, exposure.chain_id, exposure.user_address,
          exposure.token_low, exposure.token_high, exposure.token_in,
          exposure.amount_in::text, exposure.token_out,
          exposure.amount_out::text, exposure.notional_usd_e18::text,
          exposure.settlement_address, exposure.treasury_address,
          exposure.treasury_available_balance::text,
          exposure.treasury_block_number::text,
          exposure.var_evaluation,
          exposure.delta_evaluation,
          extract(epoch FROM exposure.expires_at)::bigint::text AS deadline,
          exposure.expires_at > now() AND quote.status IN ('requested', 'signed', 'failed') AS active
         FROM quote_exposure_reservations exposure
         JOIN quotes quote ON quote.id = exposure.quote_id
         WHERE exposure.quote_id = $1
         FOR UPDATE`,
        [reservation.quoteId],
      );
      if (existingResult.rowCount && existingResult.rowCount > 0) {
        if (existingResult.rows[0].active !== true) {
          throw new Error(`Quote exposure reservation ${reservation.quoteId} is expired by database time`);
        }
        assertSameReservation(normalizeReservationRow(existingResult.rows[0]), reservation);
        await client.query("COMMIT");
        transactionOpen = false;
        const portfolioVar = normalizeOptionalPortfolioVar(existingResult.rows[0].var_evaluation);
        const portfolioDelta = normalizeOptionalPortfolioDelta(existingResult.rows[0].delta_evaluation);
        if (this.portfolioDeltaPolicy && !portfolioDelta) {
          throw new Error("Postgres quote exposure delta_evaluation is required by active policy");
        }
        if (this.portfolioDeltaPolicy && portfolioDelta) {
          assertPortfolioDeltaEvaluationMatchesPolicy(
            portfolioDelta,
            this.portfolioDeltaPolicy,
            reservation.chainId,
          );
        }
        return {
          status: "reserved",
          notionalUsdE18: reservation.notionalUsdE18.toString(),
          ...(portfolioVar ? { portfolioVar } : {}),
          ...(portfolioDelta ? { portfolioDelta } : {}),
        };
      }

      const totalsResult = await client.query<ExposureTotalsRow>(
        `SELECT
          COALESCE(SUM(exposure.notional_usd_e18) FILTER (
            WHERE lower(exposure.user_address) = $2
          ), 0)::text AS user_open_notional_usd_e18,
          COALESCE(SUM(exposure.notional_usd_e18) FILTER (
            WHERE lower(exposure.token_low) = $3 AND lower(exposure.token_high) = $4
          ), 0)::text AS pair_open_notional_usd_e18
         FROM quote_exposure_reservations exposure
         JOIN quotes quote ON quote.id = exposure.quote_id
         WHERE exposure.chain_id = $1
           AND exposure.expires_at > now()
           AND quote.status IN ('requested', 'signed', 'failed')
           AND (
             lower(exposure.user_address) = $2
             OR (lower(exposure.token_low) = $3 AND lower(exposure.token_high) = $4)
           )`,
        [reservation.chainId, reservation.user, reservation.tokenLow, reservation.tokenHigh],
      );
      const totals = normalizeTotalsRow(totalsResult.rows[0]);
      if (totals.user + reservation.notionalUsdE18 > this.maxUserOpenNotionalUsdE18) {
        await client.query("ROLLBACK");
        transactionOpen = false;
        return { status: "rejected", reasonCode: "USER_OPEN_NOTIONAL_LIMIT_EXCEEDED" };
      }
      if (totals.pair + reservation.notionalUsdE18 > this.maxPairOpenNotionalUsdE18) {
        await client.query("ROLLBACK");
        transactionOpen = false;
        return { status: "rejected", reasonCode: "PAIR_OPEN_NOTIONAL_LIMIT_EXCEEDED" };
      }
      if (reservation.treasuryLiquidity) {
        const outputTotalResult = await client.query<OutputReservationTotalRow>(
          `SELECT COALESCE(SUM(amount_out), 0)::text AS reserved_output_amount
           FROM quote_exposure_reservations
           WHERE chain_id = $1 AND lower(token_out) = $2 AND expires_at > now()`,
          [reservation.chainId, reservation.tokenOut],
        );
        const reservedOutputAmount = parseNonNegativeInteger(
          outputTotalResult.rows[0]?.reserved_output_amount,
          "reserved output amount",
        );
        if (reservedOutputAmount + reservation.amountOut > reservation.treasuryLiquidity.availableBalance) {
          await client.query("ROLLBACK");
          transactionOpen = false;
          return { status: "rejected", reasonCode: "TREASURY_LIQUIDITY_INSUFFICIENT" };
        }
      }

      let portfolioVar: PortfolioVarEvaluation | undefined;
      let portfolioDelta: PortfolioDeltaEvaluation | undefined;
      if (this.portfolioVarEvaluator) {
        portfolioVar = await this.portfolioVarEvaluator.evaluate(client, reservation);
        if (this.portfolioVarEvaluator.exceedsLimit(portfolioVar)) {
          await client.query("ROLLBACK");
          transactionOpen = false;
          return { status: "rejected", reasonCode: "PORTFOLIO_VAR_LIMIT_EXCEEDED" };
        }
        if (this.portfolioDeltaPolicy) {
          portfolioDelta = evaluatePortfolioDelta(portfolioVar, this.portfolioDeltaPolicy, reservation.chainId);
          if (exceedsPortfolioDeltaHardLimit(portfolioDelta)) {
            await client.query("ROLLBACK");
            transactionOpen = false;
            return { status: "rejected", reasonCode: "PORTFOLIO_DELTA_LIMIT_EXCEEDED" };
          }
        }
      }

      const insertResult = await client.query(
        `INSERT INTO quote_exposure_reservations (
          quote_id, chain_id, user_address, token_low, token_high, token_in, amount_in,
          token_out, amount_out,
          notional_usd_e18, settlement_address, treasury_address,
          treasury_available_balance, treasury_block_number, var_evaluation, delta_evaluation, expires_at
        )
        SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
          $15::jsonb, $16::jsonb, to_timestamp($17)
        WHERE to_timestamp($17) > now()
          AND EXISTS (SELECT 1 FROM quotes WHERE id = $1 AND status = 'requested')
        RETURNING quote_id`,
        [
          reservation.quoteId,
          reservation.chainId,
          reservation.user,
          reservation.tokenLow,
          reservation.tokenHigh,
          reservation.tokenIn,
          reservation.amountIn.toString(),
          reservation.tokenOut,
          reservation.amountOut.toString(),
          reservation.notionalUsdE18.toString(),
          reservation.treasuryLiquidity?.settlementAddress ?? null,
          reservation.treasuryLiquidity?.treasuryAddress ?? null,
          reservation.treasuryLiquidity?.availableBalance.toString() ?? null,
          reservation.treasuryLiquidity?.blockNumber.toString() ?? null,
          portfolioVar ? JSON.stringify(portfolioVar) : null,
          portfolioDelta ? JSON.stringify(portfolioDelta) : null,
          reservation.deadline,
        ],
      );
      if (insertResult.rowCount !== 1) {
        throw new Error("Quote exposure reservation deadline is not active by database time");
      }
      await client.query("COMMIT");
      transactionOpen = false;
      if (portfolioDelta?.softLimitBreached) notifyPortfolioDeltaSoftBreach(this.observer);
      return {
        status: "reserved",
        notionalUsdE18: reservation.notionalUsdE18.toString(),
        ...(portfolioVar ? { portfolioVar } : {}),
        ...(portfolioDelta ? { portfolioDelta } : {}),
      };
    } catch (error) {
      if (transactionOpen) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // Preserve the original database error.
        }
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async release(quoteId: string): Promise<void> {
    if (typeof quoteId !== "string" || !/^[A-Za-z0-9_:-]{1,128}$/.test(quoteId)) {
      throw new Error("Postgres quote exposure quoteId must be a safe identifier");
    }
    const client = await this.pool.connect();
    let transactionOpen = false;
    try {
      await client.query("BEGIN");
      transactionOpen = true;
      const chainResult = await client.query(
        "SELECT chain_id FROM quote_exposure_reservations WHERE quote_id = $1",
        [quoteId],
      );
      const chainId = chainResult.rows.length === 0
        ? undefined
        : parsePositiveSafeInteger(chainResult.rows[0]?.chain_id, "release chain_id");
      const lockScopes = [
        `quote-exposure:quote:${quoteId}`,
        ...(chainId !== undefined && this.portfolioVarEvaluator
          ? [`quote-exposure:portfolio:${chainId}`]
          : []),
      ].sort();
      for (const scope of lockScopes) {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [scope]);
      }
      await client.query("DELETE FROM quote_exposure_reservations WHERE quote_id = $1", [quoteId]);
      await client.query("COMMIT");
      transactionOpen = false;
    } catch (error) {
      if (transactionOpen) {
        try {
          await client.query("ROLLBACK");
        } catch {}
      }
      throw error;
    } finally {
      client.release();
    }
  }
}

function exposureLockScopes(
  reservation: NormalizedQuoteExposureReservation,
  portfolioVarEnabled: boolean,
): string[] {
  return [
    `quote-exposure:quote:${reservation.quoteId}`,
    `quote-exposure:user:${reservation.chainId}:${reservation.user}`,
    `quote-exposure:pair:${reservation.chainId}:${reservation.tokenLow}:${reservation.tokenHigh}`,
    `quote-liquidity:${reservation.chainId}:${reservation.tokenOut}`,
    ...(portfolioVarEnabled ? [`quote-exposure:portfolio:${reservation.chainId}`] : []),
  ];
}

function normalizeTotalsRow(row: ExposureTotalsRow | undefined): { user: bigint; pair: bigint } {
  if (!row) throw new Error("Postgres quote exposure totals query returned no row");
  return {
    user: parseNonNegativeInteger(row.user_open_notional_usd_e18, "user total"),
    pair: parseNonNegativeInteger(row.pair_open_notional_usd_e18, "pair total"),
  };
}

function normalizeReservationRow(row: Record<string, unknown>): NormalizedQuoteExposureReservation {
  const quoteId = requireString(row.quote_id, "quote_id");
  const chainId = Number(row.chain_id);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new Error("Postgres quote exposure row.chain_id must be a positive safe integer");
  }
  const user = requireAddress(row.user_address, "user_address");
  const tokenLow = requireAddress(row.token_low, "token_low");
  const tokenHigh = requireAddress(row.token_high, "token_high");
  const tokenIn = requireAddress(row.token_in, "token_in");
  const tokenOut = requireAddress(row.token_out, "token_out");
  const deadline = Number(row.deadline);
  if (!Number.isSafeInteger(deadline) || deadline <= 0) {
    throw new Error("Postgres quote exposure row.deadline must be a positive safe integer");
  }
  return {
    quoteId,
    chainId,
    user,
    tokenLow,
    tokenHigh,
    tokenIn,
    amountIn: parsePositiveInteger(row.amount_in, "amount_in"),
    tokenOut,
    amountOut: parsePositiveInteger(row.amount_out, "amount_out"),
    notionalUsdE18: parseNonNegativeInteger(row.notional_usd_e18, "notional_usd_e18"),
    deadline,
    ...normalizeOptionalLiquidityRow(row),
  };
}

function normalizeOptionalPortfolioVar(value: unknown): PortfolioVarEvaluation | undefined {
  if (value === null || value === undefined) return undefined;
  const parsed = typeof value === "string" ? parseJson(value, "var_evaluation") : value;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Postgres quote exposure var_evaluation must be an object");
  }
  const evaluation = parsed as Record<string, unknown>;
  const fields = [
    "modelVersion",
    "horizonSeconds",
    "preTradeVarUsdE18",
    "postTradeVarUsdE18",
    "varLimitUsdE18",
    "preTradeComponents",
    "postTradeComponents",
  ];
  if (Object.keys(evaluation).length !== fields.length || fields.some((field) => !(field in evaluation))) {
    throw new Error("Postgres quote exposure var_evaluation has invalid fields");
  }
  if (typeof evaluation.modelVersion !== "string" || !/^[A-Za-z0-9_:-]{1,128}$/.test(evaluation.modelVersion)) {
    throw new Error("Postgres quote exposure var_evaluation modelVersion is invalid");
  }
  const horizonSeconds = Number(evaluation.horizonSeconds);
  if (!Number.isSafeInteger(horizonSeconds) || horizonSeconds <= 0) {
    throw new Error("Postgres quote exposure var_evaluation horizonSeconds is invalid");
  }
  for (const field of ["preTradeVarUsdE18", "postTradeVarUsdE18", "varLimitUsdE18"] as const) {
    parseNonNegativeInteger(evaluation[field], `var_evaluation ${field}`);
  }
  if (!Array.isArray(evaluation.preTradeComponents) || !Array.isArray(evaluation.postTradeComponents)) {
    throw new Error("Postgres quote exposure var_evaluation components must be arrays");
  }
  return evaluation as unknown as PortfolioVarEvaluation;
}

function normalizeOptionalPortfolioDelta(value: unknown): PortfolioDeltaEvaluation | undefined {
  if (value === null || value === undefined) return undefined;
  const parsed = typeof value === "string" ? parseJson(value, "delta_evaluation") : value;
  try {
    assertPortfolioDeltaEvaluation(parsed);
  } catch (error) {
    throw new Error(
      `Postgres quote exposure delta_evaluation is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return parsed;
}

function parseJson(value: string, label: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`Postgres quote exposure ${label} must contain valid JSON`);
  }
}

function normalizeOptionalLiquidityRow(
  row: Record<string, unknown>,
): Pick<NormalizedQuoteExposureReservation, "treasuryLiquidity"> | Record<string, never> {
  const values = [
    row.settlement_address,
    row.treasury_address,
    row.treasury_available_balance,
    row.treasury_block_number,
  ];
  if (values.every((value) => value === null || value === undefined)) return {};
  if (values.some((value) => value === null || value === undefined)) {
    throw new Error("Postgres quote exposure treasury liquidity row is incomplete");
  }
  return {
    treasuryLiquidity: {
      settlementAddress: requireAddress(row.settlement_address, "settlement_address"),
      treasuryAddress: requireAddress(row.treasury_address, "treasury_address"),
      availableBalance: parseNonNegativeInteger(
        row.treasury_available_balance,
        "treasury_available_balance",
      ),
      blockNumber: parseNonNegativeInteger(row.treasury_block_number, "treasury_block_number"),
    },
  };
}

function parseNonNegativeInteger(value: unknown, label: string): bigint {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`Postgres quote exposure ${label} must be a canonical non-negative integer`);
  }
  return BigInt(value);
}

function parsePositiveInteger(value: unknown, label: string): bigint {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`Postgres quote exposure ${label} must be a canonical positive integer`);
  }
  return BigInt(value);
}

function parsePositiveSafeInteger(value: unknown, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Postgres quote exposure ${label} must be a positive safe integer`);
  }
  return parsed;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 128 || !/^[A-Za-z0-9_:-]+$/.test(value)) {
    throw new Error(`Postgres quote exposure row.${label} must be a safe identifier`);
  }
  return value;
}

function requireAddress(value: unknown, label: string): `0x${string}` {
  if (typeof value !== "string" || !/^0x[0-9a-f]{40}$/.test(value)) {
    throw new Error(`Postgres quote exposure row.${label} must be a normalized address`);
  }
  return value as `0x${string}`;
}
