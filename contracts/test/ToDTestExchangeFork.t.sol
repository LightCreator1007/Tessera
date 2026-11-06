// Checks the real Circle test-USDC deployment at an explicitly pinned Base Sepolia block.
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ToDToken} from "../src/ToDToken.sol";
import {ToDTestExchange} from "../src/ToDTestExchange.sol";

contract ToDTestExchangeForkTest is Test {
    address constant CIRCLE_TEST_USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;

    function test_circleBaseSepoliaRoundTripAtPinnedBlock() public {
        string memory rpc = vm.envOr("BASE_SEPOLIA_RPC_URL", string(""));
        uint256 pinnedBlock = vm.envOr("BASE_SEPOLIA_FORK_BLOCK", uint256(0));
        if (bytes(rpc).length == 0 || pinnedBlock == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc, pinnedBlock);
        assertEq(block.chainid, 84532);
        assertGt(CIRCLE_TEST_USDC.code.length, 0);
        ToDToken tod = new ToDToken(address(this), address(this), 100e6);
        ToDTestExchange desk = new ToDTestExchange(address(tod), CIRCLE_TEST_USDC);
        IERC20 usdc = IERC20(CIRCLE_TEST_USDC);
        address user = makeAddr("fork-claimant");
        tod.mint(user, 100e6);
        deal(CIRCLE_TEST_USDC, user, 0);
        deal(CIRCLE_TEST_USDC, address(desk), 100e6);
        vm.startPrank(user);
        tod.approve(address(desk), 100e6);
        vm.expectRevert(ToDTestExchange.BelowMinimumRedemption.selector);
        desk.swap(true, 10e6 - 1, 10e6 - 1, block.timestamp);
        assertEq(tod.balanceOf(user), 100e6);
        assertEq(usdc.balanceOf(address(desk)), 100e6);
        desk.swap(true, 10e6, 10e6, block.timestamp);
        usdc.approve(address(desk), 10e6);
        desk.swap(false, 10e6, 10e6, block.timestamp);
        tod.approve(address(desk), 100e6);
        desk.swap(true, 100e6, 100e6, block.timestamp);
        assertEq(usdc.balanceOf(user), 100e6);
        usdc.approve(address(desk), 100e6);
        desk.swap(false, 100e6, 100e6, block.timestamp);
        vm.stopPrank();
        assertEq(tod.balanceOf(user), 100e6);
        assertEq(usdc.balanceOf(user), 0);
        assertEq(usdc.balanceOf(address(desk)), 100e6);
    }
}
