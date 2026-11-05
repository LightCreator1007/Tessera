// Defines owner/operator admission, global stake and round participation.
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @dev Amounts use six-decimal token base units; timestamps use Unix seconds.
///      Admission requires an admitter-signed Invite and an operator-signed Consent.
///      Identity proof verification happens outside the contract.
interface INodeRegistry {
    struct Node {
        address owner;
        uint128 stake;
        uint256 busyJob; // 0 = idle
        uint256 busyRound;
        bool joined;
        bool customCode; // read by the matcher
    }

    event NodeJoined(address indexed operator, address indexed owner, bytes32 indexed nullifier);
    event StakeDeposited(address indexed operator, uint256 amount, uint256 newStake);
    event StakeWithdrawn(address indexed operator, address indexed owner, uint256 amount, uint256 newStake);
    event CustomCodeSet(address indexed operator, bool enabled);
    event NodeBusy(address indexed operator, uint256 indexed jobId, uint256 indexed roundId);
    event NodeFreed(address indexed operator, uint256 indexed jobId, uint256 indexed roundId);
    event StakeSlashed(address indexed operator, uint256 indexed jobId, uint256 indexed roundId, uint256 amount);
    event WorkCredited(
        address indexed owner, uint256 indexed jobId, uint256 indexed roundId, uint64 seconds_, uint64 total
    );
    event Graduated(address indexed owner, uint64 at);
    event MarketSet(address indexed market);

    error NotAuthorized();
    error BadSignature();
    error Expired();
    error AlreadyJoined();
    error NullifierUsed();
    error NotJoined();
    error NodeIsBusy();
    error NodeNotBusy();
    error BadInput();

    /// @notice Called by the owner, once per operator. Pairs operator to owner and binds the
    ///         nullifier to that owner (an owner may run several operators).
    function join(
        address operator,
        bytes32 nullifier,
        uint64 inviteDeadline,
        uint64 consentDeadline,
        bytes calldata inviteSig,
        bytes calldata consentSig
    ) external;

    /// @notice Pulls `amount` from msg.sender (the operator's owner).
    function depositStake(address operator, uint128 amount) external;

    /// @notice Owner only, and only while idle.
    /// @dev No unbonding delay: slashes happen only while a node is busy in a round, so
    ///      withdrawal is allowed only while idle.
    function withdrawStake(address operator, uint128 amount) external;

    function setCustomCode(address operator, bool enabled) external;

    /// @notice JobMarket only. Reverts if any operator is not joined or already busy.
    function markBusy(address[] calldata operators, uint256 jobId, uint256 roundId) external;

    /// @notice JobMarket only, on every round close (finalize, fallback, void, revert, abandon).
    function markFree(address[] calldata operators, uint256 jobId, uint256 roundId) external;

    /// @notice JobMarket only. Sends up to `amount` of the stake to the JobMarket.
    /// @return taken min(amount, stake)
    function slash(address operator, uint256 jobId, uint256 roundId, uint256 amount) external returns (uint256 taken);

    /// @notice JobMarket only. Graduates the owner once the total reaches PROBATION_SECONDS.
    function creditWork(address owner, uint256 jobId, uint256 roundId, uint64 seconds_) external;

    /// @notice Deployer only, once.
    function setMarket(address market) external;

    function token() external view returns (address);
    function market() external view returns (address);
    function admitter() external view returns (address);
    function PROBATION_SECONDS() external view returns (uint64);

    function getNode(address operator) external view returns (Node memory);
    function ownerOf(address operator) external view returns (address);
    function nullifierOf(address owner) external view returns (bytes32);
    function isIdle(address operator) external view returns (bool);

    function verifiedWorkSeconds(address owner) external view returns (uint64);
    function graduated(address owner) external view returns (bool);
    /// @notice 0 if not graduated. Round pay counts as graduated only if graduatedAt < the
    ///         round's openedAt, which is how "from the next round" is enforced. PROBATION_SECONDS = 0
    ///         (test deployments) means every owner counts as graduated.
    function graduatedAt(address owner) external view returns (uint64);
}
