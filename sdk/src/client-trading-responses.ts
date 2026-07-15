import {
  assertOptionalBytes32Field,
  assertOwnResponseFields,
  assertRequiredBytes32Field,
  assertRequiredEnumField,
  assertRequiredNonNegativeIntegerField,
  assertRequiredSignatureField,
  isAddressHex,
  isBytes32Hex,
  isCommissionTotals,
  isIsoUtcTimestampString,
  isNonEmptyString,
  isPositiveDecimalString,
  isPositiveSafeInteger,
  isPositiveUIntString,
  isRecord,
  isSafeIdentifier,
  malformedFieldError,
} from "./client-response-validation.js";
import type {
  HedgeIntentStatus,
  QuoteResponse,
  QuoteStatus,
  SettlementEventStatus,
  SubmitQuoteResponse,
} from "./types.js";

const quoteResponseFields = ["quoteId", "snapshotId", "amountOut", "minAmountOut", "deadline", "nonce", "signature"] as const;
const submitResponseRequiredFields = ["status"] as const;
const submitResponseOptionalFields = ["txHash", "settlementEventId", "hedgeOrderId", "pnlId"] as const;
const quoteStatusRequiredFields = ["quoteId", "status"] as const;
const quoteStatusOptionalFields = [
  "snapshotId", "deadline", "txHash", "settlementEventId", "hedgeOrderId", "pnlId", "errorCode",
] as const;
const hedgeStatusRequiredFields = [
  "hedgeOrderId", "status", "settlementEventId", "quoteId", "chainId", "token", "side", "amount", "reason", "createdAt",
] as const;
const hedgeStatusOptionalFields = [
  "externalOrderId", "filledAmount", "venue", "venueSymbol", "venueOrderId", "executionEvidenceVersion",
  "executedQuoteQuantity", "feeReconciliationStatus", "feeLastErrorCode", "feeReconciledAt", "commissionTotals",
  "failureCode", "updatedAt",
] as const;
const settlementEventStatusFields = [
  "settlementEventId", "status", "quoteId", "chainId", "txHash", "quoteHash", "blockNumber", "logIndex", "user",
  "tokenIn", "tokenOut", "amountIn", "amountOut", "nonce", "observedAt",
] as const;

export function assertQuoteResponse(payload: unknown, status: number): asserts payload is QuoteResponse {
  const label = "RFQ quote response";
  if (!isRecord(payload)) throw malformedFieldError(status, label, "quoteId");
  assertOwnResponseFields(payload, quoteResponseFields, [], status, label);

  for (const field of ["quoteId", "snapshotId"] as const) {
    if (!isSafeIdentifier(payload[field])) throw malformedFieldError(status, label, field);
  }
  for (const field of ["amountOut", "minAmountOut", "nonce"] as const) {
    if (!isPositiveUIntString(payload[field])) throw malformedFieldError(status, label, field);
  }
  const amountOut = payload.amountOut;
  const minAmountOut = payload.minAmountOut;
  if (!isPositiveUIntString(amountOut) || !isPositiveUIntString(minAmountOut)) {
    throw malformedFieldError(status, label, "amountOut");
  }
  if (BigInt(amountOut) < BigInt(minAmountOut)) throw malformedFieldError(status, label, "minAmountOut");
  if (!isPositiveSafeInteger(payload.deadline)) throw malformedFieldError(status, label, "deadline");
  assertRequiredSignatureField(payload, "signature", status, label);
}

export function assertSubmitQuoteResponse(payload: unknown, status: number): asserts payload is SubmitQuoteResponse {
  const label = "RFQ submit response";
  if (!isRecord(payload)) throw malformedFieldError(status, label, "status");
  assertOwnResponseFields(payload, submitResponseRequiredFields, submitResponseOptionalFields, status, label);
  assertRequiredEnumField(payload, "status", ["accepted"], status, label);
  assertOptionalBytes32Field(payload, "txHash", status, label);
  for (const field of ["settlementEventId", "hedgeOrderId", "pnlId"] as const) {
    if (payload[field] !== undefined && !isSafeIdentifier(payload[field])) {
      throw malformedFieldError(status, label, field);
    }
  }
}

export function assertQuoteStatus(payload: unknown, status: number): asserts payload is QuoteStatus {
  const label = "RFQ quote status response";
  if (!isRecord(payload)) throw malformedFieldError(status, label, "status");
  assertOwnResponseFields(payload, quoteStatusRequiredFields, quoteStatusOptionalFields, status, label);
  if (!isSafeIdentifier(payload.quoteId)) throw malformedFieldError(status, label, "quoteId");
  assertRequiredEnumField(
    payload,
    "status",
    ["requested", "rejected", "signed", "expired", "submitted", "settled", "failed"],
    status,
    label,
  );
  for (const field of ["snapshotId", "settlementEventId", "hedgeOrderId", "pnlId"] as const) {
    if (payload[field] !== undefined && !isSafeIdentifier(payload[field])) {
      throw malformedFieldError(status, label, field);
    }
  }
  if (payload.errorCode !== undefined && !isNonEmptyString(payload.errorCode)) {
    throw malformedFieldError(status, label, "errorCode");
  }
  if (payload.deadline !== undefined && !isPositiveSafeInteger(payload.deadline)) {
    throw malformedFieldError(status, label, "deadline");
  }
  assertOptionalBytes32Field(payload, "txHash", status, label);
  assertQuoteStatusPayloadConsistency(payload, status, label);
}

export function assertHedgeIntentStatus(payload: unknown, status: number): asserts payload is HedgeIntentStatus {
  const label = "RFQ hedge status response";
  if (!isRecord(payload)) throw malformedFieldError(status, label, "status");
  assertOwnResponseFields(payload, hedgeStatusRequiredFields, hedgeStatusOptionalFields, status, label);

  for (const field of ["hedgeOrderId", "settlementEventId", "quoteId"] as const) {
    if (!isSafeIdentifier(payload[field])) throw malformedFieldError(status, label, field);
  }
  if (!isIsoUtcTimestampString(payload.createdAt)) throw malformedFieldError(status, label, "createdAt");
  if (payload.status !== "queued" && payload.status !== "filled" && payload.status !== "failed") {
    throw malformedFieldError(status, label, "status");
  }
  if (!isPositiveSafeInteger(payload.chainId)) throw malformedFieldError(status, label, "chainId");
  if (!isAddressHex(payload.token)) throw malformedFieldError(status, label, "token");
  if (payload.side !== "buy" && payload.side !== "sell") throw malformedFieldError(status, label, "side");
  if (!isPositiveUIntString(payload.amount)) throw malformedFieldError(status, label, "amount");
  if (payload.reason !== "inventory_rebalance" && payload.reason !== "risk_reduction") {
    throw malformedFieldError(status, label, "reason");
  }
  if (payload.externalOrderId !== undefined && !isNonEmptyString(payload.externalOrderId)) {
    throw malformedFieldError(status, label, "externalOrderId");
  }
  if (payload.filledAmount !== undefined && !isPositiveUIntString(payload.filledAmount)) {
    throw malformedFieldError(status, label, "filledAmount");
  }
  if (payload.venue !== undefined && (!isNonEmptyString(payload.venue) || payload.venue.length > 128)) {
    throw malformedFieldError(status, label, "venue");
  }
  if (payload.venueSymbol !== undefined &&
      (typeof payload.venueSymbol !== "string" || !/^[A-Z0-9._-]{3,32}$/.test(payload.venueSymbol))) {
    throw malformedFieldError(status, label, "venueSymbol");
  }
  if (payload.venueOrderId !== undefined &&
      (typeof payload.venueOrderId !== "string" || !/^[1-9][0-9]{0,15}$/.test(payload.venueOrderId) ||
        !Number.isSafeInteger(Number(payload.venueOrderId)))) {
    throw malformedFieldError(status, label, "venueOrderId");
  }
  if (payload.executionEvidenceVersion !== undefined &&
      payload.executionEvidenceVersion !== "base-only-v1" &&
      payload.executionEvidenceVersion !== "base-and-quote-v2") {
    throw malformedFieldError(status, label, "executionEvidenceVersion");
  }
  if (payload.executedQuoteQuantity !== undefined && !isPositiveDecimalString(payload.executedQuoteQuantity)) {
    throw malformedFieldError(status, label, "executedQuoteQuantity");
  }
  if ((payload.executionEvidenceVersion === "base-and-quote-v2") !== (payload.executedQuoteQuantity !== undefined)) {
    throw malformedFieldError(status, label, "executionEvidenceVersion");
  }
  if (payload.executionEvidenceVersion !== undefined && payload.filledAmount === undefined) {
    throw malformedFieldError(status, label, "executionEvidenceVersion");
  }
  if (payload.feeReconciliationStatus !== undefined &&
      payload.feeReconciliationStatus !== "pending" && payload.feeReconciliationStatus !== "complete") {
    throw malformedFieldError(status, label, "feeReconciliationStatus");
  }
  if (payload.feeLastErrorCode !== undefined &&
      (typeof payload.feeLastErrorCode !== "string" || !/^[A-Z0-9_:-]{1,128}$/.test(payload.feeLastErrorCode))) {
    throw malformedFieldError(status, label, "feeLastErrorCode");
  }
  if (payload.feeReconciledAt !== undefined && !isIsoUtcTimestampString(payload.feeReconciledAt)) {
    throw malformedFieldError(status, label, "feeReconciledAt");
  }
  if (payload.commissionTotals !== undefined && !isCommissionTotals(payload.commissionTotals)) {
    throw malformedFieldError(status, label, "commissionTotals");
  }
  if (payload.feeReconciliationStatus === "complete" &&
      (payload.venueOrderId === undefined || payload.executionEvidenceVersion !== "base-and-quote-v2" ||
        payload.feeReconciledAt === undefined || payload.commissionTotals === undefined)) {
    throw malformedFieldError(status, label, "feeReconciliationStatus");
  }
  if (payload.feeReconciliationStatus === "pending" && payload.feeReconciledAt !== undefined) {
    throw malformedFieldError(status, label, "feeReconciliationStatus");
  }
  if (payload.feeLastErrorCode !== undefined && payload.feeReconciliationStatus !== "pending") {
    throw malformedFieldError(status, label, "feeLastErrorCode");
  }
  if (payload.commissionTotals !== undefined && payload.feeReconciliationStatus === undefined) {
    throw malformedFieldError(status, label, "commissionTotals");
  }
  if (payload.failureCode !== undefined &&
      (typeof payload.failureCode !== "string" || !/^[A-Z0-9_:-]{1,128}$/.test(payload.failureCode))) {
    throw malformedFieldError(status, label, "failureCode");
  }
  if (payload.updatedAt !== undefined && !isIsoUtcTimestampString(payload.updatedAt)) {
    throw malformedFieldError(status, label, "updatedAt");
  }
}

export function assertSettlementEventStatus(
  payload: unknown,
  status: number,
): asserts payload is SettlementEventStatus {
  const label = "RFQ settlement event status response";
  if (!isRecord(payload)) throw malformedFieldError(status, label, "status");
  assertOwnResponseFields(payload, settlementEventStatusFields, [], status, label);
  for (const field of ["settlementEventId", "quoteId"] as const) {
    if (!isSafeIdentifier(payload[field])) throw malformedFieldError(status, label, field);
  }
  if (!isIsoUtcTimestampString(payload.observedAt)) throw malformedFieldError(status, label, "observedAt");
  assertRequiredEnumField(payload, "status", ["applied"], status, label);
  if (!isPositiveSafeInteger(payload.chainId)) throw malformedFieldError(status, label, "chainId");
  assertRequiredBytes32Field(payload, "txHash", status, label);
  assertRequiredBytes32Field(payload, "quoteHash", status, label);
  assertRequiredNonNegativeIntegerField(payload, "blockNumber", status, label);
  assertRequiredNonNegativeIntegerField(payload, "logIndex", status, label);
  for (const field of ["user", "tokenIn", "tokenOut"] as const) {
    if (!isAddressHex(payload[field])) throw malformedFieldError(status, label, field);
  }
  const tokenIn = payload.tokenIn;
  const tokenOut = payload.tokenOut;
  if (!isAddressHex(tokenIn) || !isAddressHex(tokenOut)) throw malformedFieldError(status, label, "tokenOut");
  if (tokenIn.toLowerCase() === tokenOut.toLowerCase()) throw malformedFieldError(status, label, "tokenOut");
  for (const field of ["amountIn", "amountOut", "nonce"] as const) {
    if (!isPositiveUIntString(payload[field])) throw malformedFieldError(status, label, field);
  }
}

function assertQuoteStatusPayloadConsistency(
  payload: Record<string, unknown>,
  status: number,
  label: string,
): void {
  const quoteStatus = payload.status;
  if (quoteStatus === "submitted" || quoteStatus === "settled") {
    if (!isBytes32Hex(payload.txHash)) throw malformedFieldError(status, label, "txHash");
    if (!isSafeIdentifier(payload.settlementEventId)) {
      throw malformedFieldError(status, label, "settlementEventId");
    }
    return;
  }
  if (payload.txHash !== undefined || payload.settlementEventId !== undefined ||
      payload.hedgeOrderId !== undefined || payload.pnlId !== undefined) {
    throw malformedFieldError(status, label, "status");
  }
  if ((quoteStatus === "rejected" || quoteStatus === "failed") && !isNonEmptyString(payload.errorCode)) {
    throw malformedFieldError(status, label, "errorCode");
  }
}
