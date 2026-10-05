// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Holds the founder allocation for a 15-year cliff then 5-year linear vest.
/// @dev No owner, admin, beneficiary changes, or early-release path exists.
contract FounderVesting {
    using SafeERC20 for IERC20;

    uint256 public constant FOUNDER_ALLOCATION = 3_000_000_000 * 1e18;
    uint64 public constant CLIFF_DURATION = 15 * 365 days;
    uint64 public constant VESTING_DURATION = 5 * 365 days;

    IERC20 public immutable token;
    address public immutable beneficiary;
    uint64 public immutable startTimestamp;
    uint256 public released;

    event TokensReleased(address indexed beneficiary, uint256 amount, uint256 totalReleased);

    error ZeroAddress();
    error OnlyBeneficiary();
    error NothingToRelease();

    constructor(IERC20 token_, address beneficiary_, uint64 startTimestamp_) {
        if (address(token_) == address(0) || beneficiary_ == address(0)) revert ZeroAddress();
        token = token_;
        beneficiary = beneficiary_;
        startTimestamp = startTimestamp_;
    }

    /// @notice Total founder tokens vested at `timestamp` under the fixed schedule.
    function vestedAmount(uint64 timestamp) public view returns (uint256) {
        uint256 cliffEnd = uint256(startTimestamp) + CLIFF_DURATION;
        if (timestamp < cliffEnd) return 0;

        uint256 vestingEnd = cliffEnd + VESTING_DURATION;
        if (timestamp >= vestingEnd) return FOUNDER_ALLOCATION;

        return (FOUNDER_ALLOCATION * (uint256(timestamp) - cliffEnd)) / VESTING_DURATION;
    }

    function releasableAmount() public view returns (uint256) {
        return vestedAmount(uint64(block.timestamp)) - released;
    }

    /// @notice The beneficiary claims vested tokens; anyone else is rejected.
    function release() external returns (uint256 amount) {
        if (msg.sender != beneficiary) revert OnlyBeneficiary();
        amount = releasableAmount();
        if (amount == 0) revert NothingToRelease();

        released += amount;
        token.safeTransfer(beneficiary, amount);
        emit TokensReleased(beneficiary, amount, released);
    }
}
