import type { SignedQuote } from "../../shared/types/rfq.js";
import { isCanonicalUtcIsoTimestamp } from "../../shared/validation/timestamp.js";
import type { QuoteRecord, QuoteRepository } from "../quote/quote.repository.js";
import {
  hashSettlementQuote,
  type SettlementEventStore,
} from "../settlement/settlement-event.service.js";
import {
  createSettlementChainReader,
  assertSettlementIndexerConfig,
  type IndexedQuoteSettledLog,
  type SettlementChainReader,
  type SettlementChainReaderFactory,
  type SettlementIndexerChainConfig,
} from "./settlement-indexer.reader.js";
import {
  SettlementIndexerLeaseError,
  type SettlementIndexerCheckpoint,
  type SettlementIndexerCursor,
  type SettlementIndexerStore,
} from "./settlement-indexer.store.js";

export interface SettlementIndexerWorkerConfig {
  workerId: string;
  leaseMs: number;
  pollIntervalMs: number;
  readinessStaleMs: number;
}

export type SettlementIndexerEventOutcome = "applied" | "duplicate";
export type SettlementIndexerErrorCode =
  | "CHAIN_REORG_DURING_SCAN"
  | "DEEP_REORG"
  | "EVENT_MISMATCH"
  | "LEASE_LOST"
  | "QUOTE_NOT_FOUND"
  | "RPC_OR_STORE_UNAVAILABLE";

export interface SettlementIndexerObserver {
  recordCursor(chainId: number, nextBlock: number, safeHead: number): void;
  recordEvent(chainId: number, outcome: SettlementIndexerEventOutcome): void;
  recordRange(chainId: number): void;
  recordReorg(chainId: number, depth: number, removedEvents: number): void;
  recordError(chainId: number, code: SettlementIndexerErrorCode): void;
}

export interface SettlementIndexerLogger {
  error(input: Readonly<Record<string, unknown>>, message: string): void;
}

interface ChainRuntime {
  config: SettlementIndexerChainConfig;
  reader: SettlementChainReader;
}

const workerIdPattern = /^[A-Za-z0-9_:-]+$/;
const indexedLogFields = [
  "transactionHash",
  "blockHash",
  "blockNumber",
  "logIndex",
  "quoteHash",
  "user",
  "tokenIn",
  "tokenOut",
  "amountIn",
  "amountOut",
  "nonce",
] as const;

export class SettlementIndexerWorker {
  private readonly chains = new Map<number, ChainRuntime>();
  private readonly config: SettlementIndexerWorkerConfig;
  private readonly lastSuccessfulPollMs = new Map<number, number>();
  private stopped = false;
  private wakePoll: (() => void) | undefined;

  constructor(
    chainConfigs: readonly SettlementIndexerChainConfig[],
    private readonly store: SettlementIndexerStore,
    private readonly quoteRepository: Pick<QuoteRepository, "findSignedQuoteByChainUserNonce">,
    private readonly settlementEvents: SettlementEventStore,
    config: SettlementIndexerWorkerConfig,
    private readonly observer: SettlementIndexerObserver,
    private readonly logger: SettlementIndexerLogger = console,
    readerFactory: SettlementChainReaderFactory = createSettlementChainReader,
  ) {
    assertWorkerDependencies(store, quoteRepository, settlementEvents, observer, logger, readerFactory);
    assertSettlementIndexerConfig({ chains: [...chainConfigs] });
    assertWorkerConfig(config, chainConfigs);
    this.config = { ...config };
    for (const chainConfig of chainConfigs) {
      const cloned = { ...chainConfig };
      const reader = readerFactory(cloned);
      assertMethods(reader, "reader", [
        "getBlockNumber",
        "getBlockHash",
        "getBlockTimestamp",
        "getQuoteSettledLogs",
      ]);
      this.chains.set(cloned.chainId, { config: cloned, reader });
    }
  }

  async checkDependencies(): Promise<void> {
    await this.store.checkHealth();
    for (const runtime of this.chains.values()) {
      const head = await runtime.reader.getBlockNumber();
      assertBlockNumber(head, "head block number");
      this.lastSuccessfulPollMs.set(runtime.config.chainId, Date.now());
    }
  }

  isReady(nowMs = Date.now()): boolean {
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
      throw new Error("Settlement indexer readiness nowMs must be a non-negative safe integer");
    }
    for (const chainId of this.chains.keys()) {
      const lastSuccess = this.lastSuccessfulPollMs.get(chainId);
      if (lastSuccess === undefined || nowMs - lastSuccess > this.config.readinessStaleMs) return false;
    }
    return true;
  }

  async run(): Promise<void> {
    while (!this.stopped) {
      const processed = await this.runOnce();
      if (!processed) await this.waitForPoll();
    }
    await this.releaseLeasesBestEffort();
  }

  async runOnce(): Promise<boolean> {
    let processed = false;
    for (const runtime of this.chains.values()) {
      if (this.stopped) break;
      try {
        processed = await this.runChainOnce(runtime.config.chainId) || processed;
      } catch (error) {
        const code = indexerErrorCode(error);
        this.observer.recordError(runtime.config.chainId, code);
        this.logger.error(
          { chainId: runtime.config.chainId, errorCode: code },
          "settlement indexer chain iteration failed",
        );
      }
    }
    return processed;
  }

  async runChainOnce(chainId: number): Promise<boolean> {
    assertPositiveSafeInteger(chainId, "chainId");
    const runtime = this.chains.get(chainId);
    if (!runtime) throw new Error(`Settlement indexer chain ${chainId} is not configured`);
    const { config, reader } = runtime;
    const cursor = await this.store.claimCursor({
      chainId,
      settlementAddress: config.settlementAddress,
      startBlock: config.startBlock,
      workerId: this.config.workerId,
      leaseMs: this.config.leaseMs,
    });
    if (!cursor) {
      this.lastSuccessfulPollMs.set(chainId, Date.now());
      return false;
    }

    if (await this.rollbackReorgIfNeeded(runtime, cursor)) {
      this.lastSuccessfulPollMs.set(chainId, Date.now());
      return true;
    }

    const head = await reader.getBlockNumber();
    assertBlockNumber(head, "head block number");
    const safeHead = head - config.confirmations;
    this.observer.recordCursor(chainId, cursor.nextBlock, Math.max(safeHead, 0));
    if (safeHead < cursor.nextBlock) {
      this.lastSuccessfulPollMs.set(chainId, Date.now());
      return false;
    }

    const toBlock = Math.min(safeHead, cursor.nextBlock + config.maxBlockRange - 1);
    const rawLogs = await reader.getQuoteSettledLogs(cursor.nextBlock, toBlock);
    const logs = normalizeLogs(rawLogs, cursor.nextBlock, toBlock);
    const blockHashes = await verifyLogBlockHashes(reader, logs);
    const blockTimestamps = await readLogBlockTimestamps(reader, logs);
    const checkpointHash = blockHashes.get(toBlock) ?? await reader.getBlockHash(toBlock);
    assertHash(checkpointHash, "checkpoint block hash");
    await this.removeOrphanedUncheckpointedEvents(
      chainId,
      cursor.nextBlock,
      toBlock,
      logs,
    );

    for (const log of logs) {
      await this.applyLog(chainId, log, blockTimestamps.get(log.blockNumber)!);
    }
    await this.store.advanceCursor({
      chainId,
      workerId: this.config.workerId,
      leaseMs: this.config.leaseMs,
      expectedRevision: cursor.revision,
      expectedNextBlock: cursor.nextBlock,
      nextBlock: toBlock + 1,
      checkpoint: {
        chainId,
        blockNumber: toBlock,
        blockHash: checkpointHash,
      },
    });
    this.observer.recordRange(chainId);
    this.observer.recordCursor(chainId, toBlock + 1, safeHead);
    this.lastSuccessfulPollMs.set(chainId, Date.now());
    return true;
  }

  stop(): void {
    this.stopped = true;
    this.wakePoll?.();
  }

  private async applyLog(
    chainId: number,
    log: IndexedQuoteSettledLog,
    settledAt: string,
  ): Promise<void> {
    const record = await this.quoteRepository.findSignedQuoteByChainUserNonce(
      chainId,
      log.user,
      log.nonce,
    );
    if (!record) throw new SettlementIndexerError("QUOTE_NOT_FOUND");
    const quote = signedQuoteFromRecord(record);
    assertLogMatchesQuote(log, quote);
    const result = await this.settlementEvents.applySettlementEvent({
      quoteId: record.quoteId,
      quote,
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
      logIndex: log.logIndex,
      settledAt,
    });
    this.observer.recordEvent(chainId, result.duplicate ? "duplicate" : "applied");
  }

  private async removeOrphanedUncheckpointedEvents(
    chainId: number,
    fromBlock: number,
    toBlock: number,
    logs: readonly IndexedQuoteSettledLog[],
  ): Promise<void> {
    const canonicalKeys = new Set(logs.map((log) => eventRefKey(log)));
    const existing = await this.store.listCanonicalEventRefs(chainId, fromBlock, toBlock);
    let removedEvents = 0;
    for (const event of existing) {
      if (canonicalKeys.has(eventRefKey(event))) continue;
      const result = await this.settlementEvents.removeSettlementEvent({
        chainId: event.chainId,
        txHash: event.txHash,
        blockNumber: event.blockNumber,
        logIndex: event.logIndex,
      });
      if (result.removed) removedEvents += 1;
    }
    if (removedEvents > 0) {
      this.observer.recordReorg(chainId, toBlock - fromBlock + 1, removedEvents);
    }
  }

  private async rollbackReorgIfNeeded(
    runtime: ChainRuntime,
    cursor: SettlementIndexerCursor,
  ): Promise<boolean> {
    if (cursor.nextBlock === cursor.startBlock) return false;
    const lastProcessedBlock = cursor.nextBlock - 1;
    const fromBlock = Math.max(cursor.startBlock, lastProcessedBlock - runtime.config.reorgLookbackBlocks);
    const checkpoints = await this.store.listCheckpoints(
      cursor.chainId,
      fromBlock,
      cursor.nextBlock,
    );
    if (checkpoints.length === 0 || checkpoints[0].blockNumber !== lastProcessedBlock) {
      throw new SettlementIndexerError("RPC_OR_STORE_UNAVAILABLE");
    }
    const currentLastHash = await runtime.reader.getBlockHash(lastProcessedBlock);
    if (sameHash(currentLastHash, checkpoints[0].blockHash)) return false;

    const ancestor = await findCommonAncestor(runtime.reader, checkpoints.slice(1));
    let nextBlock: number;
    if (ancestor) {
      nextBlock = ancestor.blockNumber + 1;
    } else if (fromBlock === cursor.startBlock) {
      nextBlock = cursor.startBlock;
    } else {
      throw new SettlementIndexerError("DEEP_REORG");
    }
    const orphaned = await this.store.listCanonicalEventRefs(
      cursor.chainId,
      nextBlock,
      lastProcessedBlock,
    );
    let removedEvents = 0;
    for (const event of orphaned) {
      const result = await this.settlementEvents.removeSettlementEvent({
        chainId: event.chainId,
        txHash: event.txHash,
        blockNumber: event.blockNumber,
        logIndex: event.logIndex,
      });
      if (result.removed) removedEvents += 1;
    }
    await this.store.rollbackCursor({
      chainId: cursor.chainId,
      workerId: this.config.workerId,
      leaseMs: this.config.leaseMs,
      expectedRevision: cursor.revision,
      expectedNextBlock: cursor.nextBlock,
      nextBlock,
    });
    this.observer.recordReorg(cursor.chainId, cursor.nextBlock - nextBlock, removedEvents);
    this.observer.recordCursor(cursor.chainId, nextBlock, lastProcessedBlock);
    return true;
  }

  private async waitForPoll(): Promise<void> {
    if (this.stopped) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.wakePoll = undefined;
        resolve();
      }, this.config.pollIntervalMs);
      this.wakePoll = () => {
        clearTimeout(timer);
        this.wakePoll = undefined;
        resolve();
      };
    });
  }

  private async releaseLeasesBestEffort(): Promise<void> {
    await Promise.all([...this.chains.keys()].map(async (chainId) => {
      try {
        await this.store.releaseCursor(chainId, this.config.workerId);
      } catch {}
    }));
  }
}

async function readLogBlockTimestamps(
  reader: SettlementChainReader,
  logs: readonly IndexedQuoteSettledLog[],
): Promise<Map<number, string>> {
  const timestamps = new Map<number, string>();
  for (const log of logs) {
    if (timestamps.has(log.blockNumber)) continue;
    const timestamp = await reader.getBlockTimestamp(log.blockNumber);
    if (!isCanonicalUtcIsoTimestamp(timestamp)) {
      throw new SettlementIndexerError("RPC_OR_STORE_UNAVAILABLE");
    }
    timestamps.set(log.blockNumber, timestamp);
  }
  return timestamps;
}

async function findCommonAncestor(
  reader: SettlementChainReader,
  checkpoints: readonly SettlementIndexerCheckpoint[],
): Promise<SettlementIndexerCheckpoint | undefined> {
  for (const checkpoint of checkpoints) {
    const currentHash = await reader.getBlockHash(checkpoint.blockNumber);
    if (sameHash(currentHash, checkpoint.blockHash)) return checkpoint;
  }
  return undefined;
}

async function verifyLogBlockHashes(
  reader: SettlementChainReader,
  logs: readonly IndexedQuoteSettledLog[],
): Promise<Map<number, `0x${string}`>> {
  const expected = new Map<number, `0x${string}`>();
  for (const log of logs) {
    const existing = expected.get(log.blockNumber);
    if (existing && !sameHash(existing, log.blockHash)) {
      throw new SettlementIndexerError("CHAIN_REORG_DURING_SCAN");
    }
    expected.set(log.blockNumber, log.blockHash);
  }
  const verified = new Map<number, `0x${string}`>();
  for (const [blockNumber, expectedHash] of expected) {
    const currentHash = await reader.getBlockHash(blockNumber);
    if (!sameHash(currentHash, expectedHash)) {
      throw new SettlementIndexerError("CHAIN_REORG_DURING_SCAN");
    }
    verified.set(blockNumber, currentHash);
  }
  return verified;
}

function normalizeLogs(
  value: unknown,
  fromBlock: number,
  toBlock: number,
): IndexedQuoteSettledLog[] {
  if (!Array.isArray(value)) throw new SettlementIndexerError("RPC_OR_STORE_UNAVAILABLE");
  const seen = new Set<string>();
  const logs = value.map((log, index) => {
    assertIndexedLog(log, index);
    if (log.blockNumber < fromBlock || log.blockNumber > toBlock) {
      throw new SettlementIndexerError("RPC_OR_STORE_UNAVAILABLE");
    }
    const key = `${log.transactionHash.toLowerCase()}:${log.logIndex}`;
    if (seen.has(key)) throw new SettlementIndexerError("RPC_OR_STORE_UNAVAILABLE");
    seen.add(key);
    return { ...log };
  });
  return logs.sort((left, right) => left.blockNumber - right.blockNumber || left.logIndex - right.logIndex);
}

function assertIndexedLog(value: unknown, index: number): asserts value is IndexedQuoteSettledLog {
  assertRecord(value, `Settlement indexer log ${index}`);
  assertExactFields(value, indexedLogFields, `log ${index}`);
  assertHash(value.transactionHash, `log ${index}.transactionHash`);
  assertHash(value.blockHash, `log ${index}.blockHash`);
  assertBlockNumber(value.blockNumber, `log ${index}.blockNumber`);
  assertBlockNumber(value.logIndex, `log ${index}.logIndex`);
  assertHash(value.quoteHash, `log ${index}.quoteHash`);
  assertAddress(value.user, `log ${index}.user`);
  assertAddress(value.tokenIn, `log ${index}.tokenIn`);
  assertAddress(value.tokenOut, `log ${index}.tokenOut`);
  if (value.tokenIn.toLowerCase() === value.tokenOut.toLowerCase()) {
    throw new SettlementIndexerError("EVENT_MISMATCH");
  }
  for (const field of ["amountIn", "amountOut", "nonce"] as const) assertPositiveUInt(value[field], `log ${index}.${field}`);
}

function signedQuoteFromRecord(record: QuoteRecord): SignedQuote {
  if (!record.amountOut || !record.minAmountOut || !record.nonce || !record.deadline || !record.signature) {
    throw new SettlementIndexerError("QUOTE_NOT_FOUND");
  }
  return {
    user: record.user,
    tokenIn: record.tokenIn,
    tokenOut: record.tokenOut,
    amountIn: record.amountIn,
    amountOut: record.amountOut,
    minAmountOut: record.minAmountOut,
    nonce: record.nonce,
    deadline: record.deadline,
    chainId: record.chainId,
  };
}

function assertLogMatchesQuote(log: IndexedQuoteSettledLog, quote: SignedQuote): void {
  if (
    !sameHash(log.quoteHash, hashSettlementQuote(quote)) ||
    log.user.toLowerCase() !== quote.user.toLowerCase() ||
    log.tokenIn.toLowerCase() !== quote.tokenIn.toLowerCase() ||
    log.tokenOut.toLowerCase() !== quote.tokenOut.toLowerCase() ||
    log.amountIn !== quote.amountIn ||
    log.amountOut !== quote.amountOut ||
    log.nonce !== quote.nonce
  ) {
    throw new SettlementIndexerError("EVENT_MISMATCH");
  }
}

function sameHash(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function eventRefKey(value: {
  txHash?: `0x${string}`;
  transactionHash?: `0x${string}`;
  blockNumber: number;
  logIndex: number;
}): string {
  const txHash = value.txHash ?? value.transactionHash;
  if (!txHash) throw new SettlementIndexerError("RPC_OR_STORE_UNAVAILABLE");
  return `${txHash.toLowerCase()}:${value.blockNumber}:${value.logIndex}`;
}

class SettlementIndexerError extends Error {
  constructor(readonly code: SettlementIndexerErrorCode) {
    super(code);
  }
}

function indexerErrorCode(error: unknown): SettlementIndexerErrorCode {
  if (error instanceof SettlementIndexerError) return error.code;
  if (error instanceof SettlementIndexerLeaseError) return "LEASE_LOST";
  return "RPC_OR_STORE_UNAVAILABLE";
}

function assertWorkerConfig(
  config: SettlementIndexerWorkerConfig,
  chainConfigs: readonly SettlementIndexerChainConfig[],
): void {
  assertRecord(config, "Settlement indexer worker config");
  assertExactFields(config, ["workerId", "leaseMs", "pollIntervalMs", "readinessStaleMs"], "worker config");
  if (!workerIdPattern.test(config.workerId) || config.workerId.length === 0 || config.workerId.length > 128) {
    throw new Error("Settlement indexer workerId must be a safe identifier up to 128 characters");
  }
  assertInteger(config.leaseMs, 1_000, 300_000, "leaseMs");
  assertInteger(config.pollIntervalMs, 10, 60_000, "pollIntervalMs");
  assertInteger(config.readinessStaleMs, 1_000, 600_000, "readinessStaleMs");
  if (!Array.isArray(chainConfigs) || chainConfigs.length === 0) {
    throw new Error("Settlement indexer worker requires at least one chain");
  }
  const chainIds = new Set<number>();
  for (const chain of chainConfigs) {
    if (chainIds.has(chain.chainId)) throw new Error("Settlement indexer worker chains must be unique");
    chainIds.add(chain.chainId);
    if (config.leaseMs < chain.requestTimeoutMs * 2) {
      throw new Error("Settlement indexer leaseMs must be at least twice every chain requestTimeoutMs");
    }
  }
}

function assertWorkerDependencies(
  store: unknown,
  quoteRepository: unknown,
  settlementEvents: unknown,
  observer: unknown,
  logger: unknown,
  readerFactory: unknown,
): void {
  assertMethods(store, "store", [
    "checkHealth",
    "claimCursor",
    "advanceCursor",
    "rollbackCursor",
    "releaseCursor",
    "listCheckpoints",
    "listCanonicalEventRefs",
    "stats",
  ]);
  assertMethods(quoteRepository, "quoteRepository", ["findSignedQuoteByChainUserNonce"]);
  assertMethods(settlementEvents, "settlementEvents", ["applySettlementEvent", "removeSettlementEvent"]);
  assertMethods(observer, "observer", ["recordCursor", "recordEvent", "recordRange", "recordReorg", "recordError"]);
  assertMethods(logger, "logger", ["error"]);
  if (typeof readerFactory !== "function") throw new Error("Settlement indexer readerFactory must be a function");
}

function assertMethods(value: unknown, field: string, methods: readonly string[]): void {
  assertRecord(value, `Settlement indexer ${field}`);
  for (const method of methods) {
    if (typeof value[method] !== "function") throw new Error(`Settlement indexer ${field}.${method} must be a function`);
  }
}

function assertHash(value: unknown, field: string): asserts value is `0x${string}` {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new SettlementIndexerError("RPC_OR_STORE_UNAVAILABLE");
  }
}

function assertAddress(value: unknown, field: string): asserts value is `0x${string}` {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new SettlementIndexerError("EVENT_MISMATCH");
  }
}

function assertPositiveUInt(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) {
    throw new SettlementIndexerError("EVENT_MISMATCH");
  }
}

function assertBlockNumber(value: unknown, field: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new SettlementIndexerError("RPC_OR_STORE_UNAVAILABLE");
  }
}

function assertPositiveSafeInteger(value: unknown, field: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Settlement indexer ${field} must be a positive safe integer`);
  }
}

function assertInteger(value: unknown, min: number, max: number, field: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`Settlement indexer ${field} must be an integer between ${min} and ${max}`);
  }
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function assertExactFields(value: object, fields: readonly string[], label: string): void {
  const record = value as Record<string, unknown>;
  const allowed = new Set(fields);
  for (const field of Object.keys(record)) {
    if (!allowed.has(field)) throw new Error(`Settlement indexer ${label} must not include unknown field ${field}`);
  }
  for (const field of fields) {
    if (!Object.hasOwn(record, field)) throw new Error(`Settlement indexer ${label}.${field} must be an own field`);
  }
}
