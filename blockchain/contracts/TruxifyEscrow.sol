// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

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
 */
contract TruxifyEscrow is ReentrancyGuard, Ownable {

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
     * Security: nonReentrant + CEI pattern
     *   State is updated (paid=true, amount=0, status=Delivered) BEFORE
     *   the external .call{} so a re-entrant driver contract cannot
     *   call releasePayment again before state is committed.
     *
     * @param bookingId The booking whose payment to release
     */
    function releasePayment(uint256 bookingId)
        external
        onlyOwner
        nonReentrant              // ← OpenZeppelin mutex
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

        // ── INTERACTIONS: External call AFTER state is committed ──────────
        (bool success, ) = driver.call{value: paymentAmount}("");
        require(success, "TruxifyEscrow: Transfer failed");

        emit PaymentReleased(bookingId, driver, paymentAmount);
    }

    /**
     * @dev Refund customer when booking is cancelled before driver starts.
     *      Also secured with nonReentrant + CEI.
     *
     * @param bookingId The booking to cancel and refund
     */
    function cancelBooking(uint256 bookingId)
        external
        nonReentrant
    {
        Booking storage booking = bookings[bookingId];

        require(
            booking.customer == msg.sender || owner() == msg.sender,
            "TruxifyEscrow: Not authorised"
        );
        require(
            booking.status == BookingStatus.Active,
            "TruxifyEscrow: Cannot cancel - booking not active"
        );
        require(!booking.paid, "TruxifyEscrow: Already paid");

        // ── EFFECTS ───────────────────────────────────────────────────────
        uint256 refundAmount    = booking.amount;
        address payable customer = booking.customer;

        booking.amount  = 0;
        booking.paid    = true;
        booking.status  = BookingStatus.Cancelled;

        // ── INTERACTIONS ──────────────────────────────────────────────────
        (bool success, ) = customer.call{value: refundAmount}("");
        require(success, "TruxifyEscrow: Refund failed");

        emit BookingCancelled(bookingId, customer, refundAmount);
    }

    /**
     * @dev Flag a booking as disputed. Freezes payment until resolved.
     *      Resolution is handled by n8n automation pipeline.
     *
     * @param bookingId The booking to flag
     */
    function raiseDispute(uint256 bookingId) external {
        Booking storage booking = bookings[bookingId];

        require(
            msg.sender == booking.customer || msg.sender == booking.driver,
            "TruxifyEscrow: Not a party to this booking"
        );
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
}