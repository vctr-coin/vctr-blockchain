// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Fixed-price, permit-gated VCTR sale with delayed proceeds-policy changes.
/// @dev No upgrade path. The Seller and Project Treasury jointly authorize pause,
///      resume, termination, signer rotation, and recovery of unsolicited tokens.
contract VCTRSale is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant TOKEN_UNIT = 1e18;
    uint256 public constant USDC_UNIT = 1e6;
    uint256 public constant PRICE_USDC_MICRO_PER_VCTR = 18_095;
    uint256 public constant MIN_PURCHASE = 100 * TOKEN_UNIT;
    uint256 public constant MAX_SALE = 3_000_000_000 * TOKEN_UNIT;
    uint256 public constant MAX_PURCHASES = 30_000_000;
    uint256 public constant MAX_BPS = 10_000;
    uint64 public constant POLICY_NOTICE = 30 days;
    uint64 public constant MAX_PERMIT_LIFETIME = 10 minutes;
    uint64 public constant MAX_ADMIN_SIGNATURE_LIFETIME = 1 days;

    bytes32 private constant PURCHASE_TYPEHASH = keccak256(
        "PurchaseAuthorization(address buyer,uint256 vctrAmount,uint256 usdcAmount,bytes32 referenceId,bytes32 nonce,uint64 deadline,uint64 splitVersion)"
    );
    bytes32 private constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant DOMAIN_NAME_HASH = keccak256("VCTR Direct Sale");
    bytes32 private constant DOMAIN_VERSION_HASH = keccak256("1");
    bytes32 private constant CONTROL_TYPEHASH = keccak256(
        "ControlApproval(bytes32 action,uint256 nonce,uint64 deadline,bytes32 dataHash)"
    );
    bytes32 private constant ACTION_PAUSE = keccak256("PAUSE");
    bytes32 private constant ACTION_RESUME = keccak256("RESUME");
    bytes32 private constant ACTION_TERMINATE = keccak256("TERMINATE");
    bytes32 private constant ACTION_ROTATE_SIGNER = keccak256("ROTATE_SIGNER");
    bytes32 private constant ACTION_RECOVER_USDC = keccak256("RECOVER_UNSOLICITED_USDC");
    bytes32 private constant ACTION_RECOVER_VCTR = keccak256("RECOVER_UNSOLICITED_VCTR");

    IERC20 public immutable vctr;
    IERC20 public immutable usdc;
    address public immutable seller;
    address public immutable projectTreasurySigner;

    address public authorizationSigner;
    address public pendingAuthorizationSigner;
    uint64 public pendingAuthorizationSignerAt;

    uint256 public accountedInventory;
    uint256 public totalSold;
    uint256 public successfulPurchaseCount;
    uint256 public controlNonce;
    uint64 public splitVersion = 1;
    bool public paused;
    bool public closed;

    struct PurchaseAuthorization {
        address buyer;
        uint256 vctrAmount;
        uint256 usdcAmount;
        bytes32 referenceId;
        bytes32 nonce;
        uint64 deadline;
        uint64 splitVersion;
    }

    struct SplitConfig {
        address[5] wallets;
        uint16 tdsBps;
        uint16 incomeTaxBps;
        uint16 surchargeBps;
        uint16 cessBps;
    }

    struct ScheduledSplit {
        SplitConfig config;
        uint64 effectiveAt;
        bool exists;
    }

    SplitConfig private activeSplit;
    ScheduledSplit private scheduledSplit;
    mapping(bytes32 nonce => bool used) public usedNonces;
    mapping(bytes32 referenceId => bool used) public usedReferences;

    event InventoryFunded(address indexed seller, uint256 amount, uint256 totalAccountedInventory);
    event PurchaseCompleted(
        address indexed buyer,
        uint256 vctrAmount,
        uint256 usdcAmount,
        bytes32 indexed referenceId,
        bytes32 nonce,
        uint64 splitVersion,
        uint256 tdsAmount,
        uint256 incomeTaxAmount,
        uint256 surchargeAmount,
        uint256 cessAmount,
        uint256 residualAmount
    );
    event SalePaused(uint256 indexed controlNonce);
    event SaleResumed(uint256 indexed controlNonce);
    event SaleTerminated(address indexed seller, uint256 unsoldVctr, uint256 indexed controlNonce);
    event SaleClosedAtCap(uint256 totalSold, uint256 successfulPurchases);
    event SplitScheduled(uint64 indexed effectiveAt, uint64 indexed nextVersion);
    event SplitScheduleCancelled(uint64 indexed cancelledEffectiveAt);
    event SplitActivated(uint64 indexed version, uint64 effectiveAt);
    event AuthorizationSignerChangeScheduled(address indexed signer, uint64 indexed effectiveAt);
    event AuthorizationSignerChanged(address indexed previousSigner, address indexed newSigner);
    event UnsolicitedUsdcRecovered(address indexed seller, uint256 amount, uint256 indexed controlNonce);
    event UnsolicitedVctrRecovered(address indexed seller, uint256 amount, uint256 indexed controlNonce);

    error ZeroAddress();
    error InvalidTokenDecimals();
    error InvalidWallets();
    error SignerMustBeEoa();
    error OnlySeller();
    error OnlySellerOrTreasury();
    error AlreadyPaused();
    error NotPaused();
    error SaleClosed();
    error SalePausedError();
    error InvalidAmount();
    error FractionalVctrNotSupported();
    error PurchaseTooSmall();
    error SaleLimitReached();
    error InventoryInsufficient();
    error InventoryExceedsSaleCap();
    error InvalidPaymentAmount();
    error InvalidAuthorization();
    error AuthorizationExpired();
    error AuthorizationTooLong();
    error NonceAlreadyUsed();
    error ReferenceAlreadyUsed();
    error SplitVersionMismatch();
    error InvalidSplit();
    error PendingSplitExists();
    error NoPendingSplit();
    error SplitNotReady();
    error NoticeTooShort();
    error InvalidDeadline();
    error InvalidControlSignatures();
    error SignerChangePending();
    error NoSignerChangePending();
    error UnsolicitedUsdcInsufficient();
    error UnsolicitedVctrInsufficient();
    error UnexpectedUsdcBalance();

    modifier onlySeller() {
        if (msg.sender != seller) revert OnlySeller();
        _;
    }

    constructor(
        IERC20 vctr_,
        IERC20 usdc_,
        address seller_,
        address projectTreasurySigner_,
        address authorizationSigner_,
        address[5] memory payoutWallets_
    ) {
        if (
            address(vctr_) == address(0) || address(usdc_) == address(0) || seller_ == address(0)
                || projectTreasurySigner_ == address(0) || authorizationSigner_ == address(0)
        ) revert ZeroAddress();
        if (
            seller_ == projectTreasurySigner_ || seller_ == authorizationSigner_
                || projectTreasurySigner_ == authorizationSigner_
        ) revert InvalidWallets();
        if (
            seller_.code.length != 0 || projectTreasurySigner_.code.length != 0
                || authorizationSigner_.code.length != 0
        ) revert SignerMustBeEoa();
        if (IERC20Metadata(address(vctr_)).decimals() != 18 || IERC20Metadata(address(usdc_)).decimals() != 6) {
            revert InvalidTokenDecimals();
        }
        _validateWallets(payoutWallets_);

        vctr = vctr_;
        usdc = usdc_;
        seller = seller_;
        projectTreasurySigner = projectTreasurySigner_;
        authorizationSigner = authorizationSigner_;
        activeSplit.wallets = payoutWallets_;
        activeSplit.tdsBps = 100;
        activeSplit.incomeTaxBps = 3_000;
        activeSplit.surchargeBps = 2_500;
        activeSplit.cessBps = 400;
    }

    /// @notice Seller stages VCTR inventory. Only deposited/accounted VCTR can be sold.
    function fundInventory(uint256 amount) external onlySeller nonReentrant {
        if (closed) revert SaleClosed();
        if (amount == 0) revert InvalidAmount();
        if (amount % TOKEN_UNIT != 0) revert FractionalVctrNotSupported();
        if (amount > MAX_SALE - totalSold - accountedInventory) revert InventoryExceedsSaleCap();
        vctr.safeTransferFrom(msg.sender, address(this), amount);
        accountedInventory += amount;
        emit InventoryFunded(msg.sender, amount, accountedInventory);
    }

    /// @notice Returns the exact payment and split under the currently effective policy.
    function quote(uint256 vctrAmount)
        external
        view
        returns (
            uint256 usdcAmount,
            uint256 tdsAmount,
            uint256 incomeTaxAmount,
            uint256 surchargeAmount,
            uint256 cessAmount,
            uint256 residualAmount,
            uint64 version
        )
    {
        SplitConfig memory config = activeSplit;
        version = splitVersion;
        if (scheduledSplit.exists && block.timestamp >= scheduledSplit.effectiveAt) {
            config = scheduledSplit.config;
            version += 1;
        }
        usdcAmount = _usdcFor(vctrAmount);
        (tdsAmount, incomeTaxAmount, surchargeAmount, cessAmount, residualAmount) = _split(usdcAmount, config);
    }

    /// @notice Buyer submits an exact, backend-authorized purchase and pays its gas.
    function buy(PurchaseAuthorization calldata authorization, bytes calldata signature) external nonReentrant {
        if (closed) revert SaleClosed();
        if (paused) revert SalePausedError();
        _activateScheduledSplitIfDue();

        if (authorization.buyer != msg.sender || authorization.buyer == address(0)) revert InvalidAuthorization();
        if (authorization.deadline < block.timestamp) revert AuthorizationExpired();
        if (authorization.deadline > block.timestamp + MAX_PERMIT_LIFETIME) revert AuthorizationTooLong();
        if (authorization.splitVersion != splitVersion) revert SplitVersionMismatch();
        if (authorization.nonce == bytes32(0)) revert InvalidAuthorization();
        if (usedNonces[authorization.nonce]) revert NonceAlreadyUsed();
        if (authorization.referenceId == bytes32(0)) revert InvalidAuthorization();
        if (usedReferences[authorization.referenceId]) revert ReferenceAlreadyUsed();
        (address recoveredSigner,,) = ECDSA.tryRecoverCalldata(_purchaseDigest(authorization), signature);
        if (recoveredSigner != authorizationSigner) {
            revert InvalidAuthorization();
        }

        uint256 expectedUsdc = _usdcFor(authorization.vctrAmount);
        if (authorization.usdcAmount != expectedUsdc) revert InvalidPaymentAmount();
        if (
            successfulPurchaseCount >= MAX_PURCHASES
                || authorization.vctrAmount > MAX_SALE - totalSold
        ) {
            revert SaleLimitReached();
        }
        if (accountedInventory < authorization.vctrAmount) revert InventoryInsufficient();

        (uint256 tdsAmount, uint256 incomeTaxAmount, uint256 surchargeAmount, uint256 cessAmount, uint256 residualAmount) =
            _split(expectedUsdc, activeSplit);

        usedNonces[authorization.nonce] = true;
        usedReferences[authorization.referenceId] = true;
        ++successfulPurchaseCount;
        totalSold += authorization.vctrAmount;
        accountedInventory -= authorization.vctrAmount;

        uint256 balanceBefore = usdc.balanceOf(address(this));
        usdc.safeTransferFrom(msg.sender, address(this), expectedUsdc);
        if (usdc.balanceOf(address(this)) != balanceBefore + expectedUsdc) revert UnexpectedUsdcBalance();

        _pay(activeSplit.wallets[0], tdsAmount);
        _pay(activeSplit.wallets[1], incomeTaxAmount);
        _pay(activeSplit.wallets[2], surchargeAmount);
        _pay(activeSplit.wallets[3], cessAmount);
        _pay(activeSplit.wallets[4], residualAmount);
        vctr.safeTransfer(msg.sender, authorization.vctrAmount);

        emit PurchaseCompleted(
            msg.sender,
            authorization.vctrAmount,
            expectedUsdc,
            authorization.referenceId,
            authorization.nonce,
            splitVersion,
            tdsAmount,
            incomeTaxAmount,
            surchargeAmount,
            cessAmount,
            residualAmount
        );

        if (totalSold == MAX_SALE || successfulPurchaseCount == MAX_PURCHASES) {
            closed = true;
            emit SaleClosedAtCap(totalSold, successfulPurchaseCount);
        }
    }

    /// @notice Seller proposes new split wallets/rates, effective no sooner than 30 days later.
    function scheduleSplit(
        address[5] calldata payoutWallets_,
        uint16 tdsBps_,
        uint16 incomeTaxBps_,
        uint16 surchargeBps_,
        uint16 cessBps_,
        uint64 effectiveAt_
    ) external onlySeller {
        if (closed) revert SaleClosed();
        if (scheduledSplit.exists) revert PendingSplitExists();
        if (effectiveAt_ < block.timestamp + POLICY_NOTICE) revert NoticeTooShort();
        _validateWallets(payoutWallets_);
        _validateSplit(tdsBps_, incomeTaxBps_, surchargeBps_, cessBps_);

        scheduledSplit.config.wallets = payoutWallets_;
        scheduledSplit.config.tdsBps = tdsBps_;
        scheduledSplit.config.incomeTaxBps = incomeTaxBps_;
        scheduledSplit.config.surchargeBps = surchargeBps_;
        scheduledSplit.config.cessBps = cessBps_;
        scheduledSplit.effectiveAt = effectiveAt_;
        scheduledSplit.exists = true;
        emit SplitScheduled(effectiveAt_, splitVersion + 1);
    }

    /// @notice Seller may cancel an announced split before it becomes active.
    function cancelScheduledSplit() external onlySeller {
        if (!scheduledSplit.exists) revert NoPendingSplit();
        uint64 effectiveAt = scheduledSplit.effectiveAt;
        delete scheduledSplit;
        emit SplitScheduleCancelled(effectiveAt);
    }

    /// @notice Anyone may activate an already-announced split after its effective time.
    function activateScheduledSplit() external {
        if (closed) revert SaleClosed();
        if (!scheduledSplit.exists) revert NoPendingSplit();
        if (block.timestamp < scheduledSplit.effectiveAt) revert SplitNotReady();
        _activateScheduledSplit();
    }

    function activeSplitConfig()
        external
        view
        returns (address[5] memory wallets, uint16 tdsBps, uint16 incomeTaxBps, uint16 surchargeBps, uint16 cessBps, uint64 version)
    {
        return (
            activeSplit.wallets,
            activeSplit.tdsBps,
            activeSplit.incomeTaxBps,
            activeSplit.surchargeBps,
            activeSplit.cessBps,
            splitVersion
        );
    }

    function pendingSplitConfig()
        external
        view
        returns (
            bool exists,
            address[5] memory wallets,
            uint16 tdsBps,
            uint16 incomeTaxBps,
            uint16 surchargeBps,
            uint16 cessBps,
            uint64 effectiveAt
        )
    {
        ScheduledSplit storage pending = scheduledSplit;
        return (
            pending.exists,
            pending.config.wallets,
            pending.config.tdsBps,
            pending.config.incomeTaxBps,
            pending.config.surchargeBps,
            pending.config.cessBps,
            pending.effectiveAt
        );
    }

    function pause(uint64 deadline, bytes calldata sellerSignature, bytes calldata treasurySignature) external {
        if (closed) revert SaleClosed();
        if (paused) revert AlreadyPaused();
        _consumeDualApproval(ACTION_PAUSE, bytes32(0), deadline, sellerSignature, treasurySignature);
        paused = true;
        emit SalePaused(controlNonce - 1);
    }

    function resume(uint64 deadline, bytes calldata sellerSignature, bytes calldata treasurySignature) external {
        if (closed) revert SaleClosed();
        if (!paused) revert NotPaused();
        _consumeDualApproval(ACTION_RESUME, bytes32(0), deadline, sellerSignature, treasurySignature);
        paused = false;
        emit SaleResumed(controlNonce - 1);
    }

    /// @notice Dual-approved terminal close. All remaining VCTR is returned to the Seller.
    function terminate(uint64 deadline, bytes calldata sellerSignature, bytes calldata treasurySignature)
        external
        nonReentrant
    {
        if (closed) revert SaleClosed();
        _consumeDualApproval(ACTION_TERMINATE, bytes32(0), deadline, sellerSignature, treasurySignature);
        closed = true;
        paused = true;
        uint256 unsold = vctr.balanceOf(address(this));
        accountedInventory = 0;
        if (unsold != 0) vctr.safeTransfer(seller, unsold);
        emit SaleTerminated(seller, unsold, controlNonce - 1);
    }

    /// @notice Dual-approved signer rotation with a 30-day notice period.
    function scheduleAuthorizationSigner(
        address newSigner,
        uint64 effectiveAt,
        uint64 deadline,
        bytes calldata sellerSignature,
        bytes calldata treasurySignature
    ) external {
        if (closed) revert SaleClosed();
        if (newSigner == address(0) || newSigner == seller || newSigner == projectTreasurySigner) revert ZeroAddress();
        if (newSigner.code.length != 0) revert SignerMustBeEoa();
        if (pendingAuthorizationSigner != address(0)) revert SignerChangePending();
        if (effectiveAt < block.timestamp + POLICY_NOTICE) revert NoticeTooShort();
        bytes32 dataHash = keccak256(abi.encode(newSigner, effectiveAt));
        _consumeDualApproval(ACTION_ROTATE_SIGNER, dataHash, deadline, sellerSignature, treasurySignature);
        pendingAuthorizationSigner = newSigner;
        pendingAuthorizationSignerAt = effectiveAt;
        emit AuthorizationSignerChangeScheduled(newSigner, effectiveAt);
    }

    function activateAuthorizationSigner() external {
        address nextSigner = pendingAuthorizationSigner;
        if (nextSigner == address(0)) revert NoSignerChangePending();
        if (block.timestamp < pendingAuthorizationSignerAt) revert SplitNotReady();
        address previousSigner = authorizationSigner;
        authorizationSigner = nextSigner;
        pendingAuthorizationSigner = address(0);
        pendingAuthorizationSignerAt = 0;
        emit AuthorizationSignerChanged(previousSigner, nextSigner);
    }

    /// @notice Dual-approved recovery of USDC sent directly to the sale outside `buy`.
    /// @dev Sends only to the fixed Seller; this is not a purchase or tax classification.
    function recoverUnsolicitedUsdc(
        uint256 amount,
        uint64 deadline,
        bytes calldata sellerSignature,
        bytes calldata treasurySignature
    ) external nonReentrant {
        if (amount == 0 || amount > usdc.balanceOf(address(this))) revert UnsolicitedUsdcInsufficient();
        bytes32 dataHash = keccak256(abi.encode(amount, seller));
        _consumeDualApproval(ACTION_RECOVER_USDC, dataHash, deadline, sellerSignature, treasurySignature);
        usdc.safeTransfer(seller, amount);
        emit UnsolicitedUsdcRecovered(seller, amount, controlNonce - 1);
    }

    /// @notice Dual-approved recovery of VCTR not tracked as sale inventory.
    /// @dev Can recover accidental token transfers without withdrawing staged inventory before closure.
    function recoverUnsolicitedVctr(
        uint256 amount,
        uint64 deadline,
        bytes calldata sellerSignature,
        bytes calldata treasurySignature
    ) external nonReentrant {
        uint256 balance = vctr.balanceOf(address(this));
        if (amount == 0 || balance < accountedInventory || amount > balance - accountedInventory) {
            revert UnsolicitedVctrInsufficient();
        }
        bytes32 dataHash = keccak256(abi.encode(amount, seller));
        _consumeDualApproval(ACTION_RECOVER_VCTR, dataHash, deadline, sellerSignature, treasurySignature);
        vctr.safeTransfer(seller, amount);
        emit UnsolicitedVctrRecovered(seller, amount, controlNonce - 1);
    }

    function purchaseDigest(PurchaseAuthorization calldata authorization) external view returns (bytes32) {
        return _purchaseDigest(authorization);
    }

    function controlDigest(bytes32 action, bytes32 dataHash, uint64 deadline) external view returns (bytes32) {
        return _controlDigest(action, controlNonce, deadline, dataHash);
    }

    function controlActionHashes()
        external
        pure
        returns (
            bytes32 pauseAction,
            bytes32 resumeAction,
            bytes32 terminateAction,
            bytes32 rotateSignerAction,
            bytes32 recoverUsdcAction,
            bytes32 recoverVctrAction
        )
    {
        return (
            ACTION_PAUSE,
            ACTION_RESUME,
            ACTION_TERMINATE,
            ACTION_ROTATE_SIGNER,
            ACTION_RECOVER_USDC,
            ACTION_RECOVER_VCTR
        );
    }

    function _usdcFor(uint256 vctrAmount) private pure returns (uint256) {
        if (vctrAmount == 0) revert InvalidAmount();
        if (vctrAmount % TOKEN_UNIT != 0) revert FractionalVctrNotSupported();
        if (vctrAmount < MIN_PURCHASE) revert PurchaseTooSmall();
        return (vctrAmount / TOKEN_UNIT) * PRICE_USDC_MICRO_PER_VCTR;
    }

    function _split(uint256 gross, SplitConfig memory config)
        private
        pure
        returns (uint256 tds, uint256 incomeTax, uint256 surcharge, uint256 cess, uint256 residual)
    {
        tds = gross * config.tdsBps / MAX_BPS;
        incomeTax = gross * config.incomeTaxBps / MAX_BPS;
        surcharge = incomeTax * config.surchargeBps / MAX_BPS;
        cess = (incomeTax + surcharge) * config.cessBps / MAX_BPS;
        residual = gross - tds - incomeTax - surcharge - cess;
    }

    function _validateSplit(uint16 tds, uint16 incomeTax, uint16 surchargeBps, uint16 cessBps) private pure {
        if (tds > MAX_BPS || incomeTax > MAX_BPS || surchargeBps > MAX_BPS || cessBps > MAX_BPS) {
            revert InvalidSplit();
        }
        uint256 surchargeRate = uint256(incomeTax) * surchargeBps / MAX_BPS;
        uint256 cessRate = (uint256(incomeTax) + surchargeRate) * cessBps / MAX_BPS;
        if (uint256(tds) + incomeTax + surchargeRate + cessRate > MAX_BPS) revert InvalidSplit();
    }

    function _validateWallets(address[5] memory wallets) private view {
        for (uint256 i; i < wallets.length; ++i) {
            if (wallets[i] == address(0) || wallets[i] == address(this)) revert InvalidWallets();
            for (uint256 j = i + 1; j < wallets.length; ++j) {
                if (wallets[i] == wallets[j]) revert InvalidWallets();
            }
        }
    }

    function _purchaseDigest(PurchaseAuthorization calldata authorization) private view returns (bytes32) {
        return _toTypedDataHash(
            keccak256(
                abi.encode(
                    PURCHASE_TYPEHASH,
                    authorization.buyer,
                    authorization.vctrAmount,
                    authorization.usdcAmount,
                    authorization.referenceId,
                    authorization.nonce,
                    authorization.deadline,
                    authorization.splitVersion
                )
            )
        );
    }

    function _controlDigest(bytes32 action, uint256 nonce, uint64 deadline, bytes32 dataHash)
        private
        view
        returns (bytes32)
    {
        return _toTypedDataHash(keccak256(abi.encode(CONTROL_TYPEHASH, action, nonce, deadline, dataHash)));
    }

    function _toTypedDataHash(bytes32 structHash) private view returns (bytes32) {
        bytes32 domainSeparator = keccak256(
            abi.encode(EIP712_DOMAIN_TYPEHASH, DOMAIN_NAME_HASH, DOMAIN_VERSION_HASH, block.chainid, address(this))
        );
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
    }

    function _consumeDualApproval(
        bytes32 action,
        bytes32 dataHash,
        uint64 deadline,
        bytes calldata sellerSignature,
        bytes calldata treasurySignature
    ) private {
        if (deadline < block.timestamp) revert InvalidDeadline();
        if (deadline > block.timestamp + MAX_ADMIN_SIGNATURE_LIFETIME) revert InvalidDeadline();
        bytes32 digest = _controlDigest(action, controlNonce, deadline, dataHash);
        (address recoveredSeller,,) = ECDSA.tryRecoverCalldata(digest, sellerSignature);
        (address recoveredTreasury,,) = ECDSA.tryRecoverCalldata(digest, treasurySignature);
        if (recoveredSeller != seller || recoveredTreasury != projectTreasurySigner) {
            revert InvalidControlSignatures();
        }
        ++controlNonce;
    }

    function _activateScheduledSplitIfDue() private {
        if (scheduledSplit.exists && block.timestamp >= scheduledSplit.effectiveAt) _activateScheduledSplit();
    }

    function _activateScheduledSplit() private {
        uint64 effectiveAt = scheduledSplit.effectiveAt;
        activeSplit = scheduledSplit.config;
        delete scheduledSplit;
        ++splitVersion;
        emit SplitActivated(splitVersion, effectiveAt);
    }

    function _pay(address destination, uint256 amount) private {
        if (amount != 0) usdc.safeTransfer(destination, amount);
    }
}
