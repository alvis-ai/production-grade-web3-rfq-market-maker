import { encodeAbiParameters, keccak256, toBytes } from "viem";
import type { SettlementEventStatusResponse, SignedQuote } from "../../shared/types/rfq.js";
import type { InventoryService, SettlementDelta } from "../inventory/inventory.service.js";

const quoteTypeHash = keccak256(
  toBytes(
    "Quote(address user,address tokenIn,address tokenOut,uint256 amountIn,uint256 amountOut,uint256 minAmountOut,uint256 nonce,uint256 deadline,uint256 chainId)",
  ),
);

export interface ApplySettlementEventInput {
  quoteId: string;
  txHash: `0x${string}`;
  blockNumber?: number;
  logIndex?: number;
  quote: SignedQuote;
}

export interface ApplySettlementEventResult {
  event: SettlementEventStatusResponse;
  duplicate: boolean;
}

export interface SettlementEventStore {
  checkHealth?(): void;
  applySettlementEvent(input: ApplySettlementEventInput): ApplySettlementEventResult;
  getSettlementEvent(settlementEventId: string): SettlementEventStatusResponse | undefined;
}

export class SettlementEventService implements SettlementEventStore {
  private readonly events = new Map<string, SettlementEventStatusResponse>();
  private readonly eventIdsByKey = new Map<string, string>();

  constructor(private readonly inventoryService: InventoryService) {}

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
        event,
        duplicate: true,
      };
    }

    const event: SettlementEventStatusResponse = {
      settlementEventId: `se_${input.quote.chainId}_${txHash.slice(2)}_${logIndex}`,
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
      observedAt: new Date().toISOString(),
    };

    this.inventoryService.applySettlement(this.toSettlementDelta(event));
    this.events.set(event.settlementEventId, event);
    this.eventIdsByKey.set(key, event.settlementEventId);

    return {
      event,
      duplicate: false,
    };
  }

  getSettlementEvent(settlementEventId: string): SettlementEventStatusResponse | undefined {
    return this.events.get(settlementEventId);
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
      event.amountOut === input.quote.amountOut
    );
  }
}

function normalizeTxHash(value: `0x${string}`): `0x${string}` {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error("Settlement event txHash must be a 32-byte hex string");
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
  if (typeof input !== "object" || input === null) {
    throw new Error("Settlement event input must be an object");
  }

  assertNonEmptyString(input.quoteId, "quoteId");
  assertSettlementQuote(input.quote);
}

function assertSettlementQuote(quote: SignedQuote): void {
  if (typeof quote !== "object" || quote === null) {
    throw new Error("Settlement event quote must be an object");
  }

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
  assertUintString(quote.nonce, "quote.nonce");
  assertPositiveSafeInteger(quote.deadline, "quote.deadline");

  if (BigInt(quote.amountOut) < BigInt(quote.minAmountOut)) {
    throw new Error("Settlement event quote.amountOut must be greater than or equal to quote.minAmountOut");
  }
}

function assertNonEmptyString(value: string, field: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Settlement event ${field} must be a non-empty string`);
  }
}

function assertAddress(value: string, field: string): void {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`Settlement event ${field} must be a 20-byte hex address`);
  }
}

function assertPositiveUIntString(value: string, field: string): void {
  assertUintString(value, field);
  if (BigInt(value) <= 0n) {
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
