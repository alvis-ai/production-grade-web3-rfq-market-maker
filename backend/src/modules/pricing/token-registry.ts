import type { Address } from "../../shared/types/rfq.js";

export type TokenRiskTier = "low" | "medium" | "high";

export interface TokenMetadata {
  chainId: number;
  tokenAddress: Address;
  symbol: string;
  decimals: number;
  isWhitelisted: boolean;
  riskTier: TokenRiskTier;
  usdReference: boolean;
}

export interface TokenRegistryConfig {
  tokens: TokenMetadata[];
}

export interface TokenRegistry {
  getToken(chainId: number, tokenAddress: Address): TokenMetadata | undefined;
}

export const defaultTokenRegistryConfig: TokenRegistryConfig = {
  tokens: [
    {
      chainId: 1,
      tokenAddress: "0x0000000000000000000000000000000000000002",
      symbol: "TOKEN2",
      decimals: 18,
      isWhitelisted: true,
      riskTier: "low",
      usdReference: false,
    },
    {
      chainId: 1,
      tokenAddress: "0x0000000000000000000000000000000000000003",
      symbol: "TOKEN3",
      decimals: 18,
      isWhitelisted: true,
      riskTier: "low",
      usdReference: true,
    },
  ],
};

const configFields = ["tokens"] as const;
const tokenFields = [
  "chainId",
  "tokenAddress",
  "symbol",
  "decimals",
  "isWhitelisted",
  "riskTier",
  "usdReference",
] as const;
const maxConfiguredTokens = 10_000;
const symbolPattern = /^[A-Za-z0-9._-]+$/;

export class ConfiguredTokenRegistry implements TokenRegistry {
  private readonly tokensByKey = new Map<string, TokenMetadata>();

  constructor(config: TokenRegistryConfig = defaultTokenRegistryConfig) {
    assertTokenRegistryConfig(config);
    for (const token of cloneTokenRegistryConfig(config).tokens) {
      this.tokensByKey.set(tokenKey(token.chainId, token.tokenAddress), token);
    }
  }

  getToken(chainId: number, tokenAddress: Address): TokenMetadata | undefined {
    if (!Number.isSafeInteger(chainId) || chainId <= 0 || !isAddress(tokenAddress)) return undefined;
    const token = this.tokensByKey.get(tokenKey(chainId, tokenAddress));
    return token ? { ...token } : undefined;
  }
}

export function parseTokenRegistryConfig(value: string): TokenRegistryConfig {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("RFQ_TOKEN_REGISTRY_JSON must be a non-empty JSON object");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("RFQ_TOKEN_REGISTRY_JSON must contain valid JSON");
  }

  assertTokenRegistryConfig(parsed);
  return cloneTokenRegistryConfig(parsed);
}

export function assertTokenRegistry(value: unknown): asserts value is TokenRegistry {
  if (!isRecord(value) || typeof value.getToken !== "function") {
    throw new Error("Formula pricing tokenRegistry.getToken must be a function");
  }
}

export function requireTokenMetadata(
  registry: TokenRegistry,
  chainId: number,
  tokenAddress: Address,
  label: string,
): TokenMetadata {
  assertTokenRegistry(registry);
  const metadata = registry.getToken(chainId, tokenAddress);
  if (metadata === undefined) {
    throw new Error(`${label} token ${tokenAddress} is not configured on chain ${chainId}`);
  }
  assertTokenMetadata(metadata, `${label} metadata`);
  if (metadata.chainId !== chainId || metadata.tokenAddress.toLowerCase() !== tokenAddress.toLowerCase()) {
    throw new Error(`${label} metadata must match requested chain and token address`);
  }
  if (!metadata.isWhitelisted) {
    throw new Error(`${label} token ${tokenAddress} is not whitelisted on chain ${chainId}`);
  }
  return normalizeTokenMetadata(metadata);
}

export function assertTokenRegistryConfig(value: unknown): asserts value is TokenRegistryConfig {
  if (!isRecord(value)) throw new Error("Token registry config must be an object");
  assertExactFields(value, configFields, "Token registry config");
  if (!Array.isArray(value.tokens) || value.tokens.length === 0 || value.tokens.length > maxConfiguredTokens) {
    throw new Error(`Token registry config.tokens must contain between 1 and ${maxConfiguredTokens} entries`);
  }

  const seen = new Set<string>();
  for (const token of value.tokens) {
    assertTokenMetadata(token, "Token registry entry");
    const key = tokenKey(token.chainId, token.tokenAddress);
    if (seen.has(key)) throw new Error("Token registry config must not contain duplicate chain/token entries");
    seen.add(key);
  }
}

function assertTokenMetadata(value: unknown, label: string): asserts value is TokenMetadata {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  assertExactFields(value, tokenFields, label);
  assertInteger(value.chainId, 1, Number.MAX_SAFE_INTEGER, `${label}.chainId`);
  if (!isAddress(value.tokenAddress)) throw new Error(`${label}.tokenAddress must be a 20-byte hex address`);
  if (
    typeof value.symbol !== "string" ||
    value.symbol.length < 1 ||
    value.symbol.length > 32 ||
    !symbolPattern.test(value.symbol)
  ) {
    throw new Error(`${label}.symbol must be 1-32 letters, numbers, dot, underscore, or hyphen characters`);
  }
  assertInteger(value.decimals, 0, 36, `${label}.decimals`);
  if (typeof value.isWhitelisted !== "boolean") throw new Error(`${label}.isWhitelisted must be a boolean`);
  if (value.riskTier !== "low" && value.riskTier !== "medium" && value.riskTier !== "high") {
    throw new Error(`${label}.riskTier must be low, medium, or high`);
  }
  if (typeof value.usdReference !== "boolean") throw new Error(`${label}.usdReference must be a boolean`);
}

function cloneTokenRegistryConfig(config: TokenRegistryConfig): TokenRegistryConfig {
  return { tokens: config.tokens.map(normalizeTokenMetadata) };
}

function normalizeTokenMetadata(token: TokenMetadata): TokenMetadata {
  return {
    ...token,
    tokenAddress: token.tokenAddress.toLowerCase() as Address,
  };
}

function tokenKey(chainId: number, tokenAddress: string): string {
  return `${chainId}:${tokenAddress.toLowerCase()}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAddress(value: unknown): value is Address {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
}

function assertExactFields(value: Record<string, unknown>, fields: readonly string[], label: string): void {
  const expected = new Set(fields);
  for (const field of Object.keys(value)) {
    if (!expected.has(field)) throw new Error(`${label} must not include unknown field ${field}`);
  }
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) throw new Error(`${label}.${field} must be an own field`);
  }
}

function assertInteger(value: unknown, min: number, max: number, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be an integer between ${min} and ${max}`);
  }
}
