import {
  KMSClient,
  SignCommand,
  type SignCommandOutput,
} from "@aws-sdk/client-kms";
import type { KmsSignerProvider } from "./kms-signer.service.js";

const awsKmsConfigFields = ["keyId", "region", "maxAttempts"] as const;
const maxKeyIdLength = 2_048;
const keyIdPattern = /^[A-Za-z0-9_./:=@+-]+$/;
const regionPattern = /^[a-z0-9]+(?:-[a-z0-9]+)+-[0-9]+$/;

export interface AwsKmsSignerProviderConfig {
  keyId: string;
  region: string;
  maxAttempts: number;
}

export interface AwsKmsClient {
  send(command: SignCommand): Promise<SignCommandOutput>;
  destroy?(): void;
}

export class AwsKmsSignerProvider implements KmsSignerProvider {
  readonly keyId: string;
  private readonly client: AwsKmsClient;
  private readonly ownsClient: boolean;

  constructor(config: AwsKmsSignerProviderConfig, client?: AwsKmsClient) {
    assertAwsKmsSignerProviderConfig(config);
    if (client !== undefined) assertAwsKmsClient(client);
    this.keyId = config.keyId;
    this.client = client ?? new KMSClient({
      region: config.region,
      maxAttempts: config.maxAttempts,
    });
    this.ownsClient = client === undefined;
  }

  async signDigest(digest: Uint8Array): Promise<Uint8Array> {
    if (!(digest instanceof Uint8Array) || digest.length !== 32) {
      throw new Error("AWS KMS signer digest must contain exactly 32 bytes");
    }

    const output = await this.client.send(new SignCommand({
      KeyId: this.keyId,
      Message: Uint8Array.from(digest),
      MessageType: "DIGEST",
      SigningAlgorithm: "ECDSA_SHA_256",
    }));
    if (!(output.Signature instanceof Uint8Array)) {
      throw new Error("AWS KMS Sign response must include signature bytes");
    }
    if (output.Signature.length < 8 || output.Signature.length > 72) {
      throw new Error("AWS KMS Sign response signature length is invalid");
    }
    if (output.SigningAlgorithm !== undefined && output.SigningAlgorithm !== "ECDSA_SHA_256") {
      throw new Error("AWS KMS Sign response used an unexpected signing algorithm");
    }
    return Uint8Array.from(output.Signature);
  }

  close(): void {
    if (this.ownsClient) this.client.destroy?.();
  }
}

export function assertAwsKmsSignerProviderConfig(
  value: unknown,
): asserts value is AwsKmsSignerProviderConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("AWS KMS signer config must be an object");
  }
  const config = value as Record<string, unknown>;
  assertExactOwnFields(config, awsKmsConfigFields);
  if (
    typeof config.keyId !== "string" ||
    config.keyId.length === 0 ||
    config.keyId.length > maxKeyIdLength ||
    !keyIdPattern.test(config.keyId) ||
    config.keyId.includes("replace-with-")
  ) {
    throw new Error("AWS KMS signer keyId must be a configured safe identifier up to 2048 characters");
  }
  if (
    typeof config.region !== "string" ||
    config.region.length > 64 ||
    !regionPattern.test(config.region)
  ) {
    throw new Error("AWS KMS signer region must be a valid AWS region identifier");
  }
  if (!Number.isSafeInteger(config.maxAttempts) || (config.maxAttempts as number) < 1 || (config.maxAttempts as number) > 10) {
    throw new Error("AWS KMS signer maxAttempts must be an integer between 1 and 10");
  }
}

function assertAwsKmsClient(value: unknown): asserts value is AwsKmsClient {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    typeof (value as Record<string, unknown>).send !== "function"
  ) {
    throw new Error("AWS KMS signer client.send must be a function");
  }
}

function assertExactOwnFields(value: Record<string, unknown>, fields: readonly string[]): void {
  const allowed = new Set(fields);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`AWS KMS signer config must not include unknown field ${key}`);
  }
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      throw new Error(`AWS KMS signer config.${field} must be an own field`);
    }
  }
}
