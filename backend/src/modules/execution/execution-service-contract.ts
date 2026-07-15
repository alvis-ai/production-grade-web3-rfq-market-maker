import { APIError } from "../../shared/errors/api-error.js";
import type {
  SubmitQuoteRequest,
  SubmitQuoteResponse,
} from "../../shared/types/rfq.js";
import type { HedgeIntentPlanner } from "../hedge/hedge-intent-planner.js";
import type {
  HedgeFailureReasonCode,
  HedgeIntentService,
  HedgeResult,
} from "../hedge/hedge.service.js";
import type { InventoryPosition, IInventoryService } from "../inventory/inventory.service.js";
import type {
  ApplySettlementEventResult,
  SettlementEventStore,
} from "../settlement/settlement-event.service.js";
import type {
  SettlementVerificationResult,
  SettlementVerifier,
} from "../settlement/settlement-verifier.service.js";

const maxSafeIdentifierLength = 128;
const safeIdentifierPattern = /^[A-Za-z0-9_:-]+$/;
const executionServiceDepsFields = [
  "hedgeService",
  "inventoryService",
  "settlementEventService",
  "settlementVerifier",
] as const;

export interface ExecutionService {
  submitQuote(request: SubmitQuoteRequest, context: ExecutionContext): Promise<ExecutionResult>;
}

export interface ExecutionServiceDeps {
  hedgeService: HedgeIntentService;
  inventoryService: IInventoryService;
  settlementEventService: SettlementEventStore;
  settlementVerifier: SettlementVerifier;
}

export interface ExecutionContext {
  quoteId: string;
}

export interface SettlementEvidence {
  txHash: `0x${string}`;
  blockNumber: number;
  logIndex: number;
  settledAt: string;
}

export interface SettlementEvidenceProvider {
  resolve(request: SubmitQuoteRequest, context: ExecutionContext): Promise<SettlementEvidence>;
}

export interface ExecutionResult {
  response: SubmitQuoteResponse;
  settlementEventResult: ApplySettlementEventResult;
  inventoryPositions?: {
    tokenIn: InventoryPosition;
    tokenOut: InventoryPosition;
  };
  settlementVerification: SettlementVerificationResult;
  hedgeResult?: HedgeResult;
  hedgeFailure?: HedgeFailure;
  hedgeLagSeconds?: number;
}

export interface HedgeFailure {
  reasonCode: HedgeFailureReasonCode;
}

export function normalizeExecutionServiceDeps(value: unknown): ExecutionServiceDeps {
  assertExecutionServiceDeps(value);
  return { ...value };
}

export function normalizeSettlementEvidenceProvider(value: unknown): SettlementEvidenceProvider {
  assertRecord(value, "evidenceProvider");
  const resolve = (value as Record<string, unknown>).resolve;
  if (typeof resolve !== "function") {
    throw new Error("Execution service evidenceProvider.resolve must be a function");
  }
  return { resolve: resolve.bind(value) as SettlementEvidenceProvider["resolve"] };
}

export function normalizeHedgeIntentPlanner(value: unknown): HedgeIntentPlanner {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    typeof (value as Record<string, unknown>).plan !== "function"
  ) {
    throw new Error("Execution service hedgePlanner.plan must be a function");
  }
  const plan = (value as Record<string, unknown>).plan as HedgeIntentPlanner["plan"];
  return { plan: plan.bind(value) as HedgeIntentPlanner["plan"] };
}

export function assertExecutionContext(context: unknown): asserts context is ExecutionContext {
  if (typeof context !== "object" || context === null || Array.isArray(context)) {
    throw new APIError("INVALID_REQUEST", "Execution context must be an object", 400);
  }
  if (!Object.prototype.hasOwnProperty.call(context, "quoteId")) {
    throw new APIError("INVALID_REQUEST", "Execution context quoteId must be an own field", 400);
  }

  const quoteId = (context as Record<string, unknown>).quoteId;
  if (typeof quoteId !== "string") {
    throw new APIError("INVALID_REQUEST", "Execution context quoteId must be a primitive string", 400);
  }
  if (quoteId.trim().length === 0) {
    throw new APIError("INVALID_REQUEST", "Execution context quoteId must be a non-empty string", 400);
  }
  if (quoteId.length > maxSafeIdentifierLength) {
    throw new APIError("INVALID_REQUEST", "Execution context quoteId must be 128 characters or fewer", 400);
  }
  if (!safeIdentifierPattern.test(quoteId)) {
    throw new APIError(
      "INVALID_REQUEST",
      "Execution context quoteId must contain only letters, numbers, underscore, colon, or hyphen",
      400,
    );
  }
}

function assertExecutionServiceDeps(value: unknown): asserts value is ExecutionServiceDeps {
  assertRecord(value, "deps");
  assertOwnFields(value, executionServiceDepsFields, "deps");
  const deps = value as unknown as ExecutionServiceDeps;
  assertDependencyMethod(deps.hedgeService, "hedgeService", "createHedgeIntent");
  assertDependencyMethod(deps.inventoryService, "inventoryService", "getPosition");
  assertDependencyMethod(deps.settlementEventService, "settlementEventService", "applySettlementEvent");
  assertDependencyMethod(deps.settlementVerifier, "settlementVerifier", "verify");
}

function assertDependencyMethod(
  dependency: unknown,
  dependencyName: keyof ExecutionServiceDeps,
  methodName: string,
): void {
  assertRecord(dependency, dependencyName);
  const method = (dependency as Record<string, unknown>)[methodName];
  if (typeof method !== "function") {
    throw new Error(`Execution service ${dependencyName}.${methodName} must be a function`);
  }
}

function assertRecord(value: unknown, field: string): asserts value is object {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Execution service ${field} must be an object`);
  }
}

function assertOwnFields(value: object, fields: readonly string[], path: string): void {
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      throw new Error(`Execution service ${path}.${field} must be an own field`);
    }
  }
}
