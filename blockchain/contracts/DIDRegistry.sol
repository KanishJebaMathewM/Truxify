// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

contract DIDRegistry is Ownable, Pausable {
    // DID Document
    struct DIDDocument {
        address owner;
        string did;
        bytes32[] serviceEndpoints;
        bytes32[] verificationMethods;
        uint256 createdAt;
        uint256 updatedAt;
        bool isActive;
    }

    // Service Endpoint
    struct ServiceEndpoint {
        string id;
        string type;
        string serviceEndpoint;
        string description;
    }

    // Verification Method
    struct VerificationMethod {
        string id;
        string type;
        string controller;
        string publicKeyMultibase;
    }

    // Credential
    struct Credential {
        bytes32 id;
        address issuer;
        address subject;
        string credentialType;
        bytes32 schemaHash;
        uint256 issuedAt;
        uint256 validUntil;
        bool revoked;
        bytes32 proofHash;
    }

    // State variables
    mapping(string => DIDDocument) public dids;
    mapping(string => ServiceEndpoint[]) public didServiceEndpoints;
    mapping(string => VerificationMethod[]) public didVerificationMethods;
    mapping(bytes32 => Credential) public credentials;
    mapping(address => string[]) public addressToDIDs;
    mapping(bytes32 => bool) public credentialRevoked;

    uint256 public totalDIDs;
    uint256 public totalCredentials;

    // Events
    event DIDCreated(string indexed did, address owner);
    event DIDUpdated(string indexed did);
    event DIDDeactivated(string indexed did);
    event ServiceEndpointAdded(string indexed did, string id);
    event VerificationMethodAdded(string indexed did, string id);
    event CredentialIssued(bytes32 indexed credentialId, address issuer, address subject);
    event CredentialRevoked(bytes32 indexed credentialId);
    event CredentialVerified(bytes32 indexed credentialId, bool isValid);

    constructor() Ownable(msg.sender) {}

    // ============ DID Management ============

    function createDID(string memory did) external {
        require(bytes(did).length > 0, "DID cannot be empty");
        require(dids[did].owner == address(0), "DID already exists");
        require(dids[did].did == "", "DID already exists");

        dids[did] = DIDDocument({
            owner: msg.sender,
            did: did,
            serviceEndpoints: new bytes32[](0),
            verificationMethods: new bytes32[](0),
            createdAt: block.timestamp,
            updatedAt: block.timestamp,
            isActive: true
        });

        addressToDIDs[msg.sender].push(did);
        totalDIDs++;

        emit DIDCreated(did, msg.sender);
    }

    function updateDID(string memory did, bytes32[] memory newServiceEndpoints) external {
        require(bytes(did).length > 0, "DID cannot be empty");
        require(dids[did].owner == msg.sender, "Not owner");
        require(dids[did].isActive, "DID is not active");

        dids[did].serviceEndpoints = newServiceEndpoints;
        dids[did].updatedAt = block.timestamp;

        emit DIDUpdated(did);
    }

    function deactivateDID(string memory did) external {
        require(bytes(did).length > 0, "DID cannot be empty");
        require(dids[did].owner == msg.sender, "Not owner");
        require(dids[did].isActive, "DID already deactivated");

        dids[did].isActive = false;
        dids[did].updatedAt = block.timestamp;

        emit DIDDeactivated(did);
    }

    // ============ Service Endpoints ============

    function addServiceEndpoint(
        string memory did,
        string memory id,
        string memory type,
        string memory serviceEndpoint,
        string memory description
    ) external {
        require(bytes(did).length > 0, "DID cannot be empty");
        require(dids[did].owner == msg.sender, "Not owner");
        require(dids[did].isActive, "DID is not active");

        didServiceEndpoints[did].push(ServiceEndpoint({
            id: id,
            type: type,
            serviceEndpoint: serviceEndpoint,
            description: description
        }));

        emit ServiceEndpointAdded(did, id);
    }

    // ============ Verification Methods ============

    function addVerificationMethod(
        string memory did,
        string memory id,
        string memory type,
        string memory controller,
        string memory publicKeyMultibase
    ) external {
        require(bytes(did).length > 0, "DID cannot be empty");
        require(dids[did].owner == msg.sender, "Not owner");
        require(dids[did].isActive, "DID is not active");

        didVerificationMethods[did].push(VerificationMethod({
            id: id,
            type: type,
            controller: controller,
            publicKeyMultibase: publicKeyMultibase
        }));

        emit VerificationMethodAdded(did, id);
    }

    // ============ Verifiable Credentials ============

    function issueCredential(
        address subject,
        string memory credentialType,
        bytes32 schemaHash,
        uint256 validUntil,
        bytes32 proofHash
    ) external returns (bytes32) {
        require(subject != address(0), "Invalid subject");

        bytes32 credentialId = keccak256(
            abi.encodePacked(
                block.timestamp,
                msg.sender,
                subject,
                credentialType
            )
        );

        credentials[credentialId] = Credential({
            id: credentialId,
            issuer: msg.sender,
            subject: subject,
            credentialType: credentialType,
            schemaHash: schemaHash,
            issuedAt: block.timestamp,
            validUntil: validUntil,
            revoked: false,
            proofHash: proofHash
        });

        totalCredentials++;
        emit CredentialIssued(credentialId, msg.sender, subject);

        return credentialId;
    }

    function revokeCredential(bytes32 credentialId) external {
        require(credentials[credentialId].issuer == msg.sender, "Not issuer");
        require(!credentials[credentialId].revoked, "Already revoked");

        credentials[credentialId].revoked = true;
        credentialRevoked[credentialId] = true;

        emit CredentialRevoked(credentialId);
    }

    function verifyCredential(bytes32 credentialId) external view returns (bool) {
        Credential memory cred = credentials[credentialId];
        
        bool isValid = (
            cred.issuer != address(0) &&
            !cred.revoked &&
            cred.validUntil > block.timestamp
        );

        return isValid;
    }

    // ============ View Functions ============

    function getDID(string memory did) external view returns (
        address owner,
        string memory didString,
        bool isActive,
        uint256 createdAt,
        uint256 updatedAt
    ) {
        DIDDocument memory doc = dids[did];
        return (
            doc.owner,
            doc.did,
            doc.isActive,
            doc.createdAt,
            doc.updatedAt
        );
    }

    function getServiceEndpoints(string memory did) external view returns (ServiceEndpoint[] memory) {
        return didServiceEndpoints[did];
    }

    function getVerificationMethods(string memory did) external view returns (VerificationMethod[] memory) {
        return didVerificationMethods[did];
    }

    function getCredential(bytes32 credentialId) external view returns (Credential memory) {
        return credentials[credentialId];
    }

    function getDIDsByOwner(address owner) external view returns (string[] memory) {
        return addressToDIDs[owner];
    }

    function isDIDActive(string memory did) external view returns (bool) {
        return dids[did].isActive;
    }

    function getDIDCount() external view returns (uint256) {
        return totalDIDs;
    }

    function getCredentialCount() external view returns (uint256) {
        return totalCredentials;
    }
}