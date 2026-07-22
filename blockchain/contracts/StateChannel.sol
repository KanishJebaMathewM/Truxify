// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract StateChannel is Ownable, ReentrancyGuard, Pausable {
    using ECDSA for bytes32;

    // ============ Structs ============

    struct Channel {
        uint256 id;
        address participantA;
        address participantB;
        uint256 balanceA;
        uint256 balanceB;
        uint256 nonce;
        uint256 createdAt;
        uint256 lastUpdated;
        uint256 challengePeriod;
        bool isOpen;
        bool isSettled;
        bytes32 latestStateHash;
    }

    struct State {
        uint256 channelId;
        uint256 balanceA;
        uint256 balanceB;
        uint256 nonce;
        bytes32 stateHash;
        uint256 timestamp;
    }

    struct Dispute {
        uint256 channelId;
        address challenger;
        bytes32 stateHash;
        uint256 startedAt;
        bool resolved;
    }

    // ============ State Variables ============

    mapping(uint256 => Channel) public channels;
    mapping(uint256 => State[]) public channelStates;
    mapping(uint256 => Dispute) public disputes;
    mapping(address => uint256[]) public userChannels;
    mapping(uint256 => mapping(address => uint256)) public pendingWithdrawals;

    uint256 public channelCounter;
    uint256 public constant CHALLENGE_PERIOD = 1 days;
    uint256 public constant SETTLEMENT_PERIOD = 7 days;

    // Events
    event ChannelOpened(uint256 indexed channelId, address indexed participantA, address indexed participantB);
    event ChannelFunded(uint256 indexed channelId, address indexed participant, uint256 amount);
    event StateUpdated(uint256 indexed channelId, uint256 nonce, bytes32 stateHash);
    event ChannelClosed(uint256 indexed channelId, uint256 finalBalanceA, uint256 finalBalanceB);
    event DisputeRaised(uint256 indexed channelId, address indexed challenger);
    event DisputeResolved(uint256 indexed channelId, bool resolved);
    event BatchSettled(uint256 indexed channelId, uint256 count);
    event Withdrawal(uint256 indexed channelId, address indexed participant, uint256 amount);

    // ============ Constructor ============

    constructor() Ownable(msg.sender) {}

    // ============ Channel Management ============

    function openChannel(address participantB) external whenNotPaused returns (uint256) {
        require(participantB != address(0), "Invalid participant");
        require(participantB != msg.sender, "Cannot open channel with self");

        channelCounter++;
        uint256 channelId = channelCounter;

        channels[channelId] = Channel({
            id: channelId,
            participantA: msg.sender,
            participantB: participantB,
            balanceA: 0,
            balanceB: 0,
            nonce: 0,
            createdAt: block.timestamp,
            lastUpdated: block.timestamp,
            challengePeriod: CHALLENGE_PERIOD,
            isOpen: true,
            isSettled: false,
            latestStateHash: bytes32(0)
        });

        userChannels[msg.sender].push(channelId);
        userChannels[participantB].push(channelId);

        emit ChannelOpened(channelId, msg.sender, participantB);
        return channelId;
    }

    function fundChannel(uint256 channelId) external payable whenNotPaused {
        Channel storage channel = channels[channelId];
        require(channel.isOpen, "Channel not open");
        require(!channel.isSettled, "Channel settled");
        require(msg.sender == channel.participantA || msg.sender == channel.participantB, "Not participant");
        require(msg.value > 0, "Amount must be > 0");

        if (msg.sender == channel.participantA) {
            channel.balanceA += msg.value;
        } else {
            channel.balanceB += msg.value;
        }

        channel.lastUpdated = block.timestamp;

        emit ChannelFunded(channelId, msg.sender, msg.value);
    }

    // ============ Off-Chain Transactions ============

    function updateState(
        uint256 channelId,
        uint256 newBalanceA,
        uint256 newBalanceB,
        uint256 nonce,
        bytes memory signatureA,
        bytes memory signatureB
    ) external whenNotPaused {
        Channel storage channel = channels[channelId];
        require(channel.isOpen, "Channel not open");
        require(!channel.isSettled, "Channel settled");
        require(nonce > channel.nonce, "Invalid nonce");

        // Verify total balance
        uint256 totalBalance = channel.balanceA + channel.balanceB;
        require(newBalanceA + newBalanceB == totalBalance, "Invalid balances");

        // Create state hash
        bytes32 stateHash = keccak256(abi.encodePacked(
            channelId,
            newBalanceA,
            newBalanceB,
            nonce
        ));

        // Verify signatures
        require(_verifySignature(stateHash, signatureA, channel.participantA), "Invalid signature A");
        require(_verifySignature(stateHash, signatureB, channel.participantB), "Invalid signature B");

        // Update channel
        channel.balanceA = newBalanceA;
        channel.balanceB = newBalanceB;
        channel.nonce = nonce;
        channel.latestStateHash = stateHash;
        channel.lastUpdated = block.timestamp;

        // Store state
        channelStates[channelId].push(State({
            channelId: channelId,
            balanceA: newBalanceA,
            balanceB: newBalanceB,
            nonce: nonce,
            stateHash: stateHash,
            timestamp: block.timestamp
        }));

        emit StateUpdated(channelId, nonce, stateHash);
    }

    function _verifySignature(
        bytes32 hash,
        bytes memory signature,
        address signer
    ) internal pure returns (bool) {
        bytes32 prefixedHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash));
        address recovered = prefixedHash.recover(signature);
        return recovered == signer;
    }

    // ============ Channel Closure ============

    function closeChannel(uint256 channelId) external whenNotPaused {
        Channel storage channel = channels[channelId];
        require(channel.isOpen, "Channel not open");
        require(!channel.isSettled, "Channel settled");
        require(msg.sender == channel.participantA || msg.sender == channel.participantB, "Not participant");

        channel.isOpen = false;
        channel.lastUpdated = block.timestamp;

        // Capture final balances before settlement
        uint256 finalBalanceA = channel.balanceA;
        uint256 finalBalanceB = channel.balanceB;

        // Emit event before zeroing balances
        emit ChannelClosed(channelId, finalBalanceA, finalBalanceB);

        // Settle balances
        _settleChannel(channelId);
    }

    function _settleChannel(uint256 channelId) internal {
        Channel storage channel = channels[channelId];
        require(!channel.isSettled, "Already settled");

        if (channel.balanceA > 0) {
            pendingWithdrawals[channelId][channel.participantA] += channel.balanceA;
        }
        if (channel.balanceB > 0) {
            pendingWithdrawals[channelId][channel.participantB] += channel.balanceB;
        }

        channel.isSettled = true;
        channel.balanceA = 0;
        channel.balanceB = 0;
    }

    function withdraw(uint256 channelId) external nonReentrant {
        uint256 amount = pendingWithdrawals[channelId][msg.sender];
        require(amount > 0, "Nothing to withdraw");
        pendingWithdrawals[channelId][msg.sender] = 0;
        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "Withdraw failed");
        emit Withdrawal(channelId, msg.sender, amount);
    }

    // ============ Dispute Resolution ============

    function raiseDispute(uint256 channelId, bytes32 stateHash) external whenNotPaused {
        Channel storage channel = channels[channelId];
        require(channel.isOpen, "Channel not open");
        require(!channel.isSettled, "Channel settled");
        require(msg.sender == channel.participantA || msg.sender == channel.participantB, "Not participant");
        require(disputes[channelId].challenger == address(0), "Dispute already raised");

        disputes[channelId] = Dispute({
            channelId: channelId,
            challenger: msg.sender,
            stateHash: stateHash,
            startedAt: block.timestamp,
            resolved: false
        });

        // Freeze channel
        channel.isOpen = false;

        emit DisputeRaised(channelId, msg.sender);
    }

    function resolveDispute(uint256 channelId, bytes memory proof) external onlyOwner {
        Dispute storage dispute = disputes[channelId];
        require(dispute.challenger != address(0), "No dispute");
        require(!dispute.resolved, "Already resolved");

        // Verify proof and resolve
        // In production: verify state proof
        dispute.resolved = true;

        // Reopen channel with disputed state
        Channel storage channel = channels[channelId];
        channel.isOpen = true;

        emit DisputeResolved(channelId, true);
    }

    // ============ Batch Settlement ============

    function batchSettle(uint256[] calldata channelIds) external onlyOwner {
        uint256 count = 0;
        for (uint256 i = 0; i < channelIds.length; i++) {
            if (channels[channelIds[i]].isOpen && !channels[channelIds[i]].isSettled) {
                _settleChannel(channelIds[i]);
                count++;
            }
        }

        emit BatchSettled(block.timestamp, count);
    }

    // ============ View Functions ============

    function getChannel(uint256 channelId) external view returns (Channel memory) {
        return channels[channelId];
    }

    function getChannelStates(uint256 channelId) external view returns (State[] memory) {
        return channelStates[channelId];
    }

    function getUserChannels(address user) external view returns (uint256[] memory) {
        return userChannels[user];
    }

    function getChannelBalance(uint256 channelId, address participant) external view returns (uint256) {
        Channel storage channel = channels[channelId];
        if (participant == channel.participantA) {
            return channel.balanceA;
        } else if (participant == channel.participantB) {
            return channel.balanceB;
        }
        return 0;
    }

    function isChannelActive(uint256 channelId) external view returns (bool) {
        return channels[channelId].isOpen && !channels[channelId].isSettled;
    }

    function getDispute(uint256 channelId) external view returns (Dispute memory) {
        return disputes[channelId];
    }

    // ============ Emergency Functions ============

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ============ Receive ============

    receive() external payable {}
}