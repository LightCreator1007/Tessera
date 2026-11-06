// Checks atomic demo swaps and conservation of both prefunded token inventories.
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ToDToken} from "../src/ToDToken.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {ToDTestExchange} from "../src/ToDTestExchange.sol";

contract FeeTestUSDC is ERC20 {
    constructor() ERC20("Fee test fixture", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 amount) internal override {
        uint256 fee = from == address(0) || to == address(0) ? 0 : amount / 100;
        if (fee != 0) super._update(from, address(0), fee);
        super._update(from, to, amount - fee);
    }
}

contract ToDTestExchangeTest is Test {
    ToDToken tod;
    MockUSDC usdc;
    ToDTestExchange desk;
    address alice = makeAddr("alice");

    function setUp() public {
        tod = new ToDToken(address(this), address(this), type(uint256).max);
        usdc = new MockUSDC();
        desk = new ToDTestExchange(address(tod), address(usdc));
        tod.mint(alice, 100e6);
        usdc.mint(address(desk), 100e6);
        vm.prank(alice);
        tod.approve(address(desk), 100e6);
    }

    function test_roundTripReturnsTheInputWithoutIssuance() public {
        vm.startPrank(alice);
        desk.swap(true, 100e6, 100e6, block.timestamp);
        usdc.approve(address(desk), 100e6);
        desk.swap(false, 100e6, 100e6, block.timestamp);
        vm.stopPrank();
        assertEq(tod.balanceOf(alice), 100e6);
        assertEq(usdc.balanceOf(alice), 0);
        assertEq(tod.balanceOf(address(desk)), 0);
        assertEq(usdc.balanceOf(address(desk)), 100e6);
        assertEq(tod.totalSupply(), 100e6);
        assertEq(usdc.totalSupply(), 100e6);
    }

    function test_failedQuoteAndExpiryLeaveInputUntouched() public {
        vm.warp(100);
        vm.startPrank(alice);
        vm.expectRevert(ToDTestExchange.Expired.selector);
        desk.swap(true, 10e6, 10e6, 99);
        vm.expectRevert(ToDTestExchange.InvalidQuote.selector);
        desk.swap(true, 10e6, 0, 100);
        vm.expectRevert(ToDTestExchange.InvalidQuote.selector);
        desk.swap(true, 10e6, 10e6 + 1, 100);
        vm.expectRevert(ToDTestExchange.InvalidQuote.selector);
        desk.swap(true, 0, 1, 100);
        vm.stopPrank();
        assertEq(tod.balanceOf(alice), 100e6);
        assertEq(tod.allowance(alice, address(desk)), 100e6);
    }

    function test_insufficientInventoryAndApprovalNeverTakeInput() public {
        vm.startPrank(alice);
        vm.expectRevert(ToDTestExchange.InsufficientInventory.selector);
        desk.swap(true, 100e6 + 1, 1, block.timestamp);
        tod.approve(address(desk), 0);
        vm.expectRevert();
        desk.swap(true, 10e6, 10e6, block.timestamp);
        vm.stopPrank();
        assertEq(tod.balanceOf(alice), 100e6);
        assertEq(usdc.balanceOf(address(desk)), 100e6);
    }

    function test_minimumRedemptionRejectsDustWithoutMovingFunds() public {
        vm.startPrank(alice);
        vm.expectRevert(ToDTestExchange.BelowMinimumRedemption.selector);
        desk.swap(true, 10e6 - 1, 10e6 - 1, block.timestamp);
        vm.stopPrank();
        assertEq(tod.balanceOf(alice), 100e6);
        assertEq(tod.balanceOf(address(desk)), 0);
        assertEq(usdc.balanceOf(alice), 0);
        assertEq(usdc.balanceOf(address(desk)), 100e6);
        assertEq(tod.allowance(alice, address(desk)), 100e6);
    }

    function test_exactMinimumAndNextUnitRedeemButReverseDustIsAllowed() public {
        vm.startPrank(alice);
        desk.swap(true, 10e6, 10e6, block.timestamp);
        desk.swap(true, 10e6 + 1, 10e6 + 1, block.timestamp);
        usdc.approve(address(desk), 1);
        desk.swap(false, 1, 1, block.timestamp);
        vm.stopPrank();
        assertEq(tod.balanceOf(alice), 80e6);
        assertEq(tod.balanceOf(address(desk)), 20e6);
        assertEq(usdc.balanceOf(alice), 20e6);
        assertEq(usdc.balanceOf(address(desk)), 80e6);
    }

    function testFuzz_belowMinimumRedemptionAlwaysReverts(uint256 seed) public {
        uint256 amount = bound(seed, 1, 10e6 - 1);
        vm.prank(alice);
        vm.expectRevert(ToDTestExchange.BelowMinimumRedemption.selector);
        desk.swap(true, amount, amount, block.timestamp);
        assertEq(tod.balanceOf(alice), 100e6);
        assertEq(usdc.balanceOf(address(desk)), 100e6);
        assertEq(tod.allowance(alice, address(desk)), 100e6);
    }

    function test_minimumIsNotARetainedBalance() public {
        address bob = makeAddr("bob");
        tod.mint(bob, 10e6);
        vm.startPrank(bob);
        tod.approve(address(desk), 10e6);
        desk.swap(true, 10e6, 10e6, block.timestamp);
        vm.stopPrank();
        assertEq(tod.balanceOf(bob), 0);
        assertEq(usdc.balanceOf(bob), 10e6);
        assertEq(tod.allowance(bob, address(desk)), 0);
    }

    function test_twentyUsdcReserveSupportsTwoMinimumRedemptionsAndReuse() public {
        ToDTestExchange limited = new ToDTestExchange(address(tod), address(usdc));
        usdc.mint(address(limited), 20e6);
        vm.startPrank(alice);
        tod.approve(address(limited), 30e6);
        limited.swap(true, 10e6, 10e6, block.timestamp);
        limited.swap(true, 10e6, 10e6, block.timestamp);
        vm.expectRevert(ToDTestExchange.InsufficientInventory.selector);
        limited.swap(true, 10e6, 10e6, block.timestamp);
        assertEq(tod.balanceOf(alice), 80e6);
        assertEq(usdc.balanceOf(alice), 20e6);
        assertEq(tod.allowance(alice, address(limited)), 10e6);
        usdc.approve(address(limited), 10e6);
        limited.swap(false, 10e6, 10e6, block.timestamp);
        limited.swap(true, 10e6, 10e6, block.timestamp);
        vm.stopPrank();
        assertEq(tod.balanceOf(alice), 80e6);
        assertEq(usdc.balanceOf(alice), 20e6);
        assertEq(tod.balanceOf(address(limited)), 20e6);
        assertEq(usdc.balanceOf(address(limited)), 0);
        assertEq(tod.allowance(alice, address(limited)), 0);
    }

    function test_mainnetAndInvalidTokensRejected() public {
        vm.chainId(1);
        vm.expectRevert(ToDTestExchange.UnsupportedChain.selector);
        new ToDTestExchange(address(tod), address(usdc));
        vm.chainId(31337);
        vm.expectRevert(ToDTestExchange.InvalidToken.selector);
        new ToDTestExchange(address(tod), address(tod));
        vm.expectRevert(ToDTestExchange.InvalidToken.selector);
        new ToDTestExchange(address(tod), address(0));
        vm.expectRevert(ToDTestExchange.InvalidToken.selector);
        new ToDTestExchange(address(usdc), address(tod));
    }

    function test_transferFeesRevertTheWholeSwapInBothDirections() public {
        FeeTestUSDC feeToken = new FeeTestUSDC();
        ToDTestExchange feeDesk = new ToDTestExchange(address(tod), address(feeToken));
        feeToken.mint(address(feeDesk), 100e6);
        feeToken.mint(alice, 100e6);
        tod.mint(address(feeDesk), 100e6);
        vm.startPrank(alice);
        tod.approve(address(feeDesk), 100e6);
        feeToken.approve(address(feeDesk), 100e6);
        vm.expectRevert(ToDTestExchange.UnsupportedTransfer.selector);
        feeDesk.swap(true, 100e6, 100e6, block.timestamp);
        vm.expectRevert(ToDTestExchange.UnsupportedTransfer.selector);
        feeDesk.swap(false, 100e6, 100e6, block.timestamp);
        vm.stopPrank();
        assertEq(tod.balanceOf(alice), 100e6);
        assertEq(feeToken.balanceOf(alice), 100e6);
        assertEq(tod.balanceOf(address(feeDesk)), 100e6);
        assertEq(feeToken.balanceOf(address(feeDesk)), 100e6);
        assertEq(feeToken.totalSupply(), 200e6);
    }

    function testFuzz_fullDomainRoundTrip(uint256 seed) public {
        uint256 amount = bound(seed, 10e6, type(uint256).max);
        ToDToken t = new ToDToken(address(this), address(this), amount);
        MockUSDC u = new MockUSDC();
        ToDTestExchange d = new ToDTestExchange(address(t), address(u));
        t.mint(alice, amount);
        u.mint(address(d), amount);
        vm.startPrank(alice);
        t.approve(address(d), amount);
        d.swap(true, amount, amount, block.timestamp);
        u.approve(address(d), amount);
        d.swap(false, amount, amount, block.timestamp);
        vm.stopPrank();
        assertEq(t.balanceOf(alice), amount);
        assertEq(u.balanceOf(address(d)), amount);
        assertEq(t.balanceOf(address(d)) + u.balanceOf(alice), 0);
    }
}

contract ToDExchangeHandler is Test {
    ToDToken public immutable tod;
    MockUSDC public immutable usdc;
    ToDTestExchange public immutable desk;
    address[3] public actors = [address(0xC1), address(0xC2), address(0xC3)];
    uint256 public todIn;
    uint256 public todOut;

    constructor(ToDToken t, MockUSDC u, ToDTestExchange d) {
        tod = t;
        usdc = u;
        desk = d;
    }

    function swap(uint256 actorSeed, uint256 amountSeed, bool toUsdc) external {
        address actor = actors[actorSeed % 3];
        uint256 balance = toUsdc ? tod.balanceOf(actor) : usdc.balanceOf(actor);
        uint256 inventory = toUsdc ? usdc.balanceOf(address(desk)) : tod.balanceOf(address(desk));
        uint256 maximum = balance < inventory ? balance : inventory;
        uint256 minimum = toUsdc ? desk.MIN_REDEEM() : 1;
        if (maximum < minimum) return;
        uint256 amount = bound(amountSeed, minimum, maximum);
        vm.prank(actor);
        desk.swap(toUsdc, amount, amount, block.timestamp);
        if (toUsdc) todIn += amount;
        else todOut += amount;
    }
}

contract ToDExchangeInvariantTest is Test {
    ToDToken tod;
    MockUSDC usdc;
    ToDTestExchange desk;
    ToDExchangeHandler handler;
    uint256 constant INVENTORY = 500e6;
    uint256 constant SUPPLY = 800e6;

    function setUp() public {
        tod = new ToDToken(address(this), address(this), SUPPLY);
        usdc = new MockUSDC();
        desk = new ToDTestExchange(address(tod), address(usdc));
        handler = new ToDExchangeHandler(tod, usdc, desk);
        tod.mint(address(desk), INVENTORY);
        usdc.mint(address(desk), INVENTORY);
        for (uint256 i; i < 3; i++) {
            address actor = handler.actors(i);
            tod.mint(actor, 100e6);
            usdc.mint(actor, 100e6);
            vm.startPrank(actor);
            tod.approve(address(desk), type(uint256).max);
            usdc.approve(address(desk), type(uint256).max);
            vm.stopPrank();
        }
        tod.revokeRole(tod.MINTER_ROLE(), address(this));
        handler.swap(0, 20e6, true);
        handler.swap(1, 30e6, false);
        bytes4[] memory selectors = new bytes4[](1);
        selectors[0] = handler.swap.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
        targetContract(address(handler));
    }

    function invariant_bothInventoriesConserveAssetsWithoutDrift() public view {
        uint256 todSum = tod.balanceOf(address(desk));
        uint256 usdcSum = usdc.balanceOf(address(desk));
        for (uint256 i; i < 3; i++) {
            todSum += tod.balanceOf(handler.actors(i));
            usdcSum += usdc.balanceOf(handler.actors(i));
        }
        assertEq(todSum, SUPPLY);
        assertEq(usdcSum, SUPPLY);
        assertEq(tod.totalSupply(), SUPPLY);
        assertEq(usdc.totalSupply(), SUPPLY);
        assertEq(tod.balanceOf(address(desk)), INVENTORY + handler.todIn() - handler.todOut());
        assertEq(usdc.balanceOf(address(desk)), INVENTORY + handler.todOut() - handler.todIn());
    }
}
