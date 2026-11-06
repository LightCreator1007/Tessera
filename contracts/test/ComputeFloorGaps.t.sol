// Pins the contract paths that pay TOD with no replayed work behind them, which the compute floor has to close.
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MarketFixture} from "./MarketFixture.sol";
import {Encodings} from "../src/Encodings.sol";
import {IJobMarket} from "../src/IJobMarket.sol";

contract ComputeFloorGapsTest is MarketFixture {
    uint128 stake;

    function _seatThree(uint256 jobId) private {
        (IJobMarket.JobParams memory p,) = market.getJob(jobId);
        stake = p.stakePerNode;
        // Twice the job's stake, so no-reveal penalties never take a colluding node off the roster.
        for (uint256 i; i < 3; i++) {
            _joinAndStake(i, 2 * stake);
        }
    }

    /// @dev op[0] reveals made-up hashes and the other two seats stay silent, so no verifier ever replays anything.
    function _voidWithOneFakeReveal(uint256 jobId) private returns (uint256 roundId) {
        roundId = _openRound(jobId, 3);
        bytes32[] memory fake = _ckpts(jobId, roundId, 0);
        bytes32 commitment =
            market.commitHashOf(jobId, roundId, op[0], Encodings.checkpointRoot(fake), _salt(roundId, 0));
        vm.prank(op[0]);
        market.commit(jobId, roundId, commitment);
        vm.warp(market.getRound(jobId, roundId).commitDeadline + 1);
        vm.prank(op[0]);
        market.reveal(jobId, roundId, fake, _salt(roundId, 0));
        market.reportNoReveal(jobId, roundId, op[1]);
        market.reportNoReveal(jobId, roundId, op[2]);
        market.voidRound(jobId, roundId);
    }

    function test_voidedJobPaysLeftoverWithNoReplayedWork() public {
        uint256 jobId = _createJob();
        _seatThree(jobId);
        for (uint256 r; r < ROUNDS; r++) {
            _voidWithOneFakeReveal(jobId);
        }
        (, IJobMarket.JobState memory js) = market.getJob(jobId);
        assertEq(uint8(js.status), uint8(IJobMarket.JobStatus.Completed));
        assertEq(market.refundable(jobId), 0, "the requester gets nothing back");

        market.claimLeftover(jobId, op[0]);
        uint256 gained = market.claimable(owner[0]);
        uint256 lost = 2 * uint256(2 * stake) - reg.getNode(op[1]).stake - reg.getNode(op[2]).stake;
        emit log_named_uint("budget", BUDGET);
        emit log_named_uint("paid to the fake seat", gained);
        emit log_named_uint("penalties on the silent seats", lost);
        assertGt(gained, BUDGET, "the whole budget plus half the penalties");
        assertGt(gained - lost, BUDGET * 8 / 10, "the three seats together keep over 80% of the budget");
    }

    function test_voidRaisesTheNextRoundsRate() public {
        uint256 jobId = _createJob();
        _seatThree(jobId);
        uint256 base = market.getRound(jobId, _voidWithOneFakeReveal(jobId)).budget;
        uint256 next = market.getRound(jobId, _openRound(jobId, 3)).budget;
        emit log_named_uint("first round budget", base);
        emit log_named_uint("round after the void", next);
        assertGt(next, base * 3 / 2, "the same work pays over 1.5x after one void");
    }
}
