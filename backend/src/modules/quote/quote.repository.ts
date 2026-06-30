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

    const current = this.records.get(input.quoteId);
    if (current) {
      assertCanSaveRequestedQuote(current, input);
      return;
    }

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
    assertCanSaveRejectedQuote(current, input);
    if (!current || current.status === "rejected") {
      return;
    }

    this.records.set(input.quoteId, {
      ...current,
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
    if (current) {
      assertCanSaveSignedQuote(current, input);
      if (current.status === "signed") {
        return;
      }
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
    assertCanMarkFailed(current, errorCode);
    if (current.status === "failed") {
      return;
    }

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
    assertQuoteStatusMetadataDoesNotConflict(current, metadata);
    assertSettlementStatusMetadata(current, status, metadata);
    const statusMetadata = mergeQuoteStatusMetadata(current, metadata);

    this.records.set(quoteId, {
      ...current,
      status,
      ...statusMetadata,
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

function assertCanMarkFailed(record: QuoteRecord, errorCode: string): void {
  if (record.status === "requested" || record.status === "signed") {
    return;
  }

  if (record.status === "failed") {
    if (record.rejectCode === errorCode) {
      return;
    }

    throw new Error(`Failed quote errorCode cannot be changed for ${record.quoteId}`);
  }

  if (record.status === "submitted" || record.status === "settled" || record.status === "expired") {
    throw new Error(`Quote ${record.quoteId} cannot transition from ${record.status} to failed`);
  }

  throw new Error(`Quote ${record.quoteId} cannot transition from terminal status ${record.status} to failed`);
}

function assertCanSaveRequestedQuote(record: QuoteRecord, input: SaveRequestedQuoteInput): void {
  if (record.status === "requested") {
    if (isSameRequestedQuotePayload(record, input)) {
      return;
    }

    throw new Error(`Requested quote payload cannot be changed for ${input.quoteId}`);
  }

  throw new Error(`Quote ${input.quoteId} cannot save requested quote from ${record.status}`);
}

function assertCanSaveRejectedQuote(record: QuoteRecord | undefined, input: SaveRejectedQuoteInput): void {
  if (!record) {
    throw new Error(`Quote ${input.quoteId} cannot save rejected quote without requested state`);
  }

  if (record.status === "requested") {
    if (isSameRequestedQuotePayload(record, input)) {
      return;
    }

    throw new Error(`Rejected quote request cannot differ from requested quote ${input.quoteId}`);
  }

  if (record.status === "rejected") {
    if (isSameRejectedQuotePayload(record, input)) {
      return;
    }

    throw new Error(`Rejected quote payload cannot be changed for ${input.quoteId}`);
  }

  throw new Error(`Quote ${input.quoteId} cannot save rejected quote from ${record.status}`);
}

function assertCanSaveSignedQuote(record: QuoteRecord, input: SaveSignedQuoteInput): void {
  if (record.status === "requested") {
    if (isSameRequestedQuotePayloadAsSigned(record, input)) {
      return;
    }

    throw new Error(`Signed quote request cannot differ from requested quote ${input.quoteId}`);
  }

  if (record.status === "signed") {
    if (isSameSignedQuotePayload(record, input)) {
      return;
    }

    throw new Error(`Signed quote payload cannot be changed for ${input.quoteId}`);
  }

  throw new Error(`Quote ${input.quoteId} cannot save signed quote from ${record.status}`);
}

function isSameRequestedQuotePayload(record: QuoteRecord, input: SaveRequestedQuoteInput | SaveRejectedQuoteInput): boolean {
  return (
    record.quoteId === input.quoteId &&
    record.chainId === input.request.chainId &&
    record.user.toLowerCase() === input.request.user.toLowerCase() &&
    record.tokenIn.toLowerCase() === input.request.tokenIn.toLowerCase() &&
    record.tokenOut.toLowerCase() === input.request.tokenOut.toLowerCase() &&
    record.amountIn === input.request.amountIn &&
    record.snapshotId === input.snapshotId
  );
}

function isSameRejectedQuotePayload(record: QuoteRecord, input: SaveRejectedQuoteInput): boolean {
  return (
    isSameRequestedQuotePayload(record, input) &&
    record.rejectCode === input.rejectCode &&
    record.riskPolicyVersion === input.riskPolicyVersion
  );
}

function isSameRequestedQuotePayloadAsSigned(record: QuoteRecord, input: SaveSignedQuoteInput): boolean {
  return (
    record.quoteId === input.quoteId &&
    record.chainId === input.quote.chainId &&
    record.user.toLowerCase() === input.quote.user.toLowerCase() &&
    record.tokenIn.toLowerCase() === input.quote.tokenIn.toLowerCase() &&
    record.tokenOut.toLowerCase() === input.quote.tokenOut.toLowerCase() &&
    record.amountIn === input.quote.amountIn &&
    record.snapshotId === input.snapshotId
  );
}

function isSameSignedQuotePayload(record: QuoteRecord, input: SaveSignedQuoteInput): boolean {
  return (
    record.quoteId === input.quoteId &&
    record.chainId === input.quote.chainId &&
    record.user.toLowerCase() === input.quote.user.toLowerCase() &&
    record.tokenIn.toLowerCase() === input.quote.tokenIn.toLowerCase() &&
    record.tokenOut.toLowerCase() === input.quote.tokenOut.toLowerCase() &&
    record.amountIn === input.quote.amountIn &&
    record.amountOut === input.quote.amountOut &&
    record.minAmountOut === input.quote.minAmountOut &&
    record.nonce === input.quote.nonce &&
    record.deadline === input.quote.deadline &&
    record.snapshotId === input.snapshotId &&
    record.pricingVersion === input.pricingVersion &&
    record.riskPolicyVersion === input.riskPolicyVersion &&
    record.signature?.toLowerCase() === input.signature.toLowerCase()
  );
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

function assertQuoteStatusMetadataDoesNotConflict(record: QuoteRecord, metadata: QuoteStatusMetadata | undefined): void {
  if (!metadata) {
    return;
  }

  assertMetadataFieldDoesNotConflict(record.txHash, metadata.txHash, "txHash", (left, right) => {
    return left.toLowerCase() === right.toLowerCase();
  });
  assertMetadataFieldDoesNotConflict(record.settlementEventId, metadata.settlementEventId, "settlementEventId");
  assertMetadataFieldDoesNotConflict(record.hedgeOrderId, metadata.hedgeOrderId, "hedgeOrderId");
  assertMetadataFieldDoesNotConflict(record.pnlId, metadata.pnlId, "pnlId");
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

function mergeQuoteStatusMetadata(record: QuoteRecord, metadata: QuoteStatusMetadata | undefined): QuoteStatusMetadata {
  return {
    txHash: record.txHash ?? metadata?.txHash,
    settlementEventId: record.settlementEventId ?? metadata?.settlementEventId,
    hedgeOrderId: record.hedgeOrderId ?? metadata?.hedgeOrderId,
    pnlId: record.pnlId ?? metadata?.pnlId,
  };
}

function assertMetadataFieldDoesNotConflict(
  currentValue: string | undefined,
  nextValue: string | undefined,
  field: keyof QuoteStatusMetadata,
  compare: (left: string, right: string) => boolean = (left, right) => left === right,
): void {
  if (currentValue !== undefined && nextValue !== undefined && !compare(currentValue, nextValue)) {
    throw new Error(`Quote status ${field} cannot be changed once set`);
  }
}

function assertNonEmptyMetadataString(value: string, field: keyof QuoteStatusMetadata): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Quote status ${field} must be a non-empty string`);
  }
}
