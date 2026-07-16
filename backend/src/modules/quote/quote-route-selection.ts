import type { MarketSnapshot, QuoteRequest } from "../../shared/types/rfq.js";
import type { RoutePlan } from "../routing/routing.engine.js";
import type { QuoteServiceDeps } from "./quote-service-contract.js";
import { quoteFailureCode, quoteStoreFailure, routingFailure } from "./quote-service-errors.js";
import { assertRoutePlan } from "./quote-service-result-validation.js";

interface SelectAndPersistQuoteRouteInput {
  quoteId: string;
  principalId: string;
  request: QuoteRequest;
  snapshot: MarketSnapshot;
}

type QuoteRouteDeps = Pick<QuoteServiceDeps, "quoteRepository" | "routingEngine">;

export async function selectAndPersistQuoteRoute(
  deps: QuoteRouteDeps,
  input: SelectAndPersistQuoteRouteInput,
): Promise<RoutePlan> {
  try {
    return await selectAndPersistQuoteRouteUnchecked(deps, input);
  } catch (error) {
    try {
      await deps.quoteRepository.markFailed(input.quoteId, quoteFailureCode(error));
    } catch {
      // Preserve the route or persistence failure; reconciliation can recover requested quotes later.
    }
    throw error;
  }
}

async function selectAndPersistQuoteRouteUnchecked(
  deps: QuoteRouteDeps,
  input: SelectAndPersistQuoteRouteInput,
): Promise<RoutePlan> {
  let routePlan: RoutePlan;
  try {
    const result = await deps.routingEngine.selectRoute({ request: input.request, snapshot: input.snapshot });
    assertRoutePlan(result, input.request);
    routePlan = result;
  } catch (error) {
    throw routingFailure(error);
  }

  try {
    await deps.quoteRepository.saveRouteDecision({
      quoteId: input.quoteId,
      principalId: input.principalId,
      snapshotId: input.snapshot.snapshotId,
      routePlan,
    });
  } catch (error) {
    throw quoteStoreFailure(error);
  }
  return routePlan;
}
