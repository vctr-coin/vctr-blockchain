// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {VCTRToken} from "../contracts/VCTRToken.sol";
import {FounderVesting} from "../contracts/FounderVesting.sol";
import {AllocationTimelock} from "../contracts/AllocationTimelock.sol";

interface VmInvariant {
    function prank(address sender) external;
    function warp(uint256 timestamp) external;
}

contract VCTRHandler {
    VmInvariant private constant vm = VmInvariant(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant MAX_TIME_STEP = 20 * 365 days + 1;

    VCTRToken public immutable token;
    FounderVesting public immutable founderVesting;
    AllocationTimelock[3] public allocationLocks;
    address[6] private wallets;
    uint256 public simulatedTimestamp;

    constructor(VCTRToken token_, address[6] memory wallets_) {
        token = token_;
        founderVesting = token_.founderVesting();
        allocationLocks = [token_.communityTimelock(), token_.treasuryTimelock(), token_.socialCausesTimelock()];
        wallets = wallets_;
        simulatedTimestamp = block.timestamp;
    }

    function transfer(uint256 fromSeed, uint256 toSeed, uint256 amountSeed) external {
        address from = wallets[fromSeed % wallets.length];
        address to = wallets[toSeed % wallets.length];
        uint256 balance = token.balanceOf(from);
        if (balance == 0) return;
        uint256 amount = 1 + amountSeed % balance;

        vm.prank(from);
        token.transfer(to, amount);
    }

    function approveAndSpend(uint256 ownerSeed, uint256 spenderSeed, uint256 recipientSeed, uint256 amountSeed)
        external
    {
        address owner = wallets[ownerSeed % wallets.length];
        address spender = wallets[spenderSeed % wallets.length];
        address recipient = wallets[recipientSeed % wallets.length];
        if (owner == spender) return;

        uint256 balance = token.balanceOf(owner);
        if (balance == 0) return;
        uint256 amount = 1 + amountSeed % balance;
        vm.prank(owner);
        token.approve(spender, amount);
        vm.prank(spender);
        token.transferFrom(owner, recipient, amount);
    }

    function advanceTime(uint256 secondsSeed) external {
        simulatedTimestamp += secondsSeed % MAX_TIME_STEP;
        vm.warp(simulatedTimestamp);
    }

    function claimFounder() external {
        if (block.timestamp < uint256(founderVesting.startTimestamp()) + founderVesting.CLIFF_DURATION()) return;

        vm.prank(founderVesting.beneficiary());
        try founderVesting.release() returns (uint256) {} catch {}
    }

    function claimAllocation(uint256 lockSeed) external {
        AllocationTimelock lock = allocationLocks[lockSeed % allocationLocks.length];
        if (block.timestamp < lock.unlockTimestamp()) return;

        vm.prank(lock.beneficiary());
        try lock.release() {} catch {}
    }
}

/// @notice Handler-based invariants for the fixed-supply token and its immutable release contracts.
contract VCTRInvariantTest {
    VmInvariant private constant vm = VmInvariant(address(uint160(uint256(keccak256("hevm cheat code")))));

    struct FuzzSelector {
        address addr;
        bytes4[] selectors;
    }

    struct FuzzArtifactSelector {
        string artifact;
        bytes4[] selectors;
    }

    struct FuzzInterface {
        address addr;
        string[] artifacts;
    }

    address private constant LIQUIDITY = address(0x1001);
    address private constant SELLER = address(0x1002);
    address private constant COMMUNITY = address(0x1003);
    address private constant TREASURY = address(0x1004);
    address private constant SOCIAL_CAUSES = address(0x1005);
    address private constant FOUNDER = address(0x1006);

    VCTRToken private token;
    FounderVesting private founderVesting;
    AllocationTimelock[3] private allocationLocks;
    VCTRHandler private handler;
    address[6] private wallets;

    function setUp() public {
        wallets = [LIQUIDITY, SELLER, COMMUNITY, TREASURY, SOCIAL_CAUSES, FOUNDER];
        token = new VCTRToken(LIQUIDITY, SELLER, COMMUNITY, TREASURY, SOCIAL_CAUSES, FOUNDER);
        founderVesting = token.founderVesting();
        allocationLocks = [token.communityTimelock(), token.treasuryTimelock(), token.socialCausesTimelock()];
        handler = new VCTRHandler(token, wallets);
    }

    function test_zeroValueTransfersRevertAndOneWeiTransferSucceeds() public {
        (bool transferSucceeded,) = address(token).call(abi.encodeWithSelector(token.transfer.selector, SELLER, 0));
        require(!transferSucceeded, "zero transfer should revert");

        vm.prank(LIQUIDITY);
        token.approve(FOUNDER, 1);
        vm.prank(FOUNDER);
        (bool transferFromSucceeded,) =
            address(token).call(abi.encodeWithSelector(token.transferFrom.selector, LIQUIDITY, SELLER, 0));
        require(!transferFromSucceeded, "zero transferFrom should revert");

        vm.prank(LIQUIDITY);
        token.transfer(SELLER, 1);
        require(token.balanceOf(SELLER) == 3_000_000_000 * 1e18 + 1, "one wei transfer failed");
    }

    /// @dev Foundry targets only valid, bounded handler actions during invariant campaigns.
    function targetContracts() external view returns (address[] memory targets) {
        targets = new address[](1);
        targets[0] = address(handler);
    }

    function excludeArtifacts() external pure returns (string[] memory) {
        return new string[](0);
    }

    function excludeContracts() external pure returns (address[] memory) {
        return new address[](0);
    }

    function excludeSelectors() external pure returns (FuzzSelector[] memory) {
        return new FuzzSelector[](0);
    }

    function excludeSenders() external pure returns (address[] memory) {
        return new address[](0);
    }

    function targetArtifacts() external pure returns (string[] memory) {
        return new string[](0);
    }

    function targetArtifactSelectors() external pure returns (FuzzArtifactSelector[] memory) {
        return new FuzzArtifactSelector[](0);
    }

    function targetInterfaces() external pure returns (FuzzInterface[] memory) {
        return new FuzzInterface[](0);
    }

    function targetSelectors() external pure returns (FuzzSelector[] memory) {
        return new FuzzSelector[](0);
    }

    function targetSenders() external pure returns (address[] memory) {
        return new address[](0);
    }

    function invariant_supplyIsFixedAndBalancesRemainConserved() public view {
        require(token.totalSupply() == token.TOTAL_SUPPLY(), "total supply changed");

        uint256 accounted = token.balanceOf(address(founderVesting));
        for (uint256 i; i < wallets.length; ++i) {
            accounted += token.balanceOf(wallets[i]);
        }
        for (uint256 i; i < allocationLocks.length; ++i) {
            accounted += token.balanceOf(address(allocationLocks[i]));
        }
        require(accounted == token.totalSupply(), "tracked balances do not equal total supply");
    }

    function invariant_releasesRespectSchedulesAndNeverExceedAllocations() public view {
        uint256 released = founderVesting.released();
        require(released <= founderVesting.vestedAmount(uint64(block.timestamp)), "founder released ahead of vesting");
        require(released <= token.FOUNDER_ALLOCATION(), "founder release exceeded allocation");
        require(
            released + token.balanceOf(address(founderVesting)) == token.FOUNDER_ALLOCATION(),
            "founder allocation was not conserved"
        );

        for (uint256 i; i < allocationLocks.length; ++i) {
            AllocationTimelock lock = allocationLocks[i];
            if (lock.released()) {
                require(block.timestamp >= lock.unlockTimestamp(), "allocation released before unlock");
                require(token.balanceOf(address(lock)) == 0, "released allocation remains in timelock");
            } else {
                require(token.balanceOf(address(lock)) == lock.allocation(), "unreleased allocation changed");
            }
        }
    }
}
