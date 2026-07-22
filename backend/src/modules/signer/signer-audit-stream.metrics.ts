import type {
  RedisSignerAuditAppendObservation,
  RedisSignerAuditObserver,
} from "./redis-signer-audit.store.js";
import type {
  SignerAuditMirrorObservation,
  SignerAuditMirrorObserver,
} from "./signer-audit-mirror.js";
import type { SignerAuditMetricsProvider } from "./signer-server.js";
import type {
  SignerQuoteCommitObservation,
  SignerQuoteCommitObserver,
} from "./redis-signer-quote-commit.store.js";

export class SignerAuditStreamMetrics
implements RedisSignerAuditObserver, SignerAuditMirrorObserver, SignerAuditMetricsProvider,
  SignerQuoteCommitObserver {
  private appends = 0;
  private duplicates = 0;
  private backlogFailures = 0;
  private replicaAckFailures = 0;
  private mirrored = 0;
  private replayed = 0;
  private mirrorErrors = 0;
  private backlog = 0;
  private atomicCommits = 0;
  private atomicCommitDuplicates = 0;
  private atomicCommitStateFailures = 0;

  recordAppend(observation: RedisSignerAuditAppendObservation): void {
    if (observation.duplicate) this.duplicates += 1;
    else this.appends += 1;
    this.backlog = observation.backlog;
  }

  recordAppendFailure(reason: "backlog_full" | "replica_ack"): void {
    if (reason === "backlog_full") this.backlogFailures += 1;
    else this.replicaAckFailures += 1;
  }

  recordBacklog(backlog: number): void {
    this.backlog = backlog;
  }

  recordQuoteCommit(observation: SignerQuoteCommitObservation): void {
    if (observation.duplicate) {
      this.duplicates += 1;
      this.atomicCommitDuplicates += 1;
    } else {
      this.appends += 1;
      this.atomicCommits += 1;
    }
    this.backlog = observation.auditBacklog;
  }

  recordQuoteCommitFailure(reason: "state_invalid" | "backlog_full" | "replica_ack"): void {
    if (reason === "backlog_full") this.backlogFailures += 1;
    else if (reason === "replica_ack") this.replicaAckFailures += 1;
    else this.atomicCommitStateFailures += 1;
  }

  recordMirrored(observation: SignerAuditMirrorObservation): void {
    if (observation.inserted) this.mirrored += 1;
    else this.replayed += 1;
    this.backlog = Math.max(0, this.backlog - 1);
  }

  recordMirrorError(): void {
    this.mirrorErrors += 1;
  }

  renderPrometheus(): string {
    return [
      "# HELP rfq_signer_audit_stream_appends_total Durable signer audit stream appends by result.",
      "# TYPE rfq_signer_audit_stream_appends_total counter",
      `rfq_signer_audit_stream_appends_total{result="accepted"} ${this.appends}`,
      `rfq_signer_audit_stream_appends_total{result="duplicate"} ${this.duplicates}`,
      `rfq_signer_audit_stream_appends_total{result="backlog_full"} ${this.backlogFailures}`,
      `rfq_signer_audit_stream_appends_total{result="replica_ack_failed"} ${this.replicaAckFailures}`,
      "# HELP rfq_signer_audit_stream_backlog Current unmirrored signer audit stream entries.",
      "# TYPE rfq_signer_audit_stream_backlog gauge",
      `rfq_signer_audit_stream_backlog ${this.backlog}`,
      "# HELP rfq_signer_audit_mirrored_total Signer audit events handled by the PostgreSQL mirror.",
      "# TYPE rfq_signer_audit_mirrored_total counter",
      `rfq_signer_audit_mirrored_total{result="inserted"} ${this.mirrored}`,
      `rfq_signer_audit_mirrored_total{result="replayed"} ${this.replayed}`,
      "# HELP rfq_signer_audit_mirror_errors_total Signer audit mirror cycle failures.",
      "# TYPE rfq_signer_audit_mirror_errors_total counter",
      `rfq_signer_audit_mirror_errors_total ${this.mirrorErrors}`,
      "# HELP rfq_signer_atomic_quote_commits_total Atomic signer audit and quote finalization commits by result.",
      "# TYPE rfq_signer_atomic_quote_commits_total counter",
      `rfq_signer_atomic_quote_commits_total{result="accepted"} ${this.atomicCommits}`,
      `rfq_signer_atomic_quote_commits_total{result="duplicate"} ${this.atomicCommitDuplicates}`,
      `rfq_signer_atomic_quote_commits_total{result="state_invalid"} ${this.atomicCommitStateFailures}`,
      "",
    ].join("\n");
  }
}
