// Checks mint authority, cap boundaries and supply conservation across token operations.
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {ERC20Capped} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Capped.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {ToDToken} from "../src/ToDToken.sol";

contract ToDTokenTest is Test {
    ToDToken token;
    address minter = makeAddr("minter");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    uint256 constant CAP = 1_000_000e6;

    function setUp() public {
        token = new ToDToken(address(this), minter, CAP);
    }

    function test_unauthorizedMintCannotCreateSupply() public {
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, alice, keccak256("MINTER_ROLE")
            )
        );
        token.mint(alice, 1);
        assertEq(token.totalSupply(), 0);
    }

    function test_minterCannotGrantItselfAdmin() public {
        vm.prank(minter);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, minter, bytes32(0))
        );
        token.grantRole(bytes32(0), minter);
    }

    function test_revocationStopsMintingButNotTransfers() public {
        vm.prank(minter);
        token.mint(alice, 2e6);
        token.revokeRole(token.MINTER_ROLE(), minter);
        vm.prank(minter);
        vm.expectRevert();
        token.mint(alice, 1);
        vm.prank(alice);
        token.transfer(bob, 1e6);
        assertEq(token.balanceOf(alice) + token.balanceOf(bob), token.totalSupply());
        assertEq(token.balanceOf(bob), 1e6);
    }

    function test_capMinusOneThenExactCapThenOverflow() public {
        vm.startPrank(minter);
        token.mint(alice, CAP - 1);
        token.mint(bob, 1);
        vm.expectRevert(abi.encodeWithSelector(ERC20Capped.ERC20ExceededCap.selector, CAP + 1, CAP));
        token.mint(alice, 1);
        vm.stopPrank();
        assertEq(token.balanceOf(alice) + token.balanceOf(bob), CAP);
    }

    function test_zeroRolesRejected() public {
        vm.expectRevert(ToDToken.InvalidRoleAddress.selector);
        new ToDToken(address(0), minter, CAP);
        vm.expectRevert(ToDToken.InvalidRoleAddress.selector);
        new ToDToken(address(this), address(0), CAP);
    }

    function test_zeroCapRejected() public {
        vm.expectRevert(abi.encodeWithSelector(ERC20Capped.ERC20InvalidCap.selector, 0));
        new ToDToken(address(this), minter, 0);
    }

    function test_zeroRecipientCannotConsumeCap() public {
        vm.prank(minter);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InvalidReceiver.selector, address(0)));
        token.mint(address(0), 1);
        assertEq(token.totalSupply(), 0);
    }

    function test_newMinterCanUseOnlyRemainingSupply() public {
        token.grantRole(token.MINTER_ROLE(), bob);
        vm.prank(minter);
        token.mint(alice, CAP - 1);
        vm.prank(bob);
        token.mint(bob, 1);
        vm.prank(bob);
        vm.expectRevert();
        token.mint(bob, 1);
        assertEq(token.balanceOf(alice) + token.balanceOf(bob), CAP);
    }

    function testFuzz_anyCapAndSplitCannotIssueBeyondCap(uint256 capSeed, uint256 splitSeed) public {
        uint256 cap = bound(capSeed, 1, type(uint256).max);
        uint256 first = bound(splitSeed, 0, cap);
        ToDToken custom = new ToDToken(address(this), minter, cap);
        vm.startPrank(minter);
        custom.mint(alice, first);
        custom.mint(bob, cap - first);
        vm.expectRevert();
        custom.mint(alice, 1);
        vm.stopPrank();
        assertEq(custom.balanceOf(alice) + custom.balanceOf(bob), custom.totalSupply());
        assertEq(custom.totalSupply(), cap);
    }
}

contract ToDTokenHandler is Test {
    ToDToken public immutable token;
    address[3] public actors = [address(0xA1), address(0xA2), address(0xA3)];
    uint256 public issued;
    uint256 public mintCalls;
    uint256 public transferCalls;

    constructor(ToDToken token_) {
        token = token_;
    }

    function mint(uint256 amountSeed, uint256 actorSeed) external {
        uint256 remaining = token.cap() - token.totalSupply();
        if (remaining == 0) return;
        uint256 amount = bound(amountSeed, 1, remaining);
        token.mint(actors[actorSeed % 3], amount);
        issued += amount;
        mintCalls++;
    }

    function transfer(uint256 amountSeed, uint256 fromSeed, uint256 toSeed) external {
        address from = actors[fromSeed % 3];
        uint256 balance = token.balanceOf(from);
        if (balance == 0) return;
        vm.prank(from);
        token.transfer(actors[toSeed % 3], bound(amountSeed, 0, balance));
        transferCalls++;
    }
}

contract ToDTokenInvariantTest is Test {
    ToDToken token;
    ToDTokenHandler handler;

    function setUp() public {
        token = new ToDToken(address(this), address(this), 1_000_000e6);
        handler = new ToDTokenHandler(token);
        token.grantRole(token.MINTER_ROLE(), address(handler));
        token.revokeRole(token.MINTER_ROLE(), address(this));
        handler.mint(100, 0);
        handler.mint(200, 1);
        handler.transfer(1, 0, 2);
        bytes4[] memory selectors = new bytes4[](2);
        selectors[0] = handler.mint.selector;
        selectors[1] = handler.transfer.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
        targetContract(address(handler));
    }

    function invariant_supplyMatchesBalancesAndSuccessfulIssuance() public view {
        uint256 sum;
        for (uint256 i; i < 3; i++) {
            sum += token.balanceOf(handler.actors(i));
        }
        assertEq(sum, token.totalSupply());
        assertEq(sum, handler.issued());
        assertLe(sum, token.cap());
    }
}
