// Exchanges prefunded TOD and test USDC at a fixed demo quote on test chains only.
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

contract ToDTestExchange is ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    IERC20 public immutable tod;
    IERC20 public immutable usdc;
    uint256 public constant MIN_REDEEM = 10e6;

    error UnsupportedChain();
    error InvalidToken();
    error InvalidQuote();
    error BelowMinimumRedemption();
    error Expired();
    error InsufficientInventory();
    error UnsupportedTransfer();
    event Swapped(address indexed account, bool todToUsdc, uint256 amountIn, uint256 amountOut);

    constructor(address tod_, address usdc_) {
        if (block.chainid != 31337 && block.chainid != 84532) revert UnsupportedChain();
        if (tod_ == usdc_ || tod_.code.length == 0 || usdc_.code.length == 0) revert InvalidToken();
        if (
            IERC20Metadata(tod_).decimals() != 6 || IERC20Metadata(usdc_).decimals() != 6
                || keccak256(bytes(IERC20Metadata(tod_).symbol())) != keccak256("TOD")
                || keccak256(bytes(IERC20Metadata(usdc_).symbol())) != keccak256("USDC")
        ) revert InvalidToken();
        tod = IERC20(tod_);
        usdc = IERC20(usdc_);
    }

    function swap(bool todToUsdc, uint256 amount, uint256 minOut, uint256 deadline) external nonReentrant {
        if (block.timestamp > deadline) revert Expired();
        if (amount == 0 || minOut == 0 || minOut > amount) revert InvalidQuote();
        if (todToUsdc && amount < MIN_REDEEM) revert BelowMinimumRedemption();
        IERC20 input = todToUsdc ? tod : usdc;
        IERC20 output = todToUsdc ? usdc : tod;
        if (output.balanceOf(address(this)) < amount) revert InsufficientInventory();
        uint256 beforeIn = input.balanceOf(address(this));
        uint256 beforeOut = output.balanceOf(msg.sender);
        input.safeTransferFrom(msg.sender, address(this), amount);
        if (input.balanceOf(address(this)) != beforeIn + amount) revert UnsupportedTransfer();
        output.safeTransfer(msg.sender, amount);
        if (output.balanceOf(msg.sender) != beforeOut + amount) revert UnsupportedTransfer();
        emit Swapped(msg.sender, todToUsdc, amount, amount);
    }
}
