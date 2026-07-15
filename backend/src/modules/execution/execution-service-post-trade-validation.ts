import type { HedgeIntentStatusResponse } from "../../shared/types/rfq.js";
import { isCanonicalUtcIsoTimestamp } from "../../shared/validation/timestamp.js";
import type { HedgeIntent, HedgeResult } from "../hedge/hedge.service.js";
import type { InventoryPosition } from "../inventory/inventory.service.js";

const maxSafeIdentifierLength = 128;
const safeIdentifierPattern = /^[A-Za-z0-9_:-]+$/;
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

export function assertHedgeResult(result: unknown, expected: HedgeIntent): asserts result is HedgeResult {
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

export function assertInventoryPositionResult(
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
  if (
    hedgeRecord.failureCode !== undefined &&
    (typeof hedgeRecord.failureCode !== "string" || !/^[A-Z0-9_:-]{1,128}$/.test(hedgeRecord.failureCode))
  ) {
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

function assertExecutionAddress(value: unknown, field: "token", path: string): asserts value is `0x${string}` {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`Execution service ${path} ${field} must be a 20-byte hex address`);
  }
}

function assertExecutionAmount(
  value: unknown,
  field: "amount" | "filledAmount",
  path: string,
): asserts value is string {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`Execution service ${path} ${field} must be a positive uint string`);
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
