import type {
  Address,
  QuoteLifecycleStatus,
  QuoteRequest,
  QuoteStatusResponse,
  SignedQuote,
  UIntString,
} from "../../shared/types/rfq.js";

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
    const current = this.records.get(input.quoteId);
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
    this.quoteIdsByChainUserNonce.set(
      this.chainUserNonceKey(input.quote.chainId, input.quote.user, input.quote.nonce),
      input.quoteId,
    );
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

  async findSignedQuoteByChainUserNonce(
    chainId: number,
    user: Address,
    nonce: UIntString,
  ): Promise<QuoteRecord | undefined> {
    const quoteId = await this.findQuoteIdByChainUserNonce(chainId, user, nonce);
    if (!quoteId) return undefined;

    return this.records.get(quoteId);
  }

  private chainUserNonceKey(chainId: number, user: Address, nonce: UIntString): string {
    return `${chainId}:${user.toLowerCase()}:${nonce}`;
  }
}
