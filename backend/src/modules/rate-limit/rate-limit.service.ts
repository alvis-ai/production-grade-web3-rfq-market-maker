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

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

export const defaultRateLimitConfig: RateLimitConfig = {
  windowMs: 60_000,
  maxQuoteRequests: 120,
  maxSubmitRequests: 60,
  maxStatusRequests: 300,
};

export class InMemoryRateLimiter {
  private readonly config: RateLimitConfig;
  private readonly buckets = new Map<string, RateLimitBucket>();

  constructor(config: RateLimitConfig = defaultRateLimitConfig) {
    assertPositiveSafeInteger(config.windowMs, "windowMs");
    assertPositiveSafeInteger(config.maxQuoteRequests, "maxQuoteRequests");
    assertPositiveSafeInteger(config.maxSubmitRequests, "maxSubmitRequests");
    assertPositiveSafeInteger(config.maxStatusRequests, "maxStatusRequests");

    this.config = cloneRateLimitConfig(config);
  }

  check(input: RateLimitInput, now = Date.now()): RateLimitDecision {
    assertRateLimitInput(input);
    const limit = this.limitFor(input.endpoint);
    const bucketKey = `${input.endpoint}:${input.clientId}`;
    const current = this.buckets.get(bucketKey);
    const bucket = current && current.resetAt > now ? current : { count: 0, resetAt: now + this.config.windowMs };

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

  private limitFor(endpoint: RateLimitedEndpoint): number {
    if (endpoint === "quote") {
      return this.config.maxQuoteRequests;
    }

    return endpoint === "submit" ? this.config.maxSubmitRequests : this.config.maxStatusRequests;
  }
}

function cloneRateLimitConfig(config: RateLimitConfig): RateLimitConfig {
  return { ...config };
}

function assertPositiveSafeInteger(value: number, field: keyof RateLimitConfig): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Rate limit ${field} must be a positive safe integer`);
  }
}

function assertRateLimitInput(input: RateLimitInput): void {
  if (!["quote", "submit", "status"].includes(input.endpoint)) {
    throw new Error("Rate limit endpoint must be quote, submit, or status");
  }
  if (typeof input.clientId !== "string" || input.clientId.trim().length === 0) {
    throw new Error("Rate limit clientId must be a non-empty string");
  }
}
