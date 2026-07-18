import type pg from "pg";
import type { FastifyInstance } from "fastify";
import {
  InMemoryQuoteControlStore,
  assertQuoteControlStore,
  type QuoteControlStore,
} from "../modules/quote-control/quote-control.store.js";
import { PostgresQuoteControlStore } from "../modules/quote-control/postgres-quote-control.store.js";
import { RefreshingQuoteControlStore } from "../modules/quote-control/refreshing-quote-control.store.js";
import {
  InMemoryToxicFlowScoreStore,
  assertToxicFlowScoreStore,
  type ToxicFlowScoreStore,
} from "../modules/risk/toxic-flow-score.store.js";
import { PostgresToxicFlowScoreStore } from "../modules/risk/postgres-toxic-flow-score.store.js";
import { RefreshingToxicFlowScoreStore } from "../modules/risk/refreshing-toxic-flow-score.store.js";
import type {
  RefreshingSnapshotLogger,
  RefreshingSnapshotObserver,
} from "../modules/hot-state/refreshing-snapshot.js";
import type {
  SettlementIndexerRiskGuard,
  SettlementIndexerRiskObserver,
} from "../modules/risk/settlement-indexer-risk.guard.js";
import {
  readDecimalIntegerConfig,
  readOwnEnvValue,
  runtimeEnvironment,
} from "./environment.js";
import { buildRuntimeSettlementIndexerRiskGuard } from "./gateway-settlement-indexer-risk.js";

export interface GatewayHotStateConfig {
  refreshIntervalMs: number;
  maxAgeMs: number;
  maxToxicFlowEntries: number;
}

export interface GatewayHotStateLifecycle {
  start(): Promise<void>;
  stop(): void;
}

export interface GatewayStoreRuntime<T> {
  store: T;
  lifecycle?: GatewayHotStateLifecycle;
}

export interface GatewayCoreHotStateRuntime {
  config: GatewayHotStateConfig;
  quoteControl: GatewayStoreRuntime<QuoteControlStore>;
  toxicFlow: GatewayStoreRuntime<ToxicFlowScoreStore>;
  settlementIndexerRiskGuard: SettlementIndexerRiskGuard | undefined;
  settlementIndexerLifecycle?: GatewayHotStateLifecycle;
}

export const defaultGatewayHotStateConfig: GatewayHotStateConfig = {
  refreshIntervalMs: 250,
  maxAgeMs: 2_000,
  maxToxicFlowEntries: 100_000,
};

export function readGatewayHotStateConfig(
  env: Record<string, string | undefined> | undefined = runtimeEnvironment(),
): GatewayHotStateConfig {
  const refreshIntervalMs = readDecimalIntegerConfig(
    readOwnEnvValue(env, "RFQ_HOT_STATE_REFRESH_INTERVAL_MS"),
    {
      defaultValue: defaultGatewayHotStateConfig.refreshIntervalMs,
      min: 10,
      max: 60_000,
      name: "RFQ_HOT_STATE_REFRESH_INTERVAL_MS",
    },
  );
  const maxAgeMs = readDecimalIntegerConfig(readOwnEnvValue(env, "RFQ_HOT_STATE_MAX_AGE_MS"), {
    defaultValue: defaultGatewayHotStateConfig.maxAgeMs,
    min: 20,
    max: 300_000,
    name: "RFQ_HOT_STATE_MAX_AGE_MS",
  });
  if (maxAgeMs < refreshIntervalMs * 2) {
    throw new Error("RFQ_HOT_STATE_MAX_AGE_MS must cover at least two refresh intervals");
  }
  return {
    refreshIntervalMs,
    maxAgeMs,
    maxToxicFlowEntries: readDecimalIntegerConfig(
      readOwnEnvValue(env, "RFQ_TOXIC_FLOW_HOT_STATE_MAX_ENTRIES"),
      {
        defaultValue: defaultGatewayHotStateConfig.maxToxicFlowEntries,
        min: 1,
        max: 1_000_000,
        name: "RFQ_TOXIC_FLOW_HOT_STATE_MAX_ENTRIES",
      },
    ),
  };
}

export function buildGatewayCoreHotStateRuntime(input: {
  quoteControlStore?: QuoteControlStore;
  toxicFlowScoreStore?: ToxicFlowScoreStore;
  pool?: pg.Pool;
  observer?: SettlementIndexerRiskObserver & RefreshingSnapshotObserver;
  settlementIndexerRiskGuard?: SettlementIndexerRiskGuard;
  logger?: RefreshingSnapshotLogger;
}): GatewayCoreHotStateRuntime {
  const config = readGatewayHotStateConfig();
  assertSettlementIndexerRiskGuard(input.settlementIndexerRiskGuard);
  const defaultSettlementIndexerRiskGuard = input.settlementIndexerRiskGuard
    ? undefined
    : buildRuntimeSettlementIndexerRiskGuard(input.pool, input.observer, config, input.logger);
  return {
    config,
    quoteControl: resolveGatewayQuoteControlRuntime(
      input.quoteControlStore, input.pool, config, input.logger, input.observer,
    ),
    toxicFlow: resolveGatewayToxicFlowScoreRuntime(
      input.toxicFlowScoreStore, input.pool, config, input.logger, input.observer,
    ),
    settlementIndexerRiskGuard: input.settlementIndexerRiskGuard ?? defaultSettlementIndexerRiskGuard,
    ...(defaultSettlementIndexerRiskGuard
      ? { settlementIndexerLifecycle: defaultSettlementIndexerRiskGuard }
      : {}),
  };
}

export function registerGatewayHotStateLifecycles(
  server: FastifyInstance,
  candidates: readonly (GatewayHotStateLifecycle | undefined)[],
): readonly (() => void)[] {
  const lifecycles = candidates.filter(
    (runtime): runtime is GatewayHotStateLifecycle => runtime !== undefined,
  );
  if (lifecycles.length > 0) {
    server.addHook("onReady", async () => {
      await Promise.all(lifecycles.map((runtime) => runtime.start()));
    });
  }
  return lifecycles.map((runtime) => () => runtime.stop());
}

export function resolveGatewayQuoteControlRuntime(
  configured: QuoteControlStore | undefined,
  pool: pg.Pool | undefined,
  config: GatewayHotStateConfig,
  logger?: RefreshingSnapshotLogger,
  observer?: RefreshingSnapshotObserver,
): GatewayStoreRuntime<QuoteControlStore> {
  if (configured) {
    assertQuoteControlStore(configured);
    return { store: configured };
  }
  if (!pool) return { store: new InMemoryQuoteControlStore() };
  const store = new RefreshingQuoteControlStore(
    new PostgresQuoteControlStore(pool),
    { refreshIntervalMs: config.refreshIntervalMs, maxAgeMs: config.maxAgeMs },
    logger,
    undefined,
    observer,
  );
  return { store, lifecycle: store };
}

export function resolveGatewayToxicFlowScoreRuntime(
  configured: ToxicFlowScoreStore | undefined,
  pool: pg.Pool | undefined,
  config: GatewayHotStateConfig,
  logger?: RefreshingSnapshotLogger,
  observer?: RefreshingSnapshotObserver,
): GatewayStoreRuntime<ToxicFlowScoreStore> {
  if (configured) {
    assertToxicFlowScoreStore(configured);
    return { store: configured };
  }
  if (!pool) return { store: new InMemoryToxicFlowScoreStore() };
  const store = new RefreshingToxicFlowScoreStore(
    new PostgresToxicFlowScoreStore(pool),
    {
      refreshIntervalMs: config.refreshIntervalMs,
      maxAgeMs: config.maxAgeMs,
      maxEntries: config.maxToxicFlowEntries,
    },
    logger,
    undefined,
    observer,
  );
  return { store, lifecycle: store };
}

function assertSettlementIndexerRiskGuard(value: SettlementIndexerRiskGuard | undefined): void {
  if (value === undefined) return;
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
      typeof value.checkHealth !== "function" || typeof value.assertQuoteSafe !== "function") {
    throw new Error("buildServer settlementIndexerRiskGuard methods are invalid");
  }
}
