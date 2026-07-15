import { APIError } from "../../shared/errors/api-error.js";
import type {
  SettlementEventStatusResponse,
  SubmitQuoteRequest,
} from "../../shared/types/rfq.js";
import { isCanonicalUtcIsoTimestamp } from "../../shared/validation/timestamp.js";
import {
  hashSettlementQuote,
  type ApplySettlementEventInput,
  type ApplySettlementEventResult,
} from "../settlement/settlement-event.service.js";
import type { SettlementVerificationResult } from "../settlement/settlement-verifier.service.js";
import type { SettlementEvidence } from "./execution-service-contract.js";

const maxSafeIdentifierLength = 128;
const safeIdentifierPattern = /^[A-Za-z0-9_:-]+$/;
const settlementVerificationResultFields = ["status", "verifierVersion", "amountOut"] as const;
const settlementEventResultFields = ["event", "duplicate"] as const;
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

export function assertSettlementEvidence(
  value: unknown,
  request: SubmitQuoteRequest,
): asserts value is SettlementEvidence {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Execution service settlement evidence must be an object");
  }
  const evidence = value as Record<string, unknown>;
  const fields = ["txHash", "blockNumber", "logIndex", "settledAt"] as const;
  const expected = new Set(fields);
  for (const field of Object.keys(evidence)) {
    if (!expected.has(field as typeof fields[number])) {
      throw new Error(`Execution service settlement evidence contains unknown field ${field}`);
    }
  }
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(evidence, field)) {
      throw new Error(`Execution service settlement evidence.${field} must be an own field`);
    }
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
  if (typeof evidence.settledAt !== "string" || !isCanonicalUtcIsoTimestamp(evidence.settledAt)) {
    throw new Error("Settlement evidence settledAt must be a canonical UTC ISO timestamp");
  }
}

export function assertApplySettlementEventResult(
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

export function assertSettlementVerificationResult(
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
    throw malformedSettlementVerificationResult(
      "Execution service settlement verification amountOut must match quote amountOut",
    );
  }
}

export function settlementVerificationFailure(error: unknown): APIError {
  if (error instanceof APIError) return error;
  return new APIError("SETTLEMENT_UNAVAILABLE", "Settlement verifier unavailable", 503);
}

export function settlementEventStoreFailure(error: unknown): APIError {
  if (error instanceof APIError) return error;
  return new APIError("SETTLEMENT_EVENT_STORE_UNAVAILABLE", "Settlement event store unavailable", 503);
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
    throw malformedSettlementEventResult(
      "Execution service settlement event blockNumber must match submitted event ordinal",
    );
  }
  assertNonNegativeSafeInteger(settlementEvent.logIndex, "logIndex");
  if (settlementEvent.logIndex !== expectedLogIndex) {
    throw malformedSettlementEventResult(
      "Execution service settlement event logIndex must match submitted event ordinal",
    );
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
    throw malformedSettlementEventResult(
      "Execution service settlement event amounts and nonce must match submitted quote",
    );
  }
  if (!isCanonicalUtcIsoTimestamp(settlementEvent.observedAt)) {
    throw malformedSettlementEventResult(
      "Execution service settlement event observedAt must be a canonical UTC ISO timestamp",
    );
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

function assertSafeSettlementEventIdentifier(
  value: unknown,
  field: "settlementEventId" | "quoteId",
): asserts value is string {
  try {
    assertSafeExecutionIdentifier(value, field, "settlement event");
  } catch (error) {
    throw malformedSettlementEventResult(
      error instanceof Error ? error.message : `Execution service settlement event ${field} is invalid`,
    );
  }
}

function assertSettlementEventHash(
  value: unknown,
  field: "txHash" | "quoteHash",
): asserts value is `0x${string}` {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw malformedSettlementEventResult(
      `Execution service settlement event ${field} must be a 32-byte hex string`,
    );
  }
}

function assertNonNegativeSafeInteger(
  value: unknown,
  field: "blockNumber" | "logIndex",
): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw malformedSettlementEventResult(
      `Execution service settlement event ${field} must be a non-negative safe integer`,
    );
  }
}

function assertSettlementEventAddress(
  value: unknown,
  field: "user" | "tokenIn" | "tokenOut",
): asserts value is `0x${string}` {
  try {
    assertExecutionAddress(value, field, "settlement event");
  } catch (error) {
    throw malformedSettlementEventResult(
      error instanceof Error ? error.message : `Execution service settlement event ${field} is invalid`,
    );
  }
}

function assertSettlementEventAmount(
  value: unknown,
  field: "amountIn" | "amountOut" | "nonce",
): asserts value is string {
  try {
    assertExecutionAmount(value, field, "settlement event");
  } catch (error) {
    throw malformedSettlementEventResult(
      error instanceof Error ? error.message : `Execution service settlement event ${field} is invalid`,
    );
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

function assertExactOwnFields(value: Record<string, unknown>, fields: readonly string[], path: string): void {
  const expected = new Set(fields);
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) {
      throw malformedSettlementVerificationResult(
        `Execution service ${path} must not include unknown field ${key}`,
      );
    }
  }
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      throw malformedSettlementVerificationResult(`Execution service ${path}.${field} must be an own field`);
    }
  }
}

function malformedSettlementVerificationResult(message: string): APIError {
  return new APIError("SETTLEMENT_UNAVAILABLE", message, 503);
}

function malformedSettlementEventResult(message: string): APIError {
  return new APIError("SETTLEMENT_EVENT_STORE_UNAVAILABLE", message, 503);
}
