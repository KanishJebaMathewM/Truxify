// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract IdentityWallet is Ownable {
    using MessageHashUtils for bytes32;
    using ECDSA for bytes32;

    mapping(address => bool) public authorizedIdentities;
    mapping(address => string) public identityMetadata;

    event IdentityRegistered(address indexed identity, string metadata);
    event IdentityRevoked(address indexed identity);

    constructor() Ownable(msg.sender) {
        authorizedIdentities[msg.sender] = true;
    }

    function registerIdentity(address identity, string calldata metadata) external onlyOwner {
        authorizedIdentities[identity] = true;
        identityMetadata[identity] = metadata;
        emit IdentityRegistered(identity, metadata);
    }

    function revokeIdentity(address identity) external onlyOwner {
        authorizedIdentities[identity] = false;
        emit IdentityRevoked(identity);
    }

    function verifySignature(bytes32 messageHash, bytes memory signature, address expectedSigner) public pure returns (bool) {
        bytes32 ethSignedMessageHash = messageHash.toEthSignedMessageHash();
        return ethSignedMessageHash.recover(signature) == expectedSigner;
    }
}