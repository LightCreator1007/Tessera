# ToD test-token case report

Status: proposed for the testnet MVP. Team acknowledgement is required before merging the token change or selecting a public deployment bundle.

## Decision

Use a standard six-decimal ERC-20 named **ToD Test Token**, symbol **TOD**, with a fixed supply cap and permissioned minting. Keep the existing NodeRegistry and JobMarket staking, verifier, slashing, probation, payout and withdrawal rules. Continue using Base Sepolia through Alchemy; ETH pays transaction gas.

This replaces the demo asset and its issuance controls. It does not create a new consensus network or a dollar-backed currency. The initial demo cap is one million TOD, expressed as `1000000000000` base units. It is an operational limit, not a valuation or reward guarantee, and remains subject to team acknowledgement.

## Why this fits

The current registry and market accept an ERC-20 address at construction. Their public interfaces and six-decimal arithmetic already support TOD. A new token can therefore be selected without changing settlement signatures, workload hashes, coordinator payloads or node commit/reveal behavior. A separate token adds one concrete responsibility: controlling issuance.

The MVP already requires a named test asset and funded demo accounts. A restricted funding command replaces open mock minting. The cap makes the maximum circulating supply explicit, and revocable minter authority bounds which key can issue it. Free test allocations demonstrate mechanics; they do not establish the economic security of a valuable stake.

The token addresses are immutable in both existing contracts. An already deployed bundle cannot switch token in place. Deploy a fresh token, registry and market, then publish one matching address/ABI/deployment-block bundle. Existing balances stay with the old bundle until eligible withdrawal; they are not moved automatically.

## Why Uniswap is outside this MVP

Minting, funding jobs, staking, slashing and claiming need only the token and existing contracts. A DEX becomes relevant when users want to trade TOD for another asset. That would require an actual funded pool, token approvals, execution bounds and a pricing/liquidity policy. It introduces price impact and market risk without helping the training demonstration. See [Uniswap swaps](https://developers.uniswap.org/docs/get-started/concepts/traders/swaps).

A fixed TOD-to-USDC redemption promise would instead need a separate funded reserve and redemption rules. Minting TOD does not create that reserve. No swap, redemption rate or dollar value is promised. Even Circle testnet USDC has no financial value: [Circle network distinction](https://developers.circle.com/stablecoins/usdc-contract-addresses).

## Funding and wallet flow

An authorized operator funds role wallets with test ETH, then uses the configured faucet/minter to distribute TOD within the remaining cap. Requesters approve JobMarket and deposit TOD as job budget. Owners approve NodeRegistry and deposit TOD as stake. Settlement credits eligible owner earnings; owners call claim or withdraw stake under the existing rules. The faucet does not replenish a slash automatically.

The web experience can show wallet TOD, staked TOD and claimable TOD with the appropriate wallet signatures. Owners keep their own wallets. Node operator keys remain separate and local. An embedded wallet, account recovery vendor and gas sponsorship are later decisions; Alchemy RPC does not determine custody.

## CROPS review

| Property | Chosen default and accepted compromise | User exit |
|---|---|---|
| Censorship resistance | The team controls mint allocation; coordinator/verifier availability can still delay settlement. Alchemy is the selected hosted RPC. Token admin has no token pause or blacklist method. | Existing holders can use another RPC and direct contract calls. Eligibility conditions still apply to stake withdrawal and claims. Unsettled work still needs required protocol actions. |
| Open source and free | Token source, tests and scripts remain in the repository under its MIT licence; pinned OpenZeppelin dependencies retain their notices. No hosted exchange is required. | Rebuild and run a separate instance from source with fresh configuration. |
| Privacy | Transfers, stake, claims and role changes are public. RPC providers can observe request metadata. Linking an owner and operator is part of registration. | Keep keys local and use an independently chosen RPC. This design makes no private-payments claim. |
| Security | An explicit admin grants/revokes minters; a hot faucet can issue only up to the immutable global cap. Admin cannot raise the cap, upgrade token code, seize balances or change existing escrow rules. Admin compromise can still allocate the remaining supply. | Admin can revoke a compromised minter. Holders retain ordinary transfer rights and existing eligible contract exits; token value and guaranteed redemption are not provided. |

For testnet a designated role wallet can be admin. A valuable production deployment needs a separately approved treasury/authority policy, preferably a threshold account; this report is not that approval.

## Scope and evidence

The change is limited to token source/tests, deployment inputs, funding units/permissions, token metadata and operator documentation. Existing mock-token fixtures may remain for focused contract tests. Main integration tests must also run with the real ToDToken implementation.

The acceptance evidence is a capped issuance test, unauthorized/revoked-minter tests, fuzzed cap boundaries, stateful supply/balance conservation, and the existing stake/job/claim/slash scenarios using TOD. No public deployment or funded-key operation is authorized by opening the implementation PRs.

Technology: Solidity 0.8.38, Cancun target, the pinned OpenZeppelin Contracts v5.6.1 ERC20/ERC20Capped/AccessControl components, Foundry unit/fuzz/invariant testing, Python 3.12+ with web3.py and exact Decimal conversion, and the existing transaction journal and ABI generators. References: [ERC-20](https://docs.openzeppelin.com/contracts/5.x/erc20), [access control](https://docs.openzeppelin.com/contracts/5.x/access-control), [extensions](https://docs.openzeppelin.com/contracts/5.x/api/token/erc20).
