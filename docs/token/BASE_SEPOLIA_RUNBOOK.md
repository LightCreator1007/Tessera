# Base Sepolia deployment and redemption

The five contracts are ToDToken, NodeRegistry, JobMarket, ToDFaucet and ToDTestExchange. Source code and Anvil deployments do not give them a public address. A public deployment bundle exists only after real receipts record their Base Sepolia addresses and deployment blocks. The funding wallet is an EOA that pays for deployment and reserve seeding; it is not the token contract.

Use Base Sepolia, chain 84532, through a private Alchemy RPC. Preserve the agreed six-decimal TOD and existing stake, probation, slashing and settlement rules. The demo token cap is one million TOD; it does not set a market price. No production-money conversion is included.

The approved demo configuration sets `probationSeconds = 0`, so honest work can earn from its first round. Staking and slashing remain enabled, including the 15 TOD minimum stake. The public template retains its explicit 300-second default; set and verify the intended value in the private deployment profile. A minimum redemption amount is a separate exchange policy and does not retain a slashable bond.

## Prepare and verify without sending

Create fresh encrypted deployer/admin/minter/coordinator/verifier wallets outside Git, and retain the agreed identity owner's admitter address. The public template is not a ready deployment configuration. Fill a private copy of it and supply keys only at runtime. Token admin and token minter are separate authorities. The gas funder may be the deployer without becoming the token minter.

Obtain Base Sepolia ETH for gas and Circle test USDC for the reserve. Circle's documented quote-token address is `0x036CbD53842c5426634e7929541eC2318f3dCF7e`; check the [official address list](https://developers.circle.com/stablecoins/usdc-contract-addresses) and onchain code/metadata. The [Circle faucet](https://faucet.circle.com/) distributes test USDC. Its tokens have no financial value. Do not buy or send mainnet assets for this demo.

Run the complete local rehearsal against the exact candidate revision:

```sh
uv sync --locked --all-packages
uv run pytest packages/core/tests/ledger_test.py::test_faucet_to_stake_settlement_claim_and_withdrawal -q -s
```

This uses the actual shared MLP trainer and two independent replays in one process, with Anvil transactions for the money path and a local USDC fixture. It does not prove separately launched services or the real Circle token.

Set a private Alchemy endpoint and an explicit positive `BASE_SEPOLIA_FORK_BLOCK` that the endpoint can serve. First check Circle code and `decimals()` at that block, then run:

```sh
forge test --root contracts --match-contract ToDTestExchangeForkTest -vv
python scripts/deploy.py --network /path/to/private-network.toml --dry-run
```

The fork test must pass, not skip. Record the pinned block and result. The dry run sends nothing and reports the live role-funding and three-contract deployment plan. Set native-gas targets only after measuring fees and available test ETH. If the funded wallet is also the deployer, its balance must cover role transfers, their gas and the retained deployment reserve together.

The Circle round-trip fork check passed at Base Sepolia block `55081277`, hash `0x19473b3bb6464080f3f0b889464feb2252b185f6dc7c54642a8b0552b0cbcf27`, on 6 November 2026. It used local fork balances and sent no public transaction. Rerun it after exchange changes and retain the tested source revision with the result.

## Deploy and record evidence

After the candidate tests, role addresses and transaction plan are accepted, deploy the token, registry and market through `scripts/deploy.py`, keeping a fresh private journal. Its normal public confirmation is `deploy`; `--yes` is only for an already authorized rehearsal. The deployer is checked against configuration before any send. An earlier output or receipt checkpoint blocks a blind retry. A failed or interrupted run needs receipt/journal inspection; this is not a resumable deployment engine.

The output TOML records the three addresses and token deployment block. The adjacent `.receipts.json` records native funding receipts, constructor arguments, contract-creation transactions and `setMarket`. The helper attempts Blockscout/Sourcify verification unless disabled, and records real results separately. Verification failure does not undo deployment. Verify the faucet and exchange against their own source/constructor arguments too, and retain those results rather than claiming a Basescan badge from a different verifier.

Deploy ToDFaucet using `scripts/faucet.py deploy` and ToDTestExchange using `scripts/exchange.py deploy`, each with a distinct output JSON bundle. Both use the configured TOD address; the public exchange path accepts only Circle's documented Base Sepolia test-USDC address. Both public commands print the intended operation and live gas bound before requiring `send`.

Read back token name/symbol/decimals, cap, zero initial supply, admin/minter permissions, registry/market bindings, coordinator, verifier threshold, faucet allocation/cooldown and exchange token addresses. Check deployment receipt status and code at every recorded address. Publish only the public address/ABI/role/receipt bundle. Never publish RPC credentials, keys, keystores, passwords or sender journals.

## Fund the faucet and reserve

The recommended faucet allocation is 100 TOD with a 24-hour address cooldown. The authorized minter fills a bounded stock using `fund.py FAUCET_ADDRESS --tokens AMOUNT --eth 0`. The faucet contract holds no mint authority. Users call `claim()` from their wallets and receive stock; insufficient stock or an active cooldown reverts. Native ETH is still needed for gas. Address cooldowns do not prevent a person using multiple wallets to exhaust test inventory.

The exchange has separate TOD and test-USDC reserves. Mint only the agreed test TOD budget to the exchange; transfer existing Circle test USDC from the reserve owner's wallet using `exchange.py seed --asset usdc --amount AMOUNT`. These transfers supply test inventory, not LP shares or a claim against all TOD supply.

The test quote is fixed at **1 TOD for 1 test USDC** in either direction. With 20 test USDC in stock, at most 20 TOD can be redeemed until USDC is refilled or a reverse swap returns USDC. The million-TOD supply cap does not promise million-USDC backing. This is not a market-price discovery mechanism or a real-dollar peg.

## Provider redemption and acceptance

Verified work produces claimable TOD according to the existing market rules. An eligible owner calls `claim()`, receives TOD into their own wallet, and may withdraw idle stake where allowed. To redeem, they approve the exact TOD input to the exchange, then submit a swap with a positive minimum output and deadline. Once confirmed, the same transaction transfers TOD into the desk and test USDC out to the owner's wallet. It either completes both token movements or reverts. It does not redeem automatically merely because a job finishes.

Run an honest round, a wrong-update case and an altered-settlement rejection. Confirm the bad node is unpaid, eligible owners can claim, token scaling matches the UI, and a bounded redemption plus reverse swap produces exact balances. For the full MVP, connect this to the separately running coordinator/node/verifier stack, repeat the demo twice and check restart/retry does not duplicate settlement. Service/UI integration is tracked in #59; the single-process rehearsal alone does not finish that gate.

## Trust and recovery record

- Censorship: the admitter/coordinator/verifiers and Alchemy can block progress; reserve exhaustion blocks conversion. Direct wallet calls remain available for permitted claims, idle withdrawals and funded swaps, but do not replace missing verifier signatures.
- Inspectability: contract source, dependencies, ABI generation and build settings are public and pinned. Save verification results and the tested revision with the deployment bundle.
- Privacy: addresses, amounts and timing are public onchain; Alchemy sees RPC traffic. Only public demo data is used, and credentials stay outside shared bundles.
- Security: the contracts are not upgradeable. Token administration controls capped mint permissions; the faucet and exchange cannot mint or withdraw inventory through an admin. Users retain their wallet keys and choose exact approvals. Slashed accounting and existing exit limits stay unchanged.

Accepted MVP compromises are team-operated services, EOA test-role keys, finite unbacked test-token inventory, and limited recovery for an interrupted deployment. The source is not an independent security audit, and local test results do not establish real-money suitability.
