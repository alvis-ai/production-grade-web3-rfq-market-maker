export interface RedisUrlPolicy {
  requireTls?: boolean;
}

export function normalizeRedisUrl(value: string, policy: RedisUrlPolicy = {}): string {
  assertRedisUrlPolicy(policy);
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("Redis URL must be a non-empty redis:// or rediss:// URL");
  }

  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Redis URL must be a valid redis:// or rediss:// URL");
  }
  if (!["redis:", "rediss:"].includes(url.protocol) || !url.hostname || url.hash) {
    throw new Error("Redis URL must be a valid redis:// or rediss:// URL without a fragment");
  }
  if (url.port && (!/^[0-9]+$/.test(url.port) || Number(url.port) < 1 || Number(url.port) > 65_535)) {
    throw new Error("Redis URL port must be between 1 and 65535");
  }
  if (policy.requireTls === true && url.protocol !== "rediss:") {
    throw new Error("Redis URL must use rediss:// outside local environments");
  }

  return url.toString();
}

function assertRedisUrlPolicy(value: unknown): asserts value is RedisUrlPolicy {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Redis URL policy must be an object");
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== "requireTls") ||
      (record.requireTls !== undefined && typeof record.requireTls !== "boolean")) {
    throw new Error("Redis URL policy requireTls must be a boolean when provided");
  }
}
