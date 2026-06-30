import type {
  Address,
  QuoteLifecycleStatus,
  QuoteRequest,
  QuoteStatusResponse,
  SignedQuote,
  UIntString,
} from "../../shared/types/rfq.js";

const SECP256K1N_HALF = BigInt("0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0");

export interface QuoteRecord {
  quoteId: string;
  chainId: number;
  user: Address;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: UIntString;
  amountOut?: UIntString;
  minAmountOut?: UIntString;
  nonce?: UIntString;
  deadline?: number;
  snapshotId?: string;
  pricingVersion?: string;
  riskPolicyVersion?: string;
  status: QuoteLifecycleStatus;
  signature?: `0x${string}`;
  rejectCode?: string;
  txHash?: `0x${string}`;
  settlementEventId?: string;
  hedgeOrderId?: string;
  pnlId?: string;
}

export interface QuoteStatusMetadata {
  txHash?: `0x${string}`;
  settlementEventId?: string;
  hedgeOrderId?: string;
  pnlId?: string;
}

export interface QuoteRepository {
  checkHealth?(): Promise<void>;
  saveRequested(input: SaveRequestedQuoteInput): Promise<void>;
  saveRejected(input: SaveRejectedQuoteInput): Promise<void>;
  saveSigned(input: SaveSignedQuoteInput): Promise<void>;
  findStatus(quoteId: string): Promise<QuoteStatusResponse | undefined>;
  markFailed(quoteId: string, errorCode: string): Promise<void>;
  markStatus(quoteId: string, status: QuoteLifecycleStatus, metadata?: QuoteStatusMetadata): Promise<void>;
  findSignedQuoteByQuoteId(quoteId: string): Promise<QuoteRecord | undefined>;
  findQuoteIdByChainUserNonce(chainId: number, user: Address, nonce: UIntString): Promise<string | undefined>;
  findSignedQuoteByChainUserNonce(chainId: number, user: Address, nonce: UIntString): Promise<QuoteRecord | undefined>;
}

export interface SaveRequestedQuoteInput {
  quoteId: string;
  request: QuoteRequest;
  snapshotId: string;
}

export interface SaveRejectedQuoteInput {
  quoteId: string;
  request: QuoteRequest;
  snapshotId: string;
  rejectCode: string;
  riskPolicyVersion?: string;
}

export interface SaveSignedQuoteInput {
  quoteId: string;
  snapshotId: string;
  quote: SignedQuote;
  pricingVersion: string;
  riskPolicyVersion: string;
  signature: `0x${string}`;
}

export class InMemoryQuoteRepository implements QuoteRepository {
  private readonly records = new Map<string, QuoteRecord>();
  private readonly quoteIdsByChainUserNonce = new Map<string, string>();

  async checkHealth(): Promise<void> {
    await this.findStatus("__readiness_probe__");
  }

  async saveRequested(input: SaveRequestedQuoteInput): Promise<void> {
    assertRequestedQuoteInput(input);

    this.records.set(input.quoteId, {
      quoteId: input.quoteId,
      chainId: input.request.chainId,
      user: input.request.user,
      tokenIn: input.request.tokenIn,
      tokenOut: input.request.tokenOut,
      amountIn: input.request.amountIn,
      snapshotId: input.snapshotId,
      status: "requested",
    });
  }

  async saveRejected(input: SaveRejectedQuoteInput): Promise<void> {
    assertRejectedQuoteInput(input);

    const current = this.records.get(input.quoteId);
    this.records.set(input.quoteId, {
      ...(current ?? {}),
      quoteId: input.quoteId,
      chainId: input.request.chainId,
      user: input.request.user,
      tokenIn: input.request.tokenIn,
      tokenOut: input.request.tokenOut,
      amountIn: input.request.amountIn,
      snapshotId: input.snapshotId,
      status: "rejected",
      rejectCode: input.rejectCode,
      riskPolicyVersion: input.riskPolicyVersion,
    });
  }

  async saveSigned(input: SaveSignedQuoteInput): Promise<void> {
    assertSignedQuoteInput(input);

    const current = this.records.get(input.quoteId);
    const key = this.chainUserNonceKey(input.quote.chainId, input.quote.user, input.quote.nonce);
    const existingQuoteId = this.quoteIdsByChainUserNonce.get(key);
    if (existingQuoteId && existingQuoteId !== input.quoteId) {
      throw new Error(`Signed quote nonce key already exists for ${existingQuoteId}`);
    }
    if (current?.nonce && !this.isSameSignedQuoteIdentity(current, input.quote)) {
      throw new Error(`Signed quote identity cannot be changed for ${input.quoteId}`);
    }

    this.records.set(input.quoteId, {
      ...(current ?? {}),
      quoteId: input.quoteId,
      chainId: input.quote.chainId,
      user: input.quote.user,
      tokenIn: input.quote.tokenIn,
      tokenOut: input.quote.tokenOut,
      amountIn: input.quote.amountIn,
      amountOut: input.quote.amountOut,
      minAmountOut: input.quote.minAmountOut,
      nonce: input.quote.nonce,
      deadline: input.quote.deadline,
      snapshotId: input.snapshotId,
      pricingVersion: input.pricingVersion,
      riskPolicyVersion: input.riskPolicyVersion,
      status: "signed",
      signature: input.signature,
    });
    this.quoteIdsByChainUserNonce.set(key, input.quoteId);
  }

  async findStatus(quoteId: string): Promise<QuoteStatusResponse | undefined> {
    const record = this.records.get(quoteId);
    if (!record) return undefined;

    return {
      quoteId: record.quoteId,
      status: record.status,
      snapshotId: record.snapshotId,
      deadline: record.deadline,
      txHash: record.txHash,
      settlementEventId: record.settlementEventId,
      hedgeOrderId: record.hedgeOrderId,
      pnlId: record.pnlId,
      errorCode: record.rejectCode,
    };
  }

  async markFailed(quoteId: string, errorCode: string): Promise<void> {
    const current = this.records.get(quoteId);
    if (!current) {
      return;
    }
    assertNonEmptyString(errorCode, "errorCode", "Failed quote");
    assertCanMarkFailed(current);

    this.records.set(quoteId, {
      ...current,
      status: "failed",
      rejectCode: errorCode,
    });
  }

  async markStatus(quoteId: string, status: QuoteLifecycleStatus, metadata?: QuoteStatusMetadata): Promise<void> {
    const current = this.records.get(quoteId);
    if (!current) {
      return;
    }
    assertStatusTransition(current, status);
    assertQuoteStatusMetadata(metadata);
    assertSettlementStatusMetadata(current, status, metadata);

    this.records.set(quoteId, {
      ...current,
      status,
      txHash: metadata?.txHash ?? current.txHash,
      settlementEventId: metadata?.settlementEventId ?? current.settlementEventId,
      hedgeOrderId: metadata?.hedgeOrderId ?? current.hedgeOrderId,
      pnlId: metadata?.pnlId ?? current.pnlId,
    });
  }

  async findQuoteIdByChainUserNonce(
    chainId: number,
    user: Address,
    nonce: UIntString,
  ): Promise<string | undefined> {
    return this.quoteIdsByChainUserNonce.get(this.chainUserNonceKey(chainId, user, nonce));
  }

  async findSignedQuoteByQuoteId(quoteId: string): Promise<QuoteRecord | undefined> {
    const record = this.records.get(quoteId);
    if (!record?.nonce || !record.amountOut || !record.minAmountOut || !record.deadline || !record.signature) {
      return undefined;
    }

    return cloneQuoteRecord(record);
  }

  async findSignedQuoteByChainUserNonce(
    chainId: number,
    user: Address,
    nonce: UIntString,
  ): Promise<QuoteRecord | undefined> {
    const quoteId = await this.findQuoteIdByChainUserNonce(chainId, user, nonce);
    if (!quoteId) return undefined;

    return this.findSignedQuoteByQuoteId(quoteId);
  }

  private chainUserNonceKey(chainId: number, user: Address, nonce: UIntString): string {
    return `${chainId}:${user.toLowerCase()}:${nonce}`;
  }

  private isSameSignedQuoteIdentity(record: QuoteRecord, quote: SignedQuote): boolean {
    return (
      record.chainId === quote.chainId &&
      record.user.toLowerCase() === quote.user.toLowerCase() &&
      record.nonce === quote.nonce
    );
  }
}

function cloneQuoteRecord(record: QuoteRecord): QuoteRecord {
  return { ...record };
}

function assertRequestedQuoteInput(input: SaveRequestedQuoteInput): void {
  assertNonEmptyString(input.quoteId, "quoteId", "Requested quote");
  assertNonEmptyString(input.snapshotId, "snapshotId", "Requested quote");
  assertQuoteRequest(input.request, "Requested quote");
}

function assertRejectedQuoteInput(input: SaveRejectedQuoteInput): void {
  assertNonEmptyString(input.quoteId, "quoteId", "Rejected quote");
  assertNonEmptyString(input.snapshotId, "snapshotId", "Rejected quote");
  assertNonEmptyString(input.rejectCode, "rejectCode", "Rejected quote");
  if (input.riskPolicyVersion !== undefined) {
    assertNonEmptyString(input.riskPolicyVersion, "riskPolicyVersion", "Rejected quote");
  }
  assertQuoteRequest(input.request, "Rejected quote");
}

function assertQuoteRequest(request: QuoteRequest, subject: "Requested quote" | "Rejected quote"): void {
  assertPositiveSafeInteger(request.chainId, "request.chainId", subject);
  assertAddress(request.user, "request.user", subject);
  assertAddress(request.tokenIn, "request.tokenIn", subject);
  assertAddress(request.tokenOut, "request.tokenOut", subject);

  if (request.tokenIn.toLowerCase() === request.tokenOut.toLowerCase()) {
    throw new Error(`${subject} request token pair must contain distinct tokens`);
  }

  assertPositiveUIntString(request.amountIn, "request.amountIn", subject);
  assertNonNegativeBps(request.slippageBps, "request.slippageBps", subject);
}

function assertSignedQuoteInput(input: SaveSignedQuoteInput): void {
  assertNonEmptyString(input.quoteId, "quoteId");
  assertNonEmptyString(input.snapshotId, "snapshotId");
  assertNonEmptyString(input.pricingVersion, "pricingVersion");
  assertNonEmptyString(input.riskPolicyVersion, "riskPolicyVersion");
  assertSignature(input.signature);
  assertPositiveSafeInteger(input.quote.chainId, "quote.chainId");
  assertAddress(input.quote.user, "quote.user");
  assertAddress(input.quote.tokenIn, "quote.tokenIn");
  assertAddress(input.quote.tokenOut, "quote.tokenOut");

  if (input.quote.tokenIn.toLowerCase() === input.quote.tokenOut.toLowerCase()) {
    throw new Error("Signed quote token pair must contain distinct tokens");
  }

  assertPositiveUIntString(input.quote.amountIn, "quote.amountIn");
  assertPositiveUIntString(input.quote.amountOut, "quote.amountOut");
  assertPositiveUIntString(input.quote.minAmountOut, "quote.minAmountOut");
  assertPositiveUIntString(input.quote.nonce, "quote.nonce");
  assertPositiveSafeInteger(input.quote.deadline, "quote.deadline");

  if (BigInt(input.quote.amountOut) < BigInt(input.quote.minAmountOut)) {
    throw new Error("Signed quote amountOut must be greater than or equal to minAmountOut");
  }
}

function assertNonEmptyString(value: string, field: string, subject = "Signed quote"): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${subject} ${field} must be a non-empty string`);
  }
}

function assertAddress(value: string, field: string, subject = "Signed quote"): void {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`${subject} ${field} must be a 20-byte hex address`);
  }
}

function assertPositiveUIntString(value: string, field: string, subject = "Signed quote"): void {
  if (!/^[0-9]+$/.test(value) || BigInt(value) <= 0n) {
    throw new Error(`${subject} ${field} must be a positive uint string`);
  }
}

function assertPositiveSafeInteger(value: number, field: string, subject = "Signed quote"): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${subject} ${field} must be a positive safe integer`);
  }
}

function assertNonNegativeBps(value: number, field: string, subject: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${subject} ${field} must be a non-negative safe integer`);
  }

  if (value > 10_000) {
    throw new Error(`${subject} ${field} must be less than or equal to 10000 bps`);
  }
}

function assertSignature(value: `0x${string}`): void {
  if (!/^0x[0-9a-fA-F]{130}$/.test(value)) {
    throw new Error("Signed quote signature must be a 65-byte hex string");
  }

  const s = BigInt(`0x${value.slice(66, 130)}`);
  if (s > SECP256K1N_HALF) {
    throw new Error("Signed quote signature s value must be in the lower half order");
  }

  const v = Number.parseInt(value.slice(130, 132), 16);
  const normalizedV = v < 27 ? v + 27 : v;
  if (normalizedV !== 27 && normalizedV !== 28) {
    throw new Error("Signed quote signature v value must be 27 or 28");
  }
}

function assertCanMarkFailed(record: QuoteRecord): void {
  if (record.status === "submitted" || record.status === "settled" || record.status === "expired") {
    throw new Error(`Quote ${record.quoteId} cannot transition from ${record.status} to failed`);
  }
}

function assertStatusTransition(record: QuoteRecord, nextStatus: QuoteLifecycleStatus): void {
  if (record.status === "requested") {
    throw new Error(`Quote ${record.quoteId} cannot transition from requested to ${nextStatus} through markStatus`);
  }

  if (record.status === "expired") {
    if (nextStatus === "expired") {
      return;
    }

    throw new Error(`Quote ${record.quoteId} cannot transition from terminal status expired to ${nextStatus}`);
  }

  if (record.status === "failed" || record.status === "rejected") {
    throw new Error(`Quote ${record.quoteId} cannot transition from terminal status ${record.status} to ${nextStatus}`);
  }

  if (record.status === "signed") {
    if (nextStatus === "submitted" || nextStatus === "settled" || nextStatus === "expired") {
      return;
    }

    throw new Error(`Quote ${record.quoteId} cannot transition from signed to ${nextStatus} through markStatus`);
  }

  if (record.status === "submitted") {
    if (nextStatus === "settled") {
      return;
    }

    throw new Error(`Quote ${record.quoteId} cannot transition from submitted to ${nextStatus}`);
  }

  if (record.status === "settled" && nextStatus !== "settled") {
    throw new Error(`Quote ${record.quoteId} cannot transition from settled to ${nextStatus}`);
  }
}

function assertQuoteStatusMetadata(metadata: QuoteStatusMetadata | undefined): void {
  if (!metadata) {
    return;
  }

  if (metadata.txHash !== undefined && !/^0x[0-9a-fA-F]{64}$/.test(metadata.txHash)) {
    throw new Error("Quote status txHash must be a 32-byte hex string");
  }

  if (metadata.settlementEventId !== undefined) {
    assertNonEmptyMetadataString(metadata.settlementEventId, "settlementEventId");
  }

  if (metadata.hedgeOrderId !== undefined) {
    assertNonEmptyMetadataString(metadata.hedgeOrderId, "hedgeOrderId");
  }

  if (metadata.pnlId !== undefined) {
    assertNonEmptyMetadataString(metadata.pnlId, "pnlId");
  }
}

function assertSettlementStatusMetadata(
  record: QuoteRecord,
  nextStatus: QuoteLifecycleStatus,
  metadata: QuoteStatusMetadata | undefined,
): void {
  if (nextStatus !== "submitted" && nextStatus !== "settled") {
    return;
  }

  const txHash = metadata?.txHash ?? record.txHash;
  const settlementEventId = metadata?.settlementEventId ?? record.settlementEventId;
  if (txHash === undefined) {
    throw new Error(`Quote ${record.quoteId} ${nextStatus} status requires txHash`);
  }
  if (settlementEventId === undefined) {
    throw new Error(`Quote ${record.quoteId} ${nextStatus} status requires settlementEventId`);
  }
}

function assertNonEmptyMetadataString(value: string, field: keyof QuoteStatusMetadata): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Quote status ${field} must be a non-empty string`);
  }
}
