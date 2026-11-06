// Checks competitions: passes, one entry per person, commit and reveal, onchain scoring, payout and fallbacks.
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {Competitions} from "../src/Competitions.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

contract CompetitionsTest is Test {
    MockUSDC token;
    Competitions comps;
    uint256 constant ADMITTER = 201;
    uint256 constant HOST = 202;
    uint256 constant ALICE = 203;
    uint256 constant BOB = 204;
    uint256 constant ALICE_2 = 205; // Alice's second wallet
    uint32 constant ITEMS = 8;
    uint32 constant WINDOW = 120;
    uint256 constant PRIZE = 50e6;
    bytes constant LABELS = hex"0001020304050607";
    bytes32 constant LSALT = keccak256("labels salt");

    function setUp() public {
        token = new MockUSDC();
        comps = new Competitions(address(token), vm.addr(ADMITTER));
        token.mint(vm.addr(HOST), 1_000e6);
        vm.prank(vm.addr(HOST));
        token.approve(address(comps), type(uint256).max);
    }

    function _human(uint256 key) internal pure returns (bytes32) {
        return keccak256(abi.encode("human", key == ALICE_2 ? ALICE : key));
    }

    function _pass(uint256 key) internal view returns (bytes32 nullifier, uint64 deadline, bytes memory sig) {
        nullifier = _human(key);
        deadline = uint64(block.timestamp + 1 days);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ADMITTER, comps.passHash(vm.addr(key), nullifier, deadline));
        sig = abi.encodePacked(r, s, v);
    }

    function _create() internal returns (uint256 id) {
        (bytes32 n, uint64 d, bytes memory sig) = _pass(HOST);
        vm.prank(vm.addr(HOST));
        id = comps.create(PRIZE, keccak256(abi.encode(keccak256(LABELS), LSALT)), uint64(block.timestamp + 1 hours),
            WINDOW, ITEMS, '{"title":"digits"}', n, d, sig);
    }

    function _commit(uint256 id, uint256 key, bytes memory preds) internal pure returns (bytes32) {
        return keccak256(abi.encode(id, vm.addr(key), keccak256(preds), keccak256(abi.encode("salt", key))));
    }

    function _enter(uint256 id, uint256 key, bytes memory preds) internal {
        (bytes32 n, uint64 d, bytes memory sig) = _pass(key);
        vm.prank(vm.addr(key));
        comps.enter(id, _commit(id, key, preds), n, d, sig);
    }

    function _revealEntry(uint256 id, uint256 key, bytes memory preds) internal {
        comps.revealEntry(id, vm.addr(key), preds, keccak256(abi.encode("salt", key)));
    }

    function test_best_score_wins_the_prize() public {
        uint256 id = _create();
        _enter(id, ALICE, hex"0001020304050000"); // 6 of 8
        _enter(id, BOB, hex"0001020304050607"); // 8 of 8
        vm.warp(block.timestamp + 1 hours);
        comps.revealLabels(id, LABELS, LSALT);
        _revealEntry(id, ALICE, hex"0001020304050000");
        _revealEntry(id, BOB, hex"0001020304050607");
        Competitions.Competition memory c = comps.competition(id);
        assertEq(c.best, vm.addr(BOB));
        assertEq(c.bestScore, 8);
        vm.expectRevert(Competitions.NotYet.selector);
        comps.settle(id);
        vm.warp(block.timestamp + WINDOW);
        comps.settle(id);
        assertEq(token.balanceOf(vm.addr(BOB)), PRIZE);
        vm.expectRevert(Competitions.AlreadyDone.selector);
        comps.settle(id);
    }

    function test_a_tie_goes_to_the_earlier_commit() public {
        uint256 id = _create();
        _enter(id, ALICE, LABELS);
        _enter(id, BOB, LABELS);
        vm.warp(block.timestamp + 1 hours);
        comps.revealLabels(id, LABELS, LSALT);
        _revealEntry(id, BOB, LABELS); // revealed first, committed second
        _revealEntry(id, ALICE, LABELS);
        assertEq(comps.competition(id).best, vm.addr(ALICE));
    }

    function test_the_host_cannot_enter_their_own_competition() public {
        uint256 id = _create();
        (bytes32 n, uint64 d, bytes memory sig) = _pass(HOST);
        vm.prank(vm.addr(HOST));
        vm.expectRevert(Competitions.HostCannotEnter.selector);
        comps.enter(id, bytes32(uint256(1)), n, d, sig);
    }

    function test_one_entry_per_person_but_it_can_be_replaced() public {
        uint256 id = _create();
        _enter(id, ALICE, hex"0000000000000000");
        _enter(id, ALICE, LABELS); // a new commit replaces the first
        assertEq(comps.competition(id).entries, 1);
        (bytes32 n, uint64 d, bytes memory sig) = _pass(ALICE_2); // same human, second wallet
        vm.prank(vm.addr(ALICE_2));
        vm.expectRevert(Competitions.AlreadyEntered.selector);
        comps.enter(id, bytes32(uint256(1)), n, d, sig);
    }

    function test_a_pass_must_come_from_the_admitter_for_this_wallet() public {
        uint256 id = _create();
        (bytes32 n, uint64 d, bytes memory sig) = _pass(ALICE);
        vm.prank(vm.addr(BOB)); // Alice's pass, Bob's wallet
        vm.expectRevert(Competitions.BadPass.selector);
        comps.enter(id, bytes32(uint256(1)), n, d, sig);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(BOB, comps.passHash(vm.addr(BOB), n, d)); // self-signed
        vm.prank(vm.addr(BOB));
        vm.expectRevert(Competitions.BadPass.selector);
        comps.enter(id, bytes32(uint256(1)), n, d, abi.encodePacked(r, s, v));
    }

    function test_reveals_must_match_their_commits_and_windows() public {
        uint256 id = _create();
        _enter(id, ALICE, LABELS);
        vm.expectRevert(Competitions.NotYet.selector);
        comps.revealLabels(id, LABELS, LSALT);
        vm.warp(block.timestamp + 1 hours);
        (bytes32 n, uint64 d, bytes memory sig) = _pass(BOB);
        bytes32 commit = _commit(id, BOB, LABELS);
        vm.prank(vm.addr(BOB));
        vm.expectRevert(Competitions.Closed.selector);
        comps.enter(id, commit, n, d, sig);
        vm.expectRevert(Competitions.WrongReveal.selector);
        comps.revealLabels(id, hex"0000000000000000", LSALT);
        comps.revealLabels(id, LABELS, LSALT);
        vm.expectRevert(Competitions.WrongReveal.selector);
        _revealEntry(id, ALICE, hex"0001020304050600"); // not what Alice committed
        vm.expectRevert(Competitions.NotEntered.selector);
        _revealEntry(id, BOB, LABELS);
        vm.warp(block.timestamp + WINDOW);
        vm.expectRevert(Competitions.TooLate.selector);
        _revealEntry(id, ALICE, LABELS);
    }

    function test_hidden_labels_split_the_prize_between_entrants() public {
        uint256 id = _create();
        _enter(id, ALICE, LABELS);
        _enter(id, BOB, LABELS);
        vm.warp(block.timestamp + 1 hours + WINDOW);
        vm.expectRevert(Competitions.AlreadyDone.selector);
        comps.settle(id); // the host can't take the prize back by hiding the labels
        vm.prank(vm.addr(ALICE));
        comps.claimShare(id);
        vm.prank(vm.addr(BOB));
        comps.claimShare(id);
        assertEq(token.balanceOf(vm.addr(ALICE)), PRIZE / 2);
        assertEq(token.balanceOf(vm.addr(BOB)), PRIZE / 2);
        vm.prank(vm.addr(BOB));
        vm.expectRevert(Competitions.AlreadyDone.selector);
        comps.claimShare(id);
    }

    function test_the_host_is_refunded_when_nothing_was_scored() public {
        uint256 host0 = token.balanceOf(vm.addr(HOST));
        uint256 empty = _create(); // no entries at all
        uint256 unrevealed = _create(); // an entry nobody revealed
        _enter(unrevealed, ALICE, LABELS);
        vm.warp(block.timestamp + 1 hours + WINDOW);
        comps.settle(empty);
        vm.warp(block.timestamp - WINDOW);
        comps.revealLabels(unrevealed, LABELS, LSALT);
        vm.warp(block.timestamp + WINDOW);
        comps.settle(unrevealed);
        assertEq(token.balanceOf(vm.addr(HOST)), host0);
    }

    function test_create_rejects_bad_parameters() public {
        (bytes32 n, uint64 d, bytes memory sig) = _pass(HOST);
        bytes32 h = keccak256(abi.encode(keccak256(LABELS), LSALT));
        uint64 later = uint64(block.timestamp + 1 hours);
        vm.startPrank(vm.addr(HOST));
        vm.expectRevert(Competitions.BadInput.selector);
        comps.create(1, h, later, WINDOW, ITEMS, "", n, d, sig); // under the minimum prize
        vm.expectRevert(Competitions.BadInput.selector);
        comps.create(PRIZE, h, later, 10, ITEMS, "", n, d, sig); // window too short
        vm.expectRevert(Competitions.BadInput.selector);
        comps.create(PRIZE, h, later, WINDOW, 10_001, "", n, d, sig); // too many items
        vm.stopPrank();
    }

    function testFuzz_score_counts_matching_bytes(bytes8 preds) public {
        uint256 id = _create();
        bytes memory p = abi.encodePacked(preds);
        _enter(id, ALICE, p);
        vm.warp(block.timestamp + 1 hours);
        comps.revealLabels(id, LABELS, LSALT);
        _revealEntry(id, ALICE, p);
        uint32 want;
        for (uint256 i; i < ITEMS; i++) {
            if (p[i] == LABELS[i]) want++;
        }
        assertEq(comps.competition(id).bestScore, want);
    }

    function test_scoring_ten_thousand_items_fits_in_a_block() public {
        bytes memory big = new bytes(10_000);
        bytes32 salt = keccak256("big");
        (bytes32 n, uint64 d, bytes memory sig) = _pass(HOST);
        vm.prank(vm.addr(HOST));
        uint256 id = comps.create(PRIZE, keccak256(abi.encode(keccak256(big), salt)), uint64(block.timestamp + 1),
            WINDOW, 10_000, "", n, d, sig);
        _enter(id, ALICE, big);
        vm.warp(block.timestamp + 1);
        comps.revealLabels(id, big, salt);
        uint256 g = gasleft();
        _revealEntry(id, ALICE, big);
        assertLt(g - gasleft(), 15_000_000);
        assertEq(comps.competition(id).bestScore, 10_000);
    }
}
