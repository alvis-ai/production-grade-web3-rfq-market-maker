import type {
  NormalizedQuoteExposureReservation,
  QuoteExposureObserver,
  QuoteExposureReservationResult,
} from "./quote-exposure.store.js";
import type { PortfolioTokenDelta } from "./in-memory-portfolio-var.js";
import type { PortfolioDeltaEvaluation } from "./portfolio-delta.js";
import type { PortfolioVarEvaluation } from "./portfolio-var.js";

export interface RedisQuoteExposureClient {
  readonly status?: string;
  connect?: () => Promise<unknown>;
  disconnect?: () => void;
  call(command: string, ...args: Array<string | number>): Promise<unknown>;
  eval(script: string, numberOfKeys: number, ...args: Array<string | number>): Promise<unknown>;
  ping(): Promise<unknown>;
  info(section: string): Promise<unknown>;
  xlen(key: string): Promise<unknown>;
  wait(replicas: number, timeoutMs: number): Promise<unknown>;
  quit(): Promise<unknown>;
}

export interface RedisQuoteExposureStoreConfig {
  keyPrefix: string;
  ledgerEpoch: string;
  allowEpochInitialization: boolean;
  maxBacklog: number;
  expiryGraceSeconds: number;
  cleanupLimit: number;
  lockTtlMs: number;
  lockAcquireTimeoutMs: number;
  minReplicaAcks: number;
  replicaAckTimeoutMs: number;
  requireAof: boolean;
}

export interface RedisQuoteExposureObservation {
  operation: "reserve" | "release";
  duplicate: boolean;
  backlog: number;
}

export interface RedisQuoteExposureLedgerObserver extends QuoteExposureObserver {
  recordLedgerMutation(observation: RedisQuoteExposureObservation): void;
  recordLedgerFailure(reason: "backlog_full" | "lock_timeout" | "replica_ack" | "state_invalid"): void;
  recordLedgerLockWait(seconds: number): void;
  recordLedgerBacklog(backlog: number): void;
}

export interface RedisQuoteExposureRecord {
  schemaVersion: 1;
  quoteId: string;
  chainId: number;
  user: `0x${string}`;
  tokenLow: `0x${string}`;
  tokenHigh: `0x${string}`;
  tokenIn: `0x${string}`;
  amountIn: string;
  tokenOut: `0x${string}`;
  amountOut: string;
  notionalUsdE18: string;
  deadline: number;
  ledgerExpiresAt: number;
  treasuryLiquidity?: {
    settlementAddress: `0x${string}`;
    treasuryAddress: `0x${string}`;
    availableBalance: string;
    blockNumber: string;
  };
  portfolioVar?: PortfolioVarEvaluation;
  portfolioDelta?: PortfolioDeltaEvaluation;
}

export interface ReadRedisQuoteExposureState {
  existing?: RedisQuoteExposureRecord;
  tokenDeltas: PortfolioTokenDelta[];
  backlog: number;
}

export const noopRedisQuoteExposureObserver: RedisQuoteExposureLedgerObserver = {
  recordLedgerMutation() {},
  recordLedgerFailure() {},
  recordLedgerLockWait() {},
  recordLedgerBacklog() {},
  recordPortfolioDeltaSoftBreach() {},
};

export function toStoredRedisQuoteExposureReservation(
  reservation: NormalizedQuoteExposureReservation,
  expiryGraceSeconds: number,
  portfolioVar?: PortfolioVarEvaluation,
  portfolioDelta?: PortfolioDeltaEvaluation,
): RedisQuoteExposureRecord {
  return {
    schemaVersion: 1,
    quoteId: reservation.quoteId,
    chainId: reservation.chainId,
    user: reservation.user,
    tokenLow: reservation.tokenLow,
    tokenHigh: reservation.tokenHigh,
    tokenIn: reservation.tokenIn,
    amountIn: reservation.amountIn.toString(),
    tokenOut: reservation.tokenOut,
    amountOut: reservation.amountOut.toString(),
    notionalUsdE18: reservation.notionalUsdE18.toString(),
    deadline: reservation.deadline,
    ledgerExpiresAt: reservation.deadline + expiryGraceSeconds,
    ...(reservation.treasuryLiquidity ? {
      treasuryLiquidity: {
        settlementAddress: reservation.treasuryLiquidity.settlementAddress,
        treasuryAddress: reservation.treasuryLiquidity.treasuryAddress,
        availableBalance: reservation.treasuryLiquidity.availableBalance.toString(),
        blockNumber: reservation.treasuryLiquidity.blockNumber.toString(),
      },
    } : {}),
    ...(portfolioVar ? { portfolioVar } : {}),
    ...(portfolioDelta ? { portfolioDelta } : {}),
  };
}

export function storedRedisQuoteExposureToNormalized(
  record: RedisQuoteExposureRecord,
): NormalizedQuoteExposureReservation {
  return {
    quoteId: record.quoteId,
    chainId: record.chainId,
    user: record.user,
    tokenLow: record.tokenLow,
    tokenHigh: record.tokenHigh,
    tokenIn: record.tokenIn,
    amountIn: BigInt(record.amountIn),
    tokenOut: record.tokenOut,
    amountOut: BigInt(record.amountOut),
    notionalUsdE18: BigInt(record.notionalUsdE18),
    deadline: record.deadline,
    ...(record.treasuryLiquidity ? {
      treasuryLiquidity: {
        settlementAddress: record.treasuryLiquidity.settlementAddress,
        treasuryAddress: record.treasuryLiquidity.treasuryAddress,
        availableBalance: BigInt(record.treasuryLiquidity.availableBalance),
        blockNumber: BigInt(record.treasuryLiquidity.blockNumber),
      },
    } : {}),
  };
}

export function storedRedisQuoteExposureResult(
  record: RedisQuoteExposureRecord,
): QuoteExposureReservationResult {
  return {
    status: "reserved",
    notionalUsdE18: record.notionalUsdE18,
    ...(record.portfolioVar ? { portfolioVar: record.portfolioVar } : {}),
    ...(record.portfolioDelta ? { portfolioDelta: record.portfolioDelta } : {}),
  };
}

export function parseRedisQuoteExposureRecord(payload: string): RedisQuoteExposureRecord {
  let value: unknown;
  try { value = JSON.parse(payload); } catch {
    throw new Error("Redis quote exposure reservation payload must be valid JSON");
  }
  if (!isRecord(value)) throw new Error("Redis quote exposure reservation payload must be an object");
  const required = [
    "schemaVersion", "quoteId", "chainId", "user", "tokenLow", "tokenHigh", "tokenIn",
    "amountIn", "tokenOut", "amountOut", "notionalUsdE18", "deadline", "ledgerExpiresAt",
  ];
  const optional = ["treasuryLiquidity", "portfolioVar", "portfolioDelta"];
  if (Object.keys(value).some((field) => !required.includes(field) && !optional.includes(field)) ||
      required.some((field) => !Object.prototype.hasOwnProperty.call(value, field))) {
    throw new Error("Redis quote exposure reservation payload fields are invalid");
  }
  if (value.schemaVersion !== 1 || !Number.isSafeInteger(value.chainId) || (value.chainId as number) <= 0 ||
      !Number.isSafeInteger(value.deadline) || (value.deadline as number) <= 0 ||
      !Number.isSafeInteger(value.ledgerExpiresAt) ||
      (value.ledgerExpiresAt as number) <= (value.deadline as number)) {
    throw new Error("Redis quote exposure reservation metadata is invalid");
  }
  assertSafeRedisQuoteExposureIdentifier(value.quoteId, "payload.quoteId");
  for (const field of ["user", "tokenLow", "tokenHigh", "tokenIn", "tokenOut"] as const) {
    assertNormalizedAddress(value[field], `payload.${field}`);
  }
  if ((value.tokenLow as string) >= (value.tokenHigh as string) ||
      value.tokenIn === value.tokenOut ||
      ![value.tokenLow, value.tokenHigh].includes(value.tokenIn as string) ||
      ![value.tokenLow, value.tokenHigh].includes(value.tokenOut as string)) {
    throw new Error("Redis quote exposure reservation token pair is invalid");
  }
  for (const field of ["amountIn", "amountOut", "notionalUsdE18"] as const) {
    assertPositiveDecimal(value[field], `payload.${field}`);
  }
  if (value.treasuryLiquidity !== undefined) assertStoredTreasury(value.treasuryLiquidity);
  if (value.portfolioVar !== undefined && !isRecord(value.portfolioVar)) {
    throw new Error("Redis quote exposure reservation portfolioVar is invalid");
  }
  if (value.portfolioDelta !== undefined && !isRecord(value.portfolioDelta)) {
    throw new Error("Redis quote exposure reservation portfolioDelta is invalid");
  }
  return value as unknown as RedisQuoteExposureRecord;
}

export function parseRedisQuoteExposureState(
  result: unknown,
  assets: readonly `0x${string}`[],
  chainId: number,
): ReadRedisQuoteExposureState {
  if (!Array.isArray(result) || result.length !== 3 + assets.length || result[0] !== 1 ||
      typeof result[1] !== "string") {
    throw new Error("Redis quote exposure state read returned malformed values");
  }
  const existing = result[1] === "" ? undefined : parseRedisQuoteExposureRecord(result[1]);
  const backlog = parseRedisNonNegativeSafeInteger(result[2], "backlog");
  const tokenDeltas = assets.map((tokenAddress, index) => {
    const value = result[index + 3];
    assertSignedDecimal(value, "token delta");
    return { chainId, tokenAddress, delta: BigInt(value as string) };
  });
  return { ...(existing ? { existing } : {}), tokenDeltas, backlog };
}

export function parseRedisQuoteExposureMutation(result: unknown):
  | { status: "reserved"; payload: string; backlog: number }
  | { status: "duplicate"; payload: string; backlog: number }
  | { status: "rejected"; reason: string; backlog: number }
  | { status: "error"; reason: string; backlog: number } {
  if (!Array.isArray(result) || result.length !== 3 || !Number.isSafeInteger(result[0]) ||
      typeof result[1] !== "string") {
    throw new Error("Redis quote exposure mutation returned malformed values");
  }
  const backlog = parseRedisNonNegativeSafeInteger(result[2], "mutation backlog");
  if (result[0] === 1) return { status: "reserved", payload: result[1], backlog };
  if (result[0] === 2) return { status: "duplicate", payload: result[1], backlog };
  if (result[0] === 3) return { status: "rejected", reason: result[1], backlog };
  if (result[0] === 0) return { status: "error", reason: result[1], backlog };
  throw new Error("Redis quote exposure mutation returned an unsupported status");
}

export function normalizeRedisQuoteExposureConfig(
  config: RedisQuoteExposureStoreConfig,
): RedisQuoteExposureStoreConfig {
  if (!isRecord(config)) throw new Error("Redis quote exposure config must be an object");
  const fields = [
    "keyPrefix", "ledgerEpoch", "allowEpochInitialization", "maxBacklog", "expiryGraceSeconds",
    "cleanupLimit", "lockTtlMs", "lockAcquireTimeoutMs", "minReplicaAcks",
    "replicaAckTimeoutMs", "requireAof",
  ];
  if (Object.keys(config).some((field) => !fields.includes(field)) ||
      fields.some((field) => !Object.prototype.hasOwnProperty.call(config, field))) {
    throw new Error("Redis quote exposure config fields are invalid");
  }
  if (typeof config.keyPrefix !== "string" ||
      !/^rfq:\{[a-z0-9_-]{1,32}\}:[a-z0-9:_-]{1,48}$/.test(config.keyPrefix)) {
    throw new Error("Redis quote exposure keyPrefix must use a bounded rfq:{hash-tag}: key");
  }
  if (typeof config.ledgerEpoch !== "string" ||
      !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(config.ledgerEpoch)) {
    throw new Error("Redis quote exposure ledgerEpoch must be a safe epoch identifier");
  }
  if (typeof config.allowEpochInitialization !== "boolean" || typeof config.requireAof !== "boolean") {
    throw new Error("Redis quote exposure boolean config is invalid");
  }
  assertInteger(config.maxBacklog, 1, 1_000_000, "maxBacklog");
  assertInteger(config.expiryGraceSeconds, 1, 300, "expiryGraceSeconds");
  assertInteger(config.cleanupLimit, 1, 10_000, "cleanupLimit");
  assertInteger(config.lockTtlMs, 10, 10_000, "lockTtlMs");
  assertInteger(config.lockAcquireTimeoutMs, 1, 5_000, "lockAcquireTimeoutMs");
  if (config.lockAcquireTimeoutMs >= config.lockTtlMs) {
    throw new Error("Redis quote exposure lockAcquireTimeoutMs must be less than lockTtlMs");
  }
  assertInteger(config.minReplicaAcks, 0, 5, "minReplicaAcks");
  assertInteger(config.replicaAckTimeoutMs, 1, 5_000, "replicaAckTimeoutMs");
  return { ...config } as RedisQuoteExposureStoreConfig;
}

export function assertRedisQuoteExposureClient(
  client: unknown,
): asserts client is RedisQuoteExposureClient {
  if (!isRecord(client)) throw new Error("Redis quote exposure client must be an object");
  for (const method of ["call", "eval", "ping", "info", "xlen", "wait", "quit"] as const) {
    if (typeof client[method] !== "function") {
      throw new Error(`Redis quote exposure client.${method} must be a function`);
    }
  }
}

export function assertRedisQuoteExposureObserver(
  observer: unknown,
): asserts observer is RedisQuoteExposureLedgerObserver {
  if (!isRecord(observer)) throw new Error("Redis quote exposure observer must be an object");
  for (const method of [
    "recordLedgerMutation", "recordLedgerFailure", "recordLedgerLockWait",
    "recordLedgerBacklog", "recordPortfolioDeltaSoftBreach",
  ] as const) {
    if (typeof observer[method] !== "function") {
      throw new Error(`Redis quote exposure observer.${method} must be a function`);
    }
  }
}

export function assertRedisAofHealth(value: unknown): void {
  if (typeof value !== "string" || !/(?:^|\r?\n)aof_enabled:1(?:\r?\n|$)/.test(value) ||
      !/(?:^|\r?\n)aof_last_write_status:ok(?:\r?\n|$)/.test(value)) {
    throw new Error("Redis quote exposure requires healthy AOF persistence");
  }
}

export function parseRedisNonNegativeSafeInteger(value: unknown, field: string): number {
  const parsed = typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(parsed) || (parsed as number) < 0) {
    throw new Error(`Redis quote exposure ${field} must be a non-negative safe integer`);
  }
  return parsed as number;
}

export function assertSafeRedisQuoteExposureIdentifier(
  value: unknown,
  field: string,
): asserts value is string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_:-]{1,128}$/.test(value)) {
    throw new Error(`Redis quote exposure ${field} must be a safe identifier`);
  }
}

function assertStoredTreasury(value: unknown): void {
  if (!isRecord(value) || Object.keys(value).length !== 4 ||
      !["settlementAddress", "treasuryAddress", "availableBalance", "blockNumber"]
        .every((field) => Object.prototype.hasOwnProperty.call(value, field))) {
    throw new Error("Redis quote exposure reservation treasuryLiquidity is invalid");
  }
  assertNormalizedAddress(value.settlementAddress, "payload.treasuryLiquidity.settlementAddress");
  assertNormalizedAddress(value.treasuryAddress, "payload.treasuryLiquidity.treasuryAddress");
  assertUnsignedDecimal(value.availableBalance, "payload.treasuryLiquidity.availableBalance");
  assertUnsignedDecimal(value.blockNumber, "payload.treasuryLiquidity.blockNumber");
}

function assertNormalizedAddress(value: unknown, field: string): asserts value is `0x${string}` {
  if (typeof value !== "string" || !/^0x[0-9a-f]{40}$/.test(value)) {
    throw new Error(`Redis quote exposure ${field} must be a normalized address`);
  }
}

function assertPositiveDecimal(value: unknown, field: string): void {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`Redis quote exposure ${field} must be a positive decimal integer`);
  }
}

function assertUnsignedDecimal(value: unknown, field: string): void {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`Redis quote exposure ${field} must be an unsigned decimal integer`);
  }
}

function assertSignedDecimal(value: unknown, field: string): void {
  if (typeof value !== "string" || !/^(0|-?[1-9][0-9]*)$/.test(value)) {
    throw new Error(`Redis quote exposure ${field} must be a signed decimal integer`);
  }
}

function assertInteger(value: unknown, min: number, max: number, field: string): void {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`Redis quote exposure ${field} must be between ${min} and ${max}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
