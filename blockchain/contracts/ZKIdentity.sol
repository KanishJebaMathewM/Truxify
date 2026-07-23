// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

interface IVerifier {
    function verifyProof(
        uint[2] memory a,
        uint[2][2] memory b,
        uint[2] memory c,
        uint[] memory input
    ) external view returns (bool);
}

contract ZKIdentity is Ownable, ReentrancyGuard, Pausable {
    // ============ Structs ============

    struct Identity {
        bytes32 identityHash;
        address owner;
        uint256 createdAt;
        uint256 updatedAt;
        bool isActive;
        bytes32[] credentialHashes;
    }

    struct Credential {
        bytes32 credentialHash;
        bytes32 identityHash;
        string credentialType;
        bytes32 schemaHash;
        uint256 issuedAt;
        uint256 expiresAt;
        bool revoked;
        address issuer;
    }

    struct VerificationRequest {
        bytes32 requestId;
        bytes32 identityHash;
        bytes32 credentialHash;
        uint256 timestamp;
        bool verified;
        address requester;
    }

    struct SelectiveDisclosure {
        bytes32 disclosureId;
        bytes32 identityHash;
        bytes32[] disclosedAttributes;
        uint256 timestamp;
        bool active;
        address recipient;
    }

    // ============ State Variables ============

    mapping(bytes32 => Identity) public identities;
    mapping(bytes32 => Credential) public credentials;
    mapping(bytes32 => VerificationRequest) public verificationRequests;
    mapping(bytes32 => SelectiveDisclosure) public selectiveDisclosures;
    mapping(address => bytes32[]) public userIdentities;

    bytes32 public constant DEFAULT_SCHEMA = keccak256("DEFAULT_IDENTITY_SCHEMA");
    uint256 public constant CREDENTIAL_DURATION = 365 days;

    uint256 public identityCounter;
    uint256 public credentialCounter;
    uint256 public requestCounter;
    uint256 public disclosureCounter;

    address public verifierContract;

    // Events
    event IdentityCreated(bytes32 indexed identityHash, address indexed owner);
    event IdentityUpdated(bytes32 indexed identityHash);
    event CredentialIssued(bytes32 indexed credentialHash, bytes32 indexed identityHash);
    event CredentialRevoked(bytes32 indexed credentialHash);
    event VerificationRequested(bytes32 indexed requestId, bytes32 identityHash);
    event VerificationCompleted(bytes32 indexed requestId, bool verified);
    event SelectiveDisclosureCreated(bytes32 indexed disclosureId, bytes32 identityHash);
    event SelectiveDisclosureRevoked(bytes32 indexed disclosureId);

    // ============ Constructor ============

    constructor(address _verifier) Ownable(msg.sender) {
        verifierContract = _verifier;
    }

    // ============ Identity Management ============

    function createIdentity(bytes32 identityHash) external whenNotPaused {
        require(identities[identityHash].owner == address(0), "Identity already exists");
        require(identityHash != bytes32(0), "Invalid identity hash");

        identityCounter++;
        identities[identityHash] = Identity({
            identityHash: identityHash,
            owner: msg.sender,
            createdAt: block.timestamp,
            updatedAt: block.timestamp,
            isActive: true,
            credentialHashes: new bytes32[](0)
        });

        userIdentities[msg.sender].push(identityHash);

        emit IdentityCreated(identityHash, msg.sender);
    }

    function updateIdentity(bytes32 identityHash, bytes32 newIdentityHash) external {
        require(identities[identityHash].owner == msg.sender, "Not owner");
        require(identities[identityHash].isActive, "Identity not active");
        require(identities[newIdentityHash].owner == address(0), "New identity exists");

        // Transfer identity
        identities[newIdentityHash] = identities[identityHash];
        identities[newIdentityHash].identityHash = newIdentityHash;
        identities[newIdentityHash].updatedAt = block.timestamp;

        // Remove old identity
        delete identities[identityHash];

        // Update user identities list
        bytes32[] storage userIds = userIdentities[msg.sender];
        for (uint256 i = 0; i < userIds.length; i++) {
            if (userIds[i] == identityHash) {
                userIds[i] = newIdentityHash;
                break;
            }
        }

        emit IdentityUpdated(newIdentityHash);
    }

    function deactivateIdentity(bytes32 identityHash) external {
        require(identities[identityHash].owner == msg.sender, "Not owner");
        require(identities[identityHash].isActive, "Already inactive");

        identities[identityHash].isActive = false;
        identities[identityHash].updatedAt = block.timestamp;

        emit IdentityUpdated(identityHash);
    }

    // ============ Credential Management ============

    function issueCredential(
        bytes32 identityHash,
        string memory credentialType,
        bytes32 schemaHash,
        bytes32 credentialHash
    ) external onlyOwner {
        require(identities[identityHash].isActive, "Identity not active");
        require(credentialHash != bytes32(0), "Invalid credential hash");
        require(credentials[credentialHash].issuer == address(0), "Credential exists");

        credentialCounter++;
        credentials[credentialHash] = Credential({
            credentialHash: credentialHash,
            identityHash: identityHash,
            credentialType: credentialType,
            schemaHash: schemaHash,
            issuedAt: block.timestamp,
            expiresAt: block.timestamp + CREDENTIAL_DURATION,
            revoked: false,
            issuer: msg.sender
        });

        identities[identityHash].credentialHashes.push(credentialHash);

        emit CredentialIssued(credentialHash, identityHash);
    }

    function revokeCredential(bytes32 credentialHash) external {
        require(credentials[credentialHash].issuer == msg.sender || msg.sender == owner(), "Not authorized");

        credentials[credentialHash].revoked = true;

        emit CredentialRevoked(credentialHash);
    }

    function verifyCredential(bytes32 credentialHash) external view returns (bool) {
        Credential memory cred = credentials[credentialHash];
        return cred.issuer != address(0) && !cred.revoked && cred.expiresAt > block.timestamp;
    }

    // ============ Zero-Knowledge Verification ============

    function requestVerification(
        bytes32 identityHash,
        bytes32 credentialHash,
        bytes calldata proofData
    ) external whenNotPaused {
        require(identities[identityHash].isActive, "Identity not active");
        require(verifyCredential(credentialHash), "Credential invalid");
        require(credentials[credentialHash].identityHash == identityHash, "Credential mismatch");

        // Verify ZK proof
        bool verified = _verifyZKProof(proofData, identityHash, credentialHash);

        requestCounter++;
        bytes32 requestId = keccak256(abi.encodePacked(block.timestamp, msg.sender, identityHash));

        verificationRequests[requestId] = VerificationRequest({
            requestId: requestId,
            identityHash: identityHash,
            credentialHash: credentialHash,
            timestamp: block.timestamp,
            verified: verified,
            requester: msg.sender
        });

        emit VerificationRequested(requestId, identityHash);
        emit VerificationCompleted(requestId, verified);
    }

    function _verifyZKProof(bytes memory proofData, bytes32 identityHash, bytes32 credentialHash) internal returns (bool) {
        require(proofData.length > 0, "ZKIdentity: Empty proof");
        require(verifierContract != address(0), "ZKIdentity: Verifier not set");
        uint[] memory input = new uint[](2);
        input[0] = uint(identityHash);
        input[1] = uint(credentialHash);
        return IVerifier(verifierContract).verifyProof(
            [uint(0), uint(0)],
            [[uint(0), uint(0)], [uint(0), uint(0)]],
            [uint(0), uint(0)],
            input
        );
    }

    // ============ Selective Disclosure ============

    function createSelectiveDisclosure(
        bytes32 identityHash,
        bytes32[] memory disclosedAttributes,
        address recipient
    ) external whenNotPaused {
        require(identities[identityHash].owner == msg.sender, "Not owner");
        require(identities[identityHash].isActive, "Identity not active");

        disclosureCounter++;
        bytes32 disclosureId = keccak256(abi.encodePacked(block.timestamp, msg.sender, identityHash));

        selectiveDisclosures[disclosureId] = SelectiveDisclosure({
            disclosureId: disclosureId,
            identityHash: identityHash,
            disclosedAttributes: disclosedAttributes,
            timestamp: block.timestamp,
            active: true,
            recipient: recipient
        });

        emit SelectiveDisclosureCreated(disclosureId, identityHash);
    }

    function revokeSelectiveDisclosure(bytes32 disclosureId) external {
        require(selectiveDisclosures[disclosureId].identityHash != bytes32(0), "Disclosure not found");
        require(selectiveDisclosures[disclosureId].active, "Already revoked");

        selectiveDisclosures[disclosureId].active = false;

        emit SelectiveDisclosureRevoked(disclosureId);
    }

    // ============ View Functions ============

    function getIdentity(bytes32 identityHash) external view returns (Identity memory) {
        return identities[identityHash];
    }

    function getCredential(bytes32 credentialHash) external view returns (Credential memory) {
        return credentials[credentialHash];
    }

    function getVerificationRequest(bytes32 requestId) external view returns (VerificationRequest memory) {
        return verificationRequests[requestId];
    }

    function getSelectiveDisclosure(bytes32 disclosureId) external view returns (SelectiveDisclosure memory) {
        return selectiveDisclosures[disclosureId];
    }

    function getUserIdentities(address user) external view returns (bytes32[] memory) {
        return userIdentities[user];
    }

    function getIdentityCredentials(bytes32 identityHash) external view returns (bytes32[] memory) {
        return identities[identityHash].credentialHashes;
    }

    function isIdentityActive(bytes32 identityHash) external view returns (bool) {
        return identities[identityHash].isActive;
    }

    function isCredentialValid(bytes32 credentialHash) external view returns (bool) {
        return verifyCredential(credentialHash);
    }

    function getTotalIdentities() external view returns (uint256) {
        return identityCounter;
    }

    function getTotalCredentials() external view returns (uint256) {
        return credentialCounter;
    }

    // ============ Admin Functions ============

    function setVerifier(address newVerifier) external onlyOwner {
        verifierContract = newVerifier;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ============ Receive ============

    receive() external payable {}
}