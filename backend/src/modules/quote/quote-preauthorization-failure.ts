import type { SaveMarketSnapshotInput } from "../market-data/market-snapshot.repository.js";
import type { RoutePlan } from "../routing/routing.engine.js";
import type { QuoteServiceDeps } from "./quote-service-contract.js";
import type { QuoteIdempotencyReservation } from "./quote-idempotency.store.js";
import type { SaveRequestedQuoteInput } from "./quote.repository.js";

export interface PreAuthorizationFailureInput {
  marketSnapshotInput: SaveMarketSnapshotInput;
  requestedQuote: SaveRequestedQuoteInput;
  idempotency?: QuoteIdempotencyReservation;
  routePlan?: RoutePlan;
  errorCode: string;
}

export async function persistPreAuthorizationFailureBestEffort(
  deps: QuoteServiceDeps,
  input: PreAuthorizationFailureInput,
): Promise<void> {
  try {
    await Promise.all([
      deps.marketSnapshotStore.saveSnapshot(input.marketSnapshotInput),
      input.idempotency
        ? deps.quoteIdempotencyStore?.bindQuote(input.idempotency, input.requestedQuote.quoteId)
        : undefined,
    ]);
    await deps.quoteRepository.saveRequested(input.requestedQuote);
    if (input.routePlan) {
      await deps.quoteRepository.saveRouteDecision({
        quoteId: input.requestedQuote.quoteId,
        principalId: input.requestedQuote.principalId,
        snapshotId: input.requestedQuote.snapshotId,
        routePlan: input.routePlan,
      });
    }
    await deps.quoteRepository.markFailed(input.requestedQuote.quoteId, input.errorCode);
  } catch {
    // The original dependency error remains authoritative; reconciliation handles partial audit state.
  }
}
