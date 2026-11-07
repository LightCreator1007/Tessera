// Defines funded jobs, training rounds, verifier reports and settlement claims.
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @dev Amounts use one six-decimal token; timestamps and windows use seconds.
interface IJobMarket {
    enum JobStatus {
        None,
        Active,
        Completed,
        Cancelled
    }
    enum RoundStatus {
        None,
        Open,
        Settled,
        Void,
        Reverted
    }
    enum Phase {
        None,
        Commit,
        Reveal,
        Verify,
        Finalize,
        Settled,
        Void,
        Reverted
    }
    /// @dev Ordered by severity; the confirmed kind is the mildest of the threshold reports.
    enum Kind {
        None,
        ReplayDrift,
        DataUnavailable,
        ReplayMismatch
    }
    enum Outcome {
        Accepted,
        Reverted
    }

    struct Windows {
        uint32 commit;
        uint32 reveal;
        uint32 verify;
        uint32 finalize;
        uint32 stall;
    }

    struct JobParams {
        uint256 budget;
        uint128 stakePerNode; // global stake a node must hold to be matched; >= minStake(...)
        uint32 rounds;
        uint16 segments; // K; a reveal carries K + 1 hashes h_0 .. h_K
        uint16 minQuorum;
        uint8 maxPerRound; // <= 32 so per-round bitmaps fit uint32
        uint8 shards; // rows in the spec's shard table
        bool slashOnMismatch; // exact workloads only: ReplayMismatch slashes 100%
        uint16 dataUnavailableBps; // basis points slashed for confirmed missing data
        uint32 refWorkSecondsPerRound; // work credit per accepted round; <= windows.commit
        Windows windows;
        bytes32 workloadId; // keccak of the workload id string, e.g. "mlp-exact/1"
        bytes32 modelSpecHash;
        bytes32 datasetHash;
        bytes32 shardTableHash;
        bytes32 initialWeightsHash;
        bytes32 valCommit; // reserved validation commitment
        bytes32 codeHash; // node image digest
        string specURI;
    }

    struct JobState {
        address requester;
        JobStatus status;
        uint256 remaining; // budget not yet assigned to a round
        uint32 nextRound; // id the next openRound will use (rounds start at 1)
        uint32 roundsOpened; // rounds that reached Open, whatever their outcome
        uint64 closedAt; // latest round close; abandonJob counts `stall` from here
    }

    struct Round {
        RoundStatus status;
        bool fallback_; // settled through finalizeFallback
        uint8 nodeCount;
        uint8 committedCount;
        uint8 revealedCount;
        uint32 flaggedBitmap; // nodes excluded by the aggregation gate
        uint32 confirmedBitmap;
        uint64 openedAt;
        uint64 commitDeadline;
        uint64 revealDeadline;
        uint64 verifyDeadline;
        uint64 finalizeBy;
        uint64 closedAt;
        uint256 budget; // budget_r, including slash shares added during the round
        uint256 drip; // from the community pool, min(pool * DRIP_BPS, budget_r)
        uint256 seedBlock;
        bytes32 seed;
        bytes32 startWeightsHash; // G_r
        bytes32 aggregateHash; // G_{r+1}; equals startWeightsHash when Reverted or fallback
        bytes32 aggEvidenceHash;
        bytes32 payEvidenceHash;
    }

    struct NodeRound {
        uint8 slot; // bit index in the round bitmaps
        uint8 shard;
        bool assigned;
        bool committed;
        bool revealed;
        bool noRevealReported;
        Kind confirmed; // None unless confirmed by `threshold` verifiers
        bytes32 commitHash;
        bytes32 checkpointRoot;
        bytes32 updateHash; // h_K
    }

    /// @dev `blameFrom` is reserved and must be false.
    struct Failure {
        address operator;
        Kind kind;
        bool blameFrom;
    }

    struct Payout {
        address operator;
        uint256 amount;
    }

    /// @dev What both verifiers sign, as EIP-712
    ///      `FinalizeRound(uint256 jobId,uint256 roundId,uint8 outcome,bytes32 aggregateHash,
    ///       uint32 flaggedBitmap,bytes32 aggEvidenceHash,bytes32 payEvidenceHash,bytes32 payoutsHash)`
    ///      with `payoutsHash = keccak256(abi.encode(payouts))`. A Reverted outcome has no payouts.
    struct Settlement {
        Outcome outcome;
        bytes32 aggregateHash;
        uint32 flaggedBitmap;
        bytes32 aggEvidenceHash;
        bytes32 payEvidenceHash;
        Payout[] payouts;
    }

    event JobCreated(
        uint256 indexed jobId,
        address indexed requester,
        uint256 budget,
        uint256 fromBalance,
        uint32 rounds,
        uint128 stakePerNode,
        bytes32 modelSpecHash,
        bytes32 initialWeightsHash,
        bytes32 valCommit,
        bool slashOnMismatch
    );
    event RoundOpened(
        uint256 indexed jobId,
        uint256 indexed roundId,
        bytes32 startWeightsHash,
        address[] nodes,
        uint8[] shards,
        uint64 commitDeadline,
        uint64 revealDeadline,
        uint64 verifyDeadline,
        uint256 budget,
        uint256 drip
    );
    event Committed(uint256 indexed jobId, uint256 indexed roundId, address indexed operator, bytes32 commitHash);
    event Revealed(
        uint256 indexed jobId, uint256 indexed roundId, address indexed operator, bytes32[] checkpointHashes
    );
    event NoRevealReported(
        uint256 indexed jobId, uint256 indexed roundId, address indexed operator, uint8 missed, uint256 penalty
    );
    event SeedLocked(uint256 indexed jobId, uint256 indexed roundId, uint256 seedBlock);
    event SeedDrawn(uint256 indexed jobId, uint256 indexed roundId, bytes32 seed);
    event Attested(
        uint256 indexed jobId, uint256 indexed roundId, address indexed verifier, bytes32 reportHash, uint256 failures
    );
    event FailureConfirmed(uint256 indexed jobId, uint256 indexed roundId, address indexed operator, Kind kind);
    event Slashed(
        uint256 indexed jobId,
        uint256 indexed roundId,
        address indexed operator,
        uint256 taken,
        uint256 toPot,
        uint256 burned
    );
    event RoundFinalized(
        uint256 indexed jobId,
        uint256 indexed roundId,
        Outcome outcome,
        bytes32 aggregateHash,
        uint32 flaggedBitmap,
        bytes32 aggEvidenceHash,
        bytes32 payEvidenceHash,
        bool fallback_
    );
    event RoundVoided(uint256 indexed jobId, uint256 indexed roundId);
    event Paid(uint256 indexed jobId, uint256 indexed roundId, address indexed operator, address owner, uint256 amount);
    event ForfeitedToPool(uint256 indexed jobId, uint256 indexed roundId, address indexed owner, uint256 amount);
    event PoolDripped(uint256 indexed jobId, uint256 indexed roundId, uint256 amount);
    event JobClosed(uint256 indexed jobId, JobStatus status, uint256 refundable, uint256 leftover);
    event CancelRequested(uint256 indexed jobId);
    event RefundWithdrawn(uint256 indexed jobId, address indexed requester, uint256 amount);
    event LeftoverClaimed(uint256 indexed jobId, address indexed operator, address indexed owner, uint256 amount);
    event Claimed(address indexed owner, uint256 amount);

    error NotAuthorized();
    error WrongState();
    error TooEarly();
    error TooLate();
    error BadInput();
    error BadSignature();
    error StakeTooLow(); // createJob: stakePerNode < minStake; openRound: node under-staked
    error QuorumNotMet(); // openRound: nodes.length < minQuorum
    error NodeNotEligible(); // openRound: busy, not joined or inactive for this job
    error DuplicateOwner(); // openRound: two operators of one owner in one round
    error DuplicateShard();
    error AlreadyReported(); // a verifier attests a round twice, or lists a node twice
    error InsufficientBalance(); // createJob: fromBalance > claimable
    error NothingToClaim();

    /// @notice Create a job. Pulls `p.budget - fromBalance` tokens from msg.sender and takes
    ///         `fromBalance` from msg.sender's claimable earnings.
    function createJob(JobParams calldata p, uint256 fromBalance) external returns (uint256 jobId);

    /// @notice Requester pulls `refundable` once the job is Completed or Cancelled:
    ///         min(remaining, roundsNeverOpened * budget / rounds).
    function withdrawRefund(uint256 jobId) external;

    /// @notice Open the next round on idle pool nodes. Reverts unless nodes.length >= minQuorum,
    ///         <= maxPerRound, shards are distinct and < p.shards, and every node is joined, idle,
    ///         active for this job, holds matchable stake >= stakePerNode and has a distinct owner.
    ///         Marks the nodes busy in the registry.
    function openRound(uint256 jobId, address[] calldata nodes, uint8[] calldata shards) external;

    /// @notice Settle a round. Needs `threshold` distinct verifier signatures over the Settlement.
    ///         Accepted: pays `payouts` and credits work; non-graduated owners'
    ///         pay goes to the community pool. Reverted: no pay, no credit, budget_r back to
    ///         `remaining`. Either way confirmed slashes stand and the nodes are freed.
    function finalizeRound(uint256 jobId, uint256 roundId, Settlement calldata s, bytes[] calldata verifierSigs)
        external;

    function commit(uint256 jobId, uint256 roundId, bytes32 commitHash) external;
    function reveal(uint256 jobId, uint256 roundId, bytes32[] calldata checkpointHashes, bytes32 salt) external;

    /// @notice One report per verifier per round. A node is confirmed when `threshold` verifiers
    ///         list it; the confirmed kind is the mildest listed. At most once per node per round.
    function attestRound(uint256 jobId, uint256 roundId, bytes32 reportHash, Failure[] calldata failures) external;

    /// @notice After reveal closes: penalise a committed-or-assigned node that did not reveal.
    ///         Penalty escalates per (node, job): 1%, 10%, then 50% of stakePerNode.
    function reportNoReveal(uint256 jobId, uint256 roundId, address operator) external;
    /// @notice After reveal closes: seedBlock = block.number + 2. Callable again after a lost blockhash.
    function lockSeed(uint256 jobId, uint256 roundId) external;
    /// @notice Reverts if blockhash(seedBlock) == 0 (lost); then lockSeed may be called again.
    function drawSeed(uint256 jobId, uint256 roundId) external;
    /// @notice After finalizeBy: equal split over revealed, unconfirmed, active nodes; no work credit.
    function finalizeFallback(uint256 jobId, uint256 roundId) external;
    /// @notice After reveal closes with revealedCount < minQuorum: nobody paid, budget_r stays in the job.
    function voidRound(uint256 jobId, uint256 roundId) external;
    /// @notice After the latest round closed and `stall` passed with no new round: cancel the job.
    function abandonJob(uint256 jobId) external;
    /// @notice Requester only. With no round open the job closes as Cancelled and the rounds that never opened are
    ///         paid back in the same call. With one open it opens no more, closes as Cancelled when that round does,
    ///         and the refund is then pulled with withdrawRefund.
    function cancelJob(uint256 jobId) external;
    /// @notice True once cancelJob was called while a round was open, until that round closes the job.
    function stopping(uint256 jobId) external view returns (bool);
    /// @notice A clean seat's share of a closed job's leftover (remaining - refundable), credited
    ///         to the owner's claimable balance.
    function claimLeftover(uint256 jobId, address operator) external;
    /// @notice Owner pulls their claimable balance.
    function claim() external;

    function token() external view returns (address);
    function registry() external view returns (address);
    function coordinator() external view returns (address);
    function verifiers() external view returns (address[] memory);
    function threshold() external view returns (uint8);
    function DOMAIN() external view returns (bytes32);
    function MIN_STAKE() external view returns (uint128);
    function DRIP_BPS() external view returns (uint16);
    /// @notice max(MIN_STAKE, 2 * budget / rounds / minQuorum)
    function minStake(uint256 budget, uint32 rounds, uint16 minQuorum) external view returns (uint128);

    function phase(uint256 jobId, uint256 roundId) external view returns (Phase);
    /// @notice Segments to replay. Full replay checks every segment 0..K-1.
    function segmentsFor(uint256 jobId, uint256 roundId, address operator) external view returns (uint256[] memory);
    function eligibleBitmap(uint256 jobId, uint256 roundId) external view returns (uint32);
    function isActive(uint256 jobId, address operator) external view returns (bool);
    function missedReveals(uint256 jobId, address operator) external view returns (uint8);
    function commitHashOf(uint256 jobId, uint256 roundId, address operator, bytes32 root, bytes32 salt)
        external
        view
        returns (bytes32);
    /// @notice The EIP-712 digest verifiers sign for `finalizeRound`.
    function finalizeDigest(uint256 jobId, uint256 roundId, Settlement calldata s) external view returns (bytes32);

    function getJob(uint256 jobId) external view returns (JobParams memory, JobState memory);
    function getRound(uint256 jobId, uint256 roundId) external view returns (Round memory);
    function getNodeRound(uint256 jobId, uint256 roundId, address operator) external view returns (NodeRound memory);
    function roundNodes(uint256 jobId, uint256 roundId) external view returns (address[] memory);
    function refundable(uint256 jobId) external view returns (uint256);

    function claimable(address owner) external view returns (uint256);
    function communityPool() external view returns (uint256);
    /// @notice Slash and leftover amounts kept locked in the contract (ERC-20 transfers cannot target address(0)).
    function burned() external view returns (uint256);
}
