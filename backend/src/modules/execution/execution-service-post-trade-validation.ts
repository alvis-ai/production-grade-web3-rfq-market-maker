import type { InventoryPosition } from "../inventory/inventory.service.js";

export { assertHedgeResult } from "./execution-service-hedge-result-validation.js";

const inventoryPositionFields = ["chainId", "token", "balance"] as const;

export function assertInventoryPositionResult(
  position: unknown,
  expectedChainId: number,
  expectedToken: string,
  field: "tokenIn" | "tokenOut",
): asserts position is InventoryPosition {
  if (typeof position !== "object" || position === null || Array.isArray(position)) {
    throw new Error(`Execution service inventory position.${field} must be an object`);
  }

  assertExactInventoryPositionFields(position as Record<string, unknown>, `inventory position.${field}`);
  const inventoryPosition = position as Record<string, unknown>;
  if (
    typeof inventoryPosition.chainId !== "number" ||
    !Number.isSafeInteger(inventoryPosition.chainId) ||
    inventoryPosition.chainId <= 0 ||
    inventoryPosition.chainId !== expectedChainId
  ) {
    throw new Error(`Execution service inventory position.${field}.chainId must match submitted quote`);
  }
  assertExecutionAddress(inventoryPosition.token, "token", `inventory position.${field}`);
  if (inventoryPosition.token.toLowerCase() !== expectedToken.toLowerCase()) {
    throw new Error(`Execution service inventory position.${field}.token must match submitted quote`);
  }
  if (typeof inventoryPosition.balance !== "bigint") {
    throw new Error(`Execution service inventory position.${field}.balance must be a bigint`);
  }
}

function assertExactInventoryPositionFields(value: Record<string, unknown>, path: string): void {
  const expected = new Set<string>(inventoryPositionFields);
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) {
      throw new Error(`Execution service ${path} must not include unknown field ${key}`);
    }
  }
  for (const field of inventoryPositionFields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      throw new Error(`Execution service ${path}.${field} must be an own field`);
    }
  }
}

function assertExecutionAddress(value: unknown, field: "token", path: string): asserts value is `0x${string}` {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`Execution service ${path} ${field} must be a 20-byte hex address`);
  }
}
