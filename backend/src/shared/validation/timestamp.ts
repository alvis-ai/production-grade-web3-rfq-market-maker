const canonicalUtcIsoTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function parseCanonicalUtcIsoTimestamp(value: unknown): number | undefined {
  if (typeof value !== "string" || !canonicalUtcIsoTimestampPattern.test(value)) {
    return undefined;
  }

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  return new Date(parsed).toISOString() === value ? parsed : undefined;
}

export function isCanonicalUtcIsoTimestamp(value: unknown): value is string {
  return parseCanonicalUtcIsoTimestamp(value) !== undefined;
}
