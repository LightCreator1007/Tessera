// Hashes commitments, seeds and typed admission and settlement messages.
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IJobMarket} from "./IJobMarket.sol";

library Encodings {
    bytes32 internal constant INVITE_TYPEHASH =
        keccak256("Invite(address operator,address owner,bytes32 nullifier,uint64 deadline)");
    bytes32 internal constant CONSENT_TYPEHASH =
        keccak256("Consent(address owner,address operator,uint64 consentDeadline)");
    bytes32 internal constant FINALIZE_ROUND_TYPEHASH = keccak256(
        "FinalizeRound(uint256 jobId,uint256 roundId,uint8 outcome,bytes32 aggregateHash,uint32 flaggedBitmap,"
        "bytes32 aggEvidenceHash,bytes32 payEvidenceHash,bytes32 payoutsHash)"
    );

    function domain(uint256 chainId, address market) internal pure returns (bytes32) {
        return keccak256(abi.encode(chainId, market));
    }

    function checkpointRoot(bytes32[] memory hs) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(hs));
    }

    function commitHash(bytes32 dom, uint256 jobId, uint256 roundId, address operator, bytes32 root, bytes32 salt)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(dom, jobId, roundId, operator, root, salt));
    }

    function taskSeed(bytes32 dom, uint256 jobId, uint256 roundId, uint256 shard, bytes32 startWeightsHash)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(dom, jobId, roundId, shard, startWeightsHash));
    }

    function roundSeed(bytes32 blockHash, bytes32 dom, uint256 jobId, uint256 roundId) internal pure returns (bytes32) {
        return keccak256(abi.encode(blockHash, dom, jobId, roundId));
    }

    function inviteHash(address operator, address owner, bytes32 nullifier, uint64 deadline)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(INVITE_TYPEHASH, operator, owner, nullifier, deadline));
    }

    function consentHash(address owner, address operator, uint64 consentDeadline) internal pure returns (bytes32) {
        return keccak256(abi.encode(CONSENT_TYPEHASH, owner, operator, consentDeadline));
    }

    function finalizeRoundHash(uint256 jobId, uint256 roundId, IJobMarket.Settlement memory s)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                FINALIZE_ROUND_TYPEHASH,
                jobId,
                roundId,
                uint8(s.outcome),
                s.aggregateHash,
                s.flaggedBitmap,
                s.aggEvidenceHash,
                s.payEvidenceHash,
                keccak256(abi.encode(s.payouts))
            )
        );
    }
}
