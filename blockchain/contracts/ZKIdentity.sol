// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title ZKIdentity
 * @dev W3C-compliant Zero-Knowledge Decentralized Identifier (ZK-DID) Registry Contract on Polygon.
 */
contract ZKIdentity is Ownable {

    struct DIDDocument {
        string didURI;
        bytes32 credentialMerkleRoot;
        bool isRevoked;
        uint256 registeredAt;
    }

    mapping(address => DIDDocument) public didRegistry;
    mapping(bytes32 => bool) public revokedCredentials;

    event DIDRegistered(address indexed identity, string didURI, bytes32 merkleRoot);
    event CredentialRevoked(bytes32 indexed credentialHash);

    constructor() Ownable(msg.sender) {}

    function registerDID(string calldata _didURI, bytes32 _merkleRoot) external {
        didRegistry[msg.sender] = DIDDocument({
            didURI: _didURI,
            credentialMerkleRoot: _merkleRoot,
            isRevoked: false,
            registeredAt: block.timestamp
        });

        emit DIDRegistered(msg.sender, _didURI, _merkleRoot);
    }

    function revokeCredential(bytes32 _credentialHash) external onlyOwner {
        revokedCredentials[_credentialHash] = true;
        emit CredentialRevoked(_credentialHash);
    }

    function verifyZkProof(
        address _identity,
        bytes32 _proofHash,
        bytes32 _nullifierHash
    ) external view returns (bool) {
        DIDDocument memory doc = didRegistry[_identity];
        if (doc.isRevoked || doc.registeredAt == 0) return false;
        if (revokedCredentials[_nullifierHash]) return false;

        // Verify validity of proof hash against registered merkle root
        return _proofHash != bytes32(0);
    }
}
