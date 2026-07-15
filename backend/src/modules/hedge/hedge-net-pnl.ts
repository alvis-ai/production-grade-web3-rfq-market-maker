import type { CexTradeFill } from "./binance-spot.adapter.js";
import {
  hedgeFillNetPnlModelDescription,
  type Address,
  type IntString,
  type UIntString,
} from "../../shared/types/rfq.js";
import { assertCexTradeFill } from "./hedge-fee-evidence.js";

export const hedgeFillNetPnlModel = "hedge_fill_net_v1" as const;
export { hedgeFillNetPnlModelDescription };

const SCALE_DECIMALS = 18;
const SCALE = 10n ** BigInt(SCALE_DECIMALS);

export interface HedgeNetPnlInput {
  side: "buy" | "sell";
  targetAmount: UIntString;
  filledAmount: UIntString;
  baseTokenDecimals: number;
  settlementReferenceAmount: UIntString;
  quoteTokenDecimals: number;
  executedQuoteQuantity: string;
  baseAsset: string;
  quoteAsset: string;
  quoteToken: Address;
  fills: readonly CexTradeFill[];
  realizedAt: string;
}

export interface CompleteHedgeNetPnl {
  status: "complete";
  model: typeof hedgeFillNetPnlModel;
  modelDescription: typeof hedgeFillNetPnlModelDescription;
  valuationToken: Address;
  valuationAsset: string;
  settlementReferenceQuantity: string;
  executedQuoteQuantity: string;
  residualBaseAmount: string;
  residualQuoteQuantity: string;
  commissionQuoteQuantity: string;
  netPnlQuoteQuantity: IntString;
  realizedAt: string;
}

export interface UnavailableHedgeNetPnl {
  status: "unavailable";
  model: typeof hedgeFillNetPnlModel;
  modelDescription: typeof hedgeFillNetPnlModelDescription;
  valuationToken: Address;
  valuationAsset: string;
  reasonCode: "UNVALUED_COMMISSION_ASSET" | "PARTIAL_HEDGE_UNCLOSED";
  unvaluedCommissionAssets?: string[];
  realizedAt: string;
}

export type HedgeNetPnlCalculation = CompleteHedgeNetPnl | UnavailableHedgeNetPnl;

export function calculateHedgeNetPnl(input: HedgeNetPnlInput): HedgeNetPnlCalculation {
  assertInput(input);
  const targetRaw = BigInt(input.targetAmount);
  const filledRaw = BigInt(input.filledAmount);
  if (filledRaw > targetRaw) throw new Error("Hedge net PnL filledAmount exceeds targetAmount");

  const executedQuoteScaled = parseDecimalScaled(input.executedQuoteQuantity, SCALE_DECIMALS, "executedQuoteQuantity");
  const settlementReferenceScaled = scaleRawTokenAmount(
    BigInt(input.settlementReferenceAmount),
    input.quoteTokenDecimals,
  );
  const residualRaw = targetRaw - filledRaw;
  const residualQuoteScaled = input.side === "sell"
    ? divideFloor(executedQuoteScaled * residualRaw, filledRaw)
    : divideCeil(executedQuoteScaled * residualRaw, filledRaw);

  let commissionQuoteScaled = 0n;
  const unvaluedAssets = new Set<string>();
  for (const fill of input.fills) {
    assertCexTradeFill(fill);
    if (isZeroDecimal(fill.commissionQuantity)) continue;
    if (fill.commissionAsset === input.quoteAsset) {
      commissionQuoteScaled += parseDecimalScaledCeil(fill.commissionQuantity, SCALE_DECIMALS, "commissionQuantity");
    } else if (fill.commissionAsset === input.baseAsset) {
      commissionQuoteScaled += valueBaseCommission(fill);
    } else {
      unvaluedAssets.add(fill.commissionAsset);
    }
  }

  const common = {
    model: hedgeFillNetPnlModel,
    modelDescription: hedgeFillNetPnlModelDescription,
    valuationToken: input.quoteToken.toLowerCase() as Address,
    valuationAsset: input.quoteAsset,
    realizedAt: input.realizedAt,
  } as const;
  if (unvaluedAssets.size > 0) {
    return {
      ...common,
      status: "unavailable",
      reasonCode: "UNVALUED_COMMISSION_ASSET",
      unvaluedCommissionAssets: [...unvaluedAssets].sort(),
    };
  }

  const netPnlScaled = input.side === "sell"
    ? executedQuoteScaled + residualQuoteScaled - settlementReferenceScaled - commissionQuoteScaled
    : settlementReferenceScaled - executedQuoteScaled - residualQuoteScaled - commissionQuoteScaled;
  return {
    ...common,
    status: "complete",
    settlementReferenceQuantity: formatScaled(settlementReferenceScaled),
    executedQuoteQuantity: formatScaled(executedQuoteScaled),
    residualBaseAmount: residualRaw.toString(),
    residualQuoteQuantity: formatScaled(residualQuoteScaled),
    commissionQuoteQuantity: formatScaled(commissionQuoteScaled),
    netPnlQuoteQuantity: formatScaled(netPnlScaled) as IntString,
  };
}

function valueBaseCommission(fill: CexTradeFill): bigint {
  const commission = parseDecimalFraction(fill.commissionQuantity, "commissionQuantity");
  const base = parseDecimalFraction(fill.quantity, "quantity");
  const quoteScaled = parseDecimalScaled(fill.quoteQuantity, SCALE_DECIMALS, "quoteQuantity");
  return divideCeil(
    quoteScaled * commission.numerator * base.denominator,
    commission.denominator * base.numerator,
  );
}

function assertInput(input: HedgeNetPnlInput): void {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new Error("Hedge net PnL input is invalid");
  if (input.side !== "buy" && input.side !== "sell") throw new Error("Hedge net PnL side is invalid");
  for (const [field, value] of [["targetAmount", input.targetAmount], ["filledAmount", input.filledAmount],
    ["settlementReferenceAmount", input.settlementReferenceAmount]] as const) {
    if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) throw new Error(`Hedge net PnL ${field} is invalid`);
  }
  if (!Number.isSafeInteger(input.baseTokenDecimals) || input.baseTokenDecimals < 0 || input.baseTokenDecimals > 36) {
    throw new Error("Hedge net PnL baseTokenDecimals is invalid");
  }
  if (!Number.isSafeInteger(input.quoteTokenDecimals) || input.quoteTokenDecimals < 0 || input.quoteTokenDecimals > 18) {
    throw new Error("Hedge net PnL quoteTokenDecimals is invalid");
  }
  if (!/^[A-Z0-9._-]{1,32}$/.test(input.baseAsset) || !/^[A-Z0-9._-]{1,32}$/.test(input.quoteAsset) ||
      input.baseAsset === input.quoteAsset) throw new Error("Hedge net PnL venue assets are invalid");
  if (!/^0x[0-9a-fA-F]{40}$/.test(input.quoteToken)) throw new Error("Hedge net PnL quoteToken is invalid");
  if (!Array.isArray(input.fills) || input.fills.length === 0) throw new Error("Hedge net PnL fills are required");
  if (typeof input.realizedAt !== "string" || Number.isNaN(Date.parse(input.realizedAt))) {
    throw new Error("Hedge net PnL realizedAt is invalid");
  }
}

function parseDecimalScaled(value: string, decimals: number, field: string): bigint {
  const fraction = parseDecimalFraction(value, field);
  if (fraction.scale > decimals) throw new Error(`Hedge net PnL ${field} has too many fractional digits`);
  return fraction.numerator * 10n ** BigInt(decimals - fraction.scale);
}

function parseDecimalScaledCeil(value: string, decimals: number, field: string): bigint {
  const fraction = parseDecimalFraction(value, field);
  if (fraction.scale <= decimals) return fraction.numerator * 10n ** BigInt(decimals - fraction.scale);
  return divideCeil(fraction.numerator, 10n ** BigInt(fraction.scale - decimals));
}

function parseDecimalFraction(value: string, field: string): { numerator: bigint; denominator: bigint; scale: number } {
  if (typeof value !== "string") throw new Error(`Hedge net PnL ${field} is invalid`);
  const match = value.match(/^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/);
  if (!match || match[1].length > 60 || (match[2]?.length ?? 0) > 36) {
    throw new Error(`Hedge net PnL ${field} is invalid`);
  }
  const fraction = match[2] ?? "";
  const denominator = 10n ** BigInt(fraction.length);
  return {
    numerator: BigInt(match[1]) * denominator + BigInt(fraction || "0"),
    denominator,
    scale: fraction.length,
  };
}

function scaleRawTokenAmount(value: bigint, decimals: number): bigint {
  return value * 10n ** BigInt(SCALE_DECIMALS - decimals);
}

function formatScaled(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  const raw = absolute.toString().padStart(SCALE_DECIMALS + 1, "0");
  const fraction = raw.slice(-SCALE_DECIMALS).replace(/0+$/, "");
  return `${sign}${raw.slice(0, -SCALE_DECIMALS)}${fraction.length === 0 ? "" : `.${fraction}`}`;
}

function isZeroDecimal(value: string): boolean {
  return /^0(?:\.0+)?$/.test(value);
}

function divideFloor(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error("Hedge net PnL denominator must be positive");
  return numerator / denominator;
}

function divideCeil(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error("Hedge net PnL denominator must be positive");
  return (numerator + denominator - 1n) / denominator;
}
