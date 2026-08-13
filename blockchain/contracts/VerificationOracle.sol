// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract VerificationOracle {
    struct VerificationRecord {
        string orderId;
        string ipfsHash;
        uint256 timestamp;
        bool verified;
        address verifier;
    }

    mapping(string => VerificationRecord) public verifications;
    address public admin;
    
    event VerificationCreated(string indexed orderId, string ipfsHash, uint256 timestamp);
    event VerificationUpdated(string indexed orderId, bool verified);
    event VerificationFlagUpdated(string indexed orderId, bool previousVerified, bool newVerified);
    
    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin can call this");
        _;
    }
    
    constructor() {
        admin = msg.sender;
    }
    
    /**
     * @dev Creates a verification record. Rejects an orderId that already has
     *      an attestation instead of silently overwriting the prior
     *      ipfsHash/timestamp, preserving the audit trail (issue #11665).
     */
    function createVerification(
        string memory orderId, 
        string memory ipfsHash
    ) public onlyAdmin {
        require(verifications[orderId].timestamp == 0, "Order already verified");
        verifications[orderId] = VerificationRecord({
            orderId: orderId,
            ipfsHash: ipfsHash,
            timestamp: block.timestamp,
            verified: true,
            verifier: msg.sender
        });
        
        emit VerificationCreated(orderId, ipfsHash, block.timestamp);
    }
    
    /**
     * @dev Sets the verification outcome explicitly (true or false) after an
     *      attestation exists. This makes `verified` a genuine, mutable flag
     *      rather than a constant true (issue #11665).
     */
    function updateVerification(string memory orderId, bool isValid) public onlyAdmin {
        VerificationRecord storage record = verifications[orderId];
        require(record.timestamp != 0, "No verification exists for this order");
        bool previousVerified = record.verified;
        record.verified = isValid;
        emit VerificationFlagUpdated(orderId, previousVerified, isValid);
        emit VerificationUpdated(orderId, isValid);
    }
    
    function verifyOrder(string memory orderId) public view returns (bool) {
        return verifications[orderId].verified;
    }
    
    function getVerification(string memory orderId) public view returns (
        string memory ipfsHash,
        uint256 timestamp,
        bool verified,
        address verifier
    ) {
        VerificationRecord memory record = verifications[orderId];
        return (record.ipfsHash, record.timestamp, record.verified, record.verifier);
    }
}