import assert from "node:assert/strict";
import test from "node:test";
import {
  LocalSettlementVerifier,
  defaultLocalSettlementVerifierPolicy,
} from "../dist/modules/settlement/settlement-verifier.service.js";

const tokenIn = "0x0000000000000000000000000000000000000002";
const tokenOut = "0x0000000000000000000000000000000000000003";

test("LocalSettlementVerifier rejects unsafe policy configuration at construction", () => {
  assert.throws(
    () => new LocalSettlementVerifier(null),
    /Local settlement verifier policy must be an object/,
  );
  assert.throws(
    () => new LocalSettlementVerifier(Object.create(defaultLocalSettlementVerifierPolicy)),
    /Local settlement verifier policy.verifierVersion must be an own field/,
  );

  const policyWithInheritedTokenWhitelist = {
    verifierVersion: defaultLocalSettlementVerifierPolicy.verifierVersion,
    enabledChainIds: defaultLocalSettlementVerifierPolicy.enabledChainIds,
  };
  Object.setPrototypeOf(policyWithInheritedTokenWhitelist, {
    tokenWhitelist: defaultLocalSettlementVerifierPolicy.tokenWhitelist,
  });
  assert.throws(
    () => new LocalSettlementVerifier(policyWithInheritedTokenWhitelist),
    /Local settlement verifier policy.tokenWhitelist must be an own field/,
  );

  assert.throws(
    () =>
      new LocalSettlementVerifier({
        ...defaultLocalSettlementVerifierPolicy,
        enabledChainIds: undefined,
      }),
    /Local settlement verifier enabledChainIds must be an array/,
  );

  assert.throws(
    () =>
      new LocalSettlementVerifier({
        ...defaultLocalSettlementVerifierPolicy,
        verifierVersion: " ",
      }),
    /Local settlement verifier verifierVersion must be a non-empty string/,
  );

  assert.throws(
    () =>
      new LocalSettlementVerifier({
        ...defaultLocalSettlementVerifierPolicy,
        enabledChainIds: [],
      }),
    /Local settlement verifier enabledChainIds must contain at least one chain id/,
  );

  assert.throws(
    () =>
      new LocalSettlementVerifier({
        ...defaultLocalSettlementVerifierPolicy,
        enabledChainIds: [0],
      }),
    /Local settlement verifier enabledChainIds entries must be positive safe integers/,
  );

  assert.throws(
    () =>
      new LocalSettlementVerifier({
        ...defaultLocalSettlementVerifierPolicy,
        enabledChainIds: [1, 1],
      }),
    /Local settlement verifier enabledChainIds must not contain duplicate chain ids/,
  );

  assert.throws(
    () =>
      new LocalSettlementVerifier({
        ...defaultLocalSettlementVerifierPolicy,
        tokenWhitelist: [],
      }),
    /Local settlement verifier tokenWhitelist must contain at least one address/,
  );

  assert.throws(
    () =>
      new LocalSettlementVerifier({
        ...defaultLocalSettlementVerifierPolicy,
        tokenWhitelist: ["0x00000000000000000000000000000000000000zz"],
      }),
    /Local settlement verifier tokenWhitelist entries must be 20-byte hex addresses/,
  );

  assert.throws(
    () =>
      new LocalSettlementVerifier({
        ...defaultLocalSettlementVerifierPolicy,
        tokenWhitelist: [new String(tokenIn), tokenOut],
      }),
    /Local settlement verifier tokenWhitelist entries must be 20-byte hex addresses/,
  );

  assert.throws(
    () =>
      new LocalSettlementVerifier({
        ...defaultLocalSettlementVerifierPolicy,
        settlementAddress: "0x00000000000000000000000000000000000000zz",
      }),
    /Local settlement verifier settlementAddress must be a 20-byte hex address/,
  );

  assert.throws(
    () =>
      new LocalSettlementVerifier({
        ...defaultLocalSettlementVerifierPolicy,
        trustedSignerAddress: new String(defaultLocalSettlementVerifierPolicy.trustedSignerAddress),
      }),
    /Local settlement verifier trustedSignerAddress must be a 20-byte hex address/,
  );

  assert.throws(
    () =>
      new LocalSettlementVerifier({
        ...defaultLocalSettlementVerifierPolicy,
        trustedSignerOverlapAddresses: undefined,
      }),
    /Local settlement verifier trustedSignerOverlapAddresses must be an array/,
  );

  for (const signer of [
    "0x00000000000000000000000000000000000000zz",
    "0x0000000000000000000000000000000000000000",
    new String("0x00000000000000000000000000000000000000aa"),
  ]) {
    assert.throws(
      () =>
        new LocalSettlementVerifier({
          ...defaultLocalSettlementVerifierPolicy,
          trustedSignerOverlapAddresses: [signer],
        }),
      /Local settlement verifier trustedSignerOverlapAddresses/,
    );
  }

  assert.throws(
    () =>
      new LocalSettlementVerifier({
        ...defaultLocalSettlementVerifierPolicy,
        trustedSignerOverlapAddresses: [
          defaultLocalSettlementVerifierPolicy.trustedSignerAddress.toUpperCase().replace("0X", "0x"),
        ],
      }),
    /trusted signer addresses must not contain duplicates/,
  );

  assert.throws(
    () =>
      new LocalSettlementVerifier({
        ...defaultLocalSettlementVerifierPolicy,
        trustedSignerOverlapAddresses: [
          "0x00000000000000000000000000000000000000aa",
          "0x00000000000000000000000000000000000000AA",
        ],
      }),
    /trusted signer addresses must not contain duplicates/,
  );

  assert.throws(
    () =>
      new LocalSettlementVerifier({
        ...defaultLocalSettlementVerifierPolicy,
        trustedSignerOverlapAddresses: [
          "0x0000000000000000000000000000000000000011",
          "0x0000000000000000000000000000000000000012",
          "0x0000000000000000000000000000000000000013",
          "0x0000000000000000000000000000000000000014",
          "0x0000000000000000000000000000000000000015",
        ],
      }),
    /must contain at most 4 addresses/,
  );

  assert.throws(
    () =>
      new LocalSettlementVerifier({
        ...defaultLocalSettlementVerifierPolicy,
        tokenWhitelist: [
          "0x00000000000000000000000000000000000000cc",
          "0x00000000000000000000000000000000000000CC",
        ],
      }),
    /Local settlement verifier tokenWhitelist must not contain duplicate addresses/,
  );
});
