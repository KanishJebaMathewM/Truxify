// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./verifier.sol";

contract KYCVerifier is Verifier {
    // Mapping of verified users
    mapping(address => bool) public verifiedUsers;
    mapping(address => bytes32) public userDocumentHash;
    mapping(address => uint256) public verificationTimestamp;
    
    // Trusted authority Merkle root for approved KYC records
    bytes32 public trustedRoot;
    mapping(bytes32 => bool) public isTrustedRoot;

    // Optional custom ZK proof verifier contract
    address public customVerifier;

    // Events
    event UserVerified(address indexed user, uint256 timestamp);
    event DocumentHashed(address indexed user, bytes32 documentHash);
    event VerificationFailed(address indexed user, string reason);
    event TrustedRootUpdated(bytes32 indexed oldRoot, bytes32 indexed newRoot, uint256 timestamp);
    event CustomVerifierUpdated(address indexed oldVerifier, address indexed newVerifier);
    
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

    modifier onlyAuthority() {
        require(msg.sender == admin || msg.sender == regulator, "KYCVerifier: Only authority can call this");
        _;
    }
    
    constructor() {
        admin = msg.sender;
        regulator = msg.sender;
    }

    // Set custom verifier for cryptographic proof checks
    function setCustomVerifier(address _verifier) external onlyAdmin {
        address oldVerifier = customVerifier;
        customVerifier = _verifier;
        emit CustomVerifierUpdated(oldVerifier, _verifier);
    }

    // Set or update the authority-controlled Merkle root of approved KYC records
    function updateTrustedRoot(bytes32 newRoot) external onlyAuthority {
        require(newRoot != bytes32(0), "KYCVerifier: Invalid zero root");
        bytes32 oldRoot = trustedRoot;
        trustedRoot = newRoot;
        isTrustedRoot[newRoot] = true;
        emit TrustedRootUpdated(oldRoot, newRoot, block.timestamp);
    }
    
    // Verify KYC using ZK-SNARK proof
    function verifyKYC(
        uint[2] memory a,
        uint[2][2] memory b,
        uint[2] memory c,
        uint[] memory input,
        address user
    ) public onlyAdmin returns (bool) {
        require(user != address(0), "KYCVerifier: Invalid user address");
        // Reject zero / empty proofs before handing them to the verifier
        require(a[0] != 0 || a[1] != 0, "Zero proof rejected");
        require(input.length >= 2, "Invalid public input length");
        require(input[0] != 0 || input[1] != 0, "Empty public input");

        // Prevent replay of already-verified user
        if (verifiedUsers[user]) {
            emit VerificationFailed(user, "User already verified");
            return false;
        }

        // Bind the proof to the user: the circuit's first public input must
        // commit to the address being verified so one proof cannot be replayed
        // to mark arbitrary accounts as KYC-verified.
        if (uint256(input[0]) != uint256(uint160(user))) {
            emit VerificationFailed(user, "Proof not bound to user");
            return false;
        }

        // Validate document hash is non-zero
        if (input[1] == 0) {
            emit VerificationFailed(user, "Invalid document hash");
            return false;
        }

        // If regulator pre-registered a document hash, must match
        if (userDocumentHash[user] != bytes32(0) && bytes32(input[1]) != userDocumentHash[user]) {
            emit VerificationFailed(user, "Mismatched document hash");
            return false;
        }

        // Validate authority-controlled Merkle root
        if (input.length >= 3) {
            bytes32 root = bytes32(input[2]);
            if (root == bytes32(0) || (root != trustedRoot && !isTrustedRoot[root])) {
                emit VerificationFailed(user, "Untrusted authority root");
                return false;
            }
        } else if (trustedRoot != bytes32(0)) {
            emit VerificationFailed(user, "Missing authority root");
            return false;
        }

        // Verify the proof (fails closed for invalid/fabricated proofs)
        bool isValid = false;
        if (customVerifier != address(0)) {
            (bool success, bytes memory data) = customVerifier.staticcall(
                abi.encodeWithSignature("verifyProof(uint256[2],uint256[2][2],uint256[2],uint256[])", a, b, c, input)
            );
            if (success && data.length >= 32) {
                isValid = abi.decode(data, (bool));
            }
        } else if (input.length == 2) {
            uint[2] memory fixedInput;
            fixedInput[0] = input[0];
            fixedInput[1] = input[1];
            isValid = verifyProof(a, b, c, fixedInput);
        } else {
            isValid = verifyKYCProof(a, b, c, input);
        }
        
        if (isValid) {
            verifiedUsers[user] = true;
            userDocumentHash[user] = bytes32(input[1]);
            verificationTimestamp[user] = block.timestamp;
            emit UserVerified(user, block.timestamp);
            return true;
        } else {
            emit VerificationFailed(user, "Invalid ZK proof");
            return false;
        }
    }

    function verifyKYCProof(
        uint[2] memory a,
        uint[2][2] memory b,
        uint[2] memory c,
        uint[] memory input
    ) public view virtual returns (bool) {
        if (customVerifier != address(0)) {
            (bool success, bytes memory data) = customVerifier.staticcall(
                abi.encodeWithSignature("verifyProof(uint256[2],uint256[2][2],uint256[2],uint256[])", a, b, c, input)
            );
            if (success && data.length >= 32) {
                return abi.decode(data, (bool));
            }
        }
        // Until real Groth16 pairings are generated, fail closed:
        return false;
    }
    
    // Store document hash on-chain
    function hashDocument(
        bytes32 documentHash,
        address user
    ) public onlyRegulator {
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