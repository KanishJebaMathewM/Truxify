// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";

contract DocumentRegistry is Ownable {
    struct Document {
        bytes32 hash;
        string documentType;
        uint256 registeredAt;
        bool isVerified;
    }

    // Mapping from driver address => document type => Document details
    mapping(address => mapping(string => Document)) public registry;

    event DocumentRegistered(address indexed driver, string documentType, bytes32 docHash, bool isVerified);
    event DocumentRevoked(address indexed driver, string documentType, bytes32 docHash);

    constructor() Ownable(msg.sender) {}

    function registerDocument(
        address driver,
        string memory documentType,
        bytes32 docHash,
        bool isVerified
    ) external onlyOwner {
        require(docHash != bytes32(0), "DocumentRegistry: Invalid zero hash");
        require(driver != address(0), "DocumentRegistry: Invalid driver address");

        Document storage prev = registry[driver][documentType];
        if (prev.hash != bytes32(0)) {
            emit DocumentRevoked(driver, documentType, prev.hash);
        }

        registry[driver][documentType] = Document({
            hash: docHash,
            documentType: documentType,
            registeredAt: block.timestamp,
            isVerified: isVerified
        });

        emit DocumentRegistered(driver, documentType, docHash, isVerified);
    }

    function getDocument(
        address driver,
        string memory documentType
    ) external view returns (bytes32, string memory, uint256, bool) {
        Document memory doc = registry[driver][documentType];
        return (doc.hash, doc.documentType, doc.registeredAt, doc.isVerified);
    }
}