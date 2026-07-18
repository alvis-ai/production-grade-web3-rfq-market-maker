import {
  assertToxicFlowScoreState,
  normalizeToxicFlowScoreKey,
  type ToxicFlowScoreKey,
  type ToxicFlowScoreState,
  type ToxicFlowScoreStore,
  type UpdateToxicFlowScoreInput,
} from "./toxic-flow-score.store.js";
import {
  RefreshingSnapshot,
  type RefreshingSnapshotLogger,
  type RefreshingSnapshotObserver,
} from "../hot-state/refreshing-snapshot.js";

export interface RefreshingToxicFlowScoreConfig {
  refreshIntervalMs: number;
  maxAgeMs: number;
  maxEntries: number;
}

export interface ToxicFlowScoreSnapshotSource extends ToxicFlowScoreStore {
  listScores(limit: number): Promise<readonly ToxicFlowScoreState[]>;
}

type ToxicFlowScoreSnapshot = ReadonlyMap<string, ToxicFlowScoreState>;

export class RefreshingToxicFlowScoreStore implements ToxicFlowScoreStore {
  private readonly maxEntries: number;
  private readonly snapshot: RefreshingSnapshot<ToxicFlowScoreSnapshot>;

  constructor(
    private readonly source: ToxicFlowScoreSnapshotSource,
    config: RefreshingToxicFlowScoreConfig,
    logger?: RefreshingSnapshotLogger,
    nowMilliseconds?: () => number,
    observer?: RefreshingSnapshotObserver,
  ) {
    assertSource(source);
    this.maxEntries = normalizeMaxEntries(config.maxEntries);
    this.snapshot = new RefreshingSnapshot(
      async () => this.loadScores(),
      {
        label: "toxic flow score",
        metricName: "toxic_flow",
        failureCode: "TOXIC_FLOW_SCORE_HOT_STATE_REFRESH_FAILED",
        refreshIntervalMs: config.refreshIntervalMs,
        maxAgeMs: config.maxAgeMs,
      },
      logger,
      nowMilliseconds,
      mergeScores,
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

  async getScore(key: ToxicFlowScoreKey): Promise<ToxicFlowScoreState | null> {
    const normalized = normalizeToxicFlowScoreKey(key);
    const score = this.snapshot.read().get(scoreKey(normalized));
    return score ? { ...score } : null;
  }

  async updateScore(
    key: ToxicFlowScoreKey,
    input: UpdateToxicFlowScoreInput,
    actor: string,
  ): Promise<ToxicFlowScoreState> {
    const normalizedKey = normalizeToxicFlowScoreKey(key);
    const current = this.snapshot.read();
    if (!current.has(scoreKey(normalizedKey)) && current.size >= this.maxEntries) {
      throw new Error("Toxic flow score hot state exceeds the configured entry limit");
    }
    const score = await this.source.updateScore(key, input, actor);
    this.snapshot.updateCurrent((current) => {
      const scores = new Map(current);
      scores.set(scoreKey(score), { ...score });
      return scores;
    });
    return { ...score };
  }

  private async loadScores(): Promise<ToxicFlowScoreSnapshot> {
    const loaded = await this.source.listScores(this.maxEntries + 1);
    if (!Array.isArray(loaded)) throw new Error("Toxic flow score snapshot source returned an invalid list");
    if (loaded.length > this.maxEntries) {
      throw new Error("Toxic flow score hot state exceeds the configured entry limit");
    }
    const scores = new Map<string, ToxicFlowScoreState>();
    for (const score of loaded) {
      assertToxicFlowScoreState(score);
      const key = scoreKey(score);
      if (scores.has(key)) throw new Error(`Toxic flow score snapshot contains duplicate key ${key}`);
      scores.set(key, { ...score });
    }
    return scores;
  }
}

function mergeScores(
  loaded: ToxicFlowScoreSnapshot,
  current: ToxicFlowScoreSnapshot | undefined,
): ToxicFlowScoreSnapshot {
  if (!current) return loaded;
  const scores = new Map(loaded);
  for (const [key, score] of current) {
    const loadedScore = scores.get(key);
    if (!loadedScore || score.version > loadedScore.version) scores.set(key, score);
  }
  return scores;
}

function scoreKey(key: ToxicFlowScoreKey): string {
  return `${key.chainId}:${key.user.toLowerCase()}`;
}

function normalizeMaxEntries(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 1_000_000) {
    throw new Error("Refreshing toxic flow score maxEntries must be between 1 and 1000000");
  }
  return Number(value);
}

function assertSource(value: unknown): asserts value is ToxicFlowScoreSnapshotSource {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Refreshing toxic flow score source must be an object");
  }
  for (const method of ["listScores", "updateScore"] as const) {
    if (typeof (value as Record<string, unknown>)[method] !== "function") {
      throw new Error(`Refreshing toxic flow score source.${method} must be a function`);
    }
  }
}
