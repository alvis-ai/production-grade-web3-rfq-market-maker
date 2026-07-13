import type { CexTradeFill } from "./binance-spot.adapter.js";

export function assertCexTradeFill(fill: CexTradeFill): void {
  if (typeof fill !== "object" || fill === null || Array.isArray(fill)) {
    throw new Error("HEDGE_TRADE_FILL_INVALID");
  }
  const fields = [
    "venueTradeId", "venueOrderId", "price", "quantity", "quoteQuantity",
    "commissionQuantity", "commissionAsset", "executedAt", "isBuyer", "isMaker",
  ];
  if (Object.keys(fill).length !== fields.length ||
      fields.some((field) => !Object.prototype.hasOwnProperty.call(fill, field)) ||
      !isSafeVenueId(fill.venueTradeId) || !isSafeVenueId(fill.venueOrderId) ||
      !isDecimal(fill.price, 18, false) || !isDecimal(fill.quantity, 36, false) ||
      !isDecimal(fill.quoteQuantity, 18, false) || !isDecimal(fill.commissionQuantity, 36, true) ||
      typeof fill.commissionAsset !== "string" || fill.commissionAsset.length < 1 ||
      fill.commissionAsset.length > 64 || /[\s\p{Cc}]/u.test(fill.commissionAsset) ||
      typeof fill.executedAt !== "string" || !isCanonicalTimestamp(fill.executedAt) ||
      typeof fill.isBuyer !== "boolean" || typeof fill.isMaker !== "boolean") {
    throw new Error("HEDGE_TRADE_FILL_INVALID");
  }
}

export function sumCexTradeQuantity(
  fills: readonly CexTradeFill[],
  field: "quantity" | "quoteQuantity",
): string {
  if (!Array.isArray(fills) || fills.length === 0) throw new Error("HEDGE_TRADE_FILLS_INCOMPLETE");
  const scale = field === "quantity" ? 36 : 18;
  let total = 0n;
  for (const fill of fills) {
    assertCexTradeFill(fill);
    total += decimalToScaledInteger(fill[field], scale);
  }
  return formatScaledInteger(total, scale);
}

export function decimalQuantitiesEqual(left: string, right: string, scale: 18 | 36): boolean {
  try {
    return decimalToScaledInteger(left, scale) === decimalToScaledInteger(right, scale);
  } catch {
    return false;
  }
}

function decimalToScaledInteger(value: string, scale: number): bigint {
  if (!isDecimal(value, scale, true)) throw new Error("HEDGE_TRADE_DECIMAL_INVALID");
  const [integer, fraction = ""] = value.split(".");
  return BigInt(integer) * 10n ** BigInt(scale) +
    BigInt((fraction + "0".repeat(scale)).slice(0, scale));
}

function formatScaledInteger(value: bigint, scale: number): string {
  const raw = value.toString().padStart(scale + 1, "0");
  const integer = raw.slice(0, -scale);
  const fraction = raw.slice(-scale).replace(/0+$/, "");
  return fraction.length === 0 ? integer : `${integer}.${fraction}`;
}

function isDecimal(value: unknown, maxFractionDigits: number, allowZero: boolean): value is string {
  if (typeof value !== "string") return false;
  const match = value.match(/^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/);
  if (!match || match[1].length > 78 - maxFractionDigits ||
      (match[2]?.length ?? 0) > maxFractionDigits) return false;
  return allowZero || !/^0(?:\.0+)?$/.test(value);
}

function isSafeVenueId(value: unknown): value is string {
  return typeof value === "string" && /^[1-9][0-9]{0,15}$/.test(value) &&
    Number.isSafeInteger(Number(value));
}

function isCanonicalTimestamp(value: string): boolean {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}
