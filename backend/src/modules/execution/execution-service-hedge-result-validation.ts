import type { HedgeIntentStatusResponse } from "../../shared/types/rfq.js";
import { isCanonicalUtcIsoTimestamp } from "../../shared/validation/timestamp.js";
import type { HedgeIntent, HedgeResult } from "../hedge/hedge.service.js";

const maxSafeIdentifierLength = 128;
const safeIdentifierPattern = /^[A-Za-z0-9_:-]+$/;
const hedgeResultFields = ["status", "hedgeOrderId", "record"] as const;
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
const hedgeIntentStatusOptionalFields = [
  "externalOrderId",
  "filledAmount",
  "venue",
  "venueSymbol",
  "venueOrderId",
  "executionEvidenceVersion",
  "executedQuoteQuantity",
  "feeReconciliationStatus",
  "feeLastErrorCode",
  "feeReconciledAt",
  "commissionTotals",
  "failureCode",
  "updatedAt",
] as const;

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
  assertOptionalExecutionEvidence(hedgeRecord);
  assertOptionalFeeEvidence(hedgeRecord);
  if (hedgeRecord.failureCode !== undefined && !isStableErrorCode(hedgeRecord.failureCode)) {
    throw new Error("Execution service hedge result.record failureCode must be a stable error code");
  }
  if (hedgeRecord.updatedAt !== undefined && !isCanonicalUtcIsoTimestamp(hedgeRecord.updatedAt)) {
    throw new Error("Execution service hedge result.record updatedAt must be a canonical UTC ISO timestamp");
  }
}

function assertOptionalExecutionEvidence(hedgeRecord: Record<string, unknown>): void {
  if (hedgeRecord.externalOrderId !== undefined && !isNonEmptyString(hedgeRecord.externalOrderId)) {
    throw new Error("Execution service hedge result.record externalOrderId must be a non-empty string");
  }
  if (hedgeRecord.filledAmount !== undefined) {
    assertExecutionAmount(hedgeRecord.filledAmount, "filledAmount", "hedge result.record");
  }
  if (hedgeRecord.venue !== undefined && !isBoundedNonEmptyString(hedgeRecord.venue, 128)) {
    throw new Error("Execution service hedge result.record venue must be a bounded non-empty string");
  }
  if (
    hedgeRecord.venueSymbol !== undefined &&
    (typeof hedgeRecord.venueSymbol !== "string" || !/^[A-Z0-9._-]{3,32}$/.test(hedgeRecord.venueSymbol))
  ) {
    throw new Error("Execution service hedge result.record venueSymbol is invalid");
  }
  if (hedgeRecord.venueOrderId !== undefined && !isPositiveSafeIntegerString(hedgeRecord.venueOrderId)) {
    throw new Error("Execution service hedge result.record venueOrderId is invalid");
  }
  if (
    hedgeRecord.executionEvidenceVersion !== undefined &&
    hedgeRecord.executionEvidenceVersion !== "base-only-v1" &&
    hedgeRecord.executionEvidenceVersion !== "base-and-quote-v2"
  ) {
    throw new Error("Execution service hedge result.record executionEvidenceVersion is invalid");
  }
  if (
    hedgeRecord.executedQuoteQuantity !== undefined &&
    !isPositiveCanonicalDecimal(hedgeRecord.executedQuoteQuantity, 18)
  ) {
    throw new Error("Execution service hedge result.record executedQuoteQuantity is invalid");
  }
  if (
    (hedgeRecord.executionEvidenceVersion === "base-and-quote-v2") !==
    (hedgeRecord.executedQuoteQuantity !== undefined)
  ) {
    throw new Error("Execution service hedge result.record quote execution evidence is inconsistent");
  }
}

function assertOptionalFeeEvidence(hedgeRecord: Record<string, unknown>): void {
  if (
    hedgeRecord.feeReconciliationStatus !== undefined &&
    hedgeRecord.feeReconciliationStatus !== "pending" &&
    hedgeRecord.feeReconciliationStatus !== "complete"
  ) {
    throw new Error("Execution service hedge result.record feeReconciliationStatus is invalid");
  }
  if (hedgeRecord.feeLastErrorCode !== undefined && !isStableErrorCode(hedgeRecord.feeLastErrorCode)) {
    throw new Error("Execution service hedge result.record feeLastErrorCode is invalid");
  }
  if (hedgeRecord.feeReconciledAt !== undefined && !isCanonicalUtcIsoTimestamp(hedgeRecord.feeReconciledAt)) {
    throw new Error("Execution service hedge result.record feeReconciledAt is invalid");
  }
  if (hedgeRecord.commissionTotals !== undefined) {
    assertCommissionTotals(hedgeRecord.commissionTotals);
  }
  if (
    hedgeRecord.feeReconciliationStatus === "complete" &&
    (hedgeRecord.executionEvidenceVersion !== "base-and-quote-v2" ||
      hedgeRecord.venueOrderId === undefined ||
      hedgeRecord.feeReconciledAt === undefined ||
      hedgeRecord.commissionTotals === undefined)
  ) {
    throw new Error("Execution service hedge result.record completed fee evidence is incomplete");
  }
  if (hedgeRecord.feeLastErrorCode !== undefined && hedgeRecord.feeReconciliationStatus !== "pending") {
    throw new Error("Execution service hedge result.record fee error state is inconsistent");
  }
}

function assertCommissionTotals(value: unknown): void {
  if (!Array.isArray(value) || value.length > 64) {
    throw new Error("Execution service hedge result.record commissionTotals is invalid");
  }
  let previousAsset = "";
  for (const total of value) {
    if (
      typeof total !== "object" ||
      total === null ||
      Array.isArray(total) ||
      Object.keys(total).length !== 2 ||
      !Object.prototype.hasOwnProperty.call(total, "asset") ||
      !Object.prototype.hasOwnProperty.call(total, "quantity")
    ) {
      throw new Error("Execution service hedge result.record commissionTotals is invalid");
    }
    const entry = total as Record<string, unknown>;
    if (
      typeof entry.asset !== "string" ||
      entry.asset.length === 0 ||
      entry.asset.length > 64 ||
      /[\s\p{Cc}]/u.test(entry.asset) ||
      entry.asset <= previousAsset ||
      !isCanonicalDecimal(entry.quantity, 36)
    ) {
      throw new Error("Execution service hedge result.record commissionTotals is invalid");
    }
    previousAsset = entry.asset;
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
  if (value.length > maxSafeIdentifierLength || !safeIdentifierPattern.test(value)) {
    throw new Error(
      `Execution service ${path} ${field} must contain only letters, numbers, underscore, colon, or hyphen ` +
      "and be 128 characters or fewer",
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

function isBoundedNonEmptyString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

function isPositiveSafeIntegerString(value: unknown): value is string {
  return typeof value === "string" && /^[1-9][0-9]{0,15}$/.test(value) && Number.isSafeInteger(Number(value));
}

function isStableErrorCode(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z0-9_:-]{1,128}$/.test(value);
}

function isCanonicalDecimal(value: unknown, maxFractionDigits: number): value is string {
  if (typeof value !== "string") return false;
  const match = value.match(/^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/);
  return match !== null && match[1].length <= 78 - maxFractionDigits &&
    (match[2]?.length ?? 0) <= maxFractionDigits;
}

function isPositiveCanonicalDecimal(value: unknown, maxFractionDigits: number): value is string {
  return isCanonicalDecimal(value, maxFractionDigits) && !/^0(?:\.0+)?$/.test(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
