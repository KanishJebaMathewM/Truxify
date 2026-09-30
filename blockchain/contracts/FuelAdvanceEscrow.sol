// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title FuelAdvanceEscrow
 * @dev Escrow-Backed Fuel & Working Capital Micro-Advance System on Polygon.
 *      Enables drivers to receive an instant 30-40% advance upon verified pickup
 *      (OTP + geofence confirmation), while atomically deducting the advance
 *      from the final freight escrow balance upon destination delivery.
 *
 * Security:
 *  - Checks-Effects-Interactions (CEI) pattern.
 *  - ReentrancyGuard on all value transfers.
 *  - Pull-over-push withdrawal fallback.
 *  - Capped advance ceiling (max 40%).
 */
contract FuelAdvanceEscrow is ReentrancyGuard, Ownable, Pausable {

    // ─── Enums & Structs ─────────────────────────────────────────────────────

    enum AdvanceStatus {
        None,
        Requested,
        Approved,
        Disbursed,
        Settled,
        Defaulted
    }

    struct AdvanceBooking {
        address payable customer;
        address payable driver;
        uint256 totalAmount;
        uint256 advanceAmount;
        uint16 maxAdvanceBasisPoints; // e.g., 4000 = 40%
        AdvanceStatus advanceStatus;
        bool pickupConfirmed;
        bool deliveryConfirmed;
        uint256 createdAt;
        uint256 advanceDisbursedAt;
        uint256 settledAt;
    }

    // ─── State ───────────────────────────────────────────────────────────────

    mapping(bytes32 => AdvanceBooking) public bookings;
    mapping(address => uint256) public pendingWithdrawals;
    address public advanceOracle;

    // ─── Events ──────────────────────────────────────────────────────────────

    event AdvanceEscrowCreated(
        bytes32 indexed bookingId,
        address indexed customer,
        address indexed driver,
        uint256 totalAmount,
        uint16 maxAdvanceBasisPoints
    );

    event AdvanceDisbursed(
        bytes32 indexed bookingId,
        address indexed driver,
        uint256 advanceAmount,
        bytes32 pickupProofDigest
    );

    event FinalEscrowSettled(
        bytes32 indexed bookingId,
        address indexed driver,
        uint256 remainingPayout,
        uint256 totalDisbursed
    );

    event CustomerRefunded(bytes32 indexed bookingId, address indexed customer, uint256 refundAmount);
    event AdvanceOracleUpdated(address indexed previousOracle, address indexed newOracle);
    event WithdrawalClaimed(address indexed payee, uint256 amount);

    // ─── Modifiers ───────────────────────────────────────────────────────────

    modifier onlyOracleOrOwner() {
        require(
            msg.sender == advanceOracle || msg.sender == owner(),
            "FuelAdvanceEscrow: caller is not advance oracle or owner"
        );
        _;
    }

    // ─── Constructor ─────────────────────────────────────────────────────────

    constructor(address _advanceOracle) Ownable(msg.sender) {
        require(_advanceOracle != address(0), "FuelAdvanceEscrow: invalid oracle address");
        advanceOracle = _advanceOracle;
    }

    // ─── External Functions ──────────────────────────────────────────────────

    /**
     * @notice Locks full 100% customer freight payment and configures maximum advance allowance.
     */
    function createAdvanceBooking(
        bytes32 bookingId,
        address payable driver,
        uint16 maxAdvanceBasisPoints
    ) external payable whenNotPaused nonReentrant {
        require(bookingId != bytes32(0), "FuelAdvanceEscrow: invalid booking ID");
        require(bookings[bookingId].createdAt == 0, "FuelAdvanceEscrow: booking already exists");
        require(driver != address(0), "FuelAdvanceEscrow: invalid driver address");
        require(msg.value > 0, "FuelAdvanceEscrow: deposit value must be > 0");
        require(maxAdvanceBasisPoints <= 4000, "FuelAdvanceEscrow: advance cannot exceed 40%");

        bookings[bookingId] = AdvanceBooking({
            customer: payable(msg.sender),
            driver: driver,
            totalAmount: msg.value,
            advanceAmount: 0,
            maxAdvanceBasisPoints: maxAdvanceBasisPoints,
            advanceStatus: AdvanceStatus.Approved,
            pickupConfirmed: false,
            deliveryConfirmed: false,
            createdAt: block.timestamp,
            advanceDisbursedAt: 0,
            settledAt: 0
        });

        emit AdvanceEscrowCreated(bookingId, msg.sender, driver, msg.value, maxAdvanceBasisPoints);
    }

    /**
     * @notice Disburses fuel/working capital advance to driver upon verified cargo pickup.
     */
    function disbursePickupAdvance(
        bytes32 bookingId,
        uint256 requestedAdvanceWei,
        bytes32 pickupProofDigest
    ) external whenNotPaused onlyOracleOrOwner nonReentrant {
        AdvanceBooking storage booking = bookings[bookingId];
        require(booking.createdAt > 0, "FuelAdvanceEscrow: booking not found");
        require(!booking.pickupConfirmed, "FuelAdvanceEscrow: pickup already confirmed");
        require(booking.advanceStatus == AdvanceStatus.Approved, "FuelAdvanceEscrow: advance not approved");

        uint256 maxAllowedAdvance = (booking.totalAmount * booking.maxAdvanceBasisPoints) / 10000;
        require(requestedAdvanceWei <= maxAllowedAdvance, "FuelAdvanceEscrow: requested amount exceeds max limit");

        booking.pickupConfirmed = true;
        booking.advanceAmount = requestedAdvanceWei;
        booking.advanceStatus = AdvanceStatus.Disbursed;
        booking.advanceDisbursedAt = block.timestamp;

        address payable driver = booking.driver;
        emit AdvanceDisbursed(bookingId, driver, requestedAdvanceWei, pickupProofDigest);

        (bool success, ) = driver.call{value: requestedAdvanceWei}("");
        if (!success) {
            pendingWithdrawals[driver] += requestedAdvanceWei;
        }
    }

    /**
     * @notice Releases final remaining escrow balance to driver upon verified delivery.
     */
    function settleFinalEscrow(
        bytes32 bookingId
    ) external whenNotPaused onlyOracleOrOwner nonReentrant {
        AdvanceBooking storage booking = bookings[bookingId];
        require(booking.createdAt > 0, "FuelAdvanceEscrow: booking not found");
        require(booking.pickupConfirmed, "FuelAdvanceEscrow: pickup not confirmed");
        require(!booking.deliveryConfirmed, "FuelAdvanceEscrow: already delivered");

        booking.deliveryConfirmed = true;
        booking.advanceStatus = AdvanceStatus.Settled;
        booking.settledAt = block.timestamp;

        uint256 remainingPayout = booking.totalAmount - booking.advanceAmount;
        address payable driver = booking.driver;

        emit FinalEscrowSettled(bookingId, driver, remainingPayout, booking.totalAmount);

        if (remainingPayout > 0) {
            (bool success, ) = driver.call{value: remainingPayout}("");
            if (!success) {
                pendingWithdrawals[driver] += remainingPayout;
            }
        }
    }

    /**
     * @notice Refunds customer on pre-pickup cancellation.
     */
    function refundCustomerOnCancellation(
        bytes32 bookingId
    ) external whenNotPaused onlyOracleOrOwner nonReentrant {
        AdvanceBooking storage booking = bookings[bookingId];
        require(booking.createdAt > 0, "FuelAdvanceEscrow: booking not found");
        require(!booking.pickupConfirmed, "FuelAdvanceEscrow: cannot cancel after pickup");

        uint256 refund = booking.totalAmount;
        booking.totalAmount = 0;
        booking.advanceStatus = AdvanceStatus.Defaulted;

        address payable customer = booking.customer;
        emit CustomerRefunded(bookingId, customer, refund);

        (bool success, ) = customer.call{value: refund}("");
        if (!success) {
            pendingWithdrawals[customer] += refund;
        }
    }

    /**
     * @notice Pull-based withdrawal for queued payments.
     */
    function claimPendingWithdrawal() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount > 0, "FuelAdvanceEscrow: no pending withdrawal");

        pendingWithdrawals[msg.sender] = 0;
        emit WithdrawalClaimed(msg.sender, amount);

        (bool success, ) = payable(msg.sender).call{value: amount}("");
        require(success, "FuelAdvanceEscrow: transfer failed");
    }

    /**
     * @notice Updates advance oracle address.
     */
    function setAdvanceOracle(address _newOracle) external onlyOwner {
        require(_newOracle != address(0), "FuelAdvanceEscrow: invalid address");
        emit AdvanceOracleUpdated(advanceOracle, _newOracle);
        advanceOracle = _newOracle;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
