// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title EwayBillRegistry
 * @dev On-Chain Tamper-Proof Indian GST e-Way Bill Registry on Polygon.
 *      Stores cryptographic digests (SHA-256) of consignment metadata, Part-B vehicle allocations,
 *      and validity periods. Enables instant roadside verification by RTO transport inspectors.
 */
contract EwayBillRegistry is Ownable, Pausable {

    // ─── Structs & Enums ─────────────────────────────────────────────────────

    struct EwayRecord {
        uint256 ewayBillNumber;     // 12-digit e-Way Bill Number
        string vehicleNumber;       // Part-B Assigned Vehicle Registration (e.g., "MH-12-AB-1234")
        bytes32 metadataDigest;     // SHA-256 hash of HSN codes, consignor/consignee, value
        uint256 validUntil;         // Block timestamp of validity expiry
        bool isActive;
        bool isCancelled;
        uint256 registeredAt;
        uint256 lastUpdatedAt;
    }

    struct VehicleUpdateHistory {
        string previousVehicle;
        string newVehicle;
        bytes32 reasonDigest;
        uint256 updatedAt;
    }

    // ─── State ───────────────────────────────────────────────────────────────

    mapping(uint256 => EwayRecord) public ewayBills;
    mapping(uint256 => VehicleUpdateHistory[]) public vehicleHistories;
    mapping(address => bool) public authorizedGateways;

    // ─── Events ──────────────────────────────────────────────────────────────

    event EwayBillRegistered(
        uint256 indexed ewayBillNumber,
        string vehicleNumber,
        bytes32 metadataDigest,
        uint256 validUntil
    );

    event VehicleUpdated(
        uint256 indexed ewayBillNumber,
        string previousVehicle,
        string newVehicle,
        bytes32 reasonDigest
    );

    event ValidityExtended(
        uint256 indexed ewayBillNumber,
        uint256 previousExpiry,
        uint256 newExpiry,
        bytes32 justificationHash
    );

    event EwayBillCancelled(uint256 indexed ewayBillNumber, bytes32 reasonHash);
    event GatewayAuthorized(address indexed gateway, bool status);

    // ─── Modifiers ───────────────────────────────────────────────────────────

    modifier onlyAuthorizedGatewayOrOwner() {
        require(
            authorizedGateways[msg.sender] || msg.sender == owner(),
            "EwayBillRegistry: caller is not authorized gateway or owner"
        );
        _;
    }

    // ─── Constructor ─────────────────────────────────────────────────────────

    constructor(address _initialGateway) Ownable(msg.sender) {
        if (_initialGateway != address(0)) {
            authorizedGateways[_initialGateway] = true;
            emit GatewayAuthorized(_initialGateway, true);
        }
    }

    // ─── External / Public Functions ─────────────────────────────────────────

    /**
     * @notice Registers a validated e-Way Bill on-chain with its metadata digest.
     */
    function registerEwayBill(
        uint256 ewayBillNumber,
        string calldata vehicleNumber,
        bytes32 metadataDigest,
        uint256 validUntil
    ) external whenNotPaused onlyAuthorizedGatewayOrOwner {
        require(ewayBillNumber > 0, "EwayBillRegistry: invalid e-Way Bill number");
        require(bytes(vehicleNumber).length > 0, "EwayBillRegistry: vehicle number required");
        require(validUntil > block.timestamp, "EwayBillRegistry: validUntil must be in future");
        require(ewayBills[ewayBillNumber].registeredAt == 0, "EwayBillRegistry: e-Way Bill already exists");

        ewayBills[ewayBillNumber] = EwayRecord({
            ewayBillNumber: ewayBillNumber,
            vehicleNumber: vehicleNumber,
            metadataDigest: metadataDigest,
            validUntil: validUntil,
            isActive: true,
            isCancelled: false,
            registeredAt: block.timestamp,
            lastUpdatedAt: block.timestamp
        });

        emit EwayBillRegistered(ewayBillNumber, vehicleNumber, metadataDigest, validUntil);
    }

    /**
     * @notice Updates Part-B vehicle number for transshipment or breakdown.
     */
    function updateVehicle(
        uint256 ewayBillNumber,
        string calldata newVehicleNumber,
        bytes32 reasonDigest
    ) external whenNotPaused onlyAuthorizedGatewayOrOwner {
        EwayRecord storage record = ewayBills[ewayBillNumber];
        require(record.isActive, "EwayBillRegistry: e-Way Bill is not active");
        require(!record.isCancelled, "EwayBillRegistry: e-Way Bill is cancelled");
        require(bytes(newVehicleNumber).length > 0, "EwayBillRegistry: invalid new vehicle number");

        string memory previousVehicle = record.vehicleNumber;
        record.vehicleNumber = newVehicleNumber;
        record.lastUpdatedAt = block.timestamp;

        vehicleHistories[ewayBillNumber].push(VehicleUpdateHistory({
            previousVehicle: previousVehicle,
            newVehicle: newVehicleNumber,
            reasonDigest: reasonDigest,
            updatedAt: block.timestamp
        }));

        emit VehicleUpdated(ewayBillNumber, previousVehicle, newVehicleNumber, reasonDigest);
    }

    /**
     * @notice Extends validity of an e-Way bill due to highway delay or breakdown.
     */
    function extendValidity(
        uint256 ewayBillNumber,
        uint256 newExpiryTimestamp,
        bytes32 justificationHash
    ) external whenNotPaused onlyAuthorizedGatewayOrOwner {
        EwayRecord storage record = ewayBills[ewayBillNumber];
        require(record.isActive, "EwayBillRegistry: e-Way Bill is not active");
        require(!record.isCancelled, "EwayBillRegistry: e-Way Bill is cancelled");
        require(newExpiryTimestamp > record.validUntil, "EwayBillRegistry: new expiry must be greater than current");

        uint256 previousExpiry = record.validUntil;
        record.validUntil = newExpiryTimestamp;
        record.lastUpdatedAt = block.timestamp;

        emit ValidityExtended(ewayBillNumber, previousExpiry, newExpiryTimestamp, justificationHash);
    }

    /**
     * @notice Verification view function used by RTO officials and transport inspectors.
     */
    function verifyEwayBill(uint256 ewayBillNumber) external view returns (
        bool isValid,
        string memory vehicleNumber,
        uint256 validUntil,
        bytes32 metadataDigest,
        bool isExpired
    ) {
        EwayRecord storage record = ewayBills[ewayBillNumber];
        if (record.registeredAt == 0 || !record.isActive || record.isCancelled) {
            return (false, "", 0, bytes32(0), false);
        }

        bool expired = block.timestamp > record.validUntil;
        return (
            !expired,
            record.vehicleNumber,
            record.validUntil,
            record.metadataDigest,
            expired
        );
    }

    /**
     * @notice Sets authorization for gateway backend relayer addresses.
     */
    function setGatewayAuthorization(address gateway, bool status) external onlyOwner {
        require(gateway != address(0), "EwayBillRegistry: invalid gateway address");
        authorizedGateways[gateway] = status;
        emit GatewayAuthorized(gateway, status);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
