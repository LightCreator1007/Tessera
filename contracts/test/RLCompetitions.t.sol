// Checks RL competitions: hidden seeds, policy commit and reveal, k-of-n verifier scores, ties, payout and fallbacks.
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {RLCompetitions} from "../src/RLCompetitions.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

contract RLCompetitionsTest is Test {
    MockUSDC token;
    RLCompetitions comps;
    uint256 constant ADMITTER = 301;
    uint256 constant HOST = 302;
    uint256 constant ALICE = 303;
    uint256 constant BOB = 304;
    uint256 constant V1 = 311;
    uint256 constant V2 = 312;
    uint256 constant V3 = 313;
    uint256 constant STRANGER = 399;
    uint32 constant WINDOW = 120;
    uint256 constant PRIZE = 50e6;
    bytes32 constant ENV = keccak256("env package");
    bytes32 constant SSALT = keccak256("seeds salt");
    bytes32 constant APOL = keccak256("alice policy");
    bytes32 constant BPOL = keccak256("bob policy");

    function setUp() public {
        token = new MockUSDC();
        address[] memory vs = new address[](3);
        (vs[0], vs[1], vs[2]) = (vm.addr(V1), vm.addr(V2), vm.addr(V3));
        comps = new RLCompetitions(address(token), vm.addr(ADMITTER), vs, 2);
        token.mint(vm.addr(HOST), 1_000e6);
        vm.prank(vm.addr(HOST));
        token.approve(address(comps), type(uint256).max);
    }

    function _seeds() internal pure returns (uint64[] memory s) {
        s = new uint64[](3);
        (s[0], s[1], s[2]) = (7, 11, 13);
    }

    function _seedsHash(uint64[] memory s, bytes32 salt) internal pure returns (bytes32) {
        return keccak256(abi.encode(keccak256(abi.encode(s)), salt));
    }

    function _pass(uint256 key) internal view returns (bytes32 nullifier, uint64 deadline, bytes memory sig) {
        nullifier = keccak256(abi.encode("human", key));
        deadline = uint64(block.timestamp + 1 days);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ADMITTER, comps.passHash(vm.addr(key), nullifier, deadline));
        sig = abi.encodePacked(r, s, v);
    }

    function _create() internal returns (uint256 id) {
        (bytes32 n, uint64 d, bytes memory sig) = _pass(HOST);
        vm.prank(vm.addr(HOST));
        id = comps.create(
            PRIZE, ENV, 5, 500, _seedsHash(_seeds(), SSALT), uint64(block.timestamp + 1 hours), WINDOW, "{}", n, d, sig
        );
    }

    function _commit(uint256 id, uint256 key, bytes32 policy) internal pure returns (bytes32) {
        return keccak256(abi.encode(id, vm.addr(key), policy, keccak256(abi.encode("salt", key))));
    }

    function _enter(uint256 id, uint256 key, bytes32 policy) internal {
        (bytes32 n, uint64 d, bytes memory sig) = _pass(key);
        vm.prank(vm.addr(key));
        comps.enter(id, _commit(id, key, policy), n, d, sig);
    }

    function _revealPolicy(uint256 id, uint256 key, bytes32 policy) internal {
        comps.revealPolicy(id, vm.addr(key), policy, keccak256(abi.encode("salt", key)));
    }

    function _sigs(uint256 id, uint256 entrant, bytes32 policy, int64 score, uint256[] memory keys)
        internal
        view
        returns (bytes[] memory sigs)
    {
        sigs = new bytes[](keys.length);
        bytes32 digest = comps.evalHash(id, vm.addr(entrant), policy, score);
        for (uint256 i; i < keys.length; i++) {
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(keys[i], digest);
            sigs[i] = abi.encodePacked(r, s, v);
        }
    }

    function _two(uint256 a, uint256 b) internal pure returns (uint256[] memory k) {
        k = new uint256[](2);
        (k[0], k[1]) = (a, b);
    }

    /// Two entrants, past the deadline, seeds and both policies revealed.
    function _ready() internal returns (uint256 id) {
        id = _create();
        _enter(id, ALICE, APOL);
        _enter(id, BOB, BPOL);
        vm.warp(block.timestamp + 1 hours);
        comps.revealSeeds(id, _seeds(), SSALT);
        _revealPolicy(id, ALICE, APOL);
        _revealPolicy(id, BOB, BPOL);
    }

    function test_rejectsBadVerifierSets() public {
        address[] memory none = new address[](0);
        vm.expectRevert(RLCompetitions.BadInput.selector);
        new RLCompetitions(address(token), vm.addr(ADMITTER), none, 1);
        address[] memory dup = new address[](2);
        (dup[0], dup[1]) = (vm.addr(V1), vm.addr(V1));
        vm.expectRevert(RLCompetitions.BadInput.selector);
        new RLCompetitions(address(token), vm.addr(ADMITTER), dup, 1);
    }

    function test_createChecksTerms() public {
        (bytes32 n, uint64 d, bytes memory sig) = _pass(HOST);
        uint64 later = uint64(block.timestamp + 1 hours);
        vm.startPrank(vm.addr(HOST));
        vm.expectRevert(RLCompetitions.BadInput.selector);
        comps.create(PRIZE, bytes32(0), 5, 500, keccak256("s"), later, WINDOW, "", n, d, sig);
        vm.expectRevert(RLCompetitions.BadInput.selector);
        comps.create(PRIZE, ENV, 0, 500, keccak256("s"), later, WINDOW, "", n, d, sig);
        vm.expectRevert(RLCompetitions.BadInput.selector);
        comps.create(PRIZE, ENV, 5, 2_000_000, keccak256("s"), later, WINDOW, "", n, d, sig);
        vm.expectRevert(RLCompetitions.BadInput.selector);
        comps.create(PRIZE, ENV, 5, 500, keccak256("s"), later, 30, "", n, d, sig);
        vm.stopPrank();
        uint256 id = _create();
        assertEq(token.balanceOf(address(comps)), PRIZE);
        RLCompetitions.Competition memory c = comps.competition(id);
        assertEq(c.env, ENV);
        assertEq(c.episodes, 5);
        assertEq(c.maxSteps, 500);
    }

    function test_hostCannotEnterAndEntriesClose() public {
        uint256 id = _create();
        (bytes32 n, uint64 d, bytes memory sig) = _pass(HOST);
        vm.prank(vm.addr(HOST));
        vm.expectRevert(RLCompetitions.HostCannotEnter.selector);
        comps.enter(id, keccak256("x"), n, d, sig);
        _enter(id, ALICE, keccak256("first try"));
        _enter(id, ALICE, APOL); // a replacement keeps one entry
        assertEq(comps.competition(id).entries, 1);
        vm.warp(block.timestamp + 1 hours);
        (n, d, sig) = _pass(BOB);
        vm.prank(vm.addr(BOB));
        vm.expectRevert(RLCompetitions.Closed.selector);
        comps.enter(id, keccak256("late"), n, d, sig);
    }

    function test_seedsMustMatchAndComeInTime() public {
        uint256 id = _create();
        vm.expectRevert(RLCompetitions.NotYet.selector);
        comps.revealSeeds(id, _seeds(), SSALT);
        vm.warp(block.timestamp + 1 hours);
        uint64[] memory other = _seeds();
        other[0] = 8;
        vm.expectRevert(RLCompetitions.WrongReveal.selector);
        comps.revealSeeds(id, other, SSALT);
        vm.expectRevert(RLCompetitions.WrongReveal.selector);
        comps.revealSeeds(id, _seeds(), keccak256("wrong salt"));
        vm.warp(block.timestamp + WINDOW);
        vm.expectRevert(RLCompetitions.TooLate.selector);
        comps.revealSeeds(id, _seeds(), SSALT);
    }

    function test_policyRevealNeedsSeedsAndTheCommit() public {
        uint256 id = _create();
        _enter(id, ALICE, APOL);
        vm.warp(block.timestamp + 1 hours);
        vm.expectRevert(RLCompetitions.NotYet.selector);
        _revealPolicy(id, ALICE, APOL);
        comps.revealSeeds(id, _seeds(), SSALT);
        assertEq(comps.seedsOf(id).length, 3);
        vm.expectRevert(RLCompetitions.WrongReveal.selector);
        _revealPolicy(id, ALICE, BPOL);
        _revealPolicy(id, ALICE, APOL);
        assertEq(comps.entry(id, vm.addr(ALICE)).policy, APOL);
        vm.expectRevert(RLCompetitions.AlreadyDone.selector);
        _revealPolicy(id, ALICE, APOL);
    }

    function test_scoreNeedsThresholdOfDistinctVerifiers() public {
        uint256 id = _ready();
        uint256[] memory one = new uint256[](1);
        one[0] = V1;
        bytes[] memory s1 = _sigs(id, ALICE, APOL, 195_500, one);
        vm.expectRevert(RLCompetitions.BadSignature.selector);
        comps.submitScore(id, vm.addr(ALICE), 195_500, s1);
        bytes[] memory s2 = _sigs(id, ALICE, APOL, 195_500, _two(V1, V1));
        vm.expectRevert(RLCompetitions.BadSignature.selector);
        comps.submitScore(id, vm.addr(ALICE), 195_500, s2);
        bytes[] memory s3 = _sigs(id, ALICE, APOL, 195_500, _two(V1, STRANGER));
        vm.expectRevert(RLCompetitions.BadSignature.selector);
        comps.submitScore(id, vm.addr(ALICE), 195_500, s3);
        // signatures over another score don't carry over
        bytes[] memory s4 = _sigs(id, ALICE, APOL, 195_500, _two(V1, V2));
        vm.expectRevert(RLCompetitions.BadSignature.selector);
        comps.submitScore(id, vm.addr(ALICE), 500_000, s4);
        comps.submitScore(id, vm.addr(ALICE), 195_500, _sigs(id, ALICE, APOL, 195_500, _two(V1, V3)));
        assertTrue(comps.entry(id, vm.addr(ALICE)).scored);
        bytes[] memory s5 = _sigs(id, ALICE, APOL, 195_500, _two(V1, V2));
        vm.expectRevert(RLCompetitions.AlreadyDone.selector);
        comps.submitScore(id, vm.addr(ALICE), 195_500, s5);
    }

    function test_unrevealedPolicyCantBeScored() public {
        uint256 id = _create();
        _enter(id, ALICE, APOL);
        vm.warp(block.timestamp + 1 hours);
        comps.revealSeeds(id, _seeds(), SSALT);
        bytes[] memory s6 = _sigs(id, ALICE, APOL, 1, _two(V1, V2));
        vm.expectRevert(RLCompetitions.NotEntered.selector);
        comps.submitScore(id, vm.addr(ALICE), 1, s6);
    }

    function test_bestScoreWinsAndNegativeReturnsCount() public {
        uint256 id = _ready();
        comps.submitScore(id, vm.addr(ALICE), -40_000, _sigs(id, ALICE, APOL, -40_000, _two(V1, V2)));
        comps.submitScore(id, vm.addr(BOB), -12_500, _sigs(id, BOB, BPOL, -12_500, _two(V2, V3)));
        vm.expectRevert(RLCompetitions.NotYet.selector);
        comps.settle(id);
        vm.warp(block.timestamp + 2 * WINDOW);
        bytes[] memory s7 = _sigs(id, BOB, BPOL, 0, _two(V2, V3));
        vm.expectRevert(RLCompetitions.TooLate.selector);
        comps.submitScore(id, vm.addr(BOB), 0, s7);
        comps.settle(id);
        assertEq(token.balanceOf(vm.addr(BOB)), PRIZE);
    }

    function test_tieGoesToEarlierCommit() public {
        uint256 id = _ready();
        comps.submitScore(id, vm.addr(BOB), 100, _sigs(id, BOB, BPOL, 100, _two(V1, V2)));
        comps.submitScore(id, vm.addr(ALICE), 100, _sigs(id, ALICE, APOL, 100, _two(V1, V2)));
        assertEq(comps.competition(id).best, vm.addr(ALICE));
    }

    function test_nothingScoredRefundsHost() public {
        uint256 id = _ready();
        uint256 before = token.balanceOf(vm.addr(HOST));
        vm.warp(block.timestamp + 2 * WINDOW);
        comps.settle(id);
        assertEq(token.balanceOf(vm.addr(HOST)) - before, PRIZE);
        vm.expectRevert(RLCompetitions.AlreadyDone.selector);
        comps.settle(id);
    }

    function test_hiddenSeedsSplitThePrize() public {
        uint256 id = _create();
        _enter(id, ALICE, APOL);
        _enter(id, BOB, BPOL);
        vm.warp(block.timestamp + 1 hours);
        vm.expectRevert(RLCompetitions.NotYet.selector);
        vm.prank(vm.addr(ALICE));
        comps.claimShare(id);
        vm.warp(block.timestamp + WINDOW);
        vm.expectRevert(RLCompetitions.AlreadyDone.selector);
        comps.settle(id);
        vm.prank(vm.addr(ALICE));
        comps.claimShare(id);
        vm.prank(vm.addr(BOB));
        comps.claimShare(id);
        assertEq(token.balanceOf(vm.addr(ALICE)), PRIZE / 2);
        assertEq(token.balanceOf(vm.addr(BOB)), PRIZE / 2);
        vm.prank(vm.addr(BOB));
        vm.expectRevert(RLCompetitions.AlreadyDone.selector);
        comps.claimShare(id);
    }
}
