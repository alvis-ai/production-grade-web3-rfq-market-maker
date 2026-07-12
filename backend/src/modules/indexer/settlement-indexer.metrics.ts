import type {
  SettlementIndexerErrorCode,
  SettlementIndexerEventOutcome,
  SettlementIndexerObserver,
} from "./settlement-indexer.worker.js";
import type { SettlementIndexerCursorStats } from "./settlement-indexer.store.js";

const eventOutcomes: readonly SettlementIndexerEventOutcome[] = ["applied", "duplicate"];
const errorCodes: readonly SettlementIndexerErrorCode[] = [
  "CHAIN_REORG_DURING_SCAN",
  "DEEP_REORG",
  "EVENT_MISMATCH",
  "LEASE_LOST",
  "QUOTE_NOT_FOUND",
  "RPC_OR_STORE_UNAVAILABLE",
];

interface ChainMetrics {
  nextBlock: number;
  safeHead: number;
  ranges: number;
  reorgs: number;
  removedEvents: number;
  lastPollTimestampSeconds: number;
  events: Map<SettlementIndexerEventOutcome, number>;
  errors: Map<SettlementIndexerErrorCode, number>;
}

export class SettlementIndexerMetrics implements SettlementIndexerObserver {
  private readonly chains = new Map<number, ChainMetrics>();

  constructor(chainIds: readonly number[]) {
    if (!Array.isArray(chainIds) || chainIds.length === 0 || new Set(chainIds).size !== chainIds.length) {
      throw new Error("Settlement indexer metrics chainIds must be a non-empty unique array");
    }
    for (const chainId of chainIds) {
      assertPositiveSafeInteger(chainId, "chainId");
      this.chains.set(chainId, {
        nextBlock: 0,
        safeHead: 0,
        ranges: 0,
        reorgs: 0,
        removedEvents: 0,
        lastPollTimestampSeconds: 0,
        events: new Map(eventOutcomes.map((outcome) => [outcome, 0])),
        errors: new Map(errorCodes.map((code) => [code, 0])),
      });
    }
  }

  recordCursor(chainId: number, nextBlock: number, safeHead: number): void {
    const chain = this.requireChain(chainId);
    assertNonNegativeSafeInteger(nextBlock, "nextBlock");
    assertNonNegativeSafeInteger(safeHead, "safeHead");
    chain.nextBlock = nextBlock;
    chain.safeHead = safeHead;
    chain.lastPollTimestampSeconds = Math.floor(Date.now() / 1_000);
  }

  recordEvent(chainId: number, outcome: SettlementIndexerEventOutcome): void {
    const chain = this.requireChain(chainId);
    if (!eventOutcomes.includes(outcome)) throw new Error("Settlement indexer metric event outcome is invalid");
    chain.events.set(outcome, (chain.events.get(outcome) ?? 0) + 1);
  }

  recordRange(chainId: number): void {
    this.requireChain(chainId).ranges += 1;
  }

  recordReorg(chainId: number, depth: number, removedEvents: number): void {
    const chain = this.requireChain(chainId);
    assertPositiveSafeInteger(depth, "reorg depth");
    assertNonNegativeSafeInteger(removedEvents, "removedEvents");
    chain.reorgs += 1;
    chain.removedEvents += removedEvents;
  }

  recordError(chainId: number, code: SettlementIndexerErrorCode): void {
    const chain = this.requireChain(chainId);
    if (!errorCodes.includes(code)) throw new Error("Settlement indexer metric error code is invalid");
    chain.errors.set(code, (chain.errors.get(code) ?? 0) + 1);
  }

  renderPrometheus(stats: readonly SettlementIndexerCursorStats[] = [], nowMs = Date.now()): string {
    if (!Array.isArray(stats)) throw new Error("Settlement indexer metrics stats must be an array");
    assertNonNegativeSafeInteger(nowMs, "nowMs");
    const statsByChain = new Map<number, SettlementIndexerCursorStats>();
    for (const stat of stats) {
      assertStat(stat);
      if (!this.chains.has(stat.chainId) || statsByChain.has(stat.chainId)) {
        throw new Error("Settlement indexer metrics stats contain unknown or duplicate chainId");
      }
      statsByChain.set(stat.chainId, stat);
    }
    const lines = [
      "# HELP rfq_settlement_indexer_ranges_total Confirmed block ranges committed by chain.",
      "# TYPE rfq_settlement_indexer_ranges_total counter",
    ];
    for (const [chainId, chain] of this.chains) {
      lines.push(`rfq_settlement_indexer_ranges_total{chain_id="${chainId}"} ${chain.ranges}`);
    }
    lines.push(
      "# HELP rfq_settlement_indexer_events_total QuoteSettled events consumed by bounded outcome.",
      "# TYPE rfq_settlement_indexer_events_total counter",
    );
    for (const [chainId, chain] of this.chains) {
      for (const outcome of eventOutcomes) {
        lines.push(`rfq_settlement_indexer_events_total{chain_id="${chainId}",outcome="${outcome}"} ${chain.events.get(outcome) ?? 0}`);
      }
    }
    lines.push(
      "# HELP rfq_settlement_indexer_errors_total Chain polling errors by bounded reason.",
      "# TYPE rfq_settlement_indexer_errors_total counter",
    );
    for (const [chainId, chain] of this.chains) {
      for (const code of errorCodes) {
        lines.push(`rfq_settlement_indexer_errors_total{chain_id="${chainId}",code="${code}"} ${chain.errors.get(code) ?? 0}`);
      }
    }
    lines.push(
      "# HELP rfq_settlement_indexer_reorgs_total Confirmed-history reorgs detected by chain.",
      "# TYPE rfq_settlement_indexer_reorgs_total counter",
      "# HELP rfq_settlement_indexer_reorg_removed_events_total Canonical settlement events removed during reorg recovery.",
      "# TYPE rfq_settlement_indexer_reorg_removed_events_total counter",
      "# HELP rfq_settlement_indexer_next_block Next block the durable cursor will scan.",
      "# TYPE rfq_settlement_indexer_next_block gauge",
      "# HELP rfq_settlement_indexer_safe_head Latest block eligible after confirmation depth.",
      "# TYPE rfq_settlement_indexer_safe_head gauge",
      "# HELP rfq_settlement_indexer_lag_blocks Eligible confirmed blocks not yet committed.",
      "# TYPE rfq_settlement_indexer_lag_blocks gauge",
      "# HELP rfq_settlement_indexer_last_poll_timestamp_seconds Last successful chain poll timestamp.",
      "# TYPE rfq_settlement_indexer_last_poll_timestamp_seconds gauge",
      "# HELP rfq_settlement_indexer_cursor_update_age_seconds Age of the durable cursor row update.",
      "# TYPE rfq_settlement_indexer_cursor_update_age_seconds gauge",
    );
    for (const [chainId, chain] of this.chains) {
      const stat = statsByChain.get(chainId);
      const cursorAge = stat
        ? Math.max(0, Math.floor((nowMs - Date.parse(stat.updatedAt)) / 1_000))
        : 0;
      const nextBlock = stat?.nextBlock ?? chain.nextBlock;
      lines.push(
        `rfq_settlement_indexer_reorgs_total{chain_id="${chainId}"} ${chain.reorgs}`,
        `rfq_settlement_indexer_reorg_removed_events_total{chain_id="${chainId}"} ${chain.removedEvents}`,
        `rfq_settlement_indexer_next_block{chain_id="${chainId}"} ${nextBlock}`,
        `rfq_settlement_indexer_safe_head{chain_id="${chainId}"} ${chain.safeHead}`,
        `rfq_settlement_indexer_lag_blocks{chain_id="${chainId}"} ${Math.max(0, chain.safeHead - nextBlock + 1)}`,
        `rfq_settlement_indexer_last_poll_timestamp_seconds{chain_id="${chainId}"} ${chain.lastPollTimestampSeconds}`,
        `rfq_settlement_indexer_cursor_update_age_seconds{chain_id="${chainId}"} ${cursorAge}`,
      );
    }
    lines.push("");
    return lines.join("\n");
  }

  private requireChain(chainId: number): ChainMetrics {
    const chain = this.chains.get(chainId);
    if (!chain) throw new Error("Settlement indexer metric chainId is not configured");
    return chain;
  }
}

function assertStat(value: unknown): asserts value is SettlementIndexerCursorStats {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Settlement indexer metric stat must be an object");
  }
  const stat = value as Record<string, unknown>;
  const fields = ["chainId", "nextBlock", "updatedAt"];
  if (Object.keys(stat).length !== fields.length || fields.some((field) => !Object.hasOwn(stat, field))) {
    throw new Error("Settlement indexer metric stat must use the closed schema");
  }
  assertPositiveSafeInteger(stat.chainId, "stats chainId");
  assertNonNegativeSafeInteger(stat.nextBlock, "stats nextBlock");
  if (typeof stat.updatedAt !== "string" || Number.isNaN(Date.parse(stat.updatedAt)) ||
      new Date(stat.updatedAt).toISOString() !== stat.updatedAt) {
    throw new Error("Settlement indexer metric stat updatedAt must be canonical UTC");
  }
}

function assertPositiveSafeInteger(value: unknown, field: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Settlement indexer metrics ${field} must be a positive safe integer`);
  }
}

function assertNonNegativeSafeInteger(value: unknown, field: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Settlement indexer metrics ${field} must be a non-negative safe integer`);
  }
}
