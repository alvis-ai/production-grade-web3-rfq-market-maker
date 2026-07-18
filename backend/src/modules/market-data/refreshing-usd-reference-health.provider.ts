import type { Address } from "../../shared/types/rfq.js";
import {
  type UsdReferenceHealthEvidence,
  type UsdReferenceHealthProvider,
} from "./chainlink-usd-reference.provider.js";
import {
  RefreshingSnapshot,
  type RefreshingSnapshotLogger,
  type RefreshingSnapshotObserver,
} from "../hot-state/refreshing-snapshot.js";

export interface UsdReferenceHealthTarget {
  chainId: number;
  tokenAddress: Address;
}

export interface RefreshingUsdReferenceHealthConfig {
  targets: readonly UsdReferenceHealthTarget[];
  refreshIntervalMs: number;
  maxAgeMs: number;
}

type UsdReferenceSnapshot = ReadonlyMap<string, UsdReferenceHealthEvidence>;

export class RefreshingUsdReferenceHealthProvider implements UsdReferenceHealthProvider {
  private readonly targets: readonly UsdReferenceHealthTarget[];
  private readonly snapshot: RefreshingSnapshot<UsdReferenceSnapshot>;

  constructor(
    private readonly source: UsdReferenceHealthProvider,
    config: RefreshingUsdReferenceHealthConfig,
    logger?: RefreshingSnapshotLogger,
    nowMilliseconds?: () => number,
    observer?: RefreshingSnapshotObserver,
  ) {
    assertProvider(source);
    this.targets = normalizeTargets(config.targets);
    this.snapshot = new RefreshingSnapshot(
      async () => this.loadEvidence(),
      {
        label: "usd reference health",
        metricName: "usd_reference",
        failureCode: "USD_REFERENCE_HOT_STATE_REFRESH_FAILED",
        refreshIntervalMs: config.refreshIntervalMs,
        maxAgeMs: config.maxAgeMs,
      },
      logger,
      nowMilliseconds,
      undefined,
      observer,
    );
  }

  start(): Promise<void> {
    return this.snapshot.start();
  }

  stop(): void {
    this.snapshot.stop();
  }

  refresh(): Promise<void> {
    return this.snapshot.refresh();
  }

  async getHealth(chainId: number, tokenAddress: Address): Promise<UsdReferenceHealthEvidence> {
    const evidence = this.snapshot.read().get(targetKey(chainId, tokenAddress));
    if (!evidence) throw new Error("USD-reference hot state has no feed for the requested chain/token");
    return { ...evidence };
  }

  async checkHealth(): Promise<void> {
    const evidence = this.snapshot.read();
    if (evidence.size !== this.targets.length) {
      throw new Error("USD-reference hot state target coverage is incomplete");
    }
    if ([...evidence.values()].some(({ status }) => status === "depegged")) {
      throw new Error("USD-reference health detected a depegged token");
    }
  }

  private async loadEvidence(): Promise<UsdReferenceSnapshot> {
    const loaded = await Promise.all(this.targets.map(async (target) => {
      const evidence = await this.source.getHealth(target.chainId, target.tokenAddress);
      if (evidence.chainId !== target.chainId ||
          evidence.tokenAddress.toLowerCase() !== target.tokenAddress.toLowerCase()) {
        throw new Error("USD-reference source returned mismatched evidence");
      }
      return evidence;
    }));
    const snapshot = new Map<string, UsdReferenceHealthEvidence>();
    for (const evidence of loaded) {
      const key = targetKey(evidence.chainId, evidence.tokenAddress);
      if (snapshot.has(key)) throw new Error(`USD-reference snapshot contains duplicate target ${key}`);
      snapshot.set(key, { ...evidence });
    }
    return snapshot;
  }
}

function normalizeTargets(targets: readonly UsdReferenceHealthTarget[]): readonly UsdReferenceHealthTarget[] {
  if (!Array.isArray(targets) || targets.length === 0 || targets.length > 1_000) {
    throw new Error("Refreshing USD-reference targets must contain between 1 and 1000 entries");
  }
  const normalized = targets.map((target) => {
    if (typeof target !== "object" || target === null || Array.isArray(target) ||
        !Number.isSafeInteger(target.chainId) || target.chainId <= 0 ||
        typeof target.tokenAddress !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(target.tokenAddress)) {
      throw new Error("Refreshing USD-reference target is invalid");
    }
    return { chainId: target.chainId, tokenAddress: target.tokenAddress.toLowerCase() as Address };
  });
  const keys = normalized.map((target) => targetKey(target.chainId, target.tokenAddress));
  if (new Set(keys).size !== keys.length) throw new Error("Refreshing USD-reference targets must be unique");
  return normalized.sort((left, right) =>
    targetKey(left.chainId, left.tokenAddress).localeCompare(targetKey(right.chainId, right.tokenAddress)));
}

function targetKey(chainId: number, tokenAddress: Address): string {
  if (!Number.isSafeInteger(chainId) || chainId <= 0 ||
      typeof tokenAddress !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(tokenAddress)) {
    throw new Error("USD-reference hot-state identity is invalid");
  }
  return `${chainId}:${tokenAddress.toLowerCase()}`;
}

function assertProvider(value: unknown): asserts value is UsdReferenceHealthProvider {
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
      typeof (value as Record<string, unknown>).getHealth !== "function") {
    throw new Error("Refreshing USD-reference source.getHealth must be a function");
  }
}
