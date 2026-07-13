import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  Sha256ApiKeyAuthenticator,
  assertApiKeyAuthConfig,
  assertApiKeyAuthResult,
  parseApiKeyAuthConfig,
} from "../dist/modules/auth/api-key-auth.service.js";

const secret = "0123456789abcdefghijklmnopqrstuvwxyz_ABCD";
const expiresAt = "2099-01-01T00:00:00.000Z";

test("SHA-256 API key authenticator accepts configured keys and returns defensive principals", () => {
  const config = validConfig();
  const authenticator = new Sha256ApiKeyAuthenticator(config, () => Date.parse("2026-01-01T00:00:00.000Z"));

  config.keys[0].scopes[0] = "pnl:read";
  const first = authenticator.authenticate(`client_primary.${secret}`);
  assert.deepEqual(first, {
    status: "authenticated",
    principal: {
      keyId: "client_primary",
      principalId: "institution_a",
      scopes: ["quote:write", "submit:write", "status:read"],
    },
  });

  first.principal.scopes[0] = "pnl:read";
  assert.deepEqual(authenticator.authenticate(`client_primary.${secret}`).principal.scopes, [
    "quote:write",
    "submit:write",
    "status:read",
  ]);
});

test("SHA-256 API key authenticator rejects missing, malformed, invalid, and expired credentials", () => {
  const active = new Sha256ApiKeyAuthenticator(validConfig(), () => Date.parse("2026-01-01T00:00:00.000Z"));
  assert.deepEqual(active.authenticate(undefined), { status: "rejected", reason: "missing" });
  assert.deepEqual(active.authenticate([`client_primary.${secret}`]), { status: "rejected", reason: "malformed" });
  assert.deepEqual(active.authenticate("client_primary.short"), { status: "rejected", reason: "malformed" });
  assert.deepEqual(active.authenticate(`unknown_key.${secret}`), { status: "rejected", reason: "invalid" });
  assert.deepEqual(
    active.authenticate("client_primary.XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"),
    { status: "rejected", reason: "invalid" },
  );

  const expired = new Sha256ApiKeyAuthenticator(validConfig(), () => Date.parse(expiresAt));
  assert.deepEqual(expired.authenticate(`client_primary.${secret}`), { status: "rejected", reason: "expired" });
});

test("API key auth config parser validates closed records, hashes, scopes, expiry, and duplicates", () => {
  const serialized = JSON.stringify(validConfig());
  const parsed = parseApiKeyAuthConfig(serialized);
  assert.deepEqual(parsed, validConfig());
  parsed.keys[0].scopes[0] = "pnl:read";
  assert.deepEqual(parseApiKeyAuthConfig(serialized), validConfig());

  for (const [value, message] of [
    ["", /non-empty JSON object/],
    ["{", /valid JSON/],
    [JSON.stringify({ keys: [] }), /between 1 and 1000/],
    [JSON.stringify({ ...validConfig(), unknown: true }), /fields are invalid/],
    [JSON.stringify({ keys: [{ ...validConfig().keys[0], keyId: "x" }] }), /keyId/],
    [JSON.stringify({ keys: [{ ...validConfig().keys[0], secretSha256: "AA".repeat(32) }] }), /lowercase/],
    [JSON.stringify({ keys: [{ ...validConfig().keys[0], scopes: ["quote:write", "quote:write"] }] }), /duplicate scopes/],
    [JSON.stringify({ keys: [{ ...validConfig().keys[0], scopes: ["admin"] }] }), /unsupported scope/],
    [JSON.stringify({ keys: [{ ...validConfig().keys[0], expiresAt: "2099-01-01" }] }), /canonical UTC/],
    [JSON.stringify({ keys: [validConfig().keys[0], validConfig().keys[0]] }), /duplicate keyId/],
  ]) {
    assert.throws(() => parseApiKeyAuthConfig(value), message);
  }

  assert.throws(
    () => assertApiKeyAuthConfig(Object.create({ keys: validConfig().keys })),
    /keys must be an own field/,
  );
});

test("API key auth dependency results are closed and strongly validated", () => {
  assert.doesNotThrow(() => assertApiKeyAuthResult({
    status: "authenticated",
    principal: {
      keyId: "client_primary",
      principalId: "institution_a",
      scopes: ["quote:write"],
    },
  }));
  assert.doesNotThrow(() => assertApiKeyAuthResult({ status: "rejected", reason: "invalid" }));

  for (const result of [
    null,
    { status: "authenticated", principal: { keyId: "x", principalId: "institution_a", scopes: ["quote:write"] } },
    { status: "authenticated", principal: { keyId: "client_primary", principalId: "institution_a", scopes: [] } },
    { status: "rejected", reason: "blocked" },
    { status: "rejected", reason: "invalid", extra: true },
  ]) {
    assert.throws(() => assertApiKeyAuthResult(result));
  }
});

test("API key authenticator fails closed on an invalid clock", () => {
  const authenticator = new Sha256ApiKeyAuthenticator(validConfig(), () => Number.NaN);
  assert.throws(
    () => authenticator.authenticate(`client_primary.${secret}`),
    /clock must return a non-negative finite timestamp/,
  );
});

function validConfig() {
  return {
    keys: [{
      keyId: "client_primary",
      principalId: "institution_a",
      secretSha256: createHash("sha256").update(secret).digest("hex"),
      scopes: ["quote:write", "submit:write", "status:read"],
      expiresAt,
    }],
  };
}
