import { RedisLuaScript } from "../../shared/redis/redis-lua-script.js";
import type { RedisQuoteExposureCommitExtension } from "../risk/redis-quote-exposure.store.js";
import { RedisQuoteExposureStore } from "../risk/redis-quote-exposure.store.js";
import type { AdmitQuoteInput, QuoteAdmissionResult, QuoteAdmissionStore } from "./quote-admission.store.js";
import { admitQuoteAtomicallyScript } from "./redis-quote-admission.scripts.js";
import {
  RedisQuoteIssuanceStore,
  type PreparedRedisQuoteIssuanceAdmission,
} from "./redis-quote-issuance.store.js";

const admitQuoteAtomicallyCommand = new RedisLuaScript(admitQuoteAtomicallyScript);

export class RedisQuoteAdmissionStore implements QuoteAdmissionStore {
  constructor(
    private readonly exposureStore: RedisQuoteExposureStore,
    private readonly issuanceStore: RedisQuoteIssuanceStore,
  ) {
    const exposure = exposureStore.atomicAdmissionConfig();
    const issuance = issuanceStore.atomicAdmissionConfig();
    if (hashTag(exposure.keyPrefix) !== hashTag(issuance.keyPrefix)) {
      throw new Error("Atomic quote admission keys must use one Redis Cluster hash tag");
    }
    if (exposure.minReplicaAcks !== issuance.minReplicaAcks ||
        exposure.replicaAckTimeoutMs !== issuance.replicaAckTimeoutMs ||
        exposure.requireAof !== issuance.requireAof) {
      throw new Error("Atomic quote admission Redis durability policies must match");
    }
  }

  async admit(input: AdmitQuoteInput, beforeCommit?: () => void): Promise<QuoteAdmissionResult> {
    const issuance = await this.issuanceStore.prepareAtomicAdmission(input.issuance);
    let commitStarted = false;
    const result = await this.exposureStore.reserveWithCommit(
      input.exposure,
      this.commitExtension(issuance, beforeCommit ? () => {
        if (commitStarted) return;
        commitStarted = true;
        beforeCommit();
      } : undefined),
    );
    if (result.exposure.status === "rejected") return { exposure: result.exposure };
    if (!("extension" in result)) {
      throw new Error("Atomic quote admission returned no issuance result");
    }
    const riskDecision = await this.issuanceStore.acceptAtomicAdmission(
      issuance,
      result.extension,
      false,
    );
    return { exposure: result.exposure, riskDecision };
  }

  private commitExtension(
    issuance: PreparedRedisQuoteIssuanceAdmission,
    beforeExecute?: () => void,
  ): RedisQuoteExposureCommitExtension<unknown> {
    return {
      command: admitQuoteAtomicallyCommand,
      keys: issuance.keys,
      arguments: issuance.arguments,
      parseResult: parseAtomicAdmissionResult,
      ...(beforeExecute ? { beforeExecute } : {}),
    };
  }
}

function parseAtomicAdmissionResult(result: unknown):
  | { exposureResult: unknown }
  | { exposureResult: unknown; extension: unknown } {
  if (!Array.isArray(result) || result.length !== 2 || !Array.isArray(result[0]) || !Array.isArray(result[1])) {
    throw new Error("Atomic quote admission returned malformed state");
  }
  if (result[1].length === 0) return { exposureResult: result[0] };
  if (result[1].length !== 4 || !Number.isSafeInteger(result[1][0]) ||
      typeof result[1][1] !== "string") {
    throw new Error("Atomic quote admission returned malformed issuance state");
  }
  if (result[1][0] !== 1 && result[1][0] !== 2) {
    throw new Error(`Redis quote issuance admission failed: ${result[1][1]}`);
  }
  return { exposureResult: result[0], extension: result[1] };
}

function hashTag(value: string): string {
  const start = value.indexOf("{");
  const end = value.indexOf("}", start + 1);
  if (start < 0 || end <= start + 1) {
    throw new Error("Atomic quote admission key prefix must contain a Redis Cluster hash tag");
  }
  return value.slice(start + 1, end);
}
