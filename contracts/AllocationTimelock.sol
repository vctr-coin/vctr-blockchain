// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Holds a fixed allocation until its immutable three-year unlock time.
/// @dev After the cliff, only the named beneficiary can claim the allocation.
contract AllocationTimelock {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    address public immutable beneficiary;
    uint64 public immutable unlockTimestamp;
    uint256 public immutable allocation;
    bool public released;

    event AllocationReleased(address indexed beneficiary, uint256 amount, uint64 unlockTimestamp);

    error ZeroAddress();
    error TimelockActive();
    error OnlyBeneficiary();
    error AlreadyReleased();

    constructor(IERC20 token_, address beneficiary_, uint64 unlockTimestamp_, uint256 allocation_) {
        if (address(token_) == address(0) || beneficiary_ == address(0)) revert ZeroAddress();
        token = token_;
        beneficiary = beneficiary_;
        unlockTimestamp = unlockTimestamp_;
        allocation = allocation_;
    }

    function release() external {
        if (msg.sender != beneficiary) revert OnlyBeneficiary();
        if (block.timestamp < unlockTimestamp) revert TimelockActive();
        if (released) revert AlreadyReleased();

        released = true;
        token.safeTransfer(beneficiary, allocation);
        emit AllocationReleased(beneficiary, allocation, unlockTimestamp);
    }
}
