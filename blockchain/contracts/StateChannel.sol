// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract StateChannel is Ownable, ReentrancyGuard {
    using MessageHashUtils for bytes32;
    using ECDSA for bytes32;

    struct Channel {
        address participantA;
        address participantB;
        uint256 balanceA;
        uint256 balanceB;
        uint256 nonce;
        bool isOpen;
    }

    mapping(bytes32 => Channel) public channels;

    event ChannelOpened(bytes32 indexed channelId, address participantA, address participantB);
    event ChannelClosed(bytes32 indexed channelId, uint256 balanceA, uint256 balanceB);

    constructor() Ownable(msg.sender) {}

    function openChannel(bytes32 channelId, address participantB) external payable nonReentrant {
        require(channels[channelId].participantA == address(0), "Channel already exists");
        require(participantB != address(address(0)), "Invalid participant");

        channels[channelId] = Channel({
            participantA: msg.sender,
            participantB: participantB,
            balanceA: msg.value,
            balanceB: 0,
            nonce: 0,
            isOpen: true
        });

        emit ChannelOpened(channelId, msg.sender, participantB);
    }

    function closeChannel(
        bytes32 channelId,
        uint256 nonce,
        uint256 balanceA,
        uint256 balanceB,
        bytes memory signatureA,
        bytes memory signatureB
    ) external nonReentrant {
        Channel storage channel = channels[channelId];
        require(channel.isOpen, "Channel is closed");
        require(nonce > channel.nonce, "Stale nonce");
        require(balanceA + balanceB == channel.balanceA + channel.balanceB, "Invalid total balance");

        bytes32 message = keccak256(abi.encodePacked(channelId, nonce, balanceA, balanceB)).toEthSignedMessageHash();

        address signerA = message.recover(signatureA);
        address signerB = message.recover(signatureB);

        require(signerA == channel.participantA && signerB == channel.participantB, "Invalid signatures");

        channel.isOpen = false;
        channel.nonce = nonce;

        (bool successA, ) = channel.participantA.call{value: balanceA}("");
        require(successA, "Transfer to A failed");

        (bool successB, ) = channel.participantB.call{value: balanceB}("");
        require(successB, "Transfer to B failed");

        emit ChannelClosed(channelId, balanceA, balanceB);
    }
}