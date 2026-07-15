import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  assertApiKeyAuthResult,
  type ApiKeyAuthenticator,
  type ApiKeyPrincipal,
  type ApiKeyScope,
} from "../modules/auth/api-key-auth.service.js";
import { MetricsService } from "../modules/metrics/metrics.service.js";
import {
  maxRateLimitClientIdLength,
  rateLimitClientIdPattern,
  type RateLimiter,
  type RateLimitedEndpoint,
} from "../modules/rate-limit/rate-limit.service.js";
import { APIError, toAPIError } from "../shared/errors/api-error.js";
import { isRecord } from "../runtime/environment.js";

const maxTraceIdLength = 128;
const traceIdPattern = /^tr_[A-Za-z0-9._:-]+$/;
const maxStatusIdentifierLength = 128;
const statusIdentifierPattern = /^[A-Za-z0-9_:-]+$/;
const rateLimitDecisionFields = ["allowed", "remaining", "retryAfterSeconds"] as const;

export const maxStatusIdentifierRouteParamLength = maxStatusIdentifierLength + 1;
export type AuthenticatedPrincipals = WeakMap<FastifyRequest, ApiKeyPrincipal>;

interface GatewayBoundaryOptions {
  apiKeyAuthenticator?: ApiKeyAuthenticator;
  allowedOrigins: readonly string[];
  enableHsts: boolean;
  metricsService: MetricsService;
}

export function installGatewayBoundary(
  server: FastifyInstance,
  options: GatewayBoundaryOptions,
): AuthenticatedPrincipals {
  const authenticatedPrincipals: AuthenticatedPrincipals = new WeakMap();
  const requestStartedAt = new WeakMap<FastifyRequest, number>();
  server.addHook("onRequest", async (request, reply) => {
    requestStartedAt.set(request, Date.now());
    reply.header("x-trace-id", requestTraceId(request));
    applySecurityHeaders(reply, options.enableHsts);
    applyCorsHeaders(request, reply, options.allowedOrigins);
    const requiredScope = requiredApiKeyScope(request);
    if (!requiredScope || !options.apiKeyAuthenticator) return;
    const result = options.apiKeyAuthenticator.authenticate(request.headers["x-api-key"]);
    assertApiKeyAuthResult(result);
    if (result.status === "rejected") {
      options.metricsService.recordApiAuthRejection(result.reason);
      throw new APIError("AUTHENTICATION_REQUIRED", "Valid API key required", 401);
    }
    if (!result.principal.scopes.includes(requiredScope)) {
      options.metricsService.recordApiAuthRejection("scope_denied");
      throw new APIError("AUTHORIZATION_DENIED", "API key scope does not permit this operation", 403);
    }
    authenticatedPrincipals.set(request, result.principal);
  });
  server.addHook("onResponse", async (request, reply) => {
    const fields = requestLogFields(request, reply.statusCode, requestStartedAt.get(request));
    requestStartedAt.delete(request);
    if (isProbeRoute(request)) request.log.debug(fields, "HTTP request completed");
    else request.log.info(fields, "HTTP request completed");
  });
  server.setErrorHandler((error, request, reply) => {
    const apiError = frameworkErrorToAPIError(error);
    logRequestFailure(request, apiError);
    return sendError(reply, requestTraceId(request), apiError);
  });
  server.setNotFoundHandler((request, reply) => {
    const error = new APIError("INVALID_REQUEST", "Route not found", 404);
    logRequestFailure(request, error);
    return sendError(reply, requestTraceId(request), error);
  });
  return authenticatedPrincipals;
}

export async function enforceRateLimit(
  rateLimiter: RateLimiter | undefined,
  metricsService: MetricsService,
  endpoint: RateLimitedEndpoint,
  request: FastifyRequest,
  reply: FastifyReply,
  trustProxy: boolean,
  principal?: ApiKeyPrincipal,
): Promise<{ allowed: true } | { allowed: false; response: FastifyReply }> {
  if (!rateLimiter) {
    return { allowed: true };
  }

  const clientId = clientIdForRateLimit(request, trustProxy, principal);
  let decision;
  try {
    decision = await rateLimiter.check({ endpoint, clientId });
    assertRateLimitDecision(decision);
  } catch {
    throw new APIError("RATE_LIMIT_UNAVAILABLE", "Rate limit store unavailable", 503);
  }
  if (decision.allowed) {
    reply.header("x-ratelimit-remaining", decision.remaining.toString());
    return { allowed: true };
  }

  const error = new APIError("RATE_LIMITED", "Too many requests", 429);
  metricsService.recordRateLimited(endpoint);
  return {
    allowed: false,
    response: sendError(reply.header("retry-after", decision.retryAfterSeconds.toString()), requestTraceId(request), error),
  };
}

export function sendError(reply: FastifyReply, traceId: string, error: APIError) {
  return reply.header("x-trace-id", traceId).code(error.statusCode).send(error.toResponse(traceId));
}

export function requestTraceId(request: FastifyRequest): string {
  const incomingTraceId = safeIncomingTraceId(request.headers["x-trace-id"]);
  if (incomingTraceId) {
    return incomingTraceId;
  }
  return `tr_${request.id}`;
}

export function isCorsOriginAllowed(request: FastifyRequest, allowedOrigins: readonly string[]): boolean {
  const origin = requestOrigin(request);
  return !origin || allowedOrigins.includes(origin);
}

export function assertStatusIdentifier(
  value: unknown,
  field: "quoteId" | "hedgeOrderId" | "settlementEventId" | "pnlId" | "snapshotId",
): void {
  if (typeof value !== "string") {
    throw new APIError("INVALID_REQUEST", `${field} must be a primitive string`, 400);
  }
  if (value.trim().length === 0) {
    throw new APIError("INVALID_REQUEST", `${field} must be a non-empty string`, 400);
  }
  if (value.length > maxStatusIdentifierLength) {
    throw new APIError("INVALID_REQUEST", `${field} must be 128 characters or fewer`, 400);
  }
  if (!statusIdentifierPattern.test(value)) {
    throw new APIError("INVALID_REQUEST", `${field} must contain only letters, numbers, underscore, colon, or hyphen`, 400);
  }
}

export function hedgeStatusFailure(error: unknown): APIError {
  return error instanceof APIError
    ? error
    : new APIError("HEDGE_STORE_UNAVAILABLE", "Hedge store unavailable", 503);
}

export function settlementEventStatusFailure(error: unknown): APIError {
  return error instanceof APIError
    ? error
    : new APIError("SETTLEMENT_EVENT_STORE_UNAVAILABLE", "Settlement event store unavailable", 503);
}

export function pnlStoreFailure(error: unknown): APIError {
  return error instanceof APIError
    ? error
    : new APIError("PNL_STORE_UNAVAILABLE", "PnL store unavailable", 503);
}

export function elapsedSeconds(startedAt: number): number {
  return (Date.now() - startedAt) / 1000;
}

function requiredApiKeyScope(request: FastifyRequest): ApiKeyScope | undefined {
  const route = request.routeOptions.url;
  if (request.method === "POST" && route === "/quote") return "quote:write";
  if (request.method === "POST" && route === "/submit") return "submit:write";
  if (request.method === "GET" && route === "/pnl") return "pnl:read";
  if (request.method === "GET" &&
      (route === "/quote/:quoteId" || route === "/hedges/:hedgeOrderId" ||
       route === "/settlements/:settlementEventId")) return "status:read";
  if (request.method === "GET" && route === "/admin/quote-control") return "admin:read";
  if (request.method === "PUT" && route === "/admin/quote-control") return "admin:write";
  if (request.method === "GET" &&
      route === "/admin/quote-control/pairs/:chainId/:tokenA/:tokenB") return "admin:read";
  if (request.method === "PUT" &&
      route === "/admin/quote-control/pairs/:chainId/:tokenA/:tokenB") return "admin:write";
  if (request.method === "GET" && route === "/admin/toxic-flow/scores/:chainId/:user") return "admin:read";
  if (request.method === "PUT" && route === "/admin/toxic-flow/scores/:chainId/:user") return "admin:write";
  return undefined;
}

function requestLogFields(
  request: FastifyRequest,
  statusCode: number,
  startedAt: number | undefined,
): Record<string, unknown> {
  return {
    traceId: requestTraceId(request),
    method: request.method,
    route: requestRoute(request),
    statusCode,
    durationMs: startedAt === undefined ? 0 : Math.max(0, Date.now() - startedAt),
  };
}

function logRequestFailure(request: FastifyRequest, error: APIError): void {
  const fields = {
    traceId: requestTraceId(request),
    method: request.method,
    route: requestRoute(request),
    statusCode: error.statusCode,
    errorCode: error.code,
  };
  if (error.statusCode >= 500) request.log.error(fields, "HTTP request failed");
  else request.log.warn(fields, "HTTP request rejected");
}

function requestRoute(request: FastifyRequest): string {
  const route = request.routeOptions.url;
  return typeof route === "string" && route.length > 0 ? route : "unmatched";
}

function isProbeRoute(request: FastifyRequest): boolean {
  const route = requestRoute(request);
  return route === "/health" || route === "/ready" || route === "/metrics";
}

function applyCorsHeaders(
  request: FastifyRequest,
  reply: FastifyReply,
  allowedOrigins: readonly string[],
): void {
  const origin = requestOrigin(request);
  if (!origin || !allowedOrigins.includes(origin)) return;

  reply.header("access-control-allow-origin", origin);
  reply.header("vary", "Origin");
  reply.header("access-control-allow-methods", "GET,POST,PUT,OPTIONS");
  reply.header("access-control-allow-headers", "content-type,idempotency-key,x-api-key,x-trace-id");
  reply.header("access-control-max-age", "600");
}

function applySecurityHeaders(reply: FastifyReply, enableHsts: boolean): void {
  reply.header("cache-control", "no-store");
  reply.header("x-content-type-options", "nosniff");
  reply.header("x-frame-options", "DENY");
  reply.header("referrer-policy", "no-referrer");
  reply.header("permissions-policy", "camera=(), microphone=(), geolocation=()");
  if (enableHsts) {
    reply.header("strict-transport-security", "max-age=31536000; includeSubDomains");
  }
}

function requestOrigin(request: FastifyRequest): string | undefined {
  const origin = request.headers.origin;
  return typeof origin === "string" && origin.trim().length > 0 ? origin : undefined;
}

function frameworkErrorToAPIError(error: unknown): APIError {
  if (error instanceof APIError) return error;

  const code = frameworkErrorField(error, "code");
  const statusCode = frameworkErrorField(error, "statusCode");
  if (code === "FST_ERR_CTP_BODY_TOO_LARGE" || statusCode === 413) {
    return new APIError("INVALID_REQUEST", "Request body too large", 413);
  }
  if (statusCode === 400) {
    return new APIError("INVALID_REQUEST", "Malformed JSON request body", 400);
  }
  if (statusCode === 415) {
    return new APIError("INVALID_REQUEST", "Request content type must be application/json", 415);
  }
  return toAPIError(error);
}

function frameworkErrorField(error: unknown, field: "code" | "statusCode"): unknown {
  if (!isRecord(error) || !Object.prototype.hasOwnProperty.call(error, field)) return undefined;
  return error[field];
}

function safeIncomingTraceId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maxTraceIdLength || !traceIdPattern.test(normalized)) {
    return undefined;
  }
  return normalized;
}

function clientIdForRateLimit(
  request: FastifyRequest,
  trustProxy: boolean,
  principal?: ApiKeyPrincipal,
): string {
  if (principal) return assertGatewayRateLimitClientId(`api-key:${principal.keyId.toLowerCase()}`);
  if (!trustProxy) return assertGatewayRateLimitClientId(request.ip);

  const forwardedFor = request.headers["x-forwarded-for"];
  if (typeof forwardedFor === "string" && forwardedFor.trim().length > 0) {
    const forwardedClientId = forwardedFor.split(",")[0]?.trim().toLowerCase();
    return forwardedClientId && forwardedClientId.length > 0
      ? assertGatewayRateLimitClientId(forwardedClientId)
      : assertGatewayRateLimitClientId(request.ip);
  }
  return assertGatewayRateLimitClientId(request.ip);
}

function assertGatewayRateLimitClientId(clientId: string): string {
  const normalized = clientId.trim().toLowerCase();
  if (normalized.length === 0) {
    throw new APIError("INVALID_REQUEST", "Rate limit clientId must be a non-empty string", 400);
  }
  if (normalized.length > maxRateLimitClientIdLength) {
    throw new APIError("INVALID_REQUEST", "Rate limit clientId must be 128 characters or fewer", 400);
  }
  if (!rateLimitClientIdPattern.test(normalized)) {
    throw new APIError(
      "INVALID_REQUEST",
      "Rate limit clientId must contain only letters, numbers, dot, underscore, colon, or hyphen",
      400,
    );
  }
  return normalized;
}

function assertRateLimitDecision(decision: unknown): asserts decision is {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
} {
  if (!isRecord(decision)) throw new Error("Rate limiter decision must be an object");
  assertExactOwnFields(decision, rateLimitDecisionFields, "rate limiter decision");
  if (typeof decision.allowed !== "boolean") {
    throw new Error("Rate limiter decision allowed must be a boolean");
  }
  if (typeof decision.remaining !== "number" || !Number.isSafeInteger(decision.remaining) || decision.remaining < 0) {
    throw new Error("Rate limiter decision remaining must be a non-negative safe integer");
  }
  if (typeof decision.retryAfterSeconds !== "number" ||
      !Number.isSafeInteger(decision.retryAfterSeconds) || decision.retryAfterSeconds <= 0) {
    throw new Error("Rate limiter decision retryAfterSeconds must be a positive safe integer");
  }
}

function assertExactOwnFields(value: Record<string, unknown>, fields: readonly string[], path: string): void {
  const expected = new Set(fields);
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) throw new Error(`API ${path} must not include unknown field ${key}`);
  }
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      throw new Error(`API ${path}.${field} must be an own field`);
    }
  }
}
