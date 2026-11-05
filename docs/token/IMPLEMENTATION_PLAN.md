# ToD token implementation plan

## Deliverables

1. Publish the case report, specification and this plan. Ask all four teammates to acknowledge scope, supply policy, units and ownership in the proposal thread or a formal review. Record replies and outstanding objections.
2. Add ToDToken and focused Foundry tests. Use the existing OpenZeppelin dependency; no new wallet, DEX or reserve service is added.
3. Select ToDToken in deployment, add explicit token cap/admin configuration, implement exact token funding and its public send gate, update metadata and runbooks, and exercise the existing chain scenarios with TOD.
4. Verify the complete workspace and the contract suite, then obtain a fresh review of the token/authority/funding paths before selecting any deployment bundle. Publish tested code as reviewable PRs. Keep merge/deployment gated on real team acknowledgements.

The work follows the established contracts, ABI and deployment lanes. Arunit owns implementation; Shantanu reviews protocol accounting, Rounak reviews runtime/configuration, Dhairya reviews units/commitments and docs, and Ashutosh reviews labels and wallet interactions. No teammate's in-progress runtime or web scope is reassigned.

## Technology and boundaries

- Onchain: one additional minimal token implementation using OpenZeppelin ERC20, ERC20Capped and AccessControl. Registry and market implementations keep their existing interfaces and economics.
- Build/test: pinned Solidity/Foundry settings, fuzzed cap arithmetic, a handler-driven mint/transfer invariant and existing contract scenarios.
- Operator tooling: existing Python/web3 transaction manager and per-key journals, with Decimal-based input conversion. No extra daemon or service.
- Network: Base Sepolia, Alchemy RPC, ETH gas; Anvil for executable integration checks.
- Client surfaces: expose symbol/decimals, stake and claimable amounts consistently. Connect an owner wallet; keep the node operator key local. Embedded-wallet recovery and custody remain outside this task.

## Test and review sequence

First build the token and exercise mint permissions, revocation and cap boundaries. Fuzz the configurable cap and requested mint amounts across valid ranges. Use a handler that performs successful mints and transfers among tracked actors; assert both the cap bound and equality of totalSupply, tracked balances and successful issuance. Configure invariant runs to fail on unexpected reverts and inspect call/revert statistics.

Then run the deployment/funding integration suite against a fresh Anvil chain and a separate local Anvil chain with the public chain ID. Verify emitted role/token metadata, chain mismatch and missing-key refusal, exact fractional inputs, token-only prompts, cap exhaustion and no transactions on deterministic preflight failures. Preserve restart/nonce/replacement tests using valid authorized token intents.

Finally run the locked Python workspace, full Foundry suite, formatting, ABI regeneration/parity and repository publication checks. Review the final diff for issuance authority, amount scaling and financial custody. Test results cover the implemented slice and do not authorize a real-money launch.

## Deployment rehearsal after acknowledgements

Deployment is a separate explicitly authorized action. Prepare fresh admin, faucet, deployer and service wallets; enter their public addresses in a private network configuration and keep keys in secret configuration. Set the cap, verify Base Sepolia chain ID 84532 through the Alchemy endpoint, and provide test ETH to transaction senders.

Use `python scripts/deploy.py --network /path/to/private-network.toml --journal-dir /path/to/private-journal --no-verify` and inspect the transaction plan before accepting the prompt. Write fresh contract addresses and deployment block together. Verify token name/symbol/decimals, cap, zero initial supply and the intended admin/minter before allocating TOD. Configure explorer verification for the selected explorer separately; save real receipts only after execution.

Mint a bounded allocation with `python scripts/fund.py OWNER --network /path/to/private-network.toml --tokens 100 --journal-dir /path/to/private-faucet-journal`. Confirm balances, then reproduce registration, approval/stake, one honest job, one bad update, settlement and eligible claim. Check UI and CLI against contract reads. Do not present probation-forfeited earnings as claimable.

## Recovery and scope cuts

If deployment has already occurred with a different token, retain its address bundle and journals. Existing immutable contracts keep their old token; finish eligible withdrawals there and deploy a separate new bundle. Do not edit old addresses into a new bundle or replay journals under a different deployment identity.

If the testnet path or team acknowledgements are incomplete, retain the verified local demo and leave the token switch unmerged. Do not add trading, price feeds, a USDC reserve, no-deposit economics or a wallet-custody service to rescue the deadline. Those require separate decisions, specifications and funding.
