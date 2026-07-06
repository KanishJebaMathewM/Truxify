// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title TruxifyEscrow
 * @dev Trustless payment escrow for Truxify freight bookings.
 *      Payment is locked on booking creation. Released to driver
 *      only after GPS geofence confirmation + OTP verification.
 *
 * Security:
 *  - ReentrancyGuard on all ETH-transferring functions
 *  - Checks-Effects-Interactions (CEI) pattern enforced
 *  - State updated BEFORE external .call{} to prevent re-entrancy
 *  - Pausable for emergency situations
 *  - Pull-based withdrawal with timeout for fund recovery
 *  - Emergency recovery: owner can recover locked funds for a booking
 *    that is stuck in Disputed state after a configurable grace period,
 *    preventing permanent loss of user funds.
 */
contract TruxifyEscrow is ReentrancyGuard, Ownable, Pausable {

    // ─── Enums ───────────────────────────────────────────────────────────────

    enum BookingStatus {
        Active,       // Payment locked, trip in progress
        Delivered,    // GPS + OTP confirmed, payment credited to driver
        Cancelled,    // Cancelled before driver started — full refund credited
        Disputed      // Under dispute resolution via n8n automation
    }

    // ─── Structs ─────────────────────────────────────────────────────────────

    struct Booking {
        address payable customer;   // Manufacturer who placed the booking
        address payable driver;     // Truck driver assigned to the booking
        uint256 amount;             // Locked payment amount in wei (MATIC)
        BookingStatus status;       // Current booking lifecycle status
        bool paid;                  // True after payment has been credited
        uint256 createdAt;          // Block timestamp at booking creation
    }

    // ─── State ───────────────────────────────────────────────────────────────

    mapping(uint256 => Booking) public bookings;
    uint256 public bookingCount;
    mapping(address => uint256) public pendingWithdrawals;
    mapping(address => uint256) public releaseTimestamps;
    uint256 public constant WITHDRAWAL_TIMEOUT = 30 days;

    /// @notice Grace period in seconds after which the owner can trigger
    ///         emergency recovery on a Disputed booking (default: 30 days).
    uint256 public emergencyGracePeriod = 30 days;

    // ─── Events ──────────────────────────────────────────────────────────────

    event BookingCreated(
        uint256 indexed bookingId,
        address indexed customer,
        address indexed driver,
        uint256 amount
    );

    event PaymentCredited(
        uint256 indexed bookingId,
        address indexed driver,
        uint256 amount
    );

    event RefundCredited(
        uint256 indexed bookingId,
        address indexed customer,
        uint256 refundAmount
    );

    event BookingCancelled(
        uint256 indexed bookingId,
        address indexed customer,
        uint256 refundAmount
    );

    event BookingDisputed(
        uint256 indexed bookingId,
        address indexed raisedBy
    );

    event WithdrawalReady(
        uint256 indexed bookingId,
        address indexed recipient,
        uint256 amount
    );

    event Withdrawal(
        address indexed recipient,
        uint256 amount
    );

    event EmergencyRecovery(
        uint256 indexed bookingId,
        address indexed recipient,
        uint256 amount
    );

    event Withdrawn(address indexed recipient, uint256 amount);

    event EmergencyRecovered(address indexed recipient, uint256 amount);

    event EmergencyGracePeriodUpdated(uint256 oldPeriod, uint256 newPeriod);

    // ─── Errors ──────────────────────────────────────────────────────────────

    error PaymentRequired();
    error InvalidDriverAddress();
    error BookingAlreadyExists();
    error BookingNotActive();
    error AlreadyPaid();
    error NothingToRelease();
    error NotAuthorised();
    error CannotCancel();
    error NothingToWithdraw();
    error WithdrawalFailed();
    error GracePeriodNotElapsed();
    error BookingNotDisputed();

    // ─── Constructor ─────────────────────────────────────────────────────────

    constructor() Ownable(msg.sender) {}

    // ─── External Functions ──────────────────────────────────────────────────

    /**
     * @dev Create a booking and lock payment in escrow.
     * @param bookingId Unique booking ID from the Node.js backend
     * @param driver    Truck driver's wallet address
     */
    function createBooking(
        uint256 bookingId,
        address payable driver
    ) external payable {
        if (msg.value == 0) revert PaymentRequired();
        if (driver == address(0)) revert InvalidDriverAddress();
        if (bookings[bookingId].customer != address(0)) revert BookingAlreadyExists();

        bookings[bookingId] = Booking({
            customer:  payable(msg.sender),
            driver:    driver,
            amount:    msg.value,
            status:    BookingStatus.Active,
            paid:      false,
            createdAt: block.timestamp
        });

        bookingCount++;

        emit BookingCreated(bookingId, msg.sender, driver, msg.value);
    }

    /**
     * @dev Credit payment to driver's pendingWithdrawals balance after GPS
     *      geofence + OTP confirmation. Called by the Truxify backend (owner).
     *
     * Security: nonReentrant + CEI pattern + pull-based withdrawal.
     *   State is zeroed BEFORE crediting pendingWithdrawals. Driver must
     *   call withdraw() to receive ETH — eliminates risk of re-entrancy via
     *   a malicious receiver fallback and permanent locking when driver
     *   contract has no receive function.
     *
     * @param bookingId The booking whose payment to release
     */
    function releasePayment(uint256 bookingId)
        external
        onlyOwner
        nonReentrant
        whenNotPaused
    {
        Booking storage booking = bookings[bookingId];

        if (booking.status != BookingStatus.Active) revert BookingNotActive();
        if (booking.paid) revert AlreadyPaid();
        if (booking.amount == 0) revert NothingToRelease();

        // ── EFFECTS ───────────────────────────────────────────────────────
        uint256 paymentAmount   = booking.amount;
        address payable driver  = booking.driver;

        booking.paid    = true;
        booking.amount  = 0;
        booking.status  = BookingStatus.Delivered;

        // ── INTERACTIONS: Add to pending withdrawal instead of direct transfer ──
        pendingWithdrawals[driver] += paymentAmount;
        releaseTimestamps[driver] = block.timestamp + WITHDRAWAL_TIMEOUT;

        emit PaymentCredited(bookingId, driver, paymentAmount);
        emit WithdrawalReady(bookingId, driver, paymentAmount);
    }

    /**
     * @dev Credit refund to customer's pendingWithdrawals balance when
     *      booking is cancelled before driver starts.
     *
     * @param bookingId The booking to cancel and refund
     */
    function cancelBooking(uint256 bookingId)
        external
        nonReentrant
        whenNotPaused
    {
        Booking storage booking = bookings[bookingId];

        if (
            booking.customer != msg.sender && owner() != msg.sender
        ) revert NotAuthorised();
        if (booking.status != BookingStatus.Active) revert CannotCancel();
        if (booking.paid) revert AlreadyPaid();

        // ── EFFECTS ───────────────────────────────────────────────────────
        uint256 refundAmount     = booking.amount;
        address payable customer = booking.customer;

        booking.amount  = 0;
        booking.paid    = true;
        booking.status  = BookingStatus.Cancelled;

        // Credit to pull-based mapping — no external call here
        pendingWithdrawals[customer] += refundAmount;
        releaseTimestamps[customer] = block.timestamp + WITHDRAWAL_TIMEOUT;

        emit RefundCredited(bookingId, customer, refundAmount);
        emit WithdrawalReady(bookingId, customer, refundAmount);
        emit BookingCancelled(bookingId, customer, refundAmount);
    }

    /**
     * @dev Pull-based withdrawal. Recipients call this to receive their
     *      credited ETH (from releasePayment or cancelBooking).
     *
     * Security: nonReentrant + CEI — balance zeroed before .call{}.
     */
    function withdraw() external nonReentrant whenNotPaused {
        uint256 amount = pendingWithdrawals[msg.sender];
        if (amount == 0) revert NothingToWithdraw();

        // ── EFFECTS ───────────────────────────────────────────────────────
        pendingWithdrawals[msg.sender] = 0;
        releaseTimestamps[msg.sender] = 0;

        // ── INTERACTIONS ──────────────────────────────────────────────────
        (bool success, ) = payable(msg.sender).call{value: amount}("");
        if (!success) {
            // Restore balance on failure so funds are not lost
            pendingWithdrawals[msg.sender] = amount;
            revert WithdrawalFailed();
        }

        emit Withdrawal(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    /**
     * @dev Flag a booking as disputed. Freezes payment until resolved.
     *      Resolution is handled by n8n automation pipeline.
     *
     * @param bookingId The booking to flag
     */
    function raiseDispute(uint256 bookingId) external {
        Booking storage booking = bookings[bookingId];

        if (
            msg.sender != booking.customer && msg.sender != booking.driver
        ) revert NotAuthorised();
        if (booking.status != BookingStatus.Active) revert BookingNotActive();

        booking.status = BookingStatus.Disputed;

        emit BookingDisputed(bookingId, msg.sender);
    }

    /**
     * @dev Emergency recovery: owner can reclaim funds from a Disputed
     *      booking that has exceeded emergencyGracePeriod. Funds are
     *      returned to the customer to prevent permanent locking.
     *
     * @param bookingId The stuck disputed booking
     */
    function emergencyRecover(uint256 bookingId)
        external
        onlyOwner
        nonReentrant
    {
        Booking storage booking = bookings[bookingId];

        if (booking.status != BookingStatus.Disputed) revert BookingNotDisputed();
        if (
            block.timestamp < booking.createdAt + emergencyGracePeriod
        ) revert GracePeriodNotElapsed();
        if (booking.amount == 0) revert NothingToRelease();

        // ── EFFECTS ───────────────────────────────────────────────────────
        uint256 recoveryAmount   = booking.amount;
        address payable customer = booking.customer;

        booking.amount  = 0;
        booking.paid    = true;

        // Credit to customer via pull pattern
        pendingWithdrawals[customer] += recoveryAmount;

        emit EmergencyRecovery(bookingId, customer, recoveryAmount);
    }

    /**
     * @dev Update the emergency grace period (owner only).
     * @param newPeriod New grace period in seconds
     */
    function setEmergencyGracePeriod(uint256 newPeriod) external onlyOwner {
        emit EmergencyGracePeriodUpdated(emergencyGracePeriod, newPeriod);
        emergencyGracePeriod = newPeriod;
    }

    /**
     * @dev View function to inspect any booking.
     */
    function getBooking(uint256 bookingId)
        external
        view
        returns (Booking memory)
    {
        return bookings[bookingId];
    }

    /**
    }

    /**
     * @dev Emergency recovery function for owner to recover funds after timeout.
     *      Can only be called after the withdrawal timeout period has passed.
     * @param recipient The address to receive the recovered funds
     * @param amount The amount to recover
     */
    function emergencyRecover(address recipient, uint256 amount) external onlyOwner nonReentrant {
        require(recipient != address(0), "Invalid recipient");
        require(block.timestamp > releaseTimestamps[recipient], "Withdrawal period active");
        require(pendingWithdrawals[recipient] >= amount, "Insufficient pending");

        pendingWithdrawals[recipient] -= amount;
        releaseTimestamps[recipient] = 0;

        (bool success, ) = recipient.call{value: amount}("");
        require(success, "Emergency transfer failed");

        emit EmergencyRecovered(recipient, amount);
    }

    /**
     * @dev Pause the contract to prevent all operations in emergency situations.
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @dev Unpause the contract after emergency situation is resolved.
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    receive() external payable {}
}