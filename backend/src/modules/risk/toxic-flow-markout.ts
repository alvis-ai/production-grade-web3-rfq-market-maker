import type { Address } from "../../shared/types/rfq.js";
import { normalizeHumanPrice } from "../pricing/price-normalization.js";

export interface ToxicFlowMarkoutJob {
  settlementEventId: string;
  quoteId: string;
  chainId: number;
  user: Address;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: string;
  amountOut: string;
  settledAt: string;
  desiredCanonical: boolean;
  desiredRevision: number;
  attemptCount: number;
}

export interface ToxicFlowMarkoutSnapshot {
  snapshotId: string;
  midPrice: string;
  observedAt: string;
}

export interface ToxicFlowMarkoutResult {
  executionPrice: string;
  postMidPrice: string;
  postTradeDriftBps: number;
  toxicityScoreBps: number;
}

export interface ToxicFlowAggregate {
  sampleSize: number;
  averagePostTradeDriftBps: number;
  scoreBps: number;
  observedAt: string;
}

export interface ToxicFlowMarkoutStats {
  pendingCount: number;
  oldestEligibleAt?: string;
}

export interface ToxicFlowMarkoutStore {
  checkHealth(): Promise<void>;
  claimNext(workerId: string, leaseMs: number, horizonSeconds: number): Promise<ToxicFlowMarkoutJob | undefined>;
  findPostTradeSnapshot(
    job: ToxicFlowMarkoutJob,
    horizonSeconds: number,
    maxSnapshotLagSeconds: number,
  ): Promise<ToxicFlowMarkoutSnapshot | undefined>;
  upsertMarkout(
    job: ToxicFlowMarkoutJob,
    snapshot: ToxicFlowMarkoutSnapshot,
    result: ToxicFlowMarkoutResult,
    horizonSeconds: number,
    policyVersion: string,
  ): Promise<void>;
  invalidateMarkout(job: ToxicFlowMarkoutJob): Promise<void>;
  aggregateUser(chainId: number, user: Address, windowSeconds: number): Promise<ToxicFlowAggregate>;
  complete(job: ToxicFlowMarkoutJob, workerId: string): Promise<void>;
  releaseForRetry(job: ToxicFlowMarkoutJob, workerId: string, errorCode: string, delayMs: number): Promise<void>;
  stats(horizonSeconds: number): Promise<ToxicFlowMarkoutStats>;
}

const fixedScale = 10n ** 18n;

export function calculateToxicFlowMarkout(
  amountIn: string,
  amountOut: string,
  tokenInDecimals: number,
  tokenOutDecimals: number,
  postMidPrice: string,
  scoreScale: number,
): ToxicFlowMarkoutResult {
  const amountInValue = positiveUint(amountIn, "amountIn");
  const amountOutValue = positiveUint(amountOut, "amountOut");
  assertDecimals(tokenInDecimals, "tokenInDecimals");
  assertDecimals(tokenOutDecimals, "tokenOutDecimals");
  if (!Number.isSafeInteger(scoreScale) || scoreScale < 1 || scoreScale > 10_000) {
    throw new Error("Toxic-flow markout scoreScale must be an integer from 1 to 10000");
  }
  const normalizedPostMid = normalizeHumanPrice(postMidPrice);
  const postMid = normalizedPostMid.numerator * fixedScale / normalizedPostMid.denominator;
  const numerator = amountOutValue * 10n ** BigInt(tokenInDecimals) * fixedScale;
  const denominator = amountInValue * 10n ** BigInt(tokenOutDecimals);
  const executionPrice = numerator / denominator;
  if (executionPrice <= 0n) throw new Error("Toxic-flow markout execution price is below precision");
  const rawDrift = Number(((postMid - executionPrice) * 10_000n) / executionPrice);
  const postTradeDriftBps = Math.max(-10_000, Math.min(10_000, rawDrift));
  const toxicityScoreBps = Math.min(10_000, Math.max(0, -postTradeDriftBps * scoreScale));
  return {
    executionPrice: fixed18Decimal(executionPrice),
    postMidPrice: fixed18Decimal(postMid),
    postTradeDriftBps,
    toxicityScoreBps,
  };
}

function positiveUint(value: unknown, field: string): bigint {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`Toxic-flow markout ${field} must be a canonical positive uint string`);
  }
  return BigInt(value);
}

function assertDecimals(value: unknown, field: string): void {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 36) {
    throw new Error(`Toxic-flow markout ${field} must be an integer from 0 to 36`);
  }
}

function fixed18Decimal(value: bigint): string {
  const whole = value / fixedScale;
  const fraction = (value % fixedScale).toString().padStart(18, "0");
  return `${whole}.${fraction}`;
}
