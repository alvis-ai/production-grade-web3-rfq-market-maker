import { Redis } from "ioredis";
import { performance } from "node:perf_hooks";
import {
  normalizeRedisUrl as normalizeSharedRedisUrl,
  type RedisUrlPolicy,
} from "../../shared/redis/redis-url.js";
import {
  assertRateLimitConfig,
  cloneRateLimitConfig,
  limitForRateLimitEndpoint,
  normalizeRateLimitInput,
  type RateLimitConfig,
  type RateLimitDecision,
  type RateLimitInput,
  type RateLimiter,
} from "./rate-limit.service.js";

const rateLimitScript = `
local current = tonumber(redis.call("GET", KEYS[1]) or "0")
local ttl = redis.call("PTTL", KEYS[1])
local requested = tonumber(ARGV[3])
local limit = tonumber(ARGV[2])
if current == 0 or ttl < 1 then
  local granted = math.min(requested, limit)
  redis.call("SET", KEYS[1], granted, "PX", ARGV[1])
  return {granted, granted, tonumber(ARGV[1])}
end
if current >= limit then
  return {0, current, ttl}
end
local granted = math.min(requested, limit - current)
current = redis.call("INCRBY", KEYS[1], granted)
return {granted, current, ttl}
`;

const defaultKeyPrefix = "rfq:rate-limit:v1";
const defaultLocalPermitBatchSize = 8;
const defaultMaxLocalBuckets = 10_000;

export interface RedisRateLimitClient {
  readonly status?: string;
  connect?: () => Promise<unknown>;
  disconnect?: () => void;
  eval(script: string, numberOfKeys: number, ...args: Array<string | number>): Promise<unknown>;
  ping(): Promise<unknown>;
  quit(): Promise<unknown>;
}

export interface RedisRateLimiterOptions {
  keyPrefix?: string;
  localPermitBatchSize?: number;
  maxLocalBuckets?: number;
}

interface LocalPermitLease {
  expiresAtMs: number;
  permits: number;
}

interface PermitAllocation {
  count: number;
  granted: number;
  ttlMs: number;
}

export type { RedisUrlPolicy } from "../../shared/redis/redis-url.js";

export class RedisRateLimiter implements RateLimiter {
  private readonly client: RedisRateLimitClient;
  private readonly config: RateLimitConfig;
  private readonly keyPrefix: string;
  private readonly localPermitBatchSize: number;
  private readonly maxLocalBuckets: number;
  private readonly localPermits = new Map<string, LocalPermitLease>();
  private readonly allocations = new Map<string, Promise<PermitAllocation>>();
  private connectPromise: Promise<void> | undefined;

  constructor(
    client: RedisRateLimitClient,
    config: RateLimitConfig,
    options: RedisRateLimiterOptions = {},
  ) {
    assertRedisRateLimitClient(client);
    assertRateLimitConfig(config);
    assertRedisRateLimiterOptions(options);
    this.client = client;
    this.config = cloneRateLimitConfig(config);
    const normalizedOptions = normalizeOptions(options);
    this.keyPrefix = normalizedOptions.keyPrefix;
    this.localPermitBatchSize = normalizedOptions.localPermitBatchSize;
    this.maxLocalBuckets = normalizedOptions.maxLocalBuckets;
  }

  async check(input: RateLimitInput): Promise<RateLimitDecision> {
    const safeInput = normalizeRateLimitInput(input);
    const limit = limitForRateLimitEndpoint(this.config, safeInput.endpoint);
    const key = `${this.keyPrefix}:${safeInput.endpoint}:${safeInput.clientId}`;
    while (true) {
      const local = this.consumeLocalPermit(key);
      if (local) return local;

      let allocation = this.allocations.get(key);
      if (!allocation) {
        allocation = this.allocatePermits(key, limit);
        this.allocations.set(key, allocation);
        void allocation.finally(() => {
          if (this.allocations.get(key) === allocation) this.allocations.delete(key);
        }).catch(() => undefined);
      }
      const allocated = await allocation;
      if (allocated.granted === 0) {
        return {
          allowed: false,
          remaining: 0,
          retryAfterSeconds: Math.max(1, Math.ceil(allocated.ttlMs / 1000)),
        };
      }
    }
  }

  async checkHealth(): Promise<void> {
    await this.ensureConnected();
    const response = await this.client.ping();
    if (response !== "PONG") {
      throw new Error("Redis rate limit health check returned an unexpected response");
    }
  }

  async close(): Promise<void> {
    this.localPermits.clear();
    this.allocations.clear();
    if (this.client.status === "wait" || this.client.status === "end") {
      this.client.disconnect?.();
      return;
    }

    try {
      await this.client.quit();
    } catch {
      this.client.disconnect?.();
    }
  }

  private async ensureConnected(): Promise<void> {
    if (!this.client.connect || this.client.status === undefined || this.client.status === "ready") {
      return;
    }
    if (this.connectPromise) {
      await this.connectPromise;
      return;
    }
    if (this.client.status !== "wait" && this.client.status !== "end") {
      return;
    }

    this.connectPromise = this.client.connect().then(() => undefined).finally(() => {
      this.connectPromise = undefined;
    });
    await this.connectPromise;
  }

  private consumeLocalPermit(key: string): RateLimitDecision | undefined {
    const lease = this.localPermits.get(key);
    if (!lease) return undefined;
    const now = performance.now();
    if (lease.permits < 1 || lease.expiresAtMs <= now) {
      this.localPermits.delete(key);
      return undefined;
    }
    lease.permits -= 1;
    const decision = {
      allowed: true,
      remaining: lease.permits,
      retryAfterSeconds: Math.max(1, Math.ceil((lease.expiresAtMs - now) / 1_000)),
    } as const;
    if (lease.permits === 0) this.localPermits.delete(key);
    return decision;
  }

  private async allocatePermits(key: string, limit: number): Promise<PermitAllocation> {
    await this.ensureConnected();
    const requested = Math.min(limit, this.localPermitBatchSize);
    const requestedAtMs = performance.now();
    const result = await this.client.eval(
      rateLimitScript,
      1,
      key,
      this.config.windowMs,
      limit,
      requested,
    );
    const [granted, count, ttlMs] = assertScriptResult(result);
    if (granted > requested || count > limit) {
      throw new Error("Redis rate limit script exceeded the configured permit bounds");
    }
    if (granted > 0) {
      this.storeLocalPermits(key, {
        expiresAtMs: requestedAtMs + ttlMs,
        permits: granted,
      });
    }
    return { count, granted, ttlMs };
  }

  private storeLocalPermits(key: string, lease: LocalPermitLease): void {
    if (!this.localPermits.has(key) && this.localPermits.size >= this.maxLocalBuckets) {
      const oldest = this.localPermits.keys().next().value as string | undefined;
      if (oldest !== undefined) this.localPermits.delete(oldest);
    }
    this.localPermits.set(key, lease);
  }
}

export function createRedisRateLimitClient(
  redisUrl: string,
  policy: RedisUrlPolicy = {},
): RedisRateLimitClient {
  const normalizedUrl = normalizeRedisUrl(redisUrl, policy);
  return new Redis(normalizedUrl, {
    connectTimeout: 2_000,
    enableOfflineQueue: false,
    enableReadyCheck: true,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy(attempt: number) {
      return attempt <= 3 ? Math.min(100 * 2 ** (attempt - 1), 1_000) : null;
    },
  }) as unknown as RedisRateLimitClient;
}

export function normalizeRedisUrl(value: string, policy: RedisUrlPolicy = {}): string {
  try {
    return normalizeSharedRedisUrl(value, policy);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Redis URL is invalid";
    throw new Error(message.startsWith("Redis URL policy")
      ? message
      : message.replace(/^Redis URL/, "RFQ_REDIS_URL"));
  }
}

function assertScriptResult(result: unknown): [number, number, number] {
  if (!Array.isArray(result) || result.length !== 3) {
    throw new Error("Redis rate limit script returned a malformed result");
  }
  const [granted, count, ttlMs] = result;
  if (!Number.isSafeInteger(granted) || granted < 0 || !Number.isSafeInteger(count) || count < 1 ||
      !Number.isSafeInteger(ttlMs) || ttlMs < 1) {
    throw new Error("Redis rate limit script returned invalid values");
  }

  return [granted, count, ttlMs];
}

function assertRedisRateLimitClient(client: unknown): asserts client is RedisRateLimitClient {
  if (typeof client !== "object" || client === null || Array.isArray(client)) {
    throw new Error("Redis rate limit client must be an object");
  }
  for (const method of ["eval", "ping", "quit"] as const) {
    if (typeof (client as Record<string, unknown>)[method] !== "function") {
      throw new Error(`Redis rate limit client.${method} must be a function`);
    }
  }
}

function assertRedisRateLimiterOptions(options: unknown): asserts options is RedisRateLimiterOptions {
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    throw new Error("Redis rate limiter options must be an object");
  }
  for (const key of Object.keys(options)) {
    if (key !== "keyPrefix" && key !== "localPermitBatchSize" && key !== "maxLocalBuckets") {
      throw new Error(`Redis rate limiter options must not include unknown field ${key}`);
    }
  }
  for (const field of ["keyPrefix", "localPermitBatchSize", "maxLocalBuckets"] as const) {
    if (field in options && !Object.prototype.hasOwnProperty.call(options, field)) {
      throw new Error(`Redis rate limiter options.${field} must be an own field when provided`);
    }
  }
}

function normalizeOptions(options: RedisRateLimiterOptions): Required<RedisRateLimiterOptions> {
  assertRedisRateLimiterOptions(options);
  const localPermitBatchSize = options.localPermitBatchSize ?? defaultLocalPermitBatchSize;
  const maxLocalBuckets = options.maxLocalBuckets ?? defaultMaxLocalBuckets;
  assertBoundedOption(localPermitBatchSize, "localPermitBatchSize", 1, 1_024);
  assertBoundedOption(maxLocalBuckets, "maxLocalBuckets", 1, 1_000_000);
  return {
    keyPrefix: normalizeKeyPrefix(options.keyPrefix ?? defaultKeyPrefix),
    localPermitBatchSize,
    maxLocalBuckets,
  };
}

function assertBoundedOption(value: number, name: string, min: number, max: number): void {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`Redis rate limiter ${name} must be between ${min} and ${max}`);
  }
}

function normalizeKeyPrefix(value: string): string {
  if (typeof value !== "string") {
    throw new Error("Redis rate limiter keyPrefix must be a primitive string");
  }
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9:_-]{1,64}$/.test(normalized)) {
    throw new Error("Redis rate limiter keyPrefix must contain 1-64 lowercase letters, numbers, colon, underscore, or hyphen");
  }
  return normalized;
}
