import type { FastifyInstance } from "fastify";
import type { SkeletonExecutionService } from "../modules/execution/execution.service.js";
import {
  assertSubmitReservation,
  type SubmitReservation,
  type SubmitReservationStore,
} from "../modules/execution/submit-reservation.store.js";
import type { HedgeIntentService } from "../modules/hedge/hedge.service.js";
import type { ReadinessService } from "../modules/health/readiness.service.js";
import { MetricsService } from "../modules/metrics/metrics.service.js";
import type { PnlStore, RecordPnlInput } from "../modules/pnl/pnl.service.js";
import { convertBaseUnitAmount, normalizeHumanPrice } from "../modules/pricing/price-normalization.js";
import type { QuoteRepository } from "../modules/quote/quote.repository.js";
import type { QuoteService } from "../modules/quote/quote.service.js";
import type { RateLimiter } from "../modules/rate-limit/rate-limit.service.js";
import type { SettlementEventStore } from "../modules/settlement/settlement-event.service.js";
import { APIError, toAPIError } from "../shared/errors/api-error.js";
import { quoteSnapshotPnlModelDescription, type PnlTradeRecord } from "../shared/types/rfq.js";
import { validateQuoteRequest } from "../shared/validation/quote-request.js";
import { validateSubmitQuoteRequest } from "../shared/validation/submit-request.js";
import { isCanonicalUtcIsoTimestamp } from "../shared/validation/timestamp.js";
import { isRecord } from "../runtime/environment.js";
import {
  assertStatusIdentifier,
  elapsedSeconds,
  enforceRateLimit,
  hedgeStatusFailure,
  isCorsOriginAllowed,
  pnlStoreFailure,
  requestTraceId,
  sendError,
  settlementEventStatusFailure,
  type AuthenticatedPrincipals,
} from "./http-boundary.js";

const retryableSettlementEvidenceReasonCodes = new Set([
  "SETTLEMENT_SENDER_MISMATCH",
  "SETTLEMENT_TARGET_MISMATCH",
  "SETTLEMENT_CALLDATA_MISMATCH",
  "QUOTE_SETTLED_EVENT_MISSING",
  "QUOTE_SETTLED_EVENT_AMBIGUOUS",
]);
const pnlTradeRecordFields = [
  "pnlId",
  "quoteId",
  "settlementEventId",
  "snapshotId",
  "chainId",
  "user",
  "tokenIn",
  "tokenOut",
  "amountIn",
  "amountOut",
  "minAmountOut",
  "nonce",
  "deadline",
  "midPrice",
  "tokenInDecimals",
  "tokenOutDecimals",
  "fairAmountOut",
  "valuationObservedAt",
  "grossPnlTokenOut",
  "grossPnlBps",
  "model",
  "modelDescription",
  "realizedAt",
] as const;

export interface TradingRouteDependencies {
  authenticatedPrincipals: AuthenticatedPrincipals;
  corsAllowedOrigins: readonly string[];
  executionService: SkeletonExecutionService;
  hedgeService: HedgeIntentService;
  metricsService: MetricsService;
  pnlService: PnlStore;
  quoteRepository: QuoteRepository;
  quoteService: QuoteService;
  rateLimiter?: RateLimiter;
  readinessService: ReadinessService;
  settlementEventService: SettlementEventStore;
  submitReservationStore: SubmitReservationStore;
  trustProxy: boolean;
}

export function registerTradingRoutes(server: FastifyInstance, deps: TradingRouteDependencies): void {
  const {
    authenticatedPrincipals,
    corsAllowedOrigins,
    executionService,
    hedgeService,
    metricsService,
    pnlService,
    quoteRepository,
    quoteService,
    rateLimiter,
    readinessService,
    settlementEventService,
    submitReservationStore,
    trustProxy,
  } = deps;

  server.get("/health", async () => ({ status: "ok" }));
  server.options("/*", async (request, reply) => {
    if (!isCorsOriginAllowed(request, corsAllowedOrigins)) {
      return sendError(
        reply,
        requestTraceId(request),
        new APIError("INVALID_REQUEST", "CORS origin is not allowed", 403),
      );
    }
    return reply.code(204).send();
  });
  server.get("/ready", async (_request, reply) => {
    const readiness = await readinessService.check();
    metricsService.recordReadiness(readiness);
    return readiness.status === "degraded" ? reply.code(503).send(readiness) : readiness;
  });
  server.get("/metrics", async (_request, reply) => {
    return reply.type("text/plain").send(metricsService.renderPrometheus());
  });
  server.get("/pnl", async (request, reply) => {
    try {
      const rateLimitResult = await enforceRateLimit(
        rateLimiter,
        metricsService,
        "status",
        request,
        reply,
        trustProxy,
        authenticatedPrincipals.get(request),
      );
      if (!rateLimitResult.allowed) return rateLimitResult.response;
      return await pnlService.summary();
    } catch (error) {
      return sendError(reply, requestTraceId(request), pnlStoreFailure(error));
    }
  });
  server.get("/settlements/:settlementEventId", async (request, reply) => {
    try {
      const rateLimitResult = await enforceRateLimit(
        rateLimiter,
        metricsService,
        "status",
        request,
        reply,
        trustProxy,
        authenticatedPrincipals.get(request),
      );
      if (!rateLimitResult.allowed) return rateLimitResult.response;

      const { settlementEventId } = request.params as { settlementEventId: string };
      assertStatusIdentifier(settlementEventId, "settlementEventId");
      const status = await settlementEventService.getSettlementEvent(settlementEventId);
      if (!status) {
        return sendError(
          reply,
          requestTraceId(request),
          new APIError("SETTLEMENT_EVENT_NOT_FOUND", "Settlement event not found", 404),
        );
      }
      return status;
    } catch (error) {
      return sendError(reply, requestTraceId(request), settlementEventStatusFailure(error));
    }
  });
  server.get("/quote/:quoteId", async (request, reply) => {
    try {
      const rateLimitResult = await enforceRateLimit(
        rateLimiter,
        metricsService,
        "status",
        request,
        reply,
        trustProxy,
        authenticatedPrincipals.get(request),
      );
      if (!rateLimitResult.allowed) return rateLimitResult.response;

      const { quoteId } = request.params as { quoteId: string };
      assertStatusIdentifier(quoteId, "quoteId");
      const status = await quoteService.getQuoteStatus(quoteId);
      return status ?? sendError(
        reply,
        requestTraceId(request),
        new APIError("QUOTE_NOT_FOUND", "Quote not found", 404),
      );
    } catch (error) {
      return sendError(reply, requestTraceId(request), toAPIError(error));
    }
  });
  server.get("/hedges/:hedgeOrderId", async (request, reply) => {
    try {
      const rateLimitResult = await enforceRateLimit(
        rateLimiter,
        metricsService,
        "status",
        request,
        reply,
        trustProxy,
        authenticatedPrincipals.get(request),
      );
      if (!rateLimitResult.allowed) return rateLimitResult.response;

      const { hedgeOrderId } = request.params as { hedgeOrderId: string };
      assertStatusIdentifier(hedgeOrderId, "hedgeOrderId");
      const status = await hedgeService.getHedgeIntent(hedgeOrderId);
      return status ?? sendError(
        reply,
        requestTraceId(request),
        new APIError("HEDGE_NOT_FOUND", "Hedge intent not found", 404),
      );
    } catch (error) {
      return sendError(reply, requestTraceId(request), hedgeStatusFailure(error));
    }
  });
  server.post("/quote", async (request, reply) => {
    const startedAt = Date.now();
    metricsService.recordQuoteRequest();
    try {
      const rateLimitResult = await enforceRateLimit(
        rateLimiter,
        metricsService,
        "quote",
        request,
        reply,
        trustProxy,
        authenticatedPrincipals.get(request),
      );
      if (!rateLimitResult.allowed) {
        metricsService.recordQuoteError();
        return rateLimitResult.response;
      }

      const response = await quoteService.createQuote(validateQuoteRequest(request.body));
      metricsService.recordQuoteResponse();
      return response;
    } catch (error) {
      metricsService.recordQuoteError();
      const apiError = toAPIError(error);
      if (apiError.code === "RISK_REJECTED") {
        metricsService.recordQuoteRejection(apiError.internalReasonCode ?? "RISK_REJECTED");
      }
      return sendError(reply, requestTraceId(request), apiError);
    } finally {
      metricsService.recordQuoteLatency(elapsedSeconds(startedAt));
    }
  });
  server.post("/submit", async (request, reply) => {
    const startedAt = Date.now();
    let quoteId: string | undefined;
    let submitReservation: SubmitReservation | undefined;
    metricsService.recordSubmitRequest();
    try {
      const rateLimitResult = await enforceRateLimit(
        rateLimiter,
        metricsService,
        "submit",
        request,
        reply,
        trustProxy,
        authenticatedPrincipals.get(request),
      );
      if (!rateLimitResult.allowed) {
        metricsService.recordSubmitError();
        return rateLimitResult.response;
      }

      const submitRequest = validateSubmitQuoteRequest(request.body);
      quoteId = await quoteService.requireSubmittableSignedQuote(
        submitRequest.quote,
        submitRequest.signature,
        { allowExpired: submitRequest.txHash !== undefined },
      );
      submitReservation = await acquireSubmitReservation(submitReservationStore, metricsService, quoteId);
      const result = await executionService.submitQuote(submitRequest, { quoteId });
      const pnlRecord = result.settlementEventResult.duplicate
        ? undefined
        : await recordPnlSettlementBestEffort(pnlService, metricsService, quoteRepository, {
            quoteId,
            settlementEventId: result.settlementEventResult.event.settlementEventId,
            realizedAt: result.settlementEventResult.event.observedAt,
            quote: submitRequest.quote,
          });
      metricsService.recordSubmitAccepted();
      if (!result.settlementEventResult.duplicate) {
        metricsService.recordSettlement();
        if (result.hedgeResult) {
          metricsService.recordHedgeIntent();
          metricsService.recordHedgeLag(result.hedgeLagSeconds ?? 0);
        }
        if (result.hedgeFailure) metricsService.recordHedgeIntentError(result.hedgeFailure.reasonCode);
        if (pnlRecord) metricsService.recordPnlTrade(pnlRecord);
        if (result.inventoryPositions) {
          recordInventoryPositionBestEffort(metricsService, result.inventoryPositions.tokenIn);
          recordInventoryPositionBestEffort(metricsService, result.inventoryPositions.tokenOut);
        }
      }
      await markPostSettlementQuoteStatus(quoteService, metricsService, quoteId, {
        txHash: result.response.txHash,
        settlementEventId: result.response.settlementEventId,
        hedgeOrderId: result.response.hedgeOrderId,
        pnlId: pnlRecord?.pnlId,
      });
      return reply.code(202).send({ ...result.response, pnlId: pnlRecord?.pnlId });
    } catch (error) {
      metricsService.recordSubmitError();
      const apiError = toAPIError(error);
      if (quoteId && shouldMarkSettlementRejectionFailed(apiError)) {
        await markSettlementRejectedQuoteFailed(
          quoteService,
          metricsService,
          quoteId,
          settlementRejectionFailureCode(apiError),
        );
      }
      return sendError(reply, requestTraceId(request), apiError);
    } finally {
      if (submitReservation) {
        await releaseSubmitReservationBestEffort(submitReservationStore, metricsService, submitReservation);
      }
      metricsService.recordSubmitLatency(elapsedSeconds(startedAt));
    }
  });
}

async function acquireSubmitReservation(
  store: SubmitReservationStore,
  metricsService: MetricsService,
  quoteId: string,
): Promise<SubmitReservation> {
  try {
    const reservation = await store.acquire(quoteId);
    if (!reservation) {
      metricsService.recordSubmitReservationContention();
      throw new APIError("QUOTE_ALREADY_USED", "Quote already used", 409);
    }
    assertSubmitReservation(reservation);
    if (reservation.quoteId !== quoteId) {
      throw new Error("Submit reservation quoteId does not match requested quote");
    }
    return reservation;
  } catch (error) {
    if (error instanceof APIError) throw error;
    metricsService.recordSubmitReservationError("acquire");
    throw new APIError("SUBMIT_RESERVATION_UNAVAILABLE", "Submit reservation store unavailable", 503);
  }
}

async function releaseSubmitReservationBestEffort(
  store: SubmitReservationStore,
  metricsService: MetricsService,
  reservation: SubmitReservation,
): Promise<void> {
  try {
    await store.release(reservation);
  } catch {
    metricsService.recordSubmitReservationError("release");
  }
}

async function recordPnlSettlementBestEffort(
  pnlService: PnlStore,
  metricsService: MetricsService,
  quoteRepository: QuoteRepository,
  input: Omit<RecordPnlInput, "snapshotId">,
): Promise<PnlTradeRecord | undefined> {
  try {
    const storedQuote = await quoteRepository.findSignedQuoteByQuoteId(input.quoteId);
    if (!storedQuote?.snapshotId) {
      throw new Error(`PnL quote ${input.quoteId} is missing its market snapshot`);
    }
    const recordInput: RecordPnlInput = { ...input, snapshotId: storedQuote.snapshotId };
    const pnlRecord = await pnlService.recordSettlement(recordInput);
    assertPnlRecordResult(pnlRecord, recordInput);
    return pnlRecord;
  } catch {
    metricsService.recordPnlRecordError("PNL_RECORD_FAILED");
    return undefined;
  }
}

function recordInventoryPositionBestEffort(
  metricsService: MetricsService,
  position: Parameters<MetricsService["recordInventoryPosition"]>[0],
): void {
  try {
    metricsService.recordInventoryPosition(position);
  } catch {
    // Settlement has already been accepted; a malformed gauge sample must not change submit semantics.
  }
}

function assertPnlRecordResult(record: unknown, input: RecordPnlInput): asserts record is PnlTradeRecord {
  if (!isRecord(record)) throw new Error("API PnL record result must be an object");

  assertExactOwnFields(record, pnlTradeRecordFields, "PnL record result");
  assertStatusIdentifier(record.pnlId, "pnlId");
  assertStatusIdentifier(record.quoteId, "quoteId");
  assertStatusIdentifier(record.settlementEventId, "settlementEventId");
  assertStatusIdentifier(record.snapshotId, "snapshotId");
  if (record.pnlId !== `pnl_${input.quoteId}` || record.quoteId !== input.quoteId) {
    throw new Error("API PnL record identifiers must match submitted quote");
  }
  if (record.settlementEventId !== input.settlementEventId || record.snapshotId !== input.snapshotId) {
    throw new Error("API PnL record settlement and snapshot identifiers must match attribution input");
  }
  if (typeof record.chainId !== "number" || !Number.isSafeInteger(record.chainId) ||
      record.chainId <= 0 || record.chainId !== input.quote.chainId) {
    throw new Error("API PnL record chainId must match submitted quote");
  }
  assertAddress(record.user, "PnL record user");
  assertAddress(record.tokenIn, "PnL record tokenIn");
  assertAddress(record.tokenOut, "PnL record tokenOut");
  if (record.user.toLowerCase() !== input.quote.user.toLowerCase() ||
      record.tokenIn.toLowerCase() !== input.quote.tokenIn.toLowerCase() ||
      record.tokenOut.toLowerCase() !== input.quote.tokenOut.toLowerCase()) {
    throw new Error("API PnL record quote parties must match submitted quote");
  }
  assertPositiveUIntString(record.amountIn, "PnL record amountIn");
  assertPositiveUIntString(record.amountOut, "PnL record amountOut");
  assertPositiveUIntString(record.minAmountOut, "PnL record minAmountOut");
  assertPositiveUIntString(record.nonce, "PnL record nonce");
  if (record.amountIn !== input.quote.amountIn || record.amountOut !== input.quote.amountOut ||
      record.minAmountOut !== input.quote.minAmountOut || record.nonce !== input.quote.nonce) {
    throw new Error("API PnL record quote amounts must match submitted quote");
  }
  if (BigInt(record.amountOut) < BigInt(record.minAmountOut)) {
    throw new Error("API PnL record amountOut must be greater than or equal to minAmountOut");
  }
  if (typeof record.deadline !== "number" || !Number.isSafeInteger(record.deadline) ||
      record.deadline <= 0 || record.deadline !== input.quote.deadline) {
    throw new Error("API PnL record deadline must match submitted quote");
  }

  if (typeof record.midPrice !== "string") {
    throw new Error("API PnL record midPrice must be a primitive string");
  }
  let normalizedMidPrice;
  try {
    normalizedMidPrice = normalizeHumanPrice(record.midPrice);
  } catch {
    throw new Error("API PnL record midPrice must be a positive canonical decimal");
  }
  for (const field of ["tokenInDecimals", "tokenOutDecimals"] as const) {
    if (!Number.isSafeInteger(record[field]) || (record[field] as number) < 0 || (record[field] as number) > 36) {
      throw new Error(`API PnL record ${field} must be an integer between 0 and 36`);
    }
  }
  assertPositiveUIntString(record.fairAmountOut, "PnL record fairAmountOut");
  const expectedFairAmountOut = convertBaseUnitAmount(
    BigInt(input.quote.amountIn),
    normalizedMidPrice,
    record.tokenInDecimals as number,
    record.tokenOutDecimals as number,
  );
  if (record.fairAmountOut !== expectedFairAmountOut.toString()) {
    throw new Error("API PnL record fairAmountOut must match snapshot valuation");
  }
  if (!isCanonicalUtcIsoTimestamp(record.valuationObservedAt)) {
    throw new Error("API PnL record valuationObservedAt must be a canonical UTC ISO timestamp");
  }

  assertIntString(record.grossPnlTokenOut, "PnL record grossPnlTokenOut");
  const expectedGrossPnl = expectedFairAmountOut - BigInt(input.quote.amountOut);
  if (record.grossPnlTokenOut !== expectedGrossPnl.toString()) {
    throw new Error("API PnL record grossPnlTokenOut must match snapshot valuation");
  }
  if (!Number.isSafeInteger(record.grossPnlBps) ||
      record.grossPnlBps !== calculateGrossPnlBps(expectedFairAmountOut, expectedGrossPnl)) {
    throw new Error("API PnL record grossPnlBps must match snapshot valuation");
  }
  if (record.model !== "quote_snapshot_edge_v1") {
    throw new Error("API PnL record model must be quote_snapshot_edge_v1");
  }
  if (record.modelDescription !== quoteSnapshotPnlModelDescription) {
    throw new Error("API PnL record modelDescription must describe quote_snapshot_edge_v1");
  }
  if (!isCanonicalUtcIsoTimestamp(record.realizedAt) || record.realizedAt !== input.realizedAt) {
    throw new Error("API PnL record realizedAt must match the settlement observation time");
  }
}

async function markPostSettlementQuoteStatus(
  quoteService: QuoteService,
  metricsService: MetricsService,
  quoteId: string,
  metadata: {
    txHash?: `0x${string}`;
    settlementEventId?: string;
    hedgeOrderId?: string;
    pnlId?: string;
  },
): Promise<void> {
  try {
    await quoteService.markQuoteStatus(quoteId, "submitted", metadata);
  } catch {
    metricsService.recordQuoteStatusUpdateError("submitted");
  }
  try {
    await quoteService.markQuoteStatus(quoteId, "settled", metadata);
  } catch {
    metricsService.recordQuoteStatusUpdateError("settled");
  }
}

async function markSettlementRejectedQuoteFailed(
  quoteService: QuoteService,
  metricsService: MetricsService,
  quoteId: string,
  errorCode: string,
): Promise<void> {
  try {
    await quoteService.markQuoteFailed(quoteId, errorCode);
  } catch {
    metricsService.recordQuoteStatusUpdateError("failed");
  }
}

function settlementRejectionFailureCode(error: APIError): string {
  return error.internalReasonCode ?? error.code;
}

function shouldMarkSettlementRejectionFailed(error: APIError): boolean {
  return error.code === "SETTLEMENT_REVERTED" &&
    !retryableSettlementEvidenceReasonCodes.has(error.internalReasonCode ?? "");
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

function assertPositiveUIntString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`API ${field} must be a positive uint string`);
  }
}

function assertIntString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !/^(0|-?[1-9][0-9]*)$/.test(value)) {
    throw new Error(`API ${field} must be an integer string`);
  }
}

function assertAddress(value: unknown, field: string): asserts value is `0x${string}` {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`API ${field} must be a 20-byte hex address`);
  }
}

function calculateGrossPnlBps(fairAmountOut: bigint, grossPnl: bigint): number {
  const grossPnlBps = (grossPnl * 10_000n) / fairAmountOut;
  if (grossPnlBps < BigInt(Number.MIN_SAFE_INTEGER) || grossPnlBps > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("API PnL record grossPnlBps must be a safe integer");
  }
  return Number(grossPnlBps);
}
