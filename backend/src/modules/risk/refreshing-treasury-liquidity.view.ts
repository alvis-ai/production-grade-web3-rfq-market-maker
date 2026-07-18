import type { Address } from "../../shared/types/rfq.js";
import {
  assertTreasuryLiquidityRequest,
  assertTreasuryLiquiditySnapshot,
  type TreasuryLiquidityProvider,
  type TreasuryLiquidityRequest,
  type TreasuryLiquiditySnapshot,
} from "./treasury-liquidity.provider.js";

export interface RefreshingTreasuryLiquidityViewConfig {
  targets: readonly TreasuryLiquidityRequest[];
  refreshIntervalMs: number;
  maxAgeMs: number;
}

export interface RefreshingTreasuryLiquidityLogger {
  warn(fields: Readonly<Record<string, unknown>>, message: string): void;
}

interface TreasurySnapshotGeneration {
  generation: number;
  refreshedAtMs: number;
  entries: ReadonlyMap<string, TreasuryLiquiditySnapshot>;
}

const noopLogger: RefreshingTreasuryLiquidityLogger = { warn() {} };

export class RefreshingTreasuryLiquidityView implements TreasuryLiquidityProvider {
  private readonly config: RefreshingTreasuryLiquidityViewConfig;
  private readonly logger: RefreshingTreasuryLiquidityLogger;
  private snapshot: TreasurySnapshotGeneration | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private startPromise: Promise<void> | undefined;
  private refreshPromise: Promise<void> | undefined;
  private desiredRunning = false;
  private refreshFailureLogged = false;
  private generation = 0;

  constructor(
    private readonly source: TreasuryLiquidityProvider,
    config: RefreshingTreasuryLiquidityViewConfig,
    logger: RefreshingTreasuryLiquidityLogger = noopLogger,
    private readonly nowMilliseconds: () => number = () => Date.now(),
  ) {
    assertProvider(source);
    this.config = normalizeConfig(config);
    assertLogger(logger);
    this.logger = logger;
    if (typeof nowMilliseconds !== "function") {
      throw new Error("Refreshing treasury liquidity nowMilliseconds must be a function");
    }
  }

  async start(): Promise<void> {
    this.desiredRunning = true;
    if (this.timer) return;
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.startOnce().finally(() => {
      this.startPromise = undefined;
    });
    return this.startPromise;
  }

  stop(): void {
    this.desiredRunning = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private async startOnce(): Promise<void> {
    await this.refresh();
    if (!this.desiredRunning || this.timer) return;
    this.timer = setInterval(() => {
      void this.refresh().catch(() => {
        if (this.refreshFailureLogged) return;
        this.refreshFailureLogged = true;
        this.logger.warn(
          { code: "TREASURY_LIQUIDITY_HOT_STATE_REFRESH_FAILED" },
          "treasury liquidity hot-state refresh failed",
        );
      });
    }, this.config.refreshIntervalMs);
    this.timer.unref?.();
  }

  async refresh(): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.loadSnapshot()
      .then(() => {
        this.refreshFailureLogged = false;
      })
      .finally(() => {
        this.refreshPromise = undefined;
      });
    return this.refreshPromise;
  }

  async checkHealth(): Promise<void> {
    this.requireFreshSnapshot();
  }

  async getLiquidity(request: TreasuryLiquidityRequest): Promise<TreasuryLiquiditySnapshot> {
    assertTreasuryLiquidityRequest(request);
    const entry = this.requireFreshSnapshot().entries.get(targetKey(request.chainId, request.token));
    if (!entry) {
      throw new Error("Treasury liquidity hot state is not configured for the requested chain/token");
    }
    return cloneSnapshot(entry);
  }

  snapshotGeneration(): number {
    return this.requireFreshSnapshot().generation;
  }

  private async loadSnapshot(): Promise<void> {
    const loaded = await Promise.all(this.config.targets.map(async (target) => {
      const snapshot = await this.source.getLiquidity(target);
      assertTreasuryLiquiditySnapshot(snapshot, target);
      return cloneSnapshot(snapshot);
    }));
    const entries = new Map<string, TreasuryLiquiditySnapshot>();
    for (const snapshot of loaded) {
      const key = targetKey(snapshot.chainId, snapshot.token);
      if (entries.has(key)) throw new Error(`Treasury liquidity refresh returned duplicate target ${key}`);
      entries.set(key, snapshot);
    }
    const refreshedAtMs = readNow(this.nowMilliseconds);
    this.generation += 1;
    this.snapshot = { generation: this.generation, refreshedAtMs, entries };
  }

  private requireFreshSnapshot(): TreasurySnapshotGeneration {
    const snapshot = this.snapshot;
    if (!snapshot) throw new Error("Treasury liquidity hot state is not initialized");
    const ageMs = readNow(this.nowMilliseconds) - snapshot.refreshedAtMs;
    if (ageMs < 0 || ageMs > this.config.maxAgeMs) {
      throw new Error("Treasury liquidity hot state is stale");
    }
    if (snapshot.entries.size !== this.config.targets.length) {
      throw new Error("Treasury liquidity hot state target coverage is incomplete");
    }
    return snapshot;
  }
}

function normalizeConfig(
  config: RefreshingTreasuryLiquidityViewConfig,
): RefreshingTreasuryLiquidityViewConfig {
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    throw new Error("Refreshing treasury liquidity config must be an object");
  }
  const fields = ["targets", "refreshIntervalMs", "maxAgeMs"];
  if (Object.keys(config).some((field) => !fields.includes(field)) ||
      fields.some((field) => !Object.prototype.hasOwnProperty.call(config, field))) {
    throw new Error("Refreshing treasury liquidity config fields are invalid");
  }
  if (!Array.isArray(config.targets) || config.targets.length === 0 || config.targets.length > 10_000) {
    throw new Error("Refreshing treasury liquidity targets must contain between 1 and 10000 entries");
  }
  const targets = config.targets.map((target) => {
    assertTreasuryLiquidityRequest(target);
    return { chainId: target.chainId, token: target.token.toLowerCase() as Address };
  });
  const keys = targets.map((target) => targetKey(target.chainId, target.token));
  if (new Set(keys).size !== keys.length) {
    throw new Error("Refreshing treasury liquidity targets must be unique");
  }
  assertInteger(config.refreshIntervalMs, 10, 60_000, "refreshIntervalMs");
  assertInteger(config.maxAgeMs, 20, 300_000, "maxAgeMs");
  if (config.maxAgeMs < config.refreshIntervalMs * 2) {
    throw new Error("Refreshing treasury liquidity maxAgeMs must cover at least two refresh intervals");
  }
  return {
    targets: targets.sort((left, right) => targetKey(left.chainId, left.token).localeCompare(
      targetKey(right.chainId, right.token),
    )),
    refreshIntervalMs: config.refreshIntervalMs,
    maxAgeMs: config.maxAgeMs,
  };
}

function assertProvider(value: unknown): asserts value is TreasuryLiquidityProvider {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Refreshing treasury liquidity source must be an object");
  }
  for (const method of ["checkHealth", "getLiquidity"] as const) {
    if (typeof (value as Record<string, unknown>)[method] !== "function") {
      throw new Error(`Refreshing treasury liquidity source.${method} must be a function`);
    }
  }
}

function assertLogger(value: unknown): asserts value is RefreshingTreasuryLiquidityLogger {
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
      typeof (value as Record<string, unknown>).warn !== "function") {
    throw new Error("Refreshing treasury liquidity logger.warn must be a function");
  }
}

function targetKey(chainId: number, token: Address): string {
  return `${chainId}:${token.toLowerCase()}`;
}

function cloneSnapshot(snapshot: TreasuryLiquiditySnapshot): TreasuryLiquiditySnapshot {
  return {
    ...snapshot,
    settlementAddress: snapshot.settlementAddress.toLowerCase() as Address,
    treasuryAddress: snapshot.treasuryAddress.toLowerCase() as Address,
    token: snapshot.token.toLowerCase() as Address,
  };
}

function readNow(provider: () => number): number {
  const value = provider();
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("Refreshing treasury liquidity current time must be a positive safe integer");
  }
  return value;
}

function assertInteger(value: unknown, min: number, max: number, field: string): void {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`Refreshing treasury liquidity ${field} must be between ${min} and ${max}`);
  }
}
