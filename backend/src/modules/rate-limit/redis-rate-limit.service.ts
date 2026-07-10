import { Redis } from "ioredis";
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
if current == 0 or ttl < 1 then
  redis.call("SET", KEYS[1], 1, "PX", ARGV[1])
  return {1, 1, tonumber(ARGV[1])}
end
if current >= tonumber(ARGV[2]) then
  return {0, current, ttl}
end
current = redis.call("INCR", KEYS[1])
return {1, current, ttl}
`;

const defaultKeyPrefix = "rfq:rate-limit:v1";

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
}

export class RedisRateLimiter implements RateLimiter {
  private readonly client: RedisRateLimitClient;
  private readonly config: RateLimitConfig;
  private readonly keyPrefix: string;
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
    this.keyPrefix = normalizeKeyPrefix(options.keyPrefix ?? defaultKeyPrefix);
  }

  async check(input: RateLimitInput): Promise<RateLimitDecision> {
    const safeInput = normalizeRateLimitInput(input);
    const limit = limitForRateLimitEndpoint(this.config, safeInput.endpoint);
    await this.ensureConnected();
    const result = await this.client.eval(
      rateLimitScript,
      1,
      `${this.keyPrefix}:${safeInput.endpoint}:${safeInput.clientId}`,
      this.config.windowMs,
      limit,
    );
    const [allowed, count, ttlMs] = assertScriptResult(result);

    return {
      allowed: allowed === 1,
      remaining: Math.max(0, limit - count),
      retryAfterSeconds: Math.max(1, Math.ceil(ttlMs / 1000)),
    };
  }

  async checkHealth(): Promise<void> {
    await this.ensureConnected();
    const response = await this.client.ping();
    if (response !== "PONG") {
      throw new Error("Redis rate limit health check returned an unexpected response");
    }
  }

  async close(): Promise<void> {
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
}

export function createRedisRateLimitClient(redisUrl: string): RedisRateLimitClient {
  const normalizedUrl = normalizeRedisUrl(redisUrl);
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

export function normalizeRedisUrl(value: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("RFQ_REDIS_URL must be a non-empty redis:// or rediss:// URL");
  }

  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("RFQ_REDIS_URL must be a valid redis:// or rediss:// URL");
  }
  if (!['redis:', 'rediss:'].includes(url.protocol) || !url.hostname || url.hash) {
    throw new Error("RFQ_REDIS_URL must be a valid redis:// or rediss:// URL without a fragment");
  }
  if (url.port && (!/^[0-9]+$/.test(url.port) || Number(url.port) < 1 || Number(url.port) > 65_535)) {
    throw new Error("RFQ_REDIS_URL port must be between 1 and 65535");
  }

  return url.toString();
}

function assertScriptResult(result: unknown): [0 | 1, number, number] {
  if (!Array.isArray(result) || result.length !== 3) {
    throw new Error("Redis rate limit script returned a malformed result");
  }
  const [allowed, count, ttlMs] = result;
  if ((allowed !== 0 && allowed !== 1) || !Number.isSafeInteger(count) || count < 1 ||
      !Number.isSafeInteger(ttlMs) || ttlMs < 1) {
    throw new Error("Redis rate limit script returned invalid values");
  }

  return [allowed, count, ttlMs];
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
    if (key !== "keyPrefix") {
      throw new Error(`Redis rate limiter options must not include unknown field ${key}`);
    }
  }
  if ("keyPrefix" in options && !Object.prototype.hasOwnProperty.call(options, "keyPrefix")) {
    throw new Error("Redis rate limiter options.keyPrefix must be an own field when provided");
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
