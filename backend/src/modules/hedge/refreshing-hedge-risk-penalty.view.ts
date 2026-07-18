import type { Address } from "../../shared/types/rfq.js";
import {
  assertHedgeRiskInput,
  type HedgeRiskInput,
  type HedgeRiskPenaltyProvider,
} from "./hedge.service.js";
import {
  RefreshingSnapshot,
  type RefreshingSnapshotLogger,
  type RefreshingSnapshotObserver,
} from "../hot-state/refreshing-snapshot.js";

export interface RefreshingHedgeRiskPenaltyConfig {
  targets: readonly HedgeRiskInput[];
  refreshIntervalMs: number;
  maxAgeMs: number;
}

type HedgeRiskPenaltySnapshot = ReadonlyMap<string, number>;

export class RefreshingHedgeRiskPenaltyView implements HedgeRiskPenaltyProvider {
  private readonly targets: readonly HedgeRiskInput[];
  private readonly snapshot: RefreshingSnapshot<HedgeRiskPenaltySnapshot>;

  constructor(
    private readonly source: HedgeRiskPenaltyProvider,
    config: RefreshingHedgeRiskPenaltyConfig,
    logger?: RefreshingSnapshotLogger,
    nowMilliseconds?: () => number,
    observer?: RefreshingSnapshotObserver,
  ) {
    assertProvider(source);
    this.targets = normalizeTargets(config.targets);
    this.snapshot = new RefreshingSnapshot(
      async () => this.loadPenalties(),
      {
        label: "hedge risk penalty",
        metricName: "hedge_risk",
        failureCode: "HEDGE_RISK_HOT_STATE_REFRESH_FAILED",
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

  quoteRiskPenaltyBps(input: HedgeRiskInput): number {
    assertHedgeRiskInput(input);
    const penalty = this.snapshot.read().get(targetKey(input));
    if (penalty === undefined) {
      throw new Error("Hedge risk hot state is not configured for the requested chain/token");
    }
    return penalty;
  }

  private async loadPenalties(): Promise<HedgeRiskPenaltySnapshot> {
    const loaded = await Promise.all(this.targets.map(async (target) => ({
      target,
      penalty: await this.source.quoteRiskPenaltyBps(target),
    })));
    const penalties = new Map<string, number>();
    for (const { target, penalty } of loaded) {
      if (!Number.isSafeInteger(penalty) || penalty < 0 || penalty > 10_000) {
        throw new Error("Refreshing hedge risk source returned an invalid penalty");
      }
      penalties.set(targetKey(target), penalty);
    }
    if (penalties.size !== this.targets.length) {
      throw new Error("Hedge risk hot state target coverage is incomplete");
    }
    return penalties;
  }
}

function normalizeTargets(targets: readonly HedgeRiskInput[]): readonly HedgeRiskInput[] {
  if (!Array.isArray(targets) || targets.length === 0 || targets.length > 10_000) {
    throw new Error("Refreshing hedge risk targets must contain between 1 and 10000 entries");
  }
  const normalized = targets.map((target) => {
    assertHedgeRiskInput(target);
    return { chainId: target.chainId, token: target.token.toLowerCase() as Address };
  });
  const keys = normalized.map(targetKey);
  if (new Set(keys).size !== keys.length) throw new Error("Refreshing hedge risk targets must be unique");
  return normalized.sort((left, right) => targetKey(left).localeCompare(targetKey(right)));
}

function targetKey(input: HedgeRiskInput): string {
  return `${input.chainId}:${input.token.toLowerCase()}`;
}

function assertProvider(value: unknown): asserts value is HedgeRiskPenaltyProvider {
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
      typeof (value as Record<string, unknown>).quoteRiskPenaltyBps !== "function") {
    throw new Error("Refreshing hedge risk source.quoteRiskPenaltyBps must be a function");
  }
}
