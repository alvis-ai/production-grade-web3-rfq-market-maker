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

export interface PortfolioTokenDelta {
  chainId: number;
  tokenAddress: Address;
  delta: bigint;
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
    const tokenDeltas: PortfolioTokenDelta[] = [];
    for (const reservation of activeReservations) {
      if (reservation.chainId !== chainId) continue;
      tokenDeltas.push(
        { chainId, tokenAddress: reservation.tokenIn, delta: reservation.amountIn },
        { chainId, tokenAddress: reservation.tokenOut, delta: -reservation.amountOut },
      );
    }
    return this.evaluateTokenDeltas(chainId, tokenDeltas, candidate);
  }

  async evaluateTokenDeltas(
    chainId: number,
    activeDeltas: readonly PortfolioTokenDelta[],
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
    for (const active of activeDeltas) {
      assertPortfolioTokenDelta(active, chainId);
      preTradePositions = applyTokenDelta(preTradePositions, active);
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

  valuationAssets(chainId: number): Address[] {
    if (!Number.isSafeInteger(chainId) || chainId <= 0) {
      throw new Error("In-memory portfolio VaR chainId must be a positive safe integer");
    }
    return this.policy.valuationPairs
      .filter((pair) => pair.chainId === chainId)
      .map((pair) => pair.tokenAddress);
  }
}

function applyTokenDelta(
  positions: readonly PortfolioVarPosition[],
  active: PortfolioTokenDelta,
): PortfolioVarPosition[] {
  const normalizedToken = active.tokenAddress.toLowerCase() as Address;
  const next = positions.map((position) => ({ ...position }));
  const existing = next.find(
    (position) => position.chainId === active.chainId &&
      position.tokenAddress.toLowerCase() === normalizedToken,
  );
  if (existing) {
    existing.balance += active.delta;
  } else {
    next.push({ chainId: active.chainId, tokenAddress: normalizedToken, balance: active.delta });
  }
  return next;
}

function assertPortfolioTokenDelta(value: PortfolioTokenDelta, expectedChainId: number): void {
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
      !Number.isSafeInteger(value.chainId) || value.chainId <= 0 || value.chainId !== expectedChainId ||
      typeof value.tokenAddress !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value.tokenAddress) ||
      typeof value.delta !== "bigint") {
    throw new Error("In-memory portfolio VaR active token delta is invalid");
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
