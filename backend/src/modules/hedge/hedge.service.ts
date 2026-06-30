import type { Address, HedgeIntentStatusResponse, UIntString } from "../../shared/types/rfq.js";

export type HedgeFailureReasonCode = "HEDGE_INTENT_FAILED";

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
  status: "queued";
  hedgeOrderId: string;
  record: HedgeIntentStatusResponse;
}

export interface HedgeRiskInput {
  chainId: number;
  token: Address;
}

export interface HedgeIntentService {
  checkHealth?(): void;
  createHedgeIntent(intent: HedgeIntent): HedgeResult;
  getHedgeIntent(hedgeOrderId: string): HedgeIntentStatusResponse | undefined;
  getHedgeIntentBySettlementEvent(settlementEventId: string): HedgeIntentStatusResponse | undefined;
  recordHedgeFailure?(intent: HedgeIntent, reasonCode: HedgeFailureReasonCode): void;
  quoteRiskPenaltyBps?(input: HedgeRiskInput): number;
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
    assertPositiveBps(config.failurePenaltyBps, "failurePenaltyBps");
    assertPositiveBps(config.maxFailurePenaltyBps, "maxFailurePenaltyBps");

    if (config.failurePenaltyBps > config.maxFailurePenaltyBps) {
      throw new Error("Hedge failurePenaltyBps must be less than or equal to maxFailurePenaltyBps");
    }

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
        status: "queued",
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
    const intent = this.intents.get(hedgeOrderId);
    return intent ? cloneHedgeIntentStatus(intent) : undefined;
  }

  getHedgeIntentBySettlementEvent(settlementEventId: string): HedgeIntentStatusResponse | undefined {
    assertNonEmptyString(settlementEventId, "settlementEventId");
    const hedgeOrderId = this.hedgeOrderIdsBySettlementEvent.get(settlementEventId);
    const intent = hedgeOrderId ? this.intents.get(hedgeOrderId) : undefined;
    return intent ? cloneHedgeIntentStatus(intent) : undefined;
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

function cloneHedgeIntentStatus(intent: HedgeIntentStatusResponse): HedgeIntentStatusResponse {
  return { ...intent };
}

function cloneHedgeServiceConfig(config: HedgeServiceConfig): HedgeServiceConfig {
  return { ...config };
}

function matchesHedgeIntent(record: HedgeIntentStatusResponse, intent: HedgeIntent): boolean {
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

function assertHedgeIntent(intent: HedgeIntent): void {
  assertNonEmptyString(intent.settlementEventId, "settlementEventId");
  assertNonEmptyString(intent.quoteId, "quoteId");
  assertHedgeRiskInput(intent);
  if (intent.side !== "buy" && intent.side !== "sell") {
    throw new Error("Hedge side must be buy or sell");
  }
  assertPositiveUIntString(intent.amount, "amount");
  if (intent.reason !== "inventory_rebalance" && intent.reason !== "risk_reduction") {
    throw new Error("Hedge reason must be inventory_rebalance or risk_reduction");
  }
}

function assertHedgeRiskInput(input: HedgeRiskInput): void {
  if (!Number.isSafeInteger(input.chainId) || input.chainId <= 0) {
    throw new Error("Hedge chainId must be a positive safe integer");
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(input.token)) {
    throw new Error("Hedge token must be a 20-byte hex address");
  }
}

function assertNonEmptyString(value: string, field: keyof Pick<HedgeIntent, "settlementEventId" | "quoteId">): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Hedge ${field} must be a non-empty string`);
  }
}

function assertPositiveUIntString(value: string, field: keyof Pick<HedgeIntent, "amount">): void {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value) || BigInt(value) <= 0n) {
    throw new Error(`Hedge ${field} must be a positive uint string`);
  }
}
