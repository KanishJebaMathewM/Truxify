// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title ColdChainSLAEscrow
 * @dev Smart Contract SLA Escrow for Perishable & Sensitive Cargo on Polygon.
 *      Enforces programmatic quality-of-service guarantees based on IoT telemetry
 *      (temperature bounds, Mean Kinetic Temperature excursions, shock impacts, door breaches).
 *
 * Security:
 *  - Checks-Effects-Interactions (CEI) pattern.
 *  - ReentrancyGuard on all fund releases.
 *  - Pull-over-push withdrawal fallback.
 *  - Immutable on-chain telemetry violation logging for insurance claims.
 */
contract ColdChainSLAEscrow is ReentrancyGuard, Ownable, Pausable {

    // ─── Enums & Structs ─────────────────────────────────────────────────────

    enum BreachType {
        None,
        TemperatureHigh,
        TemperatureLow,
        ExcessiveMkt,
        SevereShockImpact,
        UnauthorizedDoorOpening
    }

    struct SLAParameters {
        int16 minTempCelsius;       // Scaled by 10 (e.g., 20 = 2.0°C, -180 = -18.0°C)
        int16 maxTempCelsius;       // Scaled by 10 (e.g., 80 = 8.0°C)
        uint16 maxExcursionMinutes; // Max cumulative allowed excursion time
        uint16 maxShockMilliG;      // Max allowed shock impact in milli-g (e.g., 3500 = 3.5g)
        uint16 penaltyBasisPoints;  // Penalty percentage per critical breach (e.g., 2500 = 25%)
    }

    struct PerishableBooking {
        address payable customer;
        address payable driver;
        uint256 totalAmount;
        uint256 penaltyDeducted;
        SLAParameters sla;
        uint256 totalExcursionMinutes;
        bool isSettled;
        bool isDisputed;
        uint256 breachCount;
        uint256 createdAt;
    }

    struct BreachLog {
        BreachType breachType;
        int16 observedValue;
        uint256 timestamp;
        bytes32 evidenceHash;
    }

    // ─── State ───────────────────────────────────────────────────────────────

    mapping(bytes32 => PerishableBooking) public bookings;
    mapping(bytes32 => BreachLog[]) public bookingBreaches;
    mapping(address => uint256) public pendingWithdrawals;

    address public telemetryOracle;

    // ─── Events ──────────────────────────────────────────────────────────────

    event ColdChainEscrowCreated(
        bytes32 indexed bookingId,
        address indexed customer,
        address indexed driver,
        uint256 totalAmount,
        int16 minTemp,
        int16 maxTemp
    );

    event SLABreachRecorded(
        bytes32 indexed bookingId,
        BreachType indexed breachType,
        int16 observedValue,
        uint256 penaltyApplied,
        bytes32 evidenceHash
    );

    event ColdChainEscrowSettled(
        bytes32 indexed bookingId,
        address indexed driver,
        uint256 driverPayout,
        uint256 customerRefund
    );

    event TelemetryOracleUpdated(address indexed previousOracle, address indexed newOracle);
    event WithdrawalClaimed(address indexed payee, uint256 amount);

    // ─── Modifiers ───────────────────────────────────────────────────────────

    modifier onlyOracleOrOwner() {
        require(
            msg.sender == telemetryOracle || msg.sender == owner(),
            "ColdChainSLAEscrow: caller is not telemetry oracle or owner"
        );
        _;
    }

    // ─── Constructor ─────────────────────────────────────────────────────────

    constructor(address _telemetryOracle) Ownable(msg.sender) {
        require(_telemetryOracle != address(0), "ColdChainSLAEscrow: invalid oracle address");
        telemetryOracle = _telemetryOracle;
    }

    // ─── Core Functions ──────────────────────────────────────────────────────

    /**
     * @notice Locks customer payment and establishes perishable cargo SLA criteria.
     */
    function createColdChainBooking(
        bytes32 bookingId,
        address payable driver,
        int16 minTempCelsius,
        int16 maxTempCelsius,
        uint16 maxExcursionMinutes,
        uint16 maxShockMilliG,
        uint16 penaltyBasisPoints
    ) external payable whenNotPaused nonReentrant {
        require(bookingId != bytes32(0), "ColdChainSLAEscrow: invalid booking ID");
        require(bookings[bookingId].createdAt == 0, "ColdChainSLAEscrow: booking already exists");
        require(driver != address(0), "ColdChainSLAEscrow: invalid driver address");
        require(msg.value > 0, "ColdChainSLAEscrow: escrow amount must be > 0");
        require(maxTempCelsius >= minTempCelsius, "ColdChainSLAEscrow: invalid temperature bounds");
        require(penaltyBasisPoints <= 10000, "ColdChainSLAEscrow: penalty cannot exceed 100%");

        bookings[bookingId] = PerishableBooking({
            customer: payable(msg.sender),
            driver: driver,
            totalAmount: msg.value,
            penaltyDeducted: 0,
            sla: SLAParameters({
                minTempCelsius: minTempCelsius,
                maxTempCelsius: maxTempCelsius,
                maxExcursionMinutes: maxExcursionMinutes,
                maxShockMilliG: maxShockMilliG,
                penaltyBasisPoints: penaltyBasisPoints
            }),
            totalExcursionMinutes: 0,
            isSettled: false,
            isDisputed: false,
            breachCount: 0,
            createdAt: block.timestamp
        });

        emit ColdChainEscrowCreated(
            bookingId,
            msg.sender,
            driver,
            msg.value,
            minTempCelsius,
            maxTempCelsius
        );
    }

    /**
     * @notice Ingests verified telemetry breach from the telemetry oracle and computes penalty.
     */
    function recordSLABreach(
        bytes32 bookingId,
        BreachType breachType,
        int16 observedValue,
        uint16 excursionMinutes,
        bytes32 evidenceHash
    ) external whenNotPaused onlyOracleOrOwner {
        PerishableBooking storage booking = bookings[bookingId];
        require(booking.createdAt > 0, "ColdChainSLAEscrow: booking not found");
        require(!booking.isSettled, "ColdChainSLAEscrow: booking already settled");

        booking.totalExcursionMinutes += excursionMinutes;
        booking.breachCount += 1;

        bookingBreaches[bookingId].push(BreachLog({
            breachType: breachType,
            observedValue: observedValue,
            timestamp: block.timestamp,
            evidenceHash: evidenceHash
        }));

        // Calculate penalty deduction based on SLA basis points
        uint256 penaltyForBreach = (booking.totalAmount * booking.sla.penaltyBasisPoints) / 10000;
        if (booking.penaltyDeducted + penaltyForBreach > booking.totalAmount) {
            penaltyForBreach = booking.totalAmount - booking.penaltyDeducted;
        }
        booking.penaltyDeducted += penaltyForBreach;

        emit SLABreachRecorded(
            bookingId,
            breachType,
            observedValue,
            penaltyForBreach,
            evidenceHash
        );
    }

    /**
     * @notice Releases final settlement upon verified delivery, transferring net payout to driver and refunding penalties to customer.
     */
    function settleColdChainEscrow(
        bytes32 bookingId
    ) external whenNotPaused onlyOracleOrOwner nonReentrant {
        PerishableBooking storage booking = bookings[bookingId];
        require(booking.createdAt > 0, "ColdChainSLAEscrow: booking not found");
        require(!booking.isSettled, "ColdChainSLAEscrow: booking already settled");

        booking.isSettled = true;

        uint256 total = booking.totalAmount;
        uint256 penalty = booking.penaltyDeducted;
        uint256 driverPayout = total > penalty ? total - penalty : 0;
        uint256 customerRefund = penalty;

        address payable driver = booking.driver;
        address payable customer = booking.customer;

        emit ColdChainEscrowSettled(bookingId, driver, driverPayout, customerRefund);

        if (driverPayout > 0) {
            (bool driverSuccess, ) = driver.call{value: driverPayout}("");
            if (!driverSuccess) {
                pendingWithdrawals[driver] += driverPayout;
            }
        }

        if (customerRefund > 0) {
            (bool customerSuccess, ) = customer.call{value: customerRefund}("");
            if (!customerSuccess) {
                pendingWithdrawals[customer] += customerRefund;
            }
        }
    }

    /**
     * @notice Pull-based withdrawal for queued payments.
     */
    function claimPendingWithdrawal() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount > 0, "ColdChainSLAEscrow: no pending withdrawal");

        pendingWithdrawals[msg.sender] = 0;
        emit WithdrawalClaimed(msg.sender, amount);

        (bool success, ) = payable(msg.sender).call{value: amount}("");
        require(success, "ColdChainSLAEscrow: transfer failed");
    }

    /**
     * @notice Returns all breach logs recorded for a booking.
     */
    function getBreachLogs(bytes32 bookingId) external view returns (BreachLog[] memory) {
        return bookingBreaches[bookingId];
    }

    /**
     * @notice Updates the trusted telemetry oracle address.
     */
    function setTelemetryOracle(address _newOracle) external onlyOwner {
        require(_newOracle != address(0), "ColdChainSLAEscrow: invalid address");
        emit TelemetryOracleUpdated(telemetryOracle, _newOracle);
        telemetryOracle = _newOracle;
    }

    /**
     * @notice Emergency pauses.
     */
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
