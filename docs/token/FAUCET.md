# Self-service TOD faucet

`ToDFaucet` distributes prefunded ToD Test Token inventory. It has no minter role, admin, upgrade, withdrawal, or user custody. A user calls `claim()` from their own wallet and receives the immutable allocation. The recommended demo parameters are 100 TOD per claim and a 24-hour cooldown. Constructor bounds are a positive allocation and a cooldown between one second and thirty days, with six-decimal TOD as the configured token.

Anyone may refill the faucet by transferring existing TOD to it. The existing authorized funding command may mint a bounded allocation to the faucet address, subject to the token cap and the operator's public send confirmation. Revoking that minter does not stop a prefunded faucet. Exhaustion makes claims revert without consuming the claimant's cooldown. Retrying after a refill is safe. Cooldown failures also leave inventory and timestamps unchanged.

The caller receives the allocation; they cannot supply another recipient or consume someone else's cooldown. An address cooldown is not proof of personhood: someone can use many wallets to exhaust the bounded test inventory. This faucet intentionally distributes valueless demo assets. Do not fund it with real stablecoins or grant it token issuance authority. Unrelated assets sent to it cannot be recovered.

| Action | Caller and incentive | If nobody acts |
|---|---|---|
| Deploy | Authorized operator prepares test onboarding | No faucet exists |
| Refill | Team allocates a bounded demo budget | Existing inventory is the hard distribution limit |
| Claim | User pays ETH gas to obtain test TOD | Allocation stays in the faucet |
| Reclaim after cooldown | User needs another demo allocation | No automatic distribution occurs |

Claims need native ETH. Anvil's local balance tools cover the deterministic rehearsal; Base Sepolia users need test ETH from a separately funded gas source. A TOD faucet cannot create ETH. Base Sepolia deployment and any funded-key operation require their own explicit authorization.

Tests cover first claim, repeated claim, the exact cooldown boundary, independent users, exhaustion and refill, revoked mint authority, invalid configuration, and fuzzed allocation/cooldown values. Stateful invariants must conserve initial inventory across successful claims without issuing supply. The command-line rehearsal connects faucet claims to existing stake, job, settlement, and withdrawal operations. The separate [test exchange](TEST_EXCHANGE.md) exercises conversion using bounded test inventory; this faucet creates no dollar value or real-USDC redemption promise.

## Reproduce the local money flow

From the repository root, install the pinned workspace and expose Foundry on PATH:

```sh
export PATH="$HOME/.foundry/bin:$PATH"
uv sync --locked --all-packages
uv run pytest packages/core/tests/ledger_test.py::test_faucet_to_stake_settlement_claim_and_withdrawal -q -s
```

This command starts an isolated Anvil, deploys the real TOD/registry/market/faucet contracts, prefunds the faucet, and claims 100 TOD into each participant's wallet. Four owners stake and one requester funds a job. The shared exact MLP trains on a canonical synthetic dataset. Two verifier roles independently replay all four nodes, identify the deliberately wrong update, and agree on the merged model hash. The bad node is slashed, and three honest owners receive the round budget plus the eligible half of the slash. They claim earnings and withdraw their remaining stake. The test checks every balance and unchanged total supply, then tests the separate test-USDC conversion and reverse swap with exact approvals and balances, and stops Anvil. It also rejects a repeated faucet claim without consuming a nonce.

This exercises the actual shared trainer, replay and merge code in one test process, together with real Anvil transactions and role signatures. Autonomous coordinator driving, separate node/verifier processes, wallet UI and public-network deployment have separate integration acceptance; do not describe this command as a complete running platform.

## Try claims interactively

Start `anvil --silent` in a separate terminal. In a fresh output directory, run:

```sh
uv run python scripts/deploy.py --network anvil --out runs/faucet-network.toml --journal-dir runs/faucet-bundle --no-verify
uv run python scripts/faucet.py deploy --network runs/faucet-network.toml --out runs/faucet.json
```

Read the public faucet address from `runs/faucet.json`. Replace `FAUCET_ADDRESS` below with that value. For a local-only default claimant, print its public address with `uv run python -c 'from tod_core.txmgr import LocalSigner, dev_key; print(LocalSigner(dev_key("faucet/user")).address)'` and use it as `WALLET_ADDRESS`:

```sh
uv run python scripts/fund.py FAUCET_ADDRESS --network runs/faucet-network.toml --tokens 1000 --eth 0
uv run python scripts/fund.py WALLET_ADDRESS --network runs/faucet-network.toml --tokens 0 --eth 1
uv run python scripts/faucet.py status --network runs/faucet-network.toml --faucet FAUCET_ADDRESS --account WALLET_ADDRESS
uv run python scripts/faucet.py claim --network runs/faucet-network.toml --faucet FAUCET_ADDRESS
```

The first claim succeeds; an immediate second claim reports the next eligible Unix timestamp. `status` requires no signing key and reports inventory and allocations in six-decimal base units. An existing `--out` deployment receipt is never overwritten.

On Base Sepolia, use a separately prepared network configuration and authorized deployment. `DEPLOYER_PRIVATE_KEY` must match its configured deployer; `FAUCET_PRIVATE_KEY` is used only by the existing mint/refill command. A claimant supplies their own `WALLET_PRIVATE_KEY` at runtime. No default local key is accepted outside Anvil. Deployment and claims print sender, chain, token, amounts and live gas bounds, then require `send`; `--yes` is reserved for an explicitly authorized rehearsal. Keep keys out of command history and source files. No faucet address is published until an actual authorized deployment has receipts.

## Security review

The token is the selected, non-rebasing ToDToken, and the claim path updates its cooldown before transferring funds with SafeERC20 and the pinned transient reentrancy guard. No external caller can change allocations or withdraw inventory. Scope is limited to test assets; address farming can exhaust that inventory.

Slither reports the expected low-severity use of `block.timestamp` for the cooldown. This is a wall-clock rate limit, not a randomness source or a financial pricing input; exact-boundary tests cover it. The whole-project scan also reports existing registry/market findings and cannot model parts of OpenZeppelin's transient guard. The scan is not an independent security audit or a production deployment approval.
