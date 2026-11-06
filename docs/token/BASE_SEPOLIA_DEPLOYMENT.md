# Confirmed Base Sepolia demo bundle

Chain **84532**, through a private Alchemy endpoint. Source and ABI revision: `39026c2b0f07492dda93193e899fb8095f4fc19d`. The checks below read block **55091953**, hash `0xa6f5c82e4f732d138d96d4e076dc10c01e2687714fff127b4f0caa91ca2d637d`, on 6 November 2026. Use [the public network profile](../../networks/base-sepolia-demo.toml); credentials and signing material are not included.

| Contract | Address | Creation receipt |
|---|---|---|
| ToDToken | [0xfFa825C3C07B2B334D80aa730100c3D9320AE44b](https://base-sepolia.blockscout.com/address/0xfFa825C3C07B2B334D80aa730100c3D9320AE44b) | [Block 55089330](https://base-sepolia.blockscout.com/tx/0x1b934ee9a70a38e46b1a4d45f1e68aeefa90c61f54be339a85ee4f3c88797238) |
| NodeRegistry | [0x09570EEa33b199aC6C5Ce5d6f2934eA6EfFadC34](https://base-sepolia.blockscout.com/address/0x09570EEa33b199aC6C5Ce5d6f2934eA6EfFadC34) | [Block 55089341](https://base-sepolia.blockscout.com/tx/0xfaa288f3820f28a7b2ecd76bf96963479bc3ba1e1176b28085ea8e362ee25596) |
| JobMarket | [0xa4acE0e126B0B3b021f501DDE6a506cafDdA1581](https://base-sepolia.blockscout.com/address/0xa4acE0e126B0B3b021f501DDE6a506cafDdA1581) | [Block 55089355](https://base-sepolia.blockscout.com/tx/0x79714b0d4b24486e4f217337f98d60f5529290b3b941fff1502657dc199bf4ac) |
| ToDFaucet | [0x85359b52D9705F835C57591C7337B0C2e60B55fA](https://base-sepolia.blockscout.com/address/0x85359b52D9705F835C57591C7337B0C2e60B55fA) | [Block 55089693](https://base-sepolia.blockscout.com/tx/0x7546f93016987a1e204dde2d7631d32cc285d203c795d8b81620036a0a22b552) |
| ToDTestExchange | [0xBC202C5B2c239298041f191Bc90cBBC25Ec17Aa8](https://base-sepolia.blockscout.com/address/0xBC202C5B2c239298041f191Bc90cBBC25Ec17Aa8) | [Block 55089775](https://base-sepolia.blockscout.com/tx/0xca3213adea7726f108703f16b32ca05efe1198dee672567ecf23a74539acc26b) |

All five creation receipts have status 1, and code exists at each address. Source verification reports creation and runtime bytecode `match` on Sourcify. The build uses Solidity `0.8.38+commit.1835d247`, Cancun, optimizer 200 runs, via IR and `bytecodeHash = none`; no exact metadata-hash match is claimed. Verification records:
- [ToDToken on Sourcify](https://repo.sourcify.dev/84532/0xfFa825C3C07B2B334D80aa730100c3D9320AE44b)
- [NodeRegistry on Sourcify](https://repo.sourcify.dev/84532/0x09570EEa33b199aC6C5Ce5d6f2934eA6EfFadC34)
- [JobMarket on Sourcify](https://repo.sourcify.dev/84532/0xa4acE0e126B0B3b021f501DDE6a506cafDdA1581)
- [ToDFaucet on Sourcify](https://repo.sourcify.dev/84532/0x85359b52D9705F835C57591C7337B0C2e60B55fA)
- [ToDTestExchange on Sourcify](https://repo.sourcify.dev/84532/0xBC202C5B2c239298041f191Bc90cBBC25Ec17Aa8)

The registry is bound to the market: [confirmed setMarket receipt](https://base-sepolia.blockscout.com/tx/0xdfd6536c217b265dd8435f48abe34894d8e14d33a4e1bc6d453ca5d425cfe44c). Onchain reads confirm the configured admitter, coordinator, two distinct verifiers and threshold 2. Public role addresses are in the network profile. Token administration and minting use separate EOAs. `roles.faucet` is the authorized minter EOA; `contracts.faucet` is the prefunded claim contract and has no mint authority. The exchange has no mint authority either.

## Deployed policy

- TOD has six decimals, a one-million-TOD cap and 1,100 TOD issued for this demo. It is a test token with no financial value.
- Probation is **zero**. Existing stake, slashing, settlement and claim interfaces remain in place.
- The faucet gives **100 TOD per wallet per 24 hours**, while stock remains. Users still need native test ETH for gas.
- Each TOD → test-USDC redemption requires at least **10 TOD**. A 9.999999 TOD eth_call was rejected by the deployed contract before token movement. This is a transaction minimum, not a retained balance.
- The artificial test quote is **1 TOD = 1 test USDC**, with no fee. Reverse swaps accept any positive amount. The exchange holds a finite **20 test USDC** reserve; the supply cap does not promise backing for every TOD.
- Owners keep their wallets and make exact approvals. No custodial platform wallet, DEX pool, real-money conversion or global onchain ban is provided.

## Confirmed public funding and conversion

| Operation | Confirmed receipt |
|---|---|
| Seed exactly 20 Circle test USDC | [Block 55090094](https://base-sepolia.blockscout.com/tx/0x7b97698028c2887a89ca176bf12f9f6df329e9947ddc582990d9f72e00991253) |
| Claim 100 TOD from the prefunded faucet | [Block 55090332](https://base-sepolia.blockscout.com/tx/0xc38b31babd700b4d09f439af0fe3bee493c8122594c0f19abb493311809e8d02) |
| Approve exactly 10 TOD | [Block 55090650](https://base-sepolia.blockscout.com/tx/0x82e4a6d0e3b820cc2539c9a0ad76149e406e9c4a9cb55c49000e11cb2c211e9c) |
| Redeem 10 TOD for 10 test USDC | [Block 55090891](https://base-sepolia.blockscout.com/tx/0x27b941c2df32578bfea79b138049f4bfdcf6c6a6a14b1092fd7fa732f45d3ab4) |
| Approve exactly 10 test USDC | [Block 55091127](https://base-sepolia.blockscout.com/tx/0x88aa7f338dd02015f3fc1cc8cef6231249edca5e6799bee8a254373b550bf6e4) |
| Swap 10 test USDC back for 10 TOD | [Block 55091287](https://base-sepolia.blockscout.com/tx/0xff8e151d3cd0fd4570753d863892f89b428cead31a9702b8b29679ccad018d3e) |

Every listed receipt has status 1. After the round trip, the exchange holds **100 TOD and 20 test USDC**, the faucet holds **900 TOD**, and the claimant holds **100 TOD**. Both swap allowances are zero. Total TOD supply remains 1,100; no USDC was minted by ToD. The same 20 test USDC can be reused for rehearsals through reverse swaps. Without a refill or reverse swap, two 10 TOD redemptions exhaust it. Balances above are an observed snapshot; clients must read current inventory.

## Use the deployed contracts

Supply `BASE_SEPOLIA_RPC_URL` through private runtime configuration and your own wallet signer only when sending. These status calls need no private key:

```sh
uv run python scripts/faucet.py status --network base-sepolia-demo --faucet 0x85359b52D9705F835C57591C7337B0C2e60B55fA
uv run python scripts/exchange.py status --network base-sepolia-demo --exchange 0xBC202C5B2c239298041f191Bc90cBBC25Ec17Aa8
```

To claim, call `faucet.py claim` with the same network/faucet flags. For a redemption, use `exchange.py approve --asset tod --amount 10`, then `exchange.py swap --asset tod --amount 10 --min-out 10`, with the same network/exchange flags. Public writes show the plan and require `send`. Pending transactions must not be presented as confirmed. Clear an unused approval before replacing it.

## Remaining MVP acceptance

This public smoke test used faucet TOD. It does not prove provider earnings from a public training job. The market had zero jobs at the recorded snapshot. The local exact-MLP rehearsal does prove training, two independent replays, a bad-node slash, settlement, earned-TOD claim and conversion using only 20 test USDC. The tested deployment revision passes 295 Python and 90 contract tests; the separate Circle fork passed at pinned block 55081277.

The remaining shared gate is [#59](https://github.com/LightCreator1007/ToD/issues/59): connect the separately running coordinator, nodes, verifiers and wallet/UI to this bundle; complete real training-to-settlement/claim/redemption twice; check restart/retry and matching UI amounts. [#71](https://github.com/LightCreator1007/ToD/issues/71) tracks operational repeat-cheater exclusion. These are not claimed complete by this deployment. The contracts have no independent production audit.
