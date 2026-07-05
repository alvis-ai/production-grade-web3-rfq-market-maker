import assert from "node:assert/strict";
import test from "node:test";
import { buildSyntheticTxHash, SkeletonExecutionService } from "../dist/modules/execution/execution.service.js";
import { HedgeService } from "../dist/modules/hedge/hedge.service.js";
import { InventoryService } from "../dist/modules/inventory/inventory.service.js";
import { SettlementEventService } from "../dist/modules/settlement/settlement-event.service.js";
import { LocalSettlementVerifier } from "../dist/modules/settlement/settlement-verifier.service.js";
import { LocalEIP712SignerService } from "../dist/modules/signer/signer.service.js";

const executionQuote = {
  user: "0x0000000000000000000000000000000000000001",
  tokenIn: "0x0000000000000000000000000000000000000002",
  tokenOut: "0x0000000000000000000000000000000000000003",
  amountIn: "1000000000",
  amountOut: "998400000",
  minAmountOut: "993408000",
  nonce: "42",
  deadline: 1893456000,
  chainId: 1,
};

const request = {
  quote: executionQuote,
  signature: await new LocalEIP712SignerService({
    privateKey: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    settlementAddress: "0x0000000000000000000000000000000000000004",
  }).signQuote({
    quote: executionQuote,
    quoteId: "q_test",
    snapshotId: "snapshot_test",
  }),
};

test("buildSyntheticTxHash rejects malformed submit payloads before hashing", () => {
  const context = { quoteId: "q_hash_validation" };

  assert.throws(
    () => buildSyntheticTxHash(undefined, context),
    /Submit request must include a quote object/,
  );
  assert.throws(
    () => buildSyntheticTxHash({ signature: request.signature }, context),
    /Submit request must include a quote object/,
  );
  assert.throws(
    () => buildSyntheticTxHash({ ...request, signature: "0x1234" }, context),
    /signature must be 65 bytes/,
  );
  assert.throws(
    () => buildSyntheticTxHash(request, Object.create({ quoteId: "q_hash_validation" })),
    /Execution context quoteId must be an own field/,
  );
  assert.throws(
    () => buildSyntheticTxHash(request, { quoteId: " " }),
    /Execution context quoteId must be a non-empty string/,
  );
  assert.throws(
    () => buildSyntheticTxHash(request, { quoteId: new String("q_hash_validation") }),
    /Execution context quoteId must be a primitive string/,
  );
  assert.throws(
    () => buildSyntheticTxHash(request, { quoteId: "q.bad" }),
    /Execution context quoteId must contain only letters, numbers, underscore, colon, or hyphen/,
  );
  assert.throws(
    () => buildSyntheticTxHash(request, { quoteId: "q".repeat(129) }),
    /Execution context quoteId must be 128 characters or fewer/,
  );
});

test("SkeletonExecutionService rejects unsafe dependency configuration at construction", () => {
  const deps = buildExecutionServiceDeps();

  assert.throws(
    () => new SkeletonExecutionService(undefined),
    /Execution service deps must be an object/,
  );
  assert.throws(
    () => new SkeletonExecutionService([]),
    /Execution service deps must be an object/,
  );
  assert.throws(
    () => new SkeletonExecutionService(Object.create(deps)),
    /Execution service deps.hedgeService must be an own field/,
  );
  assert.throws(
    () =>
      new SkeletonExecutionService({
        ...deps,
        hedgeService: [],
      }),
    /Execution service hedgeService must be an object/,
  );
  assert.throws(
    () =>
      new SkeletonExecutionService({
        ...deps,
        inventoryService: [],
      }),
    /Execution service inventoryService must be an object/,
  );
  assert.throws(
    () =>
      new SkeletonExecutionService({
        ...deps,
        settlementEventService: [],
      }),
    /Execution service settlementEventService must be an object/,
  );
  assert.throws(
    () =>
      new SkeletonExecutionService({
        ...deps,
        settlementVerifier: [],
      }),
    /Execution service settlementVerifier must be an object/,
  );
  assert.throws(
    () =>
      new SkeletonExecutionService({
        ...deps,
        hedgeService: {},
      }),
    /Execution service hedgeService.createHedgeIntent must be a function/,
  );
  assert.throws(
    () =>
      new SkeletonExecutionService({
        ...deps,
        inventoryService: {},
      }),
    /Execution service inventoryService.getPosition must be a function/,
  );
  assert.throws(
    () =>
      new SkeletonExecutionService({
        ...deps,
        settlementEventService: {},
      }),
    /Execution service settlementEventService.applySettlementEvent must be a function/,
  );
  assert.throws(
    () =>
      new SkeletonExecutionService({
        ...deps,
        settlementVerifier: {},
      }),
    /Execution service settlementVerifier.verify must be a function/,
  );
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
    executionService.submitQuote(request, Object.create({ quoteId: "q_inherited_context" })),
    /Execution context quoteId must be an own field/,
  );

  await assert.rejects(
    executionService.submitQuote(request, { quoteId: " " }),
    /Execution context quoteId must be a non-empty string/,
  );

  await assert.rejects(
    executionService.submitQuote(request, { quoteId: new String("q_submit") }),
    /Execution context quoteId must be a primitive string/,
  );

  await assert.rejects(
    executionService.submitQuote(request, { quoteId: "q.bad" }),
    /Execution context quoteId must contain only letters, numbers, underscore, colon, or hyphen/,
  );

  await assert.rejects(
    executionService.submitQuote(request, { quoteId: "q".repeat(129) }),
    /Execution context quoteId must be 128 characters or fewer/,
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

function buildExecutionServiceDeps() {
  const inventoryService = new InventoryService();
  return {
    hedgeService: new HedgeService(),
    inventoryService,
    settlementEventService: new SettlementEventService(inventoryService),
    settlementVerifier: new LocalSettlementVerifier(),
  };
}
