# ToD test-token specification

## Token contract

`ToDToken` is a non-upgradeable ERC-20 with name `ToD Test Token`, symbol `TOD` and six decimals. One TOD is `1000000` base units. It inherits the pinned OpenZeppelin ERC20, ERC20Capped and AccessControl implementations.

Constructor: `ToDToken(address admin, address minter, uint256 cap)`. Admin and minter must be nonzero; cap must be positive. Initial supply is zero. The cap is immutable. The demo configuration selects `1000000000000` base units. No constructor funds are accepted.

The constructor grants DEFAULT_ADMIN_ROLE to admin and MINTER_ROLE to minter. Only MINTER_ROLE may call `mint(address to, uint256 amount)`. The admin may grant/revoke minters through AccessControl; the faucet cannot grant itself authority unless it was separately made admin. Issuance beyond the cap reverts atomically. Ordinary holders cannot mint. ERC-20 transfer, approval and zero-address rules remain standard.

There is no transfer tax, rebase, token-level burn, pause, blacklist, wallet seizure, price oracle, swap, redemption, proxy or cap-increase function. Slashing still removes deposited registry stake and routes it through existing JobMarket accounting. The market's `burned` counter describes locked funds, not a reduction in token totalSupply.

## Deployment configuration

`[token].cap` is a positive integer in six-decimal base units. `[roles].tokenAdmin` is the intended admin address. `[roles].faucet` is the initial minter. Public roles must be filled with matching fresh addresses before any transaction; secrets are supplied at runtime. Local deterministic fixture addresses are test-only.

Deployment creates ToDToken, NodeRegistry and JobMarket, sets the registry's market once, and writes token/registry/market/deployBlock together. The gas plan estimates the actual ToDToken constructor. Token admin and minter roles are checked against the written configuration. Role authority does not depend on whichever key happens to invoke a later funding command.

The selected network remains explicit. RPC chain mismatch, missing public roles or keys, invalid token cap and insufficient funds must stop before broadcasting. The public gas/top-up prompt remains mandatory unless the caller deliberately supplies `--yes`. Deployment remains a fresh-deployment operation rather than a resumable upgrade.

## Funding command

The funding interface is `python scripts/fund.py ADDRESS... --tokens AMOUNT [--eth AMOUNT]`. Token amounts are decimal TOD, never dollar amounts. Input conversion uses Decimal and integer arithmetic, rejecting negative, nonfinite and unrepresentable fractional amounts. ETH uses eighteen decimal places; TOD uses six. No float rounding is permitted.

Before sending anything, validate all recipient addresses, exact amounts, RPC chain, faucet signer/address, token decimals, minter role and remaining batch mint capacity. If minting is requested, `amount * recipient_count + totalSupply <= cap` must hold. A remaining-cap check is a snapshot: another authorized minter can consume capacity before inclusion, and an onchain mint may still revert. Multi-recipient funding is not an atomic batch and should be reconciled from receipts before retrying.

Public funding prints the token identity, raw/formatted amounts, recipients and estimated gas, then requires `send` unless `--yes` was given. This gate also applies to token-only funding, which consumes supply and gas. Zero-token ETH-only top-ups do not require minter authority. The signer must still match the configured faucet.

Recipients receive minted TOD; ETH comes from the faucet's existing balance. On Anvil, native test balances can be set locally. The funding command cannot grant roles, increase the cap, replenish slashed stake automatically or promise USDC conversion. A role/cap/amount failure is actionable and must not echo secrets.

## Protocol compatibility

Keep INodeRegistry and IJobMarket ABI entries, EIP-712 name/version, settlement digests, workload/dataset commitments, payout equations, probation, quorum and verifier threshold unchanged. `MIN_STAKE = 15e6` means fifteen TOD; it does not imply a dollar valuation.

The Python token adapter exposes standard metadata and the small mint/cap/role view surface used by deployment and funding. Do not commit bulky generated ABIs; produce them using the existing artifact pipeline. The CLI funding flag change from `--usdc` to `--tokens` is an intentional interface change and must be acknowledged by runtime/documentation/UI owners before merging.

## Caller and liveness table

| Action | Caller and authority | Reason to act | If nobody acts |
|---|---|---|---|
| Deploy bundle | Explicitly authorized deployer | Prepare the demo | No new bundle exists |
| Grant/revoke minter | Token admin | Allocate or revoke issuance authority | Current authority persists; existing balances remain transferable |
| Mint starter TOD | Configured faucet with MINTER_ROLE | Team-funded demo onboarding | No new allocations; funded holders can continue |
| Stake or withdraw stake | Registered owner | Participate or exit while eligible | Funds stay in the wallet or registry |
| Fund job | Requester | Buy training work | No funded job starts |
| Submit work/settlement | Existing operator/coordinator/verifier roles | Run the team demo and earn eligible rewards | Existing liveness limitations apply |
| Claim earnings | Owner with claimable balance | Receive accrued TOD | Balance stays claimable in JobMarket |

## Acceptance and acknowledgement

Tests must cover unauthorized and revoked minting, cap-minus-one/cap/cap-plus-one, zero recipient/roles, changed admin/minter roles, arbitrary cap fuzzing, and multi-step mint/transfer conservation. Integration tests must use ToDToken for deployment, stake, job funding, settlement, slash and claim. Token-only funding requires the public send gate. ETH-only funding must work without mint permission.

Arunit owns token and scripts. Shantanu acknowledges settlement/API compatibility; Rounak acknowledges runtime, roles and funding CLI; Dhairya acknowledges numerical/workload commitments and documentation; Ashutosh acknowledges token units and wallet/balance UI labels. Record actual replies/reviews linked to this proposal. A review request is not an acknowledgement. Keep implementation in draft until all four have acknowledged; any objection reopens the affected decision.
