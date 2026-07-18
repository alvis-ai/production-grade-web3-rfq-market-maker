import type pg from "pg";
import { PostgresQuoteIssuanceStore } from "../modules/quote/postgres-quote-issuance.store.js";
import type { QuoteIssuanceStore } from "../modules/quote/quote-issuance.store.js";
import type { BuildServerOptions } from "./gateway-runtime.js";

export function resolveQuoteIssuanceStore(
  options: BuildServerOptions,
  pool: pg.Pool | undefined,
): QuoteIssuanceStore | undefined {
  if (!pool || typeof pool.query !== "function" ||
      options.marketSnapshotStore !== undefined ||
      options.quoteRepository !== undefined ||
      options.riskDecisionStore !== undefined ||
      options.quoteIdempotencyStore !== undefined) {
    return undefined;
  }
  return new PostgresQuoteIssuanceStore(pool);
}
