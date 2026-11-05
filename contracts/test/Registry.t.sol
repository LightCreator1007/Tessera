// Checks signed admission, owner permissions and market-controlled stake transitions.
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {NodeRegistry} from "../src/NodeRegistry.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {INodeRegistry} from "../src/INodeRegistry.sol";
import {Encodings} from "../src/Encodings.sol";

contract RegistryTest is Test {
    MockUSDC token;
    NodeRegistry registry;
    uint256 constant ADMITTER = 101;
    uint256 constant OWNER = 102;
    uint256 constant OPERATOR = 103;
    bytes32 constant NULLIFIER = keccak256("registry-test-human");

    function setUp() public {
        token = new MockUSDC();
        registry = new NodeRegistry(address(token), vm.addr(ADMITTER), 10);
        registry.setMarket(address(this));
    }

    function _signature(uint256 key, bytes32 structHash) internal view returns (bytes memory) {
        bytes32 ds = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("ToD"),
                keccak256("1"),
                block.chainid,
                address(registry)
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, MessageHashUtils.toTypedDataHash(ds, structHash));
        return abi.encodePacked(r, s, v);
    }

    function _signatures(uint256 ownerKey, uint256 operatorKey, uint64 inviteDeadline, uint64 consentDeadline)
        internal
        view
        returns (bytes memory invite, bytes memory consent)
    {
        address owner = vm.addr(ownerKey);
        address operator = vm.addr(operatorKey);
        invite = _signature(ADMITTER, Encodings.inviteHash(operator, owner, NULLIFIER, inviteDeadline));
        consent = _signature(operatorKey, Encodings.consentHash(owner, operator, consentDeadline));
    }

    function _join(uint256 ownerKey, uint256 operatorKey) internal {
        uint64 deadline = uint64(block.timestamp + 60);
        (bytes memory invite, bytes memory consent) = _signatures(ownerKey, operatorKey, deadline, deadline);
        vm.prank(vm.addr(ownerKey));
        registry.join(vm.addr(operatorKey), NULLIFIER, deadline, deadline, invite, consent);
    }

    function _stake() internal {
        _join(OWNER, OPERATOR);
        token.mint(vm.addr(OWNER), 100e6);
        vm.startPrank(vm.addr(OWNER));
        token.approve(address(registry), 100e6);
        registry.depositStake(vm.addr(OPERATOR), 100e6);
        vm.stopPrank();
    }

    function _busy() internal {
        address[] memory operators = new address[](1);
        operators[0] = vm.addr(OPERATOR);
        registry.markBusy(operators, 1, 1);
    }

    function test_idleWithdrawalConservesTokens() public {
        _stake();
        vm.prank(vm.addr(OWNER));
        registry.withdrawStake(vm.addr(OPERATOR), 100e6);
        assertEq(token.balanceOf(vm.addr(OWNER)), 100e6);
        assertEq(token.balanceOf(address(registry)), 0);
    }

    function test_busyStakeCannotBeWithdrawn() public {
        _stake();
        _busy();
        vm.prank(vm.addr(OWNER));
        vm.expectRevert(INodeRegistry.NodeIsBusy.selector);
        registry.withdrawStake(vm.addr(OPERATOR), 1);
    }

    function test_nullifierCannotBeClaimedByAnotherOwner() public {
        _join(OWNER, OPERATOR);
        uint64 deadline = uint64(block.timestamp + 60);
        (bytes memory invite, bytes memory consent) = _signatures(OWNER + 10, OPERATOR + 10, deadline, deadline);
        vm.prank(vm.addr(OWNER + 10));
        vm.expectRevert(INodeRegistry.NullifierUsed.selector);
        registry.join(vm.addr(OPERATOR + 10), NULLIFIER, deadline, deadline, invite, consent);
    }

    function test_consentExpiryIsSeparateFromInviteExpiry() public {
        uint64 inviteDeadline = uint64(block.timestamp + 120);
        uint64 consentDeadline = uint64(block.timestamp + 60);
        (bytes memory invite, bytes memory consent) = _signatures(OWNER, OPERATOR, inviteDeadline, consentDeadline);
        vm.warp(consentDeadline + 1);
        vm.prank(vm.addr(OWNER));
        vm.expectRevert(INodeRegistry.Expired.selector);
        registry.join(vm.addr(OPERATOR), NULLIFIER, inviteDeadline, consentDeadline, invite, consent);
    }

    function test_signatureCannotBeReplayedOnAnotherChain() public {
        uint64 deadline = uint64(block.timestamp + 60);
        (bytes memory invite, bytes memory consent) = _signatures(OWNER, OPERATOR, deadline, deadline);
        vm.chainId(block.chainid + 1);
        vm.prank(vm.addr(OWNER));
        vm.expectRevert(INodeRegistry.BadSignature.selector);
        registry.join(vm.addr(OPERATOR), NULLIFIER, deadline, deadline, invite, consent);
    }

    function test_onlyOwnerCanWithdraw() public {
        _stake();
        vm.prank(vm.addr(OPERATOR));
        vm.expectRevert(INodeRegistry.NotAuthorized.selector);
        registry.withdrawStake(vm.addr(OPERATOR), 1);
    }

    function test_slashCannotExceedStake() public {
        _stake();
        _busy();
        assertEq(registry.slash(vm.addr(OPERATOR), 1, 1, 200e6), 100e6);
        assertEq(token.balanceOf(address(this)), 100e6);
        assertEq(registry.getNode(vm.addr(OPERATOR)).stake, 0);
    }

    function test_nonMarketCannotCreditWork() public {
        vm.prank(vm.addr(OWNER));
        vm.expectRevert(INodeRegistry.NotAuthorized.selector);
        registry.creditWork(vm.addr(OWNER), 1, 1, 100);
    }
}
