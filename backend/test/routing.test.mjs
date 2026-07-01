import assert from "node:assert/strict";
import test from "node:test";
import { InternalInventoryRoutingEngine } from "../dist/modules/routing/routing.engine.js";

const request = {
  chainId: 8453,
  user: "0x0000000000000000000000000000000000000001",
  tokenIn: "0xA000000000000000000000000000000000000002",
  tokenOut: "0xB000000000000000000000000000000000000003",
  amountIn: "1000000000",
  slippageBps: 50,
};

const snapshot = {
  snapshotId: "snapshot_base_usdc_weth",
  midPrice: "1.25",
  liquidityUsd: "250000000000",
  volatilityBps: 25,
  observedAt: "2026-06-29T00:00:00.000Z",
};

test("InternalInventoryRoutingEngine creates deterministic internal inventory route plans", async () => {
  const route = await new InternalInventoryRoutingEngine().selectRoute({
    request,
    snapshot,
  });

  assert.deepEqual(route, {
    routeId: "route_8453_a0000000_b0000000",
    venue: "internal_inventory",
    tokenIn: request.tokenIn,
    tokenOut: request.tokenOut,
    expectedLiquidityUsd: snapshot.liquidityUsd,
  });
});

test("InternalInventoryRoutingEngine rejects malformed route payload envelopes before planning", async () => {
  const engine = new InternalInventoryRoutingEngine();

  await assert.rejects(
    engine.selectRoute(undefined),
    /Routing input must be an object/,
  );

  await assert.rejects(
    engine.selectRoute({
      snapshot,
    }),
    /Routing request must be an object/,
  );

  await assert.rejects(
    engine.selectRoute({
      request,
      snapshot: null,
    }),
    /Routing snapshot must be an object/,
  );
});

test("InternalInventoryRoutingEngine rejects unsafe route inputs before planning", async () => {
  const engine = new InternalInventoryRoutingEngine();

  await assert.rejects(
    engine.selectRoute({
      request: {
        ...request,
        chainId: 0,
      },
      snapshot,
    }),
    /Routing request.chainId must be a positive safe integer/,
  );

  await assert.rejects(
    engine.selectRoute({
      request: {
        ...request,
        tokenOut: request.tokenIn,
      },
      snapshot,
    }),
    /Routing request token pair must contain distinct tokens/,
  );

  await assert.rejects(
    engine.selectRoute({
      request: {
        ...request,
        amountIn: "0",
      },
      snapshot,
    }),
    /Routing request.amountIn must be a positive uint string/,
  );

  await assert.rejects(
    engine.selectRoute({
      request,
      snapshot: {
        ...snapshot,
        snapshotId: " ",
      },
    }),
    /Routing snapshot.snapshotId must be a non-empty string/,
  );

  await assert.rejects(
    engine.selectRoute({
      request,
      snapshot: {
        ...snapshot,
        liquidityUsd: "0",
      },
    }),
    /Routing snapshot.liquidityUsd must be a positive uint string/,
  );

  const route = await engine.selectRoute({ request, snapshot });
  assert.equal(route.routeId, "route_8453_a0000000_b0000000");
});
