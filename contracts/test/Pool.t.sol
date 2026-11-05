// common-pool rules: one join per operator, one seat per owner per round, stake moves, JobMarket-only hooks.
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {NodeRegistry} from "../src/NodeRegistry.sol";
import {Encodings} from "../src/Encodings.sol";
import {IJobMarket} from "../src/IJobMarket.sol";
import {INodeRegistry} from "../src/INodeRegistry.sol";
import {MarketFixture} from "./MarketFixture.sol";

contract PoolTest is MarketFixture {
    /// @dev Pairs operator `opIdx` to `ownerIdx`'s wallet under that owner's nullifier.
    function _pair(uint256 opIdx, uint256 ownerIdx, uint64 inviteDeadline, uint64 consentDeadline)
        internal
        view
        returns (bytes32 nullifier, bytes memory invite, bytes memory consent)
    {
        nullifier = keccak256(abi.encode("human", ownerIdx));
        bytes32 ds = _ds(address(reg));
        invite = _sig(
            ADMITTER,
            MessageHashUtils.toTypedDataHash(
                ds, Encodings.inviteHash(op[opIdx], owner[ownerIdx], nullifier, inviteDeadline)
            )
        );
        consent = _sig(
            opKey[opIdx],
            MessageHashUtils.toTypedDataHash(ds, Encodings.consentHash(owner[ownerIdx], op[opIdx], consentDeadline))
        );
    }

    /// @dev forge test runs without the EIP-170 limit, so a contract over it passes here and fails on every real chain.
    function test_deployedCodeFitsTheSizeLimit() public view {
        assertLe(address(market).code.length, 24_576);
        assertLe(address(reg).code.length, 24_576);
    }

    function test_secondJoinOfAnOperatorReverts() public {
        _joinAndStake(0, 1);
        (bytes32 n, bytes memory invite, bytes memory consent) =
            _pair(0, 0, uint64(block.timestamp + 60), uint64(block.timestamp + 60));
        vm.prank(owner[0]);
        vm.expectRevert(INodeRegistry.AlreadyJoined.selector);
        reg.join(op[0], n, uint64(block.timestamp + 60), uint64(block.timestamp + 60), invite, consent);
    }

    function test_oneOwnerRunsTwoOperatorsButHoldsOneSeatPerRound() public {
        uint128 stake = market.minStake(BUDGET, ROUNDS, 3);
        for (uint256 i; i < 3; i++) {
            _joinAndStake(i, stake);
        }
        uint64 d = uint64(block.timestamp + 60);
        (bytes32 n, bytes memory invite, bytes memory consent) = _pair(3, 0, d, d);
        vm.prank(owner[0]);
        reg.join(op[3], n, d, d, invite, consent);
        assertEq(reg.ownerOf(op[3]), owner[0], "same human, second operator");
        _mint(owner[0], stake);
        vm.startPrank(owner[0]);
        usdc.approve(address(reg), stake);
        reg.depositStake(op[3], stake);
        vm.stopPrank();

        uint256 jobId = _createJob();
        address[] memory nodes = new address[](3);
        uint8[] memory shards = new uint8[](3);
        (nodes[0], nodes[1], nodes[2]) = (op[0], op[3], op[1]);
        (shards[0], shards[1], shards[2]) = (0, 1, 2);
        vm.prank(coordinator);
        vm.expectRevert(IJobMarket.DuplicateOwner.selector);
        market.openRound(jobId, nodes, shards);
    }

    function test_withdrawWhileIdleUpToTheStake() public {
        _joinAndStake(0, 20e6);
        vm.startPrank(owner[0]);
        vm.expectRevert(INodeRegistry.BadInput.selector);
        reg.withdrawStake(op[0], 20e6 + 1);
        reg.withdrawStake(op[0], 5e6);
        reg.withdrawStake(op[0], 15e6);
        vm.stopPrank();
        assertEq(reg.getNode(op[0]).stake, 0);
        assertEq(usdc.balanceOf(owner[0]), 20e6);

        vm.prank(owner[1]);
        vm.expectRevert(INodeRegistry.NotAuthorized.selector);
        reg.withdrawStake(op[0], 1);
        _assertMoneyConserved();
    }

    function test_inviteAndConsentExpireSeparately() public {
        uint64 soon = uint64(block.timestamp + 10);
        uint64 later = uint64(block.timestamp + 30 minutes);
        (bytes32 n, bytes memory invite, bytes memory consent) = _pair(0, 0, soon, later);
        vm.warp(soon + 1);
        vm.prank(owner[0]);
        vm.expectRevert(INodeRegistry.Expired.selector);
        reg.join(op[0], n, soon, later, invite, consent);

        (n, invite, consent) = _pair(1, 1, later + 1 hours, later);
        vm.warp(later + 1);
        vm.prank(owner[1]);
        vm.expectRevert(INodeRegistry.Expired.selector);
        reg.join(op[1], n, later + 1 hours, later, invite, consent);
    }

    function test_onlyJobMarketMovesNodes() public {
        _joinAndStake(0, 1);
        address[] memory ops = new address[](1);
        ops[0] = op[0];
        vm.startPrank(makeAddr("stranger"));
        vm.expectRevert(INodeRegistry.NotAuthorized.selector);
        reg.markBusy(ops, 1, 1);
        vm.expectRevert(INodeRegistry.NotAuthorized.selector);
        reg.markFree(ops, 1, 1);
        vm.expectRevert(INodeRegistry.NotAuthorized.selector);
        reg.slash(op[0], 1, 1, 1);
        vm.expectRevert(INodeRegistry.NotAuthorized.selector);
        reg.creditWork(owner[0], 1, 1, 1);
        vm.stopPrank();
    }

    function test_marketIsSetOnceByTheDeployer() public {
        vm.expectRevert(INodeRegistry.NotAuthorized.selector);
        reg.setMarket(makeAddr("other"));

        NodeRegistry fresh = new NodeRegistry(address(usdc), vm.addr(ADMITTER), 0);
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(INodeRegistry.NotAuthorized.selector);
        fresh.setMarket(address(market));
        fresh.setMarket(address(market));
        assertEq(fresh.market(), address(market));
    }

    function test_customCodeFlagIsOwnerOnlyAndStored() public {
        _joinAndStake(0, 1);
        vm.prank(owner[1]);
        vm.expectRevert(INodeRegistry.NotAuthorized.selector);
        reg.setCustomCode(op[0], true);
        vm.prank(owner[0]);
        reg.setCustomCode(op[0], true);
        assertTrue(reg.getNode(op[0]).customCode);
    }

    function test_unjoinedOperatorCannotStakeOrBeMatched() public {
        vm.prank(owner[0]);
        vm.expectRevert(INodeRegistry.NotJoined.selector);
        reg.depositStake(op[0], 1);

        uint128 stake = market.minStake(BUDGET, ROUNDS, 3);
        for (uint256 i = 1; i < 3; i++) {
            _joinAndStake(i, stake);
        }
        uint256 jobId = _createJob();
        (address[] memory nodes, uint8[] memory shards) = _roster(3);
        vm.prank(coordinator);
        vm.expectRevert(IJobMarket.NodeNotEligible.selector);
        market.openRound(jobId, nodes, shards);
    }
}
