import type { Address } from "../../shared/types/rfq.js";
import {
  assertMarketSnapshotIdentifier,
  assertMarketSnapshotPair,
  type MarketSnapshotRecord,
  type MarketSnapshotStore,
  type SaveMarketSnapshotInput,
} from "./market-snapshot.repository.js";

export interface HotMarketSnapshotStoreConfig {
  maxSnapshots: number;
}

export class HotMarketSnapshotStore implements MarketSnapshotStore {
  private readonly maxSnapshots: number;
  private readonly snapshots = new Map<string, MarketSnapshotRecord>();
  private readonly latestByPair = new Map<string, MarketSnapshotRecord>();

  constructor(
    private readonly durable: MarketSnapshotStore,
    config: HotMarketSnapshotStoreConfig = { maxSnapshots: 10_000 },
  ) {
    assertDurableStore(durable);
    if (typeof config !== "object" || config === null || Array.isArray(config) ||
        Object.keys(config).length !== 1 || !Object.prototype.hasOwnProperty.call(config, "maxSnapshots") ||
        !Number.isSafeInteger(config.maxSnapshots) || config.maxSnapshots < 100 || config.maxSnapshots > 1_000_000) {
      throw new Error("Hot market snapshot maxSnapshots must be between 100 and 1000000");
    }
    this.maxSnapshots = config.maxSnapshots;
  }

  async checkHealth(): Promise<void> {
    await this.durable.checkHealth?.();
  }

  async initialize(
    pairs: readonly { chainId: number; tokenA: Address; tokenB: Address }[],
  ): Promise<void> {
    if (!Array.isArray(pairs)) {
      throw new Error("Hot market snapshot initialization pairs must be an array");
    }
    if (typeof this.durable.findLatestForPair !== "function") {
      throw new Error("Hot market snapshot durable store must support latest-pair lookup");
    }
    const seen = new Set<string>();
    for (const pair of pairs) {
      if (typeof pair !== "object" || pair === null || Array.isArray(pair)) {
        throw new Error("Hot market snapshot initialization pair must be an object");
      }
      assertMarketSnapshotPair(pair.chainId, pair.tokenA, pair.tokenB);
      const key = pairKey(pair.chainId, pair.tokenA, pair.tokenB);
      if (seen.has(key)) continue;
      seen.add(key);
      const record = await this.durable.findLatestForPair(
        pair.chainId,
        pair.tokenA,
        pair.tokenB,
      );
      if (record) this.remember(record);
    }
  }

  async saveSnapshot(input: SaveMarketSnapshotInput): Promise<MarketSnapshotRecord> {
    const record = cloneRecord(await this.durable.saveSnapshot(input));
    this.remember(record);
    return cloneRecord(record);
  }

  async findBySnapshotId(snapshotId: string): Promise<MarketSnapshotRecord | undefined> {
    assertMarketSnapshotIdentifier(snapshotId, "snapshotId");
    const hot = this.snapshots.get(snapshotId);
    if (hot) {
      this.snapshots.delete(snapshotId);
      this.snapshots.set(snapshotId, hot);
      return cloneRecord(hot);
    }
    const durable = await this.durable.findBySnapshotId(snapshotId);
    return durable ? cloneRecord(durable) : undefined;
  }

  async findLatestForPair(
    chainId: number,
    tokenA: Address,
    tokenB: Address,
  ): Promise<MarketSnapshotRecord | undefined> {
    assertMarketSnapshotPair(chainId, tokenA, tokenB);
    const record = this.latestByPair.get(pairKey(chainId, tokenA, tokenB));
    return record ? cloneRecord(record) : undefined;
  }

  hotSnapshotCount(): number {
    return this.snapshots.size;
  }

  private remember(record: MarketSnapshotRecord): void {
    const safe = cloneRecord(record);
    this.snapshots.delete(safe.snapshotId);
    this.snapshots.set(safe.snapshotId, safe);
    const key = pairKey(safe.chainId, safe.tokenIn, safe.tokenOut);
    const latest = this.latestByPair.get(key);
    if (!latest || safe.observedAt > latest.observedAt ||
        (safe.observedAt === latest.observedAt && safe.snapshotId > latest.snapshotId)) {
      this.latestByPair.set(key, safe);
    }
    while (this.snapshots.size > this.maxSnapshots) {
      const oldest = this.snapshots.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.snapshots.delete(oldest);
    }
  }
}

function assertDurableStore(value: unknown): asserts value is MarketSnapshotStore {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Hot market snapshot durable store must be an object");
  }
  for (const method of ["saveSnapshot", "findBySnapshotId"] as const) {
    if (typeof (value as Record<string, unknown>)[method] !== "function") {
      throw new Error(`Hot market snapshot durable store.${method} must be a function`);
    }
  }
}

function pairKey(chainId: number, tokenA: Address, tokenB: Address): string {
  const [low, high] = [tokenA.toLowerCase(), tokenB.toLowerCase()].sort();
  return `${chainId}:${low}:${high}`;
}

function cloneRecord(record: MarketSnapshotRecord): MarketSnapshotRecord {
  return { ...record };
}
