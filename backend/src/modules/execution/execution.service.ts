import { keccak256, toBytes } from "viem";
import type {
  HedgeIntentStatusResponse,
  SettlementEventStatusResponse,
  SubmitQuoteRequest,
  SubmitQuoteResponse,
} from "../../shared/types/rfq.js";
import { APIError } from "../../shared/errors/api-error.js";
import { validateSubmitQuoteRequest } from "../../shared/validation/submit-request.js";
import { isCanonicalUtcIsoTimestamp } from "../../shared/validation/timestamp.js";
import type { HedgeIntent, HedgeResult } from "../hedge/hedge.service.js";
import type { HedgeIntentService, HedgeFailureReasonCode } from "../hedge/hedge.service.js";
import {
  DeltaNeutralHedgePlanner,
  type HedgeIntentPlanner,
} from "../hedge/hedge-intent-planner.js";
import type { InventoryPosition, IInventoryService } from "../inventory/inventory.service.js";
import {
  hashSettlementQuote,
  type ApplySettlementEventInput,
  type ApplySettlementEventResult,
  type SettlementEventStore,
} from "../settlement/settlement-event.service.js";
import type { SettlementVerificationResult, SettlementVerifier } from "../settlement/settlement-verifier.service.js";

const maxSafeIdentifierLength = 128;
const safeIdentifierPattern = /^[A-Za-z0-9_:-]+$/;
const executionServiceDepsFields = [
  "hedgeService",
  "inventoryService",
  "settlementEventService",
  "settlementVerifier",
] as const;
const settlementVerificationResultFields = ["status", "verifierVersion", "amountOut"] as const;
const settlementEventResultFields = ["event", "duplicate"] as const;
const hedgeResultFields = ["status", "hedgeOrderId", "record"] as const;
const inventoryPositionFields = ["chainId", "token", "balance"] as const;
const hedgeIntentStatusRequiredFields = [
  "hedgeOrderId",
  "status",
  "settlementEventId",
  "quoteId",
  "chainId",
  "token",
  "side",
  "amount",
  "reason",
  "createdAt",
] as const;
const hedgeIntentStatusOptionalFields = ["externalOrderId", "filledAmount", "failureCode", "updatedAt"] as const;
const settlementEventFields = [
  "settlementEventId",
  "status",
  "quoteId",
  "chainId",
  "txHash",
  "quoteHash",
  "blockNumber",
  "logIndex",
  "user",
  "tokenIn",
  "tokenOut",
  "amountIn",
  "amountOut",
  "nonce",
  "observedAt",
] as const;

export interface ExecutionService {
  submitQuote(request: SubmitQuoteRequest, context: ExecutionContext): Promise<ExecutionResult>;
}

export interface ExecutionServiceDeps {
  hedgeService: HedgeIntentService;
  inventoryService: IInventoryService;
  settlementEventService: SettlementEventStore;
  settlementVerifier: SettlementVerifier;
}

export interface ExecutionContext {
  quoteId: string;
}

export interface SettlementEvidence {
  txHash: `0x${string}`;
  blockNumber: number;
  logIndex: number;
}

export interface SettlementEvidenceProvider {
  resolve(request: SubmitQuoteRequest, context: ExecutionContext): Promise<SettlementEvidence>;
}

export interface ExecutionResult {
  response: SubmitQuoteResponse;
  settlementEventResult: ApplySettlementEventResult;
  inventoryPositions?: {
    tokenIn: InventoryPosition;
    tokenOut: InventoryPosition;
  };
  settlementVerification: SettlementVerificationResult;
  hedgeResult?: HedgeResult;
  hedgeFailure?: HedgeFailure;
  hedgeLagSeconds?: number;
}

export interface HedgeFailure {
  reasonCode: HedgeFailureReasonCode;
}

type CreateHedgeIntentResult =
  | { hedgeResult: HedgeResult; hedgeFailure?: undefined; hedgeLagSeconds: number }
  | { hedgeResult?: undefined; hedgeFailure: HedgeFailure; hedgeLagSeconds?: undefined };

export class SkeletonExecutionService implements ExecutionService {
  private readonly deps: ExecutionServiceDeps;
  private readonly evidenceProvider: SettlementEvidenceProvider;
  private readonly hedgePlanner: HedgeIntentPlanner;

  constructor(
    deps: ExecutionServiceDeps,
    evidenceProvider: SettlementEvidenceProvider = syntheticSettlementEvidenceProvider,
    hedgePlanner: HedgeIntentPlanner = new DeltaNeutralHedgePlanner(),
  ) {
    assertExecutionServiceDeps(deps);
    assertSettlementEvidenceProvider(evidenceProvider);
    assertHedgeIntentPlanner(hedgePlanner);
    this.deps = cloneExecutionServiceDeps(deps);
    this.evidenceProvider = {
      resolve: evidenceProvider.resolve.bind(evidenceProvider),
    };
    this.hedgePlanner = { plan: hedgePlanner.plan.bind(hedgePlanner) };
  }

  async submitQuote(request: SubmitQuoteRequest, context: ExecutionContext): Promise<ExecutionResult> {
    assertExecutionContext(context);
    const validatedRequest = validateSubmitQuoteRequest(request);
    const settlementVerification = await this.verifySettlement(validatedRequest, context);
    const evidence = await this.resolveSettlementEvidence(validatedRequest, context);
    const settlementEventResult = await this.applySettlementEvent({
      quoteId: context.quoteId,
      quote: validatedRequest.quote,
      txHash: evidence.txHash,
      blockNumber: evidence.blockNumber,
      logIndex: evidence.logIndex,
    });

    const inventoryPositions = await this.readInventoryPositions(validatedRequest);
    const { hedgeResult, hedgeFailure, hedgeLagSeconds } = settlementEventResult.duplicate
      ? { hedgeResult: undefined, hedgeFailure: undefined, hedgeLagSeconds: undefined }
      : await this.createHedgeIntent(validatedRequest, context, settlementEventResult.event.settlementEventId);

    return {
      response: {
        status: "accepted",
        txHash: evidence.txHash,
        settlementEventId: settlementEventResult.event.settlementEventId,
        hedgeOrderId: hedgeResult?.hedgeOrderId,
      },
      settlementEventResult,
      inventoryPositions,
      settlementVerification,
      hedgeResult,
      hedgeFailure,
      hedgeLagSeconds,
    };
  }

  private async resolveSettlementEvidence(
    request: SubmitQuoteRequest,
    context: ExecutionContext,
  ): Promise<SettlementEvidence> {
    try {
      const evidence = await this.evidenceProvider.resolve(request, context);
      assertSettlementEvidence(evidence, request);
      return evidence;
    } catch (error) {
      if (error instanceof APIError) throw error;
      throw new APIError("SETTLEMENT_UNAVAILABLE", "Settlement evidence is unavailable", 503);
    }
  }

  private async applySettlementEvent(input: ApplySettlementEventInput): Promise<ApplySettlementEventResult> {
    try {
      const settlementEventResult = await this.deps.settlementEventService.applySettlementEvent(input);
      assertApplySettlementEventResult(settlementEventResult, input);
      return settlementEventResult;
    } catch (error) {
      throw settlementEventStoreFailure(error);
    }
  }

  private async readInventoryPositions(
    request: SubmitQuoteRequest,
  ): Promise<ExecutionResult["inventoryPositions"]> {
    try {
      const [tokenIn, tokenOut] = await Promise.all([
        this.deps.inventoryService.getPosition(request.quote.chainId, request.quote.tokenIn),
        this.deps.inventoryService.getPosition(request.quote.chainId, request.quote.tokenOut),
      ]);
      assertInventoryPositionResult(tokenIn, request.quote.chainId, request.quote.tokenIn, "tokenIn");
      assertInventoryPositionResult(tokenOut, request.quote.chainId, request.quote.tokenOut, "tokenOut");
      return { tokenIn, tokenOut };
    } catch {
      return undefined;
    }
  }

  private async createHedgeIntent(
    request: SubmitQuoteRequest,
    context: ExecutionContext,
    settlementEventId: string,
  ): Promise<CreateHedgeIntentResult> {
    const startedAt = Date.now();
    let intent: HedgeIntent;

    try {
      intent = this.hedgePlanner.plan({
        settlementEventId,
        quoteId: context.quoteId,
        chainId: request.quote.chainId,
        tokenIn: request.quote.tokenIn,
        tokenOut: request.quote.tokenOut,
        amountIn: request.quote.amountIn,
        amountOut: request.quote.amountOut,
      });
    } catch {
      return {
        hedgeFailure: {
          reasonCode: "HEDGE_INTENT_FAILED",
        },
      };
    }

    try {
      const hedgeResult = await this.deps.hedgeService.createHedgeIntent(intent);
      assertHedgeResult(hedgeResult, intent);
      return {
        hedgeResult,
        hedgeLagSeconds: elapsedSeconds(startedAt),
      };
    } catch {
      try {
        await this.deps.hedgeService.recordHedgeFailure?.(intent, "HEDGE_INTENT_FAILED");
      } catch {}
      return {
        hedgeFailure: {
          reasonCode: "HEDGE_INTENT_FAILED",
        },
      };
    }
  }

  private async verifySettlement(
    request: SubmitQuoteRequest,
    context: ExecutionContext,
  ): Promise<SettlementVerificationResult> {
    try {
      const settlementVerification = await this.deps.settlementVerifier.verify({
        quoteId: context.quoteId,
        request,
      });
      assertSettlementVerificationResult(settlementVerification, request.quote.amountOut);
      return settlementVerification;
    } catch (error) {
      throw settlementVerificationFailure(error);
    }
  }
}

function assertHedgeIntentPlanner(value: unknown): asserts value is HedgeIntentPlanner {
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
      typeof (value as Record<string, unknown>).plan !== "function") {
    throw new Error("Execution service hedgePlanner.plan must be a function");
  }
}

const syntheticSettlementEvidenceProvider: SettlementEvidenceProvider = {
  async resolve(request, context) {
    if (request.txHash !== undefined) {
      throw new APIError(
        "INVALID_REQUEST",
        "txHash confirmation is not enabled by the simulated execution provider",
        400,
      );
    }
    return {
      txHash: buildSyntheticTxHash(request, context),
      blockNumber: 0,
      logIndex: 0,
    };
  },
};

function assertSettlementEvidenceProvider(value: unknown): asserts value is SettlementEvidenceProvider {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Execution service evidenceProvider must be an object");
  }
  if (typeof (value as Record<string, unknown>).resolve !== "function") {
    throw new Error("Execution service evidenceProvider.resolve must be a function");
  }
}

function assertSettlementEvidence(
  value: unknown,
  request: SubmitQuoteRequest,
): asserts value is SettlementEvidence {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Execution service settlement evidence must be an object");
  }
  const evidence = value as Record<string, unknown>;
  const fields = ["txHash", "blockNumber", "logIndex"] as const;
  const expected = new Set(fields);
  for (const field of Object.keys(evidence)) {
    if (!expected.has(field as typeof fields[number])) throw new Error(`Execution service settlement evidence contains unknown field ${field}`);
  }
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(evidence, field)) throw new Error(`Execution service settlement evidence.${field} must be an own field`);
  }
  if (typeof evidence.txHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(evidence.txHash)) {
    throw new Error("Execution service settlement evidence.txHash must be a 32-byte hex string");
  }
  if (request.txHash !== undefined && evidence.txHash.toLowerCase() !== request.txHash.toLowerCase()) {
    throw new Error("Execution service settlement evidence.txHash must match the submitted txHash");
  }
  for (const field of ["blockNumber", "logIndex"] as const) {
    if (!Number.isSafeInteger(evidence[field]) || Number(evidence[field]) < 0) {
      throw new Error(`Execution service settlement evidence.${field} must be a non-negative safe integer`);
    }
  }
}

function assertApplySettlementEventResult(
  result: unknown,
  expected: ApplySettlementEventInput,
): asserts result is ApplySettlementEventResult {
  if (typeof result !== "object" || result === null || Array.isArray(result)) {
    throw malformedSettlementEventResult("Execution service settlement event result must be an object");
  }

  assertExactSettlementEventFields(result as Record<string, unknown>, settlementEventResultFields, "settlement event result");
  const settlementEventResult = result as Record<string, unknown>;
  if (typeof settlementEventResult.duplicate !== "boolean") {
    throw malformedSettlementEventResult("Execution service settlement event result.duplicate must be a boolean");
  }

  assertSettlementEventStatusResponse(settlementEventResult.event, expected);
}

function assertHedgeResult(result: unknown, expected: HedgeIntent): asserts result is HedgeResult {
  if (typeof result !== "object" || result === null || Array.isArray(result)) {
    throw new Error("Execution service hedge result must be an object");
  }

  assertExactHedgeFields(result as Record<string, unknown>, hedgeResultFields, "hedge result");
  const hedgeResult = result as Record<string, unknown>;
  if (hedgeResult.status !== "queued") {
    throw new Error("Execution service hedge result status must be queued");
  }
  assertSafeExecutionIdentifier(hedgeResult.hedgeOrderId, "hedgeOrderId", "hedge result");
  assertHedgeIntentStatusResponse(hedgeResult.record, expected, hedgeResult.hedgeOrderId);
}

function assertInventoryPositionResult(
  position: unknown,
  expectedChainId: number,
  expectedToken: string,
  field: "tokenIn" | "tokenOut",
): asserts position is InventoryPosition {
  if (typeof position !== "object" || position === null || Array.isArray(position)) {
    throw new Error(`Execution service inventory position.${field} must be an object`);
  }

  assertExactInventoryPositionFields(position as Record<string, unknown>, `inventory position.${field}`);
  const inventoryPosition = position as Record<string, unknown>;
  if (
    typeof inventoryPosition.chainId !== "number" ||
    !Number.isSafeInteger(inventoryPosition.chainId) ||
    inventoryPosition.chainId <= 0 ||
    inventoryPosition.chainId !== expectedChainId
  ) {
    throw new Error(`Execution service inventory position.${field}.chainId must match submitted quote`);
  }
  assertExecutionAddress(inventoryPosition.token, "token", `inventory position.${field}`);
  if (inventoryPosition.token.toLowerCase() !== expectedToken.toLowerCase()) {
    throw new Error(`Execution service inventory position.${field}.token must match submitted quote`);
  }
  if (typeof inventoryPosition.balance !== "bigint") {
    throw new Error(`Execution service inventory position.${field}.balance must be a bigint`);
  }
}

function assertExactInventoryPositionFields(value: Record<string, unknown>, path: string): void {
  const expected = new Set<string>(inventoryPositionFields);
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) {
      throw new Error(`Execution service ${path} must not include unknown field ${key}`);
    }
  }

  for (const field of inventoryPositionFields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      throw new Error(`Execution service ${path}.${field} must be an own field`);
    }
  }
}

function assertHedgeIntentStatusResponse(
  record: unknown,
  expected: HedgeIntent,
  expectedHedgeOrderId: string,
): asserts record is HedgeIntentStatusResponse {
  if (typeof record !== "object" || record === null || Array.isArray(record)) {
    throw new Error("Execution service hedge result.record must be an object");
  }

  assertExactHedgeFields(
    record as Record<string, unknown>,
    hedgeIntentStatusRequiredFields,
    "hedge result.record",
    hedgeIntentStatusOptionalFields,
  );
  const hedgeRecord = record as Record<string, unknown>;
  assertSafeExecutionIdentifier(hedgeRecord.hedgeOrderId, "hedgeOrderId", "hedge result.record");
  if (hedgeRecord.hedgeOrderId !== expectedHedgeOrderId) {
    throw new Error("Execution service hedge result.record hedgeOrderId must match hedge result hedgeOrderId");
  }
  if (hedgeRecord.status !== "queued") {
    throw new Error("Execution service hedge result.record status must be queued");
  }
  assertSafeExecutionIdentifier(hedgeRecord.settlementEventId, "settlementEventId", "hedge result.record");
  assertSafeExecutionIdentifier(hedgeRecord.quoteId, "quoteId", "hedge result.record");
  if (hedgeRecord.settlementEventId !== expected.settlementEventId || hedgeRecord.quoteId !== expected.quoteId) {
    throw new Error("Execution service hedge result.record identifiers must match hedge intent");
  }
  if (
    typeof hedgeRecord.chainId !== "number" ||
    !Number.isSafeInteger(hedgeRecord.chainId) ||
    hedgeRecord.chainId <= 0 ||
    hedgeRecord.chainId !== expected.chainId
  ) {
    throw new Error("Execution service hedge result.record chainId must match hedge intent");
  }
  assertExecutionAddress(hedgeRecord.token, "token", "hedge result.record");
  if (hedgeRecord.token.toLowerCase() !== expected.token.toLowerCase()) {
    throw new Error("Execution service hedge result.record token must match hedge intent");
  }
  if (hedgeRecord.side !== expected.side) {
    throw new Error("Execution service hedge result.record side must match hedge intent");
  }
  assertExecutionAmount(hedgeRecord.amount, "amount", "hedge result.record");
  if (hedgeRecord.amount !== expected.amount) {
    throw new Error("Execution service hedge result.record amount must match hedge intent");
  }
  if (hedgeRecord.reason !== expected.reason) {
    throw new Error("Execution service hedge result.record reason must match hedge intent");
  }
  if (!isCanonicalUtcIsoTimestamp(hedgeRecord.createdAt)) {
    throw new Error("Execution service hedge result.record createdAt must be a canonical UTC ISO timestamp");
  }
  if (hedgeRecord.externalOrderId !== undefined && !isNonEmptyString(hedgeRecord.externalOrderId)) {
    throw new Error("Execution service hedge result.record externalOrderId must be a non-empty string");
  }
  if (hedgeRecord.filledAmount !== undefined) {
    assertExecutionAmount(hedgeRecord.filledAmount, "filledAmount", "hedge result.record");
  }
  if (hedgeRecord.failureCode !== undefined &&
      (typeof hedgeRecord.failureCode !== "string" || !/^[A-Z0-9_:-]{1,128}$/.test(hedgeRecord.failureCode))) {
    throw new Error("Execution service hedge result.record failureCode must be a stable error code");
  }
  if (hedgeRecord.updatedAt !== undefined && !isCanonicalUtcIsoTimestamp(hedgeRecord.updatedAt)) {
    throw new Error("Execution service hedge result.record updatedAt must be a canonical UTC ISO timestamp");
  }
}

function assertExactHedgeFields(
  value: Record<string, unknown>,
  fields: readonly string[],
  path: string,
  optionalFields: readonly string[] = [],
): void {
  const expected = new Set([...fields, ...optionalFields]);
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) {
      throw new Error(`Execution service ${path} must not include unknown field ${key}`);
    }
  }

  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      throw new Error(`Execution service ${path}.${field} must be an own field`);
    }
  }
  for (const field of optionalFields) {
    if (field in value && !Object.prototype.hasOwnProperty.call(value, field)) {
      throw new Error(`Execution service ${path}.${field} must be an own field`);
    }
  }
}

function assertSettlementEventStatusResponse(
  event: unknown,
  expected: ApplySettlementEventInput,
): asserts event is SettlementEventStatusResponse {
  if (typeof event !== "object" || event === null || Array.isArray(event)) {
    throw malformedSettlementEventResult("Execution service settlement event result.event must be an object");
  }

  assertExactSettlementEventFields(event as Record<string, unknown>, settlementEventFields, "settlement event result.event");
  const settlementEvent = event as Record<string, unknown>;
  if (settlementEvent.status !== "applied") {
    throw malformedSettlementEventResult("Execution service settlement event status must be applied");
  }

  const expectedTxHash = expected.txHash.toLowerCase();
  const expectedLogIndex = expected.logIndex ?? 0;
  const expectedBlockNumber = expected.blockNumber ?? 0;
  const expectedSettlementEventId = `se_${expected.quote.chainId}_${expectedTxHash.slice(2)}_${expectedLogIndex}`;
  assertSafeSettlementEventIdentifier(settlementEvent.settlementEventId, "settlementEventId");
  assertSafeSettlementEventIdentifier(settlementEvent.quoteId, "quoteId");
  if (settlementEvent.settlementEventId !== expectedSettlementEventId) {
    throw malformedSettlementEventResult("Execution service settlement event id must match submitted tx hash");
  }
  if (settlementEvent.quoteId !== expected.quoteId) {
    throw malformedSettlementEventResult("Execution service settlement event quoteId must match execution context");
  }
  if (
    typeof settlementEvent.chainId !== "number" ||
    !Number.isSafeInteger(settlementEvent.chainId) ||
    settlementEvent.chainId <= 0 ||
    settlementEvent.chainId !== expected.quote.chainId
  ) {
    throw malformedSettlementEventResult("Execution service settlement event chainId must match quote chainId");
  }
  assertSettlementEventHash(settlementEvent.txHash, "txHash");
  if (settlementEvent.txHash.toLowerCase() !== expectedTxHash) {
    throw malformedSettlementEventResult("Execution service settlement event txHash must match submitted tx hash");
  }
  assertSettlementEventHash(settlementEvent.quoteHash, "quoteHash");
  if (settlementEvent.quoteHash.toLowerCase() !== hashSettlementQuote(expected.quote).toLowerCase()) {
    throw malformedSettlementEventResult("Execution service settlement event quoteHash must match submitted quote");
  }
  assertNonNegativeSafeInteger(settlementEvent.blockNumber, "blockNumber");
  if (settlementEvent.blockNumber !== expectedBlockNumber) {
    throw malformedSettlementEventResult("Execution service settlement event blockNumber must match submitted event ordinal");
  }
  assertNonNegativeSafeInteger(settlementEvent.logIndex, "logIndex");
  if (settlementEvent.logIndex !== expectedLogIndex) {
    throw malformedSettlementEventResult("Execution service settlement event logIndex must match submitted event ordinal");
  }
  assertSettlementEventAddress(settlementEvent.user, "user");
  assertSettlementEventAddress(settlementEvent.tokenIn, "tokenIn");
  assertSettlementEventAddress(settlementEvent.tokenOut, "tokenOut");
  if (
    settlementEvent.user.toLowerCase() !== expected.quote.user.toLowerCase() ||
    settlementEvent.tokenIn.toLowerCase() !== expected.quote.tokenIn.toLowerCase() ||
    settlementEvent.tokenOut.toLowerCase() !== expected.quote.tokenOut.toLowerCase()
  ) {
    throw malformedSettlementEventResult("Execution service settlement event quote parties must match submitted quote");
  }
  assertSettlementEventAmount(settlementEvent.amountIn, "amountIn");
  assertSettlementEventAmount(settlementEvent.amountOut, "amountOut");
  assertSettlementEventAmount(settlementEvent.nonce, "nonce");
  if (
    settlementEvent.amountIn !== expected.quote.amountIn ||
    settlementEvent.amountOut !== expected.quote.amountOut ||
    settlementEvent.nonce !== expected.quote.nonce
  ) {
    throw malformedSettlementEventResult("Execution service settlement event amounts and nonce must match submitted quote");
  }
  if (!isCanonicalUtcIsoTimestamp(settlementEvent.observedAt)) {
    throw malformedSettlementEventResult("Execution service settlement event observedAt must be a canonical UTC ISO timestamp");
  }
}

function assertExactSettlementEventFields(
  value: Record<string, unknown>,
  fields: readonly string[],
  path: string,
): void {
  const expected = new Set(fields);
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) {
      throw malformedSettlementEventResult(`Execution service ${path} must not include unknown field ${key}`);
    }
  }

  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      throw malformedSettlementEventResult(`Execution service ${path}.${field} must be an own field`);
    }
  }
}

function assertSafeSettlementEventIdentifier(value: unknown, field: "settlementEventId" | "quoteId"): asserts value is string {
  try {
    assertSafeExecutionIdentifier(value, field, "settlement event");
  } catch (error) {
    throw malformedSettlementEventResult(error instanceof Error ? error.message : `Execution service settlement event ${field} is invalid`);
  }
}

function assertSettlementEventHash(value: unknown, field: "txHash" | "quoteHash"): asserts value is `0x${string}` {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw malformedSettlementEventResult(`Execution service settlement event ${field} must be a 32-byte hex string`);
  }
}

function assertNonNegativeSafeInteger(value: unknown, field: "blockNumber" | "logIndex"): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw malformedSettlementEventResult(
      `Execution service settlement event ${field} must be a non-negative safe integer`,
    );
  }
}

function assertSettlementEventAddress(value: unknown, field: "user" | "tokenIn" | "tokenOut"): asserts value is `0x${string}` {
  try {
    assertExecutionAddress(value, field, "settlement event");
  } catch (error) {
    throw malformedSettlementEventResult(error instanceof Error ? error.message : `Execution service settlement event ${field} is invalid`);
  }
}

function assertSettlementEventAmount(value: unknown, field: "amountIn" | "amountOut" | "nonce"): asserts value is string {
  try {
    assertExecutionAmount(value, field, "settlement event");
  } catch (error) {
    throw malformedSettlementEventResult(error instanceof Error ? error.message : `Execution service settlement event ${field} is invalid`);
  }
}

function assertSafeExecutionIdentifier(
  value: unknown,
  field: "hedgeOrderId" | "settlementEventId" | "quoteId",
  path: string,
): asserts value is string {
  if (typeof value !== "string") {
    throw new Error(`Execution service ${path} ${field} must be a primitive string`);
  }
  if (value.trim().length === 0) {
    throw new Error(`Execution service ${path} ${field} must be non-empty`);
  }
  if (value.length > maxSafeIdentifierLength) {
    throw new Error(`Execution service ${path} ${field} must be 128 characters or fewer`);
  }
  if (!safeIdentifierPattern.test(value)) {
    throw new Error(
      `Execution service ${path} ${field} must contain only letters, numbers, underscore, colon, or hyphen`,
    );
  }
}

function assertExecutionAddress(
  value: unknown,
  field: "user" | "tokenIn" | "tokenOut" | "token",
  path: string,
): asserts value is `0x${string}` {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`Execution service ${path} ${field} must be a 20-byte hex address`);
  }
}

function assertExecutionAmount(
  value: unknown,
  field: "amountIn" | "amountOut" | "amount" | "filledAmount" | "nonce",
  path: string,
): asserts value is string {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`Execution service ${path} ${field} must be a positive uint string`);
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function buildSyntheticTxHash(request: SubmitQuoteRequest, context: ExecutionContext): `0x${string}` {
  assertExecutionContext(context);
  const validatedRequest = validateSubmitQuoteRequest(request);
  if (validatedRequest.txHash !== undefined) {
    throw new APIError("INVALID_REQUEST", "Synthetic tx hash generation does not accept txHash", 400);
  }
  const payload = JSON.stringify({
    quoteId: context.quoteId,
    quote: validatedRequest.quote,
    signature: validatedRequest.signature,
  });

  return keccak256(toBytes(payload));
}

function elapsedSeconds(startedAtMs: number): number {
  return (Date.now() - startedAtMs) / 1000;
}

function cloneExecutionServiceDeps(deps: ExecutionServiceDeps): ExecutionServiceDeps {
  return { ...deps };
}

function assertExecutionServiceDeps(deps: ExecutionServiceDeps): void {
  assertRecord(deps, "deps");
  assertOwnFields(deps, executionServiceDepsFields, "deps");
  assertDependencyMethod(deps.hedgeService, "hedgeService", "createHedgeIntent");
  assertDependencyMethod(deps.inventoryService, "inventoryService", "getPosition");
  assertDependencyMethod(deps.settlementEventService, "settlementEventService", "applySettlementEvent");
  assertDependencyMethod(deps.settlementVerifier, "settlementVerifier", "verify");
}

function assertDependencyMethod(
  dependency: unknown,
  dependencyName: keyof ExecutionServiceDeps,
  methodName: string,
): void {
  assertRecord(dependency, dependencyName);
  const method = (dependency as Record<string, unknown>)[methodName];
  if (typeof method !== "function") {
    throw new Error(`Execution service ${dependencyName}.${methodName} must be a function`);
  }
}

function assertRecord(value: unknown, field: string): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Execution service ${field} must be an object`);
  }
}

function assertOwnFields(value: object, fields: readonly string[], path: string): void {
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      throw new Error(`Execution service ${path}.${field} must be an own field`);
    }
  }
}

function assertExactOwnFields(value: Record<string, unknown>, fields: readonly string[], path: string): void {
  const expected = new Set(fields);
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) {
      throw malformedSettlementVerificationResult(`Execution service ${path} must not include unknown field ${key}`);
    }
  }

  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      throw malformedSettlementVerificationResult(`Execution service ${path}.${field} must be an own field`);
    }
  }
}

function assertSettlementVerificationResult(
  result: unknown,
  expectedAmountOut: string,
): asserts result is SettlementVerificationResult {
  if (typeof result !== "object" || result === null || Array.isArray(result)) {
    throw malformedSettlementVerificationResult("Execution service settlement verification result must be an object");
  }

  assertExactOwnFields(
    result as Record<string, unknown>,
    settlementVerificationResultFields,
    "settlement verification result",
  );
  const verification = result as Record<string, unknown>;
  if (verification.status !== "verified") {
    throw malformedSettlementVerificationResult("Execution service settlement verification status must be verified");
  }
  if (typeof verification.verifierVersion !== "string" || verification.verifierVersion.trim().length === 0) {
    throw malformedSettlementVerificationResult(
      "Execution service settlement verification verifierVersion must be a non-empty string",
    );
  }
  if (typeof verification.amountOut !== "string" || !/^[1-9][0-9]*$/.test(verification.amountOut)) {
    throw malformedSettlementVerificationResult(
      "Execution service settlement verification amountOut must be a positive uint string",
    );
  }
  if (verification.amountOut !== expectedAmountOut) {
    throw malformedSettlementVerificationResult("Execution service settlement verification amountOut must match quote amountOut");
  }
}

function assertExecutionContext(context: ExecutionContext): void {
  if (typeof context !== "object" || context === null || Array.isArray(context)) {
    throw new APIError("INVALID_REQUEST", "Execution context must be an object", 400);
  }
  if (!Object.prototype.hasOwnProperty.call(context, "quoteId")) {
    throw new APIError("INVALID_REQUEST", "Execution context quoteId must be an own field", 400);
  }

  const quoteId = context.quoteId;
  if (typeof quoteId !== "string") {
    throw new APIError("INVALID_REQUEST", "Execution context quoteId must be a primitive string", 400);
  }
  if (quoteId.trim().length === 0) {
    throw new APIError("INVALID_REQUEST", "Execution context quoteId must be a non-empty string", 400);
  }
  if (quoteId.length > maxSafeIdentifierLength) {
    throw new APIError("INVALID_REQUEST", "Execution context quoteId must be 128 characters or fewer", 400);
  }
  if (!safeIdentifierPattern.test(quoteId)) {
    throw new APIError(
      "INVALID_REQUEST",
      "Execution context quoteId must contain only letters, numbers, underscore, colon, or hyphen",
      400,
    );
  }
}

function malformedSettlementVerificationResult(message: string): APIError {
  return new APIError("SETTLEMENT_UNAVAILABLE", message, 503);
}

function malformedSettlementEventResult(message: string): APIError {
  return new APIError("SETTLEMENT_EVENT_STORE_UNAVAILABLE", message, 503);
}

function settlementVerificationFailure(error: unknown): APIError {
  if (error instanceof APIError) {
    return error;
  }

  return new APIError("SETTLEMENT_UNAVAILABLE", "Settlement verifier unavailable", 503);
}

function settlementEventStoreFailure(error: unknown): APIError {
  if (error instanceof APIError) {
    return error;
  }

  return new APIError("SETTLEMENT_EVENT_STORE_UNAVAILABLE", "Settlement event store unavailable", 503);
}
