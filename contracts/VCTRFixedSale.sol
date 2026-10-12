// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Immutable, fixed-price VCTR sale for Base Mainnet.
/// @dev No owner, upgrade, pause, or manual close. The sale ends permanently at either immutable limit.
contract VCTRFixedSale is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BASE_MAINNET_CHAIN_ID = 8453;
    uint256 public constant VCTR_DECIMALS = 18;
    uint256 public constant USDC_DECIMALS = 6;
    uint256 public constant VCTR_UNIT = 1e18;

    IERC20 public immutable vctrToken;
    IERC20 public immutable usdcToken;
    address public immutable seller;

    /// @notice Price in USDC micro-units per whole VCTR (18,095 = 0.018095 USDC).
    uint256 public immutable priceMicroUsdcPerVctr;
    uint256 public immutable minimumPurchaseVctr;
    uint256 public immutable maximumSuccessfulPurchases;
    uint256 public immutable maximumSaleVctr;

    uint256 public successfulPurchases;
    uint256 public totalVctrSold;
    bool public closed;

    enum CloseReason {
        PurchaseLimit,
        SupplyLimit
    }

    event TokensPurchased(
        address indexed buyer,
        uint256 indexed purchaseNumber,
        uint256 wholeVctrAmount,
        uint256 usdcAmount
    );
    /// @param unsoldVctrBaseUnitsReturned Returned amount in VCTR's 18-decimal base units.
    event SaleClosed(CloseReason indexed reason, uint256 totalVctrSold, uint256 unsoldVctrBaseUnitsReturned);

    error WrongNetwork(uint256 actualChainId);
    error ZeroAddress();
    error MissingTokenCode(address token);
    error WrongTokenDecimals(address token, uint8 actualDecimals);
    error InvalidSaleParameters();
    error SaleIsClosed();
    error PurchaseBelowMinimum(uint256 requested, uint256 minimum);
    error PurchaseExceedsRemainingSupply(uint256 requested, uint256 remaining);
    error PurchaseLimitReached();
    error SaleInventoryNotFullyFunded(uint256 balance, uint256 required);

    constructor(
        address vctrToken_,
        address usdcToken_,
        address seller_,
        uint256 priceMicroUsdcPerVctr_,
        uint256 minimumPurchaseVctr_,
        uint256 maximumSuccessfulPurchases_,
        uint256 maximumSaleVctr_
    ) {
        if (block.chainid != BASE_MAINNET_CHAIN_ID) revert WrongNetwork(block.chainid);
        if (
            vctrToken_ == address(0) || usdcToken_ == address(0) || seller_ == address(0)
                || vctrToken_ == usdcToken_ || seller_ == vctrToken_ || seller_ == usdcToken_ || seller_ == address(this)
        ) revert ZeroAddress();
        if (vctrToken_.code.length == 0) revert MissingTokenCode(vctrToken_);
        if (usdcToken_.code.length == 0) revert MissingTokenCode(usdcToken_);
        uint8 vctrDecimals = IERC20Metadata(vctrToken_).decimals();
        uint8 usdcDecimals = IERC20Metadata(usdcToken_).decimals();
        if (vctrDecimals != VCTR_DECIMALS) revert WrongTokenDecimals(vctrToken_, vctrDecimals);
        if (usdcDecimals != USDC_DECIMALS) revert WrongTokenDecimals(usdcToken_, usdcDecimals);
        if (
            priceMicroUsdcPerVctr_ == 0 || minimumPurchaseVctr_ == 0 || maximumSuccessfulPurchases_ == 0
                || maximumSaleVctr_ < minimumPurchaseVctr_ || maximumSaleVctr_ % minimumPurchaseVctr_ != 0
        ) revert InvalidSaleParameters();

        vctrToken = IERC20(vctrToken_);
        usdcToken = IERC20(usdcToken_);
        seller = seller_;
        priceMicroUsdcPerVctr = priceMicroUsdcPerVctr_;
        minimumPurchaseVctr = minimumPurchaseVctr_;
        maximumSuccessfulPurchases = maximumSuccessfulPurchases_;
        maximumSaleVctr = maximumSaleVctr_;
    }

    /// @notice Buy an integer number of VCTR tokens. Fractional VCTR purchases are not supported.
    /// @dev The full remaining inventory must be escrowed before the first purchase.
    function buy(uint256 wholeVctrAmount) external nonReentrant {
        if (closed) revert SaleIsClosed();
        if (successfulPurchases >= maximumSuccessfulPurchases) revert PurchaseLimitReached();
        if (wholeVctrAmount < minimumPurchaseVctr) {
            revert PurchaseBelowMinimum(wholeVctrAmount, minimumPurchaseVctr);
        }

        uint256 remainingVctr = maximumSaleVctr - totalVctrSold;
        if (wholeVctrAmount > remainingVctr) {
            revert PurchaseExceedsRemainingSupply(wholeVctrAmount, remainingVctr);
        }

        uint256 requiredInventory = remainingVctr * VCTR_UNIT;
        uint256 inventoryBalance = vctrToken.balanceOf(address(this));
        if (inventoryBalance < requiredInventory) {
            revert SaleInventoryNotFullyFunded(inventoryBalance, requiredInventory);
        }

        uint256 purchaseNumber = successfulPurchases + 1;
        uint256 newTotalSold = totalVctrSold + wholeVctrAmount;
        uint256 usdcAmount = wholeVctrAmount * priceMicroUsdcPerVctr;
        bool saleEndsBySupply = newTotalSold == maximumSaleVctr;
        bool saleEndsByPurchaseCount = purchaseNumber == maximumSuccessfulPurchases;

        // Update state before token interactions; a failed transfer reverts all state changes.
        successfulPurchases = purchaseNumber;
        totalVctrSold = newTotalSold;
        if (saleEndsBySupply || saleEndsByPurchaseCount) closed = true;

        usdcToken.safeTransferFrom(msg.sender, seller, usdcAmount);
        vctrToken.safeTransfer(msg.sender, wholeVctrAmount * VCTR_UNIT);
        emit TokensPurchased(msg.sender, purchaseNumber, wholeVctrAmount, usdcAmount);

        if (closed) {
            uint256 unsoldBalance = vctrToken.balanceOf(address(this));
            if (unsoldBalance != 0) vctrToken.safeTransfer(seller, unsoldBalance);
            emit SaleClosed(
                saleEndsBySupply ? CloseReason.SupplyLimit : CloseReason.PurchaseLimit,
                totalVctrSold,
                unsoldBalance
            );
        }
    }
}
