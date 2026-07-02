import type { MarketSnapshot, QuoteRequest, UIntString } from "../../shared/types/rfq.js";
import type { RoutePlan } from "../routing/routing.engine.js";

export interface PricingInput {
  request: QuoteRequest;
  snapshot: MarketSnapshot;
  routePlan: RoutePlan;
  inventorySkewBps: number;
}

export interface PricingResult {
  amountOut: UIntString;
  minAmountOut: UIntString;
  spreadBps: number;
  sizeImpactBps: number;
  inventorySkewBps: number;
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

const WAD = 1_000_000_000_000_000_000n;
const BPS = 10_000n;
const maxSafeIdentifierLength = 128;
const safeIdentifierPattern = /^[A-Za-z0-9_:-]+$/;

export class FormulaPricingEngine implements PricingEngine {
  private readonly config: FormulaPricingConfig;

  constructor(config: FormulaPricingConfig = defaultFormulaPricingConfig) {
    assertObject(config, "config");
    assertNonNegativeSafeInteger(config.baseSpreadBps, "baseSpreadBps");
    assertNonNegativeSafeInteger(config.internalInventoryBufferBps, "internalInventoryBufferBps");
    assertPositiveSafeInteger(config.volatilityDivisor, "volatilityDivisor");
    assertNonNegativeSafeInteger(config.maxSizeImpactBps, "maxSizeImpactBps");
    assertBpsUpperBound(config.maxTotalAdjustmentBps, "maxTotalAdjustmentBps");

    if (config.maxSizeImpactBps > config.maxTotalAdjustmentBps) {
      throw new Error("Formula pricing maxSizeImpactBps must be less than or equal to maxTotalAdjustmentBps");
    }

    this.config = cloneFormulaPricingConfig(config);
  }

  async price(input: PricingInput): Promise<PricingResult> {
    assertPricingInput(input);
    const amountIn = BigInt(input.request.amountIn);
    const midPrice = parseDecimalToWad(input.snapshot.midPrice);
    const rawAmountOut = (amountIn * midPrice) / WAD;
    const sizeImpactBps = calculateSizeImpactBps(amountIn, BigInt(input.routePlan.expectedLiquidityUsd), this.config);
    const volatilityPremiumBps = Math.ceil(input.snapshot.volatilityBps / this.config.volatilityDivisor);
    const routeBufferBps = input.routePlan.venue === "internal_inventory" ? this.config.internalInventoryBufferBps : 0;
    const quotedSpreadBps = clampBps(
      this.config.baseSpreadBps + routeBufferBps + volatilityPremiumBps + sizeImpactBps + input.inventorySkewBps,
      0,
      this.config.maxTotalAdjustmentBps,
    );
    const amountOut = applyBps(rawAmountOut, BPS - BigInt(quotedSpreadBps));
    const minAmountOut = applyBps(amountOut, BPS - BigInt(input.request.slippageBps));

    return {
      amountOut: amountOut.toString() as UIntString,
      minAmountOut: minAmountOut.toString() as UIntString,
      spreadBps: quotedSpreadBps,
      sizeImpactBps,
      inventorySkewBps: input.inventorySkewBps,
      pricingVersion: `formula-v1:${input.routePlan.venue}`,
    };
  }
}

function parseDecimalToWad(value: string): bigint {
  if (!/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value)) {
    throw new Error(`Invalid decimal value: ${value}`);
  }

  const [whole, fraction = ""] = value.split(".");
  const paddedFraction = `${fraction.slice(0, 18)}${"0".repeat(Math.max(0, 18 - fraction.length))}`;
  return BigInt(whole) * WAD + BigInt(paddedFraction);
}

function cloneFormulaPricingConfig(config: FormulaPricingConfig): FormulaPricingConfig {
  return { ...config };
}

function calculateSizeImpactBps(amountIn: bigint, liquidity: bigint, config: FormulaPricingConfig): number {
  if (liquidity <= 0n) {
    return config.maxSizeImpactBps;
  }

  const impact = ceilDiv(amountIn * BPS, liquidity);
  return Math.min(Number(impact), config.maxSizeImpactBps);
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
  assertObject(input.request, "request");
  assertObject(input.snapshot, "snapshot");
  assertObject(input.routePlan, "routePlan");
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
}

function assertObject(value: unknown, field: "config" | "input" | "request" | "snapshot" | "routePlan"): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Formula pricing ${field} must be an object`);
  }
}

function assertSafeIdentifier(value: string, field: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
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
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value) || parseDecimalToWad(value) <= 0n) {
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
