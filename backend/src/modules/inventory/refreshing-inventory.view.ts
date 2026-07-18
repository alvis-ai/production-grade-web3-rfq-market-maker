import type { Address } from "../../shared/types/rfq.js";
import {
  assertInventoryPositionKey,
  assertInventoryServiceConfig,
  assertInventorySkewInput,
  assertSettlementDelta,
  calculateInventorySkewBps,
  cloneInventoryServiceConfig,
  defaultInventoryServiceConfig,
  type IInventoryService,
  type InventoryPosition,
  type InventoryProjection,
  type InventoryProjectionInput,
  type InventoryServiceConfig,
  type InventorySkewInput,
  type SettlementDelta,
} from "./inventory.service.js";

export interface RefreshingInventoryViewConfig {
  chainIds: readonly number[];
  refreshIntervalMs: number;
  maxAgeMs: number;
}

export interface RefreshingInventoryViewLogger {
  warn(fields: Readonly<Record<string, unknown>>, message: string): void;
}

interface InventorySnapshot {
  generation: number;
  refreshedAtMs: number;
  positions: ReadonlyMap<string, bigint>;
}

const noopLogger: RefreshingInventoryViewLogger = { warn() {} };

export class RefreshingInventoryView implements IInventoryService {
  private readonly config: RefreshingInventoryViewConfig;
  private readonly inventoryConfig: InventoryServiceConfig;
  private readonly logger: RefreshingInventoryViewLogger;
  private snapshot: InventorySnapshot | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private refreshPromise: Promise<void> | undefined;
  private generation = 0;

  constructor(
    private readonly source: IInventoryService,
    config: RefreshingInventoryViewConfig,
    inventoryConfig: InventoryServiceConfig = defaultInventoryServiceConfig,
    logger: RefreshingInventoryViewLogger = noopLogger,
    private readonly nowMilliseconds: () => number = () => Date.now(),
  ) {
    assertSource(source);
    this.config = normalizeConfig(config);
    assertInventoryServiceConfig(inventoryConfig);
    this.inventoryConfig = cloneInventoryServiceConfig(inventoryConfig);
    assertLogger(logger);
    this.logger = logger;
    if (typeof nowMilliseconds !== "function") {
      throw new Error("Refreshing inventory nowMilliseconds must be a function");
    }
  }

  async start(): Promise<void> {
    if (this.timer) return;
    await this.refresh();
    this.timer = setInterval(() => {
      void this.refresh().catch(() => {
        this.logger.warn(
          { code: "INVENTORY_HOT_STATE_REFRESH_FAILED" },
          "inventory hot-state refresh failed",
        );
      });
    }, this.config.refreshIntervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async refresh(): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.loadSnapshot().finally(() => {
      this.refreshPromise = undefined;
    });
    return this.refreshPromise;
  }

  checkHealth(): void {
    this.requireFreshSnapshot();
  }

  async applySettlement(delta: SettlementDelta): Promise<void> {
    assertSettlementDelta(delta);
    await this.source.applySettlement(delta);
    await this.refresh();
  }

  async rebuildFromSettlements(deltas: readonly SettlementDelta[]): Promise<void> {
    await this.source.rebuildFromSettlements(deltas);
    await this.refresh();
  }

  projectSettlement(input: InventoryProjectionInput): InventoryProjection {
    assertSettlementDelta(input);
    const tokenIn = this.getPosition(input.chainId, input.tokenIn);
    const tokenOut = this.getPosition(input.chainId, input.tokenOut);
    return {
      tokenIn: { ...tokenIn, balance: tokenIn.balance + BigInt(input.amountIn) },
      tokenOut: { ...tokenOut, balance: tokenOut.balance - BigInt(input.amountOut) },
    };
  }

  calculateQuoteSkewBps(input: InventorySkewInput): number {
    assertInventorySkewInput(input);
    return calculateInventorySkewBps(
      this.getPosition(input.chainId, input.token).balance,
      this.inventoryConfig,
    );
  }

  getPosition(chainId: number, token: Address): InventoryPosition {
    assertInventoryPositionKey(chainId, token);
    const snapshot = this.requireFreshSnapshot();
    return {
      chainId,
      token,
      balance: snapshot.positions.get(positionKey(chainId, token)) ?? 0n,
    };
  }

  listPositions(chainId: number): InventoryPosition[] {
    if (!Number.isSafeInteger(chainId) || chainId <= 0) {
      throw new Error("Refreshing inventory chainId must be a positive safe integer");
    }
    const snapshot = this.requireFreshSnapshot();
    const prefix = `${chainId}:`;
    return [...snapshot.positions.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, balance]) => ({ chainId, token: key.slice(prefix.length) as Address, balance }))
      .sort((left, right) => left.token.localeCompare(right.token));
  }

  snapshotGeneration(): number {
    return this.requireFreshSnapshot().generation;
  }

  private async loadSnapshot(): Promise<void> {
    const loaded = await Promise.all(this.config.chainIds.map(async (chainId) => {
      const positions = await this.source.listPositions!(chainId);
      if (!Array.isArray(positions)) throw new Error("Refreshing inventory source returned invalid positions");
      return { chainId, positions };
    }));
    const next = new Map<string, bigint>();
    for (const { chainId, positions } of loaded) {
      for (const position of positions) {
        assertLoadedPosition(position, chainId);
        const key = positionKey(chainId, position.token);
        if (next.has(key)) throw new Error(`Refreshing inventory source returned duplicate position ${key}`);
        next.set(key, position.balance);
      }
    }
    const nowMs = readNow(this.nowMilliseconds);
    this.generation += 1;
    this.snapshot = {
      generation: this.generation,
      refreshedAtMs: nowMs,
      positions: next,
    };
  }

  private requireFreshSnapshot(): InventorySnapshot {
    const snapshot = this.snapshot;
    if (!snapshot) throw new Error("Refreshing inventory hot state is not initialized");
    const ageMs = readNow(this.nowMilliseconds) - snapshot.refreshedAtMs;
    if (ageMs < 0 || ageMs > this.config.maxAgeMs) {
      throw new Error("Refreshing inventory hot state is stale");
    }
    return snapshot;
  }
}

function normalizeConfig(config: RefreshingInventoryViewConfig): RefreshingInventoryViewConfig {
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    throw new Error("Refreshing inventory config must be an object");
  }
  const fields = ["chainIds", "refreshIntervalMs", "maxAgeMs"];
  if (Object.keys(config).some((field) => !fields.includes(field)) ||
      fields.some((field) => !Object.prototype.hasOwnProperty.call(config, field))) {
    throw new Error("Refreshing inventory config fields are invalid");
  }
  if (!Array.isArray(config.chainIds) || config.chainIds.length === 0 || config.chainIds.length > 1_000) {
    throw new Error("Refreshing inventory chainIds must contain between 1 and 1000 chains");
  }
  const chainIds = [...new Set(config.chainIds)];
  if (chainIds.length !== config.chainIds.length ||
      chainIds.some((chainId) => !Number.isSafeInteger(chainId) || chainId <= 0)) {
    throw new Error("Refreshing inventory chainIds must be unique positive safe integers");
  }
  assertInteger(config.refreshIntervalMs, 10, 60_000, "refreshIntervalMs");
  assertInteger(config.maxAgeMs, 20, 300_000, "maxAgeMs");
  if (config.maxAgeMs < config.refreshIntervalMs * 2) {
    throw new Error("Refreshing inventory maxAgeMs must cover at least two refresh intervals");
  }
  return { chainIds: chainIds.sort((a, b) => a - b), refreshIntervalMs: config.refreshIntervalMs, maxAgeMs: config.maxAgeMs };
}

function assertSource(source: unknown): asserts source is IInventoryService {
  if (typeof source !== "object" || source === null || Array.isArray(source)) {
    throw new Error("Refreshing inventory source must be an object");
  }
  for (const method of ["applySettlement", "rebuildFromSettlements", "listPositions"] as const) {
    if (typeof (source as Record<string, unknown>)[method] !== "function") {
      throw new Error(`Refreshing inventory source.${method} must be a function`);
    }
  }
}

function assertLogger(logger: unknown): asserts logger is RefreshingInventoryViewLogger {
  if (typeof logger !== "object" || logger === null || typeof (logger as Record<string, unknown>).warn !== "function") {
    throw new Error("Refreshing inventory logger.warn must be a function");
  }
}

function assertLoadedPosition(position: InventoryPosition, chainId: number): void {
  if (typeof position !== "object" || position === null || Array.isArray(position) ||
      position.chainId !== chainId || typeof position.token !== "string" ||
      !/^0x[0-9a-fA-F]{40}$/.test(position.token) || typeof position.balance !== "bigint") {
    throw new Error("Refreshing inventory source returned an invalid position");
  }
}

function positionKey(chainId: number, token: Address): string {
  return `${chainId}:${token.toLowerCase()}`;
}

function readNow(provider: () => number): number {
  const value = provider();
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("Refreshing inventory current time must be a positive safe integer");
  }
  return value;
}

function assertInteger(value: unknown, min: number, max: number, field: string): void {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`Refreshing inventory ${field} must be between ${min} and ${max}`);
  }
}
