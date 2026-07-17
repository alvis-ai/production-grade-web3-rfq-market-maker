import type pg from "pg";

export type SignerAuditOutcome = "success" | "signer_error";

export interface SignerAuditEvent {
  quoteId: string;
  snapshotId: string;
  riskDecisionId: string;
  riskPolicyVersion: string;
  traceId: string;
  quoteDigest: `0x${string}`;
  signatureHash?: `0x${string}`;
  signerAddress: `0x${string}`;
  settlementAddress: `0x${string}`;
  chainId: number;
  deadline: number;
  outcome: SignerAuditOutcome;
  occurredAt: string;
}

export interface SignerAuditStore {
  append(event: SignerAuditEvent): Promise<void>;
  checkHealth(): Promise<void>;
}

const eventFields = [
  "quoteId",
  "snapshotId",
  "riskDecisionId",
  "riskPolicyVersion",
  "traceId",
  "quoteDigest",
  "signatureHash",
  "signerAddress",
  "settlementAddress",
  "chainId",
  "deadline",
  "outcome",
  "occurredAt",
] as const;
const safeIdentifierPattern = /^[A-Za-z0-9_:-]{1,128}$/;
const bytes32Pattern = /^0x[0-9a-fA-F]{64}$/;
const addressPattern = /^0x[0-9a-fA-F]{40}$/;

export class InMemorySignerAuditStore implements SignerAuditStore {
  private readonly events: SignerAuditEvent[] = [];

  async append(event: SignerAuditEvent): Promise<void> {
    assertSignerAuditEvent(event);
    this.events.push(cloneEvent(event));
  }

  async checkHealth(): Promise<void> {}

  snapshot(): readonly SignerAuditEvent[] {
    return this.events.map(cloneEvent);
  }
}

export class PostgresSignerAuditStore implements SignerAuditStore {
  constructor(
    private readonly pool: pg.Pool,
    private readonly queryTimeoutMs: number,
  ) {
    if (typeof pool !== "object" || pool === null || typeof pool.query !== "function") {
      throw new Error("Postgres signer audit pool must expose query");
    }
    if (!Number.isSafeInteger(queryTimeoutMs) || queryTimeoutMs < 100 || queryTimeoutMs > 10_000) {
      throw new Error("Postgres signer audit queryTimeoutMs must be between 100 and 10000");
    }
  }

  async append(event: SignerAuditEvent): Promise<void> {
    await this.insert(event);
  }

  async appendMirrored(event: SignerAuditEvent, sourceStreamId: string): Promise<boolean> {
    if (typeof sourceStreamId !== "string" ||
        !/^[A-Za-z][A-Za-z0-9_-]{0,63}:\d+-\d+$/.test(sourceStreamId)) {
      throw new Error("Postgres signer audit sourceStreamId must be a Redis stream id");
    }
    return this.insert(event, sourceStreamId);
  }

  private async insert(event: SignerAuditEvent, sourceStreamId?: string): Promise<boolean> {
    assertSignerAuditEvent(event);
    const query: pg.QueryConfig & { query_timeout: number } = {
      text: `INSERT INTO signer_audit_events (
               quote_id, snapshot_id, context_version, risk_decision_id,
               risk_policy_version, trace_id, quote_digest, signature_hash,
               signer_address, settlement_address, chain_id, deadline,
               outcome, occurred_at, source_stream_id
             ) VALUES ($1, $2, 2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
             ON CONFLICT (source_stream_id) DO NOTHING`,
      values: [
        event.quoteId,
        event.snapshotId,
        event.riskDecisionId,
        event.riskPolicyVersion,
        event.traceId,
        hexBytes(event.quoteDigest),
        event.signatureHash ? hexBytes(event.signatureHash) : null,
        event.signerAddress.toLowerCase(),
        event.settlementAddress.toLowerCase(),
        event.chainId,
        event.deadline,
        event.outcome,
        event.occurredAt,
        sourceStreamId ?? null,
      ],
      query_timeout: this.queryTimeoutMs,
    };
    const result = await this.pool.query(query);
    return result.rowCount === 1;
  }

  async checkHealth(): Promise<void> {
    const query: pg.QueryConfig & { query_timeout: number } = {
      text: `SELECT count(*)::integer AS required_columns
             FROM pg_attribute
             WHERE attrelid = to_regclass('public.signer_audit_events')
               AND attname = ANY($1::text[])
               AND NOT attisdropped`,
      values: [["context_version", "risk_decision_id", "risk_policy_version", "trace_id", "source_stream_id"]],
      query_timeout: this.queryTimeoutMs,
    };
    const result = await this.pool.query<{ required_columns: number }>(query);
    if (result.rows[0]?.required_columns !== 5) {
      throw new Error("Signer audit schema is unavailable");
    }
  }
}

export function assertSignerAuditEvent(value: unknown): asserts value is SignerAuditEvent {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Signer audit event must be an object");
  }
  const event = value as Record<string, unknown>;
  const allowed = new Set(eventFields);
  if (Object.keys(event).some((field) => !allowed.has(field as typeof eventFields[number]))) {
    throw new Error("Signer audit event fields are invalid");
  }
  for (const field of eventFields) {
    if (field === "signatureHash") continue;
    if (!Object.prototype.hasOwnProperty.call(event, field)) {
      throw new Error(`Signer audit event.${field} must be an own field`);
    }
  }
  assertSafeIdentifier(event.quoteId, "quoteId");
  assertSafeIdentifier(event.snapshotId, "snapshotId");
  assertSafeIdentifier(event.riskDecisionId, "riskDecisionId");
  assertSafeVersion(event.riskPolicyVersion);
  assertTraceId(event.traceId);
  if (event.riskDecisionId !== `rd_${event.quoteId}`) {
    throw new Error("Signer audit event.riskDecisionId must match quoteId");
  }
  assertBytes32(event.quoteDigest, "quoteDigest");
  assertAddress(event.signerAddress, "signerAddress");
  assertAddress(event.settlementAddress, "settlementAddress");
  assertPositiveSafeInteger(event.chainId, "chainId");
  assertPositiveSafeInteger(event.deadline, "deadline");
  if (event.outcome !== "success" && event.outcome !== "signer_error") {
    throw new Error("Signer audit event.outcome must be success or signer_error");
  }
  const hasSignatureHash = Object.prototype.hasOwnProperty.call(event, "signatureHash");
  if (event.outcome === "success") {
    if (!hasSignatureHash) throw new Error("Signer audit success requires signatureHash");
    assertBytes32(event.signatureHash, "signatureHash");
  } else if (hasSignatureHash) {
    throw new Error("Signer audit signer_error must not include signatureHash");
  }
  if (typeof event.occurredAt !== "string" ||
      Number.isNaN(Date.parse(event.occurredAt)) ||
      new Date(event.occurredAt).toISOString() !== event.occurredAt) {
    throw new Error("Signer audit event.occurredAt must be a canonical UTC timestamp");
  }
}

function assertTraceId(value: unknown): void {
  if (typeof value !== "string" || !/^tr_[A-Za-z0-9._:-]{1,125}$/.test(value)) {
    throw new Error("Signer audit event.traceId must be a safe trace identifier");
  }
}

function assertSafeVersion(value: unknown): void {
  if (typeof value !== "string" || !/^[A-Za-z0-9_.:-]{1,128}$/.test(value)) {
    throw new Error("Signer audit event.riskPolicyVersion must be a safe version identifier");
  }
}

function assertSafeIdentifier(value: unknown, field: string): void {
  if (typeof value !== "string" || !safeIdentifierPattern.test(value)) {
    throw new Error(`Signer audit event.${field} must be a safe identifier`);
  }
}

function assertBytes32(value: unknown, field: string): asserts value is `0x${string}` {
  if (typeof value !== "string" || !bytes32Pattern.test(value)) {
    throw new Error(`Signer audit event.${field} must be a 32-byte hex string`);
  }
}

function assertAddress(value: unknown, field: string): asserts value is `0x${string}` {
  if (typeof value !== "string" || !addressPattern.test(value) || /^0x0{40}$/i.test(value)) {
    throw new Error(`Signer audit event.${field} must be a non-zero address`);
  }
}

function assertPositiveSafeInteger(value: unknown, field: string): void {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new Error(`Signer audit event.${field} must be a positive safe integer`);
  }
}

function hexBytes(value: `0x${string}`): Buffer {
  return Buffer.from(value.slice(2), "hex");
}

function cloneEvent(event: SignerAuditEvent): SignerAuditEvent {
  return { ...event };
}
