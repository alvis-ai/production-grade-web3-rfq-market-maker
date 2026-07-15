import assert from "node:assert/strict";
import test from "node:test";
import { closeGatewayResources } from "../dist/runtime/gateway-application.js";

test("gateway resource cleanup preserves dependency order", async () => {
  const order = [];

  await closeGatewayResources([
    async () => { order.push("market-tasks"); },
    async () => { order.push("rate-limiter"); },
    async () => { order.push("signer"); },
    async () => { order.push("postgres-pool"); },
  ]);

  assert.deepEqual(order, ["market-tasks", "rate-limiter", "signer", "postgres-pool"]);
});

test("gateway resource cleanup releases later resources after an earlier failure", async () => {
  const order = [];

  await assert.rejects(
    closeGatewayResources([
      async () => { order.push("market-tasks"); throw new Error("market cleanup failed"); },
      async () => { order.push("rate-limiter"); throw new Error("rate limiter cleanup failed"); },
      async () => { order.push("postgres-pool"); },
    ]),
    /market cleanup failed/,
  );

  assert.deepEqual(order, ["market-tasks", "rate-limiter", "postgres-pool"]);
});
