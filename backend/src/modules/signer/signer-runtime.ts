import { privateKeyToAccount } from "viem/accounts";
import {
  assertAwsKmsSignerProviderConfig,
  AwsKmsSignerProvider,
} from "./aws-kms-signer.provider.js";
import { KmsSignerService } from "./kms-signer.service.js";
import {
  LocalEIP712SignerService,
  type SignerService,
} from "./signer.service.js";

const defaultLocalPrivateKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const defaultLocalSettlementAddress = "0x0000000000000000000000000000000000000004";
const defaultAwsKmsMaxAttempts = 3;

interface SignerIdentity {
  settlementAddress: `0x${string}`;
  trustedSignerAddress: `0x${string}`;
  trustedSignerOverlapAddresses: readonly `0x${string}`[];
}

export interface LocalSignerRuntimeConfig extends SignerIdentity {
  mode: "local";
  privateKey: `0x${string}`;
}

export interface AwsKmsSignerRuntimeConfig extends SignerIdentity {
  mode: "aws-kms";
  keyId: string;
  region: string;
  maxAttempts: number;
}

export interface ExternalSignerRuntimeConfig extends SignerIdentity {
  mode: "external";
}

export type SignerRuntimeConfig =
  | LocalSignerRuntimeConfig
  | AwsKmsSignerRuntimeConfig
  | ExternalSignerRuntimeConfig;

export interface SignerRuntime {
  service: SignerService;
  close?: () => void | Promise<void>;
}

export function readSignerRuntimeConfig(
  env: Record<string, string | undefined> | undefined = process.env,
  options: { allowExternal?: boolean } = {},
): SignerRuntimeConfig {
  assertEnvironment(env);
  const nodeEnv = readOwnEnvValue(env, "NODE_ENV");
  const modeValue = readOwnEnvValue(env, "RFQ_SIGNER_MODE");
  const localEnvironment = isLocalNodeEnvironment(nodeEnv);
  const mode = modeValue === undefined && localEnvironment ? "local" : modeValue;
  if (mode !== "local" && mode !== "aws-kms" && mode !== "external") {
    throw new Error("RFQ_SIGNER_MODE must be local, aws-kms, or external");
  }

  const settlementAddressValue = readOwnEnvValue(env, "RFQ_SETTLEMENT_ADDRESS");
  const trustedSignerValue = readOwnEnvValue(env, "RFQ_TRUSTED_SIGNER_ADDRESS");
  const trustedSignerOverlapValue = readOwnEnvValue(
    env,
    "RFQ_TRUSTED_SIGNER_OVERLAP_ADDRESSES",
  );
  const privateKeyValue = readOwnEnvValue(env, "RFQ_SIGNER_PRIVATE_KEY");
  const keyIdValue = readOwnEnvValue(env, "RFQ_AWS_KMS_KEY_ID");
  const regionValue = readOwnEnvValue(env, "RFQ_AWS_KMS_REGION");
  const maxAttemptsValue = readOwnEnvValue(env, "RFQ_AWS_KMS_MAX_ATTEMPTS");

  if (mode === "local") {
    if (!localEnvironment) {
      throw new Error(`RFQ_SIGNER_MODE=local is not allowed when NODE_ENV=${nodeEnv}`);
    }
    rejectConfiguredKmsFields(keyIdValue, regionValue, maxAttemptsValue);
    const privateKey = parsePrivateKey(privateKeyValue ?? defaultLocalPrivateKey, "RFQ_SIGNER_PRIVATE_KEY");
    const settlementAddress = parseAddress(
      settlementAddressValue ?? defaultLocalSettlementAddress,
      "RFQ_SETTLEMENT_ADDRESS",
    );
    const derivedSigner = privateKeyToAccount(privateKey).address.toLowerCase() as `0x${string}`;
    if (trustedSignerValue !== undefined) {
      const configuredSigner = parseAddress(trustedSignerValue, "RFQ_TRUSTED_SIGNER_ADDRESS");
      if (configuredSigner !== derivedSigner) {
        throw new Error("RFQ_TRUSTED_SIGNER_ADDRESS must match RFQ_SIGNER_PRIVATE_KEY in local mode");
      }
    }
    return {
      mode,
      privateKey,
      settlementAddress,
      trustedSignerAddress: derivedSigner,
      trustedSignerOverlapAddresses: parseTrustedSignerOverlapAddresses(
        trustedSignerOverlapValue,
        derivedSigner,
      ),
    };
  }

  if (privateKeyValue !== undefined) {
    throw new Error(`RFQ_SIGNER_PRIVATE_KEY must not be configured when RFQ_SIGNER_MODE=${mode}`);
  }
  const settlementAddress = parseAddress(
    requireConfigured(settlementAddressValue, "RFQ_SETTLEMENT_ADDRESS"),
    "RFQ_SETTLEMENT_ADDRESS",
  );
  const trustedSignerAddress = parseAddress(
    requireConfigured(trustedSignerValue, "RFQ_TRUSTED_SIGNER_ADDRESS"),
    "RFQ_TRUSTED_SIGNER_ADDRESS",
  );
  const trustedSignerOverlapAddresses = parseTrustedSignerOverlapAddresses(
    trustedSignerOverlapValue,
    trustedSignerAddress,
  );

  if (mode === "external") {
    if (!options.allowExternal) {
      throw new Error("RFQ_SIGNER_MODE=external requires an injected signerService");
    }
    rejectConfiguredKmsFields(keyIdValue, regionValue, maxAttemptsValue);
    return {
      mode,
      settlementAddress,
      trustedSignerAddress,
      trustedSignerOverlapAddresses,
    };
  }

  const awsConfig = {
    mode,
    settlementAddress,
    trustedSignerAddress,
    trustedSignerOverlapAddresses,
    keyId: requireConfigured(keyIdValue, "RFQ_AWS_KMS_KEY_ID"),
    region: requireConfigured(regionValue, "RFQ_AWS_KMS_REGION"),
    maxAttempts: parsePositiveInteger(maxAttemptsValue, defaultAwsKmsMaxAttempts, "RFQ_AWS_KMS_MAX_ATTEMPTS", 10),
  } as const;
  assertAwsKmsSignerProviderConfig({
    keyId: awsConfig.keyId,
    region: awsConfig.region,
    maxAttempts: awsConfig.maxAttempts,
  });
  return awsConfig;
}

export function createSignerRuntime(config: SignerRuntimeConfig): SignerRuntime {
  if (config.mode === "external") {
    throw new Error("External signer runtime must be supplied through buildServer signerService");
  }
  if (config.mode === "local") {
    return {
      service: new LocalEIP712SignerService({
        privateKey: config.privateKey,
        settlementAddress: config.settlementAddress,
      }),
    };
  }

  const provider = new AwsKmsSignerProvider({
    keyId: config.keyId,
    region: config.region,
    maxAttempts: config.maxAttempts,
  });
  const service = new KmsSignerService(provider, {
    settlementAddress: config.settlementAddress,
    trustedSignerAddress: config.trustedSignerAddress,
  });
  return {
    service,
    close: () => service.close(),
  };
}

export function isLocalNodeEnvironment(nodeEnv: string | undefined): boolean {
  return nodeEnv === undefined || nodeEnv === "development" || nodeEnv === "test";
}

function readOwnEnvValue(
  env: Record<string, string | undefined> | undefined,
  name: string,
): string | undefined {
  if (!env || !Object.prototype.hasOwnProperty.call(env, name)) return undefined;
  const value = env[name];
  if (value !== undefined && typeof value !== "string") {
    throw new Error(`${name} must be a primitive string`);
  }
  return value;
}

function requireConfigured(value: string | undefined, name: string): string {
  if (value === undefined || value.length === 0 || value.trim() !== value || value.startsWith("replace-with-")) {
    throw new Error(`${name} must be explicitly configured without surrounding whitespace`);
  }
  return value;
}

function parseAddress(value: string, name: string): `0x${string}` {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`${name} must be a 20-byte hex address`);
  }
  if (/^0x0{40}$/i.test(value)) {
    throw new Error(`${name} must not be the zero address`);
  }
  return value.toLowerCase() as `0x${string}`;
}

function parsePrivateKey(value: string, name: string): `0x${string}` {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${name} must be a 32-byte hex string`);
  }
  return value as `0x${string}`;
}

function parseTrustedSignerOverlapAddresses(
  value: string | undefined,
  primarySigner: `0x${string}`,
): readonly `0x${string}`[] {
  if (value === undefined) return [];
  if (value.length === 0 || value.trim() !== value) {
    throw new Error(
      "RFQ_TRUSTED_SIGNER_OVERLAP_ADDRESSES must be a comma-separated address list without surrounding whitespace",
    );
  }

  const entries = value.split(",");
  if (entries.length > 4) {
    throw new Error("RFQ_TRUSTED_SIGNER_OVERLAP_ADDRESSES must contain at most 4 addresses");
  }
  const seen = new Set([primarySigner.toLowerCase()]);
  return entries.map((entry) => {
    const signer = parseAddress(entry, "RFQ_TRUSTED_SIGNER_OVERLAP_ADDRESSES entry");
    if (seen.has(signer)) {
      throw new Error(
        "RFQ_TRUSTED_SIGNER_OVERLAP_ADDRESSES must not duplicate the primary signer or another overlap signer",
      );
    }
    seen.add(signer);
    return signer;
  });
}

function parsePositiveInteger(
  value: string | undefined,
  defaultValue: number,
  name: string,
  max: number,
): number {
  if (value === undefined) return defaultValue;
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`${name} must be a base-10 integer between 1 and ${max}`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > max) {
    throw new Error(`${name} must be a base-10 integer between 1 and ${max}`);
  }
  return parsed;
}

function rejectConfiguredKmsFields(
  keyId: string | undefined,
  region: string | undefined,
  maxAttempts: string | undefined,
): void {
  if (keyId !== undefined || region !== undefined || maxAttempts !== undefined) {
    throw new Error("RFQ_AWS_KMS_* fields are only allowed when RFQ_SIGNER_MODE=aws-kms");
  }
}

function assertEnvironment(value: unknown): asserts value is Record<string, string | undefined> | undefined {
  if (value !== undefined && (typeof value !== "object" || value === null || Array.isArray(value))) {
    throw new Error("Signer runtime environment must be an object");
  }
}
