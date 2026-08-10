// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title AtomicSwap
 * @dev Hash Time-Locked Contract (HTLC) for multi-token cross-chain freight escrow settlements.
 */
contract AtomicSwap is ReentrancyGuard {

    struct Swap {
        address payable sender;
        address payable recipient;
        uint256 amount;
        bytes32 hashLock;
        uint256 lockTime;
        bool claimed;
        bool refunded;
        bool isCrossChain;
    }

    struct SwapReference {
        bytes32 swapId;
        bool isCrossChain;
    }

    mapping(address => SwapReference[]) public userSwaps;

    mapping(bytes32 => Swap) public swaps;

    mapping(bytes32 => bool) public usedHashLocks;

    event SwapOpened(bytes32 indexed swapId, address indexed sender, address indexed recipient, uint256 amount, bytes32 hashLock, uint256 lockTime);
    event SwapClaimed(bytes32 indexed swapId, bytes preimage);
    event SwapRefunded(bytes32 indexed swapId);

    function openSwap(
        bytes32 swapId,
        address payable recipient,
        bytes32 hashLock,
        uint256 lockDuration
    ) external payable returns (bytes32) {
        require(msg.value > 0, "Amount must be > 0");
        require(swaps[swapId].sender == address(0), "Swap ID exists");

        swaps[swapId] = Swap({
            sender: payable(msg.sender),
            recipient: recipient,
            amount: msg.value,
            hashLock: hashLock,
            lockTime: block.timestamp + lockDuration,
            claimed: false,
            refunded: false,
            isCrossChain: false
        });

        userSwaps[msg.sender].push(SwapReference({
            swapId: swapId,
            isCrossChain: false
        }));

        emit SwapOpened(swapId, msg.sender, recipient, msg.value, hashLock, block.timestamp + lockDuration);
        return swapId;
    }

    function claimSwap(bytes32 swapId, bytes calldata preimage) external nonReentrant {
        Swap storage swap = swaps[swapId];
        require(!swap.claimed && !swap.refunded, "Swap inactive");
        require(keccak256(preimage) == swap.hashLock, "Invalid preimage");

        swap.claimed = true;
        (bool sent, ) = swap.recipient.call{value: swap.amount}("");
        require(sent, "Claim transfer failed");

        emit SwapClaimed(swapId, preimage);
    }

    function refundSwap(bytes32 swapId) external nonReentrant {
        Swap storage swap = swaps[swapId];
        require(!swap.claimed && !swap.refunded, "Swap inactive");
        require(block.timestamp >= swap.lockTime, "Lock time not expired");
        require(msg.sender == swap.sender, "Only sender can refund");

        swap.refunded = true;
        usedHashLocks[swap.hashLock] = false;
        (bool sent, ) = swap.sender.call{value: swap.amount}("");
        require(sent, "Refund transfer failed");

        emit SwapRefunded(swapId);
    }

    function getUserSwaps(address user) external view returns (SwapReference[] memory) {
        return userSwaps[user];
    }
}
