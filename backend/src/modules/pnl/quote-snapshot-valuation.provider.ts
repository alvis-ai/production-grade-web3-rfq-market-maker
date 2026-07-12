import type { MarketSnapshotStore } from "../market-data/market-snapshot.repository.js";
import { normalizeHumanPrice } from "../pricing/price-normalization.js";
import {
  assertTokenRegistry,
  requireTokenMetadata,
  type TokenRegistry,
} from "../pricing/token-registry.js";
import type { PnlValuation, PnlValuationProvider, RecordPnlInput } from "./pnl.service.js";
import { isCanonicalUtcIsoTimestamp } from "../../shared/validation/timestamp.js";

export class QuoteSnapshotPnlValuationProvider implements PnlValuationProvider {
  constructor(
    private readonly snapshotStore: MarketSnapshotStore,
    private readonly tokenRegistry: TokenRegistry,
  ) {
    assertSnapshotStore(snapshotStore);
    assertTokenRegistry(tokenRegistry);
  }

  async resolve(input: RecordPnlInput): Promise<PnlValuation> {
    const snapshot = await this.snapshotStore.findBySnapshotId(input.snapshotId);
    if (!snapshot) {
      throw new Error(`Pnl market snapshot ${input.snapshotId} was not found`);
    }
    if (snapshot.snapshotId !== input.snapshotId) {
      throw new Error("Pnl market snapshot id must match the requested snapshot");
    }
    if (snapshot.chainId !== input.quote.chainId) {
      throw new Error("Pnl market snapshot chainId must match the settled quote");
    }
    if (
      snapshot.tokenIn.toLowerCase() !== input.quote.tokenIn.toLowerCase() ||
      snapshot.tokenOut.toLowerCase() !== input.quote.tokenOut.toLowerCase()
    ) {
      throw new Error("Pnl market snapshot token pair must match the settled quote");
    }
    try {
      normalizeHumanPrice(snapshot.midPrice);
    } catch {
      throw new Error("Pnl market snapshot midPrice must be a positive canonical decimal");
    }
    if (!isCanonicalUtcIsoTimestamp(snapshot.observedAt)) {
      throw new Error("Pnl market snapshot observedAt must be a canonical UTC ISO timestamp");
    }

    const tokenIn = requireTokenMetadata(
      this.tokenRegistry,
      input.quote.chainId,
      input.quote.tokenIn,
      "Pnl tokenIn",
    );
    const tokenOut = requireTokenMetadata(
      this.tokenRegistry,
      input.quote.chainId,
      input.quote.tokenOut,
      "Pnl tokenOut",
    );

    return {
      snapshotId: snapshot.snapshotId,
      midPrice: snapshot.midPrice,
      tokenInDecimals: tokenIn.decimals,
      tokenOutDecimals: tokenOut.decimals,
      observedAt: snapshot.observedAt,
    };
  }
}

function assertSnapshotStore(value: unknown): asserts value is MarketSnapshotStore {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    typeof (value as Record<string, unknown>).findBySnapshotId !== "function"
  ) {
    throw new Error("Pnl snapshotStore.findBySnapshotId must be a function");
  }
}
