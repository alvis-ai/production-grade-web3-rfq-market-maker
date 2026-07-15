import assert from "node:assert/strict";
import test from "node:test";
import { hashSettlementQuote } from "../dist/modules/settlement/settlement-event.service.js";
import { SettlementIndexerWorker } from "../dist/modules/indexer/settlement-indexer.worker.js";

const quote = {
  user: "0x0000000000000000000000000000000000000001",
  tokenIn: "0x0000000000000000000000000000000000000002",
  tokenOut: "0x0000000000000000000000000000000000000003",
  amountIn: "1000",
  amountOut: "998",
  minAmountOut: "990",
  nonce: "42",
  deadline: 4_102_444_800,
  chainId: 1,
};

test("settlement indexer ingests confirmed matching logs and advances only after side effects", async () => {
  const fixture = createFixture();
  fixture.reader.head = 110;
  fixture.reader.logs = [settledLog(102, 3)];

  assert.equal(await fixture.worker.runChainOnce(1), true);

  assert.equal(fixture.events.applied.length, 1);
  assert.equal(fixture.events.applied[0].quoteId, "q_indexed_1");
  assert.equal(fixture.events.applied[0].txHash, settledLog(102, 3).transactionHash);
  assert.equal(fixture.events.applied[0].settledAt, blockTimestamp(102));
  assert.equal(fixture.store.cursor.nextBlock, 105);
  assert.equal(fixture.store.cursor.revision, 1);
  assert.deepEqual(fixture.observer.events, [{ chainId: 1, outcome: "applied" }]);
  assert.equal(fixture.observer.ranges, 1);
});

test("settlement indexer treats an event already consumed by /submit as an idempotent duplicate", async () => {
  const fixture = createFixture({ duplicate: true });
  fixture.reader.logs = [settledLog(100, 0)];

  await fixture.worker.runChainOnce(1);

  assert.equal(fixture.store.cursor.nextBlock, 105);
  assert.deepEqual(fixture.observer.events, [{ chainId: 1, outcome: "duplicate" }]);
});

test("settlement indexer blocks cursor advance for unknown or mismatched quotes", async () => {
  const missing = createFixture({ quoteRecord: undefined });
  missing.reader.logs = [settledLog(100, 0)];
  await assert.rejects(missing.worker.runChainOnce(1), (error) => error.code === "QUOTE_NOT_FOUND");
  assert.equal(missing.store.cursor.nextBlock, 100);
  assert.equal(missing.events.applied.length, 0);

  const mismatched = createFixture();
  mismatched.reader.logs = [{ ...settledLog(100, 0), amountOut: "997" }];
  await assert.rejects(mismatched.worker.runChainOnce(1), (error) => error.code === "EVENT_MISMATCH");
  assert.equal(mismatched.store.cursor.nextBlock, 100);
  assert.equal(mismatched.events.applied.length, 0);
});

test("settlement indexer rejects a mixed-fork log batch before applying events", async () => {
  const fixture = createFixture();
  fixture.reader.logs = [settledLog(101, 0)];
  fixture.reader.blockHashes.set(101, hash(999));

  await assert.rejects(
    fixture.worker.runChainOnce(1),
    (error) => error.code === "CHAIN_REORG_DURING_SCAN",
  );
  assert.equal(fixture.events.applied.length, 0);
  assert.equal(fixture.store.cursor.nextBlock, 100);
});

test("settlement indexer fails closed on a malformed block timestamp", async () => {
  const fixture = createFixture();
  fixture.reader.logs = [settledLog(101, 0)];
  fixture.reader.blockTimestamps.set(101, "2026-07-14T00:00:00Z");

  await assert.rejects(
    fixture.worker.runChainOnce(1),
    (error) => error.code === "RPC_OR_STORE_UNAVAILABLE",
  );
  assert.equal(fixture.events.applied.length, 0);
  assert.equal(fixture.store.cursor.nextBlock, 100);
});

test("settlement indexer removes orphaned events left by a crash before cursor commit", async () => {
  const fixture = createFixture();
  fixture.reader.logs = [settledLog(102, 0)];
  fixture.store.eventRefs = [
    eventRef(101, 0, hash(9_101)),
    eventRef(102, 0, fixture.reader.logs[0].transactionHash),
  ];

  await fixture.worker.runChainOnce(1);

  assert.deepEqual(fixture.events.removed, [{
    chainId: 1,
    txHash: hash(9_101),
    blockNumber: 101,
    logIndex: 0,
  }]);
  assert.equal(fixture.events.applied.length, 1);
  assert.equal(fixture.store.cursor.nextBlock, 105);
  assert.deepEqual(fixture.observer.reorgs, [{ chainId: 1, depth: 5, removedEvents: 1 }]);
});

test("settlement indexer removes orphaned events before rolling back to a common checkpoint", async () => {
  const fixture = createFixture({ startBlock: 100, nextBlock: 110 });
  fixture.store.checkpoints = [
    checkpoint(109, hash(109)),
    checkpoint(104, hash(104)),
  ];
  fixture.reader.blockHashes.set(109, hash(9001));
  fixture.reader.blockHashes.set(104, hash(104));
  fixture.store.eventRefs = [
    eventRef(108, 1, hash(81)),
    eventRef(106, 0, hash(61)),
  ];

  assert.equal(await fixture.worker.runChainOnce(1), true);

  assert.deepEqual(fixture.events.removed.map(({ blockNumber }) => blockNumber), [108, 106]);
  assert.equal(fixture.store.cursor.nextBlock, 105);
  assert.equal(fixture.store.cursor.revision, 1);
  assert.deepEqual(fixture.observer.reorgs, [{ chainId: 1, depth: 5, removedEvents: 2 }]);
  assert.equal(fixture.reader.logRequests.length, 0);
});

test("settlement indexer fails closed when a reorg exceeds the configured checkpoint window", async () => {
  const fixture = createFixture({ startBlock: 100, nextBlock: 1_000 });
  fixture.store.checkpoints = [
    checkpoint(999, hash(999)),
    checkpoint(950, hash(950)),
    checkpoint(900, hash(900)),
  ];
  fixture.reader.blockHashes.set(999, hash(8_999));
  fixture.reader.blockHashes.set(950, hash(8_950));
  fixture.reader.blockHashes.set(900, hash(8_900));

  await assert.rejects(fixture.worker.runChainOnce(1), (error) => error.code === "DEEP_REORG");
  assert.equal(fixture.store.cursor.nextBlock, 1_000);
  assert.equal(fixture.events.removed.length, 0);
});

test("settlement indexer run loop records bounded errors and readiness freshness", async () => {
  const fixture = createFixture({ quoteRecord: undefined, readinessStaleMs: 1_000 });
  fixture.reader.logs = [settledLog(100, 0)];
  assert.equal(fixture.worker.isReady(0), false);
  await fixture.worker.checkDependencies();
  assert.equal(fixture.worker.isReady(Date.now()), true);

  assert.equal(await fixture.worker.runOnce(), false);
  assert.deepEqual(fixture.observer.errors, [{ chainId: 1, code: "QUOTE_NOT_FOUND" }]);
  assert.equal(fixture.logger.entries[0].input.errorCode, "QUOTE_NOT_FOUND");
  assert.equal(fixture.logger.entries[0].input.rpcUrl, undefined);
});

test("settlement indexer rejects a wrong RPC chain before claiming a cursor", async () => {
  const fixture = createFixture();
  fixture.reader.chainId = 2;

  await assert.rejects(
    fixture.worker.runChainOnce(1),
    (error) => error.code === "RPC_OR_STORE_UNAVAILABLE",
  );
  assert.equal(fixture.store.claimCalls, 0);
  assert.equal(fixture.reader.logRequests.length, 0);
});

function createFixture(options = {}) {
  const startBlock = options.startBlock ?? 100;
  const nextBlock = options.nextBlock ?? startBlock;
  const store = new FakeStore(startBlock, nextBlock);
  const reader = new FakeReader();
  const observer = new FakeObserver();
  const logger = { entries: [], error(input, message) { this.entries.push({ input, message }); } };
  const quoteRecord = Object.hasOwn(options, "quoteRecord") ? options.quoteRecord : signedQuoteRecord();
  const quoteRepository = {
    async findSignedQuoteByChainUserNonce() {
      return quoteRecord ? { ...quoteRecord } : undefined;
    },
  };
  const events = {
    applied: [],
    removed: [],
    async applySettlementEvent(input) {
      this.applied.push(input);
      return {
        event: { settlementEventId: "se_test" },
        duplicate: options.duplicate ?? false,
      };
    },
    async removeSettlementEvent(input) {
      this.removed.push(input);
      return { removed: true };
    },
  };
  const worker = new SettlementIndexerWorker(
    [chainConfig(startBlock)],
    store,
    quoteRepository,
    events,
    {
      workerId: "indexer_test_1",
      leaseMs: 30_000,
      pollIntervalMs: 10,
      readinessStaleMs: options.readinessStaleMs ?? 60_000,
    },
    observer,
    logger,
    () => reader,
  );
  return { worker, store, reader, observer, logger, events };
}

class FakeStore {
  constructor(startBlock, nextBlock) {
    this.cursor = {
      chainId: 1,
      settlementAddress: chainConfig(startBlock).settlementAddress,
      startBlock,
      nextBlock,
      revision: 0,
      leaseOwner: "indexer_test_1",
      leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    this.checkpoints = [];
    this.eventRefs = [];
    this.claimCalls = 0;
  }
  async checkHealth() {}
  async claimCursor() { this.claimCalls += 1; return { ...this.cursor }; }
  async advanceCursor(input) {
    assert.equal(this.cursor.nextBlock, input.expectedNextBlock);
    this.checkpoints.unshift({ ...input.checkpoint });
    this.cursor.nextBlock = input.nextBlock;
    this.cursor.revision += 1;
    return { ...this.cursor };
  }
  async rollbackCursor(input) {
    assert.equal(this.cursor.nextBlock, input.expectedNextBlock);
    this.cursor.nextBlock = input.nextBlock;
    this.cursor.revision += 1;
    this.checkpoints = this.checkpoints.filter(({ blockNumber }) => blockNumber < input.nextBlock);
    return { ...this.cursor };
  }
  async releaseCursor() {}
  async listCheckpoints(_chainId, fromBlock, beforeBlock) {
    return this.checkpoints
      .filter(({ blockNumber }) => blockNumber >= fromBlock && blockNumber < beforeBlock)
      .sort((left, right) => right.blockNumber - left.blockNumber)
      .map((checkpointValue) => ({ ...checkpointValue }));
  }
  async listCanonicalEventRefs() { return this.eventRefs.map((event) => ({ ...event })); }
  async stats() { return []; }
}

class FakeReader {
  constructor() {
    this.chainId = 1;
    this.head = 110;
    this.logs = [];
    this.logRequests = [];
    this.blockHashes = new Map(Array.from({ length: 1_100 }, (_, block) => [block, hash(block)]));
    this.blockTimestamps = new Map();
  }
  async getChainId() { return this.chainId; }
  async getBlockNumber() { return this.head; }
  async getBlockHash(blockNumber) { return this.blockHashes.get(blockNumber) ?? hash(blockNumber); }
  async getBlockTimestamp(blockNumber) {
    return this.blockTimestamps.get(blockNumber) ?? blockTimestamp(blockNumber);
  }
  async getQuoteSettledLogs(fromBlock, toBlock) {
    this.logRequests.push({ fromBlock, toBlock });
    return this.logs.map((log) => ({ ...log }));
  }
}

class FakeObserver {
  constructor() {
    this.cursors = [];
    this.events = [];
    this.ranges = 0;
    this.reorgs = [];
    this.errors = [];
  }
  recordCursor(chainId, nextBlock, safeHead) { this.cursors.push({ chainId, nextBlock, safeHead }); }
  recordEvent(chainId, outcome) { this.events.push({ chainId, outcome }); }
  recordRange() { this.ranges += 1; }
  recordReorg(chainId, depth, removedEvents) { this.reorgs.push({ chainId, depth, removedEvents }); }
  recordError(chainId, code) { this.errors.push({ chainId, code }); }
}

function chainConfig(startBlock = 100) {
  return {
    chainId: 1,
    rpcUrl: "https://rpc.example/project-token",
    settlementAddress: "0x0000000000000000000000000000000000000004",
    startBlock,
    confirmations: 2,
    maxBlockRange: 5,
    reorgLookbackBlocks: 100,
    requestTimeoutMs: 5_000,
  };
}

function blockTimestamp(blockNumber) {
  return new Date(1_700_000_000_000 + blockNumber * 1_000).toISOString();
}

function signedQuoteRecord() {
  return {
    quoteId: "q_indexed_1",
    ...quote,
    slippageBps: 50,
    snapshotId: "snapshot_indexed_1",
    pricingVersion: "pricing-v1",
    spreadBps: 10,
    sizeImpactBps: 1,
    marketSpreadBps: 0,
    inventorySkewBps: 0,
    volatilityPremiumBps: 0,
    hedgeCostBps: 0,
    riskPolicyVersion: "risk-v1",
    status: "signed",
    signature: `0x${"11".repeat(64)}1b`,
  };
}

function settledLog(blockNumber, logIndex) {
  return {
    transactionHash: hash(20 + blockNumber + logIndex),
    blockHash: hash(blockNumber),
    blockNumber,
    logIndex,
    quoteHash: hashSettlementQuote(quote),
    user: quote.user,
    tokenIn: quote.tokenIn,
    tokenOut: quote.tokenOut,
    amountIn: quote.amountIn,
    amountOut: quote.amountOut,
    nonce: quote.nonce,
  };
}

function checkpoint(blockNumber, blockHash) {
  return { chainId: 1, blockNumber, blockHash };
}

function eventRef(blockNumber, logIndex, txHash) {
  return { chainId: 1, blockNumber, logIndex, txHash };
}

function hash(value) {
  return `0x${BigInt(value).toString(16).padStart(64, "0")}`;
}
