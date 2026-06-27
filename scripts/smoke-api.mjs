#!/usr/bin/env node

import { readFile } from "node:fs/promises";

const apiUrl = process.env.API_URL ?? "http://127.0.0.1:3000";
const quoteRequest = JSON.parse(await readFile("examples/quote-request.json", "utf8"));

const health = await request("GET", "/health");
assertEqual(health.status, "ok", "health status");

const readiness = await request("GET", "/ready");
assertEqual(readiness.status, "ready", "readiness status");
assertEqual(readiness.components.signer, "ok", "readiness signer component");
assertEqual(readiness.components.marketData, "ok", "readiness market data component");

const quoteResponse = await request("POST", "/quote", quoteRequest);
assertString(quoteResponse.quoteId, "quoteId");
assertString(quoteResponse.snapshotId, "snapshotId");
assertString(quoteResponse.amountOut, "amountOut");
assertString(quoteResponse.minAmountOut, "minAmountOut");
assertString(quoteResponse.nonce, "nonce");
assertHex(quoteResponse.signature, "signature");

const signedQuote = {
  user: quoteRequest.user,
  tokenIn: quoteRequest.tokenIn,
  tokenOut: quoteRequest.tokenOut,
  amountIn: quoteRequest.amountIn,
  amountOut: quoteResponse.amountOut,
  minAmountOut: quoteResponse.minAmountOut,
  nonce: quoteResponse.nonce,
  deadline: quoteResponse.deadline,
  chainId: quoteRequest.chainId,
};

const submitResponse = await request("POST", "/submit", {
  quote: signedQuote,
  signature: quoteResponse.signature,
});
assertEqual(submitResponse.status, "accepted", "submit status");
assertHex(submitResponse.txHash, "txHash");

const replayError = await requestError("POST", "/submit", {
  quote: signedQuote,
  signature: quoteResponse.signature,
});
assertEqual(replayError.status, 409, "replay HTTP status");
assertEqual(replayError.payload.code, "QUOTE_ALREADY_USED", "replay error code");
assertString(replayError.payload.traceId, "replay traceId");

const quoteStatus = await request("GET", `/quote/${encodeURIComponent(quoteResponse.quoteId)}`);
assertEqual(quoteStatus.status, "settled", "quote status");
assertEqual(quoteStatus.txHash, submitResponse.txHash, "quote txHash");

const metrics = await requestText("GET", "/metrics");
assertIncludes(metrics, "rfq_quote_requests_total 1", "quote request metric");
assertIncludes(metrics, "rfq_quote_latency_seconds_count 1", "quote latency metric");
assertIncludes(metrics, "rfq_submit_accepted_total 1", "submit accepted metric");
assertIncludes(metrics, "rfq_submit_errors_total 1", "submit error metric");
assertIncludes(metrics, "rfq_submit_latency_seconds_count 2", "submit latency metric");
assertIncludes(metrics, "rfq_settlements_total 1", "settlement metric");
assertIncludes(metrics, "rfq_hedge_intents_total 1", "hedge metric");
assertIncludes(
  metrics,
  `rfq_inventory_balance{chain_id="${quoteRequest.chainId}",token="${quoteRequest.tokenIn.toLowerCase()}"} ${quoteRequest.amountIn}`,
  "tokenIn inventory metric",
);
assertIncludes(
  metrics,
  `rfq_inventory_balance{chain_id="${quoteRequest.chainId}",token="${quoteRequest.tokenOut.toLowerCase()}"} -${quoteResponse.amountOut}`,
  "tokenOut inventory metric",
);

console.log(
  JSON.stringify(
    {
      ok: true,
      quoteId: quoteResponse.quoteId,
      status: quoteStatus.status,
      txHash: submitResponse.txHash,
      readiness: readiness.status,
      replayTraceId: replayError.payload.traceId,
    },
    null,
    2,
  ),
);

async function request(method, path, body) {
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : undefined;

  if (!response.ok) {
    throw new Error(`${method} ${path} failed with ${response.status}: ${text}`);
  }

  return payload;
}

async function requestError(method, path, body) {
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : undefined;

  if (response.ok) {
    throw new Error(`${method} ${path} unexpectedly succeeded: ${text}`);
  }

  return {
    status: response.status,
    payload,
  };
}

async function requestText(method, path) {
  const response = await fetch(`${apiUrl}${path}`, { method });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${method} ${path} failed with ${response.status}: ${text}`);
  }

  return text;
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`Expected ${label} to be ${expected}, received ${actual}`);
  }
}

function assertString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Expected ${label} to be a non-empty string`);
  }
}

function assertHex(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) {
    throw new Error(`Expected ${label} to be hex`);
  }
}

function assertIncludes(value, expected, label) {
  if (!value.includes(expected)) {
    throw new Error(`Expected ${label} to include ${expected}`);
  }
}
