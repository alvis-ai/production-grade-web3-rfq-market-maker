import {
  assertPairQuoteControlState,
  assertQuoteControlState,
  normalizePairQuoteControlScope,
  type PairQuoteControlScope,
  type PairQuoteControlState,
  type QuoteControlState,
  type QuoteControlStore,
  type UpdateQuoteControlInput,
} from "./quote-control.store.js";
import type { QuoteControlSnapshot } from "./postgres-quote-control.store.js";
import {
  RefreshingSnapshot,
  type RefreshingSnapshotLogger,
  type RefreshingSnapshotObserver,
} from "../hot-state/refreshing-snapshot.js";

export interface RefreshingQuoteControlConfig {
  refreshIntervalMs: number;
  maxAgeMs: number;
}

export interface QuoteControlSnapshotSource extends QuoteControlStore {
  loadSnapshot(): Promise<QuoteControlSnapshot>;
}

interface HotQuoteControlSnapshot {
  state: QuoteControlState;
  pairStates: ReadonlyMap<string, PairQuoteControlState>;
}

export class RefreshingQuoteControlStore implements QuoteControlStore {
  private readonly snapshot: RefreshingSnapshot<HotQuoteControlSnapshot>;

  constructor(
    private readonly source: QuoteControlSnapshotSource,
    config: RefreshingQuoteControlConfig,
    logger?: RefreshingSnapshotLogger,
    nowMilliseconds?: () => number,
    observer?: RefreshingSnapshotObserver,
  ) {
    assertSource(source);
    this.snapshot = new RefreshingSnapshot(
      async () => normalizeSnapshot(await source.loadSnapshot()),
      {
        label: "quote control",
        metricName: "quote_control",
        failureCode: "QUOTE_CONTROL_HOT_STATE_REFRESH_FAILED",
        ...config,
      },
      logger,
      nowMilliseconds,
      mergeSnapshots,
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

  async getState(): Promise<QuoteControlState> {
    return { ...this.snapshot.read().state };
  }

  async getPairState(scope: PairQuoteControlScope): Promise<PairQuoteControlState | null> {
    const normalized = normalizePairQuoteControlScope(scope);
    const state = this.snapshot.read().pairStates.get(pairKey(normalized));
    return state ? { ...state } : null;
  }

  async getPausedPairCount(): Promise<number> {
    let count = 0;
    for (const state of this.snapshot.read().pairStates.values()) {
      if (state.paused) count += 1;
    }
    return count;
  }

  async updateState(input: UpdateQuoteControlInput, actor: string): Promise<QuoteControlState> {
    const state = await this.source.updateState(input, actor);
    this.snapshot.updateCurrent((current) => ({ ...current, state: { ...state } }));
    return { ...state };
  }

  async updatePairState(
    scope: PairQuoteControlScope,
    input: UpdateQuoteControlInput,
    actor: string,
  ): Promise<PairQuoteControlState> {
    const state = await this.source.updatePairState(scope, input, actor);
    this.snapshot.updateCurrent((current) => {
      const pairStates = new Map(current.pairStates);
      pairStates.set(pairKey(state), { ...state });
      return { ...current, pairStates };
    });
    return { ...state };
  }
}

function normalizeSnapshot(snapshot: QuoteControlSnapshot): HotQuoteControlSnapshot {
  if (typeof snapshot !== "object" || snapshot === null || Array.isArray(snapshot) ||
      !Array.isArray(snapshot.pairStates)) {
    throw new Error("Quote control snapshot source returned an invalid snapshot");
  }
  assertQuoteControlState(snapshot.state);
  const pairStates = new Map<string, PairQuoteControlState>();
  for (const state of snapshot.pairStates) {
    assertPairQuoteControlState(state);
    const key = pairKey(state);
    if (pairStates.has(key)) throw new Error(`Quote control snapshot contains duplicate pair ${key}`);
    pairStates.set(key, { ...state });
  }
  return { state: { ...snapshot.state }, pairStates };
}

function mergeSnapshots(
  loaded: HotQuoteControlSnapshot,
  current: HotQuoteControlSnapshot | undefined,
): HotQuoteControlSnapshot {
  if (!current) return loaded;
  const pairStates = new Map(loaded.pairStates);
  for (const [key, state] of current.pairStates) {
    const loadedState = pairStates.get(key);
    if (!loadedState || state.version > loadedState.version) pairStates.set(key, state);
  }
  return {
    state: current.state.version > loaded.state.version ? current.state : loaded.state,
    pairStates,
  };
}

function pairKey(scope: PairQuoteControlScope): string {
  return `${scope.chainId}:${scope.tokenLow.toLowerCase()}:${scope.tokenHigh.toLowerCase()}`;
}

function assertSource(value: unknown): asserts value is QuoteControlSnapshotSource {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Refreshing quote control source must be an object");
  }
  for (const method of ["loadSnapshot", "updateState", "updatePairState"] as const) {
    if (typeof (value as Record<string, unknown>)[method] !== "function") {
      throw new Error(`Refreshing quote control source.${method} must be a function`);
    }
  }
}
