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

export class FormulaPricingEngine implements PricingEngine {
  constructor(private readonly config: FormulaPricingConfig = defaultFormulaPricingConfig) {}

  async price(input: PricingInput): Promise<PricingResult> {
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
  if (!/^[0-9]+(\.[0-9]+)?$/.test(value)) {
    throw new Error(`Invalid decimal value: ${value}`);
  }

  const [whole, fraction = ""] = value.split(".");
  const paddedFraction = `${fraction.slice(0, 18)}${"0".repeat(Math.max(0, 18 - fraction.length))}`;
  return BigInt(whole) * WAD + BigInt(paddedFraction);
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
