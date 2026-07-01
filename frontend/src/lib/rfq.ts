import { RFQClient } from "@rfq-market-maker/sdk";
import type { Quote, QuoteRequest, QuoteResponse } from "@rfq-market-maker/sdk";
import { rfqApiBaseUrl } from "./config";

let frontendTraceCounter = 0;

export function nextFrontendTraceId(): string {
  frontendTraceCounter = (frontendTraceCounter + 1) % Number.MAX_SAFE_INTEGER;
  return `tr_web_${Date.now().toString(36)}_${frontendTraceCounter.toString(36)}`;
}

export const rfqClient = new RFQClient(rfqApiBaseUrl, {
  traceId: nextFrontendTraceId,
});

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
