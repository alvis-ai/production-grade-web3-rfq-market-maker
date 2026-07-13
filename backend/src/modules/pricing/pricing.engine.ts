import type { MarketSnapshot, QuoteRequest, UIntString } from "../../shared/types/rfq.js";
import type { RoutePlan } from "../routing/routing.engine.js";
import {
  calculateUsdNotional,
  convertBaseUnitAmount,
  normalizeHumanPrice,
  type RationalUsdNotional,
} from "./price-normalization.js";
import {
  assertTokenRegistry,
  ConfiguredTokenRegistry,
  requireTokenMetadata,
  type TokenRegistry,
} from "./token-registry.js";

export interface PricingInput {
  request: QuoteRequest;
  snapshot: MarketSnapshot;
  routePlan: RoutePlan;
  inventorySkewBps: number;
  hedgeCostBps: number;
}

export interface PricingResult {
  amountOut: UIntString;
  minAmountOut: UIntString;
  spreadBps: number;
  sizeImpactBps: number;
  marketSpreadBps: number;
  inventorySkewBps: number;
  volatilityPremiumBps: number;
  hedgeCostBps: number;
  pricingVersion: string;
}

export interface PricingEngine {
  price(input: PricingInput): Promise<PricingResult>;
}

export interface FormulaPricingConfig {
  baseSpreadBps: number;
  internalInventoryBufferBps: number;
  volatilityDivisor: number;
  maxSizeImpactBps: number;
  maxTotalAdjustmentBps: number;
}

export const defaultFormulaPricingConfig: FormulaPricingConfig = {
  baseSpreadBps: 8,
  internalInventoryBufferBps: 2,
  volatilityDivisor: 5,
  maxSizeImpactBps: 250,
  maxTotalAdjustmentBps: 2500,
};

const BPS = 10_000n;
const MAX_UINT256 = (1n << 256n) - 1n;
const maxSafeIdentifierLength = 128;
const safeIdentifierPattern = /^[A-Za-z0-9_:-]+$/;
const formulaPricingConfigFields = [
  "baseSpreadBps",
  "internalInventoryBufferBps",
  "volatilityDivisor",
  "maxSizeImpactBps",
  "maxTotalAdjustmentBps",
] as const;
const pricingInputFields = ["request", "snapshot", "routePlan", "inventorySkewBps", "hedgeCostBps"] as const;
const quoteRequestFields = ["chainId", "user", "tokenIn", "tokenOut", "amountIn", "slippageBps"] as const;
const pricingSnapshotFields = ["snapshotId", "midPrice", "liquidityUsd", "marketSpreadBps", "volatilityBps"] as const;
const routePlanFields = ["routeId", "venue", "tokenIn", "tokenOut", "expectedLiquidityUsd"] as const;

export class FormulaPricingEngine implements PricingEngine {
  private readonly config: FormulaPricingConfig;
  private readonly tokenRegistry: TokenRegistry;

  constructor(
    config: FormulaPricingConfig = defaultFormulaPricingConfig,
    tokenRegistry: TokenRegistry = new ConfiguredTokenRegistry(),
  ) {
    assertObject(config, "config");
    assertOwnFields(config, formulaPricingConfigFields, "config");
    assertNonNegativeSafeInteger(config.baseSpreadBps, "baseSpreadBps");
    assertNonNegativeSafeInteger(config.internalInventoryBufferBps, "internalInventoryBufferBps");
    assertPositiveSafeInteger(config.volatilityDivisor, "volatilityDivisor");
    assertNonNegativeSafeInteger(config.maxSizeImpactBps, "maxSizeImpactBps");
    assertBpsUpperBound(config.maxTotalAdjustmentBps, "maxTotalAdjustmentBps");

    if (config.maxSizeImpactBps > config.maxTotalAdjustmentBps) {
      throw new Error("Formula pricing maxSizeImpactBps must be less than or equal to maxTotalAdjustmentBps");
    }

    this.config = cloneFormulaPricingConfig(config);
    assertTokenRegistry(tokenRegistry);
    this.tokenRegistry = tokenRegistry;
  }

  async price(input: PricingInput): Promise<PricingResult> {
    assertPricingInput(input);
    const amountIn = BigInt(input.request.amountIn);
    if (amountIn > MAX_UINT256) throw new Error("Formula pricing request.amountIn must fit uint256");
    const tokenIn = requireTokenMetadata(
      this.tokenRegistry,
      input.request.chainId,
      input.request.tokenIn,
      "Formula pricing tokenIn",
    );
    const tokenOut = requireTokenMetadata(
      this.tokenRegistry,
      input.request.chainId,
      input.request.tokenOut,
      "Formula pricing tokenOut",
    );
    const midPrice = normalizeHumanPrice(input.snapshot.midPrice);
    const rawAmountOut = convertBaseUnitAmount(amountIn, midPrice, tokenIn.decimals, tokenOut.decimals);
    if (rawAmountOut <= 0n) throw new Error("Formula pricing amountOut rounds to zero after decimals normalization");
    if (rawAmountOut > MAX_UINT256) throw new Error("Formula pricing amountOut must fit uint256");
    const usdNotional = calculateUsdNotional(amountIn, midPrice, tokenIn, tokenOut);
    const sizeImpactBps = calculateSizeImpactBps(
      usdNotional,
      BigInt(input.routePlan.expectedLiquidityUsd),
      this.config,
    );
    const volatilityPremiumBps = Math.ceil(input.snapshot.volatilityBps / this.config.volatilityDivisor);
    const routeBufferBps = input.routePlan.venue === "internal_inventory" ? this.config.internalInventoryBufferBps : 0;
    const quotedSpreadBps = clampBps(
      this.config.baseSpreadBps + routeBufferBps + input.snapshot.marketSpreadBps + volatilityPremiumBps + sizeImpactBps +
        input.inventorySkewBps + input.hedgeCostBps,
      0,
      this.config.maxTotalAdjustmentBps,
    );
    const amountOut = applyBps(rawAmountOut, BPS - BigInt(quotedSpreadBps));
    if (amountOut <= 0n) throw new Error("Formula pricing amountOut is zero after quote adjustments");
    const minAmountOut = applyBps(amountOut, BPS - BigInt(input.request.slippageBps));
    if (minAmountOut <= 0n) throw new Error("Formula pricing minAmountOut is zero after slippage adjustment");

    return {
      amountOut: amountOut.toString() as UIntString,
      minAmountOut: minAmountOut.toString() as UIntString,
      spreadBps: quotedSpreadBps,
      sizeImpactBps,
      marketSpreadBps: input.snapshot.marketSpreadBps,
      inventorySkewBps: input.inventorySkewBps,
      volatilityPremiumBps,
      hedgeCostBps: input.hedgeCostBps,
      pricingVersion: `formula-v4:${input.routePlan.venue}`,
    };
  }
}

function cloneFormulaPricingConfig(config: FormulaPricingConfig): FormulaPricingConfig {
  return { ...config };
}

function calculateSizeImpactBps(
  notionalUsd: RationalUsdNotional,
  liquidity: bigint,
  config: FormulaPricingConfig,
): number {
  if (liquidity <= 0n) {
    return config.maxSizeImpactBps;
  }

  const impact = ceilDiv(notionalUsd.numerator * BPS, notionalUsd.denominator * liquidity);
  return impact >= BigInt(config.maxSizeImpactBps) ? config.maxSizeImpactBps : Number(impact);
}

function applyBps(value: bigint, multiplierBps: bigint): bigint {
  return (value * multiplierBps) / BPS;
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}

function clampBps(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function assertPositiveSafeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Formula pricing ${field} must be a positive safe integer`);
  }
}

function assertNonNegativeSafeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Formula pricing ${field} must be a non-negative safe integer`);
  }
}

function assertBpsUpperBound(value: number, field: string): void {
  assertNonNegativeSafeInteger(value, field);

  if (value > 10_000) {
    throw new Error(`Formula pricing ${field} must be less than or equal to 10000 bps`);
  }
}

function assertPricingInput(input: PricingInput): void {
  assertObject(input, "input");
  assertOwnFields(input, pricingInputFields, "input");
  assertObject(input.request, "request");
  assertOwnFields(input.request, quoteRequestFields, "request");
  assertObject(input.snapshot, "snapshot");
  assertOwnFields(input.snapshot, pricingSnapshotFields, "snapshot");
  assertObject(input.routePlan, "routePlan");
  assertOwnFields(input.routePlan, routePlanFields, "routePlan");
  assertPositiveSafeInteger(input.request.chainId, "request.chainId");
  assertAddress(input.request.user, "request.user");
  assertAddress(input.request.tokenIn, "request.tokenIn");
  assertAddress(input.request.tokenOut, "request.tokenOut");
  if (input.request.tokenIn.toLowerCase() === input.request.tokenOut.toLowerCase()) {
    throw new Error("Formula pricing request token pair must contain distinct tokens");
  }
  assertPositiveUIntString(input.request.amountIn, "request.amountIn");
  assertBpsUpperBound(input.request.slippageBps, "request.slippageBps");

  assertSafeIdentifier(input.snapshot.snapshotId, "snapshot.snapshotId");
  assertPositiveDecimalString(input.snapshot.midPrice, "snapshot.midPrice");
  assertPositiveUIntString(input.snapshot.liquidityUsd, "snapshot.liquidityUsd");
  assertBpsUpperBound(input.snapshot.marketSpreadBps, "snapshot.marketSpreadBps");
  assertBpsUpperBound(input.snapshot.volatilityBps, "snapshot.volatilityBps");

  assertSafeIdentifier(input.routePlan.routeId, "routePlan.routeId");
  if (input.routePlan.venue !== "internal_inventory") {
    throw new Error("Formula pricing routePlan.venue must be internal_inventory");
  }
  assertAddress(input.routePlan.tokenIn, "routePlan.tokenIn");
  assertAddress(input.routePlan.tokenOut, "routePlan.tokenOut");
  if (
    input.routePlan.tokenIn.toLowerCase() !== input.request.tokenIn.toLowerCase() ||
    input.routePlan.tokenOut.toLowerCase() !== input.request.tokenOut.toLowerCase()
  ) {
    throw new Error("Formula pricing routePlan token pair must match request token pair");
  }
  assertPositiveUIntString(input.routePlan.expectedLiquidityUsd, "routePlan.expectedLiquidityUsd");
  assertBpsMagnitude(input.inventorySkewBps, "inventorySkewBps");
  assertBpsUpperBound(input.hedgeCostBps, "hedgeCostBps");
}

function assertObject(value: unknown, field: "config" | "input" | "request" | "snapshot" | "routePlan"): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Formula pricing ${field} must be an object`);
  }
}

function assertOwnFields(value: object, fields: readonly string[], path: string): void {
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      throw new Error(`Formula pricing ${path}.${field} must be an own field`);
    }
  }
}

function assertSafeIdentifier(value: unknown, field: string): void {
  if (typeof value !== "string") {
    throw new Error(`Formula pricing ${field} must be a primitive string`);
  }
  if (value.trim().length === 0) {
    throw new Error(`Formula pricing ${field} must be a non-empty string`);
  }
  if (value.length > maxSafeIdentifierLength) {
    throw new Error(`Formula pricing ${field} must be 128 characters or fewer`);
  }
  if (!safeIdentifierPattern.test(value)) {
    throw new Error(`Formula pricing ${field} must contain only letters, numbers, underscore, colon, or hyphen`);
  }
}

function assertAddress(value: string, field: string): void {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`Formula pricing ${field} must be a 20-byte hex address`);
  }
}

function assertPositiveUIntString(value: string, field: string): void {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`Formula pricing ${field} must be a positive uint string`);
  }
}

function assertPositiveDecimalString(value: string, field: string): void {
  try {
    normalizeHumanPrice(value);
  } catch {
    throw new Error(`Formula pricing ${field} must be a positive decimal string`);
  }
}

function assertBpsMagnitude(value: number, field: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`Formula pricing ${field} must be a safe integer`);
  }
  if (Math.abs(value) > 10_000) {
    throw new Error(`Formula pricing ${field} magnitude must be less than or equal to 10000 bps`);
  }
}
