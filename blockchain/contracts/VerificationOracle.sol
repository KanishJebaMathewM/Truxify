// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract VerificationOracle {
    struct VerificationRecord {
        string orderId;
        string ipfsHash;
        uint256 timestamp;
        bool verified;
        address verifier;
        bool exists;
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
     *      A newly created record starts unverified; its outcome is set by
     *      `updateVerification` only after an actual check (issue #14853).
     */
    function createVerification(
        string memory orderId, 
        string memory ipfsHash
    ) public onlyAdmin {
        require(!verifications[orderId].exists, "Order already verified");
        verifications[orderId] = VerificationRecord({
            orderId: orderId,
            ipfsHash: ipfsHash,
            timestamp: block.timestamp,
            verified: false,
            verifier: msg.sender,
            exists: true
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
        require(record.exists, "No verification exists for this order");
        bool previousVerified = record.verified;
        record.verified = isValid;
        emit VerificationFlagUpdated(orderId, previousVerified, isValid);
        emit VerificationUpdated(orderId, isValid);
    }
    
    /**
     * @dev Returns both whether an attestation `exists` and its `verified`
     *      outcome, so callers can distinguish an order that was never
     *      attested from one that was explicitly rejected (issue #14853).
     */
    function verifyOrder(string memory orderId) public view returns (bool exists, bool verified) {
        VerificationRecord storage record = verifications[orderId];
        return (record.exists, record.verified);
    }

    /**
     * @dev Update an existing verification record (only admin can update).
     * @param orderId The order ID
     * @param ipfsHash New IPFS hash (optional — pass empty string to keep existing)
     * @param verified New verified status
     */
    function updateVerification(
        string memory orderId,
        string memory ipfsHash,
        bool verified
    ) public onlyAdmin {
        require(
            bytes(verifications[orderId].orderId).length != 0,
            "No existing verification record to update"
        );
        verifications[orderId].ipfsHash = ipfsHash;
        verifications[orderId].verified = verified;
        verifications[orderId].timestamp = block.timestamp;
        verifications[orderId].verifier = msg.sender;

        emit VerificationUpdated(orderId, verified);
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