import type {
  QuoteLifecycleStatus,
  QuoteRequest,
  QuoteResponse,
  QuoteStatusResponse,
  MarketSnapshot,
  SignedQuote,
} from "../../shared/types/rfq.js";
import { APIError } from "../../shared/errors/api-error.js";
import type { InventoryService } from "../inventory/inventory.service.js";
import { getMarketSnapshotIssue, type MarketDataService } from "../market-data/market-data.service.js";
import type { PricingEngine, PricingResult } from "../pricing/pricing.engine.js";
import type { QuoteRepository } from "./quote.repository.js";
import type { RiskDecision, RiskEngine, RiskInput } from "../risk/risk.engine.js";
import type { RoutingEngine } from "../routing/routing.engine.js";
import type { SignerService } from "../signer/signer.service.js";
import { QuoteIdentityGenerator } from "./quote-identity.js";

export interface QuoteServiceDeps {
  inventoryService: InventoryService;
  marketDataService: MarketDataService;
  pricingEngine: PricingEngine;
  quoteRepository: QuoteRepository;
  riskEngine: RiskEngine;
  routingEngine: RoutingEngine;
  signerService: SignerService;
}

export interface QuoteServiceConfig {
  maxSnapshotAgeMs: number;
}

export const defaultQuoteServiceConfig: QuoteServiceConfig = {
  maxSnapshotAgeMs: 5_000,
};

export class QuoteService {
  private readonly identityGenerator = new QuoteIdentityGenerator();

  constructor(
    private readonly deps: QuoteServiceDeps,
    private readonly config: QuoteServiceConfig = defaultQuoteServiceConfig,
  ) {}

  async createQuote(request: QuoteRequest): Promise<QuoteResponse> {
    const snapshot = await this.deps.marketDataService.getSnapshot(request);
    assertUsableSnapshot(snapshot, this.config.maxSnapshotAgeMs);
    const routePlan = await this.deps.routingEngine.selectRoute({ request, snapshot });
    const inventorySkewBps = this.deps.inventoryService.calculateQuoteSkewBps({
      chainId: request.chainId,
      token: request.tokenOut,
    });

    let pricing: PricingResult;
    try {
      pricing = await this.deps.pricingEngine.price({
        request,
        snapshot,
        routePlan,
        inventorySkewBps,
      });
    } catch (error) {
      throw pricingFailure(error);
    }
    const inventoryProjection = this.deps.inventoryService.projectSettlement({
      chainId: request.chainId,
      tokenIn: request.tokenIn,
      tokenOut: request.tokenOut,
      amountIn: request.amountIn,
      amountOut: pricing.amountOut,
    });

    const identity = this.identityGenerator.next();
    const quoteId = identity.quoteId;
    await this.deps.quoteRepository.saveRequested({
      quoteId,
      snapshotId: snapshot.snapshotId,
      request,
    });

    const risk = await this.evaluateRisk({ request, pricing, inventoryProjection });
    if (risk.status !== "approved") {
      await this.deps.quoteRepository.saveRejected({
        quoteId,
        snapshotId: snapshot.snapshotId,
        request,
        rejectCode: risk.reasonCode ?? "RISK_REJECTED",
        riskPolicyVersion: risk.policyVersion,
      });
      throw new APIError(
        "RISK_REJECTED",
        "Quote rejected by risk policy",
        409,
        undefined,
        risk.reasonCode ?? "RISK_REJECTED",
      );
    }

    const deadline = Math.floor(Date.now() / 1000) + 30;
    const signedQuote: SignedQuote = {
      user: request.user,
      tokenIn: request.tokenIn,
      tokenOut: request.tokenOut,
      amountIn: request.amountIn,
      amountOut: pricing.amountOut,
      minAmountOut: pricing.minAmountOut,
      nonce: identity.nonce,
      deadline,
      chainId: request.chainId,
    };

    let signature: `0x${string}`;
    try {
      signature = await this.deps.signerService.signQuote({
        quote: signedQuote,
        quoteId,
        snapshotId: snapshot.snapshotId,
      });
    } catch (error) {
      await this.deps.quoteRepository.markFailed(quoteId, quoteFailureCode(error));
      throw error;
    }

    await this.deps.quoteRepository.saveSigned({
      quoteId,
      snapshotId: snapshot.snapshotId,
      quote: signedQuote,
      pricingVersion: pricing.pricingVersion,
      riskPolicyVersion: risk.policyVersion,
      signature,
    });

    return {
      quoteId,
      snapshotId: snapshot.snapshotId,
      amountOut: pricing.amountOut,
      minAmountOut: pricing.minAmountOut,
      deadline,
      nonce: identity.nonce,
      signature,
    };
  }

  async getQuoteStatus(quoteId: string): Promise<QuoteStatusResponse | undefined> {
    const status = await this.deps.quoteRepository.findStatus(quoteId);
    if (!status) return undefined;

    if (status.status === "signed" && status.deadline && status.deadline < Math.floor(Date.now() / 1000)) {
      return {
        ...status,
        status: "expired",
      };
    }

    return status;
  }

  private async evaluateRisk(input: RiskInput): Promise<RiskDecision> {
    try {
      return await this.deps.riskEngine.evaluate(input);
    } catch {
      return {
        status: "rejected",
        reasonCode: "RISK_ENGINE_UNAVAILABLE",
        policyVersion: "risk-engine-unavailable",
      } as const;
    }
  }

  async markQuoteStatus(quoteId: string, status: QuoteLifecycleStatus, txHash?: `0x${string}`): Promise<void> {
    await this.deps.quoteRepository.markStatus(quoteId, status, txHash);
  }

  async markQuoteFailed(quoteId: string, errorCode: string): Promise<void> {
    await this.deps.quoteRepository.markFailed(quoteId, errorCode);
  }

  async requireSubmittableSignedQuote(quote: SignedQuote, signature: `0x${string}`): Promise<string> {
    const record = await this.deps.quoteRepository.findSignedQuoteByUserNonce(quote.user, quote.nonce);
    if (!record || !isExactSignedQuote(record, quote)) {
      throw new APIError("QUOTE_NOT_FOUND", "Signed quote not found", 404);
    }
    if (record.status === "submitted" || record.status === "settled") {
      throw new APIError("QUOTE_ALREADY_USED", "Quote already used", 409);
    }
    if (record.status === "failed") {
      throw new APIError("QUOTE_FAILED", "Quote already failed", 409);
    }

    const isValidSignature = await this.deps.signerService.verifyQuoteSignature(quote, signature);
    if (!isValidSignature) {
      throw new APIError("INVALID_SIGNATURE", "Quote signature is not from the trusted signer", 409);
    }

    return record.quoteId;
  }
}

function quoteFailureCode(error: unknown): string {
  if (error instanceof APIError) {
    return error.code;
  }

  return "INTERNAL_ERROR";
}

function pricingFailure(error: unknown): APIError {
  if (error instanceof APIError) {
    return error;
  }

  return new APIError("PRICING_UNAVAILABLE", "Pricing engine unavailable", 503);
}

function assertUsableSnapshot(snapshot: MarketSnapshot, maxSnapshotAgeMs: number): void {
  const issue = getMarketSnapshotIssue(snapshot, maxSnapshotAgeMs);
  if (issue) {
    throw new APIError("MARKET_DATA_UNAVAILABLE", `Market data ${issue}`, 503);
  }
}

function isExactSignedQuote(
  record: {
    chainId: number;
    user: string;
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
    amountOut?: string;
    minAmountOut?: string;
    nonce?: string;
    deadline?: number;
  },
  quote: SignedQuote,
): boolean {
  return (
    record.chainId === quote.chainId &&
    record.user.toLowerCase() === quote.user.toLowerCase() &&
    record.tokenIn.toLowerCase() === quote.tokenIn.toLowerCase() &&
    record.tokenOut.toLowerCase() === quote.tokenOut.toLowerCase() &&
    record.amountIn === quote.amountIn &&
    record.amountOut === quote.amountOut &&
    record.minAmountOut === quote.minAmountOut &&
    record.nonce === quote.nonce &&
    record.deadline === quote.deadline
  );
}
