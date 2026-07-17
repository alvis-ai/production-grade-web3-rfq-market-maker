import type {
  QuoteLifecycleStatus,
  QuoteRequest,
  QuoteStatusResponse,
  SignedQuote,
} from "../../shared/types/rfq.js";
import { assertPrincipalId } from "../../shared/validation/principal-id.js";
import type {
  ClearSettlementStatusInput,
  QuoteRecord,
  QuoteStatusMetadata,
  SaveRejectedQuoteInput,
  SaveRequestedQuoteInput,
  SaveRouteDecisionInput,
  SaveSignedQuoteInput,
} from "./quote-repository-contract.js";

const SECP256K1N_HALF = BigInt("0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0");
const maxSafeIdentifierLength = 128;
const safeIdentifierPattern = /^[A-Za-z0-9_:-]+$/;
const requestedQuoteInputFields = ["quoteId", "principalId", "request", "snapshotId"] as const;
const routeDecisionInputFields = ["quoteId", "principalId", "snapshotId", "routePlan"] as const;
const routePlanFields = ["routeId", "venue", "tokenIn", "tokenOut", "expectedLiquidityUsd"] as const;
const rejectedQuoteInputFields = ["quoteId", "principalId", "request", "snapshotId", "rejectCode"] as const;
const rejectedQuoteOptionalFields = ["riskPolicyVersion"] as const;
const rejectedQuoteAllowedFields = [...rejectedQuoteInputFields, ...rejectedQuoteOptionalFields] as const;
const clearSettlementStatusInputFields = ["quoteId", "txHash", "settlementEventId"] as const;
const clearSettlementStatusOptionalFields = ["nowSeconds"] as const;
const clearSettlementStatusAllowedFields = [
  ...clearSettlementStatusInputFields,
  ...clearSettlementStatusOptionalFields,
] as const;
const quoteRequestFields = ["chainId", "user", "tokenIn", "tokenOut", "amountIn", "slippageBps"] as const;
const signedQuoteInputFields = [
  "quoteId",
  "principalId",
  "snapshotId",
  "slippageBps",
  "quote",
  "pricingVersion",
  "spreadBps",
  "sizeImpactBps",
  "marketSpreadBps",
  "inventorySkewBps",
  "volatilityPremiumBps",
  "hedgeCostBps",
  "riskPolicyVersion",
  "signature",
] as const;
const signedQuoteFields = [
  "user",
  "tokenIn",
  "tokenOut",
  "amountIn",
  "amountOut",
  "minAmountOut",
  "nonce",
  "deadline",
  "chainId",
] as const;

export function cloneQuoteRecord(record: QuoteRecord): QuoteRecord {
  return { ...record };
}

export function quoteStatusResponseFromRecord(record: QuoteRecord): QuoteStatusResponse {
  return {
    quoteId: record.quoteId,
    status: record.status,
    snapshotId: record.snapshotId,
    deadline: record.deadline,
    txHash: record.txHash,
    settlementEventId: record.settlementEventId,
    hedgeOrderId: record.hedgeOrderId,
    pnlId: record.pnlId,
    errorCode: record.rejectCode,
  };
}

export function assertRequestedQuoteInput(input: SaveRequestedQuoteInput): void {
  assertObject(input, "input", "Requested quote");
  assertOwnFields(input, requestedQuoteInputFields, "input", "Requested quote");
  assertNoUnknownFields(input, requestedQuoteInputFields, "input", "Requested quote");
  assertObject(input.request, "request", "Requested quote");
  assertSafeIdentifier(input.quoteId, "quoteId", "Requested quote");
  assertPrincipalId(input.principalId, "Requested quote principalId");
  assertSafeIdentifier(input.snapshotId, "snapshotId", "Requested quote");
  assertQuoteRequest(input.request, "Requested quote");
}

export function assertRouteDecisionInput(input: SaveRouteDecisionInput): void {
  assertObject(input, "input", "Route decision");
  assertOwnFields(input, routeDecisionInputFields, "input", "Route decision");
  assertNoUnknownFields(input, routeDecisionInputFields, "input", "Route decision");
  assertObject(input.routePlan, "routePlan", "Route decision");
  assertOwnFields(input.routePlan, routePlanFields, "routePlan", "Route decision");
  assertNoUnknownFields(input.routePlan, routePlanFields, "routePlan", "Route decision");
  assertSafeIdentifier(input.quoteId, "quoteId", "Route decision");
  assertPrincipalId(input.principalId, "Route decision principalId");
  assertSafeIdentifier(input.snapshotId, "snapshotId", "Route decision");
  assertSafeIdentifier(input.routePlan.routeId, "routePlan.routeId", "Route decision");
  if (input.routePlan.venue !== "internal_inventory") {
    throw new Error("Route decision routePlan.venue must be internal_inventory");
  }
  assertAddress(input.routePlan.tokenIn, "routePlan.tokenIn", "Route decision");
  assertAddress(input.routePlan.tokenOut, "routePlan.tokenOut", "Route decision");
  if (input.routePlan.tokenIn.toLowerCase() === input.routePlan.tokenOut.toLowerCase()) {
    throw new Error("Route decision routePlan token pair must contain distinct tokens");
  }
  assertPositiveUIntString(
    input.routePlan.expectedLiquidityUsd,
    "routePlan.expectedLiquidityUsd",
    "Route decision",
  );
}

export function assertRejectedQuoteInput(input: SaveRejectedQuoteInput): void {
  assertObject(input, "input", "Rejected quote");
  assertOwnFields(input, rejectedQuoteInputFields, "input", "Rejected quote");
  assertOwnOptionalFields(input, rejectedQuoteOptionalFields, "input", "Rejected quote");
  assertNoUnknownFields(input, rejectedQuoteAllowedFields, "input", "Rejected quote");
  assertObject(input.request, "request", "Rejected quote");
  assertSafeIdentifier(input.quoteId, "quoteId", "Rejected quote");
  assertPrincipalId(input.principalId, "Rejected quote principalId");
  assertSafeIdentifier(input.snapshotId, "snapshotId", "Rejected quote");
  assertNonEmptyString(input.rejectCode, "rejectCode", "Rejected quote");
  if (input.riskPolicyVersion !== undefined) {
    assertNonEmptyString(input.riskPolicyVersion, "riskPolicyVersion", "Rejected quote");
  }
  assertQuoteRequest(input.request, "Rejected quote");
}

export function normalizeClearSettlementStatusInput(
  input: ClearSettlementStatusInput,
): Required<ClearSettlementStatusInput> {
  assertObject(input, "input", "Clear settlement status");
  assertOwnFields(input, clearSettlementStatusInputFields, "input", "Clear settlement status");
  assertOwnOptionalFields(input, clearSettlementStatusOptionalFields, "input", "Clear settlement status");
  assertNoUnknownFields(input, clearSettlementStatusAllowedFields, "input", "Clear settlement status");
  assertSafeIdentifier(input.quoteId, "quoteId", "Clear settlement status");
  assertSafeIdentifier(input.settlementEventId, "settlementEventId", "Clear settlement status");
  if (typeof input.txHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(input.txHash)) {
    throw new Error("Clear settlement status txHash must be a 32-byte hex string");
  }

  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  assertPositiveSafeInteger(nowSeconds, "nowSeconds", "Clear settlement status");

  return {
    quoteId: input.quoteId,
    txHash: input.txHash.toLowerCase() as `0x${string}`,
    settlementEventId: input.settlementEventId,
    nowSeconds,
  };
}

function assertQuoteRequest(request: QuoteRequest, subject: "Requested quote" | "Rejected quote"): void {
  assertObject(request, "request", subject);
  assertOwnFields(request, quoteRequestFields, "request", subject);
  assertNoUnknownFields(request, quoteRequestFields, "request", subject);
  assertPositiveSafeInteger(request.chainId, "request.chainId", subject);
  assertAddress(request.user, "request.user", subject);
  assertAddress(request.tokenIn, "request.tokenIn", subject);
  assertAddress(request.tokenOut, "request.tokenOut", subject);

  if (request.tokenIn.toLowerCase() === request.tokenOut.toLowerCase()) {
    throw new Error(`${subject} request token pair must contain distinct tokens`);
  }

  assertPositiveUIntString(request.amountIn, "request.amountIn", subject);
  assertNonNegativeBps(request.slippageBps, "request.slippageBps", subject);
}

export function assertSignedQuoteInput(input: SaveSignedQuoteInput): void {
  assertObject(input, "input", "Signed quote");
  assertOwnFields(input, signedQuoteInputFields, "input", "Signed quote");
  assertNoUnknownFields(input, signedQuoteInputFields, "input", "Signed quote");
  assertObject(input.quote, "quote", "Signed quote");
  assertSafeIdentifier(input.quoteId, "quoteId");
  assertPrincipalId(input.principalId, "Signed quote principalId");
  assertSafeIdentifier(input.snapshotId, "snapshotId");
  assertNonEmptyString(input.pricingVersion, "pricingVersion");
  assertNonEmptyString(input.riskPolicyVersion, "riskPolicyVersion");
  assertNonNegativeBps(input.slippageBps, "slippageBps", "Signed quote");
  assertNonNegativeBps(input.spreadBps, "spreadBps", "Signed quote");
  assertNonNegativeBps(input.sizeImpactBps, "sizeImpactBps", "Signed quote");
  assertNonNegativeBps(input.marketSpreadBps, "marketSpreadBps", "Signed quote");
  assertBpsMagnitude(input.inventorySkewBps, "inventorySkewBps", "Signed quote");
  assertNonNegativeBps(input.volatilityPremiumBps, "volatilityPremiumBps", "Signed quote");
  assertNonNegativeBps(input.hedgeCostBps, "hedgeCostBps", "Signed quote");
  assertSignature(input.signature);
  assertOwnFields(input.quote, signedQuoteFields, "quote", "Signed quote");
  assertNoUnknownFields(input.quote, signedQuoteFields, "quote", "Signed quote");
  assertPositiveSafeInteger(input.quote.chainId, "quote.chainId");
  assertAddress(input.quote.user, "quote.user");
  assertAddress(input.quote.tokenIn, "quote.tokenIn");
  assertAddress(input.quote.tokenOut, "quote.tokenOut");

  if (input.quote.tokenIn.toLowerCase() === input.quote.tokenOut.toLowerCase()) {
    throw new Error("Signed quote token pair must contain distinct tokens");
  }

  assertPositiveUIntString(input.quote.amountIn, "quote.amountIn");
  assertPositiveUIntString(input.quote.amountOut, "quote.amountOut");
  assertPositiveUIntString(input.quote.minAmountOut, "quote.minAmountOut");
  assertPositiveUIntString(input.quote.nonce, "quote.nonce");
  assertPositiveSafeInteger(input.quote.deadline, "quote.deadline");

  if (BigInt(input.quote.amountOut) < BigInt(input.quote.minAmountOut)) {
    throw new Error("Signed quote amountOut must be greater than or equal to minAmountOut");
  }
}

function assertObject(value: unknown, field: "input" | "request" | "quote" | "routePlan", subject: string): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${subject} ${field} must be an object`);
  }
}

function assertOwnFields(value: object, fields: readonly string[], path: string, subject: string): void {
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      throw new Error(`${subject} ${path}.${field} must be an own field`);
    }
  }
}

function assertOwnOptionalFields(value: object, fields: readonly string[], path: string, subject: string): void {
  for (const field of fields) {
    if (field in value && !Object.prototype.hasOwnProperty.call(value, field)) {
      throw new Error(`${subject} ${path}.${field} must be an own field when provided`);
    }
  }
}

function assertNoUnknownFields(value: object, fields: readonly string[], path: string, subject: string): void {
  const allowed = new Set<string>(fields);
  const unknownField = Object.keys(value).find((field) => !allowed.has(field));
  if (unknownField !== undefined) {
    throw new Error(`${subject} ${path} contains unknown field ${unknownField}`);
  }
}

export function assertNonEmptyString(value: string, field: string, subject = "Signed quote"): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${subject} ${field} must be a non-empty string`);
  }
}

export function assertSafeIdentifier(value: unknown, field: string, subject = "Signed quote"): void {
  if (typeof value !== "string") {
    throw new Error(`${subject} ${field} must be a primitive string`);
  }
  if (value.trim().length === 0) {
    throw new Error(`${subject} ${field} must be a non-empty string`);
  }
  if (value.length > maxSafeIdentifierLength) {
    throw new Error(`${subject} ${field} must be 128 characters or fewer`);
  }
  if (!safeIdentifierPattern.test(value)) {
    throw new Error(`${subject} ${field} must contain only letters, numbers, underscore, colon, or hyphen`);
  }
}

function assertAddress(value: string, field: string, subject = "Signed quote"): void {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`${subject} ${field} must be a 20-byte hex address`);
  }
}

function assertPositiveUIntString(value: string, field: string, subject = "Signed quote"): void {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`${subject} ${field} must be a positive uint string`);
  }
}

function assertPositiveSafeInteger(value: number, field: string, subject = "Signed quote"): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${subject} ${field} must be a positive safe integer`);
  }
}

function assertNonNegativeBps(value: number, field: string, subject: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${subject} ${field} must be a non-negative safe integer`);
  }

  if (value > 10_000) {
    throw new Error(`${subject} ${field} must be less than or equal to 10000 bps`);
  }
}

function assertBpsMagnitude(value: number, field: string, subject: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${subject} ${field} must be a safe integer`);
  }

  if (Math.abs(value) > 10_000) {
    throw new Error(`${subject} ${field} magnitude must be less than or equal to 10000 bps`);
  }
}

function assertSignature(value: `0x${string}`): void {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(value)) {
    throw new Error("Signed quote signature must be a 65-byte hex string");
  }

  const s = BigInt(`0x${value.slice(66, 130)}`);
  if (s > SECP256K1N_HALF) {
    throw new Error("Signed quote signature s value must be in the lower half order");
  }

  const v = Number.parseInt(value.slice(130, 132), 16);
  const normalizedV = v < 27 ? v + 27 : v;
  if (normalizedV !== 27 && normalizedV !== 28) {
    throw new Error("Signed quote signature v value must be 27 or 28");
  }
}

export function assertCanMarkFailed(record: QuoteRecord, errorCode: string): void {
  if (record.status === "requested" || record.status === "signed") {
    return;
  }

  if (record.status === "failed") {
    if (record.rejectCode === errorCode) {
      return;
    }

    throw new Error(`Failed quote errorCode cannot be changed for ${record.quoteId}`);
  }

  if (record.status === "submitted" || record.status === "settled" || record.status === "expired") {
    throw new Error(`Quote ${record.quoteId} cannot transition from ${record.status} to failed`);
  }

  throw new Error(`Quote ${record.quoteId} cannot transition from terminal status ${record.status} to failed`);
}

export function assertCanSaveRequestedQuote(record: QuoteRecord, input: SaveRequestedQuoteInput): void {
  if (record.status === "requested") {
    if (isSameRequestedQuotePayload(record, input)) {
      return;
    }

    throw new Error(`Requested quote payload cannot be changed for ${input.quoteId}`);
  }

  throw new Error(`Quote ${input.quoteId} cannot save requested quote from ${record.status}`);
}

export function assertCanSaveRouteDecision(
  record: QuoteRecord | undefined,
  input: SaveRouteDecisionInput,
): asserts record is QuoteRecord {
  if (!record) {
    throw new Error(`Quote ${input.quoteId} cannot save route decision without requested state`);
  }
  if (!isSameRouteDecisionIdentity(record, input)) {
    throw new Error(`Route decision does not match requested quote ${input.quoteId}`);
  }
  if (record.routeId !== undefined) {
    if (isSameRouteDecisionPayload(record, input)) {
      return;
    }
    throw new Error(`Route decision cannot be changed for ${input.quoteId}`);
  }
  if (record.status !== "requested") {
    throw new Error(`Quote ${input.quoteId} cannot save route decision from ${record.status}`);
  }
}

export function assertCanSaveRejectedQuote(record: QuoteRecord | undefined, input: SaveRejectedQuoteInput): void {
  if (!record) {
    throw new Error(`Quote ${input.quoteId} cannot save rejected quote without requested state`);
  }

  if (record.status === "requested") {
    if (isSameRequestedQuotePayload(record, input)) {
      return;
    }

    throw new Error(`Rejected quote request cannot differ from requested quote ${input.quoteId}`);
  }

  if (record.status === "rejected") {
    if (isSameRejectedQuotePayload(record, input)) {
      return;
    }

    throw new Error(`Rejected quote payload cannot be changed for ${input.quoteId}`);
  }

  throw new Error(`Quote ${input.quoteId} cannot save rejected quote from ${record.status}`);
}

export function assertCanSaveSignedQuote(record: QuoteRecord, input: SaveSignedQuoteInput): void {
  if (record.status === "requested") {
    if (isSameRequestedQuotePayloadAsSigned(record, input)) {
      return;
    }

    throw new Error(`Signed quote request cannot differ from requested quote ${input.quoteId}`);
  }

  if (record.status === "signed") {
    if (isSameSignedQuotePayload(record, input)) {
      return;
    }

    throw new Error(`Signed quote payload cannot be changed for ${input.quoteId}`);
  }

  throw new Error(`Quote ${input.quoteId} cannot save signed quote from ${record.status}`);
}

export function hasSettlementStatusMetadata(record: QuoteRecord): boolean {
  return (
    record.txHash !== undefined ||
    record.settlementEventId !== undefined ||
    record.hedgeOrderId !== undefined ||
    record.pnlId !== undefined
  );
}

export function assertCanClearSettlementStatus(
  record: QuoteRecord,
  input: Required<ClearSettlementStatusInput>,
): void {
  if (record.status !== "submitted" && record.status !== "settled") {
    throw new Error(`Quote ${record.quoteId} cannot clear settlement status from ${record.status}`);
  }
  if (
    record.txHash?.toLowerCase() !== input.txHash ||
    record.settlementEventId !== input.settlementEventId
  ) {
    throw new Error(`Quote ${record.quoteId} settlement status removal conflict`);
  }
}

export function shouldExpireAfterSettlementRemoval(record: QuoteRecord, nowSeconds: number): boolean {
  return record.deadline !== undefined && record.deadline <= nowSeconds;
}

function isSameRequestedQuotePayload(record: QuoteRecord, input: SaveRequestedQuoteInput | SaveRejectedQuoteInput): boolean {
  return (
    record.quoteId === input.quoteId &&
    record.principalId === input.principalId &&
    record.chainId === input.request.chainId &&
    record.user.toLowerCase() === input.request.user.toLowerCase() &&
    record.tokenIn.toLowerCase() === input.request.tokenIn.toLowerCase() &&
    record.tokenOut.toLowerCase() === input.request.tokenOut.toLowerCase() &&
    record.amountIn === input.request.amountIn &&
    record.slippageBps === input.request.slippageBps &&
    record.snapshotId === input.snapshotId
  );
}

function isSameRouteDecisionIdentity(record: QuoteRecord, input: SaveRouteDecisionInput): boolean {
  return (
    record.quoteId === input.quoteId &&
    record.principalId === input.principalId &&
    record.snapshotId === input.snapshotId &&
    record.tokenIn.toLowerCase() === input.routePlan.tokenIn.toLowerCase() &&
    record.tokenOut.toLowerCase() === input.routePlan.tokenOut.toLowerCase()
  );
}

function isSameRouteDecisionPayload(record: QuoteRecord, input: SaveRouteDecisionInput): boolean {
  return (
    isSameRouteDecisionIdentity(record, input) &&
    record.routeId === input.routePlan.routeId &&
    record.routeVenue === input.routePlan.venue &&
    record.routeExpectedLiquidityUsd === input.routePlan.expectedLiquidityUsd &&
    record.routeDecidedAt !== undefined
  );
}

function isSameRejectedQuotePayload(record: QuoteRecord, input: SaveRejectedQuoteInput): boolean {
  return (
    isSameRequestedQuotePayload(record, input) &&
    record.rejectCode === input.rejectCode &&
    record.riskPolicyVersion === input.riskPolicyVersion
  );
}

function isSameRequestedQuotePayloadAsSigned(record: QuoteRecord, input: SaveSignedQuoteInput): boolean {
  return (
    record.quoteId === input.quoteId &&
    record.principalId === input.principalId &&
    record.chainId === input.quote.chainId &&
    record.user.toLowerCase() === input.quote.user.toLowerCase() &&
    record.tokenIn.toLowerCase() === input.quote.tokenIn.toLowerCase() &&
    record.tokenOut.toLowerCase() === input.quote.tokenOut.toLowerCase() &&
    record.amountIn === input.quote.amountIn &&
    record.slippageBps === input.slippageBps &&
    record.snapshotId === input.snapshotId
  );
}

function isSameSignedQuotePayload(record: QuoteRecord, input: SaveSignedQuoteInput): boolean {
  return (
    record.quoteId === input.quoteId &&
    record.principalId === input.principalId &&
    record.chainId === input.quote.chainId &&
    record.user.toLowerCase() === input.quote.user.toLowerCase() &&
    record.tokenIn.toLowerCase() === input.quote.tokenIn.toLowerCase() &&
    record.tokenOut.toLowerCase() === input.quote.tokenOut.toLowerCase() &&
    record.amountIn === input.quote.amountIn &&
    record.slippageBps === input.slippageBps &&
    record.amountOut === input.quote.amountOut &&
    record.minAmountOut === input.quote.minAmountOut &&
    record.nonce === input.quote.nonce &&
    record.deadline === input.quote.deadline &&
    record.snapshotId === input.snapshotId &&
    record.pricingVersion === input.pricingVersion &&
    record.spreadBps === input.spreadBps &&
    record.sizeImpactBps === input.sizeImpactBps &&
    record.marketSpreadBps === input.marketSpreadBps &&
    record.inventorySkewBps === input.inventorySkewBps &&
    record.volatilityPremiumBps === input.volatilityPremiumBps &&
    record.hedgeCostBps === input.hedgeCostBps &&
    record.riskPolicyVersion === input.riskPolicyVersion &&
    record.signature?.toLowerCase() === input.signature.toLowerCase()
  );
}

export function isSameSignedQuoteIdentity(record: QuoteRecord, quote: SignedQuote): boolean {
  return (
    record.chainId === quote.chainId &&
    record.user.toLowerCase() === quote.user.toLowerCase() &&
    record.nonce === quote.nonce
  );
}

export function assertStatusTransition(record: QuoteRecord, nextStatus: QuoteLifecycleStatus): void {
  if (record.status === "requested") {
    throw new Error(`Quote ${record.quoteId} cannot transition from requested to ${nextStatus} through markStatus`);
  }

  if (record.status === "expired") {
    if (nextStatus === "expired") {
      return;
    }

    throw new Error(`Quote ${record.quoteId} cannot transition from terminal status expired to ${nextStatus}`);
  }

  if (record.status === "failed" || record.status === "rejected") {
    throw new Error(`Quote ${record.quoteId} cannot transition from terminal status ${record.status} to ${nextStatus}`);
  }

  if (record.status === "signed") {
    if (nextStatus === "submitted" || nextStatus === "settled" || nextStatus === "expired") {
      return;
    }

    throw new Error(`Quote ${record.quoteId} cannot transition from signed to ${nextStatus} through markStatus`);
  }

  if (record.status === "submitted") {
    if (nextStatus === "settled") {
      return;
    }

    throw new Error(`Quote ${record.quoteId} cannot transition from submitted to ${nextStatus}`);
  }

  if (record.status === "settled" && nextStatus !== "settled") {
    throw new Error(`Quote ${record.quoteId} cannot transition from settled to ${nextStatus}`);
  }
}

export function assertQuoteStatusMetadata(metadata: QuoteStatusMetadata | undefined): void {
  if (!metadata) {
    return;
  }

  if (
    metadata.txHash !== undefined &&
    (typeof metadata.txHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(metadata.txHash))
  ) {
    throw new Error("Quote status txHash must be a 32-byte hex string");
  }

  if (metadata.settlementEventId !== undefined) {
    assertSafeMetadataIdentifier(metadata.settlementEventId, "settlementEventId");
  }

  if (metadata.hedgeOrderId !== undefined) {
    assertSafeMetadataIdentifier(metadata.hedgeOrderId, "hedgeOrderId");
  }

  if (metadata.pnlId !== undefined) {
    assertSafeMetadataIdentifier(metadata.pnlId, "pnlId");
  }
}

export function normalizeQuoteStatusMetadata(
  metadata: QuoteStatusMetadata | undefined,
): QuoteStatusMetadata | undefined {
  if (!metadata) {
    return undefined;
  }

  return {
    ...metadata,
    txHash: metadata.txHash?.toLowerCase() as `0x${string}` | undefined,
  };
}

export function assertQuoteStatusMetadataDoesNotConflict(
  record: QuoteRecord,
  metadata: QuoteStatusMetadata | undefined,
): void {
  if (!metadata) {
    return;
  }

  assertMetadataFieldDoesNotConflict(record.txHash, metadata.txHash, "txHash", (left, right) => {
    return left.toLowerCase() === right.toLowerCase();
  });
  assertMetadataFieldDoesNotConflict(record.settlementEventId, metadata.settlementEventId, "settlementEventId");
  assertMetadataFieldDoesNotConflict(record.hedgeOrderId, metadata.hedgeOrderId, "hedgeOrderId");
  assertMetadataFieldDoesNotConflict(record.pnlId, metadata.pnlId, "pnlId");
}

export function assertSettlementStatusMetadata(
  record: QuoteRecord,
  nextStatus: QuoteLifecycleStatus,
  metadata: QuoteStatusMetadata | undefined,
): void {
  if (nextStatus !== "submitted" && nextStatus !== "settled") {
    return;
  }

  const txHash = metadata?.txHash ?? record.txHash;
  const settlementEventId = metadata?.settlementEventId ?? record.settlementEventId;
  if (txHash === undefined) {
    throw new Error(`Quote ${record.quoteId} ${nextStatus} status requires txHash`);
  }
  if (settlementEventId === undefined) {
    throw new Error(`Quote ${record.quoteId} ${nextStatus} status requires settlementEventId`);
  }
}

export function assertNonSettlementStatusMetadata(
  record: QuoteRecord,
  nextStatus: QuoteLifecycleStatus,
  metadata: QuoteStatusMetadata | undefined,
): void {
  if (nextStatus === "submitted" || nextStatus === "settled") {
    return;
  }

  assertNonSettlementMetadataField(record.quoteId, nextStatus, record.txHash, metadata?.txHash, "txHash");
  assertNonSettlementMetadataField(
    record.quoteId,
    nextStatus,
    record.settlementEventId,
    metadata?.settlementEventId,
    "settlementEventId",
  );
  assertNonSettlementMetadataField(
    record.quoteId,
    nextStatus,
    record.hedgeOrderId,
    metadata?.hedgeOrderId,
    "hedgeOrderId",
  );
  assertNonSettlementMetadataField(record.quoteId, nextStatus, record.pnlId, metadata?.pnlId, "pnlId");
}

export function mergeQuoteStatusMetadata(
  record: QuoteRecord,
  metadata: QuoteStatusMetadata | undefined,
): QuoteStatusMetadata {
  return {
    txHash: record.txHash ?? metadata?.txHash,
    settlementEventId: record.settlementEventId ?? metadata?.settlementEventId,
    hedgeOrderId: record.hedgeOrderId ?? metadata?.hedgeOrderId,
    pnlId: record.pnlId ?? metadata?.pnlId,
  };
}

function assertMetadataFieldDoesNotConflict(
  currentValue: string | undefined,
  nextValue: string | undefined,
  field: keyof QuoteStatusMetadata,
  compare: (left: string, right: string) => boolean = (left, right) => left === right,
): void {
  if (currentValue !== undefined && nextValue !== undefined && !compare(currentValue, nextValue)) {
    throw new Error(`Quote status ${field} cannot be changed once set`);
  }
}

function assertNonSettlementMetadataField(
  quoteId: string,
  nextStatus: QuoteLifecycleStatus,
  currentValue: string | undefined,
  nextValue: string | undefined,
  field: keyof QuoteStatusMetadata,
): void {
  if (nextValue !== undefined) {
    throw new Error(`Quote ${quoteId} ${nextStatus} status must not include ${field}`);
  }

  if (currentValue !== undefined) {
    throw new Error(`Quote ${quoteId} ${nextStatus} status cannot retain ${field}`);
  }
}

function assertSafeMetadataIdentifier(value: unknown, field: keyof QuoteStatusMetadata): void {
  if (typeof value !== "string") {
    throw new Error(`Quote status ${field} must be a primitive string`);
  }
  if (value.trim().length === 0) {
    throw new Error(`Quote status ${field} must be a non-empty string`);
  }
  if (value.length > maxSafeIdentifierLength) {
    throw new Error(`Quote status ${field} must be 128 characters or fewer`);
  }
  if (!safeIdentifierPattern.test(value)) {
    throw new Error(`Quote status ${field} must contain only letters, numbers, underscore, colon, or hyphen`);
  }
}
