import { createHash, timingSafeEqual } from "node:crypto";
import { isCanonicalUtcIsoTimestamp } from "../../shared/validation/timestamp.js";
import { assertPrincipalId } from "../../shared/validation/principal-id.js";

export const apiKeyScopes = ["quote:write", "submit:write", "status:read", "pnl:read"] as const;

export type ApiKeyScope = (typeof apiKeyScopes)[number];
export type ApiKeyRejectionReason = "missing" | "malformed" | "invalid" | "expired";

export interface ApiKeyRecord {
  keyId: string;
  principalId: string;
  secretSha256: string;
  scopes: ApiKeyScope[];
  expiresAt?: string;
}

export interface ApiKeyAuthConfig {
  keys: ApiKeyRecord[];
}

export interface ApiKeyPrincipal {
  keyId: string;
  principalId: string;
  scopes: ApiKeyScope[];
}

export type ApiKeyAuthResult =
  | { status: "authenticated"; principal: ApiKeyPrincipal }
  | { status: "rejected"; reason: ApiKeyRejectionReason };

export interface ApiKeyAuthenticator {
  authenticate(value: unknown): ApiKeyAuthResult;
}

const configFields = ["keys"] as const;
const keyRequiredFields = ["keyId", "principalId", "secretSha256", "scopes"] as const;
const keyOptionalFields = ["expiresAt"] as const;
const principalFields = ["keyId", "principalId", "scopes"] as const;
const resultAuthenticatedFields = ["status", "principal"] as const;
const resultRejectedFields = ["status", "reason"] as const;
const keyIdPattern = /^[A-Za-z0-9_-]{3,64}$/;
const keySecretPattern = /^[A-Za-z0-9_-]{32,128}$/;
const sha256Pattern = /^[0-9a-f]{64}$/;
const maxKeys = 1_000;
const dummyDigest = createHash("sha256").update("rfq-api-key-dummy-secret").digest();

interface StoredApiKey {
  principal: ApiKeyPrincipal;
  secretDigest: Buffer;
  expiresAtMs?: number;
}

export class Sha256ApiKeyAuthenticator implements ApiKeyAuthenticator {
  private readonly keysById: ReadonlyMap<string, StoredApiKey>;

  constructor(config: ApiKeyAuthConfig, private readonly now: () => number = Date.now) {
    assertApiKeyAuthConfig(config);
    if (typeof now !== "function") throw new Error("API key authenticator now dependency must be a function");
    this.keysById = new Map(config.keys.map((record) => [record.keyId, {
      principal: {
        keyId: record.keyId,
        principalId: record.principalId,
        scopes: [...record.scopes],
      },
      secretDigest: Buffer.from(record.secretSha256, "hex"),
      ...(record.expiresAt === undefined ? {} : { expiresAtMs: Date.parse(record.expiresAt) }),
    }]));
  }

  authenticate(value: unknown): ApiKeyAuthResult {
    if (value === undefined) return { status: "rejected", reason: "missing" };
    if (typeof value !== "string") return { status: "rejected", reason: "malformed" };

    const separator = value.indexOf(".");
    if (separator <= 0 || separator !== value.lastIndexOf(".")) {
      return { status: "rejected", reason: "malformed" };
    }
    const keyId = value.slice(0, separator);
    const secret = value.slice(separator + 1);
    if (!keyIdPattern.test(keyId) || !keySecretPattern.test(secret)) {
      return { status: "rejected", reason: "malformed" };
    }

    const stored = this.keysById.get(keyId);
    const presentedDigest = createHash("sha256").update(secret).digest();
    const matches = timingSafeEqual(presentedDigest, stored?.secretDigest ?? dummyDigest);
    if (!stored || !matches) return { status: "rejected", reason: "invalid" };
    const nowMs = this.now();
    if (typeof nowMs !== "number" || !Number.isFinite(nowMs) || nowMs < 0) {
      throw new Error("API key authenticator clock must return a non-negative finite timestamp");
    }
    if (stored.expiresAtMs !== undefined && nowMs >= stored.expiresAtMs) {
      return { status: "rejected", reason: "expired" };
    }

    return {
      status: "authenticated",
      principal: {
        ...stored.principal,
        scopes: [...stored.principal.scopes],
      },
    };
  }
}

export function parseApiKeyAuthConfig(value: string): ApiKeyAuthConfig {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("RFQ_API_KEY_CONFIG_JSON must be a non-empty JSON object");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("RFQ_API_KEY_CONFIG_JSON must contain valid JSON");
  }
  assertApiKeyAuthConfig(parsed);
  return cloneApiKeyAuthConfig(parsed);
}

export function assertApiKeyAuthConfig(value: unknown): asserts value is ApiKeyAuthConfig {
  assertRecord(value, "API key auth config");
  assertExactFields(value, configFields, [], "API key auth config");
  if (!Array.isArray(value.keys) || value.keys.length === 0 || value.keys.length > maxKeys) {
    throw new Error(`API key auth config.keys must contain between 1 and ${maxKeys} entries`);
  }

  const seenKeyIds = new Set<string>();
  for (const entry of value.keys) {
    assertRecord(entry, "API key auth config key");
    assertExactFields(entry, keyRequiredFields, keyOptionalFields, "API key auth config key");
    if (typeof entry.keyId !== "string" || !keyIdPattern.test(entry.keyId)) {
      throw new Error("API key auth config key.keyId must match [A-Za-z0-9_-]{3,64}");
    }
    if (seenKeyIds.has(entry.keyId)) throw new Error("API key auth config must not contain duplicate keyId values");
    seenKeyIds.add(entry.keyId);
    assertPrincipalId(entry.principalId, "API key auth config key.principalId");
    if (typeof entry.secretSha256 !== "string" || !sha256Pattern.test(entry.secretSha256)) {
      throw new Error("API key auth config key.secretSha256 must be a lowercase 32-byte SHA-256 hex digest");
    }
    assertScopes(entry.scopes, "API key auth config key.scopes");
    if (entry.expiresAt !== undefined &&
        (typeof entry.expiresAt !== "string" || !isCanonicalUtcIsoTimestamp(entry.expiresAt))) {
      throw new Error("API key auth config key.expiresAt must be a canonical UTC timestamp");
    }
  }
}

export function assertApiKeyAuthResult(value: unknown): asserts value is ApiKeyAuthResult {
  assertRecord(value, "API key auth result");
  if (value.status === "authenticated") {
    assertExactFields(value, resultAuthenticatedFields, [], "API key auth result");
    assertRecord(value.principal, "API key auth principal");
    assertExactFields(value.principal, principalFields, [], "API key auth principal");
    if (typeof value.principal.keyId !== "string" || !keyIdPattern.test(value.principal.keyId)) {
      throw new Error("API key auth principal.keyId is invalid");
    }
    assertPrincipalId(value.principal.principalId, "API key auth principal.principalId");
    assertScopes(value.principal.scopes, "API key auth principal.scopes");
    return;
  }
  if (value.status === "rejected") {
    assertExactFields(value, resultRejectedFields, [], "API key auth result");
    if (!apiKeyRejectionReasons.includes(value.reason as ApiKeyRejectionReason)) {
      throw new Error("API key auth result.reason is invalid");
    }
    return;
  }
  throw new Error("API key auth result.status is invalid");
}

export function cloneApiKeyAuthConfig(config: ApiKeyAuthConfig): ApiKeyAuthConfig {
  return {
    keys: config.keys.map((record) => ({
      ...record,
      scopes: [...record.scopes],
    })),
  };
}

const apiKeyRejectionReasons: readonly ApiKeyRejectionReason[] = ["missing", "malformed", "invalid", "expired"];

function assertScopes(value: unknown, label: string): asserts value is ApiKeyScope[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > apiKeyScopes.length) {
    throw new Error(`${label} must contain between 1 and ${apiKeyScopes.length} scopes`);
  }
  const seen = new Set<string>();
  for (const scope of value) {
    if (typeof scope !== "string" || !apiKeyScopes.includes(scope as ApiKeyScope)) {
      throw new Error(`${label} contains an unsupported scope`);
    }
    if (seen.has(scope)) throw new Error(`${label} must not contain duplicate scopes`);
    seen.add(scope);
  }
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function assertExactFields(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  label: string,
): void {
  const allowed = new Set([...required, ...optional]);
  if (Object.keys(value).some((field) => !allowed.has(field))) throw new Error(`${label} fields are invalid`);
  for (const field of required) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) throw new Error(`${label}.${field} must be an own field`);
  }
  for (const field of optional) {
    if (field in value && !Object.prototype.hasOwnProperty.call(value, field)) {
      throw new Error(`${label}.${field} must be an own field when provided`);
    }
  }
}
