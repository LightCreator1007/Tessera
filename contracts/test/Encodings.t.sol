// Encodings.sol and OZ ECDSA reproduce every on-chain value and signature in vectors/encodings.json.
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {Encodings} from "../src/Encodings.sol";
import {IJobMarket} from "../src/IJobMarket.sol";

contract EncodingsTest is Test {
    string json;

    function setUp() public {
        json = vm.readFile(string.concat(vm.projectRoot(), "/../vectors/encodings.json"));
    }

    function _p(string memory list, uint256 i, string memory field) internal pure returns (string memory) {
        return string.concat(".", list, "[", vm.toString(i), "]", bytes(field).length > 0 ? "." : "", field);
    }

    function _has(string memory list, uint256 i) internal view returns (bool) {
        return vm.keyExistsJson(json, _p(list, i, ""));
    }

    function _u(string memory path) internal view returns (uint256) {
        return vm.parseJsonUint(json, path);
    }

    function _b(string memory path) internal view returns (bytes32) {
        return vm.parseJsonBytes32(json, path);
    }

    function _a(string memory path) internal view returns (address) {
        return vm.parseJsonAddress(json, path);
    }

    function test_keccakEmpty() public view {
        assertEq(keccak256(""), _b(".keccakEmpty"));
    }

    function test_domain() public view {
        uint256 i;
        for (; _has("domain", i); i++) {
            bytes32 got = Encodings.domain(_u(_p("domain", i, "chainId")), _a(_p("domain", i, "jobMarket")));
            assertEq(got, _b(_p("domain", i, "domain")));
        }
        assertGt(i, 0);
    }

    function test_checkpointRoot() public view {
        uint256 i;
        for (; _has("checkpointRoot", i); i++) {
            bytes32[] memory hs = vm.parseJsonBytes32Array(json, _p("checkpointRoot", i, "hashes"));
            assertEq(Encodings.checkpointRoot(hs), _b(_p("checkpointRoot", i, "root")));
        }
        assertGt(i, 0);
    }

    function test_commitHash() public view {
        uint256 i;
        for (; _has("commitHash", i); i++) {
            bytes32 got = Encodings.commitHash(
                _b(_p("commitHash", i, "domain")),
                _u(_p("commitHash", i, "jobId")),
                _u(_p("commitHash", i, "roundId")),
                _a(_p("commitHash", i, "operator")),
                _b(_p("commitHash", i, "root")),
                _b(_p("commitHash", i, "salt"))
            );
            assertEq(got, _b(_p("commitHash", i, "commitHash")));
        }
        assertGt(i, 0);
    }

    function test_taskSeed() public view {
        uint256 i;
        for (; _has("taskSeed", i); i++) {
            bytes32 got = Encodings.taskSeed(
                _b(_p("taskSeed", i, "domain")),
                _u(_p("taskSeed", i, "jobId")),
                _u(_p("taskSeed", i, "roundId")),
                _u(_p("taskSeed", i, "shard")),
                _b(_p("taskSeed", i, "startWeightsHash"))
            );
            assertEq(got, _b(_p("taskSeed", i, "taskSeed")));
        }
        assertGt(i, 0);
    }

    function test_roundSeed() public view {
        uint256 i;
        for (; _has("roundSeed", i); i++) {
            bytes32 got = Encodings.roundSeed(
                _b(_p("roundSeed", i, "blockhash")),
                _b(_p("roundSeed", i, "domain")),
                _u(_p("roundSeed", i, "jobId")),
                _u(_p("roundSeed", i, "roundId"))
            );
            assertEq(got, _b(_p("roundSeed", i, "seed")));
        }
        assertGt(i, 0);
    }

    function _payouts(string memory base) internal view returns (IJobMarket.Payout[] memory ps) {
        uint256 n;
        while (vm.keyExistsJson(json, string.concat(base, "[", vm.toString(n), "]"))) n++;
        ps = new IJobMarket.Payout[](n);
        for (uint256 j; j < n; j++) {
            string memory e = string.concat(base, "[", vm.toString(j), "]");
            ps[j] = IJobMarket.Payout(_a(string.concat(e, ".operator")), _u(string.concat(e, ".amount")));
        }
    }

    function test_payoutsHash() public view {
        uint256 i;
        for (; _has("payoutsHash", i); i++) {
            IJobMarket.Payout[] memory ps = _payouts(_p("payoutsHash", i, "payouts"));
            assertEq(keccak256(abi.encode(ps)), _b(_p("payoutsHash", i, "hash")));
        }
        assertGt(i, 0);
    }

    function _structHash(uint256 i) internal view returns (bytes32) {
        string memory m = _p("eip712", i, "message.");
        bytes32 t = keccak256(bytes(vm.parseJsonString(json, _p("eip712", i, "primaryType"))));
        if (t == keccak256("Invite")) {
            return Encodings.inviteHash(
                _a(string.concat(m, "operator")),
                _a(string.concat(m, "owner")),
                _b(string.concat(m, "nullifier")),
                uint64(_u(string.concat(m, "deadline")))
            );
        }
        if (t == keccak256("Consent")) {
            return Encodings.consentHash(
                _a(string.concat(m, "owner")),
                _a(string.concat(m, "operator")),
                uint64(_u(string.concat(m, "consentDeadline")))
            );
        }
        if (t == keccak256("FinalizeRound")) {
            IJobMarket.Settlement memory s = IJobMarket.Settlement({
                outcome: IJobMarket.Outcome(_u(string.concat(m, "outcome"))),
                aggregateHash: _b(string.concat(m, "aggregateHash")),
                flaggedBitmap: uint32(_u(string.concat(m, "flaggedBitmap"))),
                aggEvidenceHash: _b(string.concat(m, "aggEvidenceHash")),
                payEvidenceHash: _b(string.concat(m, "payEvidenceHash")),
                payouts: _payouts(_p("eip712", i, "settlement.payouts"))
            });
            assertEq(keccak256(abi.encode(s.payouts)), _b(string.concat(m, "payoutsHash")));
            return Encodings.finalizeRoundHash(_u(string.concat(m, "jobId")), _u(string.concat(m, "roundId")), s);
        }
        // BlobAccess is checked by the coordinator, not on-chain, so its typehash stays in this test.
        assertEq(t, keccak256("BlobAccess"));
        return keccak256(
            abi.encode(
                keccak256("BlobAccess(uint256 jobId,uint256 roundId,bytes32 blobHash,string method,uint256 expiry)"),
                _u(string.concat(m, "jobId")),
                _u(string.concat(m, "roundId")),
                _b(string.concat(m, "blobHash")),
                keccak256(bytes(vm.parseJsonString(json, string.concat(m, "method")))),
                _u(string.concat(m, "expiry"))
            )
        );
    }

    function _domainSeparator(uint256 chainId, address verifyingContract) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("ToD"),
                keccak256("1"),
                chainId,
                verifyingContract
            )
        );
    }

    function test_eip712SignaturesRecover() public view {
        uint256 i;
        for (; _has("eip712", i); i++) {
            bytes32 sh = _structHash(i);
            assertEq(sh, _b(_p("eip712", i, "structHash")), "structHash");
            bytes32 ds = _domainSeparator(_u(_p("eip712", i, "chainId")), _a(_p("eip712", i, "verifyingContract")));
            assertEq(ds, _b(_p("eip712", i, "domainSeparator")), "domainSeparator");
            bytes32 d = MessageHashUtils.toTypedDataHash(ds, sh);
            assertEq(d, _b(_p("eip712", i, "digest")), "digest");
            bytes memory sig = vm.parseJsonBytes(json, _p("eip712", i, "signature"));
            assertEq(ECDSA.recover(d, sig), _a(_p("eip712", i, "signer")), "signer");
        }
        assertGt(i, 0);
    }

    function test_typehashesMatchVectors() public view {
        for (uint256 i; _has("eip712", i); i++) {
            bytes32 t = keccak256(bytes(vm.parseJsonString(json, _p("eip712", i, "primaryType"))));
            bytes32 th = _b(_p("eip712", i, "typeHash"));
            if (t == keccak256("Invite")) assertEq(th, Encodings.INVITE_TYPEHASH);
            if (t == keccak256("Consent")) assertEq(th, Encodings.CONSENT_TYPEHASH);
            if (t == keccak256("FinalizeRound")) assertEq(th, Encodings.FINALIZE_ROUND_TYPEHASH);
        }
    }
}
