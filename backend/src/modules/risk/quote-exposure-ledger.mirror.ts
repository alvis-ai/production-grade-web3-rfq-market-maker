import {
  parseRedisQuoteExposureRecord,
  type RedisQuoteExposureRecord,
} from "./redis-quote-exposure.store.js";
import {
  type PostgresQuoteExposureLedgerSink,
  type QuoteExposureLedgerOperation,
} from "./postgres-quote-exposure-ledger.sink.js";

const acknowledgeAndDeleteScript = `
local acknowledged = redis.call("XACK", KEYS[1], ARGV[1], ARGV[2])
if acknowledged == 1 then redis.call("XDEL", KEYS[1], ARGV[2]) end
return {acknowledged, redis.call("XLEN", KEYS[1])}
`;

export interface RedisQuoteExposureConsumerClient {
  readonly status?: string;
  connect?: () => Promise<unknown>;
  disconnect?: () => void;
  call(command: string, ...args: Array<string | number>): Promise<unknown>;
  eval(script: string, numberOfKeys: number, ...args: Array<string | number>): Promise<unknown>;
  quit(): Promise<unknown>;
}

export interface QuoteExposureLedgerMirrorConfig {
  streamKey: string;
  sourceEpoch: string;
  group: string;
  consumer: string;
  batchSize: number;
  blockMs: number;
  claimIdleMs: number;
  retryDelayMs: number;
  cleanupLimit: number;
  cleanupIntervalMs: number;
}

export interface QuoteExposureLedgerMirrorObservation {
  sourceStreamId: string;
  inserted: boolean;
  applied: boolean;
  operation: QuoteExposureLedgerOperation;
}

export interface QuoteExposureLedgerMirrorObserver {
  recordLedgerMirrored(observation: QuoteExposureLedgerMirrorObservation): void;
  recordLedgerMirrorError(): void;
  recordLedgerBacklog(backlog: number): void;
}

export interface QuoteExposureProjectionBarrier {
  awaitPreparedQuoteProjection(quoteId: string): Promise<void>;
}

export interface QuoteExposureLedgerMirrorLogger {
  warn(fields: Readonly<Record<string, unknown>>, message: string): void;
}

interface StreamEntry {
  id: string;
  operation: QuoteExposureLedgerOperation;
  record: RedisQuoteExposureRecord;
}

const noopObserver: QuoteExposureLedgerMirrorObserver = {
  recordLedgerMirrored() {},
  recordLedgerMirrorError() {},
  recordLedgerBacklog() {},
};

const noopLogger: QuoteExposureLedgerMirrorLogger = { warn() {} };

export class QuoteExposureLedgerMirror {
  private readonly config: QuoteExposureLedgerMirrorConfig;
  private readonly observer: QuoteExposureLedgerMirrorObserver;
  private readonly logger: QuoteExposureLedgerMirrorLogger;
  private connectPromise: Promise<void> | undefined;
  private loop: Promise<void> | undefined;
  private running = false;
  private groupReady = false;
  private sinkHealthy = false;
  private nextCleanupAtMs = 0;

  constructor(
    private readonly client: RedisQuoteExposureConsumerClient,
    private readonly sink: PostgresQuoteExposureLedgerSink,
    config: QuoteExposureLedgerMirrorConfig,
    observer: QuoteExposureLedgerMirrorObserver = noopObserver,
    logger: QuoteExposureLedgerMirrorLogger = noopLogger,
    private readonly nowMilliseconds: () => number = Date.now,
    private readonly projectionBarrier?: QuoteExposureProjectionBarrier,
  ) {
    assertClient(client);
    if (typeof sink !== "object" || sink === null ||
        typeof sink.applyMirrored !== "function" || typeof sink.checkHealth !== "function" ||
        typeof sink.deleteExpired !== "function") {
      throw new Error("Quote exposure ledger mirror sink is invalid");
    }
    this.config = normalizeConfig(config);
    assertObserver(observer);
    assertLogger(logger);
    assertProjectionBarrier(projectionBarrier);
    if (typeof nowMilliseconds !== "function") {
      throw new Error("Quote exposure ledger mirror nowMilliseconds must be a function");
    }
    this.observer = observer;
    this.logger = logger;
  }

  async initialize(): Promise<void> {
    await this.ensureConnected();
    await this.ensureGroup();
    await this.sink.checkHealth();
    this.sinkHealthy = true;
  }

  assertHealthy(): void {
    if (!this.sinkHealthy) {
      throw new Error("Quote exposure ledger mirror is unhealthy");
    }
  }

  async start(): Promise<void> {
    if (this.running) return;
    await this.initialize();
    this.running = true;
    this.loop = this.runLoop();
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.loop;
    this.loop = undefined;
  }

  async close(): Promise<void> {
    await this.stop();
    if (this.client.status === "wait" || this.client.status === "end") {
      this.client.disconnect?.();
      return;
    }
    try { await this.client.quit(); } catch { this.client.disconnect?.(); }
  }

  async runOnce(block = false): Promise<number> {
    let sinkVerified = false;
    try {
      await this.ensureConnected();
      await this.ensureGroup();
      const claimed = await this.readClaimed();
      const entries = claimed.length > 0 ? claimed : await this.readNew(block);
      for (const entry of entries) {
        const sourceStreamId = `${this.config.sourceEpoch}:${entry.id}`;
        await this.projectionBarrier?.awaitPreparedQuoteProjection(entry.record.quoteId);
        const result = await this.sink.applyMirrored(entry.operation, entry.record, sourceStreamId);
        sinkVerified = true;
        const acknowledged = await this.client.eval(
          acknowledgeAndDeleteScript,
          1,
          this.config.streamKey,
          this.config.group,
          entry.id,
        );
        if (!Array.isArray(acknowledged) || acknowledged.length !== 2 || acknowledged[0] !== 1 ||
            !Number.isSafeInteger(acknowledged[1]) || Number(acknowledged[1]) < 0) {
          throw new Error(`Quote exposure ledger mirror could not acknowledge ${entry.id}`);
        }
        this.notifyBacklog(Number(acknowledged[1]));
        this.notifyMirrored({ sourceStreamId, operation: entry.operation, ...result });
      }
      const nowMilliseconds = readNowMilliseconds(this.nowMilliseconds);
      if (nowMilliseconds >= this.nextCleanupAtMs) {
        this.nextCleanupAtMs = nowMilliseconds + this.config.cleanupIntervalMs;
        await this.sink.deleteExpired(this.config.cleanupLimit);
        sinkVerified = true;
      }
      if (sinkVerified) this.sinkHealthy = true;
      return entries.length;
    } catch (error) {
      this.sinkHealthy = false;
      throw error;
    }
  }

  private async runLoop(): Promise<void> {
    while (this.running) {
      try {
        await this.runOnce(true);
      } catch {
        this.notifyError();
        this.logger.warn(
          { code: "QUOTE_EXPOSURE_LEDGER_MIRROR_FAILED" },
          "quote exposure ledger mirror cycle failed",
        );
        if (this.running) await delay(this.config.retryDelayMs);
      }
    }
  }

  private async readClaimed(): Promise<StreamEntry[]> {
    const result = await this.client.call(
      "XAUTOCLAIM",
      this.config.streamKey,
      this.config.group,
      this.config.consumer,
      this.config.claimIdleMs,
      "0-0",
      "COUNT",
      this.config.batchSize,
    );
    if (!Array.isArray(result) || result.length < 2 || !Array.isArray(result[1])) {
      throw new Error("Quote exposure ledger XAUTOCLAIM returned malformed state");
    }
    return parseEntries(result[1]);
  }

  private async readNew(block: boolean): Promise<StreamEntry[]> {
    const args: Array<string | number> = [
      "GROUP", this.config.group, this.config.consumer, "COUNT", this.config.batchSize,
    ];
    if (block && this.config.blockMs > 0) args.push("BLOCK", this.config.blockMs);
    args.push("STREAMS", this.config.streamKey, ">");
    const result = await this.client.call("XREADGROUP", ...args);
    if (result === null) return [];
    if (!Array.isArray(result) || result.length !== 1 || !Array.isArray(result[0]) ||
        result[0].length !== 2 || result[0][0] !== this.config.streamKey || !Array.isArray(result[0][1])) {
      throw new Error("Quote exposure ledger XREADGROUP returned malformed state");
    }
    return parseEntries(result[0][1]);
  }

  private async ensureGroup(): Promise<void> {
    if (this.groupReady) return;
    try {
      await this.client.call(
        "XGROUP", "CREATE", this.config.streamKey, this.config.group, "0", "MKSTREAM",
      );
    } catch (error) {
      if (!errorMessage(error).includes("BUSYGROUP")) throw error;
    }
    this.groupReady = true;
  }

  private async ensureConnected(): Promise<void> {
    if (!this.client.connect || this.client.status === undefined || this.client.status === "ready") return;
    if (this.connectPromise) return this.connectPromise;
    if (this.client.status !== "wait" && this.client.status !== "end") return;
    this.connectPromise = this.client.connect().then(() => undefined).finally(() => {
      this.connectPromise = undefined;
    });
    return this.connectPromise;
  }

  private notifyMirrored(observation: QuoteExposureLedgerMirrorObservation): void {
    try { this.observer.recordLedgerMirrored(observation); } catch {}
  }

  private notifyError(): void {
    try { this.observer.recordLedgerMirrorError(); } catch {}
  }

  private notifyBacklog(backlog: number): void {
    try { this.observer.recordLedgerBacklog(backlog); } catch {}
  }
}

function parseEntries(value: unknown[]): StreamEntry[] {
  return value.map((raw) => {
    if (!Array.isArray(raw) || raw.length !== 2 || typeof raw[0] !== "string" ||
        !/^\d+-\d+$/.test(raw[0]) || !Array.isArray(raw[1]) || raw[1].length % 2 !== 0) {
      throw new Error("Quote exposure ledger stream entry is malformed");
    }
    const fields = new Map<string, string>();
    for (let index = 0; index < raw[1].length; index += 2) {
      const field = raw[1][index];
      const value = raw[1][index + 1];
      if (typeof field !== "string" || typeof value !== "string" || fields.has(field)) {
        throw new Error("Quote exposure ledger stream fields are malformed");
      }
      fields.set(field, value);
    }
    if (fields.size !== 3 || fields.get("schema_version") !== "1") {
      throw new Error("Quote exposure ledger stream schema is unsupported");
    }
    const operation = fields.get("operation");
    if (operation !== "reserve" && operation !== "release") {
      throw new Error("Quote exposure ledger stream operation is invalid");
    }
    const payload = fields.get("payload");
    if (!payload) throw new Error("Quote exposure ledger stream payload is missing");
    return { id: raw[0], operation, record: parseRedisQuoteExposureRecord(payload) };
  });
}

function normalizeConfig(config: QuoteExposureLedgerMirrorConfig): QuoteExposureLedgerMirrorConfig {
  assertRecord(config, "Quote exposure ledger mirror config");
  const fields = [
    "streamKey", "sourceEpoch", "group", "consumer", "batchSize", "blockMs",
    "claimIdleMs", "retryDelayMs", "cleanupLimit", "cleanupIntervalMs",
  ];
  if (Object.keys(config).some((field) => !fields.includes(field)) ||
      fields.some((field) => !Object.prototype.hasOwnProperty.call(config, field))) {
    throw new Error("Quote exposure ledger mirror config fields are invalid");
  }
  if (typeof config.streamKey !== "string" ||
      !/^rfq:\{[a-z0-9_-]{1,32}\}:[a-z0-9:_-]{1,64}$/.test(config.streamKey)) {
    throw new Error("Quote exposure ledger mirror streamKey is invalid");
  }
  if (typeof config.sourceEpoch !== "string" ||
      !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(config.sourceEpoch)) {
    throw new Error("Quote exposure ledger mirror sourceEpoch is invalid");
  }
  for (const field of ["group", "consumer"] as const) {
    if (typeof config[field] !== "string" || !/^[A-Za-z0-9_:-]{1,128}$/.test(config[field])) {
      throw new Error(`Quote exposure ledger mirror ${field} is invalid`);
    }
  }
  assertInteger(config.batchSize, 1, 1_000, "batchSize");
  assertInteger(config.blockMs, 0, 5_000, "blockMs");
  assertInteger(config.claimIdleMs, 1_000, 3_600_000, "claimIdleMs");
  assertInteger(config.retryDelayMs, 10, 60_000, "retryDelayMs");
  assertInteger(config.cleanupLimit, 1, 10_000, "cleanupLimit");
  assertInteger(config.cleanupIntervalMs, 1_000, 600_000, "cleanupIntervalMs");
  return { ...config };
}

function assertClient(client: unknown): asserts client is RedisQuoteExposureConsumerClient {
  assertRecord(client, "Quote exposure ledger mirror client");
  for (const method of ["call", "eval", "quit"] as const) {
    if (typeof client[method] !== "function") {
      throw new Error(`Quote exposure ledger mirror client.${method} must be a function`);
    }
  }
}

function assertObserver(observer: unknown): asserts observer is QuoteExposureLedgerMirrorObserver {
  assertRecord(observer, "Quote exposure ledger mirror observer");
  for (const method of ["recordLedgerMirrored", "recordLedgerMirrorError", "recordLedgerBacklog"] as const) {
    if (typeof observer[method] !== "function") {
      throw new Error(`Quote exposure ledger mirror observer.${method} must be a function`);
    }
  }
}

function assertProjectionBarrier(
  barrier: QuoteExposureProjectionBarrier | undefined,
): asserts barrier is QuoteExposureProjectionBarrier | undefined {
  if (barrier === undefined) return;
  assertRecord(barrier, "Quote exposure projection barrier");
  if (typeof barrier.awaitPreparedQuoteProjection !== "function") {
    throw new Error("Quote exposure projection barrier method is invalid");
  }
}

function assertLogger(logger: unknown): asserts logger is QuoteExposureLedgerMirrorLogger {
  assertRecord(logger, "Quote exposure ledger mirror logger");
  if (typeof logger.warn !== "function") throw new Error("Quote exposure ledger mirror logger.warn is invalid");
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function assertInteger(value: unknown, min: number, max: number, field: string): void {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`Quote exposure ledger mirror ${field} must be between ${min} and ${max}`);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readNowMilliseconds(provider: () => number): number {
  const value = provider();
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Quote exposure ledger mirror clock returned an invalid value");
  }
  return value;
}
