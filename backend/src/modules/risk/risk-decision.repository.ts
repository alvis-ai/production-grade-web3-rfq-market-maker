import type { RiskDecision, RiskDecisionStatus, RiskRejectReasonCode } from "./risk.engine.js";

const maxSafeIdentifierLength = 128;
const safeIdentifierPattern = /^[A-Za-z0-9_:-]+$/;
const riskDecisionInputFields = ["quoteId", "decision"] as const;
const riskDecisionFields = ["status", "policyVersion"] as const;
const rejectedRiskDecisionFields = ["reasonCode"] as const;

const riskRejectReasonCodes = new Set<string>([
  "CHAIN_NOT_ENABLED",
  "TOKEN_NOT_ALLOWED",
  "MARKET_LIQUIDITY_TOO_LOW",
  "MARKET_VOLATILITY_LIMIT_EXCEEDED",
  "AMOUNT_IN_LIMIT_EXCEEDED",
  "AMOUNT_OUT_TOO_SMALL",
  "QUOTE_NOTIONAL_LIMIT_EXCEEDED",
  "USER_OPEN_NOTIONAL_LIMIT_EXCEEDED",
  "PAIR_OPEN_NOTIONAL_LIMIT_EXCEEDED",
  "USD_REFERENCE_REQUIRED",
  "SLIPPAGE_TOO_WIDE",
  "QUOTED_SPREAD_TOO_WIDE",
  "TOXIC_FLOW_RESTRICTED_USER",
  "TOXIC_FLOW_SCORE_EXCEEDED",
  "TOKEN_IN_INVENTORY_LIMIT_EXCEEDED",
  "TOKEN_OUT_INVENTORY_LIMIT_EXCEEDED",
  "RISK_ENGINE_UNAVAILABLE",
]);

export interface RiskDecisionRecord {
  riskDecisionId: string;
  quoteId: string;
  decision: RiskDecisionStatus;
  reasonCode?: RiskRejectReasonCode;
  policyVersion: string;
  createdAt: string;
}

export interface SaveRiskDecisionInput {
  quoteId: string;
  decision: RiskDecision;
}

export interface RiskDecisionStore {
  checkHealth?(): void | Promise<void>;
  saveDecision(input: SaveRiskDecisionInput): Promise<RiskDecisionRecord>;
  findByQuoteId(quoteId: string): Promise<RiskDecisionRecord | undefined>;
}

export class InMemoryRiskDecisionRepository implements RiskDecisionStore {
  private readonly recordsByQuoteId = new Map<string, RiskDecisionRecord>();

  checkHealth(): void {
    this.recordsByQuoteId.get("__readiness_probe__");
  }

  async saveDecision(input: SaveRiskDecisionInput): Promise<RiskDecisionRecord> {
    assertRiskDecisionInput(input);
    const existing = this.recordsByQuoteId.get(input.quoteId);
    const nextRecord = toRiskDecisionRecord(input);
    if (existing) {
      if (!isSameRiskDecision(existing, nextRecord)) {
        throw new Error(`Risk decision conflict for ${input.quoteId}`);
      }

      return cloneRiskDecisionRecord(existing);
    }

    this.recordsByQuoteId.set(nextRecord.quoteId, nextRecord);
    return cloneRiskDecisionRecord(nextRecord);
  }

  async findByQuoteId(quoteId: string): Promise<RiskDecisionRecord | undefined> {
    assertSafeIdentifier(quoteId, "quoteId");
    const record = this.recordsByQuoteId.get(quoteId);
    return record ? cloneRiskDecisionRecord(record) : undefined;
  }
}

function toRiskDecisionRecord(input: SaveRiskDecisionInput): RiskDecisionRecord {
  return {
    riskDecisionId: buildRiskDecisionId(input.quoteId),
    quoteId: input.quoteId,
    decision: input.decision.status,
    reasonCode: input.decision.status === "rejected" ? input.decision.reasonCode : undefined,
    policyVersion: input.decision.policyVersion,
    createdAt: new Date().toISOString(),
  };
}

function buildRiskDecisionId(quoteId: string): string {
  return `rd_${quoteId}`;
}

function assertRiskDecisionInput(input: SaveRiskDecisionInput): void {
  assertObject(input, "input");
  assertObject(input.decision, "decision");
  assertOwnFields(input, riskDecisionInputFields, "input");
  assertOwnFields(input.decision, riskDecisionFields, "decision");
  assertOwnOptionalFields(input.decision, rejectedRiskDecisionFields, "decision");
  assertSafeIdentifier(input.quoteId, "quoteId");
  assertSafeIdentifier(buildRiskDecisionId(input.quoteId), "riskDecisionId");
  assertNonEmptyString(input.decision.policyVersion, "policyVersion");

  if (input.decision.status !== "approved" && input.decision.status !== "rejected") {
    throw new Error("Risk decision status must be approved or rejected");
  }

  if (input.decision.status === "approved") {
    return;
  }

  assertOwnFields(input.decision, rejectedRiskDecisionFields, "decision");
  assertNonEmptyString(input.decision.reasonCode, "reasonCode");
  if (!riskRejectReasonCodes.has(input.decision.reasonCode)) {
    throw new Error("Risk decision reasonCode must be a stable risk reject reason");
  }
}

function assertObject(value: unknown, field: "input" | "decision"): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Risk decision ${field} must be an object`);
  }
}

function assertOwnFields(value: object, fields: readonly string[], path: string): void {
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      throw new Error(`Risk decision ${path}.${field} must be an own field`);
    }
  }
}

function assertOwnOptionalFields(value: object, fields: readonly string[], path: string): void {
  for (const field of fields) {
    if (field in value && !Object.prototype.hasOwnProperty.call(value, field)) {
      throw new Error(`Risk decision ${path}.${field} must be an own field when provided`);
    }
  }
}

function assertNonEmptyString(value: string, field: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Risk decision ${field} must be a non-empty string`);
  }
}

function assertSafeIdentifier(value: unknown, field: string): void {
  if (typeof value !== "string") {
    throw new Error(`Risk decision ${field} must be a primitive string`);
  }
  if (value.trim().length === 0) {
    throw new Error(`Risk decision ${field} must be a non-empty string`);
  }
  if (value.length > maxSafeIdentifierLength) {
    throw new Error(`Risk decision ${field} must be 128 characters or fewer`);
  }
  if (!safeIdentifierPattern.test(value)) {
    throw new Error(`Risk decision ${field} must contain only letters, numbers, underscore, colon, or hyphen`);
  }
}

function isSameRiskDecision(left: RiskDecisionRecord, right: RiskDecisionRecord): boolean {
  return (
    left.quoteId === right.quoteId &&
    left.decision === right.decision &&
    left.reasonCode === right.reasonCode &&
    left.policyVersion === right.policyVersion
  );
}

function cloneRiskDecisionRecord(record: RiskDecisionRecord): RiskDecisionRecord {
  return { ...record };
}
