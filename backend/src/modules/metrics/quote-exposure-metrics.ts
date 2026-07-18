import type { QuoteExposureLedgerMirrorObservation } from "../risk/quote-exposure-ledger.mirror.js";
import type { RedisQuoteExposureObservation } from "../risk/redis-quote-exposure.store.js";
import { createHistogramState, recordHistogram, renderHistogram } from "./histogram.js";
import type { HistogramState } from "./metrics-contract.js";

export interface QuoteExposureMetricsState {
  quoteExposureLedgerMutations: ReadonlyMap<string, number>;
  quoteExposureLedgerFailures: ReadonlyMap<string, number>;
  quoteExposureLedgerLockWait: HistogramState;
  quoteExposureLedgerBacklog: number;
  quoteExposureLedgerMirrored: ReadonlyMap<string, number>;
  quoteExposureLedgerMirrorErrors: number;
}

export class QuoteExposureMetrics {
  private readonly mutations = new Map<string, number>();
  private readonly failures = new Map<string, number>();
  private readonly lockWait = createHistogramState();
  private backlog = 0;
  private readonly mirrored = new Map<string, number>();
  private mirrorErrors = 0;

  recordMutation(observation: RedisQuoteExposureObservation): void {
    if (observation.operation !== "reserve" && observation.operation !== "release") {
      throw new Error("Metrics quote exposure ledger operation is invalid");
    }
    if (typeof observation.duplicate !== "boolean") {
      throw new Error("Metrics quote exposure ledger duplicate state is invalid");
    }
    this.recordBacklog(observation.backlog);
    const key = `${observation.operation}:${observation.duplicate ? "duplicate" : "applied"}`;
    this.mutations.set(key, (this.mutations.get(key) ?? 0) + 1);
  }

  recordFailure(reason: "backlog_full" | "lock_timeout" | "replica_ack" | "state_invalid"): void {
    if (!["backlog_full", "lock_timeout", "replica_ack", "state_invalid"].includes(reason)) {
      throw new Error("Metrics quote exposure ledger failure reason is invalid");
    }
    this.failures.set(reason, (this.failures.get(reason) ?? 0) + 1);
  }

  recordLockWait(seconds: number): void {
    recordHistogram(this.lockWait, seconds);
  }

  recordBacklog(backlog: number): void {
    if (!Number.isSafeInteger(backlog) || backlog < 0) {
      throw new Error("Metrics quote exposure ledger backlog must be a non-negative safe integer");
    }
    this.backlog = backlog;
  }

  recordMirrored(observation: QuoteExposureLedgerMirrorObservation): void {
    if ((observation.operation !== "reserve" && observation.operation !== "release") ||
        typeof observation.inserted !== "boolean" || typeof observation.applied !== "boolean") {
      throw new Error("Metrics quote exposure ledger mirror observation is invalid");
    }
    const result = !observation.inserted ? "duplicate" : observation.applied ? "applied" : "stale";
    const key = `${observation.operation}:${result}`;
    this.mirrored.set(key, (this.mirrored.get(key) ?? 0) + 1);
  }

  recordMirrorError(): void {
    this.mirrorErrors += 1;
  }

  snapshot(): QuoteExposureMetricsState {
    return {
      quoteExposureLedgerMutations: this.mutations,
      quoteExposureLedgerFailures: this.failures,
      quoteExposureLedgerLockWait: this.lockWait,
      quoteExposureLedgerBacklog: this.backlog,
      quoteExposureLedgerMirrored: this.mirrored,
      quoteExposureLedgerMirrorErrors: this.mirrorErrors,
    };
  }
}

export function renderQuoteExposureMetrics(state: QuoteExposureMetricsState): string[] {
  return [
    "# HELP rfq_quote_exposure_ledger_mutations_total Redis quote exposure ledger mutations by operation and result.",
    "# TYPE rfq_quote_exposure_ledger_mutations_total counter",
    ...renderCounters("rfq_quote_exposure_ledger_mutations_total", ["operation", "result"], state.quoteExposureLedgerMutations),
    "# HELP rfq_quote_exposure_ledger_failures_total Redis quote exposure ledger failures by bounded reason.",
    "# TYPE rfq_quote_exposure_ledger_failures_total counter",
    ...renderCounters("rfq_quote_exposure_ledger_failures_total", ["reason"], state.quoteExposureLedgerFailures),
    "# HELP rfq_quote_exposure_ledger_lock_wait_seconds Time spent acquiring the chain-scoped exposure lease.",
    "# TYPE rfq_quote_exposure_ledger_lock_wait_seconds histogram",
    ...renderHistogram("rfq_quote_exposure_ledger_lock_wait_seconds", state.quoteExposureLedgerLockWait),
    "# HELP rfq_quote_exposure_ledger_backlog Current unmirrored Redis exposure events.",
    "# TYPE rfq_quote_exposure_ledger_backlog gauge",
    `rfq_quote_exposure_ledger_backlog ${state.quoteExposureLedgerBacklog}`,
    "# HELP rfq_quote_exposure_ledger_mirrored_total PostgreSQL exposure ledger mirror outcomes.",
    "# TYPE rfq_quote_exposure_ledger_mirrored_total counter",
    ...renderCounters("rfq_quote_exposure_ledger_mirrored_total", ["operation", "result"], state.quoteExposureLedgerMirrored),
    "# HELP rfq_quote_exposure_ledger_mirror_errors_total PostgreSQL exposure ledger mirror cycle failures.",
    "# TYPE rfq_quote_exposure_ledger_mirror_errors_total counter",
    `rfq_quote_exposure_ledger_mirror_errors_total ${state.quoteExposureLedgerMirrorErrors}`,
  ];
}

function renderCounters(name: string, labels: readonly string[], values: ReadonlyMap<string, number>): string[] {
  return [...values.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, count]) => {
    const parts = key.split(":");
    const rendered = labels.map((label, index) => `${label}="${parts[index]}"`).join(",");
    return `${name}{${rendered}} ${count}`;
  });
}
