import type { PricingEngine, PricingInput, PricingResult } from "./pricing.engine.js";

export interface PricingCacheConfig {
  ttlMs: number;
  maxEntries: number;
}

export interface PricingCacheObserver {
  recordPricingCacheHit(): void;
  recordPricingCacheMiss(): void;
}

export const defaultPricingCacheConfig: PricingCacheConfig = {
  ttlMs: 100,
  maxEntries: 10_000,
};

interface PricingCacheEntry {
  expiresAtMs: number;
  result: PricingResult;
}

export class CachedPricingEngine implements PricingEngine {
  private readonly cache = new Map<string, PricingCacheEntry>();
  private readonly inFlight = new Map<string, Promise<PricingResult>>();
  private readonly config: PricingCacheConfig;

  constructor(
    private readonly inner: PricingEngine,
    config: PricingCacheConfig = defaultPricingCacheConfig,
    private readonly observer?: PricingCacheObserver,
    private readonly nowMs: () => number = Date.now,
  ) {
    assertPricingEngine(inner);
    this.config = normalizePricingCacheConfig(config);
    assertPricingCacheObserver(observer);
    if (typeof nowMs !== "function") throw new Error("Pricing cache nowMs must be a function");
  }

  async price(input: PricingInput): Promise<PricingResult> {
    const key = pricingCacheKey(input);
    if (key === undefined) return this.inner.price(input);

    const nowMs = this.readNowMs();
    const cached = this.cache.get(key);
    if (cached && cached.expiresAtMs > nowMs) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      this.recordHit();
      return clonePricingResult(cached.result);
    }
    if (cached) this.cache.delete(key);

    const pending = this.inFlight.get(key);
    if (pending) {
      this.recordHit();
      return clonePricingResult(await pending);
    }

    this.recordMiss();
    const calculation = this.calculateAndCache(key, input);
    this.inFlight.set(key, calculation);
    try {
      return clonePricingResult(await calculation);
    } finally {
      this.inFlight.delete(key);
    }
  }

  private async calculateAndCache(key: string, input: PricingInput): Promise<PricingResult> {
    const result = clonePricingResult(await this.inner.price(input));
    this.cache.set(key, {
      expiresAtMs: this.readNowMs() + this.config.ttlMs,
      result,
    });
    while (this.cache.size > this.config.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (typeof oldestKey !== "string") break;
      this.cache.delete(oldestKey);
    }
    return result;
  }

  private readNowMs(): number {
    const value = this.nowMs();
    if (!Number.isFinite(value)) throw new Error("Pricing cache clock must return a finite number");
    return value;
  }

  private recordHit(): void {
    try {
      this.observer?.recordPricingCacheHit();
    } catch {}
  }

  private recordMiss(): void {
    try {
      this.observer?.recordPricingCacheMiss();
    } catch {}
  }
}

function pricingCacheKey(input: PricingInput): string | undefined {
  try {
    const values: unknown[] = [
      input.request.chainId,
      input.request.user,
      input.request.tokenIn,
      input.request.tokenOut,
      input.request.amountIn,
      input.request.slippageBps,
      input.snapshot.snapshotId,
      input.snapshot.midPrice,
      input.snapshot.liquidityUsd,
      input.snapshot.marketSpreadBps,
      input.snapshot.volatilityBps,
      input.routePlan.routeId,
      input.routePlan.venue,
      input.routePlan.tokenIn,
      input.routePlan.tokenOut,
      input.routePlan.expectedLiquidityUsd,
      input.inventorySkewBps,
      input.hedgeCostBps,
    ];
    if (values.some((value) => typeof value !== "string" && typeof value !== "number")) return undefined;
    return JSON.stringify(values);
  } catch {
    return undefined;
  }
}

function normalizePricingCacheConfig(config: PricingCacheConfig): PricingCacheConfig {
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    throw new Error("Pricing cache config must be an object");
  }
  const fields = ["ttlMs", "maxEntries"] as const;
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(config, field)) {
      throw new Error(`Pricing cache config.${field} must be an own field`);
    }
  }
  const unknownField = Object.keys(config).find((field) => !fields.includes(field as typeof fields[number]));
  if (unknownField) throw new Error(`Pricing cache config contains unknown field ${unknownField}`);
  assertPositiveSafeInteger(config.ttlMs, "ttlMs");
  assertPositiveSafeInteger(config.maxEntries, "maxEntries");
  return { ...config };
}

function assertPricingEngine(value: unknown): asserts value is PricingEngine {
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
      typeof (value as Record<string, unknown>).price !== "function") {
    throw new Error("Pricing cache inner.price must be a function");
  }
}

function assertPricingCacheObserver(value: PricingCacheObserver | undefined): void {
  if (value === undefined) return;
  const candidate = value as unknown as Record<string, unknown>;
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
      typeof candidate.recordPricingCacheHit !== "function" ||
      typeof candidate.recordPricingCacheMiss !== "function") {
    throw new Error("Pricing cache observer must expose hit and miss methods");
  }
}

function assertPositiveSafeInteger(value: number, field: keyof PricingCacheConfig): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Pricing cache config.${field} must be a positive safe integer`);
  }
}

function clonePricingResult(result: PricingResult): PricingResult {
  return { ...result };
}
