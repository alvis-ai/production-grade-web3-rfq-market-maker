import { APIError } from "../../shared/errors/api-error.js";
import type { MarketSnapshot } from "../../shared/types/rfq.js";
import { getMarketSnapshotIssue } from "../market-data/market-data.service.js";

export function quoteFailureCode(error: unknown): string {
  return error instanceof APIError ? error.code : "INTERNAL_ERROR";
}

export function marketDataFailure(error: unknown): APIError {
  return error instanceof APIError
    ? error
    : new APIError("MARKET_DATA_UNAVAILABLE", "Market data unavailable", 503);
}

export function quoteStoreFailure(error: unknown): APIError {
  return error instanceof APIError
    ? error
    : new APIError("QUOTE_STORE_UNAVAILABLE", "Quote store unavailable", 503);
}

export function pricingFailure(error: unknown): APIError {
  return error instanceof APIError
    ? error
    : new APIError("PRICING_UNAVAILABLE", "Pricing engine unavailable", 503);
}

export function routingFailure(error: unknown): APIError {
  return error instanceof APIError
    ? error
    : new APIError("ROUTING_UNAVAILABLE", "Routing engine unavailable", 503);
}

export function assertUsableSnapshot(
  snapshot: MarketSnapshot,
  maxSnapshotAgeMs: number,
  maxSnapshotFutureSkewMs: number,
): void {
  const issue = getMarketSnapshotIssue(snapshot, maxSnapshotAgeMs, maxSnapshotFutureSkewMs);
  if (issue) {
    throw new APIError("MARKET_DATA_UNAVAILABLE", `Market data ${issue}`, 503);
  }
}
