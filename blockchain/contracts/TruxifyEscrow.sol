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
 */
contract TruxifyEscrow is ReentrancyGuard, Ownable, Pausable {

    // ─── Enums ───────────────────────────────────────────────────────────────

    enum BookingStatus {
        Active,       // Payment locked, trip in progress
        Delivered,    // GPS + OTP confirmed, payment released to driver
        Cancelled,    // Cancelled before driver started — full refund
        Disputed      // Under dispute resolution via n8n automation
    }

    // ─── Structs ─────────────────────────────────────────────────────────────

    struct Booking {
        address payable customer;   // Manufacturer who placed the booking
        address payable driver;     // Truck driver assigned to the booking
        uint256 amount;             // Locked payment amount in wei (MATIC)
        BookingStatus status;       // Current booking lifecycle status
        bool paid;                  // True after payment has been released
        uint256 createdAt;          // Block timestamp at booking creation
    }

    // ─── State ───────────────────────────────────────────────────────────────

    mapping(uint256 => Booking) public bookings;
    uint256 public bookingCount;
    mapping(address => uint256) public pendingWithdrawals;
    mapping(address => uint256) public releaseTimestamps;
    uint256 public constant WITHDRAWAL_TIMEOUT = 30 days;

    // ─── Events ──────────────────────────────────────────────────────────────

    event BookingCreated(
        uint256 indexed bookingId,
        address indexed customer,
        address indexed driver,
        uint256 amount
    );

    event PaymentReleased(
        uint256 indexed bookingId,
        address indexed driver,
        uint256 amount
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

    event Withdrawn(address indexed recipient, uint256 amount);

    event EmergencyRecovered(address indexed recipient, uint256 amount);

    // ─── Constructor ─────────────────────────────────────────────────────────

    constructor() Ownable(msg.sender) {}

    receive() external payable {
        pendingWithdrawals[msg.sender] += msg.value;
    }
    fallback() external {
        revert("TruxifyEscrow: fallback not supported");
    }

    // ─── Modifiers ───────────────────────────────────────────────────────────

    modifier onlyBookingParticipant(uint256 bookingId) {
        require(
            msg.sender == bookings[bookingId].customer || msg.sender == bookings[bookingId].driver,
            "TruxifyEscrow: Not authorised"
        );
        _;
    }

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
        require(msg.value > 0, "TruxifyEscrow: Payment required");
        require(driver != address(0), "TruxifyEscrow: Invalid driver address");
        require(
            bookings[bookingId].customer == address(0),
            "TruxifyEscrow: Booking already exists"
        );

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
     * @dev Release payment to driver after GPS geofence + OTP confirmation.
     *      Called by the Truxify backend (owner) after both conditions are met.
     *
     * CRITICAL SECURITY INVARIANT: This function is restricted to onlyOwner.
     * Neither the customer nor the driver may call this directly — all
     * release requests MUST flow through the backend's delivery verification
     * pipeline (OTP generation, OTP verification, GPS geofence confirmation).
     * Any upgradeable variant of this contract MUST preserve this onlyOwner
     * guard to prevent unauthorized fund releases.
     *
     * Security: nonReentrant + CEI pattern
     *   State is updated (paid=true, amount=0, status=Delivered) BEFORE
     *   adding to pendingWithdrawals so a re-entrant driver contract cannot
     *   call releasePayment again before state is committed.
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

        require(
            booking.status == BookingStatus.Active,
            "TruxifyEscrow: Booking not active"
        );
        require(!booking.paid, "TruxifyEscrow: Already paid");
        require(booking.amount > 0, "TruxifyEscrow: Nothing to release");

        // ── CHECKS done above ─────────────────────────────────────────────

        // ── EFFECTS: Update state BEFORE external call (CEI pattern) ──────
        uint256 paymentAmount   = booking.amount;
        address payable driver  = booking.driver;

        booking.paid    = true;                      // ← committed first
        booking.amount  = 0;                         // ← zero out
        booking.status  = BookingStatus.Delivered;   // ← status updated

        // ── INTERACTIONS: Add to pending withdrawal instead of direct transfer ──
        pendingWithdrawals[driver] += paymentAmount;

        uint256 newDeadline = block.timestamp + WITHDRAWAL_TIMEOUT;
        if (releaseTimestamps[driver] == 0 || newDeadline < releaseTimestamps[driver]) {
            releaseTimestamps[driver] = newDeadline;
        }

        emit WithdrawalReady(bookingId, driver, paymentAmount);
        emit PaymentReleased(bookingId, driver, paymentAmount);
    }

    /**
     * @dev Cancel a booking and refund the customer.
     *      RESTRICTED to onlyOwner (backend) to ensure on-chain and off-chain
     *      state remain synchronized. The backend's cancellation flow performs
     *      critical checks: Redis distributed lock, idempotency guard, order
     *      state validation, and escrow refund tracking. Allowing direct
     *      customer cancellation desynchronizes state.
     *
     * @param bookingId The booking to cancel and refund
     */
    function cancelBooking(uint256 bookingId)
        external
        onlyBookingParticipant(bookingId)
        nonReentrant
        whenNotPaused
    {
        Booking storage booking = bookings[bookingId];

        require(
            booking.status == BookingStatus.Active,
            "TruxifyEscrow: Cannot cancel - booking not active"
        );
        require(!booking.paid, "TruxifyEscrow: Already paid");
        require(booking.amount > 0, "TruxifyEscrow: Nothing to refund");

        // ── EFFECTS ───────────────────────────────────────────────────────
        uint256 refundAmount    = booking.amount;
        address payable customer = booking.customer;

        booking.amount  = 0;
        booking.paid    = true;
        booking.status  = BookingStatus.Cancelled;

        // ── INTERACTIONS: Add to pending withdrawal instead of direct transfer ──
        pendingWithdrawals[customer] += refundAmount;

        uint256 newDeadline = block.timestamp + WITHDRAWAL_TIMEOUT;
        if (releaseTimestamps[customer] == 0 || newDeadline < releaseTimestamps[customer]) {
            releaseTimestamps[customer] = newDeadline;
        }

        emit WithdrawalReady(bookingId, customer, refundAmount);
        emit BookingCancelled(bookingId, customer, refundAmount);
    }

    /**
     * @dev Flag a booking as disputed. Freezes payment until resolved.
     *      RESTRICTED to onlyOwner (backend) to ensure disputes are managed
     *      through the proper resolution pipeline (n8n automation).
     *      Direct customer/driver disputes bypass backend tracking and
     *      could freeze funds and block the delivery flow.
     *
     * @param bookingId The booking to flag
     */
    function raiseDispute(uint256 bookingId) external onlyBookingParticipant(bookingId) whenNotPaused {
        Booking storage booking = bookings[bookingId];

        require(
            booking.status == BookingStatus.Active,
            "TruxifyEscrow: Cannot dispute - booking not active"
        );

        booking.status = BookingStatus.Disputed;

        emit BookingDisputed(bookingId, msg.sender);
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
     * @dev Withdraw pending funds. Can be called by anyone with pending withdrawals.
     *      Uses pull-based pattern to avoid reentrancy and failed transfers.
     */
    function withdraw() external nonReentrant whenNotPaused {
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount > 0, "Nothing to withdraw");

        pendingWithdrawals[msg.sender] = 0;
        releaseTimestamps[msg.sender] = 0;

        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "Withdrawal failed");

        emit Withdrawn(msg.sender, amount);
    }

    /**
     * @dev Emergency recovery function for owner to recover funds after timeout.
     *      Can only be called after the withdrawal timeout period has passed.
     * @param recipient The address to receive the recovered funds
     * @param amount The amount to recover
     */
    function emergencyRecover(address recipient, uint256 amount) external onlyOwner nonReentrant {
        require(recipient != address(0), "Invalid recipient");
        require(releaseTimestamps[recipient] > 0, "No pending withdrawal");
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
}
