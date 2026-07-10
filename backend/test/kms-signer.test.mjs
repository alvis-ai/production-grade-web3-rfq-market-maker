import assert from "node:assert/strict";
import test from "node:test";
import { recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { KmsSignerService } from "../dist/modules/signer/kms-signer.service.js";
import { buildQuoteTypedData } from "../dist/modules/signer/signer.service.js";

const privateKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const settlementAddress = "0x0000000000000000000000000000000000000004";
const quote = {
  user: "0x0000000000000000000000000000000000000001",
  tokenIn: "0x0000000000000000000000000000000000000002",
  tokenOut: "0x0000000000000000000000000000000000000003",
  amountIn: "1000000000",
  amountOut: "998",
  minAmountOut: "990",
  nonce: "42",
  deadline: 4_102_444_800,
  chainId: 1,
};

test("KmsSignerService selects the recovery id that matches the trusted signer", async () => {
  const account = privateKeyToAccount(privateKey);
  const signer = new KmsSignerService({
    keyId: "local-test-key",
    async signDigest(digest) {
      const signature = await account.sign({ hash: `0x${Buffer.from(digest).toString("hex")}` });
      return ethereumSignatureToDer(signature);
    },
  }, settlementAddress, account.address);

  const signature = await signer.signQuote({
    quote,
    quoteId: "q_kms",
    snapshotId: "snapshot_kms",
  });
  const recovered = await recoverTypedDataAddress({
    ...buildQuoteTypedData(quote, settlementAddress),
    signature,
  });

  assert.equal(recovered.toLowerCase(), account.address.toLowerCase());
  assert.equal(await signer.verifyQuoteSignature(quote, signature), true);
});

function ethereumSignatureToDer(signature) {
  const r = derInteger(signature.slice(2, 66));
  const s = derInteger(signature.slice(66, 130));
  const body = Buffer.concat([r, s]);
  return new Uint8Array(Buffer.concat([Buffer.from([0x30, body.length]), body]));
}

function derInteger(hex) {
  let bytes = Buffer.from(hex, "hex");
  while (bytes.length > 1 && bytes[0] === 0 && (bytes[1] & 0x80) === 0) {
    bytes = bytes.subarray(1);
  }
  if ((bytes[0] & 0x80) !== 0) {
    bytes = Buffer.concat([Buffer.from([0]), bytes]);
  }

  return Buffer.concat([Buffer.from([0x02, bytes.length]), bytes]);
}
