export type CexQuoteQuantity = string & { readonly __brand: "CexQuoteQuantity" };

const maxIntegerDigits = 60;
const quoteQuantityScale = 18;

export function parseCexQuoteQuantity(value: unknown): CexQuoteQuantity | undefined {
  if (typeof value !== "string") throw new Error("HEDGE_EXECUTED_QUOTE_QUANTITY_INVALID");
  const match = value.match(/^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/);
  if (!match || match[1].length > maxIntegerDigits || (match[2]?.length ?? 0) > quoteQuantityScale) {
    throw new Error("HEDGE_EXECUTED_QUOTE_QUANTITY_INVALID");
  }
  const fraction = (match[2] ?? "").replace(/0+$/, "");
  if (match[1] === "0" && fraction.length === 0) return undefined;
  return `${match[1]}${fraction.length === 0 ? "" : `.${fraction}`}` as CexQuoteQuantity;
}

export function compareCexQuoteQuantities(left: CexQuoteQuantity, right: CexQuoteQuantity): number {
  const leftScaled = quoteQuantityToScaledInteger(left);
  const rightScaled = quoteQuantityToScaledInteger(right);
  return leftScaled < rightScaled ? -1 : leftScaled > rightScaled ? 1 : 0;
}

function quoteQuantityToScaledInteger(value: CexQuoteQuantity): bigint {
  const [integer, fraction = ""] = value.split(".");
  return BigInt(integer) * 10n ** BigInt(quoteQuantityScale) +
    BigInt((fraction + "0".repeat(quoteQuantityScale)).slice(0, quoteQuantityScale));
}
