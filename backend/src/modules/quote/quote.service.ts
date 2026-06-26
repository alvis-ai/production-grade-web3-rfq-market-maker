import type {
  QuoteLifecycleStatus,
  QuoteRequest,
  QuoteResponse,
  QuoteStatusResponse,
  SignedQuote,
} from "../../shared/types/rfq.js";
import { APIError } from "../../shared/errors/api-error.js";
import type { MarketDataService } from "../market-data/market-data.service.js";
import type { PricingEngine } from "../pricing/pricing.engine.js";
import type { RiskEngine } from "../risk/risk.engine.js";
import type { RoutingEngine } from "../routing/routing.engine.js";
import type { SignerService } from "../signer/signer.service.js";

export interface QuoteServiceDeps {
  marketDataService: MarketDataService;
  pricingEngine: PricingEngine;
  riskEngine: RiskEngine;
  routingEngine: RoutingEngine;
  signerService: SignerService;
}

export class QuoteService {
  private readonly quoteStatuses = new Map<string, QuoteStatusResponse>();

  constructor(private readonly deps: QuoteServiceDeps) {}

  async createQuote(request: QuoteRequest): Promise<QuoteResponse> {
    const snapshot = await this.deps.marketDataService.getSnapshot(request);
    const routePlan = await this.deps.routingEngine.selectRoute({ request, snapshot });

    const pricing = await this.deps.pricingEngine.price({
      request,
      snapshot,
      routePlan,
      inventorySkewBps: 0,
    });

    const quoteId = `q_${Date.now().toString()}`;
    this.quoteStatuses.set(quoteId, {
      quoteId,
      snapshotId: snapshot.snapshotId,
      status: "requested",
    });

    const risk = await this.deps.riskEngine.evaluate({ request, pricing });
    if (risk.status !== "approved") {
      this.quoteStatuses.set(quoteId, {
        quoteId,
        snapshotId: snapshot.snapshotId,
        status: "rejected",
        errorCode: risk.reasonCode ?? "RISK_REJECTED",
      });
      throw new APIError("RISK_REJECTED", "Quote rejected by risk policy", 409);
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

    const signature = await this.deps.signerService.signQuote({
      quote: signedQuote,
      quoteId,
      snapshotId: snapshot.snapshotId,
    });

    this.quoteStatuses.set(quoteId, {
      quoteId,
      snapshotId: snapshot.snapshotId,
      status: "signed",
      deadline,
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

  getQuoteStatus(quoteId: string): QuoteStatusResponse | undefined {
    const status = this.quoteStatuses.get(quoteId);
    if (!status) return undefined;

    if (status.status === "signed" && status.deadline && status.deadline < Math.floor(Date.now() / 1000)) {
      return {
        ...status,
        status: "expired",
      };
    }

    return status;
  }

  markQuoteStatus(quoteId: string, status: QuoteLifecycleStatus, txHash?: `0x${string}`): void {
    const current = this.quoteStatuses.get(quoteId) ?? { quoteId, status };
    this.quoteStatuses.set(quoteId, {
      ...current,
      status,
      txHash,
    });
  }
}
