import type { Address } from "../../shared/types/rfq.js";
import type { IInventoryService } from "../inventory/inventory.service.js";
import type { MarketSnapshotStore } from "../market-data/market-snapshot.repository.js";
import type { TokenRegistry } from "../pricing/token-registry.js";
import {
  applyPortfolioDelta,
  evaluatePortfolioVar,
  normalizePortfolioVarPolicy,
  type PortfolioVarEvaluation,
  type PortfolioVarPolicy,
  type PortfolioVarPosition,
  type PortfolioVarSnapshot,
} from "./portfolio-var.js";

export interface PortfolioQuoteDelta {
  chainId: number;
  tokenIn: Address;
  amountIn: bigint;
  tokenOut: Address;
  amountOut: bigint;
}

export interface InMemoryPortfolioVarDependencies {
  inventoryService: IInventoryService;
  marketSnapshotStore: MarketSnapshotStore;
}

export class InMemoryPortfolioVarEvaluator {
  private readonly policy;

  constructor(
    policy: PortfolioVarPolicy,
    private readonly tokenRegistry: TokenRegistry,
    private readonly dependencies: InMemoryPortfolioVarDependencies,
    private readonly nowMilliseconds: () => number = () => Date.now(),
  ) {
    this.policy = normalizePortfolioVarPolicy(policy, tokenRegistry);
    if (typeof dependencies?.inventoryService?.listPositions !== "function") {
      throw new Error("In-memory portfolio VaR inventoryService.listPositions must be a function");
    }
    if (typeof dependencies?.marketSnapshotStore?.findLatestForPair !== "function") {
      throw new Error("In-memory portfolio VaR marketSnapshotStore.findLatestForPair must be a function");
    }
    if (typeof nowMilliseconds !== "function") {
      throw new Error("In-memory portfolio VaR nowMilliseconds must be a function");
    }
  }

  async evaluate(
    chainId: number,
    activeReservations: readonly PortfolioQuoteDelta[],
    candidate: PortfolioQuoteDelta,
  ): Promise<PortfolioVarEvaluation> {
    const nowMs = this.nowMilliseconds();
    if (!Number.isSafeInteger(nowMs) || nowMs <= 0) {
      throw new Error("In-memory portfolio VaR current time must be a positive safe integer");
    }
    const listed = await this.dependencies.inventoryService.listPositions!(chainId);
    let preTradePositions: PortfolioVarPosition[] = listed.map((position) => ({
      chainId: position.chainId,
      tokenAddress: position.token,
      balance: position.balance,
    }));
    for (const reservation of activeReservations) {
      if (reservation.chainId !== chainId) continue;
      preTradePositions = applyPortfolioDelta(
        preTradePositions,
        chainId,
        reservation.tokenIn,
        reservation.amountIn,
        reservation.tokenOut,
        reservation.amountOut,
      );
    }
    const postTradePositions = applyPortfolioDelta(
      preTradePositions,
      chainId,
      candidate.tokenIn,
      candidate.amountIn,
      candidate.tokenOut,
      candidate.amountOut,
    );
    const requiredAssets = nonZeroValuationAssets(chainId, preTradePositions, postTradePositions, this.policy.valuationPairs);
    const snapshots = await Promise.all(requiredAssets.map(async (pair): Promise<PortfolioVarSnapshot> => {
      const snapshot = await this.dependencies.marketSnapshotStore.findLatestForPair!(
        chainId,
        pair.tokenAddress,
        pair.usdReferenceTokenAddress,
      );
      if (!snapshot) {
        throw new Error(`In-memory portfolio VaR has no snapshot for ${chainId}:${pair.tokenAddress}`);
      }
      return {
        snapshotId: snapshot.snapshotId,
        chainId: snapshot.chainId,
        tokenIn: snapshot.tokenIn,
        tokenOut: snapshot.tokenOut,
        midPrice: snapshot.midPrice,
        volatilityBps: snapshot.volatilityBps,
        observedAt: snapshot.observedAt,
      };
    }));
    return evaluatePortfolioVar(
      chainId,
      preTradePositions,
      postTradePositions,
      snapshots,
      this.policy,
      this.tokenRegistry,
      nowMs,
    );
  }

  exceedsLimit(evaluation: PortfolioVarEvaluation): boolean {
    return BigInt(evaluation.postTradeVarUsdE18) > this.policy.maxPortfolioVarUsdE18;
  }
}

function nonZeroValuationAssets(
  chainId: number,
  preTrade: readonly PortfolioVarPosition[],
  postTrade: readonly PortfolioVarPosition[],
  pairs: readonly { chainId: number; tokenAddress: Address; usdReferenceTokenAddress: Address }[],
) {
  const balances = new Map<string, bigint>();
  for (const position of [...preTrade, ...postTrade]) {
    if (position.chainId !== chainId) continue;
    const key = position.tokenAddress.toLowerCase();
    if (position.balance !== 0n) balances.set(key, position.balance);
  }
  return pairs.filter((pair) => pair.chainId === chainId && balances.has(pair.tokenAddress.toLowerCase()));
}
