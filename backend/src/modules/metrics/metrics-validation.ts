import { quoteSnapshotPnlModelDescription } from "../../shared/types/rfq.js";
import type { Address, PnlTradeRecord } from "../../shared/types/rfq.js";
import { isCanonicalUtcIsoTimestamp } from "../../shared/validation/timestamp.js";
import type { ReadinessResponse } from "../health/readiness.service.js";
import type { CexOrderBookCycleObservation } from "../market-data/cex-orderbook/cex-orderbook-monitor.js";
import type { MarketSnapshotSampleResult } from "../market-data/market-snapshot-sampler.js";
import { normalizeHumanPrice } from "../pricing/price-normalization.js";
import type { RateLimitedEndpoint } from "../rate-limit/rate-limit.service.js";
import {
  dependencyMetricStatuses,
  marketSnapshotSampleOutcomes,
  rateLimitedEndpoints,
  readinessDependencyComponents,
  readinessMetricStatuses,
  signerMetricOperations,
  type InventoryMetricPosition,
  type SignerMetricOperation,
} from "./metrics-contract.js";

const maxSafeIdentifierLength = 128;
const safeIdentifierPattern = /^[A-Za-z0-9_:-]+$/;
const readinessMetricInputFields = ["status", "components"] as const;
const inventoryMetricPositionFields = ["chainId", "token", "balance"] as const;
const pnlTradeMetricRecordFields = [
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

export function assertCexOrderBookCycleObservation(
  value: unknown,
): asserts value is CexOrderBookCycleObservation {
  if (!isRecord(value)) throw new Error("Metrics CEX order book cycle must be an object");
  const observation = value as Record<string, unknown>;
  const integerFields = [
    "configuredSources",
    "readySources",
    "staleSources",
    "unavailableSources",
    "usablePairs",
    "blockedPairs",
    "deviationRejectedSources",
  ] as const;
  for (const field of [...integerFields, "maxUpdateAgeSeconds"] as const) {
    if (!Object.prototype.hasOwnProperty.call(observation, field)) {
      throw new Error(`Metrics CEX order book cycle.${field} must be an own field`);
    }
  }
  for (const field of integerFields) {
    if (!Number.isSafeInteger(observation[field]) || (observation[field] as number) < 0) {
      throw new Error(`Metrics CEX order book cycle.${field} must be a non-negative safe integer`);
    }
  }
  if (typeof observation.maxUpdateAgeSeconds !== "number" || !Number.isFinite(observation.maxUpdateAgeSeconds) ||
      observation.maxUpdateAgeSeconds < 0) {
    throw new Error("Metrics CEX order book cycle.maxUpdateAgeSeconds must be non-negative and finite");
  }
  if ((observation.configuredSources as number) !==
      (observation.readySources as number) + (observation.staleSources as number) +
      (observation.unavailableSources as number)) {
    throw new Error("Metrics CEX order book source states must sum to configuredSources");
  }
}

export function assertMarketSnapshotSampleResult(value: unknown): asserts value is MarketSnapshotSampleResult {
  if (!isRecord(value)) throw new Error("Metrics market snapshot sample result must be an object");
  assertOwnFields(value, marketSnapshotSampleOutcomes, "market snapshot sample result");
  for (const outcome of marketSnapshotSampleOutcomes) {
    if (!Number.isSafeInteger(value[outcome]) || (value[outcome] as number) < 0) {
      throw new Error(`Metrics market snapshot sample result.${outcome} must be a non-negative safe integer`);
    }
  }
}

export function cloneInventoryMetricPosition(position: InventoryMetricPosition): InventoryMetricPosition {
  return { ...position };
}

export function assertRateLimitedEndpoint(endpoint: RateLimitedEndpoint): void {
  if (!rateLimitedEndpoints.includes(endpoint)) {
    throw new Error("Metrics rate-limited endpoint must be quote, submit, or status");
  }
}

export function assertSignerMetricOperation(operation: SignerMetricOperation): void {
  if (!signerMetricOperations.includes(operation)) {
    throw new Error("Metrics signer operation must be sign or verify");
  }
}

export function assertReadinessMetricInput(readiness: ReadinessResponse): void {
  if (!isRecord(readiness)) {
    throw new Error("Metrics readiness input must be an object");
  }
  assertOwnFields(readiness, readinessMetricInputFields, "readiness");
  if (!readinessMetricStatuses.includes(readiness.status)) {
    throw new Error("Metrics readiness status must be ready or degraded");
  }
  if (!isRecord(readiness.components)) {
    throw new Error("Metrics readiness components must be an object");
  }
  assertOwnFields(readiness.components, readinessDependencyComponents, "readiness components");

  const expectedComponents = new Set<string>(readinessDependencyComponents);
  for (const component of Object.keys(readiness.components)) {
    if (!expectedComponents.has(component)) {
      throw new Error(`Metrics readiness component ${component} is not supported`);
    }
  }
  for (const component of readinessDependencyComponents) {
    const status = readiness.components[component];
    if (!dependencyMetricStatuses.includes(status)) {
      throw new Error(`Metrics readiness component ${component} must be ok or degraded`);
    }
  }
}

export function assertInventoryMetricPosition(position: InventoryMetricPosition): void {
  if (!isRecord(position)) {
    throw new Error("Metrics inventory position must be an object");
  }
  assertOwnFields(position, inventoryMetricPositionFields, "inventory position");
  assertPositiveSafeInteger(position.chainId, "inventory chainId");
  assertAddress(position.token, "inventory token");
  assertBigInt(position.balance, "inventory balance");
}

export function assertPnlTradeMetricRecord(record: PnlTradeRecord): void {
  if (!isRecord(record)) {
    throw new Error("Metrics PnL trade record must be an object");
  }
  assertOwnFields(record, pnlTradeMetricRecordFields, "PnL trade record");

  assertSafeIdentifier(record.pnlId, "PnL trade pnlId");
  assertSafeIdentifier(record.quoteId, "PnL trade quoteId");
  assertSafeIdentifier(record.settlementEventId, "PnL trade settlementEventId");
  assertSafeIdentifier(record.snapshotId, "PnL trade snapshotId");
  assertPositiveSafeInteger(record.chainId, "PnL trade chainId");
  assertAddress(record.user, "PnL trade user");
  assertAddress(record.tokenIn, "PnL trade tokenIn");
  assertAddress(record.tokenOut, "PnL trade tokenOut");

  if (record.tokenIn.toLowerCase() === record.tokenOut.toLowerCase()) {
    throw new Error("Metrics PnL trade token pair must contain distinct tokens");
  }

  assertPositiveUIntString(record.amountIn, "PnL trade amountIn");
  assertPositiveUIntString(record.amountOut, "PnL trade amountOut");
  assertPositiveUIntString(record.minAmountOut, "PnL trade minAmountOut");
  assertPositiveUIntString(record.nonce, "PnL trade nonce");
  assertPositiveSafeInteger(record.deadline, "PnL trade deadline");

  if (BigInt(record.amountOut) < BigInt(record.minAmountOut)) {
    throw new Error("Metrics PnL trade amountOut must be greater than or equal to minAmountOut");
  }

  try {
    normalizeHumanPrice(record.midPrice);
  } catch {
    throw new Error("Metrics PnL trade midPrice must be a positive canonical decimal");
  }
  assertTokenDecimals(record.tokenInDecimals, "PnL trade tokenInDecimals");
  assertTokenDecimals(record.tokenOutDecimals, "PnL trade tokenOutDecimals");
  assertPositiveUIntString(record.fairAmountOut, "PnL trade fairAmountOut");
  if (!isCanonicalUtcIsoTimestamp(record.valuationObservedAt)) {
    throw new Error("Metrics PnL trade valuationObservedAt must be a canonical UTC ISO timestamp");
  }
  assertIntString(record.grossPnlTokenOut, "PnL trade grossPnlTokenOut");
  assertSafeInteger(record.grossPnlBps, "PnL trade grossPnlBps");

  if (record.model !== "quote_snapshot_edge_v1") {
    throw new Error("Metrics PnL trade model must be quote_snapshot_edge_v1");
  }
  if (record.modelDescription !== quoteSnapshotPnlModelDescription) {
    throw new Error("Metrics PnL trade modelDescription must describe quote_snapshot_edge_v1");
  }
  if (!isCanonicalUtcIsoTimestamp(record.realizedAt)) {
    throw new Error("Metrics PnL trade realizedAt must be a canonical UTC ISO timestamp");
  }
}

export function assertPositiveSafeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Metrics ${field} must be a positive safe integer`);
  }
}

export function assertAddress(value: unknown, field: string): void {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`Metrics ${field} must be a 20-byte hex address`);
  }
}

export function usdReferenceMetricKey(chainId: number, tokenAddress: Address): string {
  return `${chainId}:${tokenAddress.toLowerCase()}`;
}

export function parseBoundedSignedInteger(value: unknown, field: string): bigint {
  if (typeof value !== "string" || !/^(0|-?[1-9][0-9]{0,77})$/.test(value)) {
    throw new Error(`Metrics ${field} must be a bounded canonical integer`);
  }
  return BigInt(value);
}

export function parseBoundedPositiveInteger(value: unknown, field: string): bigint {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,77}$/.test(value)) {
    throw new Error(`Metrics ${field} must be a bounded canonical positive integer`);
  }
  return BigInt(value);
}

export function metricLabelValue(value: string): string {
  if (typeof value !== "string") {
    throw new Error("Metrics label value must be a string");
  }
  const normalized = value.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  return normalized.length > 0 ? normalized : "UNKNOWN";
}

function assertSafeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`Metrics ${field} must be a safe integer`);
  }
}

function assertTokenDecimals(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 36) {
    throw new Error(`Metrics ${field} must be an integer between 0 and 36`);
  }
}

function assertBigInt(value: bigint, field: string): void {
  if (typeof value !== "bigint") {
    throw new Error(`Metrics ${field} must be a bigint`);
  }
}

function assertSafeIdentifier(value: unknown, field: string): void {
  if (typeof value !== "string") {
    throw new Error(`Metrics ${field} must be a primitive string`);
  }
  if (value.trim().length === 0) {
    throw new Error(`Metrics ${field} must be a non-empty string`);
  }
  if (value.length > maxSafeIdentifierLength) {
    throw new Error(`Metrics ${field} must be 128 characters or fewer`);
  }
  if (!safeIdentifierPattern.test(value)) {
    throw new Error(`Metrics ${field} must contain only letters, numbers, underscore, colon, or hyphen`);
  }
}

function assertPositiveUIntString(value: string, field: string): void {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`Metrics ${field} must be a positive uint string`);
  }
}

function assertIntString(value: unknown, field: string): void {
  if (typeof value !== "string" || !/^(0|-?[1-9][0-9]*)$/.test(value)) {
    throw new Error(`Metrics ${field} must be an int string`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function assertOwnFields(value: object, fields: readonly string[], path: string): void {
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      throw new Error(`Metrics ${path}.${field} must be an own field`);
    }
  }
}
