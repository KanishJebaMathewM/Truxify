// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";

contract IdentityWallet is Ownable {
    // Wallet structure
    struct Wallet {
        address owner;
        string did;
        bytes32[] credentials;
        bool isActive;
        uint256 createdAt;
        uint256 updatedAt;
    }

    // Mapping
    mapping(address => Wallet) public wallets;
    mapping(address => bool) public hasWallet;
    mapping(bytes32 => bool) public credentialInWallet;
    
    uint256 public totalWallets;

    // Events
    event WalletCreated(address indexed owner, string did);
    event CredentialAdded(address indexed owner, bytes32 credentialId);
    event CredentialRemoved(address indexed owner, bytes32 credentialId);

    constructor() Ownable(msg.sender) {}

    function createWallet(string memory did) external {
        require(!hasWallet[msg.sender], "Wallet already exists");
        require(bytes(did).length > 0, "DID cannot be empty");

        wallets[msg.sender] = Wallet({
            owner: msg.sender,
            did: did,
            credentials: new bytes32[](0),
            isActive: true,
            createdAt: block.timestamp,
            updatedAt: block.timestamp
        });

        hasWallet[msg.sender] = true;
        totalWallets++;

        emit WalletCreated(msg.sender, did);
    }

    function addCredential(bytes32 credentialId) external {
        require(hasWallet[msg.sender], "Wallet not found");
        require(!credentialInWallet[credentialId], "Credential already in wallet");

        wallets[msg.sender].credentials.push(credentialId);
        credentialInWallet[credentialId] = true;
        wallets[msg.sender].updatedAt = block.timestamp;

        emit CredentialAdded(msg.sender, credentialId);
    }

    function removeCredential(bytes32 credentialId) external {
        require(hasWallet[msg.sender], "Wallet not found");
        require(credentialInWallet[credentialId], "Credential not in wallet");

        Wallet storage wallet = wallets[msg.sender];
        for (uint256 i = 0; i < wallet.credentials.length; i++) {
            if (wallet.credentials[i] == credentialId) {
                wallet.credentials[i] = wallet.credentials[wallet.credentials.length - 1];
                wallet.credentials.pop();
                break;
            }
        }

        credentialInWallet[credentialId] = false;
        wallet.updatedAt = block.timestamp;

        emit CredentialRemoved(msg.sender, credentialId);
    }

    function getWallet(address owner) external view returns (
        address walletOwner,
        string memory did,
        bytes32[] memory credentials,
        bool isActive,
        uint256 createdAt,
        uint256 updatedAt
    ) {
        Wallet memory wallet = wallets[owner];
        return (
            wallet.owner,
            wallet.did,
            wallet.credentials,
            wallet.isActive,
            wallet.createdAt,
            wallet.updatedAt
        );
    }

    function getCredentials(address owner) external view returns (bytes32[] memory) {
        return wallets[owner].credentials;
    }

    function hasCredential(address owner, bytes32 credentialId) external view returns (bool) {
        return credentialInWallet[credentialId];
    }

    function isWalletActive(address owner) external view returns (bool) {
        return hasWallet[owner] && wallets[owner].isActive;
    }
}