// Jobs, rounds, verification and pay  over the common pool in NodeRegistry.
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {IJobMarket} from "./IJobMarket.sol";
import {INodeRegistry} from "./INodeRegistry.sol";
import {Encodings} from "./Encodings.sol";

contract JobMarket is IJobMarket, EIP712, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    uint128 public constant MIN_STAKE = 15e6;
    uint16 public constant DRIP_BPS = 1000;

    address public immutable token;
    address public immutable registry;
    address public immutable coordinator;
    uint8 public immutable threshold;
    address[] private _verifiers;
    mapping(address => uint256) private _verifierBit;

    uint256 public jobCount;
    mapping(uint256 => JobParams) private _params;
    mapping(uint256 => JobState) private _state;
    mapping(uint256 => bytes32) private _weights;
    mapping(uint256 => mapping(uint256 => Round)) private _rounds;
    mapping(uint256 => mapping(uint256 => address[])) private _roster;
    mapping(uint256 => mapping(uint256 => mapping(address => NodeRound))) private _nr;
    mapping(uint256 => mapping(uint256 => uint256)) private _attestedMask;
    mapping(uint256 => mapping(uint256 => uint8)) private _attestedCount;

    struct Listing {
        uint8 count;
        Kind mildest;
    }

    mapping(uint256 => mapping(uint256 => mapping(address => Listing))) private _listings;

    mapping(uint256 => mapping(address => uint8)) public missedReveals;
    mapping(address => uint256) public claimable;
    uint256 public communityPool;
    uint256 public burned;

    /// @dev A clean seat revealed at least once in the job and never had a confirmed failure or a no-reveal.
    struct Seat {
        bool seen;
        bool dirty;
        bool leftoverClaimed;
    }

    mapping(uint256 => mapping(address => Seat)) private _seats;
    mapping(uint256 => uint256) private _cleanSeats;
    mapping(uint256 => uint256) private _leftoverShare;
    mapping(uint256 => uint256) private _refund;

    constructor(address token_, address registry_, address coordinator_, address[] memory verifiers_, uint8 threshold_)
        EIP712("ToD", "1")
    {
        if (token_ == address(0) || registry_ == address(0) || coordinator_ == address(0)) revert BadInput();
        if (threshold_ == 0 || threshold_ > verifiers_.length || verifiers_.length > 255) revert BadInput();
        for (uint256 i; i < verifiers_.length; i++) {
            if (verifiers_[i] == address(0) || _verifierBit[verifiers_[i]] != 0) revert BadInput();
            _verifierBit[verifiers_[i]] = 1 << i;
        }
        token = token_;
        registry = registry_;
        coordinator = coordinator_;
        threshold = threshold_;
        _verifiers = verifiers_;
    }

    function createJob(JobParams calldata p, uint256 fromBalance) external nonReentrant returns (uint256 jobId) {
        _checkParams(p);
        if (fromBalance > p.budget) revert BadInput();
        if (fromBalance > claimable[msg.sender]) revert InsufficientBalance();
        jobId = ++jobCount;
        _params[jobId] = p;
        _state[jobId] = JobState({
            requester: msg.sender,
            status: JobStatus.Active,
            remaining: p.budget,
            nextRound: 1,
            roundsOpened: 0,
            closedAt: uint64(block.timestamp)
        });
        _weights[jobId] = p.initialWeightsHash;
        claimable[msg.sender] -= fromBalance;
        // One known token (USDC, no transfer fee), so the requested amount is what arrives.
        IERC20(token).safeTransferFrom(msg.sender, address(this), p.budget - fromBalance);
        emit JobCreated(
            jobId,
            msg.sender,
            p.budget,
            fromBalance,
            p.rounds,
            p.stakePerNode,
            p.modelSpecHash,
            p.initialWeightsHash,
            p.valCommit,
            p.slashOnMismatch
        );
    }

    function withdrawRefund(uint256 jobId) external nonReentrant {
        if (msg.sender != _state[jobId].requester) revert NotAuthorized();
        uint256 amount = _refund[jobId];
        if (amount == 0) revert NothingToClaim();
        _refund[jobId] = 0;
        IERC20(token).safeTransfer(msg.sender, amount);
        emit RefundWithdrawn(jobId, msg.sender, amount);
    }

    function openRound(uint256 jobId, address[] calldata nodes, uint8[] calldata shards) external {
        if (msg.sender != coordinator) revert NotAuthorized();
        JobParams storage p = _params[jobId];
        JobState storage js = _state[jobId];
        if (js.status != JobStatus.Active || js.roundsOpened == p.rounds) revert WrongState();
        uint256 roundId = js.nextRound;
        if (roundId > 1 && _rounds[jobId][roundId - 1].status == RoundStatus.Open) revert WrongState();
        if (nodes.length < p.minQuorum) revert QuorumNotMet();
        if (nodes.length > p.maxPerRound || shards.length != nodes.length) revert BadInput();
        _assign(jobId, roundId, p, nodes, shards);

        Round storage r = _rounds[jobId][roundId];
        uint64 t = uint64(block.timestamp);
        r.status = RoundStatus.Open;
        r.nodeCount = uint8(nodes.length);
        r.openedAt = t;
        r.commitDeadline = t + p.windows.commit;
        r.revealDeadline = r.commitDeadline + p.windows.reveal;
        r.verifyDeadline = r.revealDeadline + p.windows.verify;
        r.finalizeBy = r.verifyDeadline + p.windows.finalize;
        r.budget = js.remaining / (p.rounds - js.roundsOpened);
        r.startWeightsHash = _weights[jobId];
        js.remaining -= r.budget;
        // Capped by budget_r so many tiny jobs can't drain the pool faster than their own size .
        uint256 drip = communityPool * DRIP_BPS / 10_000;
        r.drip = drip < r.budget ? drip : r.budget;
        communityPool -= r.drip;
        js.roundsOpened++;
        js.nextRound++;
        _roster[jobId][roundId] = nodes;
        INodeRegistry(registry).markBusy(nodes, jobId, roundId);
        emit RoundOpened(
            jobId,
            roundId,
            r.startWeightsHash,
            nodes,
            shards,
            r.commitDeadline,
            r.revealDeadline,
            r.verifyDeadline,
            r.budget,
            r.drip
        );
    }

    function finalizeRound(uint256 jobId, uint256 roundId, Settlement calldata s, bytes[] calldata verifierSigs)
        external
        nonReentrant
    {
        if (phase(jobId, roundId) != Phase.Finalize) revert WrongState();
        Round storage r = _rounds[jobId][roundId];
        if (block.timestamp > r.finalizeBy) revert TooLate();
        _requireVerifierSigs(finalizeDigest(jobId, roundId, s), verifierSigs);

        if (s.outcome == Outcome.Accepted) {
            _payAccepted(jobId, roundId, s);
            _weights[jobId] = s.aggregateHash;
            r.aggregateHash = s.aggregateHash;
            r.status = RoundStatus.Settled;
        } else {
            if (s.payouts.length != 0) revert BadInput();
            _state[jobId].remaining += r.budget;
            communityPool += r.drip;
            r.aggregateHash = r.startWeightsHash;
            r.status = RoundStatus.Reverted;
        }
        r.flaggedBitmap = s.flaggedBitmap;
        r.aggEvidenceHash = s.aggEvidenceHash;
        r.payEvidenceHash = s.payEvidenceHash;
        emit RoundFinalized(
            jobId, roundId, s.outcome, r.aggregateHash, s.flaggedBitmap, s.aggEvidenceHash, s.payEvidenceHash, false
        );
        _close(jobId, roundId);
    }

    function commit(uint256 jobId, uint256 roundId, bytes32 commitHash) external {
        _commit(jobId, roundId, msg.sender, commitHash);
    }

    function reveal(uint256 jobId, uint256 roundId, bytes32[] calldata checkpointHashes, bytes32 salt) external {
        _reveal(jobId, roundId, msg.sender, checkpointHashes, salt);
    }

    function attestRound(uint256 jobId, uint256 roundId, bytes32 reportHash, Failure[] calldata failures)
        external
        nonReentrant
    {
        uint256 bit = _verifierBit[msg.sender];
        if (bit == 0) revert NotAuthorized();
        if (phase(jobId, roundId) != Phase.Verify || _rounds[jobId][roundId].seed == 0) revert WrongState();
        if (_attestedMask[jobId][roundId] & bit != 0) revert AlreadyReported();
        _attestedMask[jobId][roundId] |= bit;
        _attestedCount[jobId][roundId]++;
        uint32 seen;
        for (uint256 i; i < failures.length; i++) {
            seen = _list(jobId, roundId, failures[i], seen);
        }
        emit Attested(jobId, roundId, msg.sender, reportHash, failures.length);
    }

    function reportNoReveal(uint256 jobId, uint256 roundId, address operator) external nonReentrant {
        Phase ph = phase(jobId, roundId);
        if (ph != Phase.Verify && ph != Phase.Finalize) revert WrongState();
        NodeRound storage nr = _nr[jobId][roundId][operator];
        if (!nr.assigned || nr.revealed) revert BadInput();
        if (nr.noRevealReported) revert AlreadyReported();
        nr.noRevealReported = true;
        _dirty(jobId, operator);
        uint8 missed = ++missedReveals[jobId][operator];
        // 1%, 10%, then 50% of the job's stake for every later miss in the same job.
        uint256 bps = missed == 1 ? 100 : missed == 2 ? 1000 : 5000;
        uint256 taken = _slash(jobId, roundId, operator, uint256(_params[jobId].stakePerNode) * bps / 10_000, false);
        emit NoRevealReported(jobId, roundId, operator, missed, taken);
    }

    function lockSeed(uint256 jobId, uint256 roundId) external {
        Round storage r = _rounds[jobId][roundId];
        if (phase(jobId, roundId) != Phase.Verify || r.seed != 0) revert WrongState();
        if (r.revealedCount < _params[jobId].minQuorum) revert QuorumNotMet();
        bool lost = r.seedBlock != 0 && block.number > r.seedBlock && blockhash(r.seedBlock) == 0;
        if (r.seedBlock != 0 && !lost) revert WrongState();
        r.seedBlock = block.number + 2;
        emit SeedLocked(jobId, roundId, r.seedBlock);
    }

    function drawSeed(uint256 jobId, uint256 roundId) external {
        Round storage r = _rounds[jobId][roundId];
        if (r.status != RoundStatus.Open || r.seedBlock == 0 || r.seed != 0) revert WrongState();
        if (block.number <= r.seedBlock) revert TooEarly();
        bytes32 bh = blockhash(r.seedBlock);
        // Older than 256 blocks: the hash is gone, and lockSeed may pick a new block.
        if (bh == 0) revert TooLate();
        r.seed = Encodings.roundSeed(bh, DOMAIN(), jobId, roundId);
        emit SeedDrawn(jobId, roundId, r.seed);
    }

    /// @dev The coordinator stayed silent past finalizeBy: equal split over E, dust to the lowest address,
    ///      model unchanged, no work credit. Below quorum it voids instead.
    function finalizeFallback(uint256 jobId, uint256 roundId) external nonReentrant {
        Round storage r = _rounds[jobId][roundId];
        if (r.status != RoundStatus.Open) revert WrongState();
        if (block.timestamp <= r.finalizeBy) revert TooEarly();
        uint32 eligible = eligibleBitmap(jobId, roundId);
        uint256 nE = _popcount(eligible);
        r.aggregateHash = r.startWeightsHash;
        if (nE < _params[jobId].minQuorum) {
            _void(jobId, roundId);
            return;
        }
        address[] storage roster = _roster[jobId][roundId];
        address lowest;
        for (uint256 i; i < roster.length; i++) {
            if ((eligible >> i) & 1 == 1 && (lowest == address(0) || uint160(roster[i]) < uint160(lowest))) {
                lowest = roster[i];
            }
        }
        uint256 share = r.budget / nE;
        for (uint256 i; i < roster.length; i++) {
            if ((eligible >> i) & 1 == 0) continue;
            _route(jobId, roundId, roster[i], share + (roster[i] == lowest ? r.budget % nE : 0));
        }
        // Nothing was verified, so the drip goes back and no work is credited .
        communityPool += r.drip;
        r.status = RoundStatus.Settled;
        r.fallback_ = true;
        emit RoundFinalized(jobId, roundId, Outcome.Accepted, r.aggregateHash, 0, 0, 0, true);
        _close(jobId, roundId);
    }

    function voidRound(uint256 jobId, uint256 roundId) external nonReentrant {
        Phase ph = phase(jobId, roundId);
        if (ph != Phase.Verify && ph != Phase.Finalize) revert WrongState();
        if (_rounds[jobId][roundId].revealedCount >= _params[jobId].minQuorum) revert WrongState();
        _void(jobId, roundId);
    }

    function abandonJob(uint256 jobId) external nonReentrant {
        JobState storage js = _state[jobId];
        if (js.status != JobStatus.Active) revert WrongState();
        uint256 last = js.nextRound - 1;
        if (last > 0 && _rounds[jobId][last].status == RoundStatus.Open) revert WrongState();
        if (block.timestamp <= js.closedAt + _params[jobId].windows.stall) revert TooEarly();
        _closeJob(jobId, JobStatus.Cancelled);
    }

    function claimLeftover(uint256 jobId, address operator) external {
        JobStatus st = _state[jobId].status;
        if (st != JobStatus.Completed && st != JobStatus.Cancelled) revert WrongState();
        Seat storage seat = _seats[jobId][operator];
        if (!seat.seen || seat.dirty || seat.leftoverClaimed) revert NothingToClaim();
        uint256 amount = _leftoverShare[jobId];
        if (amount == 0) revert NothingToClaim();
        seat.leftoverClaimed = true;
        address owner = INodeRegistry(registry).ownerOf(operator);
        claimable[owner] += amount;
        emit LeftoverClaimed(jobId, operator, owner, amount);
    }

    function claim() external nonReentrant {
        uint256 amount = claimable[msg.sender];
        if (amount == 0) revert NothingToClaim();
        claimable[msg.sender] = 0;
        IERC20(token).safeTransfer(msg.sender, amount);
        emit Claimed(msg.sender, amount);
    }

    function verifiers() external view returns (address[] memory) {
        return _verifiers;
    }

    /// @dev Computed per call rather than cached, so it follows block.chainid after a fork.
    function DOMAIN() public view returns (bytes32) {
        return Encodings.domain(block.chainid, address(this));
    }

    function minStake(uint256 budget, uint32 rounds, uint16 minQuorum) public pure returns (uint128) {
        if (rounds == 0 || minQuorum == 0) revert BadInput();
        uint256 s = 2 * budget / rounds / minQuorum;
        if (s > type(uint128).max) revert BadInput();
        return s > MIN_STAKE ? uint128(s) : MIN_STAKE;
    }

    function phase(uint256 jobId, uint256 roundId) public view returns (Phase) {
        Round storage r = _rounds[jobId][roundId];
        RoundStatus st = r.status;
        if (st == RoundStatus.None) return Phase.None;
        if (st == RoundStatus.Settled) return Phase.Settled;
        if (st == RoundStatus.Void) return Phase.Void;
        if (st == RoundStatus.Reverted) return Phase.Reverted;
        if (r.committedCount < r.nodeCount && block.timestamp <= r.commitDeadline) return Phase.Commit;
        if (r.revealedCount < r.committedCount && block.timestamp <= r.revealDeadline) return Phase.Reveal;
        if (_attestedCount[jobId][roundId] < threshold && block.timestamp <= r.verifyDeadline) return Phase.Verify;
        return Phase.Finalize;
    }

    /// @dev ponytail: full replay (, ) checks every segment; a seeded K-segment draw replaces this
    ///      when the spec's replay.coverage "segments" is turned on.
    function segmentsFor(uint256 jobId, uint256, address) external view returns (uint256[] memory segs) {
        segs = new uint256[](_params[jobId].segments);
        for (uint256 i; i < segs.length; i++) {
            segs[i] = i;
        }
    }

    /// @notice Revealed, unconfirmed and active nodes, by slot. The signed flaggedBitmap is removed from it.
    function eligibleBitmap(uint256 jobId, uint256 roundId) public view returns (uint32 bits) {
        address[] storage roster = _roster[jobId][roundId];
        for (uint256 i; i < roster.length; i++) {
            NodeRound storage nr = _nr[jobId][roundId][roster[i]];
            if (nr.revealed && nr.confirmed == Kind.None && isActive(jobId, roster[i])) bits |= uint32(1 << nr.slot);
        }
    }

    function isActive(uint256 jobId, address operator) public view returns (bool) {
        return INodeRegistry(registry).getNode(operator).stake >= _params[jobId].stakePerNode / 2;
    }

    function commitHashOf(uint256 jobId, uint256 roundId, address operator, bytes32 root, bytes32 salt)
        external
        view
        returns (bytes32)
    {
        return Encodings.commitHash(DOMAIN(), jobId, roundId, operator, root, salt);
    }

    function finalizeDigest(uint256 jobId, uint256 roundId, Settlement calldata s) public view returns (bytes32) {
        return _hashTypedDataV4(Encodings.finalizeRoundHash(jobId, roundId, s));
    }

    function getJob(uint256 jobId) external view returns (JobParams memory, JobState memory) {
        return (_params[jobId], _state[jobId]);
    }

    function getRound(uint256 jobId, uint256 roundId) external view returns (Round memory) {
        return _rounds[jobId][roundId];
    }

    function getNodeRound(uint256 jobId, uint256 roundId, address operator) external view returns (NodeRound memory) {
        return _nr[jobId][roundId][operator];
    }

    function roundNodes(uint256 jobId, uint256 roundId) external view returns (address[] memory) {
        return _roster[jobId][roundId];
    }

    /// @notice Fixed when the job closes; 0 while it is active and after withdrawRefund.
    function refundable(uint256 jobId) external view returns (uint256) {
        return _refund[jobId];
    }

    function _checkParams(JobParams calldata p) private pure {
        if (p.budget == 0 || p.rounds == 0 || p.segments == 0 || p.minQuorum == 0) revert BadInput();
        if (p.maxPerRound < p.minQuorum || p.maxPerRound > 32 || p.shards < p.minQuorum) revert BadInput();
        if (p.dataUnavailableBps > 10_000 || p.refWorkSecondsPerRound > p.windows.commit) revert BadInput();
        Windows calldata w = p.windows;
        if (w.commit == 0 || w.reveal == 0 || w.verify == 0 || w.finalize == 0 || w.stall == 0) revert BadInput();
        if (p.initialWeightsHash == 0 || p.modelSpecHash == 0) revert BadInput();
        if (p.stakePerNode < minStake(p.budget, p.rounds, p.minQuorum)) revert StakeTooLow();
    }

    function _assign(
        uint256 jobId,
        uint256 roundId,
        JobParams storage p,
        address[] calldata nodes,
        uint8[] calldata shards
    ) private {
        address[] memory owners = new address[](nodes.length);
        uint256 shardMask;
        for (uint256 i; i < nodes.length; i++) {
            INodeRegistry.Node memory n = INodeRegistry(registry).getNode(nodes[i]);
            if (!n.joined || n.busyJob != 0) revert NodeNotEligible();
            if (n.stake < p.stakePerNode) revert StakeTooLow();
            for (uint256 j; j < i; j++) {
                if (owners[j] == n.owner) revert DuplicateOwner();
            }
            owners[i] = n.owner;
            if (shards[i] >= p.shards) revert BadInput();
            if (shardMask & (1 << shards[i]) != 0) revert DuplicateShard();
            shardMask |= 1 << shards[i];
            NodeRound storage nr = _nr[jobId][roundId][nodes[i]];
            nr.slot = uint8(i);
            nr.shard = shards[i];
            nr.assigned = true;
        }
    }

    /// @dev Keyed by operator so a relayed commitFor can reuse it later without an ABI change.
    function _commit(uint256 jobId, uint256 roundId, address operator, bytes32 h) internal {
        if (phase(jobId, roundId) != Phase.Commit) revert WrongState();
        NodeRound storage nr = _nr[jobId][roundId][operator];
        if (!nr.assigned) revert NotAuthorized();
        if (nr.committed) revert WrongState();
        if (h == 0) revert BadInput();
        if (!isActive(jobId, operator)) revert NodeNotEligible();
        nr.committed = true;
        nr.commitHash = h;
        _rounds[jobId][roundId].committedCount++;
        emit Committed(jobId, roundId, operator, h);
    }

    /// @dev Keyed by operator so a relayed revealFor can reuse it later without an ABI change.
    function _reveal(uint256 jobId, uint256 roundId, address operator, bytes32[] calldata hs, bytes32 salt) internal {
        if (phase(jobId, roundId) != Phase.Reveal) revert WrongState();
        NodeRound storage nr = _nr[jobId][roundId][operator];
        if (!nr.committed || nr.revealed) revert WrongState();
        uint256 k = _params[jobId].segments;
        if (hs.length != k + 1 || hs[0] != _rounds[jobId][roundId].startWeightsHash) revert BadInput();
        for (uint256 i = 1; i <= k; i++) {
            if (hs[i] == hs[i - 1]) revert BadInput();
        }
        bytes32 root = Encodings.checkpointRoot(hs);
        if (Encodings.commitHash(DOMAIN(), jobId, roundId, operator, root, salt) != nr.commitHash) revert BadInput();
        if (!isActive(jobId, operator)) revert NodeNotEligible();
        nr.revealed = true;
        Seat storage seat = _seats[jobId][operator];
        if (!seat.seen) {
            seat.seen = true;
            if (!seat.dirty) _cleanSeats[jobId]++;
        }
        nr.checkpointRoot = root;
        nr.updateHash = hs[k];
        _rounds[jobId][roundId].revealedCount++;
        emit Revealed(jobId, roundId, operator, hs);
    }

    function _requireVerifierSigs(bytes32 digest, bytes[] calldata sigs) private view {
        uint256 seen;
        uint256 count;
        for (uint256 i; i < sigs.length; i++) {
            (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, sigs[i]);
            uint256 bit = _verifierBit[signer];
            if (err != ECDSA.RecoverError.NoError || bit == 0 || seen & bit != 0) revert BadSignature();
            seen |= bit;
            count++;
        }
        if (count < threshold) revert BadSignature();
    }

    /// @dev Payees must be exactly E (eligible minus flagged), ascending by address; the sum must equal
    ///      budget_r and each share must reach half an equal share . Equal split is the coordinator's
    ///      Phase 1 rule; the contract checks only the floor, so Shapley pay needs no contract change.
    function _payAccepted(uint256 jobId, uint256 roundId, Settlement calldata s) private {
        if (s.aggregateHash == 0) revert BadInput();
        uint32 eligible = eligibleBitmap(jobId, roundId);
        // The gate may drop at most the one node that explains a bad merge (); no detector in Phase 1.
        if (s.flaggedBitmap & ~eligible != 0 || _popcount(s.flaggedBitmap) > 1) revert BadInput();
        eligible &= ~s.flaggedBitmap;
        uint256 nE = _popcount(eligible);
        if (nE == 0 || s.payouts.length != nE) revert BadInput();

        uint256 floor = _rounds[jobId][roundId].budget / 2 / nE;
        uint256 sum;
        bool anyGraduated;
        address prev;
        for (uint256 i; i < nE; i++) {
            Payout calldata pay = s.payouts[i];
            // Ascending payees: a repeat or an omission shows up as an order or length mismatch.
            if (uint160(pay.operator) <= uint160(prev)) revert BadInput();
            prev = pay.operator;
            sum += pay.amount;
            if (_payOne(jobId, roundId, pay, eligible, floor)) anyGraduated = true;
        }
        // Invariant: sum(payouts) + toPool == budget_r + drip, where the forfeits are inside sum(payouts)
        // and the drip waits in the pool when no graduated node is in E.
        Round storage r = _rounds[jobId][roundId];
        uint256 drip = anyGraduated ? r.drip : 0;
        if (sum != r.budget + drip) revert BadInput();
        if (drip > 0) emit PoolDripped(jobId, roundId, drip);
        communityPool += r.drip - drip;
    }

    function _payOne(uint256 jobId, uint256 roundId, Payout calldata pay, uint32 eligible, uint256 floor)
        private
        returns (bool grad)
    {
        NodeRound storage nr = _nr[jobId][roundId][pay.operator];
        if (!nr.assigned || (eligible >> nr.slot) & 1 == 0) revert BadInput();
        address owner;
        (grad, owner) = _route(jobId, roundId, pay.operator, pay.amount);
        if (grad && pay.amount < floor) revert BadInput();
        uint32 credit = _params[jobId].refWorkSecondsPerRound;
        if (credit > 0) INodeRegistry(registry).creditWork(owner, jobId, roundId, credit);
    }

    /// @dev Owners still on probation at round start forfeit their share to the pool ;
    ///      the round that crosses PROBATION_SECONDS is still forfeited, since graduatedAt is then >= openedAt.
    function _route(uint256 jobId, uint256 roundId, address operator, uint256 amount)
        private
        returns (bool grad, address owner)
    {
        INodeRegistry reg = INodeRegistry(registry);
        owner = reg.ownerOf(operator);
        uint64 g = reg.graduatedAt(owner);
        grad = reg.PROBATION_SECONDS() == 0 || (g != 0 && g < _rounds[jobId][roundId].openedAt);
        if (grad) {
            claimable[owner] += amount;
            emit Paid(jobId, roundId, operator, owner, amount);
        } else {
            communityPool += amount;
            emit ForfeitedToPool(jobId, roundId, owner, amount);
        }
    }

    /// @dev Counts one verifier's listing of a node; `threshold` listings confirm it with the mildest kind,
    ///      so one verifier alone can neither exclude nor slash an honest node ().
    function _list(uint256 jobId, uint256 roundId, Failure calldata f, uint32 seen) private returns (uint32) {
        NodeRound storage nr = _nr[jobId][roundId][f.operator];
        if (!nr.revealed || f.kind == Kind.None || f.blameFrom) revert BadInput();
        uint32 b = uint32(1 << nr.slot);
        if (seen & b != 0) revert AlreadyReported();
        Listing storage l = _listings[jobId][roundId][f.operator];
        if (l.count == 0 || f.kind < l.mildest) l.mildest = f.kind;
        l.count++;
        if (l.count == threshold) _confirm(jobId, roundId, f.operator, l.mildest);
        return seen | b;
    }

    /// @dev Half of a slash tops up this round's pot and half stays locked as `burned` , so a
    ///      verifier gains nothing by inventing failures and USDC never goes to address(0).
    function _confirm(uint256 jobId, uint256 roundId, address operator, Kind kind) private {
        NodeRound storage nr = _nr[jobId][roundId][operator];
        Round storage r = _rounds[jobId][roundId];
        nr.confirmed = kind;
        r.confirmedBitmap |= uint32(1 << nr.slot);
        _dirty(jobId, operator);
        emit FailureConfirmed(jobId, roundId, operator, kind);

        JobParams storage p = _params[jobId];
        uint256 amount;
        if (kind == Kind.ReplayMismatch && p.slashOnMismatch) amount = type(uint256).max;
        else if (kind == Kind.DataUnavailable) amount = uint256(p.stakePerNode) * p.dataUnavailableBps / 10_000;
        _slash(jobId, roundId, operator, amount, true);
    }

    /// @dev `toRound` is false for no-reveal penalties: they can land after the verifiers have signed the
    ///      payouts, so growing budget_r then would void those signatures . They go to the job instead.
    function _slash(uint256 jobId, uint256 roundId, address operator, uint256 amount, bool toRound)
        private
        returns (uint256 taken)
    {
        if (amount == 0) return 0;
        taken = INodeRegistry(registry).slash(operator, jobId, roundId, amount);
        uint256 toPot = taken / 2;
        if (toRound) _rounds[jobId][roundId].budget += toPot;
        else _state[jobId].remaining += toPot;
        burned += taken - toPot;
        emit Slashed(jobId, roundId, operator, taken, toPot, taken - toPot);
    }

    function _dirty(uint256 jobId, address operator) private {
        Seat storage seat = _seats[jobId][operator];
        if (seat.dirty) return;
        seat.dirty = true;
        if (seat.seen) _cleanSeats[jobId]--;
    }

    function _void(uint256 jobId, uint256 roundId) private {
        Round storage r = _rounds[jobId][roundId];
        r.status = RoundStatus.Void;
        r.aggregateHash = r.startWeightsHash;
        _state[jobId].remaining += r.budget;
        communityPool += r.drip;
        emit RoundVoided(jobId, roundId);
        _close(jobId, roundId);
    }

    function _close(uint256 jobId, uint256 roundId) private {
        Round storage r = _rounds[jobId][roundId];
        JobState storage js = _state[jobId];
        r.closedAt = uint64(block.timestamp);
        js.closedAt = uint64(block.timestamp);
        INodeRegistry(registry).markFree(_roster[jobId][roundId], jobId, roundId);
        if (js.roundsOpened == _params[jobId].rounds) _closeJob(jobId, JobStatus.Completed);
    }

    /// @dev Refund only rounds that never opened; the rest was promised to nodes, so it goes to clean seats,
    ///      or stays locked as `burned` when there are none (and for the integer dust of the split).
    function _closeJob(uint256 jobId, JobStatus status) private {
        JobState storage js = _state[jobId];
        JobParams storage p = _params[jobId];
        js.status = status;
        uint256 never = uint256(p.rounds - js.roundsOpened) * p.budget / p.rounds;
        uint256 refund = never < js.remaining ? never : js.remaining;
        uint256 leftover = js.remaining - refund;
        js.remaining = 0;
        _refund[jobId] = refund;
        uint256 seats = _cleanSeats[jobId];
        if (seats == 0) {
            burned += leftover;
        } else {
            _leftoverShare[jobId] = leftover / seats;
            burned += leftover % seats;
        }
        emit JobClosed(jobId, status, refund, leftover);
    }

    function _popcount(uint32 x) private pure returns (uint256 c) {
        for (; x != 0; x &= x - 1) {
            c++;
        }
    }
}
