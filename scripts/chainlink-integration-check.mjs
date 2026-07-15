#!/usr/bin/env node

import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import {
  ChainlinkMarketDataService,
} from "../backend/dist/modules/market-data/chainlink-market-data.service.js";
import {
  parseChainlinkMarketDataConfig,
} from "../backend/dist/modules/market-data/chainlink-config.js";
import {
  getMarketDataSnapshotSource,
} from "../backend/dist/modules/market-data/market-data.service.js";

const confirmation = "read-live-oracle";
const probeUser = "0x0000000000000000000000000000000000000001";

export async function runChainlinkIntegrationCheck(env = process.env, dependencies = {}) {
  assertObject(env, "Chainlink integration environment");
  assertObject(dependencies, "Chainlink integration dependencies");
  if (readOwn(env, "RFQ_CHAINLINK_INTEGRATION_CONFIRM") !== confirmation) {
    throw new Error(
      `RFQ_CHAINLINK_INTEGRATION_CONFIRM=${confirmation} is required because this check contacts the target oracle RPC`,
    );
  }

  const config = parseChainlinkMarketDataConfig(readRequired(env, "RFQ_CHAINLINK_CONFIG_JSON"));
  const chainId = readInteger(env, "RFQ_CHAINLINK_INTEGRATION_CHAIN_ID", 1, Number.MAX_SAFE_INTEGER);
  const tokenIn = readAddress(env, "RFQ_CHAINLINK_INTEGRATION_TOKEN_IN");
  const tokenOut = readAddress(env, "RFQ_CHAINLINK_INTEGRATION_TOKEN_OUT");
  assert.notEqual(tokenIn, tokenOut, "Chainlink integration token pair must contain distinct addresses");
  const selected = selectFeed(config, chainId, tokenIn, tokenOut);

  const now = dependencies.now ?? (() => Date.now());
  const readerFactory = dependencies.readerFactory;
  assert.equal(typeof now, "function", "Chainlink integration clock must be a function");
  if (readerFactory !== undefined && typeof readerFactory !== "function") {
    throw new Error("Chainlink integration readerFactory must be a function when provided");
  }

  const selectedConfig = {
    networks: [{ ...selected.network, feeds: [{ ...selected.feed }] }],
    referenceLiquidityUsd: config.referenceLiquidityUsd,
    referenceVolatilityBps: config.referenceVolatilityBps,
    maxPriceAgeMs: config.maxPriceAgeMs,
  };
  const request = {
    chainId,
    user: probeUser,
    tokenIn,
    tokenOut,
    amountIn: "1",
    slippageBps: 0,
  };

  try {
    const startedAtMs = readCurrentTime(now);
    const service = new ChainlinkMarketDataService(selectedConfig, readerFactory, now);
    const direct = await service.getSnapshot(request);
    const reverse = await service.getSnapshot({ ...request, tokenIn: tokenOut, tokenOut: tokenIn });
    const completedAtMs = readCurrentTime(now);

    const directEvidence = assertSnapshot(direct, chainId, completedAtMs, config.maxPriceAgeMs, "direct");
    const reverseEvidence = assertSnapshot(reverse, chainId, completedAtMs, config.maxPriceAgeMs, "reverse");
    assert.notEqual(direct.snapshotId, reverse.snapshotId, "Chainlink direct and reverse snapshot IDs must differ");
    assert.equal(
      completedAtMs >= startedAtMs,
      true,
      "Chainlink integration clock must not move backwards during the check",
    );

    return {
      status: "ok",
      mode: "target-chainlink-read",
      chainId,
      networkType: selected.network.networkType,
      tokenIn,
      tokenOut,
      aggregator: selected.feed.aggregator.toLowerCase(),
      description: selected.feed.description,
      direct: directEvidence,
      reverse: reverseEvidence,
      sequencerChecked: selected.network.networkType === "l2",
    };
  } catch {
    throw new Error("Target Chainlink integration check failed");
  }
}

function selectFeed(config, chainId, tokenIn, tokenOut) {
  const network = config.networks.find((candidate) => candidate.chainId === chainId);
  if (!network) throw new Error("RFQ_CHAINLINK_CONFIG_JSON does not contain the selected chain");
  const feed = network.feeds.find((candidate) =>
    (sameAddress(candidate.tokenIn, tokenIn) && sameAddress(candidate.tokenOut, tokenOut)) ||
    (sameAddress(candidate.tokenIn, tokenOut) && sameAddress(candidate.tokenOut, tokenIn))
  );
  if (!feed) throw new Error("RFQ_CHAINLINK_CONFIG_JSON does not contain the selected token pair");
  return { network, feed };
}

function assertSnapshot(snapshot, chainId, nowMs, maxPriceAgeMs, direction) {
  assertObject(snapshot, `Chainlink ${direction} snapshot`);
  assert.equal(
    getMarketDataSnapshotSource(snapshot),
    "chainlink-aggregator-v3",
    `Chainlink ${direction} snapshot source`,
  );
  if (typeof snapshot.snapshotId !== "string" ||
      !new RegExp(`^snapshot_${chainId}_chainlink_[0-9a-f]{64}$`).test(snapshot.snapshotId)) {
    throw new Error(`Chainlink ${direction} snapshot ID is invalid`);
  }
  assertPositiveDecimal(snapshot.midPrice, `Chainlink ${direction} midPrice`);
  const observedAtMs = parseCanonicalTimestamp(snapshot.observedAt, `Chainlink ${direction} observedAt`);
  const ageMs = nowMs - observedAtMs;
  assert.equal(ageMs >= -1_000, true, `Chainlink ${direction} observation is from the future`);
  assert.equal(ageMs <= maxPriceAgeMs, true, `Chainlink ${direction} observation is stale`);
  return {
    snapshotId: snapshot.snapshotId,
    midPrice: snapshot.midPrice,
    observedAt: snapshot.observedAt,
    ageMs,
  };
}

function assertPositiveDecimal(value, label) {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)(\.[0-9]*[1-9])?$/.test(value)) {
    throw new Error(`${label} must be a canonical positive decimal string`);
  }
  const normalized = value.replace(".", "");
  if (/^0+$/.test(normalized)) throw new Error(`${label} must be positive`);
}

function parseCanonicalTimestamp(value, label) {
  if (typeof value !== "string") throw new Error(`${label} must be a canonical timestamp`);
  const parsed = Date.parse(value);
  if (!Number.isSafeInteger(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error(`${label} must be a canonical timestamp`);
  }
  return parsed;
}

function assertObject(value, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function readOwn(env, field) {
  if (!Object.prototype.hasOwnProperty.call(env, field)) return undefined;
  const value = env[field];
  if (value !== undefined && typeof value !== "string") throw new Error(`${field} must be a primitive string`);
  return value;
}

function readRequired(env, field) {
  const value = readOwn(env, field);
  if (value === undefined || value.length === 0 || value.trim() !== value || value.startsWith("replace-with-")) {
    throw new Error(`${field} must be explicitly configured without surrounding whitespace`);
  }
  return value;
}

function readInteger(env, field, min, max) {
  const value = readRequired(env, field);
  if (!/^[1-9][0-9]*$/.test(value)) throw new Error(`${field} must be an integer between ${min} and ${max}`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${field} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

function readAddress(env, field) {
  const value = readRequired(env, field);
  if (!/^0x[0-9a-fA-F]{40}$/.test(value) || /^0x0{40}$/i.test(value)) {
    throw new Error(`${field} must be a non-zero 20-byte hex address`);
  }
  return value.toLowerCase();
}

function readCurrentTime(now) {
  const value = now();
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("Chainlink integration clock must return a positive safe integer");
  }
  return value;
}

function sameAddress(left, right) {
  return left.toLowerCase() === right.toLowerCase();
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : undefined;
if (invokedPath === import.meta.url) {
  const result = await runChainlinkIntegrationCheck();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
