// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./verifier.sol";

contract KYCVerifier is Verifier {
    // Mapping of verified users
    mapping(address => bool) public verifiedUsers;
    mapping(address => bytes32) public userDocumentHash;
    mapping(address => uint256) public verificationTimestamp;
    
    // Events
    event UserVerified(address indexed user, uint256 timestamp);
    event DocumentHashed(address indexed user, bytes32 documentHash);
    event VerificationFailed(address indexed user, string reason);
    
    // Admin role
    address public admin;
    address public regulator;
    
    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin can call this");
        _;
    }
    
    modifier onlyRegulator() {
        require(msg.sender == regulator, "Only regulator can call this");
        _;
    }
    
    constructor() {
        admin = msg.sender;
        regulator = msg.sender;
    }
    
    // Verify KYC using ZK-SNARK proof
    function verifyKYC(
        uint[2] memory a,
        uint[2][2] memory b,
        uint[2] memory c,
        uint[2] memory input,
        address user
    ) public onlyAdmin returns (bool) {
        // Verify the proof
        bool isValid = verifyProof(a, b, c, input);
        
        if (isValid) {
            verifiedUsers[user] = true;
            verificationTimestamp[user] = block.timestamp;
            emit UserVerified(user, block.timestamp);
            return true;
        } else {
            emit VerificationFailed(user, "Invalid ZK proof");
            return false;
        }
    }
    
    // Store document hash on-chain
    function hashDocument(
        bytes32 documentHash,
        address user
    ) public onlyAdmin {
        userDocumentHash[user] = documentHash;
        emit DocumentHashed(user, documentHash);
    }
    
    // Check if user is verified (zero-knowledge verification)
    function isVerified(address user) public view returns (bool) {
        return verifiedUsers[user];
    }
    
    // Get verification timestamp
    function getVerificationTime(address user) public view returns (uint256) {
        return verificationTimestamp[user];
    }
    
    // Get document hash (only for regulator)
    function getDocumentHash(address user) public view onlyRegulator returns (bytes32) {
        return userDocumentHash[user];
    }
    
    // Emergency revoke verification
    function revokeVerification(address user) public onlyRegulator {
        verifiedUsers[user] = false;
        emit VerificationFailed(user, "Revoked by regulator");
    }
    
    // Set regulator address
    function setRegulator(address newRegulator) public onlyAdmin {
        require(newRegulator != address(0), "KYCVerifier: Invalid regulator address");
        require(newRegulator != regulator, "KYCVerifier: Regulator already set");
        regulator = newRegulator;
    }
}