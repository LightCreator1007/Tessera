// no-reveal escalation, seed relock, void, fallback, abandon, refund, clean-seat leftover, fuzzed money sums.
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Encodings} from "../src/Encodings.sol";
import {IJobMarket} from "../src/IJobMarket.sol";
import {MarketFixture} from "./MarketFixture.sol";

contract LivenessTest is MarketFixture {
    function _job(IJobMarket.JobParams memory p, uint256 nodes) internal returns (uint256 jobId) {
        for (uint256 i; i < nodes; i++) {
            _joinAndStake(i, p.stakePerNode);
        }
        _mint(requester, p.budget);
        vm.startPrank(requester);
        usdc.approve(address(market), p.budget);
        jobId = market.createJob(p, 0);
        vm.stopPrank();
    }

    function _commit(uint256 jobId, uint256 roundId, uint256 i) internal {
        bytes32 h = market.commitHashOf(
            jobId, roundId, op[i], Encodings.checkpointRoot(_ckpts(jobId, roundId, i)), _salt(roundId, i)
        );
        vm.prank(op[i]);
        market.commit(jobId, roundId, h);
    }

    function _reveal(uint256 jobId, uint256 roundId, uint256 i) internal {
        bytes32[] memory hs = _ckpts(jobId, roundId, i);
        vm.prank(op[i]);
        market.reveal(jobId, roundId, hs, _salt(roundId, i));
    }

    function _acceptRound(uint256 jobId) internal {
        uint256 roundId = _openRound(jobId, 3);
        _commitReveal(jobId, roundId, 3);
        _seedAndAttest(jobId, roundId);
        IJobMarket.Settlement memory s = _equalSettlement(market.getRound(jobId, roundId).budget, 3, keccak256("G"));
        bytes[] memory sigs = _bothSign(jobId, roundId, s);
        market.finalizeRound(jobId, roundId, s, sigs);
    }

    function _assertAllIdle(uint256 n) internal view {
        for (uint256 i; i < n; i++) {
            assertTrue(reg.isIdle(op[i]), "freed");
        }
    }

    function test_noRevealEscalatesPerJob() public {
        IJobMarket.JobParams memory p = _params();
        p.budget = 30e6;
        p.stakePerNode = market.minStake(p.budget, p.rounds, p.minQuorum);
        assertEq(p.stakePerNode, 15e6, "G15 floor");
        uint256 jobId = _job(p, 4);
        // Shantanu's 15 USDC table: 0.15, 1.5, then 7.5 USDC.
        uint256[3] memory penalty = [uint256(150_000), 1_500_000, 7_500_000];

        for (uint256 r; r < 3; r++) {
            (address[] memory nodes, uint8[] memory shards) = _roster(4);
            vm.prank(coordinator);
            market.openRound(jobId, nodes, shards);
            uint256 roundId = r + 1;
            for (uint256 i; i < 3; i++) {
                _commit(jobId, roundId, i);
            }
            vm.expectRevert(IJobMarket.WrongState.selector);
            market.reportNoReveal(jobId, roundId, op[3]);
            vm.warp(market.getRound(jobId, roundId).commitDeadline + 1);
            for (uint256 i; i < 3; i++) {
                _reveal(jobId, roundId, i);
            }
            uint128 before = reg.getNode(op[3]).stake;
            market.reportNoReveal(jobId, roundId, op[3]);
            assertEq(before - reg.getNode(op[3]).stake, penalty[r]);
            assertEq(market.missedReveals(jobId, op[3]), r + 1);
            vm.expectRevert(IJobMarket.AlreadyReported.selector);
            market.reportNoReveal(jobId, roundId, op[3]);
            vm.expectRevert(IJobMarket.BadInput.selector);
            market.reportNoReveal(jobId, roundId, op[0]);

            _seedAndAttest(jobId, roundId);
            IJobMarket.Settlement memory s = _equalSettlement(market.getRound(jobId, roundId).budget, 3, keccak256("G"));
            bytes[] memory sigs = _bothSign(jobId, roundId, s);
            market.finalizeRound(jobId, roundId, s, sigs);
            _assertAllIdle(4);

            uint128 topUp = p.stakePerNode - reg.getNode(op[3]).stake;
            _mint(owner[3], topUp);
            vm.startPrank(owner[3]);
            usdc.approve(address(reg), topUp);
            reg.depositStake(op[3], topUp);
            vm.stopPrank();
        }
        _assertMoneyConserved();
    }

    /// @dev Audit a no-reveal reported after the verifiers signed must not change budget_r.
    function test_lateNoRevealKeepsSignedSettlementValid() public {
        uint256 jobId = _job(_params(), 4);
        (address[] memory nodes, uint8[] memory shards) = _roster(4);
        vm.prank(coordinator);
        market.openRound(jobId, nodes, shards);
        for (uint256 i; i < 3; i++) {
            _commit(jobId, 1, i);
        }
        vm.warp(market.getRound(jobId, 1).commitDeadline + 1);
        for (uint256 i; i < 3; i++) {
            _reveal(jobId, 1, i);
        }
        _seedAndAttest(jobId, 1);
        IJobMarket.Settlement memory s = _equalSettlement(market.getRound(jobId, 1).budget, 3, keccak256("G"));
        bytes[] memory sigs = _bothSign(jobId, 1, s);
        (, IJobMarket.JobState memory before) = market.getJob(jobId);

        uint128 stakeBefore = reg.getNode(op[3]).stake;
        market.reportNoReveal(jobId, 1, op[3]);
        uint256 taken = stakeBefore - reg.getNode(op[3]).stake;
        market.finalizeRound(jobId, 1, s, sigs);

        (, IJobMarket.JobState memory js) = market.getJob(jobId);
        assertEq(js.remaining, before.remaining + taken / 2, "penalty pot goes to the job");
        _assertMoneyConserved();
    }

    function test_seedRelockAfterLostBlockhash() public {
        uint256 jobId = _job(_params(), 3);
        uint256 roundId = _openRound(jobId, 3);
        _commitReveal(jobId, roundId, 3);
        market.lockSeed(jobId, roundId);
        vm.expectRevert(IJobMarket.WrongState.selector);
        market.lockSeed(jobId, roundId);
        vm.expectRevert(IJobMarket.TooEarly.selector);
        market.drawSeed(jobId, roundId);
        vm.roll(block.number + 300);
        vm.expectRevert(IJobMarket.TooLate.selector);
        market.drawSeed(jobId, roundId);

        market.lockSeed(jobId, roundId);
        vm.roll(block.number + 3);
        market.drawSeed(jobId, roundId);
        assertTrue(market.getRound(jobId, roundId).seed != 0);
        vm.prank(vm.addr(VERIFIER_A));
        market.attestRound(jobId, roundId, bytes32(0), new IJobMarket.Failure[](0));
        vm.prank(vm.addr(VERIFIER_B));
        market.attestRound(jobId, roundId, bytes32(0), new IJobMarket.Failure[](0));
        IJobMarket.Settlement memory s = _equalSettlement(market.getRound(jobId, roundId).budget, 3, keccak256("G"));
        bytes[] memory sigs = _bothSign(jobId, roundId, s);
        market.finalizeRound(jobId, roundId, s, sigs);
        assertEq(uint8(market.phase(jobId, roundId)), uint8(IJobMarket.Phase.Settled));
    }

    function test_voidBelowQuorumKeepsMoneyAndRejectsResubmission() public {
        uint256 jobId = _job(_params(), 3);
        uint256 roundId = _openRound(jobId, 3);
        _commit(jobId, roundId, 0);
        _commit(jobId, roundId, 1);
        bytes32 oldCommit = market.getNodeRound(jobId, roundId, op[0]).commitHash;
        vm.warp(market.getRound(jobId, roundId).commitDeadline + 1);
        _reveal(jobId, roundId, 0);
        _reveal(jobId, roundId, 1);

        vm.expectRevert(IJobMarket.QuorumNotMet.selector);
        market.lockSeed(jobId, roundId);
        market.voidRound(jobId, roundId);
        assertEq(uint8(market.phase(jobId, roundId)), uint8(IJobMarket.Phase.Void));
        _assertAllIdle(3);
        (, IJobMarket.JobState memory js) = market.getJob(jobId);
        assertEq(js.remaining, BUDGET, "void money stays in the job");

        // Commitments bind the round id, so round 1's commitment can't be revealed in round 2.
        uint256 next = _openRound(jobId, 3);
        assertEq(market.getRound(jobId, next).startWeightsHash, keccak256("w0"));
        assertEq(market.getRound(jobId, next).budget, BUDGET / 2);
        vm.prank(op[0]);
        market.commit(jobId, next, oldCommit);
        for (uint256 i = 1; i < 3; i++) {
            _commit(jobId, next, i);
        }
        bytes32[] memory hs = _ckpts(jobId, roundId, 0);
        vm.prank(op[0]);
        vm.expectRevert(IJobMarket.BadInput.selector);
        market.reveal(jobId, next, hs, _salt(roundId, 0));
        _assertMoneyConserved();
    }

    function test_voidNeedsRevealClosedAndNoQuorum() public {
        uint256 jobId = _job(_params(), 3);
        uint256 roundId = _openRound(jobId, 3);
        vm.expectRevert(IJobMarket.WrongState.selector);
        market.voidRound(jobId, roundId);
        _commitReveal(jobId, roundId, 3);
        vm.expectRevert(IJobMarket.WrongState.selector);
        market.voidRound(jobId, roundId);
    }

    function test_silentCoordinatorFallbackThenAbandonAndRefund() public {
        uint256 jobId = _job(_params(), 3);
        uint256 roundId = _openRound(jobId, 3);
        _commitReveal(jobId, roundId, 3);
        _seedAndAttest(jobId, roundId);
        vm.expectRevert(IJobMarket.TooEarly.selector);
        market.finalizeFallback(jobId, roundId);

        uint256 budget = market.getRound(jobId, roundId).budget;
        vm.warp(market.getRound(jobId, roundId).finalizeBy + 1);
        market.finalizeFallback(jobId, roundId);
        IJobMarket.Round memory r = market.getRound(jobId, roundId);
        assertTrue(r.fallback_);
        assertEq(r.aggregateHash, r.startWeightsHash, "model unchanged");
        _assertAllIdle(3);
        uint256 paid;
        for (uint256 i; i < 3; i++) {
            assertApproxEqAbs(market.claimable(owner[i]), budget / 3, budget % 3);
            paid += market.claimable(owner[i]);
        }
        assertEq(paid, budget);

        vm.expectRevert(IJobMarket.TooEarly.selector);
        market.abandonJob(jobId);
        vm.warp(block.timestamp + 3600 + 1);
        market.abandonJob(jobId);
        (, IJobMarket.JobState memory js) = market.getJob(jobId);
        assertEq(uint8(js.status), uint8(IJobMarket.JobStatus.Cancelled));

        uint256 remaining = BUDGET - budget;
        uint256 never = 2 * BUDGET / 3;
        uint256 refund = never < remaining ? never : remaining;
        assertEq(market.refundable(jobId), refund, "min(remaining, roundsNeverOpened * budget / rounds)");

        vm.expectRevert(IJobMarket.NotAuthorized.selector);
        market.withdrawRefund(jobId);
        vm.prank(requester);
        market.withdrawRefund(jobId);
        assertEq(usdc.balanceOf(requester), refund);
        vm.prank(requester);
        vm.expectRevert(IJobMarket.NothingToClaim.selector);
        market.withdrawRefund(jobId);
        _assertMoneyConserved();
    }

    function test_leftoverGoesToCleanSeats() public {
        IJobMarket.JobParams memory p = _params();
        p.rounds = 2;
        p.stakePerNode = market.minStake(p.budget, p.rounds, p.minQuorum);
        uint256 jobId = _job(p, 3);

        uint256 r1 = _openRound(jobId, 3);
        _commitReveal(jobId, r1, 3);
        market.lockSeed(jobId, r1);
        vm.roll(block.number + 3);
        market.drawSeed(jobId, r1);
        IJobMarket.Failure[] memory f = new IJobMarket.Failure[](1);
        f[0] = IJobMarket.Failure(op[0], IJobMarket.Kind.ReplayDrift, false);
        vm.prank(vm.addr(VERIFIER_A));
        market.attestRound(jobId, r1, bytes32(0), f);
        vm.prank(vm.addr(VERIFIER_B));
        market.attestRound(jobId, r1, bytes32(0), f);
        IJobMarket.Settlement memory s;
        s.outcome = IJobMarket.Outcome.Reverted;
        bytes[] memory sigs = _bothSign(jobId, r1, s);
        market.finalizeRound(jobId, r1, s, sigs);

        uint256 r2 = _openRound(jobId, 3);
        _commitReveal(jobId, r2, 3);
        _seedAndAttest(jobId, r2);
        s.aggEvidenceHash = keccak256("r2");
        sigs = _bothSign(jobId, r2, s);
        market.finalizeRound(jobId, r2, s, sigs);

        (, IJobMarket.JobState memory js) = market.getJob(jobId);
        assertEq(uint8(js.status), uint8(IJobMarket.JobStatus.Completed));
        assertEq(market.refundable(jobId), 0, "every round opened");
        uint256 share = p.budget / 2;
        assertEq(market.burned(), p.budget % 2, "split dust");

        vm.expectRevert(IJobMarket.NothingToClaim.selector);
        market.claimLeftover(jobId, op[0]);
        market.claimLeftover(jobId, op[1]);
        market.claimLeftover(jobId, op[2]);
        vm.expectRevert(IJobMarket.NothingToClaim.selector);
        market.claimLeftover(jobId, op[1]);
        assertEq(market.claimable(owner[1]), share);
        assertEq(market.claimable(owner[2]), share);
        _assertMoneyConserved();
    }

    function test_leftoverLockedWhenNoCleanSeat() public {
        IJobMarket.JobParams memory p = _params();
        p.rounds = 1;
        p.stakePerNode = market.minStake(p.budget, p.rounds, p.minQuorum);
        uint256 jobId = _job(p, 3);
        uint256 roundId = _openRound(jobId, 3);
        vm.warp(market.getRound(jobId, roundId).commitDeadline + 1);
        uint256 slashed;
        for (uint256 i; i < 3; i++) {
            uint128 before = reg.getNode(op[i]).stake;
            market.reportNoReveal(jobId, roundId, op[i]);
            slashed += before - reg.getNode(op[i]).stake;
        }
        market.voidRound(jobId, roundId);
        _assertAllIdle(3);
        (, IJobMarket.JobState memory js) = market.getJob(jobId);
        assertEq(uint8(js.status), uint8(IJobMarket.JobStatus.Completed));
        // Half of each no-reveal penalty joined budget_r, which the void returned to the job.
        assertEq(market.burned(), p.budget + slashed, "whole budget plus slashes locked");
        assertEq(usdc.balanceOf(address(market)), market.burned());
        _assertMoneyConserved();
    }

    /// forge-config: default.fuzz.runs = 64
    function testFuzz_abandonRefundAndLeftoverAddUp(uint256 budget, uint32 rounds, uint32 accepted) public {
        IJobMarket.JobParams memory p = _params();
        p.budget = bound(budget, 1e6, 1e13);
        p.rounds = uint32(bound(rounds, 1, 6));
        accepted = uint32(bound(accepted, 0, p.rounds - 1));
        p.stakePerNode = market.minStake(p.budget, p.rounds, p.minQuorum);
        uint256 jobId = _job(p, 3);
        for (uint256 r; r < accepted; r++) {
            _acceptRound(jobId);
        }
        (, IJobMarket.JobState memory js) = market.getJob(jobId);
        uint256 remaining = js.remaining;
        uint256 burnedBefore = market.burned();

        vm.warp(block.timestamp + 3600 + 1);
        market.abandonJob(jobId);
        uint256 refund = market.refundable(jobId);
        uint256 never = uint256(p.rounds - accepted) * p.budget / p.rounds;
        assertEq(refund, never < remaining ? never : remaining);

        uint256 leftovers;
        for (uint256 i; i < 3; i++) {
            uint256 before = market.claimable(owner[i]);
            // Three clean seats once any round was accepted; a zero share has nothing to claim.
            if (accepted > 0 && (remaining - refund) / 3 > 0) market.claimLeftover(jobId, op[i]);
            leftovers += market.claimable(owner[i]) - before;
        }
        assertEq(refund + leftovers + market.burned() - burnedBefore, remaining, "nothing created or lost");

        vm.prank(requester);
        if (refund > 0) market.withdrawRefund(jobId);
        for (uint256 i; i < 3; i++) {
            if (market.claimable(owner[i]) > 0) {
                vm.prank(owner[i]);
                market.claim();
            }
        }
        assertEq(usdc.balanceOf(address(market)), market.burned());
        _assertMoneyConserved();
    }
}
