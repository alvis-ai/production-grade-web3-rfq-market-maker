import {
  createPublicClient,
  defineChain,
  http,
  parseAbiItem,
} from "viem";
import type { Address } from "../../shared/types/rfq.js";

export interface SettlementIndexerChainConfig {
  chainId: number;
  rpcUrl: string;
  settlementAddress: Address;
  startBlock: number;
  confirmations: number;
  maxBlockRange: number;
  reorgLookbackBlocks: number;
  requestTimeoutMs: number;
}

export interface SettlementIndexerConfig {
  chains: SettlementIndexerChainConfig[];
}

export interface IndexedQuoteSettledLog {
  transactionHash: `0x${string}`;
  blockHash: `0x${string}`;
  blockNumber: number;
  logIndex: number;
  quoteHash: `0x${string}`;
  user: Address;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: string;
  amountOut: string;
  nonce: string;
}

export interface SettlementChainReader {
  getBlockNumber(): Promise<number>;
  getBlockHash(blockNumber: number): Promise<`0x${string}`>;
  getQuoteSettledLogs(fromBlock: number, toBlock: number): Promise<IndexedQuoteSettledLog[]>;
}

export type SettlementChainReaderFactory = (
  config: SettlementIndexerChainConfig,
) => SettlementChainReader;

const configFields = ["chains"] as const;
const chainFields = [
  "chainId",
  "rpcUrl",
  "settlementAddress",
  "startBlock",
  "confirmations",
  "maxBlockRange",
  "reorgLookbackBlocks",
  "requestTimeoutMs",
] as const;
const quoteSettledEvent = parseAbiItem(
  "event QuoteSettled(bytes32 indexed quoteHash, address indexed user, address indexed tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut, uint256 nonce)",
);

export function parseSettlementIndexerConfig(serialized: string | undefined): SettlementIndexerConfig {
  if (serialized === undefined || serialized.trim().length === 0) {
    throw new Error("RFQ_SETTLEMENT_INDEXER_CONFIG_JSON is required");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error("RFQ_SETTLEMENT_INDEXER_CONFIG_JSON must contain valid JSON");
  }
  assertSettlementIndexerConfig(parsed);
  return { chains: parsed.chains.map((chain) => ({ ...chain })) };
}

export function assertSettlementIndexerConfig(value: unknown): asserts value is SettlementIndexerConfig {
  assertRecord(value, "Settlement indexer config");
  assertExactFields(value, configFields, "Settlement indexer config");
  if (!Array.isArray(value.chains) || value.chains.length === 0 || value.chains.length > 32) {
    throw new Error("Settlement indexer config.chains must contain between 1 and 32 chains");
  }
  const chainIds = new Set<number>();
  for (const chain of value.chains) {
    assertRecord(chain, "Settlement indexer chain config");
    assertExactFields(chain, chainFields, "Settlement indexer chain config");
    assertSafeInteger(chain.chainId, 1, Number.MAX_SAFE_INTEGER, "chainId");
    assertRpcUrl(chain.rpcUrl);
    assertAddress(chain.settlementAddress, "settlementAddress");
    if (/^0x0{40}$/i.test(chain.settlementAddress)) {
      throw new Error("Settlement indexer chain config.settlementAddress must not be zero");
    }
    assertSafeInteger(chain.startBlock, 0, Number.MAX_SAFE_INTEGER, "startBlock");
    assertSafeInteger(chain.confirmations, 1, 100, "confirmations");
    assertSafeInteger(chain.maxBlockRange, 1, 10_000, "maxBlockRange");
    assertSafeInteger(chain.reorgLookbackBlocks, 1, 1_000_000, "reorgLookbackBlocks");
    if (chain.reorgLookbackBlocks < chain.maxBlockRange) {
      throw new Error("Settlement indexer chain config.reorgLookbackBlocks must cover at least one maxBlockRange");
    }
    assertSafeInteger(chain.requestTimeoutMs, 1_000, 60_000, "requestTimeoutMs");
    if (chainIds.has(chain.chainId)) {
      throw new Error("Settlement indexer config must not contain duplicate chain IDs");
    }
    chainIds.add(chain.chainId);
  }
}

export function createSettlementChainReader(
  config: SettlementIndexerChainConfig,
): SettlementChainReader {
  const chain = defineChain({
    id: config.chainId,
    name: `EVM Chain ${config.chainId}`,
    nativeCurrency: { name: "Native Token", symbol: "NATIVE", decimals: 18 },
    rpcUrls: { default: { http: [config.rpcUrl] } },
  });
  const client = createPublicClient({
    chain,
    transport: http(config.rpcUrl, {
      retryCount: 0,
      timeout: config.requestTimeoutMs,
    }),
  });

  return {
    async getBlockNumber() {
      return bigintToSafeInteger(await client.getBlockNumber(), "head block number");
    },
    async getBlockHash(blockNumber) {
      assertSafeInteger(blockNumber, 0, Number.MAX_SAFE_INTEGER, "blockNumber");
      const block = await client.getBlock({ blockNumber: BigInt(blockNumber) });
      return normalizeHash(block.hash, "block hash");
    },
    async getQuoteSettledLogs(fromBlock, toBlock) {
      assertBlockRange(fromBlock, toBlock);
      const logs = await client.getLogs({
        address: config.settlementAddress,
        event: quoteSettledEvent,
        fromBlock: BigInt(fromBlock),
        toBlock: BigInt(toBlock),
        strict: true,
      });
      return logs.map((log, index) => normalizeQuoteSettledLog(log, index));
    },
  };
}

function normalizeQuoteSettledLog(value: unknown, index: number): IndexedQuoteSettledLog {
  assertRecord(value, `QuoteSettled log ${index}`);
  assertRecord(value.args, `QuoteSettled log ${index}.args`);
  const args = value.args;
  const amountIn = bigintToPositiveUInt(args.amountIn, `QuoteSettled log ${index}.amountIn`);
  const amountOut = bigintToPositiveUInt(args.amountOut, `QuoteSettled log ${index}.amountOut`);
  const nonce = bigintToPositiveUInt(args.nonce, `QuoteSettled log ${index}.nonce`);
  assertAddress(args.user, `QuoteSettled log ${index}.user`);
  assertAddress(args.tokenIn, `QuoteSettled log ${index}.tokenIn`);
  assertAddress(args.tokenOut, `QuoteSettled log ${index}.tokenOut`);
  if (args.tokenIn.toLowerCase() === args.tokenOut.toLowerCase()) {
    throw new Error(`QuoteSettled log ${index} tokens must be distinct`);
  }
  return {
    transactionHash: normalizeHash(value.transactionHash, `QuoteSettled log ${index}.transactionHash`),
    blockHash: normalizeHash(value.blockHash, `QuoteSettled log ${index}.blockHash`),
    blockNumber: bigintToSafeInteger(value.blockNumber, `QuoteSettled log ${index}.blockNumber`),
    logIndex: numberToSafeInteger(value.logIndex, `QuoteSettled log ${index}.logIndex`),
    quoteHash: normalizeHash(args.quoteHash, `QuoteSettled log ${index}.quoteHash`),
    user: args.user,
    tokenIn: args.tokenIn,
    tokenOut: args.tokenOut,
    amountIn,
    amountOut,
    nonce,
  };
}

function assertBlockRange(fromBlock: number, toBlock: number): void {
  assertSafeInteger(fromBlock, 0, Number.MAX_SAFE_INTEGER, "fromBlock");
  assertSafeInteger(toBlock, 0, Number.MAX_SAFE_INTEGER, "toBlock");
  if (toBlock < fromBlock) throw new Error("Settlement indexer block range is reversed");
}

function bigintToSafeInteger(value: unknown, label: string): number {
  if (typeof value !== "bigint" || value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`Settlement indexer ${label} must be a non-negative safe integer`);
  }
  return Number(value);
}

function numberToSafeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Settlement indexer ${label} must be a non-negative safe integer`);
  }
  return value;
}

function bigintToPositiveUInt(value: unknown, label: string): string {
  if (typeof value !== "bigint" || value <= 0n) {
    throw new Error(`Settlement indexer ${label} must be a positive uint`);
  }
  return value.toString();
}

function normalizeHash(value: unknown, label: string): `0x${string}` {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`Settlement indexer ${label} must be a 32-byte hex string`);
  }
  return value.toLowerCase() as `0x${string}`;
}

function assertAddress(value: unknown, field: string): asserts value is Address {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`Settlement indexer chain config.${field} must be a 20-byte hex address`);
  }
}

function assertRpcUrl(value: unknown): void {
  if (typeof value !== "string" || value.length === 0 || value.length > 2_048 || value.trim() !== value) {
    throw new Error("Settlement indexer chain config.rpcUrl must be a bounded absolute HTTP(S) URL");
  }
  try {
    const parsed = new URL(value);
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || !parsed.hostname || parsed.username || parsed.password) {
      throw new Error();
    }
  } catch {
    throw new Error("Settlement indexer chain config.rpcUrl must be a bounded absolute HTTP(S) URL");
  }
}

function assertSafeInteger(value: unknown, min: number, max: number, field: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`Settlement indexer chain config.${field} must be an integer between ${min} and ${max}`);
  }
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function assertExactFields(value: Record<string, unknown>, fields: readonly string[], label: string): void {
  const allowed = new Set(fields);
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) throw new Error(`${label} must not include unknown field ${field}`);
  }
  for (const field of fields) {
    if (!Object.hasOwn(value, field)) throw new Error(`${label}.${field} must be an own field`);
  }
}
