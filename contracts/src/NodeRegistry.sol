// Pairs owners and operators and tracks stake and round participation.
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {INodeRegistry} from "./INodeRegistry.sol";
import {Encodings} from "./Encodings.sol";

contract NodeRegistry is INodeRegistry, EIP712, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    address public immutable token;
    address public immutable admitter;
    // Immutable rather than constant so tests can graduate owners without 18000 s of rounds.
    uint64 public immutable PROBATION_SECONDS;
    address public market;
    address private immutable _deployer;

    mapping(address => Node) private _nodes;
    mapping(address => bytes32) public nullifierOf;
    mapping(bytes32 => address) private _nullifierOwner;
    mapping(address => uint64) public verifiedWorkSeconds;
    mapping(address => uint64) public graduatedAt;

    modifier onlyMarket() {
        if (msg.sender != market) revert NotAuthorized();
        _;
    }

    modifier onlyOwnerOf(address operator) {
        if (!_nodes[operator].joined) revert NotJoined();
        if (_nodes[operator].owner != msg.sender) revert NotAuthorized();
        _;
    }

    constructor(address token_, address admitter_, uint64 probationSeconds) EIP712("ToD", "1") {
        if (token_ == address(0) || admitter_ == address(0)) revert BadInput();
        token = token_;
        admitter = admitter_;
        PROBATION_SECONDS = probationSeconds;
        _deployer = msg.sender;
    }

    function setMarket(address market_) external {
        if (msg.sender != _deployer || market != address(0)) revert NotAuthorized();
        if (market_ == address(0)) revert BadInput();
        market = market_;
        emit MarketSet(market_);
    }

    function join(
        address operator,
        bytes32 nullifier,
        uint64 inviteDeadline,
        uint64 consentDeadline,
        bytes calldata inviteSig,
        bytes calldata consentSig
    ) external {
        if (block.timestamp > inviteDeadline || block.timestamp > consentDeadline) {
            revert Expired();
        }
        if (operator == address(0) || nullifier == bytes32(0)) revert BadInput();
        if (_nodes[operator].joined) revert AlreadyJoined();
        address bound = _nullifierOwner[nullifier];
        if (bound != address(0) && bound != msg.sender) revert NullifierUsed();
        bytes32 mine = nullifierOf[msg.sender];
        if (mine != bytes32(0) && mine != nullifier) revert NullifierUsed();

        _requireSigner(Encodings.inviteHash(operator, msg.sender, nullifier, inviteDeadline), inviteSig, admitter);
        _requireSigner(Encodings.consentHash(msg.sender, operator, consentDeadline), consentSig, operator);

        _nullifierOwner[nullifier] = msg.sender;
        nullifierOf[msg.sender] = nullifier;
        _nodes[operator].owner = msg.sender;
        _nodes[operator].joined = true;
        emit NodeJoined(operator, msg.sender, nullifier);
    }

    function depositStake(address operator, uint128 amount) external nonReentrant onlyOwnerOf(operator) {
        if (amount == 0) revert BadInput();
        Node storage n = _nodes[operator];
        n.stake += amount;
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        emit StakeDeposited(operator, amount, n.stake);
    }

    function withdrawStake(address operator, uint128 amount) external nonReentrant onlyOwnerOf(operator) {
        Node storage n = _nodes[operator];
        if (n.busyJob != 0) revert NodeIsBusy();
        if (amount == 0 || amount > n.stake) revert BadInput();
        n.stake -= amount;
        IERC20(token).safeTransfer(msg.sender, amount);
        emit StakeWithdrawn(operator, msg.sender, amount, n.stake);
    }

    function setCustomCode(address operator, bool enabled) external onlyOwnerOf(operator) {
        _nodes[operator].customCode = enabled;
        emit CustomCodeSet(operator, enabled);
    }

    function markBusy(address[] calldata operators, uint256 jobId, uint256 roundId) external onlyMarket {
        if (jobId == 0) revert BadInput();
        for (uint256 i; i < operators.length; i++) {
            Node storage n = _nodes[operators[i]];
            if (!n.joined) revert NotJoined();
            if (n.busyJob != 0) revert NodeIsBusy();
            n.busyJob = jobId;
            n.busyRound = roundId;
            emit NodeBusy(operators[i], jobId, roundId);
        }
    }

    function markFree(address[] calldata operators, uint256 jobId, uint256 roundId) external onlyMarket {
        for (uint256 i; i < operators.length; i++) {
            Node storage n = _nodes[operators[i]];
            if (n.busyJob != jobId || n.busyRound != roundId) revert NodeNotBusy();
            n.busyJob = 0;
            n.busyRound = 0;
            emit NodeFreed(operators[i], jobId, roundId);
        }
    }

    /// @dev Only a node busy in that round can be slashed, which is why withdrawals need no unbonding delay.
    function slash(address operator, uint256 jobId, uint256 roundId, uint256 amount)
        external
        onlyMarket
        returns (uint256 taken)
    {
        Node storage n = _nodes[operator];
        if (n.busyJob != jobId || n.busyRound != roundId) revert NodeNotBusy();
        taken = amount < n.stake ? amount : n.stake;
        if (taken == 0) return 0;
        n.stake -= uint128(taken);
        IERC20(token).safeTransfer(market, taken);
        emit StakeSlashed(operator, jobId, roundId, taken);
    }

    function creditWork(address owner, uint256 jobId, uint256 roundId, uint64 seconds_) external onlyMarket {
        uint64 total = verifiedWorkSeconds[owner] + seconds_;
        verifiedWorkSeconds[owner] = total;
        emit WorkCredited(owner, jobId, roundId, seconds_, total);
        if (graduatedAt[owner] == 0 && total >= PROBATION_SECONDS) {
            graduatedAt[owner] = uint64(block.timestamp);
            emit Graduated(owner, uint64(block.timestamp));
        }
    }

    function getNode(address operator) external view returns (Node memory) {
        return _nodes[operator];
    }

    function ownerOf(address operator) external view returns (address) {
        return _nodes[operator].owner;
    }

    function isIdle(address operator) external view returns (bool) {
        return _nodes[operator].joined && _nodes[operator].busyJob == 0;
    }

    function graduated(address owner) external view returns (bool) {
        return PROBATION_SECONDS == 0 || graduatedAt[owner] != 0;
    }

    function _requireSigner(bytes32 structHash, bytes calldata sig, address expected) private view {
        (address got, ECDSA.RecoverError err,) = ECDSA.tryRecover(_hashTypedDataV4(structHash), sig);
        if (err != ECDSA.RecoverError.NoError || got != expected) revert BadSignature();
    }
}
