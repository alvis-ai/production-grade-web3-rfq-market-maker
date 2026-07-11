import type { Address, HedgeIntentStatus, HedgeIntentStatusResponse, UIntString } from "../../shared/types/rfq.js";

export type HedgeFailureReasonCode = "HEDGE_INTENT_FAILED";

const maxSafeIdentifierLength = 128;
const safeIdentifierPattern = /^[A-Za-z0-9_:-]+$/;
const hedgeServiceConfigFields = ["failurePenaltyBps", "maxFailurePenaltyBps"] as const;
const hedgeIntentFields = ["settlementEventId", "quoteId", "chainId", "token", "side", "amount", "reason"] as const;
const hedgeRiskInputFields = ["chainId", "token"] as const;
const markHedgeIntentFilledFields = ["hedgeOrderId", "externalOrderId"] as const;

export interface HedgeIntent {
  settlementEventId: string;
  quoteId: string;
  chainId: number;
  token: Address;
  side: "buy" | "sell";
  amount: UIntString;
  reason: "inventory_rebalance" | "risk_reduction";
}

export interface HedgeResult {
  status: HedgeIntentStatus;
  hedgeOrderId: string;
  record: HedgeIntentStatusResponse;
}

export interface RemoveHedgeIntentResult {
  record?: HedgeIntentStatusResponse;
  removed: boolean;
}

export interface UpdateHedgeIntentResult {
  record?: HedgeIntentStatusResponse;
  updated: boolean;
}

export interface MarkHedgeIntentFilledInput {
  hedgeOrderId: string;
  externalOrderId: string;
}

export interface HedgeRiskInput {
  chainId: number;
  token: Address;
}

export interface HedgeIntentService {
  checkHealth?(): void | Promise<void>;
  createHedgeIntent(intent: HedgeIntent): HedgeResult | Promise<HedgeResult>;
  getHedgeIntent(hedgeOrderId: string): HedgeIntentStatusResponse | undefined | Promise<HedgeIntentStatusResponse | undefined>;
  getHedgeIntentBySettlementEvent(settlementEventId: string): HedgeIntentStatusResponse | undefined | Promise<HedgeIntentStatusResponse | undefined>;
  removeHedgeIntentBySettlementEvent(settlementEventId: string): RemoveHedgeIntentResult | Promise<RemoveHedgeIntentResult>;
  markHedgeIntentFilled?(input: MarkHedgeIntentFilledInput): UpdateHedgeIntentResult | Promise<UpdateHedgeIntentResult>;
  markHedgeIntentFailed?(hedgeOrderId: string): UpdateHedgeIntentResult | Promise<UpdateHedgeIntentResult>;
  recordHedgeFailure?(intent: HedgeIntent, reasonCode: HedgeFailureReasonCode): void | Promise<void>;
  quoteRiskPenaltyBps?(input: HedgeRiskInput): number | Promise<number>;
}

export interface HedgeServiceConfig {
  failurePenaltyBps: number;
  maxFailurePenaltyBps: number;
}

export const defaultHedgeServiceConfig: HedgeServiceConfig = {
  failurePenaltyBps: 25,
  maxFailurePenaltyBps: 150,
};

export class HedgeService implements HedgeIntentService {
  private readonly config: HedgeServiceConfig;
  private readonly intents = new Map<string, HedgeIntentStatusResponse>();
  private readonly hedgeOrderIdsBySettlementEvent = new Map<string, string>();
  private readonly failurePressure = new Map<string, number>();
  private sequence = 0;

  constructor(config: HedgeServiceConfig = defaultHedgeServiceConfig) {
    assertHedgeServiceConfig(config);

    this.config = cloneHedgeServiceConfig(config);
  }

  checkHealth(): void {
    this.getHedgeIntent("__readiness_probe__");
  }

  createHedgeIntent(intent: HedgeIntent): HedgeResult {
    assertHedgeIntent(intent);
    const existingHedgeOrderId = this.hedgeOrderIdsBySettlementEvent.get(intent.settlementEventId);
    if (existingHedgeOrderId) {
      const existingRecord = this.intents.get(existingHedgeOrderId);
      if (!existingRecord) {
        throw new Error(`Hedge intent index is inconsistent for ${existingHedgeOrderId}`);
      }
      if (!matchesHedgeIntent(existingRecord, intent)) {
        throw new Error(`Hedge intent conflict for ${existingHedgeOrderId}`);
      }

      return {
        status: existingRecord.status,
        hedgeOrderId: existingRecord.hedgeOrderId,
        record: cloneHedgeIntentStatus(existingRecord),
      };
    }

    this.sequence += 1;
    const hedgeOrderId = [
      "h",
      intent.chainId.toString(),
      intent.token.slice(2, 10).toLowerCase(),
      this.sequence.toString().padStart(6, "0"),
    ].join("_");
    const record: HedgeIntentStatusResponse = {
      hedgeOrderId,
      status: "queued",
      settlementEventId: intent.settlementEventId,
      quoteId: intent.quoteId,
      chainId: intent.chainId,
      token: intent.token,
      side: intent.side,
      amount: intent.amount,
      reason: intent.reason,
      createdAt: new Date().toISOString(),
    };
    this.intents.set(hedgeOrderId, record);
    this.hedgeOrderIdsBySettlementEvent.set(intent.settlementEventId, hedgeOrderId);

    return {
      status: "queued",
      hedgeOrderId,
      record: cloneHedgeIntentStatus(record),
    };
  }

  getHedgeIntent(hedgeOrderId: string): HedgeIntentStatusResponse | undefined {
    assertSafeIdentifier(hedgeOrderId, "hedgeOrderId");
    const intent = this.intents.get(hedgeOrderId);
    return intent ? cloneHedgeIntentStatus(intent) : undefined;
  }

  getHedgeIntentBySettlementEvent(settlementEventId: string): HedgeIntentStatusResponse | undefined {
    assertSafeIdentifier(settlementEventId, "settlementEventId");
    const hedgeOrderId = this.hedgeOrderIdsBySettlementEvent.get(settlementEventId);
    const intent = hedgeOrderId ? this.intents.get(hedgeOrderId) : undefined;
    return intent ? cloneHedgeIntentStatus(intent) : undefined;
  }

  removeHedgeIntentBySettlementEvent(settlementEventId: string): RemoveHedgeIntentResult {
    assertSafeIdentifier(settlementEventId, "settlementEventId");
    const hedgeOrderId = this.hedgeOrderIdsBySettlementEvent.get(settlementEventId);
    if (!hedgeOrderId) {
      return {
        removed: false,
      };
    }

    const intent = this.intents.get(hedgeOrderId);
    if (!intent) {
      throw new Error(`Hedge intent index is inconsistent for ${hedgeOrderId}`);
    }
    if (intent.status !== "queued" || intent.externalOrderId !== undefined) {
      return {
        record: cloneHedgeIntentStatus(intent),
        removed: false,
      };
    }

    this.intents.delete(hedgeOrderId);
    this.hedgeOrderIdsBySettlementEvent.delete(settlementEventId);

    return {
      record: cloneHedgeIntentStatus(intent),
      removed: true,
    };
  }

  markHedgeIntentFilled(input: MarkHedgeIntentFilledInput): UpdateHedgeIntentResult {
    assertMarkHedgeIntentFilledInput(input);
    const intent = this.intents.get(input.hedgeOrderId);
    if (!intent) {
      return {
        updated: false,
      };
    }
    if (intent.status === "failed") {
      throw new Error(`Hedge intent ${input.hedgeOrderId} cannot transition from failed to filled`);
    }
    if (intent.status === "filled") {
      if (intent.externalOrderId !== input.externalOrderId) {
        throw new Error(`Hedge intent ${input.hedgeOrderId} filled externalOrderId conflict`);
      }

      return {
        record: cloneHedgeIntentStatus(intent),
        updated: false,
      };
    }

    intent.status = "filled";
    intent.externalOrderId = input.externalOrderId;
    intent.updatedAt = new Date().toISOString();

    return {
      record: cloneHedgeIntentStatus(intent),
      updated: true,
    };
  }

  markHedgeIntentFailed(hedgeOrderId: string): UpdateHedgeIntentResult {
    assertSafeIdentifier(hedgeOrderId, "hedgeOrderId");
    const intent = this.intents.get(hedgeOrderId);
    if (!intent) {
      return {
        updated: false,
      };
    }
    if (intent.status === "filled") {
      throw new Error(`Hedge intent ${hedgeOrderId} cannot transition from filled to failed`);
    }
    if (intent.status === "failed") {
      return {
        record: cloneHedgeIntentStatus(intent),
        updated: false,
      };
    }

    intent.status = "failed";
    delete intent.externalOrderId;
    intent.updatedAt = new Date().toISOString();

    return {
      record: cloneHedgeIntentStatus(intent),
      updated: true,
    };
  }

  recordHedgeFailure(intent: HedgeIntent, _reasonCode: HedgeFailureReasonCode): void {
    assertHedgeIntent(intent);
    const key = this.key(intent.chainId, intent.token);
    const current = this.failurePressure.get(key) ?? 0;
    this.failurePressure.set(key, Math.min(current + this.config.failurePenaltyBps, this.config.maxFailurePenaltyBps));
  }

  quoteRiskPenaltyBps(input: HedgeRiskInput): number {
    assertHedgeRiskInput(input);
    return this.failurePressure.get(this.key(input.chainId, input.token)) ?? 0;
  }

  private key(chainId: number, token: Address): string {
    return `${chainId}:${token.toLowerCase()}`;
  }
}

export function cloneHedgeIntentStatus(intent: HedgeIntentStatusResponse): HedgeIntentStatusResponse {
  return { ...intent };
}

export function cloneHedgeServiceConfig(config: HedgeServiceConfig): HedgeServiceConfig {
  return { ...config };
}

export function assertHedgeServiceConfig(config: HedgeServiceConfig): void {
  assertObject(config, "config");
  assertOwnFields(config, hedgeServiceConfigFields, "config");
  assertPositiveBps(config.failurePenaltyBps, "failurePenaltyBps");
  assertPositiveBps(config.maxFailurePenaltyBps, "maxFailurePenaltyBps");
  if (config.failurePenaltyBps > config.maxFailurePenaltyBps) {
    throw new Error("Hedge failurePenaltyBps must be less than or equal to maxFailurePenaltyBps");
  }
}

export function matchesHedgeIntent(record: HedgeIntentStatusResponse, intent: HedgeIntent): boolean {
  return (
    record.settlementEventId === intent.settlementEventId &&
    record.quoteId === intent.quoteId &&
    record.chainId === intent.chainId &&
    record.token.toLowerCase() === intent.token.toLowerCase() &&
    record.side === intent.side &&
    record.amount === intent.amount &&
    record.reason === intent.reason
  );
}

function assertPositiveBps(value: number, field: keyof HedgeServiceConfig): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Hedge ${field} must be a positive safe integer`);
  }

  if (value > 10_000) {
    throw new Error(`Hedge ${field} must be less than or equal to 10000 bps`);
  }
}

export function assertHedgeIntent(intent: HedgeIntent): void {
  assertObject(intent, "intent");
  assertOwnFields(intent, hedgeIntentFields, "intent");
  assertSafeIdentifier(intent.settlementEventId, "settlementEventId");
  assertSafeIdentifier(intent.quoteId, "quoteId");
  assertHedgeRiskInput(intent);
  if (intent.side !== "buy" && intent.side !== "sell") {
    throw new Error("Hedge side must be buy or sell");
  }
  assertPositiveUIntString(intent.amount, "amount");
  if (intent.reason !== "inventory_rebalance" && intent.reason !== "risk_reduction") {
    throw new Error("Hedge reason must be inventory_rebalance or risk_reduction");
  }
}

export function assertHedgeRiskInput(input: HedgeRiskInput): void {
  assertObject(input, "risk input");
  assertOwnFields(input, hedgeRiskInputFields, "risk input");
  if (!Number.isSafeInteger(input.chainId) || input.chainId <= 0) {
    throw new Error("Hedge chainId must be a positive safe integer");
  }
  if (typeof input.token !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(input.token)) {
    throw new Error("Hedge token must be a 20-byte hex address");
  }
}

function assertMarkHedgeIntentFilledInput(input: MarkHedgeIntentFilledInput): void {
  assertObject(input, "filled input");
  assertOwnFields(input, markHedgeIntentFilledFields, "filled input");
  assertSafeIdentifier(input.hedgeOrderId, "hedgeOrderId");
  assertExternalOrderId(input.externalOrderId);
}

function assertExternalOrderId(value: unknown): void {
  if (typeof value !== "string") {
    throw new Error("Hedge externalOrderId must be a primitive string");
  }
  if (value.trim().length === 0) {
    throw new Error("Hedge externalOrderId must be a non-empty string");
  }
}

function assertObject(value: unknown, field: "config" | "intent" | "risk input" | "filled input"): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Hedge ${field} must be an object`);
  }
}

function assertOwnFields(value: object, fields: readonly string[], path: string): void {
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      throw new Error(`Hedge ${path}.${field} must be an own field`);
    }
  }
}

export function assertSafeIdentifier(
  value: unknown,
  field: keyof Pick<HedgeIntent, "settlementEventId" | "quoteId"> | "hedgeOrderId",
): void {
  if (typeof value !== "string") {
    throw new Error(`Hedge ${field} must be a primitive string`);
  }
  if (value.trim().length === 0) {
    throw new Error(`Hedge ${field} must be a non-empty string`);
  }
  if (value.length > maxSafeIdentifierLength) {
    throw new Error(`Hedge ${field} must be 128 characters or fewer`);
  }
  if (!safeIdentifierPattern.test(value)) {
    throw new Error(`Hedge ${field} must contain only letters, numbers, underscore, colon, or hyphen`);
  }
}

function assertPositiveUIntString(value: string, field: keyof Pick<HedgeIntent, "amount">): void {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`Hedge ${field} must be a positive uint string`);
  }
}
