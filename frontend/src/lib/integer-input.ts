const integerInputPattern = /^[0-9]+$/;

export function parseIntegerInput(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== "string" || !integerInputPattern.test(value)) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    return undefined;
  }

  return parsed;
}
