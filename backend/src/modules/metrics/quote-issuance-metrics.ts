import type { QuoteIssuanceJournalMirrorObservation } from "../quote/quote-issuance-journal.mirror.js";
import type { RedisQuoteIssuanceObservation } from "../quote/redis-quote-issuance.protocol.js";

export interface QuoteIssuanceMetricsState {
  quoteIssuanceMutations: ReadonlyMap<string, number>;
  quoteIssuanceFailures: ReadonlyMap<string, number>;
  quoteIssuanceBacklog: number;
  quoteIssuanceMirrored: ReadonlyMap<string, number>;
  quoteIssuanceMirrorErrors: number;
}

export class QuoteIssuanceMetrics {
  private readonly mutations = new Map<string, number>();
  private readonly failures = new Map<string, number>();
  private backlog = 0;
  private readonly mirrored = new Map<string, number>();
  private mirrorErrors = 0;

  recordMutation(observation: RedisQuoteIssuanceObservation): void {
    assertEventType(observation.eventType);
    if (typeof observation.duplicate !== "boolean") {
      throw new Error("Metrics quote issuance duplicate state is invalid");
    }
    this.recordBacklog(observation.backlog);
    const key = `${observation.eventType}:${observation.duplicate ? "duplicate" : "applied"}`;
    this.mutations.set(key, (this.mutations.get(key) ?? 0) + 1);
  }

  recordFailure(reason: "backlog_full" | "replica_ack" | "state_invalid" | "projection_timeout"): void {
    if (!["backlog_full", "replica_ack", "state_invalid", "projection_timeout"].includes(reason)) {
      throw new Error("Metrics quote issuance failure reason is invalid");
    }
    this.failures.set(reason, (this.failures.get(reason) ?? 0) + 1);
  }

  recordBacklog(backlog: number): void {
    if (!Number.isSafeInteger(backlog) || backlog < 0) {
      throw new Error("Metrics quote issuance backlog must be a non-negative safe integer");
    }
    this.backlog = backlog;
  }

  recordMirrored(observation: QuoteIssuanceJournalMirrorObservation): void {
    assertEventType(observation.eventType);
    if (typeof observation.inserted !== "boolean" || typeof observation.applied !== "boolean") {
      throw new Error("Metrics quote issuance mirror observation is invalid");
    }
    const result = !observation.inserted ? "duplicate" : observation.applied ? "applied" : "stale";
    const key = `${observation.eventType}:${result}`;
    this.mirrored.set(key, (this.mirrored.get(key) ?? 0) + 1);
  }

  recordMirrorError(): void {
    this.mirrorErrors += 1;
  }

  snapshot(): QuoteIssuanceMetricsState {
    return {
      quoteIssuanceMutations: this.mutations,
      quoteIssuanceFailures: this.failures,
      quoteIssuanceBacklog: this.backlog,
      quoteIssuanceMirrored: this.mirrored,
      quoteIssuanceMirrorErrors: this.mirrorErrors,
    };
  }
}

export function renderQuoteIssuanceMetrics(state: QuoteIssuanceMetricsState): string[] {
  return [
    "# HELP rfq_quote_issuance_mutations_total Durable Redis quote issuance mutations by event and result.",
    "# TYPE rfq_quote_issuance_mutations_total counter",
    ...renderCounters("rfq_quote_issuance_mutations_total", ["event", "result"], state.quoteIssuanceMutations),
    "# HELP rfq_quote_issuance_failures_total Redis quote issuance failures by bounded reason.",
    "# TYPE rfq_quote_issuance_failures_total counter",
    ...renderCounters("rfq_quote_issuance_failures_total", ["reason"], state.quoteIssuanceFailures),
    "# HELP rfq_quote_issuance_backlog Current unmirrored Redis quote issuance events.",
    "# TYPE rfq_quote_issuance_backlog gauge",
    `rfq_quote_issuance_backlog ${state.quoteIssuanceBacklog}`,
    "# HELP rfq_quote_issuance_mirrored_total PostgreSQL quote issuance projection outcomes.",
    "# TYPE rfq_quote_issuance_mirrored_total counter",
    ...renderCounters("rfq_quote_issuance_mirrored_total", ["event", "result"], state.quoteIssuanceMirrored),
    "# HELP rfq_quote_issuance_mirror_errors_total PostgreSQL quote issuance mirror cycle failures.",
    "# TYPE rfq_quote_issuance_mirror_errors_total counter",
    `rfq_quote_issuance_mirror_errors_total ${state.quoteIssuanceMirrorErrors}`,
  ];
}

function assertEventType(value: string): void {
  if (!["prepared", "authorized", "finalized", "failed"].includes(value)) {
    throw new Error("Metrics quote issuance event type is invalid");
  }
}

function renderCounters(name: string, labels: readonly string[], values: ReadonlyMap<string, number>): string[] {
  return [...values.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, count]) => {
    const parts = key.split(":");
    const rendered = labels.map((label, index) => `${label}="${parts[index]}"`).join(",");
    return `${name}{${rendered}} ${count}`;
  });
}
