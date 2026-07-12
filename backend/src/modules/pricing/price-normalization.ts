import type { TokenMetadata } from "./token-registry.js";

export interface NormalizedHumanPrice {
  numerator: bigint;
  denominator: bigint;
}

export interface RationalUsdNotional {
  numerator: bigint;
  denominator: bigint;
}

const maxPriceLength = 96;
const maxFractionDigits = 18;

export function normalizeHumanPrice(value: string): NormalizedHumanPrice {
  if (
    typeof value !== "string" ||
    value.length > maxPriceLength ||
    !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value)
  ) {
    throw new Error("Normalized price must be a canonical decimal string with at most 96 characters");
  }

  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > maxFractionDigits) {
    throw new Error(`Normalized price must use at most ${maxFractionDigits} fractional digits`);
  }
  const denominator = 10n ** BigInt(fraction.length);
  const numerator = BigInt(whole) * denominator + BigInt(fraction || "0");
  if (numerator <= 0n) throw new Error("Normalized price must be positive");
  return { numerator, denominator };
}

export function convertBaseUnitAmount(
  amountIn: bigint,
  price: NormalizedHumanPrice,
  tokenInDecimals: number,
  tokenOutDecimals: number,
): bigint {
  assertPositiveAmount(amountIn);
  assertNormalizedPrice(price);
  assertTokenDecimals(tokenInDecimals, "tokenInDecimals");
  assertTokenDecimals(tokenOutDecimals, "tokenOutDecimals");

  const numerator = amountIn * price.numerator * pow10(tokenOutDecimals);
  const denominator = price.denominator * pow10(tokenInDecimals);
  return numerator / denominator;
}

export function calculateUsdNotional(
  amountIn: bigint,
  price: NormalizedHumanPrice,
  tokenIn: TokenMetadata,
  tokenOut: TokenMetadata,
): RationalUsdNotional {
  assertPositiveAmount(amountIn);
  assertNormalizedPrice(price);

  if (tokenIn.usdReference) {
    return {
      numerator: amountIn,
      denominator: pow10(tokenIn.decimals),
    };
  }
  if (tokenOut.usdReference) {
    return {
      numerator: amountIn * price.numerator,
      denominator: pow10(tokenIn.decimals) * price.denominator,
    };
  }
  throw new Error("Price normalization requires tokenIn or tokenOut to be an approved USD reference token");
}

function assertPositiveAmount(value: bigint): void {
  if (typeof value !== "bigint" || value <= 0n) throw new Error("Price normalization amountIn must be positive");
}

function assertNormalizedPrice(value: NormalizedHumanPrice): void {
  if (
    typeof value !== "object" ||
    value === null ||
    typeof value.numerator !== "bigint" ||
    typeof value.denominator !== "bigint" ||
    value.numerator <= 0n ||
    value.denominator <= 0n
  ) {
    throw new Error("Price normalization price ratio must be positive");
  }
}

function assertTokenDecimals(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 36) {
    throw new Error(`Price normalization ${label} must be an integer between 0 and 36`);
  }
}

function pow10(decimals: number): bigint {
  assertTokenDecimals(decimals, "decimals");
  return 10n ** BigInt(decimals);
}
