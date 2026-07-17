import { createHash } from "node:crypto";
import type { PostgresSignerAuditStore, SignerAuditEvent } from "./signer-audit.store.js";
import { assertSignerAuditEvent } from "./signer-audit.store.js";

const acknowledgeAndDeleteScript = `
local acknowledged = redis.call("XACK", KEYS[1], ARGV[1], ARGV[2])
if acknowledged == 1 then
  redis.call("XDEL", KEYS[1], ARGV[2])
end
return acknowledged
`;

export interface RedisSignerAuditConsumerClient {
  readonly status?: string;
  connect?: () => Promise<unknown>;
  disconnect?: () => void;
  call(command: string, ...args: Array<string | number>): Promise<unknown>;
  eval(script: string, numberOfKeys: number, ...args: Array<string | number>): Promise<unknown>;
  quit(): Promise<unknown>;
}

export interface SignerAuditMirrorConfig {
  streamKey: string;
  sourceEpoch: string;
  group: string;
  consumer: string;
  batchSize: number;
  blockMs: number;
  claimIdleMs: number;
  retryDelayMs: number;
}

export interface SignerAuditMirrorObservation {
  sourceStreamId: string;
  inserted: boolean;
}

export interface SignerAuditMirrorObserver {
  recordMirrored(observation: SignerAuditMirrorObservation): void;
  recordMirrorError(): void;
}

export interface SignerAuditMirrorLogger {
  warn(fields: Readonly<Record<string, unknown>>, message: string): void;
}

const noopObserver: SignerAuditMirrorObserver = {
  recordMirrored() {},
  recordMirrorError() {},
};

const noopLogger: SignerAuditMirrorLogger = {
  warn() {},
};

interface StreamEntry {
  id: string;
  event: SignerAuditEvent;
}

export class SignerAuditMirror {
  private readonly config: SignerAuditMirrorConfig;
  private readonly observer: SignerAuditMirrorObserver;
  private readonly logger: SignerAuditMirrorLogger;
  private connectPromise: Promise<void> | undefined;
  private loop: Promise<void> | undefined;
  private running = false;
  private groupReady = false;

  constructor(
    private readonly client: RedisSignerAuditConsumerClient,
    private readonly sink: PostgresSignerAuditStore,
    config: SignerAuditMirrorConfig,
    observer: SignerAuditMirrorObserver = noopObserver,
    logger: SignerAuditMirrorLogger = noopLogger,
  ) {
    assertClient(client);
    if (typeof sink !== "object" || sink === null ||
        typeof sink.appendMirrored !== "function" || typeof sink.checkHealth !== "function") {
      throw new Error("Signer audit mirror sink must support mirrored append and health checks");
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
    try {
      await this.client.quit();
    } catch {
      this.client.disconnect?.();
    }
  }

  async runOnce(block = false): Promise<number> {
    await this.ensureConnected();
    await this.ensureGroup();
    const claimed = await this.readClaimed();
    const entries = claimed.length > 0 ? claimed : await this.readNew(block);
    for (const entry of entries) {
      const sourceStreamId = `${this.config.sourceEpoch}:${entry.id}`;
      const inserted = await this.sink.appendMirrored(entry.event, sourceStreamId);
      const acknowledged = await this.client.eval(
        acknowledgeAndDeleteScript,
        1,
        this.config.streamKey,
        this.config.group,
        entry.id,
      );
      if (acknowledged !== 1) {
        throw new Error(`Signer audit mirror could not acknowledge ${entry.id}`);
      }
      this.notifyMirrored({ sourceStreamId, inserted });
    }
    return entries.length;
  }

  private async runLoop(): Promise<void> {
    while (this.running) {
      try {
        await this.runOnce(true);
      } catch (error) {
        this.notifyError();
        this.logger.warn({ code: "SIGNER_AUDIT_MIRROR_FAILED" }, "signer audit mirror cycle failed");
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
      throw new Error("Signer audit XAUTOCLAIM returned a malformed result");
    }
    return parseEntries(result[1]);
  }

  private async readNew(block: boolean): Promise<StreamEntry[]> {
    const args: Array<string | number> = [
      "GROUP",
      this.config.group,
      this.config.consumer,
      "COUNT",
      this.config.batchSize,
    ];
    if (block && this.config.blockMs > 0) args.push("BLOCK", this.config.blockMs);
    args.push("STREAMS", this.config.streamKey, ">");
    const result = await this.client.call("XREADGROUP", ...args);
    if (result === null) return [];
    if (!Array.isArray(result) || result.length !== 1 || !Array.isArray(result[0]) ||
        result[0].length !== 2 || result[0][0] !== this.config.streamKey || !Array.isArray(result[0][1])) {
      throw new Error("Signer audit XREADGROUP returned a malformed result");
    }
    return parseEntries(result[0][1]);
  }

  private async ensureGroup(): Promise<void> {
    if (this.groupReady) return;
    try {
      await this.client.call(
        "XGROUP",
        "CREATE",
        this.config.streamKey,
        this.config.group,
        "0",
        "MKSTREAM",
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

  private notifyMirrored(observation: SignerAuditMirrorObservation): void {
    try {
      this.observer.recordMirrored(observation);
    } catch {
      // Metrics cannot invalidate an acknowledged, mirrored event.
    }
  }

  private notifyError(): void {
    try {
      this.observer.recordMirrorError();
    } catch {
      // Preserve the mirror error for retry.
    }
  }
}

function parseEntries(value: unknown[]): StreamEntry[] {
  return value.map((raw) => {
    if (!Array.isArray(raw) || raw.length !== 2 || typeof raw[0] !== "string" ||
        !/^\d+-\d+$/.test(raw[0]) || !Array.isArray(raw[1]) || raw[1].length % 2 !== 0) {
      throw new Error("Signer audit stream entry is malformed");
    }
    const fields = new Map<string, string>();
    for (let index = 0; index < raw[1].length; index += 2) {
      const field = raw[1][index];
      const fieldValue = raw[1][index + 1];
      if (typeof field !== "string" || typeof fieldValue !== "string" || fields.has(field)) {
        throw new Error("Signer audit stream fields are malformed");
      }
      fields.set(field, fieldValue);
    }
    if (fields.size !== 3 || fields.get("schema_version") !== "1") {
      throw new Error("Signer audit stream schema version is unsupported");
    }
    const payload = fields.get("payload");
    const eventKey = fields.get("event_key");
    if (!payload || !eventKey || !/^[0-9a-f]{64}$/.test(eventKey) ||
        createHash("sha256").update(payload).digest("hex") !== eventKey) {
      throw new Error("Signer audit stream payload integrity check failed");
    }
    let event: unknown;
    try {
      event = JSON.parse(payload);
    } catch {
      throw new Error("Signer audit stream payload must be valid JSON");
    }
    assertSignerAuditEvent(event);
    return { id: raw[0], event };
  });
}

function normalizeConfig(config: SignerAuditMirrorConfig): SignerAuditMirrorConfig {
  assertRecord(config, "Signer audit mirror config");
  const fields = [
    "streamKey",
    "sourceEpoch",
    "group",
    "consumer",
    "batchSize",
    "blockMs",
    "claimIdleMs",
    "retryDelayMs",
  ];
  if (Object.keys(config).some((field) => !fields.includes(field)) ||
      fields.some((field) => !Object.prototype.hasOwnProperty.call(config, field))) {
    throw new Error("Signer audit mirror config fields are invalid");
  }
  if (typeof config.streamKey !== "string" ||
      !/^rfq:\{[a-z0-9_-]{1,32}\}:[a-z0-9:_-]{1,64}$/.test(config.streamKey)) {
    throw new Error("Signer audit mirror streamKey is invalid");
  }
  if (typeof config.sourceEpoch !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(config.sourceEpoch)) {
    throw new Error("Signer audit mirror sourceEpoch must be a safe epoch identifier");
  }
  for (const [field, value] of [["group", config.group], ["consumer", config.consumer]] as const) {
    if (typeof value !== "string" || !/^[A-Za-z0-9_:-]{1,128}$/.test(value)) {
      throw new Error(`Signer audit mirror ${field} must be a safe identifier`);
    }
  }
  assertInteger(config.batchSize, 1, 1_000, "batchSize");
  assertInteger(config.blockMs, 0, 5_000, "blockMs");
  assertInteger(config.claimIdleMs, 1_000, 3_600_000, "claimIdleMs");
  assertInteger(config.retryDelayMs, 10, 60_000, "retryDelayMs");
  return { ...config };
}

function assertClient(client: unknown): asserts client is RedisSignerAuditConsumerClient {
  assertRecord(client, "Signer audit mirror client");
  for (const method of ["call", "eval", "quit"] as const) {
    if (typeof (client as Record<string, unknown>)[method] !== "function") {
      throw new Error(`Signer audit mirror client.${method} must be a function`);
    }
  }
}

function assertObserver(observer: unknown): asserts observer is SignerAuditMirrorObserver {
  assertRecord(observer, "Signer audit mirror observer");
  for (const method of ["recordMirrored", "recordMirrorError"] as const) {
    if (typeof (observer as Record<string, unknown>)[method] !== "function") {
      throw new Error(`Signer audit mirror observer.${method} must be a function`);
    }
  }
}

function assertLogger(logger: unknown): asserts logger is SignerAuditMirrorLogger {
  assertRecord(logger, "Signer audit mirror logger");
  if (typeof (logger as Record<string, unknown>).warn !== "function") {
    throw new Error("Signer audit mirror logger.warn must be a function");
  }
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function assertInteger(value: unknown, min: number, max: number, field: string): void {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`Signer audit mirror ${field} must be between ${min} and ${max}`);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
