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

    constructor() Ownable(msg.sender) {}

    function registerDocument(
        address driver,
        string memory documentType,
        bytes32 docHash,
        bool isVerified
    ) external onlyOwner {
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
