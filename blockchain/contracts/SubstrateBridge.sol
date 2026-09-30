// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract SubstrateBridge is Ownable, ReentrancyGuard {
    using MessageHashUtils for bytes32;
    using ECDSA for bytes32;

    mapping(bytes32 => bool) public processedTransactions;

    event TransferRelayed(bytes32 indexed txId, address indexed recipient, uint256 amount);

    constructor() Ownable(msg.sender) {}

    function relayTransfer(
        bytes32 txId,
        address recipient,
        uint256 amount,
        bytes memory signature
    ) external nonReentrant {
        require(!processedTransactions[txId], "Transaction already processed");
        
        bytes32 message = keccak256(abi.encodePacked(txId, recipient, amount)).toEthSignedMessageHash();
        address signer = message.recover(signature);
        
        require(signer == owner(), "Invalid validator signature");

        processedTransactions[txId] = true;

        (bool success, ) = recipient.call{value: amount}("");
        require(success, "Transfer failed");

        emit TransferRelayed(txId, recipient, amount);
    }

    receive() external payable {}
}