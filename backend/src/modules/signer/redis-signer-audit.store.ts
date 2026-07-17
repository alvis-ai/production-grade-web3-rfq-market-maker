import { createHash } from "node:crypto";
import type { SignerAuditEvent, SignerAuditStore } from "./signer-audit.store.js";
import { assertSignerAuditEvent } from "./signer-audit.store.js";

const appendScript = `
local existing = redis.call("GET", KEYS[2])
if existing then
  return {1, existing, redis.call("XLEN", KEYS[1]), 1}
end
local backlog = redis.call("XLEN", KEYS[1])
if backlog >= tonumber(ARGV[1]) then
  return {0, "", backlog, 0}
end
local entry_id = redis.call(
  "XADD", KEYS[1], "*",
  "schema_version", "1",
  "event_key", ARGV[2],
  "payload", ARGV[3]
)
redis.call("SET", KEYS[2], entry_id, "PX", ARGV[4], "NX")
return {1, entry_id, backlog + 1, 0}
`;

export interface RedisSignerAuditClient {
  readonly status?: string;
  connect?: () => Promise<unknown>;
  disconnect?: () => void;
  eval(script: string, numberOfKeys: number, ...args: Array<string | number>): Promise<unknown>;
  ping(): Promise<unknown>;
  info(section: string): Promise<unknown>;
  xlen(key: string): Promise<unknown>;
  wait(replicas: number, timeoutMs: number): Promise<unknown>;
  quit(): Promise<unknown>;
}

export interface RedisSignerAuditStoreConfig {
  streamKey: string;
  maxBacklog: number;
  dedupeTtlMs: number;
  minReplicaAcks: number;
  replicaAckTimeoutMs: number;
  requireAof: boolean;
}

export interface RedisSignerAuditAppendObservation {
  backlog: number;
  duplicate: boolean;
}

export interface RedisSignerAuditObserver {
  recordAppend(observation: RedisSignerAuditAppendObservation): void;
  recordAppendFailure(reason: "backlog_full" | "replica_ack"): void;
  recordBacklog(backlog: number): void;
}

const noopObserver: RedisSignerAuditObserver = {
  recordAppend() {},
  recordAppendFailure() {},
  recordBacklog() {},
};

export class RedisSignerAuditStore implements SignerAuditStore {
  private readonly config: RedisSignerAuditStoreConfig;
  private readonly observer: RedisSignerAuditObserver;
  private connectPromise: Promise<void> | undefined;

  constructor(
    private readonly client: RedisSignerAuditClient,
    config: RedisSignerAuditStoreConfig,
    observer: RedisSignerAuditObserver = noopObserver,
  ) {
    assertRedisSignerAuditClient(client);
    this.config = normalizeConfig(config);
    assertObserver(observer);
    this.observer = observer;
  }

  async append(event: SignerAuditEvent): Promise<void> {
    assertSignerAuditEvent(event);
    await this.ensureConnected();
    const payload = JSON.stringify(event);
    const eventKey = createHash("sha256").update(payload).digest("hex");
    const dedupeKey = `${this.config.streamKey}:dedupe:${eventKey}`;
    const result = await this.client.eval(
      appendScript,
      2,
      this.config.streamKey,
      dedupeKey,
      this.config.maxBacklog,
      eventKey,
      payload,
      this.config.dedupeTtlMs,
    );
    const append = parseAppendResult(result);
    if (!append.accepted) {
      this.notifyFailure("backlog_full");
      throw new Error(`Redis signer audit backlog reached ${this.config.maxBacklog}`);
    }

    if (this.config.minReplicaAcks > 0) {
      const acknowledgements = await this.client.wait(
        this.config.minReplicaAcks,
        this.config.replicaAckTimeoutMs,
      );
      if (!Number.isSafeInteger(acknowledgements) ||
          (acknowledgements as number) < this.config.minReplicaAcks) {
        this.notifyFailure("replica_ack");
        throw new Error("Redis signer audit write did not reach the required replicas");
      }
    }
    this.notifyAppend({ backlog: append.backlog, duplicate: append.duplicate });
  }

  async checkHealth(): Promise<void> {
    await this.ensureConnected();
    if (await this.client.ping() !== "PONG") {
      throw new Error("Redis signer audit health check returned an unexpected response");
    }
    if (this.config.requireAof) assertAofHealth(await this.client.info("persistence"));
    const backlog = parseNonNegativeInteger(await this.client.xlen(this.config.streamKey), "backlog");
    this.notifyBacklog(backlog);
    if (backlog >= this.config.maxBacklog) {
      throw new Error(`Redis signer audit backlog reached ${this.config.maxBacklog}`);
    }
  }

  async close(): Promise<void> {
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

  private async ensureConnected(): Promise<void> {
    if (!this.client.connect || this.client.status === undefined || this.client.status === "ready") return;
    if (this.connectPromise) return this.connectPromise;
    if (this.client.status !== "wait" && this.client.status !== "end") return;
    this.connectPromise = this.client.connect().then(() => undefined).finally(() => {
      this.connectPromise = undefined;
    });
    return this.connectPromise;
  }

  private notifyAppend(observation: RedisSignerAuditAppendObservation): void {
    try {
      this.observer.recordAppend(observation);
    } catch {
      // Observability cannot invalidate an audit write that already met durability policy.
    }
  }

  private notifyFailure(reason: "backlog_full" | "replica_ack"): void {
    try {
      this.observer.recordAppendFailure(reason);
    } catch {
      // Preserve the fail-closed audit error.
    }
  }

  private notifyBacklog(backlog: number): void {
    try {
      this.observer.recordBacklog(backlog);
    } catch {
      // Health checks remain based on Redis state, not observer state.
    }
  }
}

function normalizeConfig(config: RedisSignerAuditStoreConfig): RedisSignerAuditStoreConfig {
  assertRecord(config, "Redis signer audit config");
  const fields = [
    "streamKey",
    "maxBacklog",
    "dedupeTtlMs",
    "minReplicaAcks",
    "replicaAckTimeoutMs",
    "requireAof",
  ];
  if (Object.keys(config).some((field) => !fields.includes(field)) ||
      fields.some((field) => !Object.prototype.hasOwnProperty.call(config, field))) {
    throw new Error("Redis signer audit config fields are invalid");
  }
  if (typeof config.streamKey !== "string" ||
      !/^rfq:\{[a-z0-9_-]{1,32}\}:[a-z0-9:_-]{1,64}$/.test(config.streamKey)) {
    throw new Error("Redis signer audit streamKey must use a bounded rfq:{hash-tag}: key");
  }
  assertInteger(config.maxBacklog, 1, 1_000_000, "maxBacklog");
  assertInteger(config.dedupeTtlMs, 60_000, 604_800_000, "dedupeTtlMs");
  assertInteger(config.minReplicaAcks, 0, 5, "minReplicaAcks");
  assertInteger(config.replicaAckTimeoutMs, 1, 5_000, "replicaAckTimeoutMs");
  if (typeof config.requireAof !== "boolean") {
    throw new Error("Redis signer audit requireAof must be a boolean");
  }
  return { ...config };
}

function parseAppendResult(value: unknown): {
  accepted: boolean;
  entryId: string;
  backlog: number;
  duplicate: boolean;
} {
  if (!Array.isArray(value) || value.length !== 4) {
    throw new Error("Redis signer audit append returned a malformed result");
  }
  const [accepted, entryId, backlog, duplicate] = value;
  if ((accepted !== 0 && accepted !== 1) || typeof entryId !== "string" ||
      !Number.isSafeInteger(backlog) || backlog < 0 || (duplicate !== 0 && duplicate !== 1) ||
      (accepted === 1 && !/^\d+-\d+$/.test(entryId)) || (accepted === 0 && entryId !== "")) {
    throw new Error("Redis signer audit append returned invalid values");
  }
  return { accepted: accepted === 1, entryId, backlog, duplicate: duplicate === 1 };
}

function parseNonNegativeInteger(value: unknown, field: string): number {
  const parsed = typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(parsed) || (parsed as number) < 0) {
    throw new Error(`Redis signer audit ${field} must be a non-negative integer`);
  }
  return parsed as number;
}

function assertRedisSignerAuditClient(client: unknown): asserts client is RedisSignerAuditClient {
  assertRecord(client, "Redis signer audit client");
  for (const method of ["eval", "ping", "info", "xlen", "wait", "quit"] as const) {
    if (typeof (client as Record<string, unknown>)[method] !== "function") {
      throw new Error(`Redis signer audit client.${method} must be a function`);
    }
  }
}

function assertAofHealth(value: unknown): void {
  if (typeof value !== "string" || !/(?:^|\r?\n)aof_enabled:1(?:\r?\n|$)/.test(value) ||
      !/(?:^|\r?\n)aof_last_write_status:ok(?:\r?\n|$)/.test(value)) {
    throw new Error("Redis signer audit requires healthy AOF persistence");
  }
}

function assertObserver(observer: unknown): asserts observer is RedisSignerAuditObserver {
  assertRecord(observer, "Redis signer audit observer");
  for (const method of ["recordAppend", "recordAppendFailure", "recordBacklog"] as const) {
    if (typeof (observer as Record<string, unknown>)[method] !== "function") {
      throw new Error(`Redis signer audit observer.${method} must be a function`);
    }
  }
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function assertInteger(value: unknown, min: number, max: number, field: string): void {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`Redis signer audit ${field} must be between ${min} and ${max}`);
  }
}
