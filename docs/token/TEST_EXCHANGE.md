# TOD and test-USDC conversion

This follow-up adds a test-only inventory exchange, separate from the TOD faucet. It uses an artificial quote of **1 TOD = 1 test USDC** in both directions, with six decimals and no fee. The quote is a demo parameter, not a dollar price, peg, reserve guarantee, investment return or real-USDC cash-out route. No Uniswap pool or price oracle is needed for this deterministic test flow.

`ToDTestExchange` accepts deployment only on Anvil (31337) and Base Sepolia (84532). Its TOD and test-USDC addresses are immutable and distinct; both must have six decimals and the expected symbols. It cannot mint, burn, change the quote, upgrade, withdraw someone else's wallet balance, or withdraw its inventory through an admin. Seed transfers are donations of test inventory, not LP deposits or redeemable shares.

To swap, a user approves only the exact input amount, then calls `swap(todToUsdc, amount, minOut, deadline)` from their own wallet. Both directions return the same number of base units. `amount` and `minOut` must be positive and `minOut <= amount`; an expired deadline reverts. The caller receives the output. A transaction either transfers both assets or reverts everything, including any input transfer. SafeERC20, a reentrancy guard and exact received-balance checks reject failed, fee-charging or unexpected transfers. Rebasing and taxed assets are unsupported.

Anyone can seed each reserve with the selected test assets. A swap fails before taking input when output inventory is insufficient. The TOD faucet holds its own bounded allocation and has no access to the exchange's reserves. Address farming can exhaust the test-USDC reserve by claiming faucet TOD and exchanging it; this is a disclosed test-budget limit, not an economically sustainable funding model. Do not seed real assets or present the reserves as backing all TOD in circulation.

| Action | Caller and incentive | If nobody acts |
|---|---|---|
| Seed TOD/test USDC | Team supplies a bounded demo inventory | Swaps stop when their output asset runs out |
| Approve exact input | Wallet owner permits their requested exchange | Their wallet balance stays untouched |
| Swap either direction | User tests the conversion flow | Inventory remains in the desk |

For Base Sepolia, obtain test USDC from the [Circle faucet](https://faucet.circle.com/) into an owner-controlled wallet, then seed only the planned test budget. Circle lists `0x036CbD53842c5426634e7929541eC2318f3dCF7e` as its [Base Sepolia USDC address](https://developers.circle.com/stablecoins/usdc-contract-addresses). Circle explicitly states that its testnet tokens have no financial value. Verify code, symbol, decimals and the pinned-fork checks before any public deployment. Native ETH is still required for approvals, swaps and claims, through Alchemy RPC on the selected public network.

The release proof is a local faucet → stake → bad-node slash → settlement → honest earnings claim → TOD/test-USDC swap → reverse-swap path with exact receipt and balance assertions. It exercises the shared exact trainer, two independent replays and validation merge in one process; autonomous services, the coordinator driver and web-wallet screens remain separate integration acceptance. Public deployment and spending from funded keys remain separately authorized actions.

## Run the full local funding and conversion rehearsal

```sh
export PATH="$HOME/.foundry/bin:$PATH"
uv sync --locked --all-packages
uv run pytest packages/core/tests/ledger_test.py::test_faucet_to_stake_settlement_claim_and_withdrawal -q -s
```

The test starts and stops its own Anvil, deploys the real protocol contracts and faucet, and uses a local-only MockUSDC fixture as the exchange quote asset. It trains the shared MLP on a canonical synthetic two-class dataset, derives both verifier reports through independent replay, and commits the agreed model hash to settlement. After settlement and stake withdrawal, an honest owner converts only their earned TOD to test USDC and back. It checks exact balances, a real settlement receipt, consumed approvals, reserve exhaustion, expired swaps, unchanged token supply and refusal to broadcast invalid requests. A fixed-rate exchange needs no simulated AMM price or implicit slippage allowance.

For an already deployed test desk, run these commands from the repository root with its public address and your private network TOML. `WALLET_PRIVATE_KEY` is supplied at runtime; `status` needs only a public `--account`:

```sh
uv run python scripts/exchange.py status --network PRIVATE_NETWORK.toml --exchange DESK_ADDRESS --account WALLET_ADDRESS
uv run python scripts/exchange.py approve --network PRIVATE_NETWORK.toml --exchange DESK_ADDRESS --asset tod --amount 1.000001
uv run python scripts/exchange.py swap --network PRIVATE_NETWORK.toml --exchange DESK_ADDRESS --asset tod --amount 1.000001 --min-out 1.000001
uv run python scripts/exchange.py approve --network PRIVATE_NETWORK.toml --exchange DESK_ADDRESS --asset usdc --amount 1.000001
uv run python scripts/exchange.py swap --network PRIVATE_NETWORK.toml --exchange DESK_ADDRESS --asset usdc --amount 1.000001 --min-out 1.000001
```

The default deadline is five minutes after the latest chain timestamp. Pass an explicit Unix `--deadline` to shorten it. Clear a remaining allowance using `approve --amount 0` before replacing it. Each public-chain write shows the actual asset address, amount, counterparty, gas bound and sender, then requires `send`. Approvals and swaps are separate transactions: if a swap fails or expires, the approval can remain and should be revoked if no retry is intended.

Deployment uses `scripts/exchange.py deploy --network PRIVATE_NETWORK.toml --out runs/exchange.json`; on Anvil only, pass the local fixture's `--usdc` address. The public path accepts only Circle's documented Base Sepolia address. Seed TOD with the authorized `fund.py DESK_ADDRESS --tokens AMOUNT --eth 0` command, and test USDC with `exchange.py seed --exchange DESK_ADDRESS --asset usdc --amount AMOUNT`. The latter transfers existing tokens from the caller's wallet and grants no withdrawal rights. No public transaction is performed by the automated local test.

## Public-token verification gate

Before selecting a Base Sepolia deployment bundle, configure `BASE_SEPOLIA_RPC_URL` privately with the intended Alchemy endpoint and set `BASE_SEPOLIA_FORK_BLOCK` to an explicit positive block number that the endpoint can serve. The fork test reads Circle's deployed code and token metadata at that block, then tests actual proxy/token transfer behavior on a local fork. Cheatcode test funding modifies only the local fork; it never requests Circle tokens or sends a transaction to Base Sepolia.

```sh
test -n "$BASE_SEPOLIA_RPC_URL"
test "$BASE_SEPOLIA_FORK_BLOCK" -gt 0
forge test --root contracts --match-contract ToDTestExchangeForkTest -vv
```

If either setting is missing, the general contract suite deliberately reports this one test as skipped. A skipped fork test is not public-token compatibility evidence. Record the block number and successful result before public deployment; an endpoint that cannot serve historical state must be corrected rather than silently using the current head.

## Security review

The exchange has no mutable price, privileged withdrawal or issuance path. Asset movement is atomic, both received amounts are checked, and the fixed positive minimum/deadline remain part of the signed transaction. Its stateful invariant conserves each token separately and compares both desk inventories with cumulative successful flows. Full-domain fuzzing includes the smallest unit and uint256-scale transfers. Transfer-fee tests verify complete rollback in both directions.

Slither's new-contract finding is the expected low-severity timestamp comparison for expiry. The deadline limits transaction lifetime; timestamps are not used for pricing or randomness. Existing whole-project findings and transient-guard modelling limitations remain separate from this test-only change. Public deployment is not approved by these local checks.

The Circle round-trip fork check passed through Alchemy at Base Sepolia block `55081277` on 6 November 2026. This used local fork balances and sent no public transaction. Keep the pinned block, result and tested source revision together, and rerun after exchange changes. See the [deployment runbook](BASE_SEPOLIA_RUNBOOK.md) for public funding, deployment and receipt requirements.
