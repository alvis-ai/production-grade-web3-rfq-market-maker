import { createHash } from "node:crypto";
import { Redis } from "ioredis";
import { keccak256 } from "viem";
import { normalizeRedisUrl, type RedisUrlPolicy } from "../../shared/redis/redis-url.js";
import { RedisLuaScript } from "../../shared/redis/redis-lua-script.js";
import type { FinalizeQuoteIssuanceInput } from "../quote/quote-issuance.store.js";
import { assertQuoteIssuanceFinalization } from "../quote/postgres-quote-issuance.store.js";
import { parseRedisQuoteIssuanceRecord } from "../quote/redis-quote-issuance.protocol.js";
import { assertSignerAuditEvent, type SignerAuditEvent } from "./signer-audit.store.js";
import {
  quoteFinalizationHash,
  quoteFinalizationPayload,
  quoteSigningAuthorizationHash,
  quoteSigningAuthorizationHashFromFinalization,
} from "./signer-quote-commit.js";
import {
  assertAuthorizedSignQuoteInput,
  type AuthorizedSignQuoteInput,
} from "./signer.service.js";

export const commitSignedQuoteScript = `
local epoch = redis.call("GET", KEYS[7])
if epoch ~= ARGV[16] then return {0, "epoch_mismatch", 0, 0, "", ""} end
local current_json = redis.call("GET", KEYS[1])
if not current_json then return {0, "quote_missing", 0, 0, "", ""} end
local current = cjson.decode(current_json)
if current.quoteId ~= ARGV[1] or current.principalId ~= ARGV[2] then
  return {0, "quote_conflict", 0, 0, "", ""}
end
if current.authorization == nil or current.authorization.signingAuthorizationHash ~= ARGV[17] then
  return {0, "signing_authorization_conflict", 0, 0, "", ""}
end
if current.finalization ~= nil then
  if current.finalizationHash ~= ARGV[3] then
    return {0, "finalization_conflict", 0, 0, "", ""}
  end
  if current.signerAuditEventKey ~= nil and current.signerAuditEventKey ~= ARGV[13] then
    return {0, "audit_conflict", 0, 0, "", ""}
  end
  return {2, current.finalizationHash, redis.call("XLEN", KEYS[4]), redis.call("XLEN", KEYS[5]), "", ""}
end
if current.stage ~= "authorized" or current.authorization.record.decision ~= "approved" then
  return {0, "authorization_missing", 0, 0, "", ""}
end
local audit = cjson.decode(ARGV[14])
if audit.outcome ~= "success" or audit.quoteId ~= current.quoteId
   or audit.snapshotId ~= current.preparation.requestedQuote.snapshotId
   or audit.riskDecisionId ~= current.authorization.record.riskDecisionId
   or audit.riskPolicyVersion ~= current.authorization.record.policyVersion then
  return {0, "authorization_conflict", 0, 0, "", ""}
end
local issuance_backlog = redis.call("XLEN", KEYS[4])
if issuance_backlog >= tonumber(ARGV[6]) then
  return {0, "issuance_backlog_full", issuance_backlog, 0, "", ""}
end
local audit_backlog = redis.call("XLEN", KEYS[5])
if audit_backlog >= tonumber(ARGV[12]) then
  return {0, "audit_backlog_full", issuance_backlog, audit_backlog, "", ""}
end
if redis.call("GET", KEYS[6]) then
  return {0, "orphaned_audit_dedupe", issuance_backlog, audit_backlog, "", ""}
end
local idempotency = nil
if ARGV[7] == "1" then
  local idem_json = redis.call("GET", KEYS[2])
  if not idem_json then
    return {0, "idempotency_missing", issuance_backlog, audit_backlog, "", ""}
  end
  idempotency = cjson.decode(idem_json)
  if idempotency.state ~= "processing" or idempotency.principalId ~= ARGV[2]
     or idempotency.requestHash ~= ARGV[8] or idempotency.ownerToken ~= ARGV[9]
     or idempotency.quoteId ~= ARGV[1] then
    return {0, "idempotency_ownership", issuance_backlog, audit_backlog, "", ""}
  end
end
current.stage = "finalized"
current.finalizationHash = ARGV[3]
current.finalization = cjson.decode(ARGV[4])
current.signerAuditEventKey = ARGV[13]
current.updatedAtMs = math.max(tonumber(ARGV[5]), tonumber(current.updatedAtMs))
local updated = cjson.encode(current)
if idempotency ~= nil then
  idempotency.state = "succeeded"
  idempotency.updatedAtMs = math.max(tonumber(ARGV[5]), tonumber(idempotency.updatedAtMs))
  idempotency.ownerToken = nil
  idempotency.leaseExpiresAtMs = nil
  idempotency.response = current.finalization.response
  redis.call("SET", KEYS[2], cjson.encode(idempotency), "PX", ARGV[10])
end
local issuance_event = {
  schemaVersion = 1,
  eventType = "finalized",
  occurredAtMs = current.updatedAtMs,
  quote = current
}
if idempotency ~= nil then issuance_event.idempotency = idempotency end
redis.call("SET", KEYS[1], updated, "PX", ARGV[11])
redis.call("SET", KEYS[3], ARGV[1], "PX", ARGV[11])
local issuance_stream_id = redis.call(
  "XADD", KEYS[4], "*",
  "schema_version", "1",
  "event_type", "finalized",
  "payload", cjson.encode(issuance_event)
)
local audit_stream_id = redis.call(
  "XADD", KEYS[5], "*",
  "schema_version", "1",
  "event_key", ARGV[13],
  "payload", ARGV[14]
)
redis.call("SET", KEYS[6], audit_stream_id, "PX", ARGV[15], "NX")
return {1, ARGV[3], issuance_backlog + 1, audit_backlog + 1, issuance_stream_id, audit_stream_id}
`;

const commitSignedQuoteCommand = new RedisLuaScript(commitSignedQuoteScript);

export interface RedisSignerQuoteCommitClient {
  readonly status?: string;
  connect?: () => Promise<unknown>;
  disconnect?: () => void;
  eval(script: string, numberOfKeys: number, ...args: Array<string | number>): Promise<unknown>;
  get(key: string): Promise<unknown>;
  ping(): Promise<unknown>;
  info(section: string): Promise<unknown>;
  xlen(key: string): Promise<unknown>;
  wait(replicas: number, timeoutMs: number): Promise<unknown>;
  quit(): Promise<unknown>;
}

export interface RedisSignerQuoteCommitConfig {
  quoteKeyPrefix: string;
  ledgerEpoch: string;
  issuanceMaxBacklog: number;
  hotStateTtlMs: number;
  idempotencyTtlMs: number;
  auditStreamKey: string;
  auditMaxBacklog: number;
  auditDedupeTtlMs: number;
  minReplicaAcks: number;
  replicaAckTimeoutMs: number;
  requireAof: boolean;
}

export interface SignerQuoteCommitEvidence {
  finalizationHash: string;
  duplicate: boolean;
}

export interface SignerQuoteCommitStore {
  assertAuthorized(input: AuthorizedSignQuoteInput): Promise<void>;
  commit(event: SignerAuditEvent, finalization: FinalizeQuoteIssuanceInput): Promise<SignerQuoteCommitEvidence>;
  checkHealth(): Promise<void>;
  close(): Promise<void>;
}

export interface SignerQuoteCommitObservation {
  duplicate: boolean;
  issuanceBacklog: number;
  auditBacklog: number;
}

export interface SignerQuoteCommitObserver {
  recordQuoteCommit(observation: SignerQuoteCommitObservation): void;
  recordQuoteCommitFailure(reason: "state_invalid" | "backlog_full" | "replica_ack"): void;
}

const noopObserver: SignerQuoteCommitObserver = {
  recordQuoteCommit() {},
  recordQuoteCommitFailure() {},
};

export function createRedisSignerQuoteCommitClient(
  redisUrl: string,
  policy: RedisUrlPolicy = {},
): RedisSignerQuoteCommitClient {
  const normalizedUrl = normalizeRedisUrl(redisUrl, policy);
  return new Redis(normalizedUrl, {
    connectTimeout: 2_000,
    enableOfflineQueue: false,
    enableReadyCheck: true,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy(attempt: number) {
      return attempt <= 3 ? Math.min(100 * 2 ** (attempt - 1), 1_000) : null;
    },
  }) as unknown as RedisSignerQuoteCommitClient;
}

export class RedisSignerQuoteCommitStore implements SignerQuoteCommitStore {
  private readonly config: RedisSignerQuoteCommitConfig;
  private connectPromise: Promise<void> | undefined;

  constructor(
    private readonly client: RedisSignerQuoteCommitClient,
    config: RedisSignerQuoteCommitConfig,
    private readonly observer: SignerQuoteCommitObserver = noopObserver,
    private readonly nowMilliseconds: () => number = Date.now,
  ) {
    assertClient(client);
    this.config = normalizeRedisSignerQuoteCommitConfig(config);
    assertObserver(observer);
    if (typeof nowMilliseconds !== "function") {
      throw new Error("Redis signer quote commit clock must be a function");
    }
  }

  async assertAuthorized(input: AuthorizedSignQuoteInput): Promise<void> {
    assertAuthorizedSignQuoteInput(input);
    if (!input.commit) {
      throw new Error("Redis signer quote authorization requires a commit context");
    }
    await this.ensureConnected();
    const payload = await this.client.get(this.key(`quote:${input.quoteId}`));
    if (typeof payload !== "string") {
      throw new Error("Redis signer quote authorization is missing");
    }
    const record = parseRedisQuoteIssuanceRecord(payload);
    const request = record.preparation.requestedQuote.request;
    const authorization = record.authorization;
    const signingAuthorizationHash = quoteSigningAuthorizationHash(input, input.commit);
    if (record.stage !== "authorized" || !authorization || !authorization.signingAuthorization ||
        record.quoteId !== input.quoteId || record.principalId !== input.commit.principalId ||
        record.preparation.requestedQuote.snapshotId !== input.snapshotId ||
        request.chainId !== input.quote.chainId || request.user.toLowerCase() !== input.quote.user.toLowerCase() ||
        request.tokenIn.toLowerCase() !== input.quote.tokenIn.toLowerCase() ||
        request.tokenOut.toLowerCase() !== input.quote.tokenOut.toLowerCase() ||
        request.amountIn !== input.quote.amountIn || request.slippageBps !== input.commit.slippageBps ||
        authorization.input.quoteId !== input.quoteId ||
        authorization.input.decision.status !== "approved" ||
        authorization.input.decision.policyVersion !== input.riskPolicyVersion ||
        authorization.record.quoteId !== input.quoteId ||
        authorization.record.riskDecisionId !== input.riskDecisionId ||
        authorization.record.decision !== "approved" ||
        authorization.record.policyVersion !== input.riskPolicyVersion ||
        input.commit.riskPolicyVersion !== input.riskPolicyVersion ||
        authorization.signingAuthorizationHash !== signingAuthorizationHash ||
        quoteSigningAuthorizationHash(
          authorization.signingAuthorization,
          authorization.signingAuthorization.commit,
        ) !== signingAuthorizationHash) {
      throw new Error("Redis signer quote authorization does not match the signing request");
    }
  }

  async commit(
    event: SignerAuditEvent,
    finalization: FinalizeQuoteIssuanceInput,
  ): Promise<SignerQuoteCommitEvidence> {
    assertSignerAuditEvent(event);
    assertQuoteIssuanceFinalization(finalization);
    assertMatchingCommit(event, finalization);
    await this.ensureConnected();
    const now = this.now();
    const payload = quoteFinalizationPayload(finalization);
    const finalizationHash = quoteFinalizationHash(finalization);
    const auditPayload = JSON.stringify(event);
    const auditEventKey = digest(auditPayload);
    const quote = finalization.signedQuote.quote;
    const idempotencyKey = finalization.idempotency
      ? this.idempotencyKey(finalization.idempotency.principalId, finalization.idempotency.key)
      : this.key(`idempotency:none:${finalization.signedQuote.quoteId}`);
    const result = await commitSignedQuoteCommand.execute(
      this.client,
      7,
      this.key(`quote:${finalization.signedQuote.quoteId}`),
      idempotencyKey,
      this.key(`nonce:${digest(`${quote.chainId}:${quote.user.toLowerCase()}:${quote.nonce}`)}`),
      this.key("events"),
      this.config.auditStreamKey,
      `${this.config.auditStreamKey}:dedupe:${auditEventKey}`,
      this.key("epoch"),
      finalization.signedQuote.quoteId,
      finalization.signedQuote.principalId,
      finalizationHash,
      JSON.stringify(payload),
      now,
      this.config.issuanceMaxBacklog,
      finalization.idempotency ? "1" : "0",
      finalization.idempotency?.requestHash ?? "",
      finalization.idempotency?.ownerToken ?? "",
      this.config.idempotencyTtlMs,
      this.config.hotStateTtlMs,
      this.config.auditMaxBacklog,
      auditEventKey,
      auditPayload,
      this.config.auditDedupeTtlMs,
      this.config.ledgerEpoch,
      quoteSigningAuthorizationHashFromFinalization(finalization),
    );
    const commit = parseCommitResult(result);
    if (commit.code !== 1 && commit.code !== 2) {
      this.notifyFailure(commit.reason.includes("backlog") ? "backlog_full" : "state_invalid");
      throw new Error(`Redis signer quote commit failed: ${commit.reason}`);
    }
    if (commit.finalizationHash !== finalizationHash) {
      this.notifyFailure("state_invalid");
      throw new Error("Redis signer quote commit returned conflicting finalization evidence");
    }
    await this.requireReplicaAcknowledgements();
    const observation = {
      duplicate: commit.code === 2,
      issuanceBacklog: commit.issuanceBacklog,
      auditBacklog: commit.auditBacklog,
    };
    try { this.observer.recordQuoteCommit(observation); } catch {}
    return { finalizationHash, duplicate: observation.duplicate };
  }

  async checkHealth(): Promise<void> {
    await this.ensureConnected();
    if (await this.client.ping() !== "PONG") {
      throw new Error("Redis signer quote commit health check returned an unexpected response");
    }
    if (await this.client.get(this.key("epoch")) !== this.config.ledgerEpoch) {
      throw new Error("Redis signer quote commit ledger epoch does not match runtime configuration");
    }
    if (this.config.requireAof) assertAofHealth(await this.client.info("persistence"));
    const issuanceBacklog = parseNonNegativeInteger(await this.client.xlen(this.key("events")), "issuance backlog");
    const auditBacklog = parseNonNegativeInteger(await this.client.xlen(this.config.auditStreamKey), "audit backlog");
    if (issuanceBacklog >= this.config.issuanceMaxBacklog || auditBacklog >= this.config.auditMaxBacklog) {
      throw new Error("Redis signer quote commit backlog reached its configured limit");
    }
  }

  async close(): Promise<void> {
    if (this.client.status === "wait" || this.client.status === "end") {
      this.client.disconnect?.();
      return;
    }
    try { await this.client.quit(); } catch { this.client.disconnect?.(); }
  }

  private key(suffix: string): string {
    return `${this.config.quoteKeyPrefix}:${suffix}`;
  }

  private idempotencyKey(principalId: string, key: string): string {
    return this.key(`idempotency:${digest(`${principalId}\u0000${key}`)}`);
  }

  private now(): number {
    const value = this.nowMilliseconds();
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error("Redis signer quote commit clock returned an invalid timestamp");
    }
    return value;
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

  private async requireReplicaAcknowledgements(): Promise<void> {
    if (this.config.minReplicaAcks === 0) return;
    const acknowledgements = await this.client.wait(
      this.config.minReplicaAcks,
      this.config.replicaAckTimeoutMs,
    );
    if (!Number.isSafeInteger(acknowledgements) ||
        (acknowledgements as number) < this.config.minReplicaAcks) {
      this.notifyFailure("replica_ack");
      throw new Error("Redis signer quote commit did not reach the required replicas");
    }
  }

  private notifyFailure(reason: Parameters<SignerQuoteCommitObserver["recordQuoteCommitFailure"]>[0]): void {
    try { this.observer.recordQuoteCommitFailure(reason); } catch {}
  }
}

function assertMatchingCommit(event: SignerAuditEvent, finalization: FinalizeQuoteIssuanceInput): void {
  const signed = finalization.signedQuote;
  if (event.outcome !== "success" || event.quoteId !== signed.quoteId ||
      event.snapshotId !== signed.snapshotId || event.riskDecisionId !== `rd_${signed.quoteId}` ||
      event.riskPolicyVersion !== signed.riskPolicyVersion || event.chainId !== signed.quote.chainId ||
      event.deadline !== signed.quote.deadline ||
      event.signatureHash?.toLowerCase() !== keccak256(signed.signature).toLowerCase()) {
    throw new Error("Signer audit event does not match quote finalization");
  }
}

export function normalizeRedisSignerQuoteCommitConfig(
  config: RedisSignerQuoteCommitConfig,
): RedisSignerQuoteCommitConfig {
  assertRecord(config, "Redis signer quote commit config");
  const fields = [
    "quoteKeyPrefix", "ledgerEpoch", "issuanceMaxBacklog", "hotStateTtlMs", "idempotencyTtlMs",
    "auditStreamKey", "auditMaxBacklog", "auditDedupeTtlMs", "minReplicaAcks",
    "replicaAckTimeoutMs", "requireAof",
  ];
  if (Object.keys(config).length !== fields.length ||
      fields.some((field) => !Object.prototype.hasOwnProperty.call(config, field))) {
    throw new Error("Redis signer quote commit config fields are invalid");
  }
  if (typeof config.quoteKeyPrefix !== "string" ||
      !/^rfq:\{[a-z0-9_-]{1,32}\}:[a-z0-9:_-]{1,48}$/.test(config.quoteKeyPrefix)) {
    throw new Error("Redis signer quote commit quoteKeyPrefix is invalid");
  }
  if (typeof config.auditStreamKey !== "string" ||
      !/^rfq:\{[a-z0-9_-]{1,32}\}:[a-z0-9:_-]{1,64}$/.test(config.auditStreamKey) ||
      hashTag(config.auditStreamKey) !== hashTag(config.quoteKeyPrefix)) {
    throw new Error("Redis signer quote commit keys must use one Redis Cluster hash tag");
  }
  if (typeof config.ledgerEpoch !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(config.ledgerEpoch)) {
    throw new Error("Redis signer quote commit ledgerEpoch is invalid");
  }
  assertInteger(config.issuanceMaxBacklog, 1, 1_000_000, "issuanceMaxBacklog");
  assertInteger(config.hotStateTtlMs, 60_000, 604_800_000, "hotStateTtlMs");
  assertInteger(config.idempotencyTtlMs, config.hotStateTtlMs, 2_592_000_000, "idempotencyTtlMs");
  assertInteger(config.auditMaxBacklog, 1, 1_000_000, "auditMaxBacklog");
  assertInteger(config.auditDedupeTtlMs, 60_000, 604_800_000, "auditDedupeTtlMs");
  assertInteger(config.minReplicaAcks, 0, 5, "minReplicaAcks");
  assertInteger(config.replicaAckTimeoutMs, 1, 5_000, "replicaAckTimeoutMs");
  if (typeof config.requireAof !== "boolean") {
    throw new Error("Redis signer quote commit requireAof must be a boolean");
  }
  return { ...config };
}

function parseCommitResult(value: unknown): {
  code: number;
  finalizationHash: string;
  reason: string;
  issuanceBacklog: number;
  auditBacklog: number;
} {
  if (!Array.isArray(value) || value.length !== 6 || !Number.isSafeInteger(value[0]) ||
      typeof value[1] !== "string" || !Number.isSafeInteger(value[2]) || value[2] < 0 ||
      !Number.isSafeInteger(value[3]) || value[3] < 0 || typeof value[4] !== "string" ||
      typeof value[5] !== "string") {
    throw new Error("Redis signer quote commit returned malformed evidence");
  }
  const code = value[0] as number;
  if (code !== 0 && code !== 1 && code !== 2) {
    throw new Error("Redis signer quote commit returned an unsupported status");
  }
  return {
    code,
    finalizationHash: code === 0 ? "" : value[1] as string,
    reason: code === 0 ? value[1] as string : "",
    issuanceBacklog: value[2] as number,
    auditBacklog: value[3] as number,
  };
}

function assertClient(client: unknown): asserts client is RedisSignerQuoteCommitClient {
  assertRecord(client, "Redis signer quote commit client");
  for (const method of ["eval", "get", "ping", "info", "xlen", "wait", "quit"] as const) {
    if (typeof (client as Record<string, unknown>)[method] !== "function") {
      throw new Error(`Redis signer quote commit client.${method} must be a function`);
    }
  }
}

function assertObserver(observer: unknown): asserts observer is SignerQuoteCommitObserver {
  assertRecord(observer, "Redis signer quote commit observer");
  if (typeof observer.recordQuoteCommit !== "function" || typeof observer.recordQuoteCommitFailure !== "function") {
    throw new Error("Redis signer quote commit observer is invalid");
  }
}

function assertAofHealth(value: unknown): void {
  if (typeof value !== "string" || !/(?:^|\r?\n)aof_enabled:1(?:\r?\n|$)/.test(value) ||
      !/(?:^|\r?\n)aof_last_write_status:ok(?:\r?\n|$)/.test(value)) {
    throw new Error("Redis signer quote commit requires healthy AOF persistence");
  }
}

function parseNonNegativeInteger(value: unknown, field: string): number {
  const parsed = typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(parsed) || (parsed as number) < 0) {
    throw new Error(`Redis signer quote commit ${field} must be a non-negative integer`);
  }
  return parsed as number;
}

function hashTag(value: string): string {
  return value.slice(value.indexOf("{") + 1, value.indexOf("}"));
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function assertInteger(value: unknown, min: number, max: number, field: string): void {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`Redis signer quote commit ${field} must be between ${min} and ${max}`);
  }
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}
