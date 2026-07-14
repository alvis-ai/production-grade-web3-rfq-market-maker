# ADR-0007: Use Atomic Settlement Deployment Factory

## Status

Accepted

## Context

`RFQSettlement` and `Treasury` form one custody boundary but cannot be safely operated until both contracts exist, Treasury trusts the Settlement address, the token whitelist is complete, and owner plus role administration belong to the intended production administrator. A plain Forge script broadcasts these actions as multiple transactions. Interruption, a wrong sender, or an ownership transfer that succeeds for only one contract can leave funds or controls split across the deployer, script address, and final administrator.

The production administrator may be a multisig or governance executor and should not need to be the hot account paying deployment gas. Deployment must therefore separate gas payer identity from final authority while preserving an all-or-nothing configuration boundary.

## Decision

Use `RFQDeploymentFactory` as the atomic deployment boundary. A Forge script validates `RFQ_TRUSTED_SIGNER`, `RFQ_CONTRACT_ADMIN`, and the complete token whitelist before creating the factory. One factory call then creates Treasury and Settlement, wires their addresses, applies the whitelist, transfers Settlement ownership and every administrative role, transfers Treasury ownership, and verifies final postconditions before returning.

The final administrator is supplied explicitly and must be non-zero. The factory temporarily owns the new contracts only inside the deployment transaction and must hold no `DEFAULT_ADMIN_ROLE` after completion. The broadcaster remains only the gas payer and receives no implicit authority.

## Consequences

### Positive

- Contract creation, cross-contract wiring, whitelist initialization, and final authority transfer succeed or revert together.
- A multisig or governance executor can become final administrator without exposing a private key to the deployment script.
- Postcondition checks make an incomplete or behaviorally incompatible deployment fail before it can be announced as usable.
- The deployment test can prove the factory retains no role in the resulting stack.

### Negative

- Deployment consumes additional gas because a factory contract is created and invariant checks execute on-chain.
- The factory bytecode and deployment event become part of the contract audit surface.
- Updating constructor or administration behavior requires synchronized changes to the factory and its tests.

### Mitigation

Keep the factory stateless and narrowly scoped, pin its source to the same commit as Settlement and Treasury, and run Foundry deployment tests in Contract CI. Operational procedures must verify emitted addresses, bytecode, trusted signer, whitelist, Treasury linkage, owners, and roles before backend configuration is updated.

## Alternatives Considered

- Direct multi-transaction Forge broadcast: simple, but permits partial configuration and sender/owner mismatches.
- Require the broadcaster to be final admin: avoids one handoff but prevents clean separation between a hot deployment key and multisig governance.
- Expand constructors to accept every cross-contract setting: cannot directly resolve the circular Settlement/Treasury address relationship without prediction or a factory.
- CREATE2 address prediction: can precompute the relationship but adds salt, bytecode-hash, and replay operational complexity without removing the need for atomic configuration.
