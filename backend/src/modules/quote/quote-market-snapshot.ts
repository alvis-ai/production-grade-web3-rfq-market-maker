import type { QuoteRequest, MarketSnapshot } from "../../shared/types/rfq.js";
import type { MarketDataService } from "../market-data/market-data.service.js";
import { assertUsableSnapshot, marketDataFailure } from "./quote-service-errors.js";

export async function getUsableQuoteSnapshot(
  marketDataService: MarketDataService,
  request: QuoteRequest,
  maxSnapshotAgeMs: number,
  maxSnapshotFutureSkewMs: number,
): Promise<MarketSnapshot> {
  let snapshot: MarketSnapshot;
  try {
    snapshot = await marketDataService.getSnapshot(request);
  } catch (error) {
    throw marketDataFailure(error);
  }
  assertUsableSnapshot(snapshot, maxSnapshotAgeMs, maxSnapshotFutureSkewMs);
  return snapshot;
}
