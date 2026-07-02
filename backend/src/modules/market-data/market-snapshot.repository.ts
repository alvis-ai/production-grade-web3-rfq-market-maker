import type { Address, MarketSnapshot, QuoteRequest } from "../../shared/types/rfq.js";
import { validateQuoteRequest } from "../../shared/validation/quote-request.js";
import { isCanonicalUtcIsoTimestamp } from "../../shared/validation/timestamp.js";

export const defaultMarketSnapshotSource = "static-market-data-v1";
const maxSafeIdentifierLength = 128;
const safeIdentifierPattern = /^[A-Za-z0-9_:-]+$/;

export interface MarketSnapshotRecord {
  snapshotId: string;
  chainId: number;
  tokenIn: Address;
  tokenOut: Address;
  midPrice: string;
  liquidityUsd: string;
  volatilityBps: number;
  source: string;
  observedAt: string;
  createdAt: string;
}

export interface SaveMarketSnapshotInput {
  request: QuoteRequest;
  snapshot: MarketSnapshot;
  source?: string;
}

export interface MarketSnapshotStore {
  checkHealth?(): void | Promise<void>;
  saveSnapshot(input: SaveMarketSnapshotInput): Promise<MarketSnapshotRecord>;
  findBySnapshotId(snapshotId: string): Promise<MarketSnapshotRecord | undefined>;
}

export class InMemoryMarketSnapshotRepository implements MarketSnapshotStore {
  private readonly recordsBySnapshotId = new Map<string, MarketSnapshotRecord>();

  checkHealth(): void {
    this.recordsBySnapshotId.get("__readiness_probe__");
  }

  async saveSnapshot(input: SaveMarketSnapshotInput): Promise<MarketSnapshotRecord> {
    const record = toMarketSnapshotRecord(input);
    const existing = this.recordsBySnapshotId.get(record.snapshotId);
    if (existing) {
      if (!isSameMarketSnapshot(existing, record)) {
        throw new Error(`Market snapshot conflict for ${record.snapshotId}`);
      }

      return cloneMarketSnapshotRecord(existing);
    }

    this.recordsBySnapshotId.set(record.snapshotId, record);
    return cloneMarketSnapshotRecord(record);
  }

  async findBySnapshotId(snapshotId: string): Promise<MarketSnapshotRecord | undefined> {
    assertSafeIdentifier(snapshotId, "snapshotId");
    const record = this.recordsBySnapshotId.get(snapshotId);
    return record ? cloneMarketSnapshotRecord(record) : undefined;
  }
}

function toMarketSnapshotRecord(input: SaveMarketSnapshotInput): MarketSnapshotRecord {
  assertSaveMarketSnapshotInput(input);
  const request = validateQuoteRequest(input.request);
  assertMarketSnapshot(input.snapshot);
  const source = input.source ?? defaultMarketSnapshotSource;
  assertNonEmptyString(source, "source");

  return {
    snapshotId: input.snapshot.snapshotId,
    chainId: request.chainId,
    tokenIn: request.tokenIn,
    tokenOut: request.tokenOut,
    midPrice: input.snapshot.midPrice,
    liquidityUsd: input.snapshot.liquidityUsd,
    volatilityBps: input.snapshot.volatilityBps,
    source,
    observedAt: input.snapshot.observedAt,
    createdAt: new Date().toISOString(),
  };
}

function assertSaveMarketSnapshotInput(input: SaveMarketSnapshotInput): void {
  assertObject(input, "input");
  assertObject(input.request, "request");
  assertObject(input.snapshot, "snapshot");
}

function assertMarketSnapshot(snapshot: MarketSnapshot): void {
  assertSafeIdentifier(snapshot.snapshotId, "snapshotId");
  if (!isPositiveDecimal(snapshot.midPrice)) {
    throw new Error("Market snapshot midPrice must be a positive decimal");
  }
  if (!isPositiveIntegerString(snapshot.liquidityUsd)) {
    throw new Error("Market snapshot liquidityUsd must be a positive uint string");
  }
  if (!Number.isSafeInteger(snapshot.volatilityBps) || snapshot.volatilityBps < 0 || snapshot.volatilityBps > 10_000) {
    throw new Error("Market snapshot volatilityBps must be an integer from 0 to 10000");
  }
  if (!isCanonicalUtcIsoTimestamp(snapshot.observedAt)) {
    throw new Error("Market snapshot observedAt must be a canonical UTC ISO timestamp");
  }
}

function assertObject(value: unknown, field: "input" | "request" | "snapshot"): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Market snapshot ${field} must be an object`);
  }
}

function assertNonEmptyString(value: string, field: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Market snapshot ${field} must be a non-empty string`);
  }
}

function assertSafeIdentifier(value: unknown, field: string): void {
  if (typeof value !== "string") {
    throw new Error(`Market snapshot ${field} must be a primitive string`);
  }
  if (value.trim().length === 0) {
    throw new Error(`Market snapshot ${field} must be a non-empty string`);
  }
  if (value.length > maxSafeIdentifierLength) {
    throw new Error(`Market snapshot ${field} must be 128 characters or fewer`);
  }
  if (!safeIdentifierPattern.test(value)) {
    throw new Error(`Market snapshot ${field} must contain only letters, numbers, underscore, colon, or hyphen`);
  }
}

function isPositiveIntegerString(value: string): boolean {
  return typeof value === "string" && /^[1-9][0-9]*$/.test(value);
}

function isPositiveDecimal(value: string): boolean {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value)) {
    return false;
  }

  return parseDecimalToScaledBigInt(value) > 0n;
}

function parseDecimalToScaledBigInt(value: string): bigint {
  const [whole, fraction = ""] = value.split(".");
  const scaledFraction = `${fraction.slice(0, 18)}${"0".repeat(Math.max(0, 18 - fraction.length))}`;
  return BigInt(whole) * 1_000_000_000_000_000_000n + BigInt(scaledFraction);
}

function isSameMarketSnapshot(left: MarketSnapshotRecord, right: MarketSnapshotRecord): boolean {
  return (
    left.snapshotId === right.snapshotId &&
    left.chainId === right.chainId &&
    left.tokenIn === right.tokenIn &&
    left.tokenOut === right.tokenOut &&
    left.midPrice === right.midPrice &&
    left.liquidityUsd === right.liquidityUsd &&
    left.volatilityBps === right.volatilityBps &&
    left.source === right.source &&
    left.observedAt === right.observedAt
  );
}

function cloneMarketSnapshotRecord(record: MarketSnapshotRecord): MarketSnapshotRecord {
  return { ...record };
}
