// Prediction competitions with no admin: the host locks a prize and a labels hash, and the contract scores entries.
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

/// Who moves each competition along, and why:
/// - create: the host, who wants the competition. Locks the prize.
/// - enter: an entrant, who wants to win. A commit can be replaced until the deadline.
/// - revealLabels: anyone with the labels and salt, normally the host, within revealWindow after the deadline.
///   If nobody does, every entrant may claimShare an equal part of the prize, so a host gains nothing by hiding them.
/// - revealEntry: anyone with an entrant's predictions and salt, within revealWindow after the labels. Only a
///   revealed entry is scored.
/// - settle: anyone, once the entry window closes. Pays the best score, or refunds the host if nothing was scored.
contract Competitions is EIP712, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    bytes32 internal constant PASS_TYPEHASH = keccak256("EntryPass(address wallet,bytes32 nullifier,uint64 deadline)");
    uint256 public constant MIN_PRIZE = 1e6; // 1 TOD, so the listing isn't free to spam
    uint32 public constant MAX_ITEMS = 10_000; // keeps revealEntry's scoring loop within a few million gas
    uint32 public constant MIN_WINDOW = 60;
    uint32 public constant MAX_WINDOW = 7 days;

    struct Competition {
        address host;
        uint64 deadline;
        uint32 revealWindow;
        uint32 items;
        uint256 prize;
        bytes32 labelsHash;
        bytes32 hostNullifier;
        uint64 labelsRevealedAt;
        uint32 entries;
        uint32 scored;
        address best;
        uint32 bestScore;
        uint64 bestSeq;
        bool settled;
    }

    struct Entry {
        bytes32 commit;
        uint64 seq; // order of the latest commit; ties go to the earlier one
        bool revealed;
        bool shareClaimed;
    }

    IERC20 public immutable token;
    address public immutable admitter;

    uint256 public count;
    uint64 private _seq;
    mapping(uint256 => Competition) private _competitions;
    mapping(uint256 => bytes) private _labels;
    mapping(uint256 => mapping(address => Entry)) private _entries;
    mapping(uint256 => mapping(bytes32 => address)) public entrantOf; // one wallet per person per competition

    event Created(
        uint256 indexed id, address indexed host, uint256 prize, uint64 deadline, uint32 revealWindow, uint32 items,
        bytes32 labelsHash, string meta
    );
    event Entered(uint256 indexed id, address indexed entrant, bytes32 commit);
    event LabelsRevealed(uint256 indexed id, bytes labels);
    event EntryScored(uint256 indexed id, address indexed entrant, uint32 score);
    event Settled(uint256 indexed id, address indexed to, uint256 amount, bool refunded);
    event ShareClaimed(uint256 indexed id, address indexed entrant, uint256 amount);

    error BadInput();
    error BadPass();
    error NotOpen();
    error Closed();
    error NotYet();
    error TooLate();
    error HostCannotEnter();
    error AlreadyEntered();
    error NotEntered();
    error WrongReveal();
    error AlreadyDone();

    // Same domain name as NodeRegistry; the domain also names this contract, so a pass is only good here.
    constructor(address token_, address admitter_) EIP712("ToD", "1") {
        if (token_ == address(0) || admitter_ == address(0)) revert BadInput();
        token = IERC20(token_);
        admitter = admitter_;
    }

    /// labelsHash = keccak256(abi.encode(keccak256(labels), salt)). The id isn't known yet, so it isn't part of it.
    function create(
        uint256 prize,
        bytes32 labelsHash,
        uint64 deadline,
        uint32 revealWindow,
        uint32 items,
        string calldata meta,
        bytes32 nullifier,
        uint64 passDeadline,
        bytes calldata passSig
    ) external nonReentrant returns (uint256 id) {
        if (prize < MIN_PRIZE || labelsHash == bytes32(0) || deadline <= block.timestamp) revert BadInput();
        if (revealWindow < MIN_WINDOW || revealWindow > MAX_WINDOW) revert BadInput();
        if (items == 0 || items > MAX_ITEMS) revert BadInput();
        _checkPass(msg.sender, nullifier, passDeadline, passSig);
        id = ++count;
        _competitions[id] = Competition({
            host: msg.sender, deadline: deadline, revealWindow: revealWindow, items: items, prize: prize,
            labelsHash: labelsHash, hostNullifier: nullifier, labelsRevealedAt: 0, entries: 0, scored: 0,
            best: address(0), bestScore: 0, bestSeq: 0, settled: false
        });
        emit Created(id, msg.sender, prize, deadline, revealWindow, items, labelsHash, meta);
        // A token that takes a fee would leave less than the prize here, so require the full amount to arrive.
        uint256 before = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), prize);
        if (token.balanceOf(address(this)) - before != prize) revert BadInput();
    }

    /// commit = keccak256(abi.encode(id, entrant, keccak256(predictions), salt)), so nobody can reuse another's commit.
    function enter(uint256 id, bytes32 commit, bytes32 nullifier, uint64 passDeadline, bytes calldata passSig)
        external
    {
        Competition storage c = _competitions[id];
        if (c.host == address(0)) revert NotOpen();
        if (block.timestamp >= c.deadline) revert Closed();
        if (commit == bytes32(0)) revert BadInput();
        _checkPass(msg.sender, nullifier, passDeadline, passSig);
        if (msg.sender == c.host || nullifier == c.hostNullifier) revert HostCannotEnter();
        address prior = entrantOf[id][nullifier];
        if (prior != address(0) && prior != msg.sender) revert AlreadyEntered();
        Entry storage e = _entries[id][msg.sender];
        if (prior == address(0)) {
            if (e.commit != bytes32(0)) revert AlreadyEntered(); // this wallet entered as another person
            entrantOf[id][nullifier] = msg.sender;
            c.entries++;
        }
        e.commit = commit;
        e.seq = ++_seq;
        emit Entered(id, msg.sender, commit);
    }

    function revealLabels(uint256 id, bytes calldata labels, bytes32 salt) external {
        Competition storage c = _competitions[id];
        if (c.host == address(0)) revert NotOpen();
        if (block.timestamp < c.deadline) revert NotYet();
        if (block.timestamp >= uint256(c.deadline) + c.revealWindow) revert TooLate();
        if (c.labelsRevealedAt != 0) revert AlreadyDone();
        if (labels.length != c.items || keccak256(abi.encode(keccak256(labels), salt)) != c.labelsHash) {
            revert WrongReveal();
        }
        _labels[id] = labels;
        c.labelsRevealedAt = uint64(block.timestamp);
        emit LabelsRevealed(id, labels);
    }

    /// Scores one entry: the number of items whose predicted label byte equals the true one.
    function revealEntry(uint256 id, address entrant, bytes calldata predictions, bytes32 salt) external {
        Competition storage c = _competitions[id];
        if (c.labelsRevealedAt == 0) revert NotYet();
        if (block.timestamp >= uint256(c.labelsRevealedAt) + c.revealWindow) revert TooLate();
        Entry storage e = _entries[id][entrant];
        if (e.commit == bytes32(0)) revert NotEntered();
        if (e.revealed) revert AlreadyDone();
        bytes32 commit = keccak256(abi.encode(id, entrant, keccak256(predictions), salt));
        if (predictions.length != c.items || commit != e.commit) revert WrongReveal();
        e.revealed = true;
        bytes memory labels = _labels[id];
        uint32 score;
        for (uint256 i; i < predictions.length; i++) {
            if (predictions[i] == labels[i]) score++;
        }
        c.scored++;
        if (c.best == address(0) || score > c.bestScore || (score == c.bestScore && e.seq < c.bestSeq)) {
            c.best = entrant;
            c.bestScore = score;
            c.bestSeq = e.seq;
        }
        emit EntryScored(id, entrant, score);
    }

    /// Pays the winner, or refunds the host when there is nothing to pay for.
    function settle(uint256 id) external nonReentrant {
        Competition storage c = _competitions[id];
        if (c.host == address(0)) revert NotOpen();
        if (c.settled) revert AlreadyDone();
        address to;
        bool refunded;
        if (c.labelsRevealedAt != 0) {
            if (block.timestamp < uint256(c.labelsRevealedAt) + c.revealWindow) revert NotYet();
            (to, refunded) = c.best != address(0) ? (c.best, false) : (c.host, true);
        } else {
            if (block.timestamp < uint256(c.deadline) + c.revealWindow) revert NotYet();
            if (c.entries != 0) revert AlreadyDone(); // the host hid the labels: entrants claimShare instead
            (to, refunded) = (c.host, true);
        }
        c.settled = true;
        emit Settled(id, to, c.prize, refunded);
        token.safeTransfer(to, c.prize);
    }

    /// The host never revealed the labels: each entrant takes an equal part of the prize.
    function claimShare(uint256 id) external nonReentrant {
        Competition storage c = _competitions[id];
        if (c.labelsRevealedAt != 0 || block.timestamp < uint256(c.deadline) + c.revealWindow) revert NotYet();
        Entry storage e = _entries[id][msg.sender];
        if (e.commit == bytes32(0)) revert NotEntered();
        if (e.shareClaimed) revert AlreadyDone();
        e.shareClaimed = true;
        uint256 share = c.prize / c.entries; // integer division leaves at most entries - 1 base units behind
        emit ShareClaimed(id, msg.sender, share);
        token.safeTransfer(msg.sender, share);
    }

    function competition(uint256 id) external view returns (Competition memory) {
        return _competitions[id];
    }

    function entry(uint256 id, address entrant) external view returns (Entry memory) {
        return _entries[id][entrant];
    }

    function labelsOf(uint256 id) external view returns (bytes memory) {
        return _labels[id];
    }

    function passHash(address wallet, bytes32 nullifier, uint64 deadline) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(PASS_TYPEHASH, wallet, nullifier, deadline)));
    }

    /// The admitter signs an EntryPass after a World ID check: this wallet belongs to the person behind `nullifier`.
    function _checkPass(address wallet, bytes32 nullifier, uint64 deadline, bytes calldata sig) internal view {
        if (nullifier == bytes32(0) || deadline < block.timestamp) revert BadPass();
        if (ECDSA.recover(passHash(wallet, nullifier, deadline), sig) != admitter) revert BadPass();
    }
}
