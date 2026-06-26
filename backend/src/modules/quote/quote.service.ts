import type { QuoteRequest, QuoteResponse, SignedQuote } from "../../shared/types/rfq.js";
import type { PricingEngine } from "../pricing/pricing.engine.js";
import type { RiskEngine } from "../risk/risk.engine.js";
import type { SignerService } from "../signer/signer.service.js";

export interface QuoteServiceDeps {
  pricingEngine: PricingEngine;
  riskEngine: RiskEngine;
  signerService: SignerService;
}

export class QuoteService {
  constructor(private readonly deps: QuoteServiceDeps) {}

  async createQuote(request: QuoteRequest): Promise<QuoteResponse> {
    const snapshot = {
      snapshotId: "snapshot_skeleton",
      midPrice: "1",
      liquidityUsd: "0",
      volatilityBps: 0,
      observedAt: new Date().toISOString(),
    };

    const pricing = await this.deps.pricingEngine.price({
      request,
      snapshot,
      inventorySkewBps: 0,
    });

    const risk = await this.deps.riskEngine.evaluate({ request, pricing });
    if (risk.status !== "approved") {
      throw new Error(`RFQ risk rejected: ${risk.reasonCode ?? "UNKNOWN"}`);
    }

    const deadline = Math.floor(Date.now() / 1000) + 30;
    const nonce = Date.now().toString();
    const signedQuote: SignedQuote = {
      user: request.user,
      tokenIn: request.tokenIn,
      tokenOut: request.tokenOut,
      amountIn: request.amountIn,
      amountOut: pricing.amountOut,
      minAmountOut: pricing.minAmountOut,
      nonce,
      deadline,
      chainId: request.chainId,
    };

    const quoteId = `q_${nonce}`;
    const signature = await this.deps.signerService.signQuote({
      quote: signedQuote,
      quoteId,
      snapshotId: snapshot.snapshotId,
    });

    return {
      quoteId,
      snapshotId: snapshot.snapshotId,
      amountOut: pricing.amountOut,
      minAmountOut: pricing.minAmountOut,
      deadline,
      nonce,
      signature,
    };
  }
}
