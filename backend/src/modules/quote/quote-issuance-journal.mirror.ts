import { PostgresQuoteIssuanceJournalSink } from "./postgres-quote-issuance-journal.sink.js";
import {
  parseRedisQuoteIssuanceEvent,
  type RedisQuoteIssuanceEvent,
  type RedisQuoteIssuanceEventType,
} from "./redis-quote-issuance.protocol.js";
import { markQuoteIssuanceProjectedScript } from "./redis-quote-issuance.scripts.js";

const acknowledgeAndDeleteScript = `
local acknowledged = redis.call("XACK", KEYS[1], ARGV[1], ARGV[2])
if acknowledged == 1 then redis.call("XDEL", KEYS[1], ARGV[2]) end
return {acknowledged, redis.call("XLEN", KEYS[1])}
`;

export interface RedisQuoteIssuanceConsumerClient {
  readonly status?: string;
  connect?: () => Promise<unknown>;
  disconnect?: () => void;
  call(command: string, ...args: Array<string | number>): Promise<unknown>;
  eval(script: string, numberOfKeys: number, ...args: Array<string | number>): Promise<unknown>;
  quit(): Promise<unknown>;
}

export interface QuoteIssuanceJournalMirrorConfig {
  streamKey: string;
  projectedKeyPrefix: string;
  projectionTtlMs: number;
  sourceEpoch: string;
  group: string;
  consumer: string;
  batchSize: number;
  blockMs: number;
  claimIdleMs: number;
  retryDelayMs: number;
}

export interface QuoteIssuanceJournalMirrorObservation {
  sourceStreamId: string;
  eventType: RedisQuoteIssuanceEventType;
  inserted: boolean;
  applied: boolean;
}

export interface QuoteIssuanceJournalMirrorObserver {
  recordIssuanceMirrored(observation: QuoteIssuanceJournalMirrorObservation): void;
  recordIssuanceMirrorError(): void;
  recordIssuanceBacklog(backlog: number): void;
}

export interface QuoteIssuanceJournalMirrorLogger {
  warn(fields: Readonly<Record<string, unknown>>, message: string): void;
}

interface StreamEntry {
  id: string;
  event: RedisQuoteIssuanceEvent;
}

const noopObserver: QuoteIssuanceJournalMirrorObserver = {
  recordIssuanceMirrored() {},
  recordIssuanceMirrorError() {},
  recordIssuanceBacklog() {},
};

const noopLogger: QuoteIssuanceJournalMirrorLogger = { warn() {} };

export class QuoteIssuanceJournalMirror {
  private readonly config: QuoteIssuanceJournalMirrorConfig;
  private readonly observer: QuoteIssuanceJournalMirrorObserver;
  private readonly logger: QuoteIssuanceJournalMirrorLogger;
  private connectPromise: Promise<void> | undefined;
  private loop: Promise<void> | undefined;
  private running = false;
  private groupReady = false;

  constructor(
    private readonly client: RedisQuoteIssuanceConsumerClient,
    private readonly sink: PostgresQuoteIssuanceJournalSink,
    config: QuoteIssuanceJournalMirrorConfig,
    observer: QuoteIssuanceJournalMirrorObserver = noopObserver,
    logger: QuoteIssuanceJournalMirrorLogger = noopLogger,
  ) {
    assertClient(client);
    if (typeof sink !== "object" || sink === null ||
        typeof sink.applyMirrored !== "function" || typeof sink.checkHealth !== "function") {
      throw new Error("Quote issuance journal mirror sink is invalid");
    }
    this.config = normalizeConfig(config);
    assertObserver(observer);
    assertLogger(logger);
    this.observer = observer;
    this.logger = logger;
  }

  async initialize(): Promise<void> {
    await this.ensureConnected();
    await this.ensureGroup();
    await this.sink.checkHealth();
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
    await this.ensureConnected();
    await this.ensureGroup();
    const claimed = await this.readClaimed();
    const entries = claimed.length > 0 ? claimed : await this.readNew(block);
    for (const entry of entries) {
      const sourceStreamId = `${this.config.sourceEpoch}:${entry.id}`;
      const result = await this.sink.applyMirrored(entry.event, sourceStreamId);
      if (entry.event.quote) {
        const marked = await this.client.eval(
          markQuoteIssuanceProjectedScript,
          1,
          `${this.config.projectedKeyPrefix}:${entry.event.quote.quoteId}`,
          entry.event.quote.stage,
          this.config.projectionTtlMs,
        );
        if (typeof marked !== "string" || projectionRank(marked) < projectionRank(entry.event.quote.stage)) {
          throw new Error(`Quote issuance journal projection marker failed for ${entry.event.quote.quoteId}`);
        }
      }
      const acknowledged = await this.client.eval(
        acknowledgeAndDeleteScript,
        1,
        this.config.streamKey,
        this.config.group,
        entry.id,
      );
      if (!Array.isArray(acknowledged) || acknowledged.length !== 2 || acknowledged[0] !== 1 ||
          !Number.isSafeInteger(acknowledged[1]) || Number(acknowledged[1]) < 0) {
        throw new Error(`Quote issuance journal mirror could not acknowledge ${entry.id}`);
      }
      this.notifyBacklog(Number(acknowledged[1]));
      this.notifyMirrored({ sourceStreamId, eventType: entry.event.eventType, ...result });
    }
    return entries.length;
  }

  private async runLoop(): Promise<void> {
    while (this.running) {
      try {
        await this.runOnce(true);
      } catch {
        this.notifyError();
        this.logger.warn(
          { code: "QUOTE_ISSUANCE_JOURNAL_MIRROR_FAILED" },
          "quote issuance journal mirror cycle failed",
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
      throw new Error("Quote issuance journal XAUTOCLAIM returned malformed state");
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
      throw new Error("Quote issuance journal XREADGROUP returned malformed state");
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

  private notifyMirrored(observation: QuoteIssuanceJournalMirrorObservation): void {
    try { this.observer.recordIssuanceMirrored(observation); } catch {}
  }

  private notifyError(): void {
    try { this.observer.recordIssuanceMirrorError(); } catch {}
  }

  private notifyBacklog(backlog: number): void {
    try { this.observer.recordIssuanceBacklog(backlog); } catch {}
  }
}

function parseEntries(value: unknown[]): StreamEntry[] {
  return value.map((raw) => {
    if (!Array.isArray(raw) || raw.length !== 2 || typeof raw[0] !== "string" ||
        !/^\d+-\d+$/.test(raw[0]) || !Array.isArray(raw[1]) || raw[1].length !== 6) {
      throw new Error("Quote issuance journal stream entry is malformed");
    }
    const fields = new Map<string, string>();
    for (let index = 0; index < raw[1].length; index += 2) {
      const field = raw[1][index];
      const content = raw[1][index + 1];
      if (typeof field !== "string" || typeof content !== "string" || fields.has(field)) {
        throw new Error("Quote issuance journal stream fields are malformed");
      }
      fields.set(field, content);
    }
    if (fields.size !== 3 || fields.get("schema_version") !== "1" ||
        !fields.has("event_type") || !fields.has("payload")) {
      throw new Error("Quote issuance journal stream schema is invalid");
    }
    const event = parseRedisQuoteIssuanceEvent(fields.get("payload")!);
    if (event.eventType !== fields.get("event_type")) {
      throw new Error("Quote issuance journal stream event type is invalid");
    }
    return { id: raw[0], event };
  });
}

function normalizeConfig(config: QuoteIssuanceJournalMirrorConfig): QuoteIssuanceJournalMirrorConfig {
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    throw new Error("Quote issuance journal mirror config must be an object");
  }
  const fields = [
    "streamKey", "projectedKeyPrefix", "projectionTtlMs", "sourceEpoch", "group", "consumer",
    "batchSize", "blockMs", "claimIdleMs", "retryDelayMs",
  ];
  if (Object.keys(config).some((field) => !fields.includes(field)) ||
      fields.some((field) => !Object.prototype.hasOwnProperty.call(config, field))) {
    throw new Error("Quote issuance journal mirror config fields are invalid");
  }
  for (const field of ["streamKey", "projectedKeyPrefix"] as const) {
    if (typeof config[field] !== "string" ||
        !/^rfq:\{[a-z0-9_-]{1,32}\}:[a-z0-9:_-]{1,64}$/.test(config[field])) {
      throw new Error(`Quote issuance journal mirror ${field} must use a bounded hash-tagged key`);
    }
  }
  for (const field of ["sourceEpoch", "group", "consumer"] as const) {
    if (typeof config[field] !== "string" || !/^[A-Za-z][A-Za-z0-9_:-]{0,127}$/.test(config[field])) {
      throw new Error(`Quote issuance journal mirror ${field} must be a safe identifier`);
    }
  }
  assertInteger(config.projectionTtlMs, 60_000, 604_800_000, "projectionTtlMs");
  assertInteger(config.batchSize, 1, 1_000, "batchSize");
  assertInteger(config.blockMs, 0, 5_000, "blockMs");
  assertInteger(config.claimIdleMs, 1_000, 3_600_000, "claimIdleMs");
  assertInteger(config.retryDelayMs, 10, 60_000, "retryDelayMs");
  return { ...config };
}

function assertInteger(value: unknown, min: number, max: number, field: string): void {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`Quote issuance journal mirror ${field} must be between ${min} and ${max}`);
  }
}

function assertClient(value: unknown): asserts value is RedisQuoteIssuanceConsumerClient {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Quote issuance journal mirror client must be an object");
  }
  for (const method of ["call", "eval", "quit"] as const) {
    if (typeof (value as Record<string, unknown>)[method] !== "function") {
      throw new Error(`Quote issuance journal mirror client.${method} must be a function`);
    }
  }
}

function assertObserver(value: unknown): asserts value is QuoteIssuanceJournalMirrorObserver {
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
      typeof (value as QuoteIssuanceJournalMirrorObserver).recordIssuanceMirrored !== "function" ||
      typeof (value as QuoteIssuanceJournalMirrorObserver).recordIssuanceMirrorError !== "function" ||
      typeof (value as QuoteIssuanceJournalMirrorObserver).recordIssuanceBacklog !== "function") {
    throw new Error("Quote issuance journal mirror observer is invalid");
  }
}

function assertLogger(value: unknown): asserts value is QuoteIssuanceJournalMirrorLogger {
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
      typeof (value as QuoteIssuanceJournalMirrorLogger).warn !== "function") {
    throw new Error("Quote issuance journal mirror logger is invalid");
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function projectionRank(stage: string): number {
  if (stage === "prepared") return 1;
  if (stage === "authorized") return 2;
  if (stage === "failed") return 3;
  if (stage === "finalized") return 4;
  return 0;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
