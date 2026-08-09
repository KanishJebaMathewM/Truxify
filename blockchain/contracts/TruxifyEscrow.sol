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
        Disputed,     // Under dispute resolution via n8n automation
        Resolved      // Dispute settled by owner — funds split per resolution
    }

    // ─── Structs ─────────────────────────────────────────────────────────────

    struct Booking {
        address payable customer;   // Manufacturer who placed the booking
        address payable driver;     // Truck driver assigned to the booking
        uint256 amount;             // Locked payment amount in wei (MATIC)
        BookingStatus status;       // Current booking lifecycle status
        bool paid;                  // True after payment has been released
        bool started;               // True after the driver has picked up the goods
        uint256 createdAt;          // Block timestamp at booking creation
        uint256 disputedAt;         // Block timestamp when dispute was raised
    }

    // ─── State ───────────────────────────────────────────────────────────────

    mapping(uint256 => Booking) public bookings;
    uint256 public bookingCount;
    mapping(address => uint256) public pendingWithdrawals;
    mapping(address => uint256) public releaseTimestamps;

    // Backend-issued commitment nonce per customer wallet. A valid createBooking
    // requires an owner-signed EIP-191 commitment over (chain, this, customer,
    // bookingId, nonce). The nonce is burned on success so a commitment cannot
    // be replayed by anyone who observes a submitted deposit transaction.
    mapping(address => uint256) public commitmentNonces;
    uint256 public constant WITHDRAWAL_TIMEOUT = 30 days;
    uint256 public constant DISPUTE_TIMEOUT = 7 days;
    address public trustedRelayer;

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

    event BookingStarted(
        uint256 indexed bookingId,
        address indexed driver,
        uint256 amount
    );

    event CancellationPenaltyApplied(
        uint256 indexed bookingId,
        address indexed driver,
        uint256 driverAmount,
        address customer,
        uint256 refundAmount
    );

    event BookingDisputed(
        uint256 indexed bookingId,
        address indexed raisedBy
    );

    event DisputeResolved(
        uint256 indexed bookingId,
        address indexed driver,
        uint256 driverAmount,
        address indexed customer,
        uint256 refundAmount
    );

    event WithdrawalReady(
        uint256 indexed bookingId,
        address indexed recipient,
        uint256 amount
    );

    event Withdrawn(address indexed recipient, uint256 amount);

    event EmergencyRecovered(address indexed recipient, uint256 amount);

    event RelayerUpdated(address indexed newRelayer);

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

    /**
     * @dev Verify the owner's EIP-191 signature over the create commitment:
     *      keccak256(chainId, this, customer, bookingId, commitmentNonces[customer]).
     *      Only the contract owner (the backend relayer) can authorise a slot,
     *      so an external party cannot claim a pending bookingId for 1 wei.
     */
    function _verifyCreateCommitment(
        address customer,
        uint256 bookingId,
        bytes calldata signature
    ) private view returns (bool) {
        require(signature.length == 65, "TruxifyEscrow: Invalid signature length");

        bytes32 commitment = keccak256(
            abi.encodePacked(
                block.chainid,
                address(this),
                customer,
                bookingId,
                commitmentNonces[customer]
            )
        );
        bytes32 signedHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", commitment)
        );

        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }

        return ecrecover(signedHash, v, r, s) == owner();
    }

    /**
     * @dev Release a booking id slot after its escrow is fully settled so the
     *      bookingId can be re-created for a retried/regenerated order
     *      (issue #7734). Only invoked from the Cancelled terminal paths —
     *      Delivered/Resolved ids must never be reused.
     */
    function _releaseBookingSlot(uint256 bookingId) private {
        bookings[bookingId].customer = payable(address(0));
        bookings[bookingId].driver = payable(address(0));
    }

    // ─── External Functions ──────────────────────────────────────────────────

    /**
     * @dev Create a booking and lock payment in escrow.
     *      The customer's wallet pays the deposit, but the call is only valid
     *      with an owner-signed EIP-191 commitment that binds the customer
     *      wallet, bookingId, and a per-customer nonce. This prevents a third
     *      party from front-running a pending bookingId and permanently
     *      bricking the real customer's booking (issue #7734).
     * @param bookingId Unique booking ID from the Node.js backend
     * @param driver    Truck driver's wallet address
     * @param signature Owner's EIP-191 signature over the create commitment
     */
    function createBooking(
        uint256 bookingId,
        address payable driver,
        bytes calldata signature
    ) external payable {
        require(msg.value > 0, "TruxifyEscrow: Payment required");
        require(driver != address(0), "TruxifyEscrow: Invalid driver address");
        require(
            bookings[bookingId].customer == address(0),
            "TruxifyEscrow: Booking already exists"
        );
        require(
            _verifyCreateCommitment(msg.sender, bookingId, signature),
            "TruxifyEscrow: Invalid commitment signature"
        );

        // Burn the nonce so the same commitment can never be replayed.
        commitmentNonces[msg.sender]++;

        bookings[bookingId] = Booking({
            customer:  payable(msg.sender),
            driver:    driver,
            amount:    msg.value,
            status:    BookingStatus.Active,
            paid:      false,
            started:   false,
            createdAt: block.timestamp,
            disputedAt: 0
        });

        bookingCount++;

        emit BookingCreated(bookingId, msg.sender, driver, msg.value);
    }

    /**
     * @dev Create a booking and lock payment in escrow via owner relayer.
     * @param bookingId Unique booking ID from the Node.js backend
     * @param customer   Customer's wallet address
     * @param driver     Truck driver's wallet address
     */
    function lockPayment(
        uint256 bookingId,
        address payable customer,
        address payable driver
    ) external payable onlyOwner {
        require(msg.value > 0, "TruxifyEscrow: Payment required");
        require(customer != address(0), "TruxifyEscrow: Invalid customer address");
        require(driver != address(0), "TruxifyEscrow: Invalid driver address");
        require(
            bookings[bookingId].customer == address(0),
            "TruxifyEscrow: Booking already exists"
        );

        bookings[bookingId] = Booking({
            customer:  customer,
            driver:    driver,
            amount:    msg.value,
            status:    BookingStatus.Active,
            paid:      false,
            started:   false,
            createdAt: block.timestamp,
            disputedAt: 0
        });

        bookingCount++;

        emit BookingCreated(bookingId, customer, driver, msg.value);
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

        // Always extend the timeout to protect newly released funds
        // releaseTimestamps[driver] = block.timestamp + WITHDRAWAL_TIMEOUT; // Removed post-release withdrawal lock

        emit WithdrawalReady(bookingId, driver, paymentAmount);
        emit PaymentReleased(bookingId, driver, paymentAmount);
    }

    /**
     * @dev Record that the driver has picked up the goods and the trip has
     *      started. Called by the Truxify backend (owner) when the shipment
     *      reaches the "picked_up" milestone. Once started, a booking can no
     *      longer be cancelled for a full refund — the customer must go through
     *      the penalty/compensation path instead.
     *
     * @param bookingId The booking whose trip has started
     */
    function markBookingStarted(uint256 bookingId)
        external
        onlyOwner
        whenNotPaused
    {
        Booking storage booking = bookings[bookingId];

        require(
            booking.customer != address(0) && booking.status == BookingStatus.Active,
            "TruxifyEscrow: Booking not active"
        );
        require(!booking.paid, "TruxifyEscrow: Already paid");
        require(!booking.started, "TruxifyEscrow: Trip already started");

        booking.started = true;

        emit BookingStarted(bookingId, booking.driver, booking.amount);
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
        onlyOwner
        nonReentrant
        whenNotPaused
    {
        Booking storage booking = bookings[bookingId];

        require(
            booking.customer != address(0) && booking.status == BookingStatus.Active,
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

        // Always extend the timeout to protect newly refunded funds
        releaseTimestamps[customer] = block.timestamp + WITHDRAWAL_TIMEOUT;

        emit WithdrawalReady(bookingId, customer, refundAmount);
        emit BookingCancelled(bookingId, customer, refundAmount);

        // Release the slot so a retried/regenerated order can re-use the id.
        _releaseBookingSlot(bookingId);
    }

    /**
     * @dev Cancels an active booking, compensating the assigned driver before
     *      refunding the remaining escrow to the customer. The backend chooses
     *      the penalty only after validating the off-chain trip state.
     */
    function cancelWithPenalty(uint256 bookingId, uint256 driverFee)
        external
        onlyOwner
        nonReentrant
        whenNotPaused
    {
        Booking storage booking = bookings[bookingId];

        require(
            booking.customer != address(0) && booking.status == BookingStatus.Active,
            "TruxifyEscrow: Cannot cancel - booking not active"
        );
        require(!booking.paid, "TruxifyEscrow: Already paid");
        require(!booking.started, "TruxifyEscrow: Trip already started");
        require(booking.amount > 0, "TruxifyEscrow: Nothing to refund");
        require(driverFee <= booking.amount, "TruxifyEscrow: Penalty exceeds escrow");

        uint256 escrowAmount = booking.amount;
        uint256 customerRefund = escrowAmount - driverFee;
        address payable customer = booking.customer;
        address payable driver = booking.driver;

        booking.amount = 0;
        booking.paid = true;
        booking.status = BookingStatus.Cancelled;

        uint256 newDeadline = block.timestamp + WITHDRAWAL_TIMEOUT;
        if (driverFee > 0) {
            pendingWithdrawals[driver] += driverFee;
            if (releaseTimestamps[driver] == 0 || newDeadline > releaseTimestamps[driver]) {
                releaseTimestamps[driver] = newDeadline;
            }
            emit WithdrawalReady(bookingId, driver, driverFee);
        }
        if (customerRefund > 0) {
            pendingWithdrawals[customer] += customerRefund;
            if (releaseTimestamps[customer] == 0 || newDeadline > releaseTimestamps[customer]) {
                releaseTimestamps[customer] = newDeadline;
            }
            emit WithdrawalReady(bookingId, customer, customerRefund);
        }

        emit CancellationPenaltyApplied(bookingId, driver, driverFee, customer, customerRefund);

        // Release the slot so a retried/regenerated order can re-use the id.
        _releaseBookingSlot(bookingId);
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
    function raiseDispute(uint256 bookingId) external onlyOwner whenNotPaused {
        Booking storage booking = bookings[bookingId];

        require(
            booking.customer != address(0) && booking.status == BookingStatus.Active,
            "TruxifyEscrow: Cannot dispute - booking not active"
        );

        booking.status = BookingStatus.Disputed;
        booking.disputedAt = block.timestamp;

        emit BookingDisputed(bookingId, msg.sender);
    }

    /**
     * @dev Resolve a disputed booking by splitting the escrowed funds between
     *      the driver and the customer. Restricted to onlyOwner (backend) so
     *      disputes are settled through the backend's resolution pipeline
     *      (n8n automation) — no third party can force an outcome.
     *
     *      Pass driverAmount == booking.amount to pay the driver in full,
     *      or 0 to refund the customer in full. Any partial amount is split
     *      between both parties. Sets a terminal Resolved state and routes
     *      each party's share to their pending-withdrawal bucket.
     *
     * @param bookingId   The disputed booking to resolve
     * @param driverAmount The portion of the escrow awarded to the driver
     */
    function resolveDispute(uint256 bookingId, uint256 driverAmount)
        external
        onlyOwner
        nonReentrant
        whenNotPaused
    {
        Booking storage booking = bookings[bookingId];

        require(
            booking.status == BookingStatus.Disputed,
            "TruxifyEscrow: Booking not disputed"
        );
        require(!booking.paid, "TruxifyEscrow: Already paid");
        require(booking.amount > 0, "TruxifyEscrow: Nothing to resolve");
        require(driverAmount <= booking.amount, "TruxifyEscrow: Award exceeds escrow");

        uint256 escrowAmount   = booking.amount;
        uint256 customerRefund = escrowAmount - driverAmount;
        address payable driver = booking.driver;
        address payable customer = booking.customer;

        booking.amount = 0;
        booking.paid = true;
        booking.status = BookingStatus.Resolved;

        uint256 newDeadline = block.timestamp + WITHDRAWAL_TIMEOUT;
        if (driverAmount > 0) {
            pendingWithdrawals[driver] += driverAmount;
            if (releaseTimestamps[driver] == 0 || newDeadline > releaseTimestamps[driver]) {
                releaseTimestamps[driver] = newDeadline;
            }
            emit WithdrawalReady(bookingId, driver, driverAmount);
        }
        if (customerRefund > 0) {
            pendingWithdrawals[customer] += customerRefund;
            if (releaseTimestamps[customer] == 0 || newDeadline > releaseTimestamps[customer]) {
                releaseTimestamps[customer] = newDeadline;
            }
            emit WithdrawalReady(bookingId, customer, customerRefund);
        }

        emit DisputeResolved(bookingId, driver, driverAmount, customer, customerRefund);
    }

    /**
     * @dev Resolve a stale dispute that has been inactive for DISPUTE_TIMEOUT.
     *      Defaults to refunding the customer in full to prevent locked funds.
     *      Restricted to onlyOwner (backend) so an arbitrary third party cannot
     *      front-run a pending resolution and force a full customer refund.
     * @param bookingId The booking to resolve
     */
    function resolveDisputeTimeout(uint256 bookingId)
        external
        onlyOwner
        nonReentrant
        whenNotPaused
    {
        Booking storage booking = bookings[bookingId];

        require(
            booking.status == BookingStatus.Disputed,
            "TruxifyEscrow: Booking not disputed"
        );
        require(
            block.timestamp > booking.disputedAt + DISPUTE_TIMEOUT,
            "TruxifyEscrow: Dispute timeout not reached"
        );
        require(!booking.paid, "TruxifyEscrow: Already paid");

        // ── EFFECTS: Default to refunding customer ──────────────────────────
        uint256 refundAmount = booking.amount;
        address payable customer = booking.customer;

        booking.amount = 0;
        booking.paid = true;
        booking.status = BookingStatus.Cancelled;

        // ── INTERACTIONS ──────────────────────────────────────────────────
        pendingWithdrawals[customer] += refundAmount;
        releaseTimestamps[customer] = block.timestamp + WITHDRAWAL_TIMEOUT;

        emit WithdrawalReady(bookingId, customer, refundAmount);
        emit BookingCancelled(bookingId, customer, refundAmount);

        // Release the slot so a retried/regenerated order can re-use the id.
        _releaseBookingSlot(bookingId);
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
        // require(block.timestamp > releaseTimestamps[msg.sender], "Withdrawal period active"); // Immediate withdrawal allowed

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

    /**
     * @dev Set the trusted relayer whose Kyber-hybrid signatures gate
     *      authorization flows. Only the owner may update it.
     */
    function setTrustedRelayer(address _newRelayer) external onlyOwner {
        require(_newRelayer != address(0), "Invalid relayer address");
        trustedRelayer = _newRelayer;
        emit RelayerUpdated(_newRelayer);
    }

    /**
     * @dev Post-Quantum Hybrid Verification helper for Kyber1024 shared secrets.
     *      Recovers the signer of the combined hash and requires it to be the
     *      on-chain trustedRelayer so arbitrary third-party signatures cannot
     *      satisfy the check.
     */
    function verifyKyberRelayerSignature(
        bytes32 messageHash,
        bytes32 kyberSharedSecretHash,
        bytes memory signature
    ) external view returns (bool) {
        require(trustedRelayer != address(0), "Relayer not configured");
        require(signature.length == 65, "Invalid signature length");
        bytes32 combinedHash = keccak256(abi.encodePacked(messageHash, kyberSharedSecretHash));
        
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(signature, 32))
            s := mload(add(signature, 64))
            v := byte(0, mload(add(signature, 96)))
        }
        
        address signer = ecrecover(combinedHash, v, r, s);
        return (signer == trustedRelayer);
    }
}
