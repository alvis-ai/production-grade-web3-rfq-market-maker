import assert from "node:assert/strict";
import { createRedisQuoteExposureClient } from "../backend/dist/modules/risk/redis-quote-exposure.store.js";

const confirmation = "initialize-empty-quote-exposure-ledger";
if (process.env.RFQ_QUOTE_EXPOSURE_BOOTSTRAP_CONFIRM !== confirmation) {
  throw new Error(`RFQ_QUOTE_EXPOSURE_BOOTSTRAP_CONFIRM=${confirmation} is required`);
}

const redisUrl = required("RFQ_QUOTE_EXPOSURE_REDIS_URL");
const keyPrefix = process.env.RFQ_QUOTE_EXPOSURE_KEY_PREFIX ?? "rfq:{quote-state}:exposure";
const ledgerEpoch = required("RFQ_QUOTE_EXPOSURE_LEDGER_EPOCH");
if (!/^rfq:\{[a-z0-9_-]{1,32}\}:[a-z0-9:_-]{1,48}$/.test(keyPrefix)) {
  throw new Error("RFQ_QUOTE_EXPOSURE_KEY_PREFIX must use a bounded rfq:{hash-tag}: key");
}
if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(ledgerEpoch)) {
  throw new Error("RFQ_QUOTE_EXPOSURE_LEDGER_EPOCH must be a safe identifier");
}

const client = createRedisQuoteExposureClient(redisUrl, {
  requireTls: process.env.NODE_ENV === "production",
});
const bootstrapScript = `
local existing = redis.call("KEYS", ARGV[1] .. ":*")
if #existing > 0 then return {0, #existing} end
local created = redis.call("SET", KEYS[1], ARGV[2], "NX")
if not created then return {0, 1} end
return {1, ARGV[2]}
`;

try {
  await client.connect?.();
  assert.equal(await client.ping(), "PONG", "Redis ping must succeed before bootstrap");
  assertHealthyAof(await client.info("persistence"));
  const result = await client.eval(
    bootstrapScript,
    1,
    `${keyPrefix}:epoch`,
    keyPrefix,
    ledgerEpoch,
  );
  if (!Array.isArray(result) || result.length !== 2) {
    throw new Error("Quote exposure ledger bootstrap returned malformed state");
  }
  if (result[0] !== 1 || result[1] !== ledgerEpoch) {
    const keyCount = Number.isSafeInteger(result[1]) ? result[1] : "unknown";
    throw new Error(`Quote exposure ledger prefix is not empty (${keyCount} existing keys)`);
  }
  process.stdout.write(`${JSON.stringify({
    status: "initialized",
    keyPrefix,
    ledgerEpoch,
    aof: "healthy",
  }, null, 2)}\n`);
} finally {
  try { await client.quit(); } catch { client.disconnect?.(); }
}

function required(name) {
  const value = process.env[name];
  if (!value || value.trim().length === 0) throw new Error(`${name} is required`);
  return value.trim();
}

function assertHealthyAof(value) {
  if (typeof value !== "string" || !/(?:^|\r?\n)aof_enabled:1(?:\r?\n|$)/.test(value) ||
      !/(?:^|\r?\n)aof_last_write_status:ok(?:\r?\n|$)/.test(value)) {
    throw new Error("Quote exposure ledger bootstrap requires healthy AOF persistence");
  }
}
