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
    mapping(address => uint256) public pendingWithdrawals;
    uint256 public channelCounter;
    uint256 public constant CHALLENGE_PERIOD = 1 days;

    event ChannelOpened(bytes32 indexed channelId, address indexed userA, address indexed userB, uint256 deposit);
    event DisputeInitiated(bytes32 indexed channelId, uint256 sequence, uint256 challengeExpiry);
    event ChannelClosed(bytes32 indexed channelId, uint256 finalBalanceA, uint256 finalBalanceB);
    event WithdrawalCredited(address indexed recipient, uint256 amount);
    event Withdrawn(address indexed recipient, uint256 amount);

    function openChannel(address userB) external payable returns (bytes32 channelId) {
        require(msg.value > 0, "Deposit required");
        require(userB != address(0), "Invalid user B");

        channelCounter++;
        channelId = keccak256(abi.encodePacked(msg.sender, userB, block.timestamp, channelCounter));
        require(channels[channelId].userA == address(0), "Channel exists");
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
        bytes memory sig
    ) external nonReentrant {
        Channel storage channel = channels[channelId];
        require(!channel.isClosed, "Channel closed");
        require(msg.sender == channel.userA || msg.sender == channel.userB, "Not participant");

        // Prevent indefinite challenge extension griefing: subsequent challenges
        // must present a strictly higher sequence number.
        if (channel.isDisputed) {
            require(sequence > channel.sequence, "Stale sequence");
        } else {
            require(sequence >= channel.sequence, "Stale sequence");
        }

        require(balanceA + balanceB == channel.balanceA + channel.balanceB, "Invalid balance sum");

        bytes32 stateHash = keccak256(abi.encodePacked(block.chainid, address(this), channelId, sequence, balanceA, balanceB)).toEthSignedMessageHash();
        
        if (msg.sender == channel.userA) {
            require(stateHash.recover(sig) == channel.userB, "Invalid signature from userB");
        } else {
            require(stateHash.recover(sig) == channel.userA, "Invalid signature from userA");
        }

        channel.sequence = sequence;
        channel.balanceA = balanceA;
        channel.balanceB = balanceB;
        channel.isDisputed = true;
        channel.challengeExpiry = block.timestamp + CHALLENGE_PERIOD;

        emit DisputeInitiated(channelId, sequence, channel.challengeExpiry);
    }

    function cooperativeClose(
        bytes32 channelId,
        uint256 balanceA,
        uint256 balanceB,
        bytes memory sigA,
        bytes memory sigB
    ) external nonReentrant {
        Channel storage channel = channels[channelId];
        require(!channel.isClosed, "Channel already closed");
        require(balanceA + balanceB == channel.balanceA + channel.balanceB, "Invalid balance sum");

        bytes32 stateHash = keccak256(abi.encodePacked(block.chainid, address(this), channelId, channel.sequence + 1, balanceA, balanceB)).toEthSignedMessageHash();
        require(stateHash.recover(sigA) == channel.userA, "Invalid sig A");
        require(stateHash.recover(sigB) == channel.userB, "Invalid sig B");

        channel.isClosed = true;

        _safeTransferOrCredit(channel.userA, balanceA);
        _safeTransferOrCredit(channel.userB, balanceB);

        emit ChannelClosed(channelId, balanceA, balanceB);
    }

    function finalizeExit(bytes32 channelId) external nonReentrant {
        Channel storage channel = channels[channelId];
        require(channel.isDisputed, "No active dispute");
        require(block.timestamp >= channel.challengeExpiry, "Challenge period active");
        require(!channel.isClosed, "Already closed");

        uint256 amountA = channel.balanceA;
        uint256 amountB = channel.balanceB;

        channel.isClosed = true;

        _safeTransferOrCredit(channel.userA, amountA);
        _safeTransferOrCredit(channel.userB, amountB);

        emit ChannelClosed(channelId, amountA, amountB);
    }

    /**
     * @dev Attempts direct push transfer, falling back to pull-based credit if the
     *      recipient reverts or runs out of gas. This prevents Denial-of-Service
     *      attacks where a malicious counterparty traps funds.
     */
    function _safeTransferOrCredit(address recipient, uint256 amount) internal {
        if (amount == 0) return;
        (bool sent, ) = recipient.call{value: amount}("");
        if (!sent) {
            pendingWithdrawals[recipient] += amount;
            emit WithdrawalCredited(recipient, amount);
        }
    }

    /**
     * @dev Allows participants to pull funds that could not be transferred directly.
     */
    function withdraw() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount > 0, "No pending withdrawal");
        pendingWithdrawals[msg.sender] = 0;

        (bool sent, ) = msg.sender.call{value: amount}("");
        require(sent, "Withdrawal transfer failed");

        emit Withdrawn(msg.sender, amount);
    }
}