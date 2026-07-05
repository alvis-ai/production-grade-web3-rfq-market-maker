import assert from "node:assert/strict";
import test from "node:test";
import { InventoryService } from "../dist/modules/inventory/inventory.service.js";
import {
  hashSettlementQuote,
  SettlementEventService,
} from "../dist/modules/settlement/settlement-event.service.js";

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

test("SettlementEventService rejects unsafe quote hash lookup envelopes", () => {
  const inventory = new InventoryService();
  const settlements = new SettlementEventService(inventory);
  const quoteHash = hashSettlementQuote(quote);

  assert.throws(
    () => settlements.getSettlementEventsByQuoteHash([]),
    /Settlement event quote hash lookup input must be an object/,
  );
  assert.throws(
    () =>
      settlements.getSettlementEventsByQuoteHash(
        Object.create({
          chainId: quote.chainId,
          quoteHash,
        }),
      ),
    /Settlement event quote hash lookup input.chainId must be an own field/,
  );

  const inheritedQuoteHashInput = Object.create({ quoteHash });
  Object.assign(inheritedQuoteHashInput, { chainId: quote.chainId });
  assert.throws(
    () => settlements.getSettlementEventsByQuoteHash(inheritedQuoteHashInput),
    /Settlement event quote hash lookup input.quoteHash must be an own field/,
  );

  assert.throws(
    () =>
      settlements.getSettlementEventsByQuoteHash({
        chainId: 0,
        quoteHash,
      }),
    /Settlement event lookup.chainId must be a positive safe integer/,
  );
  assert.throws(
    () =>
      settlements.getSettlementEventsByQuoteHash({
        chainId: quote.chainId,
        quoteHash: "0x1234",
      }),
    /Settlement event quoteHash must be a 32-byte hex string/,
  );
  assert.throws(
    () =>
      settlements.getSettlementEventsByQuoteHash({
        chainId: quote.chainId,
        quoteHash: new String(quoteHash),
      }),
    /Settlement event quoteHash must be a 32-byte hex string/,
  );
});

test("SettlementEventService rejects unsafe settlement event lookup identifiers", () => {
  const inventory = new InventoryService();
  const settlements = new SettlementEventService(inventory);

  assert.throws(
    () => settlements.getSettlementEvent(" "),
    /Settlement event settlementEventId must be a non-empty string/,
  );
  assert.throws(
    () => settlements.getSettlementEvent(new String("se_lookup")),
    /Settlement event settlementEventId must be a primitive string/,
  );
  assert.throws(
    () => settlements.getSettlementEvent("se/bad"),
    /Settlement event settlementEventId must contain only letters, numbers, underscore, colon, or hyphen/,
  );
  assert.throws(
    () => settlements.getSettlementEvent("s".repeat(129)),
    /Settlement event settlementEventId must be 128 characters or fewer/,
  );

  const applied = settlements.applySettlementEvent({
    quoteId: "q_lookup",
    quote,
    txHash: `0x${"21".repeat(32)}`,
  });
  assert.deepEqual(settlements.getSettlementEvent(applied.event.settlementEventId), applied.event);
});

test("SettlementEventService rejects unsafe inventory dependency at construction", () => {
  assert.throws(
    () => new SettlementEventService(undefined),
    /Settlement event inventoryService must be an object/,
  );
  assert.throws(
    () => new SettlementEventService([]),
    /Settlement event inventoryService must be an object/,
  );
  assert.throws(
    () =>
      new SettlementEventService({
        rebuildFromSettlements() {},
      }),
    /Settlement event inventoryService.applySettlement must be a function/,
  );
  assert.throws(
    () =>
      new SettlementEventService({
        applySettlement() {},
      }),
    /Settlement event inventoryService.rebuildFromSettlements must be a function/,
  );
});

test("hashSettlementQuote rejects malformed quote fields before ABI encoding", () => {
  assert.throws(
    () => hashSettlementQuote([]),
    /Settlement event quote must be an object/,
  );
  assert.throws(
    () =>
      hashSettlementQuote({
        ...quote,
        tokenOut: "0x1234",
      }),
    /Settlement event quote.tokenOut must be a 20-byte hex address/,
  );
  assert.throws(
    () => hashSettlementQuote(Object.create(quote)),
    /Settlement event quote.user must be an own field/,
  );
});
