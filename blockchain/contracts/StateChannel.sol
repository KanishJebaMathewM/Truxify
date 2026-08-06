// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * @title StateChannel
 * @dev Off-chain state channel dispute settlement and unilateral exit contract for Truxify freight micro-payments.
 */
contract StateChannel is ReentrancyGuard {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    struct Channel {
        address userA;
        address userB;
        uint256 balanceA;
        uint256 balanceB;
        uint256 sequence;
        uint256 challengeExpiry;
        bool isDisputed;
        bool isClosed;
    }

    mapping(bytes32 => Channel) public channels;
    uint256 public constant CHALLENGE_PERIOD = 1 days;

    event ChannelOpened(bytes32 indexed channelId, address indexed userA, address indexed userB, uint256 deposit);
    event DisputeInitiated(bytes32 indexed channelId, uint256 sequence, uint256 challengeExpiry);
    event ChannelClosed(bytes32 indexed channelId, uint256 finalBalanceA, uint256 finalBalanceB);

    function openChannel(address userB) external payable returns (bytes32 channelId) {
        require(msg.value > 0, "Deposit required");
        require(userB != address(0), "Invalid user B");

        channelId = keccak256(abi.encodePacked(msg.sender, userB, block.timestamp));
        channels[channelId] = Channel({
            userA: msg.sender,
            userB: userB,
            balanceA: msg.value,
            balanceB: 0,
            sequence: 0,
            challengeExpiry: 0,
            isDisputed: false,
            isClosed: false
        });

        emit ChannelOpened(channelId, msg.sender, userB, msg.value);
    }

    function initiateUnilateralExit(
        bytes32 channelId,
        uint256 sequence,
        uint256 balanceA,
        uint256 balanceB,
        bytes memory sigA,
        bytes memory sigB
    ) external nonReentrant {
        Channel storage channel = channels[channelId];
        require(!channel.isClosed, "Channel closed");
        require(sequence > channel.sequence, "Stale sequence");

        bytes32 stateHash = keccak256(abi.encodePacked(channelId, sequence, balanceA, balanceB)).toEthSignedMessageHash();
        require(stateHash.recover(sigA) == channel.userA, "Invalid sig A");
        require(stateHash.recover(sigB) == channel.userB, "Invalid sig B");

        channel.sequence = sequence;
        channel.balanceA = balanceA;
        channel.balanceB = balanceB;
        channel.isDisputed = true;
        channel.challengeExpiry = block.timestamp + CHALLENGE_PERIOD;

        emit DisputeInitiated(channelId, sequence, channel.challengeExpiry);
    }

    function finalizeExit(bytes32 channelId) external nonReentrant {
        Channel storage channel = channels[channelId];
        require(channel.isDisputed, "No active dispute");
        require(block.timestamp >= channel.challengeExpiry, "Challenge period active");
        require(!channel.isClosed, "Already closed");

        channel.isClosed = true;

        uint256 amountA = channel.balanceA;
        uint256 amountB = channel.balanceB;

        (bool sentA, ) = channel.userA.call{value: amountA}("");
        require(sentA, "Transfer A failed");

        (bool sentB, ) = channel.userB.call{value: amountB}("");
        require(sentB, "Transfer B failed");

        emit ChannelClosed(channelId, amountA, amountB);
    }
}