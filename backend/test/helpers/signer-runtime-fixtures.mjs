import { privateKeyToAccount } from "viem/accounts";
import { LocalEIP712SignerService } from "../../dist/modules/signer/signer.service.js";

export const testSignerPrivateKey =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
export const testSettlementAddress = "0x0000000000000000000000000000000000000004";
export const testTrustedSignerAddress = privateKeyToAccount(testSignerPrivateKey).address;

export const signerRuntimeEnvNames = [
  "RFQ_SIGNER_MODE",
  "RFQ_SIGNER_PRIVATE_KEY",
  "RFQ_SETTLEMENT_ADDRESS",
  "RFQ_TRUSTED_SIGNER_ADDRESS",
  "RFQ_TRUSTED_SIGNER_OVERLAP_ADDRESSES",
  "RFQ_AWS_KMS_KEY_ID",
  "RFQ_AWS_KMS_REGION",
  "RFQ_AWS_KMS_MAX_ATTEMPTS",
  "RFQ_SIGNER_SERVICE_URL",
  "RFQ_SIGNER_SERVICE_TOKEN",
  "RFQ_SIGNER_SERVICE_REQUEST_TIMEOUT_MS",
  "RFQ_SIGNER_SERVICE_MAX_CONNECTIONS",
  "RFQ_SIGNER_SERVICE_ALLOW_INSECURE_HTTP",
  "RFQ_SIGNER_ATOMIC_QUOTE_COMMIT",
  "RFQ_SIGNER_AUTHORIZATION_WAIT_MS",
];

export function configureAwsSignerEnvironment(env = process.env) {
  env.RFQ_SIGNER_MODE = "aws-kms";
  delete env.RFQ_SIGNER_PRIVATE_KEY;
  env.RFQ_SETTLEMENT_ADDRESS = testSettlementAddress;
  env.RFQ_TRUSTED_SIGNER_ADDRESS = testTrustedSignerAddress;
  env.RFQ_AWS_KMS_KEY_ID = "alias/rfq-test-signer";
  env.RFQ_AWS_KMS_REGION = "us-east-1";
  env.RFQ_AWS_KMS_MAX_ATTEMPTS = "2";
}

export function localTestSignerService() {
  return new LocalEIP712SignerService({
    privateKey: testSignerPrivateKey,
    settlementAddress: testSettlementAddress,
  });
}
