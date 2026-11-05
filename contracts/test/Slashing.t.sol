// 2-of-2 failure confirmation with the mildest kind, slashes from the global stake, reverted rounds.
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IJobMarket} from "../src/IJobMarket.sol";
import {MarketFixture} from "./MarketFixture.sol";

contract SlashingTest is MarketFixture {
    uint128 stake;

    function _toVerify(IJobMarket.JobParams memory p) internal returns (uint256 jobId, uint256 roundId) {
        stake = p.stakePerNode;
        for (uint256 i; i < 3; i++) {
            _joinAndStake(i, stake);
        }
        _mint(requester, p.budget);
        vm.startPrank(requester);
        usdc.approve(address(market), p.budget);
        jobId = market.createJob(p, 0);
        vm.stopPrank();
        roundId = _openRound(jobId, 3);
        _commitReveal(jobId, roundId, 3);
        market.lockSeed(jobId, roundId);
        vm.roll(block.number + 3);
        market.drawSeed(jobId, roundId);
    }

    function _attest(uint256 key, uint256 jobId, uint256 roundId, address node, IJobMarket.Kind kind) internal {
        IJobMarket.Failure[] memory f;
        if (kind != IJobMarket.Kind.None) {
            f = new IJobMarket.Failure[](1);
            f[0] = IJobMarket.Failure(node, kind, false);
        }
        vm.prank(vm.addr(key));
        market.attestRound(jobId, roundId, keccak256(abi.encode(key)), f);
    }

    /// @dev Equal split of the round's (possibly topped-up) budget over op[1] and op[2], as the verifiers sign it.
    function _finalizeWithout0(uint256 jobId, uint256 roundId) internal returns (IJobMarket.Settlement memory s) {
        uint256 budget = market.getRound(jobId, roundId).budget;
        (address lo, address hi) = uint160(op[1]) < uint160(op[2]) ? (op[1], op[2]) : (op[2], op[1]);
        s.outcome = IJobMarket.Outcome.Accepted;
        s.aggregateHash = keccak256("G1");
        s.aggEvidenceHash = keccak256("aggEvidence");
        s.payEvidenceHash = keccak256("payEvidence");
        s.payouts = new IJobMarket.Payout[](2);
        s.payouts[0] = IJobMarket.Payout(lo, budget / 2 + budget % 2);
        s.payouts[1] = IJobMarket.Payout(hi, budget / 2);
        bytes[] memory sigs = _bothSign(jobId, roundId, s);
        market.finalizeRound(jobId, roundId, s, sigs);
    }

    function test_mismatchConfirmedByBothSlashesWholeStake() public {
        (uint256 jobId, uint256 roundId) = _toVerify(_params());
        uint256 budgetBefore = market.getRound(jobId, roundId).budget;
        _attest(VERIFIER_A, jobId, roundId, op[0], IJobMarket.Kind.ReplayMismatch);
        assertEq(reg.getNode(op[0]).stake, stake, "one verifier slashes nothing");
        vm.expectEmit(true, true, true, true, address(market));
        emit IJobMarket.Slashed(jobId, roundId, op[0], stake, stake / 2, stake - stake / 2);
        _attest(VERIFIER_B, jobId, roundId, op[0], IJobMarket.Kind.ReplayMismatch);

        assertEq(reg.getNode(op[0]).stake, 0, "100% of the global stake");
        assertFalse(market.isActive(jobId, op[0]));
        assertEq(uint8(market.getNodeRound(jobId, roundId, op[0]).confirmed), uint8(IJobMarket.Kind.ReplayMismatch));
        assertEq(market.getRound(jobId, roundId).budget, budgetBefore + stake / 2, "half to this round's pot");
        assertEq(market.burned(), stake - stake / 2, "half locked as burned");
        assertEq(market.eligibleBitmap(jobId, roundId) & 1, 0, "faker excluded from E");

        _finalizeWithout0(jobId, roundId);
        assertEq(market.claimable(owner[0]), 0);
        assertTrue(reg.isIdle(op[0]), "freed after the round");
        _assertMoneyConserved();
    }

    function test_mismatchWithoutSlashFlagOnlyExcludes() public {
        IJobMarket.JobParams memory p = _params();
        p.slashOnMismatch = false;
        (uint256 jobId, uint256 roundId) = _toVerify(p);
        _attest(VERIFIER_A, jobId, roundId, op[0], IJobMarket.Kind.ReplayMismatch);
        _attest(VERIFIER_B, jobId, roundId, op[0], IJobMarket.Kind.ReplayMismatch);
        assertEq(reg.getNode(op[0]).stake, stake);
        _finalizeWithout0(jobId, roundId);
        _assertMoneyConserved();
    }

    function test_driftExcludesWithoutSlash() public {
        (uint256 jobId, uint256 roundId) = _toVerify(_params());
        _attest(VERIFIER_A, jobId, roundId, op[0], IJobMarket.Kind.ReplayDrift);
        _attest(VERIFIER_B, jobId, roundId, op[0], IJobMarket.Kind.ReplayDrift);
        assertEq(reg.getNode(op[0]).stake, stake);
        assertEq(market.burned(), 0);
        _finalizeWithout0(jobId, roundId);
        _assertMoneyConserved();
    }

    function test_disagreeingVerifiersApplyTheMildestKind() public {
        (uint256 jobId, uint256 roundId) = _toVerify(_params());
        _attest(VERIFIER_A, jobId, roundId, op[0], IJobMarket.Kind.ReplayMismatch);
        _attest(VERIFIER_B, jobId, roundId, op[0], IJobMarket.Kind.ReplayDrift);
        assertEq(uint8(market.getNodeRound(jobId, roundId, op[0]).confirmed), uint8(IJobMarket.Kind.ReplayDrift));
        assertEq(reg.getNode(op[0]).stake, stake, "drift does not slash");
    }

    function test_oneVerifierAloneConfirmsNothing() public {
        (uint256 jobId, uint256 roundId) = _toVerify(_params());
        _attest(VERIFIER_A, jobId, roundId, op[0], IJobMarket.Kind.ReplayMismatch);
        _attest(VERIFIER_B, jobId, roundId, op[0], IJobMarket.Kind.None);
        assertEq(uint8(market.getNodeRound(jobId, roundId, op[0]).confirmed), uint8(IJobMarket.Kind.None));
        assertEq(market.eligibleBitmap(jobId, roundId), 0x7, "all three stay in E");
        IJobMarket.Settlement memory s = _equalSettlement(market.getRound(jobId, roundId).budget, 3, keccak256("G1"));
        bytes[] memory sigs = _bothSign(jobId, roundId, s);
        market.finalizeRound(jobId, roundId, s, sigs);
        _assertMoneyConserved();
    }

    function test_rejectsBadReports() public {
        (uint256 jobId, uint256 roundId) = _toVerify(_params());
        IJobMarket.Failure[] memory f = new IJobMarket.Failure[](2);
        f[0] = IJobMarket.Failure(op[0], IJobMarket.Kind.ReplayDrift, false);
        f[1] = IJobMarket.Failure(op[0], IJobMarket.Kind.ReplayMismatch, false);
        vm.prank(vm.addr(VERIFIER_A));
        vm.expectRevert(IJobMarket.AlreadyReported.selector);
        market.attestRound(jobId, roundId, bytes32(0), f);

        IJobMarket.Failure[] memory one = new IJobMarket.Failure[](1);
        one[0] = IJobMarket.Failure(op[3], IJobMarket.Kind.ReplayMismatch, false);
        vm.prank(vm.addr(VERIFIER_A));
        vm.expectRevert(IJobMarket.BadInput.selector);
        market.attestRound(jobId, roundId, bytes32(0), one);

        one[0] = IJobMarket.Failure(op[0], IJobMarket.Kind.ReplayMismatch, true);
        vm.prank(vm.addr(VERIFIER_A));
        vm.expectRevert(IJobMarket.BadInput.selector);
        market.attestRound(jobId, roundId, bytes32(0), one);

        one[0] = IJobMarket.Failure(op[0], IJobMarket.Kind.None, false);
        vm.prank(vm.addr(VERIFIER_A));
        vm.expectRevert(IJobMarket.BadInput.selector);
        market.attestRound(jobId, roundId, bytes32(0), one);

        vm.prank(makeAddr("stranger"));
        vm.expectRevert(IJobMarket.NotAuthorized.selector);
        market.attestRound(jobId, roundId, bytes32(0), new IJobMarket.Failure[](0));

        _attest(VERIFIER_A, jobId, roundId, op[0], IJobMarket.Kind.None);
        vm.prank(vm.addr(VERIFIER_A));
        vm.expectRevert(IJobMarket.AlreadyReported.selector);
        market.attestRound(jobId, roundId, bytes32(0), new IJobMarket.Failure[](0));
    }

    function test_dataUnavailableSlashesItsBps() public {
        (uint256 jobId, uint256 roundId) = _toVerify(_params());
        _attest(VERIFIER_A, jobId, roundId, op[0], IJobMarket.Kind.DataUnavailable);
        _attest(VERIFIER_B, jobId, roundId, op[0], IJobMarket.Kind.DataUnavailable);
        assertEq(reg.getNode(op[0]).stake, stake, "Phase 1: dataUnavailableBps = 0");
        assertEq(market.eligibleBitmap(jobId, roundId) & 1, 0, "excluded");
    }

    function test_dataUnavailableWithNonZeroBps() public {
        IJobMarket.JobParams memory p = _params();
        p.dataUnavailableBps = 1000;
        (uint256 jobId, uint256 roundId) = _toVerify(p);
        _attest(VERIFIER_A, jobId, roundId, op[0], IJobMarket.Kind.DataUnavailable);
        _attest(VERIFIER_B, jobId, roundId, op[0], IJobMarket.Kind.DataUnavailable);
        assertEq(reg.getNode(op[0]).stake, stake - stake / 10, "10% of stakePerNode");
        _finalizeWithout0(jobId, roundId);
        _assertMoneyConserved();
    }

    function test_revertedRoundKeepsTheSlash() public {
        (uint256 jobId, uint256 roundId) = _toVerify(_params());
        _attest(VERIFIER_A, jobId, roundId, op[0], IJobMarket.Kind.ReplayMismatch);
        _attest(VERIFIER_B, jobId, roundId, op[0], IJobMarket.Kind.ReplayMismatch);
        IJobMarket.Settlement memory s;
        s.outcome = IJobMarket.Outcome.Reverted;
        bytes[] memory sigs = _bothSign(jobId, roundId, s);
        market.finalizeRound(jobId, roundId, s, sigs);

        assertEq(reg.getNode(op[0]).stake, 0, "slash stands");
        (, IJobMarket.JobState memory js) = market.getJob(jobId);
        assertEq(js.remaining, BUDGET + stake / 2, "budget_r and the pot share return to the job");
        for (uint256 i; i < 3; i++) {
            assertTrue(reg.isIdle(op[i]));
        }
        assertEq(market.claimable(owner[1]), 0, "nobody paid");
        _assertMoneyConserved();
    }

    function test_slashFollowsTheNodeToOtherJobs() public {
        (uint256 jobId, uint256 roundId) = _toVerify(_params());
        _attest(VERIFIER_A, jobId, roundId, op[0], IJobMarket.Kind.ReplayMismatch);
        _attest(VERIFIER_B, jobId, roundId, op[0], IJobMarket.Kind.ReplayMismatch);
        _finalizeWithout0(jobId, roundId);

        uint256 job2 = _createJob();
        (address[] memory nodes, uint8[] memory shards) = _roster(3);
        vm.prank(coordinator);
        vm.expectRevert(IJobMarket.StakeTooLow.selector);
        market.openRound(job2, nodes, shards);
    }
}
