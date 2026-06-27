import type {
  QuoteLifecycleStatus,
  QuoteRequest,
  QuoteResponse,
  QuoteStatusResponse,
  SignedQuote,
} from "../../shared/types/rfq.js";
import { APIError } from "../../shared/errors/api-error.js";
import type { InventoryService } from "../inventory/inventory.service.js";
import type { MarketDataService } from "../market-data/market-data.service.js";
import type { PricingEngine } from "../pricing/pricing.engine.js";
import type { QuoteRepository } from "./quote.repository.js";
import type { RiskEngine } from "../risk/risk.engine.js";
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

export class QuoteService {
  private readonly identityGenerator = new QuoteIdentityGenerator();

  constructor(private readonly deps: QuoteServiceDeps) {}

  async createQuote(request: QuoteRequest): Promise<QuoteResponse> {
    const snapshot = await this.deps.marketDataService.getSnapshot(request);
    const routePlan = await this.deps.routingEngine.selectRoute({ request, snapshot });
    const inventorySkewBps = this.deps.inventoryService.calculateQuoteSkewBps({
      chainId: request.chainId,
      token: request.tokenOut,
    });

    const pricing = await this.deps.pricingEngine.price({
      request,
      snapshot,
      routePlan,
      inventorySkewBps,
    });
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

    const risk = await this.deps.riskEngine.evaluate({ request, pricing, inventoryProjection });
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

    const signature = await this.deps.signerService.signQuote({
      quote: signedQuote,
      quoteId,
      snapshotId: snapshot.snapshotId,
    });

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

  async markQuoteStatus(quoteId: string, status: QuoteLifecycleStatus, txHash?: `0x${string}`): Promise<void> {
    await this.deps.quoteRepository.markStatus(quoteId, status, txHash);
  }

  async requireSubmittableSignedQuote(quote: SignedQuote, signature: `0x${string}`): Promise<string> {
    const record = await this.deps.quoteRepository.findSignedQuoteByUserNonce(quote.user, quote.nonce);
    if (!record || !isExactSignedQuote(record, quote)) {
      throw new APIError("QUOTE_NOT_FOUND", "Signed quote not found", 404);
    }
    if (record.status === "submitted" || record.status === "settled") {
      throw new APIError("QUOTE_ALREADY_USED", "Quote already used", 409);
    }

    const isValidSignature = await this.deps.signerService.verifyQuoteSignature(quote, signature);
    if (!isValidSignature) {
      throw new APIError("INVALID_SIGNATURE", "Quote signature is not from the trusted signer", 409);
    }

    return record.quoteId;
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
