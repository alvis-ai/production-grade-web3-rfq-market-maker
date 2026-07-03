import { RFQClient } from "@rfq-market-maker/sdk";
import type { Quote, QuoteRequest, QuoteResponse } from "@rfq-market-maker/sdk";
import { rfqApiBaseUrl } from "./config";

const quoteRequestFields = ["chainId", "user", "tokenIn", "tokenOut", "amountIn", "slippageBps"] as const;
const quoteResponseFields = ["quoteId", "snapshotId", "amountOut", "minAmountOut", "deadline", "nonce", "signature"] as const;

let frontendTraceCounter = 0;

export function nextFrontendTraceId(): string {
  frontendTraceCounter = (frontendTraceCounter + 1) % Number.MAX_SAFE_INTEGER;
  return `tr_web_${Date.now().toString(36)}_${frontendTraceCounter.toString(36)}`;
}

export const rfqClient = new RFQClient(rfqApiBaseUrl, {
  traceId: nextFrontendTraceId,
});

export function buildQuoteFromResponse(request: QuoteRequest, response: QuoteResponse): Quote {
  assertRecord(request, "quote request");
  assertRecord(response, "quote response");
  assertExactFields(request, quoteRequestFields, "quote request");
  assertExactFields(response, quoteResponseFields, "quote response");

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

function assertRecord(value: unknown, field: string): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
}

function assertExactFields(value: object, expectedFields: readonly string[], label: string): void {
  const expected = new Set(expectedFields);
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) {
      throw new Error(`${label} must not include unknown field ${key}`);
    }
  }

  for (const field of expectedFields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      throw new Error(`${label}.${field} must be an own field`);
    }
  }
}
