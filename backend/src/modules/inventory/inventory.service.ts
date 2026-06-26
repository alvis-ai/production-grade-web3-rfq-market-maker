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

export class InventoryService {
  private readonly balances = new Map<string, bigint>();

  applySettlement(delta: SettlementDelta): void {
    this.add(delta.chainId, delta.tokenIn, BigInt(delta.amountIn));
    this.add(delta.chainId, delta.tokenOut, -BigInt(delta.amountOut));
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
