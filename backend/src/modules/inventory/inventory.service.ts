import type { Address, UIntString } from "../../shared/types/rfq.js";

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

export class InventoryService {
  private readonly balances = new Map<string, bigint>();

  constructor(private readonly config: InventoryServiceConfig = defaultInventoryServiceConfig) {}

  applySettlement(delta: SettlementDelta): void {
    this.add(delta.chainId, delta.tokenIn, BigInt(delta.amountIn));
    this.add(delta.chainId, delta.tokenOut, -BigInt(delta.amountOut));
  }

  projectSettlement(input: InventoryProjectionInput): InventoryProjection {
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
