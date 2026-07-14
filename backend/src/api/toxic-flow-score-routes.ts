import type { FastifyInstance } from "fastify";
import type { MetricsService } from "../modules/metrics/metrics.service.js";
import type { RateLimiter } from "../modules/rate-limit/rate-limit.service.js";
import {
  ToxicFlowScoreConflictError,
  assertToxicFlowScoreState,
  normalizeToxicFlowScoreKey,
  normalizeToxicFlowScoreUpdate,
  type ToxicFlowScoreKey,
  type ToxicFlowScoreStore,
} from "../modules/risk/toxic-flow-score.store.js";
import { APIError } from "../shared/errors/api-error.js";
import { localPrincipalId } from "../shared/validation/principal-id.js";
import {
  enforceRateLimit,
  requestTraceId,
  sendError,
  type AuthenticatedPrincipals,
} from "./http-boundary.js";

export interface ToxicFlowScoreRouteDependencies {
  authenticatedPrincipals: AuthenticatedPrincipals;
  metricsService: MetricsService;
  rateLimiter?: RateLimiter;
  toxicFlowScoreStore: ToxicFlowScoreStore;
  trustProxy: boolean;
}

export function registerToxicFlowScoreRoutes(
  server: FastifyInstance,
  deps: ToxicFlowScoreRouteDependencies,
): void {
  server.get("/admin/toxic-flow/scores/:chainId/:user", async (request, reply) => {
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
      const key = scoreKeyFromParams(request.params);
      const state = await deps.toxicFlowScoreStore.getScore(key);
      if (state) assertToxicFlowScoreState(state);
      return { key, state };
    } catch (error) {
      deps.metricsService.recordToxicFlowScoreError("read");
      return sendError(reply, requestTraceId(request), scoreFailure(error));
    }
  });

  server.put("/admin/toxic-flow/scores/:chainId/:user", async (request, reply) => {
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
      const key = scoreKeyFromParams(request.params);
      let input;
      try {
        input = normalizeToxicFlowScoreUpdate(request.body);
      } catch {
        throw new APIError("INVALID_REQUEST", "Invalid toxic flow score update", 400);
      }
      const actor = principal ? `${principal.principalId}:${principal.keyId}` : localPrincipalId;
      const state = await deps.toxicFlowScoreStore.updateScore(key, input, actor);
      assertToxicFlowScoreState(state);
      deps.metricsService.recordToxicFlowScoreUpdate();
      return state;
    } catch (error) {
      deps.metricsService.recordToxicFlowScoreError("update");
      return sendError(reply, requestTraceId(request), scoreFailure(error));
    }
  });
}

function scoreKeyFromParams(value: unknown): ToxicFlowScoreKey {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new APIError("INVALID_REQUEST", "Invalid toxic flow score key", 400);
  }
  const params = value as Record<string, unknown>;
  if (typeof params.chainId !== "string" || !/^[1-9][0-9]*$/.test(params.chainId)) {
    throw new APIError("INVALID_REQUEST", "Invalid toxic flow score key", 400);
  }
  try {
    return normalizeToxicFlowScoreKey({ chainId: Number(params.chainId), user: params.user });
  } catch {
    throw new APIError("INVALID_REQUEST", "Invalid toxic flow score key", 400);
  }
}

function scoreFailure(error: unknown): APIError {
  if (error instanceof APIError) return error;
  if (error instanceof ToxicFlowScoreConflictError) {
    return new APIError(
      "TOXIC_FLOW_SCORE_CONFLICT",
      "Toxic flow score changed; reload and retry",
      409,
    );
  }
  return new APIError("TOXIC_FLOW_SCORE_UNAVAILABLE", "Toxic flow score store unavailable", 503);
}
