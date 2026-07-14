import { createPublicClient, decodeEventLog, decodeFunctionData, defineChain, http, parseAbiItem } from "viem";
import { APIError } from "../../shared/errors/api-error.js";
import type { Address, SubmitQuoteRequest } from "../../shared/types/rfq.js";
import { validateSubmitQuoteRequest } from "../../shared/validation/submit-request.js";
import { hashSettlementQuote } from "../settlement/settlement-event.service.js";
import {
  buildSyntheticTxHash,
  type ExecutionContext,
  type SettlementEvidence,
  type SettlementEvidenceProvider,
} from "./execution.service.js";

export interface ReceiptChainConfig {
  chainId: number;
  rpcUrl: string;
  settlementAddress: Address;
  confirmations: number;
  receiptTimeoutMs: number;
}

export interface ReceiptExecutionConfig {
  chains: ReceiptChainConfig[];
}

export interface ReceiptReader {
  waitForTransactionReceipt(input: {
    hash: `0x${string}`;
    confirmations: number;
    timeoutMs: number;
  }): Promise<unknown>;
  getTransaction(hash: `0x${string}`): Promise<unknown>;
  getBlock(blockNumber: number): Promise<unknown>;
}

export type ReceiptReaderFactory = (config: ReceiptChainConfig) => ReceiptReader;

const configFields = ["chains"] as const;
const chainFields = ["chainId", "rpcUrl", "settlementAddress", "confirmations", "receiptTimeoutMs"] as const;
const quoteSettledEventAbi = [parseAbiItem(
  "event QuoteSettled(bytes32 indexed quoteHash, address indexed user, address indexed tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut, uint256 nonce)",
)];
const submitQuoteFunctionAbi = [parseAbiItem(
  "function submitQuote((address user, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut, uint256 minAmountOut, uint256 nonce, uint256 deadline, uint256 chainId) quote, bytes signature) returns (uint256 amountOut)",
)];

export class ReceiptSettlementEvidenceProvider implements SettlementEvidenceProvider {
  private readonly chains = new Map<number, ReceiptChainConfig>();
  private readonly readers = new Map<number, ReceiptReader>();

  constructor(config: ReceiptExecutionConfig, readerFactory: ReceiptReaderFactory = createReceiptReader) {
    assertReceiptExecutionConfig(config);
    for (const chain of config.chains) {
      const cloned = { ...chain };
      this.chains.set(chain.chainId, cloned);
      this.readers.set(chain.chainId, readerFactory(cloned));
    }
  }

  async resolve(request: SubmitQuoteRequest): Promise<SettlementEvidence> {
    const validatedRequest = validateSubmitQuoteRequest(request, { allowExpired: true });
    if (!validatedRequest.txHash) {
      throw new APIError("INVALID_REQUEST", "txHash is required for receipt-confirmed settlement", 400);
    }
    const chain = this.chains.get(validatedRequest.quote.chainId);
    const reader = this.readers.get(validatedRequest.quote.chainId);
    if (!chain || !reader) {
      throw new APIError("SETTLEMENT_UNAVAILABLE", "Receipt confirmation is not configured for the quote chain", 503);
    }

    let rawReceipt: unknown;
    let rawTransaction: unknown;
    let rawBlock: unknown;
    try {
      rawReceipt = await reader.waitForTransactionReceipt({
        hash: validatedRequest.txHash,
        confirmations: chain.confirmations,
        timeoutMs: chain.receiptTimeoutMs,
      });
      rawTransaction = await reader.getTransaction(validatedRequest.txHash);
      const receiptBlockNumber = receiptBlockNumberFromUnknown(rawReceipt);
      rawBlock = await reader.getBlock(receiptBlockNumber);
    } catch {
      throw new APIError("SETTLEMENT_UNAVAILABLE", "Chain transaction receipt is unavailable", 503);
    }

    const receipt = parseReceipt(rawReceipt, validatedRequest.txHash);
    const transaction = parseTransaction(rawTransaction, validatedRequest.txHash);
    const settledAt = parseBlockTimestamp(rawBlock, receipt.blockNumber);
    if (!sameAddress(transaction.from, validatedRequest.quote.user)) {
      throw reverted("SETTLEMENT_SENDER_MISMATCH", "Settlement transaction sender does not match quote user");
    }
    if (!transaction.to || !sameAddress(transaction.to, chain.settlementAddress)) {
      throw reverted("SETTLEMENT_TARGET_MISMATCH", "Settlement transaction target does not match configured contract");
    }
    if (!transactionMatchesSubmitQuote(transaction.input, validatedRequest)) {
      throw reverted("SETTLEMENT_CALLDATA_MISMATCH", "Settlement transaction calldata does not match signed quote");
    }
    if (receipt.status !== "success") {
      throw reverted("SETTLEMENT_TX_REVERTED", "Settlement transaction reverted");
    }

    const matchingLogs = receipt.logs
      .filter((log) => sameAddress(log.address, chain.settlementAddress))
      .map((log) => decodeQuoteSettledLog(log))
      .filter((event): event is DecodedQuoteSettled => event !== undefined)
      .filter((event) => eventMatchesQuote(event, validatedRequest));
    if (matchingLogs.length !== 1) {
      throw reverted(
        matchingLogs.length === 0 ? "QUOTE_SETTLED_EVENT_MISSING" : "QUOTE_SETTLED_EVENT_AMBIGUOUS",
        matchingLogs.length === 0
          ? "Matching QuoteSettled event was not found"
          : "Settlement transaction emitted multiple matching QuoteSettled events",
      );
    }

    return {
      txHash: validatedRequest.txHash,
      blockNumber: receipt.blockNumber,
      logIndex: matchingLogs[0].logIndex,
      settledAt,
    };
  }
}

export class RuntimeSettlementEvidenceProvider implements SettlementEvidenceProvider {
  private readonly receiptProvider: ReceiptSettlementEvidenceProvider;

  constructor(config: ReceiptExecutionConfig, private readonly allowSimulatedSettlement: boolean) {
    if (typeof allowSimulatedSettlement !== "boolean") {
      throw new Error("Runtime settlement allowSimulatedSettlement must be a boolean");
    }
    this.receiptProvider = new ReceiptSettlementEvidenceProvider(config);
  }

  async resolve(request: SubmitQuoteRequest, context: ExecutionContext): Promise<SettlementEvidence> {
    if (request.txHash) return this.receiptProvider.resolve(request);
    if (!this.allowSimulatedSettlement) {
      throw new APIError("INVALID_REQUEST", "txHash is required when simulated settlement is disabled", 400);
    }
    return {
      txHash: buildSyntheticTxHash(request, context),
      blockNumber: 0,
      logIndex: 0,
      settledAt: new Date().toISOString(),
    };
  }
}

export function parseReceiptExecutionConfig(serialized: string | undefined): ReceiptExecutionConfig {
  if (serialized === undefined || serialized.trim().length === 0) return { chains: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error("RFQ_RECEIPT_CONFIG_JSON must contain valid JSON");
  }
  assertReceiptExecutionConfig(parsed);
  return { chains: parsed.chains.map((chain) => ({ ...chain })) };
}

export function assertReceiptExecutionConfig(value: unknown): asserts value is ReceiptExecutionConfig {
  assertRecord(value, "Receipt execution config");
  assertExactFields(value, configFields, "Receipt execution config");
  if (!Array.isArray(value.chains)) throw new Error("Receipt execution config.chains must be an array");
  const chainIds = new Set<number>();
  for (const chain of value.chains) {
    assertRecord(chain, "Receipt chain config");
    assertExactFields(chain, chainFields, "Receipt chain config");
    assertInteger(chain.chainId, 1, Number.MAX_SAFE_INTEGER, "Receipt chain config.chainId");
    assertRpcUrl(chain.rpcUrl);
    assertAddress(chain.settlementAddress, "Receipt chain config.settlementAddress");
    assertInteger(chain.confirmations, 1, 100, "Receipt chain config.confirmations");
    assertInteger(chain.receiptTimeoutMs, 1_000, 600_000, "Receipt chain config.receiptTimeoutMs");
    if (chainIds.has(chain.chainId)) throw new Error("Receipt execution config must not contain duplicate chain IDs");
    chainIds.add(chain.chainId);
  }
}

interface ParsedReceiptLog {
  address: Address;
  data: `0x${string}`;
  topics: [`0x${string}`, ...`0x${string}`[]];
  logIndex: number;
}

interface ParsedReceipt {
  status: "success" | "reverted";
  blockNumber: number;
  logs: ParsedReceiptLog[];
}

interface DecodedQuoteSettled {
  quoteHash: `0x${string}`;
  user: Address;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  amountOut: bigint;
  nonce: bigint;
  logIndex: number;
}

function createReceiptReader(config: ReceiptChainConfig): ReceiptReader {
  const chain = defineChain({
    id: config.chainId,
    name: `EVM Chain ${config.chainId}`,
    nativeCurrency: { name: "Native Token", symbol: "NATIVE", decimals: 18 },
    rpcUrls: { default: { http: [config.rpcUrl] } },
  });
  const client = createPublicClient({ chain, transport: http(config.rpcUrl) });
  return {
    waitForTransactionReceipt: ({ hash, confirmations, timeoutMs }) => client.waitForTransactionReceipt({
      hash,
      confirmations,
      timeout: timeoutMs,
    }),
    getTransaction: (hash) => client.getTransaction({ hash }),
    getBlock: (blockNumber) => client.getBlock({ blockNumber: BigInt(blockNumber) }),
  };
}

function receiptBlockNumberFromUnknown(value: unknown): number {
  assertRecord(value, "Chain transaction receipt");
  return bigintToSafeInteger(value.blockNumber, "receipt blockNumber");
}

function parseBlockTimestamp(value: unknown, expectedBlockNumber: number): string {
  assertRecord(value, "Settlement block");
  const blockNumber = bigintToSafeInteger(value.number, "settlement block number");
  if (blockNumber !== expectedBlockNumber) {
    throw new APIError("SETTLEMENT_UNAVAILABLE", "Settlement block number does not match receipt", 503);
  }
  const timestampSeconds = bigintToSafeInteger(value.timestamp, "settlement block timestamp");
  const timestampMs = timestampSeconds * 1_000;
  if (!Number.isSafeInteger(timestampMs)) {
    throw new APIError("SETTLEMENT_UNAVAILABLE", "Settlement block timestamp is outside supported range", 503);
  }
  try {
    return new Date(timestampMs).toISOString();
  } catch {
    throw new APIError("SETTLEMENT_UNAVAILABLE", "Settlement block timestamp is invalid", 503);
  }
}

function parseReceipt(value: unknown, expectedHash: `0x${string}`): ParsedReceipt {
  assertRecord(value, "Chain transaction receipt");
  if (value.status !== "success" && value.status !== "reverted") {
    throw new APIError("SETTLEMENT_UNAVAILABLE", "Chain transaction receipt has invalid status", 503);
  }
  if (typeof value.transactionHash !== "string" || value.transactionHash.toLowerCase() !== expectedHash.toLowerCase()) {
    throw new APIError("SETTLEMENT_UNAVAILABLE", "Chain transaction receipt hash does not match request", 503);
  }
  const blockNumber = bigintToSafeInteger(value.blockNumber, "receipt blockNumber");
  if (!Array.isArray(value.logs)) throw new APIError("SETTLEMENT_UNAVAILABLE", "Chain transaction receipt logs are invalid", 503);
  const logs = value.logs.map((log, index) => parseReceiptLog(log, index));
  return { status: value.status, blockNumber, logs };
}

function parseReceiptLog(value: unknown, index: number): ParsedReceiptLog {
  assertRecord(value, `Chain transaction receipt log ${index}`);
  assertAddress(value.address, `Chain transaction receipt log ${index}.address`);
  if (typeof value.data !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value.data)) {
    throw new APIError("SETTLEMENT_UNAVAILABLE", "Chain transaction receipt log data is invalid", 503);
  }
  if (!Array.isArray(value.topics) || value.topics.length === 0 || value.topics.some((topic) => typeof topic !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(topic))) {
    throw new APIError("SETTLEMENT_UNAVAILABLE", "Chain transaction receipt log topics are invalid", 503);
  }
  if (!Number.isSafeInteger(value.logIndex) || Number(value.logIndex) < 0) {
    throw new APIError("SETTLEMENT_UNAVAILABLE", "Chain transaction receipt log index is invalid", 503);
  }
  return {
    address: value.address,
    data: value.data as `0x${string}`,
    topics: value.topics as unknown as ParsedReceiptLog["topics"],
    logIndex: Number(value.logIndex),
  };
}

function parseTransaction(
  value: unknown,
  expectedHash: `0x${string}`,
): { from: Address; input: `0x${string}`; to: Address | null } {
  assertRecord(value, "Chain transaction");
  if (typeof value.hash !== "string" || value.hash.toLowerCase() !== expectedHash.toLowerCase()) {
    throw new APIError("SETTLEMENT_UNAVAILABLE", "Chain transaction hash does not match request", 503);
  }
  assertAddress(value.from, "Chain transaction.from");
  if (value.to !== null) assertAddress(value.to, "Chain transaction.to");
  if (typeof value.input !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value.input)) {
    throw new APIError("SETTLEMENT_UNAVAILABLE", "Chain transaction input is invalid", 503);
  }
  return { from: value.from, input: value.input as `0x${string}`, to: value.to };
}

function transactionMatchesSubmitQuote(input: `0x${string}`, request: SubmitQuoteRequest): boolean {
  try {
    const decoded = decodeFunctionData({ abi: submitQuoteFunctionAbi, data: input });
    if (decoded.functionName !== "submitQuote" || decoded.args.length !== 2) return false;
    const [quote, signature] = decoded.args;
    return (
      sameAddress(quote.user, request.quote.user) &&
      sameAddress(quote.tokenIn, request.quote.tokenIn) &&
      sameAddress(quote.tokenOut, request.quote.tokenOut) &&
      quote.amountIn === BigInt(request.quote.amountIn) &&
      quote.amountOut === BigInt(request.quote.amountOut) &&
      quote.minAmountOut === BigInt(request.quote.minAmountOut) &&
      quote.nonce === BigInt(request.quote.nonce) &&
      quote.deadline === BigInt(request.quote.deadline) &&
      quote.chainId === BigInt(request.quote.chainId) &&
      signature.toLowerCase() === request.signature.toLowerCase()
    );
  } catch {
    return false;
  }
}

function decodeQuoteSettledLog(log: ParsedReceiptLog): DecodedQuoteSettled | undefined {
  try {
    const decoded = decodeEventLog({
      abi: quoteSettledEventAbi,
      data: log.data,
      topics: log.topics,
      strict: true,
    });
    if (decoded.eventName !== "QuoteSettled") return undefined;
    const args = decoded.args as Record<string, unknown>;
    assertHash(args.quoteHash, "QuoteSettled.quoteHash");
    assertAddress(args.user, "QuoteSettled.user");
    assertAddress(args.tokenIn, "QuoteSettled.tokenIn");
    assertAddress(args.tokenOut, "QuoteSettled.tokenOut");
    for (const field of ["amountIn", "amountOut", "nonce"] as const) {
      if (typeof args[field] !== "bigint") throw new Error(`QuoteSettled.${field} is invalid`);
    }
    return {
      quoteHash: args.quoteHash,
      user: args.user,
      tokenIn: args.tokenIn,
      tokenOut: args.tokenOut,
      amountIn: args.amountIn as bigint,
      amountOut: args.amountOut as bigint,
      nonce: args.nonce as bigint,
      logIndex: log.logIndex,
    };
  } catch {
    return undefined;
  }
}

function eventMatchesQuote(event: DecodedQuoteSettled, request: SubmitQuoteRequest): boolean {
  const quote = request.quote;
  return (
    event.quoteHash.toLowerCase() === hashSettlementQuote(quote).toLowerCase() &&
    sameAddress(event.user, quote.user) &&
    sameAddress(event.tokenIn, quote.tokenIn) &&
    sameAddress(event.tokenOut, quote.tokenOut) &&
    event.amountIn === BigInt(quote.amountIn) &&
    event.amountOut === BigInt(quote.amountOut) &&
    event.nonce === BigInt(quote.nonce)
  );
}

function reverted(reasonCode: string, message: string): APIError {
  return new APIError("SETTLEMENT_REVERTED", message, 409, undefined, reasonCode);
}

function bigintToSafeInteger(value: unknown, label: string): number {
  if (typeof value !== "bigint" || value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new APIError("SETTLEMENT_UNAVAILABLE", `Chain transaction ${label} is invalid`, 503);
  }
  return Number(value);
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`);
}

function assertExactFields(value: Record<string, unknown>, fields: readonly string[], label: string): void {
  const expected = new Set(fields);
  for (const field of Object.keys(value)) {
    if (!expected.has(field)) throw new Error(`${label} must not include unknown field ${field}`);
  }
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) throw new Error(`${label}.${field} must be an own field`);
  }
}

function assertInteger(value: unknown, min: number, max: number, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be an integer between ${min} and ${max}`);
  }
}

function assertRpcUrl(value: unknown): void {
  if (typeof value !== "string" || value.length > 2_048 || value.trim() !== value) throw new Error("Receipt chain config.rpcUrl must be a bounded absolute HTTP(S) URL");
  try {
    const parsed = new URL(value);
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || !parsed.hostname || parsed.username || parsed.password) throw new Error();
  } catch {
    throw new Error("Receipt chain config.rpcUrl must be a bounded absolute HTTP(S) URL");
  }
}

function assertAddress(value: unknown, label: string): asserts value is Address {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error(`${label} must be a 20-byte hex address`);
}

function assertHash(value: unknown, label: string): asserts value is `0x${string}` {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${label} must be a 32-byte hex string`);
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}
