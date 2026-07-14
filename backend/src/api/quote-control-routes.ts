import type { FastifyInstance } from "fastify";
import type { MetricsService } from "../modules/metrics/metrics.service.js";
import {
  QuoteControlConflictError,
  assertQuoteControlState,
  normalizeQuoteControlUpdate,
  type QuoteControlStore,
} from "../modules/quote-control/quote-control.store.js";
import type { RateLimiter } from "../modules/rate-limit/rate-limit.service.js";
import { APIError } from "../shared/errors/api-error.js";
import { localPrincipalId } from "../shared/validation/principal-id.js";
import {
  enforceRateLimit,
  requestTraceId,
  sendError,
  type AuthenticatedPrincipals,
} from "./http-boundary.js";

export interface QuoteControlRouteDependencies {
  authenticatedPrincipals: AuthenticatedPrincipals;
  metricsService: MetricsService;
  quoteControlStore: QuoteControlStore;
  rateLimiter?: RateLimiter;
  trustProxy: boolean;
}

export function registerQuoteControlRoutes(
  server: FastifyInstance,
  deps: QuoteControlRouteDependencies,
): void {
  server.get("/admin/quote-control", async (request, reply) => {
    try {
      const principal = deps.authenticatedPrincipals.get(request);
      const limited = await enforceRateLimit(
        deps.rateLimiter,
        deps.metricsService,
        "status",
        request,
        reply,
        deps.trustProxy,
        principal,
      );
      if (!limited.allowed) return limited.response;
      const state = await deps.quoteControlStore.getState();
      assertQuoteControlState(state);
      deps.metricsService.recordQuoteControlState(state.paused);
      return state;
    } catch (error) {
      deps.metricsService.recordQuoteControlError("read");
      return sendError(reply, requestTraceId(request), quoteControlFailure(error));
    }
  });

  server.put("/admin/quote-control", async (request, reply) => {
    const principal = deps.authenticatedPrincipals.get(request);
    try {
      const limited = await enforceRateLimit(
        deps.rateLimiter,
        deps.metricsService,
        "status",
        request,
        reply,
        deps.trustProxy,
        principal,
      );
      if (!limited.allowed) return limited.response;

      let input;
      try {
        input = normalizeQuoteControlUpdate(request.body);
      } catch {
        throw new APIError("INVALID_REQUEST", "Invalid quote control update", 400);
      }
      const actor = principal ? `${principal.principalId}:${principal.keyId}` : localPrincipalId;
      const state = await deps.quoteControlStore.updateState(input, actor);
      assertQuoteControlState(state);
      deps.metricsService.recordQuoteControlState(state.paused);
      deps.metricsService.recordQuoteControlUpdate();
      return state;
    } catch (error) {
      deps.metricsService.recordQuoteControlError("update");
      return sendError(reply, requestTraceId(request), quoteControlFailure(error));
    }
  });
}

function quoteControlFailure(error: unknown): APIError {
  if (error instanceof APIError) return error;
  if (error instanceof QuoteControlConflictError) {
    return new APIError("QUOTE_CONTROL_CONFLICT", "Quote control state changed; reload and retry", 409);
  }
  return new APIError("QUOTE_CONTROL_UNAVAILABLE", "Quote control store unavailable", 503);
}
