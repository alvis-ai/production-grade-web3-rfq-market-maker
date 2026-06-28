import { RFQClient } from "@rfq-market-maker/sdk";
import type { Quote, QuoteRequest, QuoteResponse } from "@rfq-market-maker/sdk";
import { rfqApiBaseUrl } from "./config";

export const rfqClient = new RFQClient(rfqApiBaseUrl);

export function buildQuoteFromResponse(request: QuoteRequest, response: QuoteResponse): Quote {
  return {
    user: request.user,
    tokenIn: request.tokenIn,
    tokenOut: request.tokenOut,
    amountIn: request.amountIn,
    amountOut: response.amountOut,
    minAmountOut: response.minAmountOut,
    nonce: response.nonce,
    deadline: response.deadline,
    chainId: request.chainId,
  };
}
