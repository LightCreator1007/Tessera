// RL competitions with no admin: verifiers run each committed policy on the host's hidden seeds and sign its return.
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

/// Same flow and fallbacks as Competitions, with a policy run in place of a predictions file:
/// - create: the host locks the prize, the environment's sha256, episodes and step limit, and a hash of the seeds.
/// - enter: commit = keccak256(abi.encode(id, entrant, policySha256, salt)), replaceable until the deadline.
/// - revealSeeds: anyone with the seeds and salt, within revealWindow after the deadline. If nobody does, every
///   entrant may claimShare, so a host gains nothing by hiding them.
/// - revealPolicy: anyone with an entrant's policy hash and salt, within revealWindow after the seeds.
/// - submitScore: anyone, with `threshold` verifier signatures over the policy's mean return, within two windows
///   after the seeds, so verifiers have a full window to run the last revealed policy.
/// - settle: anyone, once scoring closes. Pays the best score, or refunds the host if nothing was scored.
contract RLCompetitions is EIP712, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    bytes32 internal constant PASS_TYPEHASH = keccak256("EntryPass(address wallet,bytes32 nullifier,uint64 deadline)");
    bytes32 internal constant EVAL_TYPEHASH =
        keccak256("EvalResult(uint256 competition,address entrant,bytes32 policy,int64 score)");
    uint256 public constant MIN_PRIZE = 1e6;
    uint32 public constant MIN_WINDOW = 60;
    uint32 public constant MAX_WINDOW = 7 days;
    uint256 public constant MAX_SEEDS = 64;
    uint16 public constant MAX_EPISODES = 100;
    uint32 public constant MAX_STEPS = 1_000_000;
    int64 public constant SCALE = 1000; // scores are mean return x 1000, rounded, so every verifier signs the same int

    struct Competition {
        address host;
        uint64 deadline;
        uint32 revealWindow;
        uint16 episodes;
        uint32 maxSteps;
        uint256 prize;
        bytes32 env; // sha256 of the environment package
        bytes32 seedsHash; // keccak256(abi.encode(keccak256(abi.encode(seeds)), salt))
        bytes32 hostNullifier;
        uint64 seedsRevealedAt;
        uint32 entries;
        uint32 scored;
        address best;
        int64 bestScore;
        uint64 bestSeq;
        bool settled;
    }

    struct Entry {
        bytes32 commit;
        uint64 seq;
        bytes32 policy; // sha256 of the policy package, once revealed
        bool scored;
        bool shareClaimed;
    }

    IERC20 public immutable token;
    address public immutable admitter;
    uint8 public immutable threshold;
    uint256 public count;
    uint64 private _seq;
    address[] private _verifiers;
    mapping(address => uint256) private _verifierBit;
    mapping(uint256 => Competition) private _competitions;
    mapping(uint256 => uint64[]) private _seeds;
    mapping(uint256 => mapping(address => Entry)) private _entries;
    mapping(uint256 => mapping(bytes32 => address)) public entrantOf;

    event Created(
        uint256 indexed id,
        address indexed host,
        uint256 prize,
        uint64 deadline,
        uint32 revealWindow,
        bytes32 env,
        uint16 episodes,
        uint32 maxSteps,
        bytes32 seedsHash,
        string meta
    );
    event Entered(uint256 indexed id, address indexed entrant, bytes32 commit);
    event SeedsRevealed(uint256 indexed id, uint64[] seeds);
    event PolicyRevealed(uint256 indexed id, address indexed entrant, bytes32 policy);
    event EntryScored(uint256 indexed id, address indexed entrant, int64 score);
    event Settled(uint256 indexed id, address indexed to, uint256 amount, bool refunded);
    event ShareClaimed(uint256 indexed id, address indexed entrant, uint256 amount);

    error BadInput();
    error BadPass();
    error BadSignature();
    error NotOpen();
    error Closed();
    error NotYet();
    error TooLate();
    error HostCannotEnter();
    error AlreadyEntered();
    error NotEntered();
    error WrongReveal();
    error AlreadyDone();

    constructor(address token_, address admitter_, address[] memory verifiers_, uint8 threshold_) EIP712("ToD", "1") {
        if (token_ == address(0) || admitter_ == address(0)) revert BadInput();
        if (threshold_ == 0 || threshold_ > verifiers_.length || verifiers_.length > 255) revert BadInput();
        for (uint256 i; i < verifiers_.length; i++) {
            if (verifiers_[i] == address(0) || _verifierBit[verifiers_[i]] != 0) revert BadInput();
            _verifierBit[verifiers_[i]] = 1 << i;
        }
        token = IERC20(token_);
        admitter = admitter_;
        threshold = threshold_;
        _verifiers = verifiers_;
    }

    function create(
        uint256 prize,
        bytes32 env,
        uint16 episodes,
        uint32 maxSteps,
        bytes32 seedsHash,
        uint64 deadline,
        uint32 revealWindow,
        string calldata meta,
        bytes32 nullifier,
        uint64 passDeadline,
        bytes calldata passSig
    ) external nonReentrant returns (uint256 id) {
        if (prize < MIN_PRIZE || env == bytes32(0) || seedsHash == bytes32(0) || deadline <= block.timestamp) {
            revert BadInput();
        }
        if (revealWindow < MIN_WINDOW || revealWindow > MAX_WINDOW) revert BadInput();
        if (episodes == 0 || episodes > MAX_EPISODES || maxSteps == 0 || maxSteps > MAX_STEPS) revert BadInput();
        _checkPass(msg.sender, nullifier, passDeadline, passSig);
        id = ++count;
        Competition storage c = _competitions[id];
        c.host = msg.sender;
        c.deadline = deadline;
        c.revealWindow = revealWindow;
        c.episodes = episodes;
        c.maxSteps = maxSteps;
        c.prize = prize;
        c.env = env;
        c.seedsHash = seedsHash;
        c.hostNullifier = nullifier;
        emit Created(id, msg.sender, prize, deadline, revealWindow, env, episodes, maxSteps, seedsHash, meta);
        uint256 before = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), prize);
        if (token.balanceOf(address(this)) - before != prize) revert BadInput();
    }

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
            if (e.commit != bytes32(0)) revert AlreadyEntered();
            entrantOf[id][nullifier] = msg.sender;
            c.entries++;
        }
        e.commit = commit;
        e.seq = ++_seq;
        emit Entered(id, msg.sender, commit);
    }

    function revealSeeds(uint256 id, uint64[] calldata seeds, bytes32 salt) external {
        Competition storage c = _competitions[id];
        if (c.host == address(0)) revert NotOpen();
        if (block.timestamp < c.deadline) revert NotYet();
        if (block.timestamp >= uint256(c.deadline) + c.revealWindow) revert TooLate();
        if (c.seedsRevealedAt != 0) revert AlreadyDone();
        if (seeds.length == 0 || seeds.length > MAX_SEEDS) revert WrongReveal();
        if (keccak256(abi.encode(keccak256(abi.encode(seeds)), salt)) != c.seedsHash) revert WrongReveal();
        _seeds[id] = seeds;
        c.seedsRevealedAt = uint64(block.timestamp);
        emit SeedsRevealed(id, seeds);
    }

    function revealPolicy(uint256 id, address entrant, bytes32 policy, bytes32 salt) external {
        Competition storage c = _competitions[id];
        if (c.seedsRevealedAt == 0) revert NotYet();
        if (block.timestamp >= uint256(c.seedsRevealedAt) + c.revealWindow) revert TooLate();
        Entry storage e = _entries[id][entrant];
        if (e.commit == bytes32(0)) revert NotEntered();
        if (e.policy != bytes32(0)) revert AlreadyDone();
        if (policy == bytes32(0) || keccak256(abi.encode(id, entrant, policy, salt)) != e.commit) revert WrongReveal();
        e.policy = policy;
        emit PolicyRevealed(id, entrant, policy);
    }

    /// Records a revealed policy's mean return, signed by at least `threshold` verifiers who each ran it.
    function submitScore(uint256 id, address entrant, int64 score, bytes[] calldata sigs) external {
        Competition storage c = _competitions[id];
        if (c.seedsRevealedAt == 0) revert NotYet();
        if (block.timestamp >= _scoringEnds(c)) revert TooLate();
        Entry storage e = _entries[id][entrant];
        if (e.policy == bytes32(0)) revert NotEntered();
        if (e.scored) revert AlreadyDone();
        _requireVerifierSigs(evalHash(id, entrant, e.policy, score), sigs);
        e.scored = true;
        c.scored++;
        if (c.best == address(0) || score > c.bestScore || (score == c.bestScore && e.seq < c.bestSeq)) {
            c.best = entrant;
            c.bestScore = score;
            c.bestSeq = e.seq;
        }
        emit EntryScored(id, entrant, score);
    }

    function settle(uint256 id) external nonReentrant {
        Competition storage c = _competitions[id];
        if (c.host == address(0)) revert NotOpen();
        if (c.settled) revert AlreadyDone();
        address to;
        bool refunded;
        if (c.seedsRevealedAt != 0) {
            if (block.timestamp < _scoringEnds(c)) revert NotYet();
            (to, refunded) = c.best != address(0) ? (c.best, false) : (c.host, true);
        } else {
            if (block.timestamp < uint256(c.deadline) + c.revealWindow) revert NotYet();
            if (c.entries != 0) revert AlreadyDone(); // the host hid the seeds: entrants claimShare instead
            (to, refunded) = (c.host, true);
        }
        c.settled = true;
        emit Settled(id, to, c.prize, refunded);
        token.safeTransfer(to, c.prize);
    }

    function claimShare(uint256 id) external nonReentrant {
        Competition storage c = _competitions[id];
        if (c.seedsRevealedAt != 0 || block.timestamp < uint256(c.deadline) + c.revealWindow) revert NotYet();
        Entry storage e = _entries[id][msg.sender];
        if (e.commit == bytes32(0)) revert NotEntered();
        if (e.shareClaimed) revert AlreadyDone();
        e.shareClaimed = true;
        uint256 share = c.prize / c.entries;
        emit ShareClaimed(id, msg.sender, share);
        token.safeTransfer(msg.sender, share);
    }

    function competition(uint256 id) external view returns (Competition memory) {
        return _competitions[id];
    }

    function entry(uint256 id, address entrant) external view returns (Entry memory) {
        return _entries[id][entrant];
    }

    function seedsOf(uint256 id) external view returns (uint64[] memory) {
        return _seeds[id];
    }

    function verifiers() external view returns (address[] memory) {
        return _verifiers;
    }

    function passHash(address wallet, bytes32 nullifier, uint64 deadline) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(PASS_TYPEHASH, wallet, nullifier, deadline)));
    }

    function evalHash(uint256 id, address entrant, bytes32 policy, int64 score) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(EVAL_TYPEHASH, id, entrant, policy, score)));
    }

    function _scoringEnds(Competition storage c) private view returns (uint256) {
        return uint256(c.seedsRevealedAt) + 2 * uint256(c.revealWindow);
    }

    function _checkPass(address wallet, bytes32 nullifier, uint64 deadline, bytes calldata sig) internal view {
        if (nullifier == bytes32(0) || deadline < block.timestamp) revert BadPass();
        if (ECDSA.recover(passHash(wallet, nullifier, deadline), sig) != admitter) revert BadPass();
    }

    function _requireVerifierSigs(bytes32 digest, bytes[] calldata sigs) private view {
        uint256 seen;
        uint256 count_;
        for (uint256 i; i < sigs.length; i++) {
            (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, sigs[i]);
            uint256 bit = _verifierBit[signer];
            if (err != ECDSA.RecoverError.NoError || bit == 0 || seen & bit != 0) revert BadSignature();
            seen |= bit;
            count_++;
        }
        if (count_ < threshold) revert BadSignature();
    }
}
