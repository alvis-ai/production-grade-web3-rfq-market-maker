import type { Address, UIntString } from "../../shared/types/rfq.js";

const inventoryServiceConfigFields = ["skewUnit", "maxPositiveSkewBps", "maxNegativeSkewBps"] as const;
const settlementDeltaFields = ["chainId", "tokenIn", "tokenOut", "amountIn", "amountOut"] as const;
const inventorySkewInputFields = ["chainId", "token"] as const;

export interface SettlementDelta {
  chainId: number;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: UIntString;
  amountOut: UIntString;
}

export interface InventoryPosition {
  chainId: number;
  token: Address;
  balance: bigint;
}

export interface InventorySkewInput {
  chainId: number;
  token: Address;
}

export interface InventoryProjectionInput {
  chainId: number;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: UIntString;
  amountOut: UIntString;
}

export interface InventoryProjection {
  tokenIn: InventoryPosition;
  tokenOut: InventoryPosition;
}

export interface InventoryServiceConfig {
  skewUnit: bigint;
  maxPositiveSkewBps: number;
  maxNegativeSkewBps: number;
}

export const defaultInventoryServiceConfig: InventoryServiceConfig = {
  skewUnit: 50_000_000n,
  maxPositiveSkewBps: 150,
  maxNegativeSkewBps: 50,
};

export interface IInventoryService {
  checkHealth(): void;
  applySettlement(delta: SettlementDelta): void;
  rebuildFromSettlements(deltas: readonly SettlementDelta[]): void;
  projectSettlement(input: InventoryProjectionInput): InventoryProjection;
  calculateQuoteSkewBps(input: InventorySkewInput): number;
  getPosition(chainId: number, token: Address): InventoryPosition;
}

export class InventoryService implements IInventoryService {
  private readonly config: InventoryServiceConfig;
  private readonly balances = new Map<string, bigint>();

  constructor(config: InventoryServiceConfig = defaultInventoryServiceConfig) {
    assertObject(config, "config");
    assertOwnFields(config, inventoryServiceConfigFields, "config");
    assertPositiveBigInt(config.skewUnit, "skewUnit");
    assertBpsUpperBound(config.maxPositiveSkewBps, "maxPositiveSkewBps");
    assertBpsUpperBound(config.maxNegativeSkewBps, "maxNegativeSkewBps");

    this.config = cloneInventoryServiceConfig(config);
  }

  checkHealth(): void {
    this.getPosition(1, "0x0000000000000000000000000000000000000002");
  }

  applySettlement(delta: SettlementDelta): void {
    assertSettlementDelta(delta);
    this.add(delta.chainId, delta.tokenIn, BigInt(delta.amountIn));
    this.add(delta.chainId, delta.tokenOut, -BigInt(delta.amountOut));
  }

  rebuildFromSettlements(deltas: readonly SettlementDelta[]): void {
    if (!Array.isArray(deltas)) {
      throw new Error("Inventory settlement replay input must be an array");
    }

    for (const delta of deltas) {
      assertSettlementDelta(delta);
    }

    this.balances.clear();
    for (const delta of deltas) {
      this.add(delta.chainId, delta.tokenIn, BigInt(delta.amountIn));
      this.add(delta.chainId, delta.tokenOut, -BigInt(delta.amountOut));
    }
  }

  projectSettlement(input: InventoryProjectionInput): InventoryProjection {
    assertSettlementDelta(input);
    const tokenIn = this.getPosition(input.chainId, input.tokenIn);
    const tokenOut = this.getPosition(input.chainId, input.tokenOut);

    return {
      tokenIn: {
        ...tokenIn,
        balance: tokenIn.balance + BigInt(input.amountIn),
      },
      tokenOut: {
        ...tokenOut,
        balance: tokenOut.balance - BigInt(input.amountOut),
      },
    };
  }

  calculateQuoteSkewBps(input: InventorySkewInput): number {
    assertInventorySkewInput(input);
    const balance = this.getPosition(input.chainId, input.token).balance;
    if (balance === 0n) {
      return 0;
    }

    const skew = Number(abs(balance) / this.config.skewUnit);
    if (balance < 0n) {
      return Math.min(skew, this.config.maxPositiveSkewBps);
    }

    return -Math.min(skew, this.config.maxNegativeSkewBps);
  }

  getPosition(chainId: number, token: Address): InventoryPosition {
    assertPositiveSafeInteger(chainId, "chainId");
    assertAddress(token, "token");
    return {
      chainId,
      token,
      balance: this.balances.get(this.key(chainId, token)) ?? 0n,
    };
  }

  private add(chainId: number, token: Address, delta: bigint): void {
    const key = this.key(chainId, token);
    this.balances.set(key, (this.balances.get(key) ?? 0n) + delta);
  }

  private key(chainId: number, token: Address): string {
    return `${chainId}:${token.toLowerCase()}`;
  }
}

function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function cloneInventoryServiceConfig(config: InventoryServiceConfig): InventoryServiceConfig {
  return { ...config };
}

function assertPositiveBigInt(value: bigint, field: keyof InventoryServiceConfig): void {
  if (typeof value !== "bigint" || value <= 0n) {
    throw new Error(`Inventory ${field} must be a positive bigint`);
  }
}

function assertBpsUpperBound(value: number, field: keyof InventoryServiceConfig): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Inventory ${field} must be a non-negative safe integer`);
  }

  if (value > 10_000) {
    throw new Error(`Inventory ${field} must be less than or equal to 10000 bps`);
  }
}

function assertSettlementDelta(input: SettlementDelta | InventoryProjectionInput): void {
  assertObject(input, "settlement delta");
  assertOwnFields(input, settlementDeltaFields, "settlement delta");
  assertPositiveSafeInteger(input.chainId, "chainId");
  assertAddress(input.tokenIn, "tokenIn");
  assertAddress(input.tokenOut, "tokenOut");
  if (input.tokenIn.toLowerCase() === input.tokenOut.toLowerCase()) {
    throw new Error("Inventory token pair must contain distinct tokens");
  }
  assertPositiveUIntString(input.amountIn, "amountIn");
  assertPositiveUIntString(input.amountOut, "amountOut");
}

function assertInventorySkewInput(input: InventorySkewInput): void {
  assertObject(input, "skew input");
  assertOwnFields(input, inventorySkewInputFields, "skew input");
  assertPositiveSafeInteger(input.chainId, "chainId");
  assertAddress(input.token, "token");
}

function assertObject(value: unknown, field: "config" | "settlement delta" | "skew input"): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Inventory ${field} must be an object`);
  }
}

function assertOwnFields(value: object, fields: readonly string[], path: string): void {
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      throw new Error(`Inventory ${path}.${field} must be an own field`);
    }
  }
}

function assertPositiveSafeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Inventory ${field} must be a positive safe integer`);
  }
}

function assertAddress(value: string, field: string): void {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`Inventory ${field} must be a 20-byte hex address`);
  }
}

function assertPositiveUIntString(value: string, field: string): void {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`Inventory ${field} must be a positive uint string`);
  }
}
