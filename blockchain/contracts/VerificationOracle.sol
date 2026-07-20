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
    
    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin can call this");
        _;
    }
    
    constructor() {
        admin = msg.sender;
    }
    
    function createVerification(
        string memory orderId, 
        string memory ipfsHash
    ) public onlyAdmin {
        verifications[orderId] = VerificationRecord({
            orderId: orderId,
            ipfsHash: ipfsHash,
            timestamp: block.timestamp,
            verified: true,
            verifier: msg.sender
        });
        
        emit VerificationCreated(orderId, ipfsHash, block.timestamp);
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