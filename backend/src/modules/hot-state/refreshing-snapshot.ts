export interface RefreshingSnapshotConfig {
  label: string;
  metricName: RefreshingSnapshotMetricName;
  failureCode: string;
  refreshIntervalMs: number;
  maxAgeMs: number;
}

export const refreshingSnapshotMetricNames = [
  "quote_control",
  "toxic_flow",
  "daily_loss",
  "hedge_risk",
  "usd_reference",
  "settlement_indexer",
] as const;
export const refreshingSnapshotRefreshOutcomes = ["success", "failure"] as const;
export type RefreshingSnapshotMetricName = typeof refreshingSnapshotMetricNames[number];
export type RefreshingSnapshotRefreshOutcome = typeof refreshingSnapshotRefreshOutcomes[number];

export interface RefreshingSnapshotObserver {
  recordHotStateRefresh(
    name: RefreshingSnapshotMetricName,
    outcome: RefreshingSnapshotRefreshOutcome,
    refreshedAtMs?: number,
  ): void;
}

export interface RefreshingSnapshotLogger {
  warn(fields: Readonly<Record<string, unknown>>, message: string): void;
}

interface SnapshotGeneration<T> {
  generation: number;
  refreshedAtMs: number;
  value: T;
}

const noopLogger: RefreshingSnapshotLogger = { warn() {} };
const noopObserver: RefreshingSnapshotObserver = { recordHotStateRefresh() {} };

export class RefreshingSnapshot<T> {
  private readonly config: RefreshingSnapshotConfig;
  private readonly logger: RefreshingSnapshotLogger;
  private snapshot: SnapshotGeneration<T> | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private startPromise: Promise<void> | undefined;
  private refreshPromise: Promise<void> | undefined;
  private desiredRunning = false;
  private refreshFailureLogged = false;
  private generation = 0;

  constructor(
    private readonly loader: () => Promise<T>,
    config: RefreshingSnapshotConfig,
    logger: RefreshingSnapshotLogger = noopLogger,
    private readonly nowMilliseconds: () => number = () => Date.now(),
    private readonly merge: (loaded: T, current: T | undefined) => T = (loaded) => loaded,
    private readonly observer: RefreshingSnapshotObserver = noopObserver,
  ) {
    if (typeof loader !== "function") throw new Error("Refreshing snapshot loader must be a function");
    this.config = normalizeConfig(config);
    assertLogger(logger);
    this.logger = logger;
    if (typeof nowMilliseconds !== "function") {
      throw new Error("Refreshing snapshot nowMilliseconds must be a function");
    }
    if (typeof merge !== "function") throw new Error("Refreshing snapshot merge must be a function");
    assertObserver(observer);
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

  async refresh(): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.loadAndPublish()
      .then(() => {
        this.refreshFailureLogged = false;
        this.recordRefresh("success", this.snapshot?.refreshedAtMs);
      })
      .catch((error: unknown) => {
        this.recordRefresh("failure");
        throw error;
      })
      .finally(() => {
        this.refreshPromise = undefined;
      });
    return this.refreshPromise;
  }

  read(): T {
    const snapshot = this.requireFreshSnapshot();
    return snapshot.value;
  }

  checkHealth(): void {
    this.requireFreshSnapshot();
  }

  generationNumber(): number {
    return this.requireFreshSnapshot().generation;
  }

  updateCurrent(update: (current: T) => T): void {
    if (typeof update !== "function") throw new Error("Refreshing snapshot update must be a function");
    const current = this.requireFreshSnapshot();
    this.generation += 1;
    this.snapshot = {
      generation: this.generation,
      refreshedAtMs: current.refreshedAtMs,
      value: update(current.value),
    };
  }

  private async startOnce(): Promise<void> {
    await this.refresh();
    if (!this.desiredRunning || this.timer) return;
    this.timer = setInterval(() => {
      void this.refresh().catch(() => {
        if (this.refreshFailureLogged) return;
        this.refreshFailureLogged = true;
        this.logger.warn(
          { code: this.config.failureCode },
          `${this.config.label} hot-state refresh failed`,
        );
      });
    }, this.config.refreshIntervalMs);
    this.timer.unref?.();
  }

  private async loadAndPublish(): Promise<void> {
    const loaded = await this.loader();
    const value = this.merge(loaded, this.snapshot?.value);
    const refreshedAtMs = readNow(this.nowMilliseconds);
    this.generation += 1;
    this.snapshot = { generation: this.generation, refreshedAtMs, value };
  }

  private requireFreshSnapshot(): SnapshotGeneration<T> {
    const snapshot = this.snapshot;
    if (!snapshot) throw new Error(`${this.config.label} hot state is not initialized`);
    const ageMs = readNow(this.nowMilliseconds) - snapshot.refreshedAtMs;
    if (ageMs < 0 || ageMs > this.config.maxAgeMs) {
      throw new Error(`${this.config.label} hot state is stale`);
    }
    return snapshot;
  }

  private recordRefresh(outcome: RefreshingSnapshotRefreshOutcome, refreshedAtMs?: number): void {
    try {
      this.observer.recordHotStateRefresh(this.config.metricName, outcome, refreshedAtMs);
    } catch {}
  }
}

function normalizeConfig(config: RefreshingSnapshotConfig): RefreshingSnapshotConfig {
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    throw new Error("Refreshing snapshot config must be an object");
  }
  const fields = ["label", "metricName", "failureCode", "refreshIntervalMs", "maxAgeMs"];
  if (Object.keys(config).length !== fields.length ||
      Object.keys(config).some((field) => !fields.includes(field)) ||
      fields.some((field) => !Object.prototype.hasOwnProperty.call(config, field))) {
    throw new Error("Refreshing snapshot config fields are invalid");
  }
  if (typeof config.label !== "string" || !/^[a-z][a-z0-9 -]{2,63}$/.test(config.label)) {
    throw new Error("Refreshing snapshot label must be a bounded lower-case label");
  }
  if (!refreshingSnapshotMetricNames.includes(config.metricName)) {
    throw new Error("Refreshing snapshot metricName is invalid");
  }
  if (typeof config.failureCode !== "string" || !/^[A-Z][A-Z0-9_]{2,95}$/.test(config.failureCode)) {
    throw new Error("Refreshing snapshot failureCode must be a bounded code");
  }
  assertInteger(config.refreshIntervalMs, 10, 60_000, "refreshIntervalMs");
  assertInteger(config.maxAgeMs, 20, 300_000, "maxAgeMs");
  if (config.maxAgeMs < config.refreshIntervalMs * 2) {
    throw new Error("Refreshing snapshot maxAgeMs must cover at least two refresh intervals");
  }
  return { ...config };
}

function assertLogger(value: unknown): asserts value is RefreshingSnapshotLogger {
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
      typeof (value as Record<string, unknown>).warn !== "function") {
    throw new Error("Refreshing snapshot logger.warn must be a function");
  }
}

function assertObserver(value: unknown): asserts value is RefreshingSnapshotObserver {
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
      typeof (value as Record<string, unknown>).recordHotStateRefresh !== "function") {
    throw new Error("Refreshing snapshot observer.recordHotStateRefresh must be a function");
  }
}

function readNow(provider: () => number): number {
  const value = provider();
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("Refreshing snapshot current time must be a positive safe integer");
  }
  return value;
}

function assertInteger(value: unknown, min: number, max: number, field: string): void {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) {
    throw new Error(`Refreshing snapshot ${field} must be between ${min} and ${max}`);
  }
}
