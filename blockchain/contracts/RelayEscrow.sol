// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title RelayEscrow
 * @dev Multi-milestone staged escrow contract for multi-leg relay freight bookings.
 *      Enables high-distance freight routes to be partitioned into corridor legs.
 *      Full booking payment is escrowed upfront by the customer. Fractional payouts
 *      are released to individual corridor drivers sequentially upon verified hub hand-offs.
 *
 * Security:
 *  - Checks-Effects-Interactions (CEI) pattern enforced.
 *  - ReentrancyGuard on all value transfers.
 *  - Pull-over-push withdrawal mechanism with direct fallback.
 *  - Pausable by contract owner for emergency defense.
 */
contract RelayEscrow is ReentrancyGuard, Ownable, Pausable {

    // ─── Structs & Enums ─────────────────────────────────────────────────────

    enum LegStatus {
        Pending,
        InTransit,
        AtHub,
        Completed,
        Cancelled
    }

    struct RelayLeg {
        address payable driver;
        uint256 amount;
        bytes32 hubWaypointHash;
        LegStatus status;
        bool paid;
        uint256 completedAt;
    }

    struct RelayBooking {
        address payable customer;
        uint256 totalAmount;
        uint256 currentLegIndex;
        uint256 totalLegs;
        bool active;
        bool fullyCompleted;
        bool cancelled;
        uint256 createdAt;
    }

    // ─── State ───────────────────────────────────────────────────────────────

    mapping(bytes32 => RelayBooking) public relayBookings;
    mapping(bytes32 => mapping(uint256 => RelayLeg)) public relayLegs;
    mapping(address => uint256) public pendingWithdrawals;
    
    address public trustedRelayer;

    // ─── Events ──────────────────────────────────────────────────────────────

    event RelayBookingCreated(
        bytes32 indexed relayBookingId,
        address indexed customer,
        uint256 totalAmount,
        uint256 totalLegs
    );

    event LegStarted(
        bytes32 indexed relayBookingId,
        uint256 indexed legIndex,
        address indexed driver
    );

    event LegCompleted(
        bytes32 indexed relayBookingId,
        uint256 indexed legIndex,
        address indexed driver,
        uint256 amountReleased,
        bytes32 handoffDigest
    );

    event RelayBookingCompleted(
        bytes32 indexed relayBookingId,
        uint256 totalAmountPaid
    );

    event RelayBookingCancelled(
        bytes32 indexed relayBookingId,
        uint256 refundAmount,
        uint256 cancelledFromLeg
    );

    event TrustedRelayerUpdated(address indexed previousRelayer, address indexed newRelayer);
    event WithdrawalClaimed(address indexed payee, uint256 amount);

    // ─── Modifiers ───────────────────────────────────────────────────────────

    modifier onlyRelayerOrOwner() {
        require(
            msg.sender == trustedRelayer || msg.sender == owner(),
            "RelayEscrow: caller is not trusted relayer or owner"
        );
        _;
    }

    // ─── Constructor ─────────────────────────────────────────────────────────

    constructor(address _trustedRelayer) Ownable(msg.sender) {
        require(_trustedRelayer != address(0), "RelayEscrow: invalid relayer address");
        trustedRelayer = _trustedRelayer;
    }

    // ─── External / Public Functions ─────────────────────────────────────────

    /**
     * @notice Creates a new multi-leg relay booking with upfront full escrow funding.
     * @param relayBookingId Unique identifier for the relay trip.
     * @param drivers Array of driver wallet addresses for each sequential leg.
     * @param legAmounts Array of payment amounts in wei for each leg.
     * @param hubHashes Array of waypoint geohashes corresponding to corridor transshipment hubs.
     */
    function createRelayBooking(
        bytes32 relayBookingId,
        address payable[] calldata drivers,
        uint256[] calldata legAmounts,
        bytes32[] calldata hubHashes
    ) external payable whenNotPaused nonReentrant {
        require(relayBookingId != bytes32(0), "RelayEscrow: invalid booking ID");
        require(relayBookings[relayBookingId].createdAt == 0, "RelayEscrow: booking already exists");
        require(drivers.length > 1, "RelayEscrow: relay booking requires at least 2 legs");
        require(
            drivers.length == legAmounts.length && legAmounts.length == hubHashes.length,
            "RelayEscrow: parameter length mismatch"
        );

        uint256 calculatedTotal = 0;
        for (uint256 i = 0; i < legAmounts.length; i++) {
            require(drivers[i] != address(0), "RelayEscrow: invalid driver address");
            require(legAmounts[i] > 0, "RelayEscrow: leg amount must be greater than zero");
            calculatedTotal += legAmounts[i];
        }

        require(msg.value == calculatedTotal, "RelayEscrow: sent value does not match total leg amounts");

        relayBookings[relayBookingId] = RelayBooking({
            customer: payable(msg.sender),
            totalAmount: msg.value,
            currentLegIndex: 0,
            totalLegs: drivers.length,
            active: true,
            fullyCompleted: false,
            cancelled: false,
            createdAt: block.timestamp
        });

        for (uint256 i = 0; i < drivers.length; i++) {
            relayLegs[relayBookingId][i] = RelayLeg({
                driver: drivers[i],
                amount: legAmounts[i],
                hubWaypointHash: hubHashes[i],
                status: (i == 0) ? LegStatus.InTransit : LegStatus.Pending,
                paid: false,
                completedAt: 0
            });
        }

        emit RelayBookingCreated(relayBookingId, msg.sender, msg.value, drivers.length);
        emit LegStarted(relayBookingId, 0, drivers[0]);
    }

    /**
     * @notice Releases payment for a completed leg upon verified cryptographic hand-off.
     * @param relayBookingId The relay booking identifier.
     * @param legIndex The leg index being finalized.
     * @param handoffDigest Cryptographic hash/digest representing the mutual hand-off verification.
     */
    function releaseLegPayment(
        bytes32 relayBookingId,
        uint256 legIndex,
        bytes32 handoffDigest
    ) external whenNotPaused onlyRelayerOrOwner nonReentrant {
        RelayBooking storage booking = relayBookings[relayBookingId];
        require(booking.active, "RelayEscrow: booking not active");
        require(!booking.cancelled, "RelayEscrow: booking is cancelled");
        require(legIndex == booking.currentLegIndex, "RelayEscrow: invalid leg index progression");
        require(legIndex < booking.totalLegs, "RelayEscrow: all legs already finalized");

        RelayLeg storage leg = relayLegs[relayBookingId][legIndex];
        require(!leg.paid, "RelayEscrow: leg already paid");

        leg.status = LegStatus.Completed;
        leg.paid = true;
        leg.completedAt = block.timestamp;

        uint256 payout = leg.amount;
        address payable driverAddress = leg.driver;

        emit LegCompleted(relayBookingId, legIndex, driverAddress, payout, handoffDigest);

        booking.currentLegIndex = legIndex + 1;

        if (booking.currentLegIndex == booking.totalLegs) {
            booking.active = false;
            booking.fullyCompleted = true;
            emit RelayBookingCompleted(relayBookingId, booking.totalAmount);
        } else {
            // Activate the next leg
            RelayLeg storage nextLeg = relayLegs[relayBookingId][booking.currentLegIndex];
            nextLeg.status = LegStatus.InTransit;
            emit LegStarted(relayBookingId, booking.currentLegIndex, nextLeg.driver);
        }

        // Direct transfer with pull-withdrawal safety fallback
        (bool success, ) = driverAddress.call{value: payout}("");
        if (!success) {
            pendingWithdrawals[driverAddress] += payout;
        }
    }

    /**
     * @notice Cancels remaining unstarted legs and refunds remaining funds to customer.
     * @param relayBookingId The relay booking identifier.
     */
    function cancelAndRefundRemaining(
        bytes32 relayBookingId
    ) external whenNotPaused onlyRelayerOrOwner nonReentrant {
        RelayBooking storage booking = relayBookings[relayBookingId];
        require(booking.active, "RelayEscrow: booking not active");
        require(!booking.fullyCompleted, "RelayEscrow: booking already completed");
        require(!booking.cancelled, "RelayEscrow: booking already cancelled");

        booking.active = false;
        booking.cancelled = true;

        uint256 refundAmount = 0;
        uint256 startCancelIndex = booking.currentLegIndex;

        for (uint256 i = startCancelIndex; i < booking.totalLegs; i++) {
            RelayLeg storage leg = relayLegs[relayBookingId][i];
            if (!leg.paid) {
                leg.status = LegStatus.Cancelled;
                refundAmount += leg.amount;
            }
        }

        address payable customer = booking.customer;
        emit RelayBookingCancelled(relayBookingId, refundAmount, startCancelIndex);

        if (refundAmount > 0) {
            (bool success, ) = customer.call{value: refundAmount}("");
            if (!success) {
                pendingWithdrawals[customer] += refundAmount;
            }
        }
    }

    /**
     * @notice Pull-based withdrawal for any funds queued in pending withdrawals.
     */
    function claimPendingWithdrawal() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount > 0, "RelayEscrow: no pending withdrawal");

        pendingWithdrawals[msg.sender] = 0;
        emit WithdrawalClaimed(msg.sender, amount);

        (bool success, ) = payable(msg.sender).call{value: amount}("");
        require(success, "RelayEscrow: withdrawal transfer failed");
    }

    /**
     * @notice Updates the trusted relayer backend address.
     */
    function setTrustedRelayer(address _newRelayer) external onlyOwner {
        require(_newRelayer != address(0), "RelayEscrow: invalid address");
        emit TrustedRelayerUpdated(trustedRelayer, _newRelayer);
        trustedRelayer = _newRelayer;
    }

    /**
     * @notice Emergency circuit breaker pause.
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Unpause contract execution.
     */
    function unpause() external onlyOwner {
        _unpause();
    }
}
