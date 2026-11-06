// Exercises claim timing, failed claims and conservation of prefunded faucet inventory.
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ToDToken} from "../src/ToDToken.sol";
import {ToDFaucet} from "../src/ToDFaucet.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

contract WrongDecimalsToken is ERC20 {
    constructor() ERC20("Wrong", "TOD") {}
}

contract ToDFaucetTest is Test {
    ToDToken token;
    ToDFaucet faucet;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        token = new ToDToken(address(this), address(this), type(uint256).max);
        faucet = new ToDFaucet(address(token), 100e6, 1 days);
        token.mint(address(faucet), 200e6);
    }

    function test_claimAndExactCooldownBoundary() public {
        vm.prank(alice);
        faucet.claim();
        uint256 next = faucet.nextClaimAt(alice);
        vm.warp(next - 1);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ToDFaucet.CooldownActive.selector, next));
        faucet.claim();
        assertEq(token.balanceOf(alice), 100e6);
        assertEq(token.balanceOf(address(faucet)), 100e6);
        vm.warp(next);
        vm.prank(alice);
        faucet.claim();
        assertEq(token.balanceOf(alice), 200e6);
        assertEq(token.balanceOf(address(faucet)), 0);
    }

    function test_otherClaimantHasIndependentCooldown() public {
        vm.prank(alice);
        faucet.claim();
        vm.prank(bob);
        faucet.claim();
        assertEq(token.balanceOf(alice), token.balanceOf(bob));
        assertEq(token.balanceOf(alice) + token.balanceOf(bob), token.totalSupply());
    }

    function test_exhaustionDoesNotConsumeClaimAndRefillWorksWithoutMinting() public {
        vm.prank(alice);
        faucet.claim();
        vm.prank(bob);
        faucet.claim();
        address newcomer = makeAddr("newcomer");
        vm.prank(newcomer);
        vm.expectRevert(ToDFaucet.EmptyFaucet.selector);
        faucet.claim();
        assertEq(faucet.nextClaimAt(newcomer), 0);
        vm.prank(alice);
        token.transfer(address(faucet), 100e6);
        vm.prank(newcomer);
        faucet.claim();
        assertEq(token.balanceOf(newcomer), 100e6);
        assertEq(token.totalSupply(), 200e6);
    }

    function test_revokingMintAuthorityDoesNotStopFundedClaims() public {
        token.revokeRole(token.MINTER_ROLE(), address(this));
        assertFalse(token.hasRole(token.MINTER_ROLE(), address(faucet)));
        vm.prank(alice);
        faucet.claim();
        assertEq(token.balanceOf(alice), 100e6);
        assertEq(token.totalSupply(), 200e6);
    }

    function test_invalidConfigurationRejected() public {
        vm.expectRevert(ToDFaucet.InvalidConfiguration.selector);
        new ToDFaucet(address(0), 1, 1);
        vm.expectRevert(ToDFaucet.InvalidConfiguration.selector);
        new ToDFaucet(address(token), 0, 1);
        vm.expectRevert(ToDFaucet.InvalidConfiguration.selector);
        new ToDFaucet(address(token), 1, 0);
        vm.expectRevert(ToDFaucet.InvalidConfiguration.selector);
        new ToDFaucet(address(token), 1, 30 days + 1);
        ERC20 wrongDecimals = new WrongDecimalsToken();
        vm.expectRevert(ToDFaucet.InvalidConfiguration.selector);
        new ToDFaucet(address(wrongDecimals), 1, 1);
        MockUSDC wrongSymbol = new MockUSDC();
        vm.expectRevert(ToDFaucet.InvalidConfiguration.selector);
        new ToDFaucet(address(wrongSymbol), 1, 1);
    }

    function testFuzz_allocationAndCooldownConserveInventory(uint256 amountSeed, uint256 delaySeed) public {
        uint256 amount = bound(amountSeed, 1, type(uint256).max);
        uint256 delay = bound(delaySeed, 1, 30 days);
        ToDToken custom = new ToDToken(address(this), address(this), type(uint256).max);
        ToDFaucet customFaucet = new ToDFaucet(address(custom), amount, delay);
        custom.mint(address(customFaucet), amount);
        vm.startPrank(alice);
        customFaucet.claim();
        custom.transfer(address(customFaucet), amount);
        vm.warp(block.timestamp + delay);
        customFaucet.claim();
        vm.stopPrank();
        assertEq(custom.balanceOf(alice), amount);
        assertEq(custom.balanceOf(address(customFaucet)), 0);
        assertEq(custom.totalSupply(), amount);
    }
}

contract ToDFaucetHandler is Test {
    ToDToken public immutable token;
    ToDFaucet public immutable faucet;
    address[3] public actors = [address(0xB1), address(0xB2), address(0xB3)];
    uint256 public distributed;
    uint256 public returned;

    constructor(ToDToken token_, ToDFaucet faucet_) {
        token = token_;
        faucet = faucet_;
    }

    function claim(uint256 actorSeed) external {
        if (token.balanceOf(address(faucet)) < faucet.allocation()) return;
        address actor = actors[actorSeed % 3];
        uint256 next = faucet.nextClaimAt(actor);
        if (block.timestamp < next) vm.warp(next);
        vm.prank(actor);
        faucet.claim();
        distributed += faucet.allocation();
    }

    function refill(uint256 actorSeed, uint256 amountSeed) external {
        address actor = actors[actorSeed % 3];
        uint256 balance = token.balanceOf(actor);
        if (balance == 0) return;
        uint256 amount = bound(amountSeed, 1, balance);
        vm.prank(actor);
        token.transfer(address(faucet), amount);
        returned += amount;
    }
}

contract ToDFaucetInvariantTest is Test {
    ToDToken token;
    ToDFaucet faucet;
    ToDFaucetHandler handler;
    uint256 constant INITIAL = 1_000_000e6;

    function setUp() public {
        token = new ToDToken(address(this), address(this), INITIAL);
        faucet = new ToDFaucet(address(token), 100e6, 1 days);
        token.mint(address(faucet), INITIAL);
        token.revokeRole(token.MINTER_ROLE(), address(this));
        handler = new ToDFaucetHandler(token, faucet);
        handler.claim(0);
        handler.claim(1);
        handler.refill(0, 1e6);
        bytes4[] memory selectors = new bytes4[](2);
        selectors[0] = handler.claim.selector;
        selectors[1] = handler.refill.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
        targetContract(address(handler));
    }

    function invariant_inventoryAndClaimsConserveExistingSupply() public view {
        uint256 users;
        for (uint256 i; i < 3; i++) {
            users += token.balanceOf(handler.actors(i));
        }
        assertEq(token.balanceOf(address(faucet)) + users, INITIAL);
        assertEq(handler.distributed() - handler.returned(), users);
        assertEq(token.totalSupply(), INITIAL);
    }
}
