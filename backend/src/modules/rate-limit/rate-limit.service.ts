export type RateLimitedEndpoint = "quote" | "submit" | "status";

export interface RateLimitConfig {
  windowMs: number;
  maxQuoteRequests: number;
  maxSubmitRequests: number;
  maxStatusRequests: number;
}

export interface RateLimitInput {
  endpoint: RateLimitedEndpoint;
  clientId: string;
}

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export interface RateLimiter {
  check(input: RateLimitInput): RateLimitDecision | Promise<RateLimitDecision>;
  checkHealth(): void | Promise<void>;
  close?(): void | Promise<void>;
}

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

export const maxRateLimitClientIdLength = 128;
export const rateLimitClientIdPattern = /^[A-Za-z0-9_.:-]+$/;

export const defaultRateLimitConfig: RateLimitConfig = {
  windowMs: 60_000,
  maxQuoteRequests: 120,
  maxSubmitRequests: 60,
  maxStatusRequests: 300,
};
const rateLimitConfigFields = ["windowMs", "maxQuoteRequests", "maxSubmitRequests", "maxStatusRequests"] as const;
const rateLimitInputFields = ["endpoint", "clientId"] as const;

export class InMemoryRateLimiter implements RateLimiter {
  private readonly config: RateLimitConfig;
  private readonly buckets = new Map<string, RateLimitBucket>();

  constructor(config: RateLimitConfig = defaultRateLimitConfig) {
    assertRateLimitConfig(config);
    this.config = cloneRateLimitConfig(config);
  }

  check(input: RateLimitInput, now = Date.now()): RateLimitDecision {
    const safeInput = normalizeRateLimitInput(input);
    assertRateLimitTimestamp(now);
    this.sweepExpiredBuckets(now);

    const limit = limitForRateLimitEndpoint(this.config, safeInput.endpoint);
    const bucketKey = `${safeInput.endpoint}:${safeInput.clientId}`;
    const bucket = this.buckets.get(bucketKey) ?? { count: 0, resetAt: resetAtFor(now, this.config.windowMs) };

    if (bucket.count >= limit) {
      this.buckets.set(bucketKey, bucket);
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
      };
    }

    bucket.count += 1;
    this.buckets.set(bucketKey, bucket);

    return {
      allowed: true,
      remaining: Math.max(0, limit - bucket.count),
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }

  checkHealth(): void {}

  private sweepExpiredBuckets(now: number): void {
    for (const [bucketKey, bucket] of this.buckets.entries()) {
      if (bucket.resetAt <= now) {
        this.buckets.delete(bucketKey);
      }
    }
  }
}

export function cloneRateLimitConfig(config: RateLimitConfig): RateLimitConfig {
  return { ...config };
}

export function assertRateLimitConfig(config: RateLimitConfig): void {
  if (!isRecord(config)) {
    throw new Error("Rate limit config must be an object");
  }
  assertOwnFields(config, rateLimitConfigFields, "config");
  assertPositiveSafeInteger(config.windowMs, "windowMs");
  assertPositiveSafeInteger(config.maxQuoteRequests, "maxQuoteRequests");
  assertPositiveSafeInteger(config.maxSubmitRequests, "maxSubmitRequests");
  assertPositiveSafeInteger(config.maxStatusRequests, "maxStatusRequests");
}

function assertPositiveSafeInteger(value: number, field: keyof RateLimitConfig): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Rate limit ${field} must be a positive safe integer`);
  }
}

export function normalizeRateLimitInput(input: RateLimitInput): RateLimitInput {
  if (!isRecord(input)) {
    throw new Error("Rate limit input must be an object");
  }
  assertOwnFields(input, rateLimitInputFields, "input");
  if (!isRateLimitedEndpoint(input.endpoint)) {
    throw new Error("Rate limit endpoint must be quote, submit, or status");
  }
  if (typeof input.clientId !== "string") {
    throw new Error("Rate limit clientId must be a primitive string");
  }
  if (input.clientId.trim().length === 0) {
    throw new Error("Rate limit clientId must be a non-empty string");
  }

  const clientId = normalizeRateLimitClientId(input.clientId);
  if (clientId.length > maxRateLimitClientIdLength) {
    throw new Error("Rate limit clientId must be 128 characters or fewer");
  }
  if (!rateLimitClientIdPattern.test(clientId)) {
    throw new Error("Rate limit clientId must contain only letters, numbers, dot, underscore, colon, or hyphen");
  }

  return { endpoint: input.endpoint, clientId };
}

export function limitForRateLimitEndpoint(config: RateLimitConfig, endpoint: RateLimitedEndpoint): number {
  if (endpoint === "quote") {
    return config.maxQuoteRequests;
  }

  return endpoint === "submit" ? config.maxSubmitRequests : config.maxStatusRequests;
}

function normalizeRateLimitClientId(clientId: string): string {
  return clientId.trim().toLowerCase();
}

function isRateLimitedEndpoint(value: unknown): value is RateLimitedEndpoint {
  return value === "quote" || value === "submit" || value === "status";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function assertOwnFields(value: object, fields: readonly string[], path: string): void {
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      throw new Error(`Rate limit ${path}.${field} must be an own field`);
    }
  }
}

function assertRateLimitTimestamp(now: number): void {
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new Error("Rate limit timestamp must be a non-negative safe integer");
  }
}

function resetAtFor(now: number, windowMs: number): number {
  const resetAt = now + windowMs;
  if (!Number.isSafeInteger(resetAt)) {
    throw new Error("Rate limit reset timestamp must be a safe integer");
  }

  return resetAt;
}
