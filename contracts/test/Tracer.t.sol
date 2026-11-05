// tracer: pool join, job, three rounds with early close, 2-of-2 finalize, equal pay, claims, money invariant.
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Encodings} from "../src/Encodings.sol";
import {IJobMarket} from "../src/IJobMarket.sol";
import {INodeRegistry} from "../src/INodeRegistry.sol";
import {MarketFixture} from "./MarketFixture.sol";

contract TracerTest is MarketFixture {
    function test_happyPathThreeRounds() public {
        uint128 stake = market.minStake(BUDGET, ROUNDS, 3);
        for (uint256 i; i < 3; i++) {
            _joinAndStake(i, stake);
        }
        uint256 jobId = _createJob();
        uint256[N] memory paid;

        for (uint256 r = 1; r <= ROUNDS; r++) {
            uint256 roundId = _openRound(jobId, 3);
            assertEq(roundId, r);
            assertEq(uint8(market.phase(jobId, roundId)), uint8(IJobMarket.Phase.Commit));
            for (uint256 i; i < 3; i++) {
                assertFalse(reg.isIdle(op[i]), "busy during the round");
            }
            _commitReveal(jobId, roundId, 3);
            _seedAndAttest(jobId, roundId);

            uint256 budget = market.getRound(jobId, roundId).budget;
            bytes32 agg = keccak256(abi.encode("G", r));
            IJobMarket.Settlement memory s = _equalSettlement(budget, 3, agg);
            market.finalizeRound(jobId, roundId, s, _bothSign(jobId, roundId, s));

            assertEq(uint8(market.phase(jobId, roundId)), uint8(IJobMarket.Phase.Settled));
            for (uint256 i; i < 3; i++) {
                assertTrue(reg.isIdle(op[i]), "idle after the round");
            }
            if (r < ROUNDS) {
                assertEq(market.getRound(jobId, roundId + 1).status == IJobMarket.RoundStatus.None, true);
            }
            for (uint256 j; j < 3; j++) {
                for (uint256 i; i < 3; i++) {
                    if (s.payouts[j].operator == op[i]) paid[i] += s.payouts[j].amount;
                }
            }
        }

        (, IJobMarket.JobState memory js) = market.getJob(jobId);
        assertEq(uint8(js.status), uint8(IJobMarket.JobStatus.Completed));
        assertEq(js.remaining, 0);
        assertEq(paid[0] + paid[1] + paid[2], BUDGET, "pay sums to the budget");
        uint256 lowest;
        for (uint256 i = 1; i < 3; i++) {
            if (uint160(op[i]) < uint160(op[lowest])) lowest = i;
        }
        for (uint256 i; i < 3; i++) {
            assertEq(market.claimable(owner[i]), paid[i]);
            // Round budgets 100e6, 100e6, 100e6 + 1 over 3 nodes: dust 1 + 1 + 2 goes to the lowest address.
            assertEq(paid[i], i == lowest ? 3 * 33_333_333 + 4 : 3 * 33_333_333);
            vm.prank(owner[i]);
            market.claim();
            assertEq(usdc.balanceOf(owner[i]), paid[i]);
        }
        assertEq(usdc.balanceOf(address(market)), 0);
        _assertMoneyConserved();
    }

    function test_openRoundBelowQuorumReverts() public {
        uint128 stake = market.minStake(BUDGET, ROUNDS, 3);
        for (uint256 i; i < 3; i++) {
            _joinAndStake(i, stake);
        }
        uint256 jobId = _createJob();
        (address[] memory nodes, uint8[] memory shards) = _roster(2);
        vm.prank(coordinator);
        vm.expectRevert(IJobMarket.QuorumNotMet.selector);
        market.openRound(jobId, nodes, shards);
    }

    function test_joinRejectsBadSignatures() public {
        bytes32 nullifier = keccak256("human");
        uint64 deadline = uint64(block.timestamp + 30 minutes);
        (bytes memory invite, bytes memory consent) = _joinSigs(0, nullifier, deadline);

        vm.startPrank(owner[0]);
        vm.expectRevert(INodeRegistry.BadSignature.selector);
        reg.join(op[0], nullifier, deadline, deadline, consent, consent);
        vm.expectRevert(INodeRegistry.BadSignature.selector);
        reg.join(op[0], nullifier, deadline, deadline, invite, invite);
        // The invite names owner[0], so another owner can't use it.
        vm.stopPrank();
        vm.prank(owner[1]);
        vm.expectRevert(INodeRegistry.BadSignature.selector);
        reg.join(op[0], nullifier, deadline, deadline, invite, consent);

        vm.warp(block.timestamp + 30 minutes + 1);
        vm.prank(owner[0]);
        vm.expectRevert(INodeRegistry.Expired.selector);
        reg.join(op[0], nullifier, deadline, deadline, invite, consent);
    }

    function test_nullifierBindsOneOwner() public {
        bytes32 nullifier = keccak256("same human");
        uint64 deadline = uint64(block.timestamp + 30 minutes);
        (bytes memory invite, bytes memory consent) = _joinSigs(0, nullifier, deadline);
        vm.prank(owner[0]);
        reg.join(op[0], nullifier, deadline, deadline, invite, consent);
        (invite, consent) = _joinSigs(1, nullifier, deadline);
        vm.prank(owner[1]);
        vm.expectRevert(INodeRegistry.NullifierUsed.selector);
        reg.join(op[1], nullifier, deadline, deadline, invite, consent);
    }

    function test_busyNodeCannotServeSecondJob() public {
        uint128 stake = market.minStake(BUDGET, ROUNDS, 3);
        for (uint256 i; i < 4; i++) {
            _joinAndStake(i, stake);
        }
        uint256 job1 = _createJob();
        uint256 job2 = _createJob();
        _openRound(job1, 3);

        address[] memory nodes = new address[](3);
        uint8[] memory shards = new uint8[](3);
        (nodes[0], nodes[1], nodes[2]) = (op[3], op[1], op[2]);
        (shards[0], shards[1], shards[2]) = (0, 1, 2);
        vm.prank(coordinator);
        vm.expectRevert(IJobMarket.NodeNotEligible.selector);
        market.openRound(job2, nodes, shards);

        vm.prank(owner[1]);
        vm.expectRevert(INodeRegistry.NodeIsBusy.selector);
        reg.withdrawStake(op[1], 1);
    }

    function test_openRoundChecksRoster() public {
        uint128 stake = market.minStake(BUDGET, ROUNDS, 3);
        for (uint256 i; i < 3; i++) {
            _joinAndStake(i, stake);
        }
        uint256 jobId = _createJob();
        (address[] memory nodes, uint8[] memory shards) = _roster(3);

        shards[2] = shards[0];
        vm.prank(coordinator);
        vm.expectRevert(IJobMarket.DuplicateShard.selector);
        market.openRound(jobId, nodes, shards);

        shards[2] = 2;
        nodes[2] = nodes[0];
        vm.prank(coordinator);
        vm.expectRevert(IJobMarket.DuplicateOwner.selector);
        market.openRound(jobId, nodes, shards);

        nodes[2] = op[2];
        vm.prank(owner[2]);
        reg.withdrawStake(op[2], 1);
        vm.prank(coordinator);
        vm.expectRevert(IJobMarket.StakeTooLow.selector);
        market.openRound(jobId, nodes, shards);

        vm.expectRevert(IJobMarket.NotAuthorized.selector);
        market.openRound(jobId, nodes, shards);
    }

    function test_finalizeNeedsBothVerifiersAndExactPay() public {
        uint128 stake = market.minStake(BUDGET, ROUNDS, 3);
        for (uint256 i; i < 3; i++) {
            _joinAndStake(i, stake);
        }
        uint256 jobId = _createJob();
        uint256 roundId = _openRound(jobId, 3);
        _commitReveal(jobId, roundId, 3);
        _seedAndAttest(jobId, roundId);
        uint256 budget = market.getRound(jobId, roundId).budget;
        IJobMarket.Settlement memory s = _equalSettlement(budget, 3, keccak256("G1"));
        bytes[] memory sigs = _bothSign(jobId, roundId, s);

        bytes[] memory one = new bytes[](1);
        one[0] = sigs[0];
        vm.expectRevert(IJobMarket.BadSignature.selector);
        market.finalizeRound(jobId, roundId, s, one);

        bytes[] memory twice = new bytes[](2);
        (twice[0], twice[1]) = (sigs[0], sigs[0]);
        vm.expectRevert(IJobMarket.BadSignature.selector);
        market.finalizeRound(jobId, roundId, s, twice);

        bytes[] memory stranger = new bytes[](2);
        (stranger[0], stranger[1]) = (sigs[0], _sig(0xBAD, market.finalizeDigest(jobId, roundId, s)));
        vm.expectRevert(IJobMarket.BadSignature.selector);
        market.finalizeRound(jobId, roundId, s, stranger);

        // Signatures cover the payouts, so changing a payout breaks them.
        s.payouts[0].amount += 1;
        vm.expectRevert(IJobMarket.BadSignature.selector);
        market.finalizeRound(jobId, roundId, s, sigs);

        // Correctly signed but over budget.
        sigs = _bothSign(jobId, roundId, s);
        vm.expectRevert(IJobMarket.BadInput.selector);
        market.finalizeRound(jobId, roundId, s, sigs);

        // Correctly signed but missing a node of E.
        IJobMarket.Settlement memory short_ = _equalSettlement(budget, 2, keccak256("G1"));
        sigs = _bothSign(jobId, roundId, short_);
        vm.expectRevert(IJobMarket.BadInput.selector);
        market.finalizeRound(jobId, roundId, short_, sigs);

        s.payouts[0].amount -= 1;
        market.finalizeRound(jobId, roundId, s, _bothSign(jobId, roundId, s));
        _assertMoneyConserved();
    }

    function test_revertedRoundKeepsWeightsAndBudget() public {
        uint128 stake = market.minStake(BUDGET, ROUNDS, 3);
        for (uint256 i; i < 3; i++) {
            _joinAndStake(i, stake);
        }
        uint256 jobId = _createJob();
        uint256 roundId = _openRound(jobId, 3);
        _commitReveal(jobId, roundId, 3);
        _seedAndAttest(jobId, roundId);

        IJobMarket.Settlement memory s;
        s.outcome = IJobMarket.Outcome.Reverted;
        s.aggEvidenceHash = keccak256("aggEvidence");
        market.finalizeRound(jobId, roundId, s, _bothSign(jobId, roundId, s));

        assertEq(uint8(market.phase(jobId, roundId)), uint8(IJobMarket.Phase.Reverted));
        (, IJobMarket.JobState memory js) = market.getJob(jobId);
        assertEq(js.remaining, BUDGET, "budget_r back in the job");
        uint256 next = _openRound(jobId, 3);
        assertEq(market.getRound(jobId, next).startWeightsHash, keccak256("w0"), "model unchanged");
        assertEq(market.getRound(jobId, next).budget, BUDGET / 2, "carry spreads over the rounds left");
        _assertMoneyConserved();
    }

    function test_revealMustMatchCommit() public {
        uint128 stake = market.minStake(BUDGET, ROUNDS, 3);
        for (uint256 i; i < 3; i++) {
            _joinAndStake(i, stake);
        }
        uint256 jobId = _createJob();
        uint256 roundId = _openRound(jobId, 3);
        for (uint256 i; i < 3; i++) {
            bytes32 h = market.commitHashOf(
                jobId, roundId, op[i], Encodings.checkpointRoot(_ckpts(jobId, roundId, i)), _salt(roundId, i)
            );
            vm.prank(op[i]);
            market.commit(jobId, roundId, h);
        }
        bytes32[] memory hs = _ckpts(jobId, roundId, 0);
        vm.startPrank(op[0]);
        vm.expectRevert(IJobMarket.BadInput.selector);
        market.reveal(jobId, roundId, hs, _salt(roundId, 1));
        hs[2] = hs[1];
        vm.expectRevert(IJobMarket.BadInput.selector);
        market.reveal(jobId, roundId, hs, _salt(roundId, 0));
        vm.stopPrank();
    }
}
