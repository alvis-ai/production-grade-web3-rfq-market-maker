import assert from "node:assert/strict";
import test from "node:test";
import { InventoryService } from "../dist/modules/inventory/inventory.service.js";
import { SettlementEventService } from "../dist/modules/settlement/settlement-event.service.js";

const quote = {
  user: "0x0000000000000000000000000000000000000001",
  tokenIn: "0x0000000000000000000000000000000000000002",
  tokenOut: "0x0000000000000000000000000000000000000003",
  amountIn: "1000",
  amountOut: "990",
  minAmountOut: "980",
  nonce: "1",
  deadline: 1893456000,
  chainId: 1,
};

test("SettlementEventService removes reorged events and rebuilds inventory from canonical events", () => {
  const inventory = new InventoryService();
  const settlements = new SettlementEventService(inventory);
  const reorged = settlements.applySettlementEvent({
    quoteId: "q_reorged",
    quote,
    txHash: `0x${"31".repeat(32)}`,
    blockNumber: 50,
    logIndex: 1,
  });
  const canonical = settlements.applySettlementEvent({
    quoteId: "q_canonical",
    quote: {
      ...quote,
      amountIn: "2000",
      amountOut: "1980",
      minAmountOut: "1900",
      nonce: "2",
    },
    txHash: `0x${"32".repeat(32)}`,
    blockNumber: 51,
    logIndex: 0,
  });

  const removed = settlements.removeSettlementEvent({
    chainId: quote.chainId,
    txHash: reorged.event.txHash,
    blockNumber: reorged.event.blockNumber,
    logIndex: reorged.event.logIndex,
  });

  assert.equal(removed.removed, true);
  assert.deepEqual(removed.event, reorged.event);
  assert.equal(settlements.getSettlementEvent(reorged.event.settlementEventId), undefined);
  assert.deepEqual(
    settlements.listSettlementEvents().map((event) => event.settlementEventId),
    [canonical.event.settlementEventId],
  );
  assert.deepEqual(
    settlements.getSettlementEventsByQuoteHash({
      chainId: quote.chainId,
      quoteHash: reorged.event.quoteHash,
    }),
    [],
  );
  assert.deepEqual(
    settlements.getSettlementEventsByQuoteHash({
      chainId: quote.chainId,
      quoteHash: canonical.event.quoteHash,
    }).map((event) => event.settlementEventId),
    [canonical.event.settlementEventId],
  );
  assert.equal(inventory.getPosition(quote.chainId, quote.tokenIn).balance, 2000n);
  assert.equal(inventory.getPosition(quote.chainId, quote.tokenOut).balance, -1980n);
});

test("SettlementEventService treats duplicate reorg removals as idempotent", () => {
  const inventory = new InventoryService();
  const settlements = new SettlementEventService(inventory);
  const event = settlements.applySettlementEvent({
    quoteId: "q_reorg_duplicate",
    quote,
    txHash: `0x${"33".repeat(32)}`,
    blockNumber: 60,
    logIndex: 2,
  });

  const first = settlements.removeSettlementEvent({
    chainId: quote.chainId,
    txHash: event.event.txHash,
    blockNumber: event.event.blockNumber,
    logIndex: event.event.logIndex,
  });
  const replay = settlements.removeSettlementEvent({
    chainId: quote.chainId,
    txHash: event.event.txHash,
    blockNumber: event.event.blockNumber,
    logIndex: event.event.logIndex,
  });

  assert.equal(first.removed, true);
  assert.equal(replay.removed, false);
  assert.equal(replay.event, undefined);
  assert.equal(inventory.getPosition(quote.chainId, quote.tokenIn).balance, 0n);
  assert.equal(inventory.getPosition(quote.chainId, quote.tokenOut).balance, 0n);
});

test("SettlementEventService rejects conflicting reorg removals before mutating state", () => {
  const inventory = new InventoryService();
  const settlements = new SettlementEventService(inventory);
  const event = settlements.applySettlementEvent({
    quoteId: "q_reorg_conflict",
    quote,
    txHash: `0x${"34".repeat(32)}`,
    blockNumber: 70,
    logIndex: 3,
  });

  assert.throws(
    () =>
      settlements.removeSettlementEvent({
        chainId: quote.chainId,
        txHash: event.event.txHash,
        blockNumber: event.event.blockNumber + 1,
        logIndex: event.event.logIndex,
      }),
    /Settlement event reorg block conflict/,
  );
  assert.deepEqual(settlements.getSettlementEvent(event.event.settlementEventId), event.event);
  assert.equal(inventory.getPosition(quote.chainId, quote.tokenIn).balance, 1000n);
  assert.equal(inventory.getPosition(quote.chainId, quote.tokenOut).balance, -990n);
});
