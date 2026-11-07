// cancelJob: the requester gets back rounds that never opened, and an open round still finishes and pays.
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IJobMarket} from "../src/IJobMarket.sol";
import {MarketFixture} from "./MarketFixture.sol";

contract CancelTest is MarketFixture {
    function _jobWithNodes() internal returns (uint256 jobId) {
        for (uint256 i; i < 3; i++) {
            _joinAndStake(i, _params().stakePerNode);
        }
        jobId = _createJob();
    }

    function _settle(uint256 jobId, uint256 roundId) internal {
        _commitReveal(jobId, roundId, 3);
        _seedAndAttest(jobId, roundId);
        IJobMarket.Settlement memory s = _equalSettlement(market.getRound(jobId, roundId).budget, 3, keccak256("G"));
        bytes[] memory sigs = _bothSign(jobId, roundId, s);
        market.finalizeRound(jobId, roundId, s, sigs);
    }

    function _status(uint256 jobId) internal view returns (IJobMarket.JobStatus) {
        (, IJobMarket.JobState memory js) = market.getJob(jobId);
        return js.status;
    }

    function test_cancelBeforeAnyRoundRefundsEverything() public {
        uint256 jobId = _jobWithNodes();
        vm.prank(requester);
        market.cancelJob(jobId);
        assertEq(uint8(_status(jobId)), uint8(IJobMarket.JobStatus.Cancelled));
        assertEq(usdc.balanceOf(requester), BUDGET, "refunded in the same call");
        assertEq(market.refundable(jobId), 0);
        assertFalse(market.stopping(jobId));

        vm.prank(requester);
        vm.expectRevert(IJobMarket.WrongState.selector);
        market.cancelJob(jobId);
        (address[] memory nodes, uint8[] memory shards) = _roster(3);
        vm.prank(coordinator);
        vm.expectRevert(IJobMarket.WrongState.selector);
        market.openRound(jobId, nodes, shards);
        _assertMoneyConserved();
    }

    function test_onlyRequesterCancels() public {
        uint256 jobId = _jobWithNodes();
        vm.prank(owner[0]);
        vm.expectRevert(IJobMarket.NotAuthorized.selector);
        market.cancelJob(jobId);
    }

    function test_cancelDuringRoundLetsItFinishThenRefundsTheRest() public {
        uint256 jobId = _jobWithNodes();
        uint256 roundId = _openRound(jobId, 3);
        vm.prank(requester);
        market.cancelJob(jobId);
        assertTrue(market.stopping(jobId));
        assertEq(uint8(_status(jobId)), uint8(IJobMarket.JobStatus.Active), "the open round still runs");
        vm.prank(requester);
        vm.expectRevert(IJobMarket.WrongState.selector);
        market.cancelJob(jobId);

        uint256 budget = market.getRound(jobId, roundId).budget;
        _settle(jobId, roundId);
        assertEq(uint8(_status(jobId)), uint8(IJobMarket.JobStatus.Cancelled));
        uint256 paid;
        for (uint256 i; i < 3; i++) {
            paid += market.claimable(owner[i]);
        }
        assertEq(paid, budget, "the round that ran is paid in full");
        uint256 never = (ROUNDS - 1) * BUDGET / ROUNDS;
        assertEq(market.refundable(jobId), never);
        vm.prank(requester);
        market.withdrawRefund(jobId);
        assertEq(usdc.balanceOf(requester), never);

        (address[] memory nodes, uint8[] memory shards) = _roster(3);
        vm.prank(coordinator);
        vm.expectRevert(IJobMarket.WrongState.selector);
        market.openRound(jobId, nodes, shards);
    }

    function test_cancelBetweenRoundsClosesNow() public {
        uint256 jobId = _jobWithNodes();
        _settle(jobId, _openRound(jobId, 3));
        vm.prank(requester);
        market.cancelJob(jobId);
        assertEq(uint8(_status(jobId)), uint8(IJobMarket.JobStatus.Cancelled));
        assertFalse(market.stopping(jobId));
        assertEq(usdc.balanceOf(requester), (ROUNDS - 1) * BUDGET / ROUNDS);
        _assertMoneyConserved();
    }
}
