import { createPublicClient, defineChain, http } from "viem";
import type { Address } from "../../shared/types/rfq.js";
import {
  assertReceiptExecutionConfig,
  type ReceiptChainConfig,
  type ReceiptExecutionConfig,
} from "../execution/receipt-settlement-evidence.provider.js";

export interface TreasuryLiquidityRequest {
  chainId: number;
  token: Address;
}

export interface TreasuryLiquiditySnapshot {
  chainId: number;
  settlementAddress: Address;
  treasuryAddress: Address;
  token: Address;
  availableBalance: string;
  blockNumber: bigint;
}

export interface TreasuryLiquidityProvider {
  checkHealth(): Promise<void>;
  getLiquidity(request: TreasuryLiquidityRequest): Promise<TreasuryLiquiditySnapshot>;
}

export interface TreasuryLiquidityReader {
  getBlockNumber(): Promise<unknown>;
  readTreasury(input: { settlementAddress: Address; blockNumber: bigint }): Promise<unknown>;
  readTokenBalance(input: { token: Address; owner: Address; blockNumber: bigint }): Promise<unknown>;
}

export type TreasuryLiquidityReaderFactory = (config: ReceiptChainConfig) => TreasuryLiquidityReader;

const maxUint256 = (1n << 256n) - 1n;
const requestFields = ["chainId", "token"] as const;
const treasuryAbi = [{
  type: "function",
  name: "treasury",
  stateMutability: "view",
  inputs: [],
  outputs: [{ name: "", type: "address" }],
}] as const;
const erc20BalanceAbi = [{
  type: "function",
  name: "balanceOf",
  stateMutability: "view",
  inputs: [{ name: "account", type: "address" }],
  outputs: [{ name: "", type: "uint256" }],
}] as const;

export class OnchainTreasuryLiquidityProvider implements TreasuryLiquidityProvider {
  private readonly chains = new Map<number, ReceiptChainConfig>();
  private readonly readers = new Map<number, TreasuryLiquidityReader>();

  constructor(
    config: ReceiptExecutionConfig,
    readerFactory: TreasuryLiquidityReaderFactory = createTreasuryLiquidityReader,
  ) {
    assertReceiptExecutionConfig(config);
    if (typeof readerFactory !== "function") {
      throw new Error("Treasury liquidity reader factory must be a function");
    }
    for (const chain of config.chains) {
      const cloned = { ...chain };
      const reader = readerFactory(cloned);
      assertReader(reader);
      this.chains.set(cloned.chainId, cloned);
      this.readers.set(cloned.chainId, reader);
    }
  }

  async checkHealth(): Promise<void> {
    await Promise.all(Array.from(this.chains.values(), async (chain) => {
      const reader = this.readers.get(chain.chainId)!;
      const blockNumber = parseBlockNumber(await reader.getBlockNumber());
      parseAddress(await reader.readTreasury({
        settlementAddress: chain.settlementAddress,
        blockNumber,
      }), "treasury");
    }));
  }

  async getLiquidity(request: TreasuryLiquidityRequest): Promise<TreasuryLiquiditySnapshot> {
    assertRequest(request);
    const chain = this.chains.get(request.chainId);
    const reader = this.readers.get(request.chainId);
    if (!chain || !reader) {
      throw new Error("Treasury liquidity is not configured for the requested chain");
    }

    const blockNumber = parseBlockNumber(await reader.getBlockNumber());
    const treasuryAddress = parseAddress(await reader.readTreasury({
      settlementAddress: chain.settlementAddress,
      blockNumber,
    }), "treasury");
    const balance = parseBalance(await reader.readTokenBalance({
      token: request.token,
      owner: treasuryAddress,
      blockNumber,
    }));

    return {
      chainId: request.chainId,
      settlementAddress: chain.settlementAddress,
      treasuryAddress,
      token: request.token,
      availableBalance: balance.toString(),
      blockNumber,
    };
  }
}

function createTreasuryLiquidityReader(config: ReceiptChainConfig): TreasuryLiquidityReader {
  const chain = defineChain({
    id: config.chainId,
    name: `EVM Chain ${config.chainId}`,
    nativeCurrency: { name: "Native Token", symbol: "NATIVE", decimals: 18 },
    rpcUrls: { default: { http: [config.rpcUrl] } },
  });
  const client = createPublicClient({
    chain,
    transport: http(config.rpcUrl, { timeout: Math.min(config.receiptTimeoutMs, 30_000) }),
  });
  return {
    getBlockNumber: () => client.getBlockNumber(),
    readTreasury: ({ settlementAddress, blockNumber }) => client.readContract({
      address: settlementAddress,
      abi: treasuryAbi,
      functionName: "treasury",
      blockNumber,
    }),
    readTokenBalance: ({ token, owner, blockNumber }) => client.readContract({
      address: token,
      abi: erc20BalanceAbi,
      functionName: "balanceOf",
      args: [owner],
      blockNumber,
    }),
  };
}

function assertRequest(value: unknown): asserts value is TreasuryLiquidityRequest {
  assertRecord(value, "Treasury liquidity request");
  const keys = Object.keys(value);
  if (keys.length !== requestFields.length ||
      requestFields.some((field) => !Object.prototype.hasOwnProperty.call(value, field))) {
    throw new Error("Treasury liquidity request fields are invalid");
  }
  if (typeof value.chainId !== "number" || !Number.isSafeInteger(value.chainId) || value.chainId <= 0) {
    throw new Error("Treasury liquidity request.chainId must be a positive safe integer");
  }
  parseAddress(value.token, "request.token");
}

function assertReader(value: unknown): asserts value is TreasuryLiquidityReader {
  assertRecord(value, "Treasury liquidity reader");
  for (const method of ["getBlockNumber", "readTreasury", "readTokenBalance"] as const) {
    if (typeof value[method] !== "function") {
      throw new Error(`Treasury liquidity reader.${method} must be a function`);
    }
  }
}

function parseBlockNumber(value: unknown): bigint {
  if (typeof value !== "bigint" || value < 0n) {
    throw new Error("Treasury liquidity block number must be a non-negative bigint");
  }
  return value;
}

function parseBalance(value: unknown): bigint {
  if (typeof value !== "bigint" || value < 0n || value > maxUint256) {
    throw new Error("Treasury liquidity token balance must be a uint256 bigint");
  }
  return value;
}

function parseAddress(value: unknown, field: string): Address {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`Treasury liquidity ${field} must be a 20-byte hex address`);
  }
  return value as Address;
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}
