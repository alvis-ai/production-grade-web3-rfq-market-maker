import {
  refreshingSnapshotMetricNames,
  refreshingSnapshotRefreshOutcomes,
  type RefreshingSnapshotMetricName,
  type RefreshingSnapshotRefreshOutcome,
} from "../hot-state/refreshing-snapshot.js";

export interface HotStateMetricsState {
  hotStateRefreshes: ReadonlyMap<string, number>;
  hotStateLastSuccessMs: ReadonlyMap<RefreshingSnapshotMetricName, number>;
}

export class HotStateMetrics {
  private readonly refreshes = new Map<string, number>();
  private readonly lastSuccessMs = new Map<RefreshingSnapshotMetricName, number>();

  record(
    name: RefreshingSnapshotMetricName,
    outcome: RefreshingSnapshotRefreshOutcome,
    refreshedAtMs?: number,
  ): void {
    if (!refreshingSnapshotMetricNames.includes(name)) {
      throw new Error("Metrics hot-state name is invalid");
    }
    if (!refreshingSnapshotRefreshOutcomes.includes(outcome)) {
      throw new Error("Metrics hot-state refresh outcome is invalid");
    }
    if (outcome === "success") {
      if (!Number.isSafeInteger(refreshedAtMs) || Number(refreshedAtMs) <= 0) {
        throw new Error("Metrics hot-state refreshedAtMs must be a positive safe integer");
      }
      this.lastSuccessMs.set(name, Number(refreshedAtMs));
    } else if (refreshedAtMs !== undefined) {
      throw new Error("Metrics failed hot-state refresh must not carry a success timestamp");
    }
    const key = `${name}:${outcome}`;
    this.refreshes.set(key, (this.refreshes.get(key) ?? 0) + 1);
  }

  snapshot(): HotStateMetricsState {
    return {
      hotStateRefreshes: this.refreshes,
      hotStateLastSuccessMs: this.lastSuccessMs,
    };
  }
}

export function renderHotStateMetrics(state: HotStateMetricsState): string[] {
  return [
    "# HELP rfq_hot_state_refreshes_total Background hot-state refreshes by bounded state and outcome.",
    "# TYPE rfq_hot_state_refreshes_total counter",
    ...refreshingSnapshotMetricNames.flatMap((name) => {
      return refreshingSnapshotRefreshOutcomes.map((outcome) => {
        const value = state.hotStateRefreshes.get(`${name}:${outcome}`) ?? 0;
        return `rfq_hot_state_refreshes_total{state="${name}",outcome="${outcome}"} ${value}`;
      });
    }),
    "# HELP rfq_hot_state_last_success_unixtime_seconds Unix time of the latest successful hot-state generation.",
    "# TYPE rfq_hot_state_last_success_unixtime_seconds gauge",
    ...refreshingSnapshotMetricNames.map((name) => {
      const value = (state.hotStateLastSuccessMs.get(name) ?? 0) / 1_000;
      return `rfq_hot_state_last_success_unixtime_seconds{state="${name}"} ${value}`;
    }),
  ];
}
