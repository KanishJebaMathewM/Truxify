// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./verifier.sol";

/**
 * @title DriverQualificationVerifier
 * @notice On-chain Groth16 zk-SNARK verifier and qualification registry for truck drivers.
 * @dev Verifies that driver age, license validity, background check, and vehicle class
 * meet freight compliance without revealing raw identity or license identifiers.
 */
contract DriverQualificationVerifier is Verifier {
    struct DriverAttestation {
        bool isQualified;
        uint8 vehicleCategory;      // 1 = LCV, 2 = HCV, 3 = Heavy Trailer
        uint256 verifiedAt;
        uint256 validUntilEpochDays;
        bytes32 commitmentHash;
    }

    // Mapping from driver address to active qualification attestation
    mapping(address => DriverAttestation) public attestations;

    // Admin & Auditor roles
    address public admin;
    mapping(address => bool) public authorizedAuditors;

    // Events
    event DriverAttested(
        address indexed driver,
        uint8 indexed vehicleCategory,
        uint256 validUntilEpochDays,
        bytes32 commitmentHash,
        uint256 timestamp
    );
    event AttestationRevoked(address indexed driver, string reason, uint256 timestamp);
    event AuditorUpdated(address indexed auditor, bool authorized);

    modifier onlyAdmin() {
        require(msg.sender == admin, "DriverQualificationVerifier: caller is not admin");
        _;
    }

    modifier onlyAuthorized() {
        require(msg.sender == admin || authorizedAuditors[msg.sender], "DriverQualificationVerifier: unauthorized");
        _;
    }

    constructor() {
        admin = msg.sender;
        authorizedAuditors[msg.sender] = true;
    }

    /**
     * @notice Verifies a driver's Groth16 zero-knowledge proof and records qualification attestation.
     * @param a Groth16 proof point A
     * @param b Groth16 proof point B
     * @param c Groth16 proof point C
     * @param input Public inputs: [driverAddress, currentTripEpochDays, requiredVehicleCategory, expectedCommitment]
     * @param driver Ethereum address of the driver
     * @param validUntilEpochDays Maximum validity date in epoch days
     */
    function verifyAndAttest(
        uint[2] memory a,
        uint[2][2] memory b,
        uint[2] memory c,
        uint[4] memory input,
        address driver,
        uint256 validUntilEpochDays
    ) external onlyAuthorized returns (bool) {
        require(driver != address(0), "DriverQualificationVerifier: invalid driver address");
        require(a[0] != 0 || a[1] != 0, "DriverQualificationVerifier: zero proof rejected");

        // Bind proof to driver address: input[0] must match the driver's address
        require(uint256(input[0]) == uint256(uint160(driver)), "DriverQualificationVerifier: proof not bound to driver");

        // Verify Groth16 pairing proof
        // Note: adapter maps 4 public inputs into verifyProof format
        uint[] memory pubInputs = new uint[](4);
        pubInputs[0] = input[0];
        pubInputs[1] = input[1];
        pubInputs[2] = input[2];
        pubInputs[3] = input[3];

        bool isValid = verifyProof(a, b, c, input);
        require(isValid, "DriverQualificationVerifier: invalid ZK proof");

        uint8 verifiedCategory = uint8(input[2]);
        bytes32 commitment = bytes32(input[3]);

        attestations[driver] = DriverAttestation({
            isQualified: true,
            vehicleCategory: verifiedCategory,
            verifiedAt: block.timestamp,
            validUntilEpochDays: validUntilEpochDays,
            commitmentHash: commitment
        });

        emit DriverAttested(driver, verifiedCategory, validUntilEpochDays, commitment, block.timestamp);
        return true;
    }

    /**
     * @notice Checks whether a driver holds an active qualification attestation for a required vehicle class and trip date.
     * @param driver Driver wallet address
     * @param requiredCategory Minimum vehicle category code (1=LCV, 2=HCV)
     * @param tripEpochDays Epoch day of the scheduled trip
     */
    function isDriverQualifiedForTrip(
        address driver,
        uint8 requiredCategory,
        uint256 tripEpochDays
    ) external view returns (bool) {
        DriverAttestation memory attestation = attestations[driver];
        if (!attestation.isQualified) {
            return false;
        }
        if (attestation.validUntilEpochDays < tripEpochDays) {
            return false;
        }
        if (attestation.vehicleCategory < requiredCategory) {
            return false;
        }
        return true;
    }

    /**
     * @notice Revokes a driver's qualification in case of traffic violations or license cancellation.
     */
    function revokeAttestation(address driver, string calldata reason) external onlyAuthorized {
        require(attestations[driver].isQualified, "DriverQualificationVerifier: driver not qualified");
        attestations[driver].isQualified = false;
        emit AttestationRevoked(driver, reason, block.timestamp);
    }

    /**
     * @notice Authorizes or removes an auditor (e.g. logistics safety auditor or automated oracle).
     */
    function setAuditor(address auditor, bool authorized) external onlyAdmin {
        require(auditor != address(0), "DriverQualificationVerifier: invalid auditor address");
        authorizedAuditors[auditor] = authorized;
        emit AuditorUpdated(auditor, authorized);
    }
}
