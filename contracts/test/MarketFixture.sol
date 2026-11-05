// Shared deploy, pool, job and round helpers for the JobMarket scenario tests.
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {NodeRegistry} from "../src/NodeRegistry.sol";
import {JobMarket} from "../src/JobMarket.sol";
import {Encodings} from "../src/Encodings.sol";
import {IJobMarket} from "../src/IJobMarket.sol";
import {INodeRegistry} from "../src/INodeRegistry.sol";

abstract contract MarketFixture is Test {
    MockUSDC usdc;
    NodeRegistry reg;
    JobMarket market;

    uint256 constant ADMITTER = 0xA11CE;
    uint256 constant VERIFIER_A = 0xA;
    uint256 constant VERIFIER_B = 0xB;
    address coordinator = makeAddr("coordinator");
    address requester = makeAddr("requester");
    uint256 minted;

    uint256 constant N = 4;
    uint256[N] opKey;
    address[N] op;
    address[N] owner;

    uint256 constant BUDGET = 300e6 + 1; // the +1 exercises dust
    uint32 constant ROUNDS = 3;
    uint16 constant K = 4;

    function setUp() public {
        usdc = new MockUSDC();
        reg = new NodeRegistry(address(usdc), vm.addr(ADMITTER), _probation());
        address[] memory vs = new address[](2);
        vs[0] = vm.addr(VERIFIER_A);
        vs[1] = vm.addr(VERIFIER_B);
        market = new JobMarket(address(usdc), address(reg), coordinator, vs, 2);
        reg.setMarket(address(market));
        for (uint256 i; i < N; i++) {
            opKey[i] = 0x1000 + i;
            op[i] = vm.addr(opKey[i]);
            owner[i] = makeAddr(string.concat("owner", vm.toString(i)));
        }
    }

    /// @dev 0 = no probation, so the pay scenarios see owners paid directly; Earnings.t.sol overrides it.
    function _probation() internal pure virtual returns (uint64) {
        return 0;
    }

    function _ds(address c) internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("ToD"),
                keccak256("1"),
                block.chainid,
                c
            )
        );
    }

    function _sig(uint256 key, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _mint(address to, uint256 amount) internal {
        usdc.mint(to, amount);
        minted += amount;
    }

    function _joinSigs(uint256 i, bytes32 nullifier, uint64 deadline)
        internal
        view
        returns (bytes memory invite, bytes memory consent)
    {
        invite = _sig(
            ADMITTER,
            MessageHashUtils.toTypedDataHash(
                _ds(address(reg)), Encodings.inviteHash(op[i], owner[i], nullifier, deadline)
            )
        );
        consent = _sig(
            opKey[i],
            MessageHashUtils.toTypedDataHash(_ds(address(reg)), Encodings.consentHash(owner[i], op[i], deadline))
        );
    }

    function _joinAndStake(uint256 i, uint128 stake) internal {
        bytes32 nullifier = keccak256(abi.encode("human", i));
        uint64 deadline = uint64(block.timestamp + 30 minutes);
        (bytes memory invite, bytes memory consent) = _joinSigs(i, nullifier, deadline);
        vm.prank(owner[i]);
        reg.join(op[i], nullifier, deadline, deadline, invite, consent);
        _mint(owner[i], stake);
        vm.startPrank(owner[i]);
        usdc.approve(address(reg), stake);
        reg.depositStake(op[i], stake);
        vm.stopPrank();
    }

    function _params() internal view returns (IJobMarket.JobParams memory p) {
        p.budget = BUDGET;
        p.rounds = ROUNDS;
        p.segments = K;
        p.minQuorum = 3;
        p.maxPerRound = 6;
        p.shards = 8;
        p.slashOnMismatch = true;
        p.refWorkSecondsPerRound = 2;
        p.windows = IJobMarket.Windows({commit: 45, reveal: 30, verify: 45, finalize: 60, stall: 3600});
        p.stakePerNode = market.minStake(BUDGET, ROUNDS, 3);
        p.workloadId = keccak256("mlp-exact/1");
        p.modelSpecHash = keccak256("spec");
        p.datasetHash = keccak256("dataset");
        p.shardTableHash = keccak256("shards");
        p.initialWeightsHash = keccak256("w0");
        p.specURI = "https://coordinator.example/v1/jobs/1/spec";
    }

    function _createJob() internal returns (uint256 jobId) {
        _mint(requester, BUDGET);
        vm.startPrank(requester);
        usdc.approve(address(market), BUDGET);
        jobId = market.createJob(_params(), 0);
        vm.stopPrank();
    }

    function _ckpts(uint256 jobId, uint256 roundId, uint256 i) internal view returns (bytes32[] memory hs) {
        hs = new bytes32[](K + 1);
        hs[0] = market.getRound(jobId, roundId).startWeightsHash;
        for (uint256 j = 1; j <= K; j++) {
            hs[j] = keccak256(abi.encode(jobId, roundId, i, j));
        }
    }

    function _salt(uint256 roundId, uint256 i) internal pure returns (bytes32) {
        return keccak256(abi.encode("salt", roundId, i));
    }

    function _roster(uint256 n) internal view returns (address[] memory nodes, uint8[] memory shards) {
        nodes = new address[](n);
        shards = new uint8[](n);
        for (uint256 i; i < n; i++) {
            nodes[i] = op[i];
            shards[i] = uint8(i);
        }
    }

    function _commitReveal(uint256 jobId, uint256 roundId, uint256 n) internal {
        for (uint256 i; i < n; i++) {
            bytes32 h = market.commitHashOf(
                jobId, roundId, op[i], Encodings.checkpointRoot(_ckpts(jobId, roundId, i)), _salt(roundId, i)
            );
            vm.prank(op[i]);
            market.commit(jobId, roundId, h);
        }
        assertEq(uint8(market.phase(jobId, roundId)), uint8(IJobMarket.Phase.Reveal), "commit closes early");
        for (uint256 i; i < n; i++) {
            bytes32[] memory hs = _ckpts(jobId, roundId, i);
            vm.prank(op[i]);
            market.reveal(jobId, roundId, hs, _salt(roundId, i));
        }
        assertEq(uint8(market.phase(jobId, roundId)), uint8(IJobMarket.Phase.Verify), "reveal closes early");
    }

    function _seedAndAttest(uint256 jobId, uint256 roundId) internal {
        market.lockSeed(jobId, roundId);
        vm.roll(block.number + 3);
        market.drawSeed(jobId, roundId);
        vm.prank(vm.addr(VERIFIER_A));
        market.attestRound(jobId, roundId, keccak256("reportA"), new IJobMarket.Failure[](0));
        vm.prank(vm.addr(VERIFIER_B));
        market.attestRound(jobId, roundId, keccak256("reportB"), new IJobMarket.Failure[](0));
        assertEq(uint8(market.phase(jobId, roundId)), uint8(IJobMarket.Phase.Finalize), "verify closes early");
    }

    /// @dev Equal split over the first n operators, ascending by address, dust to the lowest.
    function _equalSettlement(uint256 budget, uint256 n, bytes32 agg)
        internal
        view
        returns (IJobMarket.Settlement memory s)
    {
        address[] memory sorted = new address[](n);
        for (uint256 i; i < n; i++) {
            sorted[i] = op[i];
            for (uint256 j = i; j > 0 && uint160(sorted[j]) < uint160(sorted[j - 1]); j--) {
                (sorted[j], sorted[j - 1]) = (sorted[j - 1], sorted[j]);
            }
        }
        s.outcome = IJobMarket.Outcome.Accepted;
        s.aggregateHash = agg;
        s.aggEvidenceHash = keccak256("aggEvidence");
        s.payEvidenceHash = keccak256("payEvidence");
        s.payouts = new IJobMarket.Payout[](n);
        for (uint256 i; i < n; i++) {
            s.payouts[i] = IJobMarket.Payout(sorted[i], budget / n + (i == 0 ? budget % n : 0));
        }
    }

    function _bothSign(uint256 jobId, uint256 roundId, IJobMarket.Settlement memory s)
        internal
        view
        returns (bytes[] memory sigs)
    {
        bytes32 d = market.finalizeDigest(jobId, roundId, s);
        sigs = new bytes[](2);
        sigs[0] = _sig(VERIFIER_A, d);
        sigs[1] = _sig(VERIFIER_B, d);
    }

    function _openRound(uint256 jobId, uint256 n) internal returns (uint256 roundId) {
        (, IJobMarket.JobState memory js) = market.getJob(jobId);
        roundId = js.nextRound;
        (address[] memory nodes, uint8[] memory shards) = _roster(n);
        vm.prank(coordinator);
        market.openRound(jobId, nodes, shards);
    }

    function _assertMoneyConserved() internal view {
        uint256 held = usdc.balanceOf(requester) + usdc.balanceOf(address(reg)) + usdc.balanceOf(address(market));
        for (uint256 i; i < N; i++) {
            held += usdc.balanceOf(owner[i]);
        }
        assertEq(held, minted, "no USDC created or lost");
    }
}
