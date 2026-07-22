# ADR-0027: Use WASM Secp256k1 Recovery

## Status

Accepted

## Context

The gateway independently recovers every remote signer response before accepting it. This boundary must remain even though the isolated signer validates authorization and durably audits before responding. The existing viem/noble typed-data recovery measured about 1.78 ms p50 and 3.25 ms p99 by itself, while the complete gateway signing stage averaged 4.65-5.48 ms.

## Decision

The gateway computes the same EIP-712 digest locally and uses pinned `tiny-secp256k1` 2.2.4 WebAssembly recovery for the secp256k1 operation. It passes the compact `(r,s)` signature and normalized Ethereum recovery id, derives the Ethereum address from the recovered uncompressed public key, and compares it with the configured trusted signer address.

The existing low-s and 65-byte signature validation remains mandatory. The recovery id is not discarded: merely verifying `(r,s)` against a cached public key would accept a flipped `v` even though the settlement contract could recover a different address. Any WASM exception, null recovery, malformed signature, digest mismatch or signer mismatch fails closed as `SIGNER_UNAVAILABLE`.

The isolated local-development signer uses the same pinned implementation for recoverable ECDSA signing after hashing the EIP-712 payload. It accepts only Ethereum recovery ids 0 or 1 and emits canonical 27/28 `v`; unsupported recovery output fails closed instead of manufacturing a signature. AWS KMS production signing and its DER/low-s recovery path are unchanged.

## Consequences

### Positive

- Standalone recovered-address measurement improved to about 0.18 ms p50 and 0.25 ms p99.
- The gateway still verifies the complete typed payload independently from signer transport and audit.
- Compose local signing avoids the slower pure-JavaScript scalar operation without changing the signer process boundary.

### Negative

- The production image carries a pinned WASM cryptographic dependency and must verify lockfile integrity and image loading in CI.
- A valid implementation result is not sufficient by itself; EIP-712 digest mutation, recovery-id mutation, wrong signer and malformed response tests are release gates.
- Local WASM signing does not model AWS KMS latency and cannot be used as KMS SLO evidence.

### Mitigation

The gateway-only recovery microbenchmark remains about 0.18 ms p50. In the rebuilt stack, isolated signer signature computation averaged about 0.39 ms instead of the earlier 0.96 ms. The final concurrency-one image benchmark measured the complete gateway signing stage at 3.60 ms, p50 at 13.37 ms and p99 at 31.71 ms with zero errors; transport, durable signer audit and independent gateway recovery remain included. This ADR therefore does not declare the complete SLO achieved.

## Alternatives Considered

- Trust the signer response over bearer-authenticated HTTP: rejected because it removes independent signature verification.
- Verify only `(r,s)` against a cached public key: rejected because it does not bind Ethereum recovery id `v`.
- Add the older native Node addon: rejected because its build and platform surface is larger than the packaged WASM path.
- Keep the pure JavaScript recovery: correct but consumes most of the remaining p50 budget.
