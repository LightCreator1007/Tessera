// work credit, graduation from the next round, probation forfeits, capped pool drip, paying a job from earnings.
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {IJobMarket} from "../src/IJobMarket.sol";
import {INodeRegistry} from "../src/INodeRegistry.sol";
import {MarketFixture} from "./MarketFixture.sol";

contract EarningsTest is MarketFixture {
    // Two accepted rounds at refWorkSecondsPerRound = 2 graduate an owner.
    function _probation() internal pure override returns (uint64) {
        return 4;
    }

    function _jobWith(IJobMarket.JobParams memory p) internal returns (uint256 jobId) {
        _mint(requester, p.budget);
        vm.startPrank(requester);
        usdc.approve(address(market), p.budget);
        jobId = market.createJob(p, 0);
        vm.stopPrank();
    }

    function _stakeAll() internal {
        uint128 stake = market.minStake(BUDGET, ROUNDS, 3);
        for (uint256 i; i < 3; i++) {
            _joinAndStake(i, stake);
        }
    }

    /// @dev Runs one verified round and returns (budget_r, drip, pool before finalize, pool after).
    function _round(uint256 jobId)
        internal
        returns (uint256 budget, uint256 drip, uint256 poolBefore, uint256 poolAfter)
    {
        vm.warp(block.timestamp + 1);
        uint256 roundId = _openRound(jobId, 3);
        _commitReveal(jobId, roundId, 3);
        _seedAndAttest(jobId, roundId);
        IJobMarket.Round memory r = market.getRound(jobId, roundId);
        (budget, drip) = (r.budget, r.drip);
        bool anyGrad;
        for (uint256 i; i < 3; i++) {
            uint64 g = reg.graduatedAt(owner[i]);
            anyGrad = anyGrad || (g != 0 && g < r.openedAt);
        }
        IJobMarket.Settlement memory s = _equalSettlement(budget + (anyGrad ? drip : 0), 3, keccak256("G"));
        bytes[] memory sigs = _bothSign(jobId, roundId, s);
        poolBefore = market.communityPool();
        market.finalizeRound(jobId, roundId, s, sigs);
        poolAfter = market.communityPool();
    }

    function _count(Vm.Log[] memory logs, bytes32 topic, address emitter) internal pure returns (uint256 n) {
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter == emitter && logs[i].topics[0] == topic) n++;
        }
    }

    function _claimableSum() internal view returns (uint256 c) {
        for (uint256 i; i < 3; i++) {
            c += market.claimable(owner[i]);
        }
    }

    function test_forfeitThenGraduateFromTheNextRound() public {
        _stakeAll();
        uint256 jobId = _jobWith(_params());

        vm.recordLogs();
        (uint256 b1,,, uint256 pool1) = _round(jobId);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(_count(logs, INodeRegistry.WorkCredited.selector, address(reg)), 3);
        assertEq(_count(logs, IJobMarket.ForfeitedToPool.selector, address(market)), 3);
        assertEq(_count(logs, IJobMarket.Paid.selector, address(market)), 0);
        assertEq(_claimableSum(), 0, "probation: everything forfeits");
        assertEq(pool1, b1, "forfeits fill the pool");
        assertEq(reg.verifiedWorkSeconds(owner[0]), 2);

        vm.recordLogs();
        (uint256 b2, uint256 d2,, uint256 pool2) = _round(jobId);
        logs = vm.getRecordedLogs();
        assertEq(_count(logs, INodeRegistry.Graduated.selector, address(reg)), 3);
        assertEq(_count(logs, IJobMarket.PoolDripped.selector, address(market)), 0);
        assertEq(d2, pool1 / 10, "drip = 10% of the pool");
        assertTrue(reg.graduated(owner[0]), "4 s reached in round 2");
        assertEq(_claimableSum(), 0, "the round that crosses the threshold still forfeits");
        assertEq(pool2, pool1 - d2 + b2 + d2, "no graduate in E: the drip waits in the pool");

        vm.recordLogs();
        (uint256 b3, uint256 d3,, uint256 pool3) = _round(jobId);
        logs = vm.getRecordedLogs();
        assertEq(_count(logs, IJobMarket.PoolDripped.selector, address(market)), 1);
        assertEq(_count(logs, IJobMarket.Paid.selector, address(market)), 3);
        assertEq(_count(logs, IJobMarket.ForfeitedToPool.selector, address(market)), 0);
        assertEq(d3, pool2 / 10);
        assertEq(_claimableSum(), b3 + d3, "graduates are paid budget_r plus the drip");
        assertEq(pool3, pool2 - d3);
        _assertMoneyConserved();
    }

    function test_invariantPerRound() public {
        _stakeAll();
        uint256 jobId = _jobWith(_params());
        for (uint256 r; r < 3; r++) {
            uint256 claimBefore = _claimableSum();
            (uint256 budget, uint256 drip, uint256 poolBefore, uint256 poolAfter) = _round(jobId);
            uint256 paid = _claimableSum() - claimBefore;
            // sum(payouts) + toPool == budget_r + drip; a drip nobody could take also lands back in the pool.
            assertEq(paid + (poolAfter - poolBefore), budget + drip);
        }
    }

    function test_dripNeverExceedsRoundBudget() public {
        _stakeAll();
        uint256 big = _jobWith(_params());
        _round(big);
        uint256 pool = market.communityPool();
        assertGt(pool, 0);

        IJobMarket.JobParams memory p = _params();
        p.budget = 3;
        p.rounds = 1;
        p.stakePerNode = market.minStake(p.budget, p.rounds, p.minQuorum);
        uint256 tiny = _jobWith(p);
        vm.warp(block.timestamp + 1);
        uint256 roundId = _openRound(tiny, 3);
        assertEq(market.getRound(tiny, roundId).drip, 3, "capped at budget_r, not 10% of the pool");
        assertEq(market.communityPool(), pool - 3);
    }

    function test_fallbackAndRevertedRoundsCreditNoWork() public {
        _stakeAll();
        uint256 jobId = _jobWith(_params());
        _round(jobId);
        uint64 seconds0 = reg.verifiedWorkSeconds(owner[0]);

        vm.warp(block.timestamp + 1);
        uint256 r2 = _openRound(jobId, 3);
        _commitReveal(jobId, r2, 3);
        _seedAndAttest(jobId, r2);
        uint256 pool = market.communityPool();
        IJobMarket.Settlement memory s;
        s.outcome = IJobMarket.Outcome.Reverted;
        bytes[] memory sigs = _bothSign(jobId, r2, s);
        market.finalizeRound(jobId, r2, s, sigs);
        assertEq(reg.verifiedWorkSeconds(owner[0]), seconds0, "reverted: no credit");
        assertEq(market.communityPool(), pool + market.getRound(jobId, r2).drip, "drip returned");

        vm.warp(block.timestamp + 1);
        uint256 r3 = _openRound(jobId, 3);
        _commitReveal(jobId, r3, 3);
        _seedAndAttest(jobId, r3);
        vm.warp(market.getRound(jobId, r3).finalizeBy + 1);
        market.finalizeFallback(jobId, r3);
        assertEq(reg.verifiedWorkSeconds(owner[0]), seconds0, "fallback: no credit");
        _assertMoneyConserved();
    }

    function test_jobFundedFromEarnings() public {
        _stakeAll();
        uint256 jobId = _jobWith(_params());
        _round(jobId);
        _round(jobId);
        _round(jobId);
        uint256 balance = market.claimable(owner[0]);
        assertGt(balance, 0);

        IJobMarket.JobParams memory p = _params();
        p.budget = balance + 5e6;
        p.stakePerNode = market.minStake(p.budget, p.rounds, p.minQuorum);
        vm.prank(owner[0]);
        vm.expectRevert(IJobMarket.InsufficientBalance.selector);
        market.createJob(p, balance + 1);

        _mint(owner[0], 5e6);
        vm.startPrank(owner[0]);
        usdc.approve(address(market), 5e6);
        uint256 own = market.createJob(p, balance);
        vm.stopPrank();
        assertEq(market.claimable(owner[0]), 0, "balance spent, never negative");
        assertEq(usdc.balanceOf(owner[0]), 0, "the rest came by transfer");
        (, IJobMarket.JobState memory js) = market.getJob(own);
        assertEq(js.remaining, p.budget);
        _assertMoneyConserved();
    }
}
