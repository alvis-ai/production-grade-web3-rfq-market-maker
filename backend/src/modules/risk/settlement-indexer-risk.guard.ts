import pg from "pg";
import { createPublicClient, defineChain, http } from "viem";
import type {
  ReceiptChainConfig,
  ReceiptExecutionConfig,
} from "../execution/receipt-settlement-evidence.provider.js";
import { assertReceiptExecutionConfig } from "../execution/receipt-settlement-evidence.provider.js";
import { assertRpcChainId } from "../../shared/validation/rpc.js";
import {
  RefreshingSnapshot,
  type RefreshingSnapshotLogger,
  type RefreshingSnapshotObserver,
} from "../hot-state/refreshing-snapshot.js";

export interface SettlementIndexerRiskRequest {
  chainId: number;
  observedHead?: bigint;
}

export interface SettlementIndexerRiskGuard {
  checkHealth(): Promise<void> | void;
  assertQuoteSafe(input: SettlementIndexerRiskRequest): Promise<void>;
}

export type SettlementIndexerRiskFailureCode =
  | "RPC_UNAVAILABLE"
  | "CURSOR_STORE_UNAVAILABLE"
  | "CURSOR_MISSING"
  | "CURSOR_INVALID"
  | "CONTRACT_MISMATCH"
  | "CURSOR_STALE"
  | "BLOCK_LAG";

export interface SettlementIndexerRiskObserver {
  recordSettlementIndexerRiskGuardSuccess(chainId: number): void;
  recordSettlementIndexerRiskGuardFailure(chainId: number, reason: SettlementIndexerRiskFailureCode): void;
}

export interface SettlementIndexerRiskGuardConfig {
  receiptConfig: ReceiptExecutionConfig;
  maxCursorAgeMs: number;
  maxBlockLag: number;
  refreshIntervalMs: number;
  maxSnapshotAgeMs: number;
}

export interface SettlementIndexerHeadReader {
  getChainId(): Promise<unknown>;
  getBlockNumber(): Promise<unknown>;
}

export type SettlementIndexerHeadReaderFactory = (
  config: ReceiptChainConfig,
) => SettlementIndexerHeadReader;

interface CursorEvidence {
  settlementAddress: string;
  nextBlock: bigint;
  ageMs: number;
}

interface HotIndexerEvidence {
  chain: ReceiptChainConfig;
  cursor: CursorEvidence;
  observedHead: bigint;
  loadedAtMs: number;
}

const configFields = [
  "receiptConfig",
  "maxCursorAgeMs",
  "maxBlockLag",
  "refreshIntervalMs",
  "maxSnapshotAgeMs",
] as const;
const requestFields = ["chainId"] as const;

export class PostgresSettlementIndexerRiskGuard implements SettlementIndexerRiskGuard {
  private readonly chains = new Map<number, ReceiptChainConfig>();
  private readonly readers = new Map<number, SettlementIndexerHeadReader>();
  private readonly chainChecks = new Map<number, Promise<void>>();
  private readonly maxCursorAgeMs: number;
  private readonly maxBlockLag: number;
  private readonly snapshot: RefreshingSnapshot<ReadonlyMap<number, HotIndexerEvidence>>;

  constructor(
    private readonly pool: pg.Pool,
    config: SettlementIndexerRiskGuardConfig,
    readerFactory: SettlementIndexerHeadReaderFactory = createSettlementIndexerHeadReader,
    private readonly observer: SettlementIndexerRiskObserver = noOpObserver,
    private readonly nowMilliseconds: () => number = () => Date.now(),
    logger?: RefreshingSnapshotLogger,
    hotStateObserver?: RefreshingSnapshotObserver,
  ) {
    assertPool(pool);
    assertConfig(config);
    if (typeof readerFactory !== "function") {
      throw new Error("Settlement indexer risk readerFactory must be a function");
    }
    assertObserver(observer);
    if (typeof nowMilliseconds !== "function") {
      throw new Error("Settlement indexer risk nowMilliseconds must be a function");
    }
    this.maxCursorAgeMs = config.maxCursorAgeMs;
    this.maxBlockLag = config.maxBlockLag;
    for (const chain of config.receiptConfig.chains) {
      const cloned = { ...chain };
      const reader = readerFactory(cloned);
      assertReader(reader);
      this.chains.set(cloned.chainId, cloned);
      this.readers.set(cloned.chainId, reader);
    }
    this.snapshot = new RefreshingSnapshot(
      async () => this.loadSnapshot(),
      {
        label: "settlement indexer risk",
        metricName: "settlement_indexer",
        failureCode: "SETTLEMENT_INDEXER_HOT_STATE_REFRESH_FAILED",
        refreshIntervalMs: config.refreshIntervalMs,
        maxAgeMs: config.maxSnapshotAgeMs,
      },
      logger,
      nowMilliseconds,
      undefined,
      hotStateObserver,
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
    const snapshot = this.readSnapshot();
    for (const chain of this.chains.values()) {
      const evidence = snapshot.get(chain.chainId);
      if (!evidence) throw new Error("Settlement indexer risk hot state coverage is incomplete");
      this.assertCursorSafe(evidence, evidence.observedHead);
    }
  }

  async assertQuoteSafe(input: SettlementIndexerRiskRequest): Promise<void> {
    assertRequest(input);
    const chain = this.chains.get(input.chainId);
    if (!chain) {
      throw new Error("Settlement indexer risk is not configured for the requested chain");
    }
    try {
      const evidence = this.readSnapshot().get(chain.chainId);
      if (!evidence) throw riskFailure("CURSOR_MISSING", "Settlement indexer risk hot state is incomplete");
      this.assertCursorSafe(evidence, input.observedHead ?? evidence.observedHead);
      this.recordSuccess(chain.chainId);
    } catch (error) {
      const failure = error instanceof SettlementIndexerRiskFailure
        ? error
        : riskFailure("CURSOR_STORE_UNAVAILABLE", "Settlement indexer cursor store is unavailable");
      this.recordFailure(chain.chainId, failure.code);
      throw failure;
    }
  }

  private assertCursorSafe(evidence: HotIndexerEvidence, observedHead: bigint): void {
    const { chain, cursor } = evidence;
    if (cursor.settlementAddress.toLowerCase() !== chain.settlementAddress.toLowerCase()) {
      throw riskFailure(
        "CONTRACT_MISMATCH",
        "Settlement indexer cursor contract does not match receipt configuration",
      );
    }
    const snapshotAgeMs = readNow(this.nowMilliseconds) - evidence.loadedAtMs;
    if (snapshotAgeMs < 0 || cursor.ageMs + snapshotAgeMs > this.maxCursorAgeMs) {
      throw riskFailure("CURSOR_STALE", "Settlement indexer cursor is stale");
    }
    const safeHead = observedHead < BigInt(chain.confirmations)
      ? -1n
      : observedHead - BigInt(chain.confirmations);
    const lag = safeHead < cursor.nextBlock
      ? 0n
      : safeHead - cursor.nextBlock + 1n;
    if (lag > BigInt(this.maxBlockLag)) {
      throw riskFailure("BLOCK_LAG", "Settlement indexer cursor exceeds the confirmed block lag limit");
    }
  }

  private async loadSnapshot(): Promise<ReadonlyMap<number, HotIndexerEvidence>> {
    const loaded = await Promise.all([...this.chains.values()].map(async (chain) => {
      const reader = this.readers.get(chain.chainId)!;
      let observedHead: bigint;
      try {
        await this.assertChainIdentity(chain, reader);
        observedHead = parseBlockNumber(await reader.getBlockNumber(), "RPC head");
      } catch (error) {
        throw riskFailure("RPC_UNAVAILABLE", errorMessage(error, "Settlement indexer risk RPC is unavailable"));
      }
      const cursor = await this.readCursorEvidence(chain.chainId);
      return {
        chain,
        cursor,
        observedHead,
        loadedAtMs: readNow(this.nowMilliseconds),
      };
    }));
    const snapshot = new Map<number, HotIndexerEvidence>();
    for (const evidence of loaded) snapshot.set(evidence.chain.chainId, evidence);
    if (snapshot.size !== this.chains.size) {
      throw riskFailure("CURSOR_MISSING", "Settlement indexer risk hot state coverage is incomplete");
    }
    return snapshot;
  }

  private readSnapshot(): ReadonlyMap<number, HotIndexerEvidence> {
    try {
      return this.snapshot.read();
    } catch (error) {
      throw riskFailure(
        "CURSOR_STORE_UNAVAILABLE",
        errorMessage(error, "Settlement indexer risk hot state is unavailable"),
      );
    }
  }

  private async readCursorEvidence(chainId: number): Promise<CursorEvidence> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT settlement_address,
                next_block::text AS next_block,
                floor(extract(epoch FROM (now() - updated_at)) * 1000)::text AS cursor_age_ms
         FROM settlement_indexer_cursors
         WHERE chain_id = $1`,
        [chainId],
      );
      if (result.rows.length !== 1) {
        throw riskFailure("CURSOR_MISSING", "Settlement indexer cursor is missing or duplicated");
      }
      try {
        return parseCursorEvidence(result.rows[0]);
      } catch (error) {
        throw riskFailure("CURSOR_INVALID", errorMessage(error, "Settlement indexer cursor is invalid"));
      }
    } catch (error) {
      if (error instanceof SettlementIndexerRiskFailure) throw error;
      throw riskFailure("CURSOR_STORE_UNAVAILABLE", "Settlement indexer cursor store is unavailable");
    } finally {
      client.release();
    }
  }

  private recordSuccess(chainId: number): void {
    try {
      this.observer.recordSettlementIndexerRiskGuardSuccess(chainId);
    } catch {}
  }

  private recordFailure(chainId: number, reason: SettlementIndexerRiskFailureCode): void {
    try {
      this.observer.recordSettlementIndexerRiskGuardFailure(chainId, reason);
    } catch {}
  }

  private async assertChainIdentity(
    chain: ReceiptChainConfig,
    reader: SettlementIndexerHeadReader,
  ): Promise<void> {
    let check = this.chainChecks.get(chain.chainId);
    if (!check) {
      check = reader.getChainId().then((actual) => {
        assertRpcChainId(actual, chain.chainId, "Settlement indexer risk RPC");
      });
      this.chainChecks.set(chain.chainId, check);
      void check.catch(() => this.chainChecks.delete(chain.chainId));
    }
    await check;
  }
}

function createSettlementIndexerHeadReader(config: ReceiptChainConfig): SettlementIndexerHeadReader {
  const chain = defineChain({
    id: config.chainId,
    name: `EVM Chain ${config.chainId}`,
    nativeCurrency: { name: "Native Token", symbol: "NATIVE", decimals: 18 },
    rpcUrls: { default: { http: [config.rpcUrl] } },
  });
  const client = createPublicClient({
    chain,
    transport: http(config.rpcUrl, { timeout: Math.min(config.receiptTimeoutMs, 30_000) }),
  });
  return {
    getChainId: () => client.getChainId(),
    getBlockNumber: () => client.getBlockNumber(),
  };
}

function assertConfig(value: unknown): asserts value is SettlementIndexerRiskGuardConfig {
  assertRecord(value, "Settlement indexer risk config");
  assertExactFields(value, configFields, "Settlement indexer risk config");
  assertReceiptExecutionConfig(value.receiptConfig);
  if (value.receiptConfig.chains.length === 0) {
    throw new Error("Settlement indexer risk config requires at least one receipt chain");
  }
  assertInteger(value.maxCursorAgeMs, 1_000, 600_000, "maxCursorAgeMs");
  assertInteger(value.maxBlockLag, 0, 10_000, "maxBlockLag");
  assertInteger(value.refreshIntervalMs, 10, 60_000, "refreshIntervalMs");
  assertInteger(value.maxSnapshotAgeMs, 20, 300_000, "maxSnapshotAgeMs");
  if (value.maxSnapshotAgeMs < value.refreshIntervalMs * 2) {
    throw new Error("Settlement indexer risk maxSnapshotAgeMs must cover at least two refresh intervals");
  }
}

function assertRequest(value: unknown): asserts value is SettlementIndexerRiskRequest {
  assertRecord(value, "Settlement indexer risk request");
  assertExactFields(value, requestFields, "Settlement indexer risk request", ["observedHead"]);
  assertInteger(value.chainId, 1, Number.MAX_SAFE_INTEGER, "request.chainId");
  if (value.observedHead !== undefined) parseBlockNumber(value.observedHead, "request.observedHead");
}

function parseCursorEvidence(value: unknown): CursorEvidence {
  assertRecord(value, "Settlement indexer cursor evidence");
  const settlementAddress = value.settlement_address;
  if (typeof settlementAddress !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(settlementAddress)) {
    throw new Error("Settlement indexer cursor settlement_address is invalid");
  }
  return {
    settlementAddress,
    nextBlock: parseDecimalBigInt(value.next_block, "next_block"),
    ageMs: parseNonNegativeSafeInteger(value.cursor_age_ms, "cursor_age_ms"),
  };
}

function parseBlockNumber(value: unknown, field: string): bigint {
  if (typeof value !== "bigint" || value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`Settlement indexer risk ${field} must be a non-negative safe bigint`);
  }
  return value;
}

function parseDecimalBigInt(value: unknown, field: string): bigint {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`Settlement indexer cursor ${field} must be a canonical non-negative integer`);
  }
  const parsed = BigInt(value);
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`Settlement indexer cursor ${field} must fit a safe integer`);
  }
  return parsed;
}

function parseNonNegativeSafeInteger(value: unknown, field: string): number {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`Settlement indexer cursor ${field} must be a canonical non-negative integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`Settlement indexer cursor ${field} must fit a safe integer`);
  }
  return parsed;
}

function readNow(provider: () => number): number {
  const value = provider();
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("Settlement indexer risk current time must be a positive safe integer");
  }
  return value;
}

function assertPool(value: unknown): asserts value is pg.Pool {
  if (!isRecord(value) || typeof value.connect !== "function") {
    throw new Error("Settlement indexer risk pool.connect must be a function");
  }
}

function assertReader(value: unknown): asserts value is SettlementIndexerHeadReader {
  if (!isRecord(value) || typeof value.getChainId !== "function" || typeof value.getBlockNumber !== "function") {
    throw new Error("Settlement indexer risk reader methods are invalid");
  }
}

function assertObserver(value: unknown): asserts value is SettlementIndexerRiskObserver {
  if (!isRecord(value) ||
      typeof value.recordSettlementIndexerRiskGuardSuccess !== "function" ||
      typeof value.recordSettlementIndexerRiskGuardFailure !== "function") {
    throw new Error("Settlement indexer risk observer methods are invalid");
  }
}

function assertInteger(value: unknown, min: number, max: number, field: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`Settlement indexer risk ${field} must be an integer between ${min} and ${max}`);
  }
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertExactFields(
  value: Record<string, unknown>,
  fields: readonly string[],
  label: string,
  optionalFields: readonly string[] = [],
): void {
  const allowed = new Set([...fields, ...optionalFields]);
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) throw new Error(`${label} must not include unknown field ${field}`);
  }
  for (const field of fields) {
    if (!Object.hasOwn(value, field)) throw new Error(`${label}.${field} must be an own field`);
  }
  for (const field of optionalFields) {
    if (field in value && !Object.hasOwn(value, field)) {
      throw new Error(`${label}.${field} must be an own field when provided`);
    }
  }
}

class SettlementIndexerRiskFailure extends Error {
  constructor(readonly code: SettlementIndexerRiskFailureCode, message: string) {
    super(message);
  }
}

function riskFailure(code: SettlementIndexerRiskFailureCode, message: string): SettlementIndexerRiskFailure {
  return new SettlementIndexerRiskFailure(code, message);
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.length > 0 ? error.message : fallback;
}

const noOpObserver: SettlementIndexerRiskObserver = {
  recordSettlementIndexerRiskGuardSuccess() {},
  recordSettlementIndexerRiskGuardFailure() {},
};
