import {
  assertOwnResponseFields,
  isIsoUtcTimestampString,
  isNonNegativeSafeInteger,
  isPositiveSafeInteger,
  isRecord,
  malformedFieldError,
} from "./client-response-validation.js";
import type { PnlPageMetadata, PnlTradeRecord } from "./types.js";

const pageFields = ["limit", "returned", "hasMore", "asOf"] as const;
const pageOptionalFields = ["nextCursor"] as const;

export function assertPnlPageMetadata(
  payload: unknown,
  trades: PnlTradeRecord[],
  totalTrades: number,
  status: number,
): asserts payload is PnlPageMetadata {
  const label = "RFQ PnL summary response page";
  if (!isRecord(payload)) throw malformedFieldError(status, label, "limit");
  assertOwnResponseFields(payload, pageFields, pageOptionalFields, status, label);
  if (!isPositiveSafeInteger(payload.limit) || Number(payload.limit) > 100 ||
      !isNonNegativeSafeInteger(payload.returned) || payload.returned !== trades.length ||
      Number(payload.returned) > Number(payload.limit) || totalTrades < Number(payload.returned) ||
      typeof payload.hasMore !== "boolean" || !isIsoUtcTimestampString(payload.asOf)) {
    throw malformedFieldError(status, label, "limit");
  }
  const nextCursor = payload.nextCursor;
  if ((payload.hasMore && payload.returned !== payload.limit) ||
      payload.hasMore !== (nextCursor !== undefined) ||
      (nextCursor !== undefined && (typeof nextCursor !== "string" || nextCursor.length > 512 ||
        !/^pnl1_[A-Za-z0-9_-]+$/.test(nextCursor)))) {
    throw malformedFieldError(status, label, "nextCursor");
  }
  for (let index = 1; index < trades.length; index += 1) {
    const previous = trades[index - 1]!;
    const current = trades[index]!;
    if (previous.realizedAt < current.realizedAt ||
        (previous.realizedAt === current.realizedAt && previous.pnlId < current.pnlId)) {
      throw malformedFieldError(status, label, "returned");
    }
  }
}
