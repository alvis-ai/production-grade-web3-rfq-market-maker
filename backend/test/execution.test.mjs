import assert from "node:assert/strict";
import test from "node:test";
import { keccak256, toBytes } from "viem";
import { buildSyntheticTxHash, SkeletonExecutionService } from "../dist/modules/execution/execution.service.js";
import { HedgeService } from "../dist/modules/hedge/hedge.service.js";
import { InventoryService } from "../dist/modules/inventory/inventory.service.js";
import { SettlementEventService } from "../dist/modules/settlement/settlement-event.service.js";
import { LocalSettlementVerifier } from "../dist/modules/settlement/settlement-verifier.service.js";

const request = {
  quote: {
    user: "0x0000000000000000000000000000000000000001",
    tokenIn: "0x0000000000000000000000000000000000000002",
    tokenOut: "0x0000000000000000000000000000000000000003",
    amountIn: "1000000000",
    amountOut: "998400000",
    minAmountOut: "993408000",
    nonce: "42",
    deadline: 1893456000,
    chainId: 1,
  },
  signature: `0x${"11".repeat(64)}1b`,
};

test("buildSyntheticTxHash returns deterministic keccak256 bytes32 hashes", () => {
  const context = { quoteId: "q_test" };
  const expectedPayload = JSON.stringify({
    quoteId: context.quoteId,
    quote: request.quote,
    signature: request.signature,
  });
  const expectedHash = keccak256(toBytes(expectedPayload));

  const txHash = buildSyntheticTxHash(request, context);

  assert.match(txHash, /^0x[0-9a-f]{64}$/);
  assert.equal(txHash, expectedHash);
});

test("SkeletonExecutionService suppresses duplicate settlement side effects", async () => {
  const inventoryService = new InventoryService();
  const hedgeService = new HedgeService();
  const settlementEventService = new SettlementEventService(inventoryService);
  const executionService = new SkeletonExecutionService({
    hedgeService,
    inventoryService,
    settlementEventService,
    settlementVerifier: new LocalSettlementVerifier(),
  });
  const context = { quoteId: "q_test" };

  const first = await executionService.submitQuote(request, context);
  assert.equal(first.response.status, "accepted");
  assert.equal(first.settlementEventResult.duplicate, false);
  assert.match(first.response.settlementEventId, /^se_/);
  assert.match(first.response.hedgeOrderId, /^h_/);
  assert.equal(first.hedgeResult?.record.settlementEventId, first.response.settlementEventId);
  assert.equal(first.inventoryPositions.tokenIn.balance, BigInt(request.quote.amountIn));
  assert.equal(first.inventoryPositions.tokenOut.balance, -BigInt(request.quote.amountOut));

  const replay = await executionService.submitQuote(request, context);
  assert.equal(replay.response.status, "accepted");
  assert.equal(replay.response.txHash, first.response.txHash);
  assert.equal(replay.response.settlementEventId, first.response.settlementEventId);
  assert.equal(replay.response.hedgeOrderId, undefined);
  assert.equal(replay.hedgeResult, undefined);
  assert.equal(replay.hedgeFailure, undefined);
  assert.equal(replay.settlementEventResult.duplicate, true);
  assert.equal(inventoryService.getPosition(request.quote.chainId, request.quote.tokenIn).balance, BigInt(request.quote.amountIn));
  assert.equal(inventoryService.getPosition(request.quote.chainId, request.quote.tokenOut).balance, -BigInt(request.quote.amountOut));
  const storedHedge = hedgeService.getHedgeIntent(first.response.hedgeOrderId);
  assert.deepEqual(storedHedge, first.hedgeResult?.record);
  assert.notEqual(storedHedge, first.hedgeResult?.record);
});

test("SkeletonExecutionService snapshots dependency object at construction", async () => {
  const inventoryService = new InventoryService();
  const replacementInventoryService = new InventoryService();
  const deps = {
    hedgeService: new HedgeService(),
    inventoryService,
    settlementEventService: new SettlementEventService(inventoryService),
    settlementVerifier: new LocalSettlementVerifier(),
  };
  const executionService = new SkeletonExecutionService(deps);

  deps.hedgeService = {
    createHedgeIntent() {
      throw new Error("mutated hedge service used");
    },
    getHedgeIntent() {
      return undefined;
    },
    getHedgeIntentBySettlementEvent() {
      return undefined;
    },
  };
  deps.inventoryService = replacementInventoryService;
  deps.settlementEventService = new SettlementEventService(replacementInventoryService);
  deps.settlementVerifier = {
    async verify() {
      throw new Error("mutated settlement verifier used");
    },
  };

  const result = await executionService.submitQuote(request, { quoteId: "q_snapshot_deps" });

  assert.equal(result.settlementVerification.status, "verified");
  assert.equal(result.response.status, "accepted");
  assert.match(result.response.hedgeOrderId, /^h_/);
  assert.equal(inventoryService.getPosition(request.quote.chainId, request.quote.tokenIn).balance, BigInt(request.quote.amountIn));
  assert.equal(replacementInventoryService.getPosition(request.quote.chainId, request.quote.tokenIn).balance, 0n);
});

test("SkeletonExecutionService rejects unsafe execution inputs before settlement side effects", async () => {
  const inventoryService = new InventoryService();
  const hedgeService = new HedgeService();
  const settlementEventService = new SettlementEventService(inventoryService);
  const executionService = new SkeletonExecutionService({
    hedgeService,
    inventoryService,
    settlementEventService,
    settlementVerifier: new LocalSettlementVerifier(),
  });

  await assert.rejects(
    executionService.submitQuote(request, { quoteId: " " }),
    /Execution context quoteId must be a non-empty string/,
  );

  await assert.rejects(
    executionService.submitQuote(
      {
        ...request,
        signature: "0x1234",
      },
      { quoteId: "q_invalid_signature" },
    ),
    /signature must be 65 bytes/,
  );

  await assert.rejects(
    executionService.submitQuote(
      {
        ...request,
        signature: `0x${"11".repeat(64)}02`,
      },
      { quoteId: "q_invalid_signature_v" },
    ),
    /signature v value must be 27 or 28/,
  );

  await assert.rejects(
    executionService.submitQuote(
      {
        ...request,
        signature: `0x${"11".repeat(32)}${"f".repeat(64)}1b`,
      },
      { quoteId: "q_high_s_signature" },
    ),
    /signature s value must be in the lower half order/,
  );

  await assert.rejects(
    executionService.submitQuote(
      {
        ...request,
        quote: {
          ...request.quote,
          tokenOut: request.quote.tokenIn,
        },
      },
      { quoteId: "q_invalid_pair" },
    ),
    /quote.tokenIn and quote.tokenOut must be different/,
  );

  assert.equal(inventoryService.getPosition(request.quote.chainId, request.quote.tokenIn).balance, 0n);
  assert.equal(inventoryService.getPosition(request.quote.chainId, request.quote.tokenOut).balance, 0n);
  assert.equal(settlementEventService.getSettlementEvent("q_invalid_pair"), undefined);
});
