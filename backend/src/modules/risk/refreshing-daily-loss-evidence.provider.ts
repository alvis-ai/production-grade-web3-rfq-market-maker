import type { Address } from "../../shared/types/rfq.js";
import {
  DailyLossEvidenceError,
  type DailyLossEvidence,
  type DailyLossEvidenceProvider,
} from "./daily-loss-risk.engine.js";
import {
  RefreshingSnapshot,
  type RefreshingSnapshotLogger,
  type RefreshingSnapshotObserver,
} from "../hot-state/refreshing-snapshot.js";

export interface DailyLossEvidenceTarget {
  chainId: number;
  tokenAddress: Address;
}

export interface RefreshingDailyLossEvidenceConfig {
  targets: readonly DailyLossEvidenceTarget[];
  refreshIntervalMs: number;
  maxAgeMs: number;
}

type DailyLossSnapshot = ReadonlyMap<string, DailyLossEvidence>;

export class RefreshingDailyLossEvidenceProvider implements DailyLossEvidenceProvider {
  private readonly targets: readonly DailyLossEvidenceTarget[];
  private readonly snapshot: RefreshingSnapshot<DailyLossSnapshot>;

  constructor(
    private readonly source: DailyLossEvidenceProvider,
    config: RefreshingDailyLossEvidenceConfig,
    logger?: RefreshingSnapshotLogger,
    nowMilliseconds?: () => number,
    observer?: RefreshingSnapshotObserver,
  ) {
    assertProvider(source);
    this.targets = normalizeTargets(config.targets);
    this.snapshot = new RefreshingSnapshot(
      async () => this.loadEvidence(),
      {
        label: "daily loss evidence",
        metricName: "daily_loss",
        failureCode: "DAILY_LOSS_HOT_STATE_REFRESH_FAILED",
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

  checkHealth(): void {
    this.snapshot.checkHealth();
  }

  async getDailyLossEvidence(chainId: number, tokenAddress: Address): Promise<DailyLossEvidence> {
    const key = targetKey(chainId, tokenAddress);
    let evidence: DailyLossEvidence | undefined;
    try {
      evidence = this.snapshot.read().get(key);
    } catch (error) {
      throw unavailable(error);
    }
    if (!evidence) {
      throw new DailyLossEvidenceError(
        "EVIDENCE_INVALID",
        "Daily loss hot state is not configured for the requested chain/token",
      );
    }
    return { ...evidence };
  }

  private async loadEvidence(): Promise<DailyLossSnapshot> {
    const entries = await Promise.all(this.targets.map(async (target) => {
      const evidence = await this.source.getDailyLossEvidence(target.chainId, target.tokenAddress);
      assertEvidenceIdentity(evidence, target);
      return evidence;
    }));
    const snapshot = new Map<string, DailyLossEvidence>();
    for (const evidence of entries) {
      const key = targetKey(evidence.chainId, evidence.tokenAddress);
      if (snapshot.has(key)) throw new Error(`Daily loss snapshot contains duplicate target ${key}`);
      snapshot.set(key, { ...evidence });
    }
    if (snapshot.size !== this.targets.length) {
      throw new Error("Daily loss hot state target coverage is incomplete");
    }
    return snapshot;
  }
}

function normalizeTargets(targets: readonly DailyLossEvidenceTarget[]): readonly DailyLossEvidenceTarget[] {
  if (!Array.isArray(targets) || targets.length === 0 || targets.length > 100) {
    throw new Error("Refreshing daily loss targets must contain between 1 and 100 entries");
  }
  const normalized = targets.map((target) => {
    if (typeof target !== "object" || target === null || Array.isArray(target) ||
        !Number.isSafeInteger(target.chainId) || target.chainId <= 0 ||
        typeof target.tokenAddress !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(target.tokenAddress)) {
      throw new Error("Refreshing daily loss target is invalid");
    }
    return {
      chainId: target.chainId,
      tokenAddress: target.tokenAddress.toLowerCase() as Address,
    };
  });
  const keys = normalized.map((target) => targetKey(target.chainId, target.tokenAddress));
  if (new Set(keys).size !== keys.length) throw new Error("Refreshing daily loss targets must be unique");
  return normalized.sort((left, right) =>
    targetKey(left.chainId, left.tokenAddress).localeCompare(targetKey(right.chainId, right.tokenAddress)));
}

function assertProvider(value: unknown): asserts value is DailyLossEvidenceProvider {
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
      typeof (value as Record<string, unknown>).getDailyLossEvidence !== "function") {
    throw new Error("Refreshing daily loss source.getDailyLossEvidence must be a function");
  }
}

function assertEvidenceIdentity(evidence: DailyLossEvidence, target: DailyLossEvidenceTarget): void {
  if (typeof evidence !== "object" || evidence === null || Array.isArray(evidence) ||
      evidence.chainId !== target.chainId ||
      evidence.tokenAddress !== target.tokenAddress.toLowerCase()) {
    throw new Error("Refreshing daily loss source returned mismatched evidence");
  }
}

function targetKey(chainId: number, tokenAddress: Address): string {
  if (!Number.isSafeInteger(chainId) || chainId <= 0 ||
      typeof tokenAddress !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(tokenAddress)) {
    throw new Error("Refreshing daily loss evidence identity is invalid");
  }
  return `${chainId}:${tokenAddress.toLowerCase()}`;
}

function unavailable(error: unknown): DailyLossEvidenceError {
  const message = error instanceof Error ? error.message : "Daily loss hot state is unavailable";
  return new DailyLossEvidenceError("STORE_UNAVAILABLE", message);
}
