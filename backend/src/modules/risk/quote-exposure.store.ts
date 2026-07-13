import type { QuoteRequest } from "../../shared/types/rfq.js";
import type { PricingResult } from "../pricing/pricing.engine.js";
import {
  requireTokenMetadata,
  type TokenRegistry,
} from "../pricing/token-registry.js";
import type { TreasuryLiquiditySnapshot } from "./treasury-liquidity.provider.js";

export type QuoteExposureRejectReason =
  | "USER_OPEN_NOTIONAL_LIMIT_EXCEEDED"
  | "PAIR_OPEN_NOTIONAL_LIMIT_EXCEEDED"
  | "TREASURY_LIQUIDITY_INSUFFICIENT";

export interface QuoteExposurePolicy {
  maxUserOpenNotionalUsd: string;
  maxPairOpenNotionalUsd: string;
}

export interface ReserveQuoteExposureInput {
  quoteId: string;
  request: QuoteRequest;
  pricing: PricingResult;
  deadline: number;
  treasuryLiquidity?: TreasuryLiquiditySnapshot;
}

export type QuoteExposureReservationResult =
  | { status: "reserved"; notionalUsdE18: string }
  | { status: "rejected"; reasonCode: QuoteExposureRejectReason };

export interface QuoteExposureStore {
  checkHealth?(): Promise<void>;
  reserve(input: ReserveQuoteExposureInput): Promise<QuoteExposureReservationResult>;
  release(quoteId: string): Promise<void>;
}

export interface NormalizedQuoteExposureReservation {
  quoteId: string;
  chainId: number;
  user: `0x${string}`;
  tokenLow: `0x${string}`;
  tokenHigh: `0x${string}`;
  tokenOut: `0x${string}`;
  amountOut: bigint;
  notionalUsdE18: bigint;
  deadline: number;
  treasuryLiquidity?: {
    settlementAddress: `0x${string}`;
    treasuryAddress: `0x${string}`;
    availableBalance: bigint;
    blockNumber: bigint;
  };
}

type ActiveQuoteExposure = NormalizedQuoteExposureReservation;

const usdScale = 10n ** 18n;
const maxUint256 = (1n << 256n) - 1n;
const maxReservationTtlSeconds = 3_600;
const safeIdentifierPattern = /^[A-Za-z0-9_:-]+$/;

export class InMemoryQuoteExposureStore implements QuoteExposureStore {
  private readonly reservations = new Map<string, ActiveQuoteExposure>();
  private readonly maxUserOpenNotionalUsdE18: bigint;
  private readonly maxPairOpenNotionalUsdE18: bigint;

  constructor(
    policy: QuoteExposurePolicy,
    private readonly tokenRegistry: TokenRegistry,
    private readonly nowSeconds: () => number = () => Math.floor(Date.now() / 1_000),
  ) {
    const limits = normalizeQuoteExposurePolicy(policy);
    assertNowSecondsProvider(nowSeconds);
    this.maxUserOpenNotionalUsdE18 = limits.maxUserOpenNotionalUsdE18;
    this.maxPairOpenNotionalUsdE18 = limits.maxPairOpenNotionalUsdE18;
  }

  async checkHealth(): Promise<void> {}

  async reserve(input: ReserveQuoteExposureInput): Promise<QuoteExposureReservationResult> {
    const nowSeconds = readNowSeconds(this.nowSeconds);
    const reservation = normalizeQuoteExposureReservation(input, this.tokenRegistry, nowSeconds);
    this.purgeExpired(nowSeconds);

    const existing = this.reservations.get(reservation.quoteId);
    if (existing) {
      assertSameReservation(existing, reservation);
      return { status: "reserved", notionalUsdE18: existing.notionalUsdE18.toString() };
    }

    let userOpenNotionalUsdE18 = 0n;
    let pairOpenNotionalUsdE18 = 0n;
    let reservedOutputAmount = 0n;
    for (const active of this.reservations.values()) {
      if (active.chainId !== reservation.chainId) continue;
      if (active.user === reservation.user) {
        userOpenNotionalUsdE18 += active.notionalUsdE18;
      }
      if (active.tokenLow === reservation.tokenLow && active.tokenHigh === reservation.tokenHigh) {
        pairOpenNotionalUsdE18 += active.notionalUsdE18;
      }
      if (active.tokenOut === reservation.tokenOut) reservedOutputAmount += active.amountOut;
    }

    if (userOpenNotionalUsdE18 + reservation.notionalUsdE18 > this.maxUserOpenNotionalUsdE18) {
      return { status: "rejected", reasonCode: "USER_OPEN_NOTIONAL_LIMIT_EXCEEDED" };
    }
    if (pairOpenNotionalUsdE18 + reservation.notionalUsdE18 > this.maxPairOpenNotionalUsdE18) {
      return { status: "rejected", reasonCode: "PAIR_OPEN_NOTIONAL_LIMIT_EXCEEDED" };
    }
    if (reservation.treasuryLiquidity &&
        reservedOutputAmount + reservation.amountOut > reservation.treasuryLiquidity.availableBalance) {
      return { status: "rejected", reasonCode: "TREASURY_LIQUIDITY_INSUFFICIENT" };
    }

    this.reservations.set(reservation.quoteId, reservation);
    return { status: "reserved", notionalUsdE18: reservation.notionalUsdE18.toString() };
  }

  async release(quoteId: string): Promise<void> {
    assertSafeIdentifier(quoteId, "Quote exposure quoteId");
    this.reservations.delete(quoteId);
  }

  private purgeExpired(nowSeconds: number): void {
    for (const [quoteId, reservation] of this.reservations) {
      if (reservation.deadline <= nowSeconds) this.reservations.delete(quoteId);
    }
  }
}

export function normalizeQuoteExposurePolicy(policy: QuoteExposurePolicy): {
  maxUserOpenNotionalUsdE18: bigint;
  maxPairOpenNotionalUsdE18: bigint;
} {
  assertRecord(policy, "Quote exposure policy");
  assertExactFields(
    policy,
    ["maxUserOpenNotionalUsd", "maxPairOpenNotionalUsd"],
    "Quote exposure policy",
  );
  const maxUserOpenNotionalUsd = parsePositiveUint256(
    policy.maxUserOpenNotionalUsd,
    "Quote exposure policy.maxUserOpenNotionalUsd",
  );
  const maxPairOpenNotionalUsd = parsePositiveUint256(
    policy.maxPairOpenNotionalUsd,
    "Quote exposure policy.maxPairOpenNotionalUsd",
  );
  return {
    maxUserOpenNotionalUsdE18: maxUserOpenNotionalUsd * usdScale,
    maxPairOpenNotionalUsdE18: maxPairOpenNotionalUsd * usdScale,
  };
}

export function normalizeQuoteExposureReservation(
  input: ReserveQuoteExposureInput,
  tokenRegistry: TokenRegistry,
  nowSeconds: number,
): NormalizedQuoteExposureReservation {
  assertPositiveSafeInteger(nowSeconds, "Quote exposure current time");
  assertRecord(input, "Quote exposure reservation");
  const inputFields = ["quoteId", "request", "pricing", "deadline"] as const;
  assertExactFields(input, inputFields, "Quote exposure reservation", ["treasuryLiquidity"]);
  assertSafeIdentifier(input.quoteId, "Quote exposure reservation.quoteId");
  assertPositiveSafeInteger(input.deadline, "Quote exposure reservation.deadline");
  if (input.deadline <= nowSeconds || input.deadline > nowSeconds + maxReservationTtlSeconds) {
    throw new Error(`Quote exposure reservation.deadline must be within ${maxReservationTtlSeconds} seconds`);
  }
  assertRecord(input.request, "Quote exposure reservation.request");
  assertExactFields(
    input.request,
    ["chainId", "user", "tokenIn", "tokenOut", "amountIn", "slippageBps"],
    "Quote exposure reservation.request",
  );
  assertPositiveSafeInteger(input.request.chainId, "Quote exposure reservation.request.chainId");
  assertAddress(input.request.user, "Quote exposure reservation.request.user");
  assertAddress(input.request.tokenIn, "Quote exposure reservation.request.tokenIn");
  assertAddress(input.request.tokenOut, "Quote exposure reservation.request.tokenOut");
  if (input.request.tokenIn.toLowerCase() === input.request.tokenOut.toLowerCase()) {
    throw new Error("Quote exposure reservation token pair must be distinct");
  }
  assertPositiveUintString(input.request.amountIn, "Quote exposure reservation.request.amountIn");
  assertRecord(input.pricing, "Quote exposure reservation.pricing");
  assertExactFields(
    input.pricing,
    [
      "amountOut",
      "minAmountOut",
      "spreadBps",
      "sizeImpactBps",
      "marketSpreadBps",
      "inventorySkewBps",
      "volatilityPremiumBps",
      "hedgeCostBps",
      "pricingVersion",
    ],
    "Quote exposure reservation.pricing",
  );
  assertPositiveUintString(input.pricing.amountOut, "Quote exposure reservation.pricing.amountOut");

  const tokenIn = requireTokenMetadata(
    tokenRegistry,
    input.request.chainId,
    input.request.tokenIn,
    "Quote exposure tokenIn",
  );
  const tokenOut = requireTokenMetadata(
    tokenRegistry,
    input.request.chainId,
    input.request.tokenOut,
    "Quote exposure tokenOut",
  );
  const usdNotionals: bigint[] = [];
  if (tokenIn.usdReference) {
    usdNotionals.push(toUsdE18(input.request.amountIn, tokenIn.decimals));
  }
  if (tokenOut.usdReference) {
    usdNotionals.push(toUsdE18(input.pricing.amountOut, tokenOut.decimals));
  }
  if (usdNotionals.length === 0) {
    throw new Error("Quote exposure reservation requires a USD-reference token");
  }
  const notionalUsdE18 = usdNotionals.reduce((largest, current) => current > largest ? current : largest);
  const [tokenLow, tokenHigh] = [input.request.tokenIn.toLowerCase(), input.request.tokenOut.toLowerCase()].sort();
  const treasuryLiquidity = input.treasuryLiquidity === undefined
    ? undefined
    : normalizeTreasuryLiquidity(input.treasuryLiquidity, input.request.chainId, input.request.tokenOut);

  return {
    quoteId: input.quoteId,
    chainId: input.request.chainId,
    user: input.request.user.toLowerCase() as `0x${string}`,
    tokenLow: tokenLow as `0x${string}`,
    tokenHigh: tokenHigh as `0x${string}`,
    tokenOut: input.request.tokenOut.toLowerCase() as `0x${string}`,
    amountOut: BigInt(input.pricing.amountOut),
    notionalUsdE18,
    deadline: input.deadline,
    ...(treasuryLiquidity ? { treasuryLiquidity } : {}),
  };
}

export function assertSameReservation(
  existing: NormalizedQuoteExposureReservation,
  expected: NormalizedQuoteExposureReservation,
): void {
  if (
    existing.quoteId !== expected.quoteId ||
    existing.chainId !== expected.chainId ||
    existing.user !== expected.user ||
    existing.tokenLow !== expected.tokenLow ||
    existing.tokenHigh !== expected.tokenHigh ||
    existing.tokenOut !== expected.tokenOut ||
    existing.amountOut !== expected.amountOut ||
    existing.notionalUsdE18 !== expected.notionalUsdE18 ||
    existing.deadline !== expected.deadline
  ) {
    throw new Error(`Quote exposure reservation conflict for ${expected.quoteId}`);
  }
}

function normalizeTreasuryLiquidity(
  value: TreasuryLiquiditySnapshot,
  expectedChainId: number,
  expectedToken: `0x${string}`,
): NonNullable<NormalizedQuoteExposureReservation["treasuryLiquidity"]> {
  assertRecord(value, "Quote exposure treasury liquidity");
  assertExactFields(
    value,
    ["chainId", "settlementAddress", "treasuryAddress", "token", "availableBalance", "blockNumber"],
    "Quote exposure treasury liquidity",
  );
  assertPositiveSafeInteger(value.chainId, "Quote exposure treasury liquidity.chainId");
  if (value.chainId !== expectedChainId) throw new Error("Quote exposure treasury liquidity chain does not match request");
  assertAddress(value.settlementAddress, "Quote exposure treasury liquidity.settlementAddress");
  assertAddress(value.treasuryAddress, "Quote exposure treasury liquidity.treasuryAddress");
  assertAddress(value.token, "Quote exposure treasury liquidity.token");
  if (value.token.toLowerCase() !== expectedToken.toLowerCase()) {
    throw new Error("Quote exposure treasury liquidity token does not match request tokenOut");
  }
  if (typeof value.availableBalance !== "string" || !/^(0|[1-9][0-9]*)$/.test(value.availableBalance) ||
      BigInt(value.availableBalance) > maxUint256) {
    throw new Error("Quote exposure treasury liquidity.availableBalance must be a canonical uint256 string");
  }
  if (typeof value.blockNumber !== "bigint" || value.blockNumber < 0n) {
    throw new Error("Quote exposure treasury liquidity.blockNumber must be a non-negative bigint");
  }
  return {
    settlementAddress: value.settlementAddress.toLowerCase() as `0x${string}`,
    treasuryAddress: value.treasuryAddress.toLowerCase() as `0x${string}`,
    availableBalance: BigInt(value.availableBalance),
    blockNumber: value.blockNumber,
  };
}

function toUsdE18(amount: string, decimals: number): bigint {
  const rawAmount = BigInt(amount);
  if (decimals <= 18) return rawAmount * (10n ** BigInt(18 - decimals));
  const divisor = 10n ** BigInt(decimals - 18);
  return (rawAmount + divisor - 1n) / divisor;
}

function readNowSeconds(provider: () => number): number {
  const value = provider();
  assertPositiveSafeInteger(value, "Quote exposure current time");
  return value;
}

function assertNowSecondsProvider(value: unknown): asserts value is () => number {
  if (typeof value !== "function") throw new Error("Quote exposure nowSeconds must be a function");
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function assertExactFields(
  value: Record<string, unknown>,
  fields: readonly string[],
  label: string,
  optionalFields: readonly string[] = [],
): void {
  const expected = new Set([...fields, ...optionalFields]);
  for (const field of Object.keys(value)) {
    if (!expected.has(field)) throw new Error(`${label} must not include unknown field ${field}`);
  }
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) throw new Error(`${label}.${field} must be an own field`);
  }
  for (const field of optionalFields) {
    if (field in value && !Object.prototype.hasOwnProperty.call(value, field)) {
      throw new Error(`${label}.${field} must be an own field when provided`);
    }
  }
}

function assertSafeIdentifier(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.length < 1 || value.length > 128 || !safeIdentifierPattern.test(value)) {
    throw new Error(`${label} must be a 1-128 character safe identifier`);
  }
}

function assertPositiveSafeInteger(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
}

function assertAddress(value: unknown, label: string): asserts value is `0x${string}` {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`${label} must be a 20-byte hex address`);
  }
}

function assertPositiveUintString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value) || BigInt(value) > maxUint256) {
    throw new Error(`${label} must be a canonical positive uint256 string`);
  }
}

function parsePositiveUint256(value: unknown, label: string): bigint {
  assertPositiveUintString(value, label);
  return BigInt(value);
}
