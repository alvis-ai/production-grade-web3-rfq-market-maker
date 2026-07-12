import type { Address } from "../../shared/types/rfq.js";

export interface SettlementIndexerCursor {
  chainId: number;
  settlementAddress: Address;
  startBlock: number;
  nextBlock: number;
  revision: number;
  leaseOwner: string;
  leaseExpiresAt: string;
}

export interface SettlementIndexerCheckpoint {
  chainId: number;
  blockNumber: number;
  blockHash: `0x${string}`;
}

export interface SettlementIndexerEventRef {
  chainId: number;
  txHash: `0x${string}`;
  blockNumber: number;
  logIndex: number;
}

export interface SettlementIndexerCursorStats {
  chainId: number;
  nextBlock: number;
  updatedAt: string;
}

export interface ClaimSettlementIndexerCursorInput {
  chainId: number;
  settlementAddress: Address;
  startBlock: number;
  workerId: string;
  leaseMs: number;
}

export interface AdvanceSettlementIndexerCursorInput {
  chainId: number;
  workerId: string;
  leaseMs: number;
  expectedRevision: number;
  expectedNextBlock: number;
  nextBlock: number;
  checkpoint: SettlementIndexerCheckpoint;
}

export interface RollbackSettlementIndexerCursorInput {
  chainId: number;
  workerId: string;
  leaseMs: number;
  expectedRevision: number;
  expectedNextBlock: number;
  nextBlock: number;
}

export interface SettlementIndexerStore {
  checkHealth(): Promise<void>;
  claimCursor(input: ClaimSettlementIndexerCursorInput): Promise<SettlementIndexerCursor | undefined>;
  advanceCursor(input: AdvanceSettlementIndexerCursorInput): Promise<SettlementIndexerCursor>;
  rollbackCursor(input: RollbackSettlementIndexerCursorInput): Promise<SettlementIndexerCursor>;
  releaseCursor(chainId: number, workerId: string): Promise<void>;
  listCheckpoints(chainId: number, fromBlock: number, beforeBlock: number): Promise<SettlementIndexerCheckpoint[]>;
  listCanonicalEventRefs(chainId: number, fromBlock: number, toBlock: number): Promise<SettlementIndexerEventRef[]>;
  stats(): Promise<SettlementIndexerCursorStats[]>;
}

export class SettlementIndexerLeaseError extends Error {
  readonly code = "SETTLEMENT_INDEXER_LEASE_LOST";

  constructor() {
    super("Settlement indexer cursor lease or revision was lost");
  }
}
