// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {AllocationTimelock} from "./AllocationTimelock.sol";
import {FounderVesting} from "./FounderVesting.sol";

/// @notice Fixed-supply VCTR AI Token with immutable initial allocation recipients.
/// @dev All allocation addresses are constructor inputs and must be checked before deployment.
contract VCTRToken is ERC20 {
    uint256 public constant TOKEN_UNIT = 1e18;
    uint256 public constant TOTAL_SUPPLY = 10_000_000_000 * TOKEN_UNIT;
    uint256 public constant FOUNDER_ALLOCATION = 3_000_000_000 * TOKEN_UNIT;
    uint256 public constant LIQUIDITY_ALLOCATION = 1_000_000_000 * TOKEN_UNIT;
    uint256 public constant DIRECT_SALES_ALLOCATION = 3_000_000_000 * TOKEN_UNIT;
    uint256 public constant COMMUNITY_ALLOCATION = 500_000_000 * TOKEN_UNIT;
    uint256 public constant TREASURY_ALLOCATION = 1_000_000_000 * TOKEN_UNIT;
    uint256 public constant SOCIAL_CAUSES_ALLOCATION = 1_500_000_000 * TOKEN_UNIT;
    uint64 public constant ALLOCATION_LOCK_DURATION = 3 * 365 days;

    FounderVesting public immutable founderVesting;
    AllocationTimelock public immutable communityTimelock;
    AllocationTimelock public immutable treasuryTimelock;
    AllocationTimelock public immutable socialCausesTimelock;

    event FounderVestingCreated(address indexed vestingContract, address indexed beneficiary, uint64 startTimestamp);
    event AllocationTimelockCreated(
        address indexed timelock, address indexed beneficiary, uint256 amount, uint64 unlockTimestamp
    );

    error ZeroAddress();
    error ZeroTransfer();
    error DuplicateRecipient();

    /// @dev Reject zero-value token transfers while leaving construction minting unaffected.
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0) && value == 0) revert ZeroTransfer();
        super._update(from, to, value);
    }

    constructor(
        address liquidityReserve_,
        address seller_,
        address communityAndEcosystem_,
        address projectTreasury_,
        address socialCauses_,
        address founderBeneficiary_
    ) ERC20("VCTR AI Token", "VCTR") {
        address[6] memory recipients = [
            liquidityReserve_, seller_, communityAndEcosystem_, projectTreasury_, socialCauses_, founderBeneficiary_
        ];

        for (uint256 i; i < recipients.length; ++i) {
            if (recipients[i] == address(0)) revert ZeroAddress();
            for (uint256 j = i + 1; j < recipients.length; ++j) {
                if (recipients[i] == recipients[j]) revert DuplicateRecipient();
            }
        }

        uint64 launchTimestamp = uint64(block.timestamp);
        FounderVesting vesting = new FounderVesting(this, founderBeneficiary_, launchTimestamp);
        founderVesting = vesting;

        uint64 allocationUnlockTimestamp = launchTimestamp + ALLOCATION_LOCK_DURATION;
        AllocationTimelock communityLock =
            new AllocationTimelock(this, communityAndEcosystem_, allocationUnlockTimestamp, COMMUNITY_ALLOCATION);
        communityTimelock = communityLock;
        AllocationTimelock treasuryLock =
            new AllocationTimelock(this, projectTreasury_, allocationUnlockTimestamp, TREASURY_ALLOCATION);
        treasuryTimelock = treasuryLock;
        AllocationTimelock socialCausesLock =
            new AllocationTimelock(this, socialCauses_, allocationUnlockTimestamp, SOCIAL_CAUSES_ALLOCATION);
        socialCausesTimelock = socialCausesLock;

        _mint(address(vesting), FOUNDER_ALLOCATION);
        _mint(liquidityReserve_, LIQUIDITY_ALLOCATION);
        _mint(seller_, DIRECT_SALES_ALLOCATION);
        _mint(address(communityLock), COMMUNITY_ALLOCATION);
        _mint(address(treasuryLock), TREASURY_ALLOCATION);
        _mint(address(socialCausesLock), SOCIAL_CAUSES_ALLOCATION);

        emit FounderVestingCreated(address(vesting), founderBeneficiary_, launchTimestamp);
        emit AllocationTimelockCreated(
            address(communityLock), communityAndEcosystem_, COMMUNITY_ALLOCATION, allocationUnlockTimestamp
        );
        emit AllocationTimelockCreated(
            address(treasuryLock), projectTreasury_, TREASURY_ALLOCATION, allocationUnlockTimestamp
        );
        emit AllocationTimelockCreated(
            address(socialCausesLock), socialCauses_, SOCIAL_CAUSES_ALLOCATION, allocationUnlockTimestamp
        );
    }
}
