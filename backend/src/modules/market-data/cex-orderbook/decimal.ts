export const cexDecimalScaleDigits = 18;
export const cexDecimalScale = 10n ** BigInt(cexDecimalScaleDigits);

const decimalPattern = /^(0|[1-9][0-9]{0,39})(?:\.([0-9]{1,18}))?$/;

export function parseCexDecimal(value: unknown, field: string, allowZero: boolean): bigint {
  if (typeof value !== "string") {
    throw new Error(`${field} must be a decimal string`);
  }
  const match = decimalPattern.exec(value);
  if (!match) {
    throw new Error(`${field} must use at most 40 integer and 18 fractional digits`);
  }

  const fraction = match[2] ?? "";
  const scaled = BigInt(match[1]) * cexDecimalScale +
    BigInt(`${fraction}${"0".repeat(cexDecimalScaleDigits - fraction.length)}` || "0");
  if (scaled < 0n || (!allowZero && scaled === 0n)) {
    throw new Error(`${field} must be ${allowZero ? "non-negative" : "positive"}`);
  }
  return scaled;
}

export function formatCexDecimal(value: bigint): string {
  if (value < 0n) throw new Error("CEX decimal value must be non-negative");
  const whole = value / cexDecimalScale;
  const fraction = (value % cexDecimalScale).toString().padStart(cexDecimalScaleDigits, "0").replace(/0+$/, "");
  return fraction.length > 0 ? `${whole}.${fraction}` : whole.toString();
}

export function normalizeCexDecimal(value: unknown, field: string, allowZero: boolean): string {
  return formatCexDecimal(parseCexDecimal(value, field, allowZero));
}

export function medianCexDecimal(values: readonly bigint[]): bigint {
  if (values.length === 0) throw new Error("CEX decimal median requires at least one value");
  const sorted = [...values].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[midpoint]
    : (sorted[midpoint - 1] + sorted[midpoint]) / 2n;
}

export function cexDeviationBps(value: bigint, reference: bigint): number {
  if (value <= 0n || reference <= 0n) throw new Error("CEX deviation values must be positive");
  const difference = value >= reference ? value - reference : reference - value;
  const roundedUp = (difference * 10_000n + reference - 1n) / reference;
  return roundedUp > 10_000n ? 10_001 : Number(roundedUp);
}
