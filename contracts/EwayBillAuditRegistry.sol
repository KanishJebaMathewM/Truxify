// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title EwayBillAuditRegistry
 * @notice Anchors SHA-256 hashes of Indian GST e-Way Bill consignment states on Polygon
 *         for instant tamper-proof roadside verification by transport/RTO inspectors.
 */
contract EwayBillAuditRegistry {
    struct AuditRecord {
        bytes32 payloadHash;
        uint256 validUpto;
        uint256 anchoredAt;
        string eventType; // "CREATED", "EXTENDED", "VEHICLE_UPDATED"
    }

    address public owner;
    mapping(string => AuditRecord[]) private _recordsByEwb;

    event EwayBillAnchored(
        string indexed ewbNumber,
        bytes32 indexed payloadHash,
        uint256 validUpto,
        string eventType,
        uint256 timestamp
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "Not authorized");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function anchorState(
        string calldata ewbNumber,
        bytes32 payloadHash,
        uint256 validUpto,
        string calldata eventType
    ) external onlyOwner {
        _recordsByEwb[ewbNumber].push(
            AuditRecord({
                payloadHash: payloadHash,
                validUpto: validUpto,
                anchoredAt: block.timestamp,
                eventType: eventType
            })
        );

        emit EwayBillAnchored(
            ewbNumber,
            payloadHash,
            validUpto,
            eventType,
            block.timestamp
        );
    }

    function getLatestRecord(string calldata ewbNumber)
        external
        view
        returns (
            bytes32 payloadHash,
            uint256 validUpto,
            uint256 anchoredAt,
            string memory eventType
        )
    {
        uint256 len = _recordsByEwb[ewbNumber].length;
        require(len > 0, "No audit record found");
        AuditRecord memory rec = _recordsByEwb[ewbNumber][len - 1];
        return (rec.payloadHash, rec.validUpto, rec.anchoredAt, rec.eventType);
    }

    function getRecordCount(string calldata ewbNumber) external view returns (uint256) {
        return _recordsByEwb[ewbNumber].length;
    }
}