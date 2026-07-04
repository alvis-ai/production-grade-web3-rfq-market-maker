import { encodeAbiParameters, keccak256, toBytes } from "viem";
import type { SettlementEventStatusResponse, SignedQuote } from "../../shared/types/rfq.js";
import type { InventoryService, SettlementDelta } from "../inventory/inventory.service.js";

const quoteTypeHash = keccak256(
  toBytes(
    "Quote(address user,address tokenIn,address tokenOut,uint256 amountIn,uint256 amountOut,uint256 minAmountOut,uint256 nonce,uint256 deadline,uint256 chainId)",
  ),
);
const maxSafeIdentifierLength = 128;
const safeIdentifierPattern = /^[A-Za-z0-9_:-]+$/;
const settlementEventInputFields = ["quoteId", "quote", "txHash"] as const;
const removeSettlementEventInputFields = ["chainId", "txHash"] as const;
const settlementQuoteHashLookupFields = ["chainId", "quoteHash"] as const;
const settlementEventOrdinalFields = ["blockNumber", "logIndex"] as const;
const settlementQuoteFields = [
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

export interface ApplySettlementEventInput {
  quoteId: string;
  txHash: `0x${string}`;
  blockNumber?: number;
  logIndex?: number;
  quote: SignedQuote;
}

export interface RemoveSettlementEventInput {
  chainId: number;
  txHash: `0x${string}`;
  blockNumber?: number;
  logIndex?: number;
}

export interface GetSettlementEventsByQuoteHashInput {
  chainId: number;
  quoteHash: `0x${string}`;
}

export interface ApplySettlementEventResult {
  event: SettlementEventStatusResponse;
  duplicate: boolean;
}

export interface RemoveSettlementEventResult {
  event?: SettlementEventStatusResponse;
  removed: boolean;
}

export interface SettlementEventStore {
  checkHealth?(): void;
  applySettlementEvent(input: ApplySettlementEventInput): ApplySettlementEventResult;
  removeSettlementEvent(input: RemoveSettlementEventInput): RemoveSettlementEventResult;
  getSettlementEvent(settlementEventId: string): SettlementEventStatusResponse | undefined;
  getSettlementEventsByQuoteHash(input: GetSettlementEventsByQuoteHashInput): SettlementEventStatusResponse[];
  listSettlementEvents(): SettlementEventStatusResponse[];
}

export class SettlementEventService implements SettlementEventStore {
  private readonly events = new Map<string, SettlementEventStatusResponse>();
  private readonly eventIdsByKey = new Map<string, string>();
  private readonly eventIdsByQuoteId = new Map<string, string>();
  private readonly eventIdsByChainQuoteHash = new Map<string, string[]>();

  constructor(private readonly inventoryService: InventoryService) {
    assertSettlementEventServiceDeps(inventoryService);
  }

  checkHealth(): void {
    this.getSettlementEvent("__readiness_probe__");
  }

  applySettlementEvent(input: ApplySettlementEventInput): ApplySettlementEventResult {
    assertSettlementEventInput(input);
    const txHash = normalizeTxHash(input.txHash);
    const logIndex = normalizeEventOrdinal(input.logIndex, "logIndex");
    const blockNumber = normalizeEventOrdinal(input.blockNumber, "blockNumber");
    const key = this.eventKey(input.quote.chainId, txHash, logIndex);
    const existingEventId = this.eventIdsByKey.get(key);
    if (existingEventId) {
      const event = this.events.get(existingEventId);
      if (!event) {
        throw new Error(`Settlement event index is inconsistent for ${existingEventId}`);
      }
      if (!this.matchesExistingEvent(event, input, { blockNumber, logIndex, txHash })) {
        throw new Error(`Settlement event key conflict for ${existingEventId}`);
      }

      return {
        event: cloneSettlementEvent(event),
        duplicate: true,
      };
    }
    const existingQuoteEventId = this.eventIdsByQuoteId.get(input.quoteId);
    if (existingQuoteEventId) {
      const event = this.events.get(existingQuoteEventId);
      if (!event) {
        throw new Error(`Settlement event quote index is inconsistent for ${existingQuoteEventId}`);
      }
      if (!this.matchesExistingEvent(event, input, { blockNumber, logIndex, txHash })) {
        throw new Error(`Settlement event quote conflict for ${existingQuoteEventId}`);
      }

      return {
        event: cloneSettlementEvent(event),
        duplicate: true,
      };
    }

    const settlementEventId = buildSettlementEventId(input.quote.chainId, txHash, logIndex);
    const event: SettlementEventStatusResponse = {
      settlementEventId,
      status: "applied",
      quoteId: input.quoteId,
      chainId: input.quote.chainId,
      txHash,
      quoteHash: hashSettlementQuote(input.quote),
      blockNumber,
      logIndex,
      user: input.quote.user,
      tokenIn: input.quote.tokenIn,
      tokenOut: input.quote.tokenOut,
      amountIn: input.quote.amountIn,
      amountOut: input.quote.amountOut,
      nonce: input.quote.nonce,
      observedAt: new Date().toISOString(),
    };

    this.inventoryService.applySettlement(this.toSettlementDelta(event));
    this.events.set(event.settlementEventId, event);
    this.eventIdsByKey.set(key, event.settlementEventId);
    this.eventIdsByQuoteId.set(event.quoteId, event.settlementEventId);
    this.indexQuoteHash(event);

    return {
      event: cloneSettlementEvent(event),
      duplicate: false,
    };
  }

  removeSettlementEvent(input: RemoveSettlementEventInput): RemoveSettlementEventResult {
    assertRemoveSettlementEventInput(input);
    const txHash = normalizeTxHash(input.txHash);
    const logIndex = normalizeEventOrdinal(input.logIndex, "logIndex");
    const blockNumber = normalizeEventOrdinal(input.blockNumber, "blockNumber");
    const key = this.eventKey(input.chainId, txHash, logIndex);
    const existingEventId = this.eventIdsByKey.get(key);
    if (!existingEventId) {
      return {
        removed: false,
      };
    }

    const event = this.events.get(existingEventId);
    if (!event) {
      throw new Error(`Settlement event index is inconsistent for ${existingEventId}`);
    }
    if (event.blockNumber !== blockNumber) {
      throw new Error(`Settlement event reorg block conflict for ${existingEventId}`);
    }

    this.events.delete(event.settlementEventId);
    this.eventIdsByKey.delete(key);
    this.eventIdsByQuoteId.delete(event.quoteId);
    this.removeQuoteHashIndex(event);
    this.inventoryService.rebuildFromSettlements(
      this.listSettlementEvents().map((canonicalEvent) => this.toSettlementDelta(canonicalEvent)),
    );

    return {
      event: cloneSettlementEvent(event),
      removed: true,
    };
  }

  getSettlementEvent(settlementEventId: string): SettlementEventStatusResponse | undefined {
    assertSafeIdentifier(settlementEventId, "settlementEventId");
    const event = this.events.get(settlementEventId);
    return event ? cloneSettlementEvent(event) : undefined;
  }

  getSettlementEventsByQuoteHash(input: GetSettlementEventsByQuoteHashInput): SettlementEventStatusResponse[] {
    assertSettlementQuoteHashLookupInput(input);
    const quoteHash = normalizeQuoteHash(input.quoteHash);
    const eventIds = this.eventIdsByChainQuoteHash.get(this.quoteHashKey(input.chainId, quoteHash)) ?? [];

    return eventIds.map((settlementEventId) => {
      const event = this.events.get(settlementEventId);
      if (!event) {
        throw new Error(`Settlement event quote hash index is inconsistent for ${settlementEventId}`);
      }

      return event;
    }).sort(compareSettlementEventsByChainOrder).map(cloneSettlementEvent);
  }

  listSettlementEvents(): SettlementEventStatusResponse[] {
    return [...this.events.values()].sort(compareSettlementEventsByChainOrder).map(cloneSettlementEvent);
  }

  private toSettlementDelta(event: SettlementEventStatusResponse): SettlementDelta {
    return {
      chainId: event.chainId,
      tokenIn: event.tokenIn,
      tokenOut: event.tokenOut,
      amountIn: event.amountIn,
      amountOut: event.amountOut,
    };
  }

  private eventKey(chainId: number, txHash: `0x${string}`, logIndex: number): string {
    return `${chainId}:${txHash.toLowerCase()}:${logIndex}`;
  }

  private quoteHashKey(chainId: number, quoteHash: `0x${string}`): string {
    return `${chainId}:${quoteHash.toLowerCase()}`;
  }

  private indexQuoteHash(event: SettlementEventStatusResponse): void {
    const key = this.quoteHashKey(event.chainId, event.quoteHash);
    const eventIds = this.eventIdsByChainQuoteHash.get(key);
    if (!eventIds) {
      this.eventIdsByChainQuoteHash.set(key, [event.settlementEventId]);
      return;
    }
    if (!eventIds.includes(event.settlementEventId)) {
      eventIds.push(event.settlementEventId);
    }
  }

  private removeQuoteHashIndex(event: SettlementEventStatusResponse): void {
    const key = this.quoteHashKey(event.chainId, event.quoteHash);
    const eventIds = this.eventIdsByChainQuoteHash.get(key);
    if (!eventIds) {
      return;
    }

    const remainingEventIds = eventIds.filter((settlementEventId) => settlementEventId !== event.settlementEventId);
    if (remainingEventIds.length === 0) {
      this.eventIdsByChainQuoteHash.delete(key);
      return;
    }

    this.eventIdsByChainQuoteHash.set(key, remainingEventIds);
  }

  private matchesExistingEvent(
    event: SettlementEventStatusResponse,
    input: ApplySettlementEventInput,
    normalized: { blockNumber: number; logIndex: number; txHash: `0x${string}` },
  ): boolean {
    return (
      event.quoteId === input.quoteId &&
      event.chainId === input.quote.chainId &&
      event.txHash.toLowerCase() === normalized.txHash &&
      event.quoteHash.toLowerCase() === hashSettlementQuote(input.quote).toLowerCase() &&
      event.blockNumber === normalized.blockNumber &&
      event.logIndex === normalized.logIndex &&
      event.user.toLowerCase() === input.quote.user.toLowerCase() &&
      event.tokenIn.toLowerCase() === input.quote.tokenIn.toLowerCase() &&
      event.tokenOut.toLowerCase() === input.quote.tokenOut.toLowerCase() &&
      event.amountIn === input.quote.amountIn &&
      event.amountOut === input.quote.amountOut &&
      event.nonce === input.quote.nonce
    );
  }
}

function cloneSettlementEvent(event: SettlementEventStatusResponse): SettlementEventStatusResponse {
  return { ...event };
}

function compareSettlementEventsByChainOrder(
  left: SettlementEventStatusResponse,
  right: SettlementEventStatusResponse,
): number {
  if (left.blockNumber !== right.blockNumber) {
    return left.blockNumber - right.blockNumber;
  }

  return left.logIndex - right.logIndex;
}

function buildSettlementEventId(chainId: number, txHash: `0x${string}`, logIndex: number): string {
  const settlementEventId = `se_${chainId}_${txHash.slice(2)}_${logIndex}`;
  assertSafeIdentifier(settlementEventId, "settlementEventId");
  return settlementEventId;
}

function assertSettlementEventServiceDeps(inventoryService: InventoryService): void {
  assertRecord(inventoryService, "inventoryService");
  assertDependencyMethod(inventoryService, "inventoryService", "applySettlement");
  assertDependencyMethod(inventoryService, "inventoryService", "rebuildFromSettlements");
}

function assertDependencyMethod(
  dependency: unknown,
  dependencyName: "inventoryService",
  methodName: string,
): void {
  const method = typeof dependency === "object" && dependency !== null
    ? (dependency as Record<string, unknown>)[methodName]
    : undefined;
  if (typeof method !== "function") {
    throw new Error(`Settlement event ${dependencyName}.${methodName} must be a function`);
  }
}

function normalizeTxHash(value: unknown): `0x${string}` {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error("Settlement event txHash must be a 32-byte hex string");
  }

  return value.toLowerCase() as `0x${string}`;
}

function normalizeQuoteHash(value: unknown): `0x${string}` {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error("Settlement event quoteHash must be a 32-byte hex string");
  }

  return value.toLowerCase() as `0x${string}`;
}

function normalizeEventOrdinal(value: number | undefined, field: "blockNumber" | "logIndex"): number {
  const normalized = value ?? 0;
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw new Error(`Settlement event ${field} must be a non-negative safe integer`);
  }

  return normalized;
}

export function hashSettlementQuote(quote: SignedQuote): `0x${string}` {
  assertSettlementQuote(quote);
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "address" },
        { type: "address" },
        { type: "address" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
      ],
      [
        quoteTypeHash,
        quote.user,
        quote.tokenIn,
        quote.tokenOut,
        BigInt(quote.amountIn),
        BigInt(quote.amountOut),
        BigInt(quote.minAmountOut),
        BigInt(quote.nonce),
        BigInt(quote.deadline),
        BigInt(quote.chainId),
      ],
    ),
  );
}

function assertSettlementEventInput(input: ApplySettlementEventInput): void {
  assertRecord(input, "input");
  assertOwnFields(input, settlementEventInputFields, "input");
  assertOwnOptionalFields(input, settlementEventOrdinalFields, "input");
  assertSafeIdentifier(input.quoteId, "quoteId");
  assertSettlementQuote(input.quote);
}

function assertRemoveSettlementEventInput(input: RemoveSettlementEventInput): void {
  assertRecord(input, "reorg input");
  assertOwnFields(input, removeSettlementEventInputFields, "reorg input");
  assertOwnOptionalFields(input, settlementEventOrdinalFields, "reorg input");
  assertPositiveSafeInteger(input.chainId, "reorg.chainId");
}

function assertSettlementQuoteHashLookupInput(input: GetSettlementEventsByQuoteHashInput): void {
  assertRecord(input, "quote hash lookup input");
  assertOwnFields(input, settlementQuoteHashLookupFields, "quote hash lookup input");
  assertPositiveSafeInteger(input.chainId, "lookup.chainId");
}

function assertSettlementQuote(quote: SignedQuote): void {
  assertRecord(quote, "quote");
  assertOwnFields(quote, settlementQuoteFields, "quote");
  assertPositiveSafeInteger(quote.chainId, "quote.chainId");
  assertAddress(quote.user, "quote.user");
  assertAddress(quote.tokenIn, "quote.tokenIn");
  assertAddress(quote.tokenOut, "quote.tokenOut");

  if (quote.tokenIn.toLowerCase() === quote.tokenOut.toLowerCase()) {
    throw new Error("Settlement event quote token pair must contain distinct tokens");
  }

  assertPositiveUIntString(quote.amountIn, "quote.amountIn");
  assertPositiveUIntString(quote.amountOut, "quote.amountOut");
  assertPositiveUIntString(quote.minAmountOut, "quote.minAmountOut");
  assertPositiveUIntString(quote.nonce, "quote.nonce");
  assertPositiveSafeInteger(quote.deadline, "quote.deadline");

  if (BigInt(quote.amountOut) < BigInt(quote.minAmountOut)) {
    throw new Error("Settlement event quote.amountOut must be greater than or equal to quote.minAmountOut");
  }
}

function assertRecord(value: unknown, field: string): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Settlement event ${field} must be an object`);
  }
}

function assertOwnFields(value: object, fields: readonly string[], path: string): void {
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      throw new Error(`Settlement event ${path}.${field} must be an own field`);
    }
  }
}

function assertOwnOptionalFields(value: object, fields: readonly string[], path: string): void {
  for (const field of fields) {
    if (field in value && !Object.prototype.hasOwnProperty.call(value, field)) {
      throw new Error(`Settlement event ${path}.${field} must be an own field when provided`);
    }
  }
}

function assertSafeIdentifier(value: unknown, field: string): void {
  if (typeof value !== "string") {
    throw new Error(`Settlement event ${field} must be a primitive string`);
  }
  if (value.trim().length === 0) {
    throw new Error(`Settlement event ${field} must be a non-empty string`);
  }
  if (value.length > maxSafeIdentifierLength) {
    throw new Error(`Settlement event ${field} must be 128 characters or fewer`);
  }
  if (!safeIdentifierPattern.test(value)) {
    throw new Error(`Settlement event ${field} must contain only letters, numbers, underscore, colon, or hyphen`);
  }
}

function assertAddress(value: string, field: string): void {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`Settlement event ${field} must be a 20-byte hex address`);
  }
}

function assertPositiveUIntString(value: string, field: string): void {
  assertUintString(value, field);
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`Settlement event ${field} must be a positive uint string`);
  }
}

function assertUintString(value: string, field: string): void {
  if (typeof value !== "string" || !/^[0-9]+$/.test(value)) {
    throw new Error(`Settlement event ${field} must be a uint string`);
  }
}

function assertPositiveSafeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Settlement event ${field} must be a positive safe integer`);
  }
}
