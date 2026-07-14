import type {
  HedgeIntentStatus,
  PnlSummary,
  QuoteStatus,
  SettlementEventStatus,
  SubmitQuoteResponse,
} from "@rfq-market-maker/sdk";

const safeIdentifierPattern = /^[A-Za-z0-9_:-]+$/;

export interface QuoteLifecycleClient {
  getQuote(quoteId: string): Promise<QuoteStatus>;
  getSettlement(settlementEventId: string): Promise<SettlementEventStatus>;
  getHedge(hedgeOrderId: string): Promise<HedgeIntentStatus>;
  pnl(): Promise<PnlSummary>;
}

export interface QuoteLifecycleSnapshot {
  quoteStatus: QuoteStatus;
  settlementEventId?: string;
  hedgeOrderId?: string;
  pnlId?: string;
  settlementStatus?: SettlementEventStatus;
  hedgeStatus?: HedgeIntentStatus;
  pnlSummary?: PnlSummary;
  resourceErrors?: QuoteLifecycleResourceErrors;
}

export interface QuoteLifecycleResourceErrors {
  settlement?: unknown;
  hedge?: unknown;
  pnl?: unknown;
}

export interface PollQuoteLifecycleOptions {
  load: () => Promise<QuoteLifecycleSnapshot>;
  onUpdate: (snapshot: QuoteLifecycleSnapshot) => void | Promise<void>;
  onError: (error: unknown) => void;
  signal: AbortSignal;
  baseDelayMs?: number;
  maxDelayMs?: number;
  wait?: (delayMs: number, signal: AbortSignal) => Promise<boolean>;
}

export async function loadQuoteLifecycle(
  client: QuoteLifecycleClient,
  quoteId: string,
  fallback?: SubmitQuoteResponse,
): Promise<QuoteLifecycleSnapshot> {
  assertClient(client);
  assertSafeIdentifier(quoteId, "quoteId");
  assertFallback(fallback);

  const quoteStatus = await client.getQuote(quoteId);
  if (quoteStatus.quoteId !== quoteId) {
    throw new Error("Quote lifecycle response quoteId does not match the requested quote");
  }

  const settlementEventId = quoteStatus.settlementEventId ?? fallback?.settlementEventId;
  const hedgeOrderId = quoteStatus.hedgeOrderId ?? fallback?.hedgeOrderId;
  const pnlId = quoteStatus.pnlId ?? fallback?.pnlId;
  const settlementPromise: Promise<SettlementEventStatus | undefined> = settlementEventId
    ? client.getSettlement(settlementEventId)
    : Promise.resolve(undefined);
  const hedgePromise: Promise<HedgeIntentStatus | undefined> = hedgeOrderId
    ? client.getHedge(hedgeOrderId)
    : Promise.resolve(undefined);
  const pnlPromise: Promise<PnlSummary | undefined> = pnlId
    ? client.pnl()
    : Promise.resolve(undefined);
  const [settlementResult, hedgeResult, pnlResult] = await Promise.allSettled([
    settlementPromise,
    hedgePromise,
    pnlPromise,
  ]);
  const resourceErrors: QuoteLifecycleResourceErrors = {};
  let settlementStatus = fulfilledValue(settlementResult, "settlement", resourceErrors);
  let hedgeStatus = fulfilledValue(hedgeResult, "hedge", resourceErrors);
  const pnlSummary = fulfilledValue(pnlResult, "pnl", resourceErrors);

  if (settlementEventId && resourceErrors.settlement === undefined &&
      settlementStatus?.settlementEventId !== settlementEventId) {
    resourceErrors.settlement = new Error(
      "Quote lifecycle settlement response does not match the requested settlement",
    );
    settlementStatus = undefined;
  }
  if (hedgeOrderId && resourceErrors.hedge === undefined && hedgeStatus?.hedgeOrderId !== hedgeOrderId) {
    resourceErrors.hedge = new Error("Quote lifecycle hedge response does not match the requested hedge");
    hedgeStatus = undefined;
  }

  return {
    quoteStatus,
    ...(settlementEventId ? { settlementEventId } : {}),
    ...(hedgeOrderId ? { hedgeOrderId } : {}),
    ...(pnlId ? { pnlId } : {}),
    ...(settlementStatus ? { settlementStatus } : {}),
    ...(hedgeStatus ? { hedgeStatus } : {}),
    ...(pnlSummary ? { pnlSummary } : {}),
    ...(hasResourceErrors(resourceErrors) ? { resourceErrors } : {}),
  };
}

export function firstQuoteLifecycleResourceError(snapshot: QuoteLifecycleSnapshot): unknown | undefined {
  assertSnapshot(snapshot);
  return snapshot.resourceErrors?.settlement ?? snapshot.resourceErrors?.hedge ?? snapshot.resourceErrors?.pnl;
}

export function isQuoteLifecycleComplete(snapshot: QuoteLifecycleSnapshot): boolean {
  assertSnapshot(snapshot);
  const {
    quoteStatus,
    settlementEventId,
    hedgeOrderId,
    pnlId,
    settlementStatus,
    hedgeStatus,
    pnlSummary,
  } = snapshot;
  if (["rejected", "expired", "failed"].includes(quoteStatus.status)) return true;
  if (quoteStatus.status !== "settled") return false;

  const resolvedSettlementEventId = settlementEventId ?? quoteStatus.settlementEventId;
  const resolvedHedgeOrderId = hedgeOrderId ?? quoteStatus.hedgeOrderId;
  const resolvedPnlId = pnlId ?? quoteStatus.pnlId;
  if (resolvedSettlementEventId && !settlementStatus) return false;
  if (resolvedPnlId && !pnlSummary?.trades.some((trade) => trade.pnlId === resolvedPnlId)) {
    return false;
  }
  if (resolvedHedgeOrderId) {
    if (!hedgeStatus || hedgeStatus.hedgeOrderId !== resolvedHedgeOrderId) return false;
    if (hedgeStatus.status === "queued") return false;
    if (hedgeStatus.status === "filled" && hedgeStatus.feeReconciliationStatus === "pending") return false;
  }

  return true;
}

export async function pollQuoteLifecycle(options: PollQuoteLifecycleOptions): Promise<void> {
  assertPollOptions(options);
  const baseDelayMs = options.baseDelayMs ?? 1_000;
  const maxDelayMs = options.maxDelayMs ?? 8_000;
  const wait = options.wait ?? waitForDelay;
  let consecutiveWaits = 0;

  while (!options.signal.aborted) {
    try {
      const snapshot = await options.load();
      if (options.signal.aborted) return;
      await options.onUpdate(snapshot);
      if (options.signal.aborted || isQuoteLifecycleComplete(snapshot)) return;
      const resourceError = firstQuoteLifecycleResourceError(snapshot);
      if (resourceError !== undefined) options.onError(resourceError);
    } catch (error) {
      if (options.signal.aborted) return;
      options.onError(error);
    }

    consecutiveWaits += 1;
    const delayMs = nextQuoteLifecyclePollDelayMs(consecutiveWaits, baseDelayMs, maxDelayMs);
    if (!await wait(delayMs, options.signal)) return;
  }
}

export function nextQuoteLifecyclePollDelayMs(
  consecutiveWaits: number,
  baseDelayMs = 1_000,
  maxDelayMs = 8_000,
): number {
  assertNonNegativeSafeInteger(consecutiveWaits, "consecutiveWaits");
  assertPositiveSafeInteger(baseDelayMs, "baseDelayMs");
  assertPositiveSafeInteger(maxDelayMs, "maxDelayMs");
  if (baseDelayMs > maxDelayMs) throw new Error("Quote lifecycle baseDelayMs must not exceed maxDelayMs");

  const exponent = Math.min(Math.max(0, consecutiveWaits - 1), 30);
  return Math.min(maxDelayMs, baseDelayMs * (2 ** exponent));
}

async function waitForDelay(delayMs: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return false;
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", handleAbort);
      resolve(true);
    }, delayMs);
    function handleAbort() {
      window.clearTimeout(timer);
      resolve(false);
    }
    signal.addEventListener("abort", handleAbort, { once: true });
  });
}

function assertClient(value: unknown): asserts value is QuoteLifecycleClient {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Quote lifecycle client must be an object");
  }
  for (const method of ["getQuote", "getSettlement", "getHedge", "pnl"] as const) {
    if (typeof (value as Record<string, unknown>)[method] !== "function") {
      throw new Error(`Quote lifecycle client.${method} must be a function`);
    }
  }
}

function fulfilledValue<T>(
  result: PromiseSettledResult<T>,
  resource: keyof QuoteLifecycleResourceErrors,
  errors: QuoteLifecycleResourceErrors,
): T | undefined {
  if (result.status === "fulfilled") return result.value;
  errors[resource] = result.reason;
  return undefined;
}

function hasResourceErrors(errors: QuoteLifecycleResourceErrors): boolean {
  return errors.settlement !== undefined || errors.hedge !== undefined || errors.pnl !== undefined;
}

function assertFallback(value: SubmitQuoteResponse | undefined): void {
  if (value === undefined) return;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Quote lifecycle fallback must be an object");
  }
  for (const field of ["settlementEventId", "hedgeOrderId", "pnlId"] as const) {
    const candidate = value[field];
    if (candidate !== undefined) assertSafeIdentifier(candidate, `fallback.${field}`);
  }
}

function assertSnapshot(value: QuoteLifecycleSnapshot): void {
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
      typeof value.quoteStatus !== "object" || value.quoteStatus === null) {
    throw new Error("Quote lifecycle snapshot must include quoteStatus");
  }
}

function assertPollOptions(value: PollQuoteLifecycleOptions): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Quote lifecycle poll options must be an object");
  }
  for (const method of ["load", "onUpdate", "onError"] as const) {
    if (typeof value[method] !== "function") {
      throw new Error(`Quote lifecycle poll options.${method} must be a function`);
    }
  }
  if (!(value.signal instanceof AbortSignal)) {
    throw new Error("Quote lifecycle poll options.signal must be an AbortSignal");
  }
  if (value.wait !== undefined && typeof value.wait !== "function") {
    throw new Error("Quote lifecycle poll options.wait must be a function when provided");
  }
  if (value.baseDelayMs !== undefined) assertPositiveSafeInteger(value.baseDelayMs, "baseDelayMs");
  if (value.maxDelayMs !== undefined) assertPositiveSafeInteger(value.maxDelayMs, "maxDelayMs");
  if (value.baseDelayMs !== undefined && value.maxDelayMs !== undefined && value.baseDelayMs > value.maxDelayMs) {
    throw new Error("Quote lifecycle baseDelayMs must not exceed maxDelayMs");
  }
}

function assertSafeIdentifier(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.length < 1 || value.length > 128 || !safeIdentifierPattern.test(value)) {
    throw new Error(`Quote lifecycle ${label} must be a 1-128 character safe identifier`);
  }
}

function assertPositiveSafeInteger(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Quote lifecycle ${label} must be a positive safe integer`);
  }
}

function assertNonNegativeSafeInteger(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Quote lifecycle ${label} must be a non-negative safe integer`);
  }
}
