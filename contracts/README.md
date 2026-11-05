# Contract foundation

`INodeRegistry` defines owner/operator admission, stake and round participation. `IJobMarket` defines funded jobs, training rounds, verifier reports, settlement and claims. This foundation contains interfaces and pure hashing helpers; the registry and market implementations follow separately.

Build and run the interface checks from a fresh checkout:

```sh
git submodule update --init --recursive
cd contracts
forge build
forge test
```

The build pins Solidity 0.8.38, the Cancun EVM target, optimization and the IR pipeline. Dependencies are pinned in the submodule entries and `foundry.lock`: forge-std v1.17.0 and OpenZeppelin Contracts v5.6.1. OpenZeppelin is available for the registry and market implementations.

Struct field types and order in the interfaces are the ABI contract for Python and TypeScript consumers. Do not reorder fields when constructing tuple arguments. Token amounts use six-decimal base units; times and durations use seconds. The token address is deployment configuration, not an address built into these interfaces.

`Kind` increases in severity from `None` through `ReplayDrift`, `DataUnavailable` and `ReplayMismatch`. Threshold-confirmed disagreements select the mildest reported failure. `Outcome` is `Accepted = 0` or `Reverted = 1`.

## Hash inputs

`Encodings` uses Ethereum Keccak-256. Unless specified otherwise, hash inputs use standard Solidity `abi.encode`, including padding and dynamic-array offsets. Python consumers must use matching ABI types, not concatenated text or NIST SHA3-256.

| Helper | Ordered hash inputs and ABI types |
|---|---|
| `domain` | `uint256 chainId`, `address market` |
| `checkpointRoot` | Packed concatenation of the `bytes32` checkpoint hashes, with no array length or offset |
| `commitHash` | `bytes32 dom`, `uint256 jobId`, `uint256 roundId`, `address operator`, `bytes32 root`, `bytes32 salt` |
| `taskSeed` | `bytes32 dom`, `uint256 jobId`, `uint256 roundId`, `uint256 shard`, `bytes32 startWeightsHash` |
| `roundSeed` | `bytes32 blockHash`, `bytes32 dom`, `uint256 jobId`, `uint256 roundId` |
| `inviteHash` | `bytes32 INVITE_TYPEHASH`, `address operator`, `address owner`, `bytes32 nullifier`, `uint64 deadline` |
| `consentHash` | `bytes32 CONSENT_TYPEHASH`, `address owner`, `address operator`, `uint64 consentDeadline` |
| `finalizeRoundHash` | `bytes32 FINALIZE_ROUND_TYPEHASH`, `uint256 jobId`, `uint256 roundId`, `uint8 outcome`, `bytes32 aggregateHash`, `uint32 flaggedBitmap`, `bytes32 aggEvidenceHash`, `bytes32 payEvidenceHash`, `bytes32 payoutsHash` |

`payoutsHash` is `keccak256(abi.encode(payouts))`, where payouts have type `(address operator, uint256 amount)[]`. Array order affects the hash. Accepted settlements require ascending operator addresses; reverted settlements contain no payouts.

The type hashes are Keccak-256 of these exact UTF-8 strings:

```text
Invite(address operator,address owner,bytes32 nullifier,uint64 deadline)
Consent(address owner,address operator,uint64 consentDeadline)
FinalizeRound(uint256 jobId,uint256 roundId,uint8 outcome,bytes32 aggregateHash,uint32 flaggedBitmap,bytes32 aggEvidenceHash,bytes32 payEvidenceHash,bytes32 payoutsHash)
```

`inviteHash`, `consentHash` and `finalizeRoundHash` return EIP-712 struct hashes. Signers still need the EIP-712 domain separator and final digest envelope; the `domain(chainId, market)` helper is a separate commitment domain and must not be substituted for that separator. Signature recovery and domain construction belong to the contract implementations and signing clients.
