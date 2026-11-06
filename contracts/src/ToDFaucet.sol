// Distributes a fixed allocation from prefunded TOD inventory to each claimant on a cooldown.
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

contract ToDFaucet is ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    uint256 public immutable allocation;
    uint256 public immutable cooldown;
    mapping(address => uint256) public nextClaimAt;

    error InvalidConfiguration();
    error CooldownActive(uint256 nextClaim);
    error EmptyFaucet();
    event Claimed(address indexed account, uint256 amount, uint256 nextClaim);

    constructor(address token_, uint256 allocation_, uint256 cooldown_) {
        if (token_.code.length == 0 || allocation_ == 0 || cooldown_ == 0 || cooldown_ > 30 days) {
            revert InvalidConfiguration();
        }
        if (
            IERC20Metadata(token_).decimals() != 6
                || keccak256(bytes(IERC20Metadata(token_).symbol())) != keccak256("TOD")
        ) {
            revert InvalidConfiguration();
        }
        token = IERC20(token_);
        allocation = allocation_;
        cooldown = cooldown_;
    }

    function claim() external nonReentrant {
        if (block.timestamp < nextClaimAt[msg.sender]) revert CooldownActive(nextClaimAt[msg.sender]);
        if (token.balanceOf(address(this)) < allocation) revert EmptyFaucet();
        uint256 next = block.timestamp + cooldown;
        nextClaimAt[msg.sender] = next;
        token.safeTransfer(msg.sender, allocation);
        emit Claimed(msg.sender, allocation, next);
    }
}
