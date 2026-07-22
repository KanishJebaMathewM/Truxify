// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract AtomicSwap is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;

    // ============ Structs ============

    struct Swap {
        uint256 id;
        address initiator;
        address counterparty;
        address tokenAddress;
        uint256 amount;
        bytes32 hashLock;
        uint256 timelock;
        bool executed;
        bool refunded;
        uint256 createdAt;
        bytes32 secret;
    }

    struct CrossChainSwap {
        uint256 id;
        uint256 sourceChainId;
        uint256 destChainId;
        address initiator;
        address counterparty;
        address tokenAddress;
        uint256 amount;
        bytes32 hashLock;
        uint256 timelock;
        bool executed;
        bool refunded;
        bytes32 secret;
        bytes32 proof;
    }

    // ============ State Variables ============

    mapping(uint256 => Swap) public swaps;
    mapping(uint256 => CrossChainSwap) public crossChainSwaps;
    mapping(bytes32 => bool) public usedHashLocks;
    mapping(address => uint256[]) public userSwaps;

    uint256 public swapCounter;
    uint256 public crossChainSwapCounter;
    uint256 public constant SWAP_TIMELOCK = 24 hours;
    uint256 public constant MIN_SWAP_AMOUNT = 0.001 ether;

    // Events
    event SwapCreated(uint256 indexed swapId, address indexed initiator, address indexed counterparty, uint256 amount);
    event SwapExecuted(uint256 indexed swapId, address indexed executor, bytes32 secret);
    event SwapRefunded(uint256 indexed swapId, address indexed refundee);
    event CrossChainSwapCreated(uint256 indexed swapId, uint256 sourceChain, uint256 destChain);
    event CrossChainSwapExecuted(uint256 indexed swapId, bytes32 secret);
    event CrossChainSwapRefunded(uint256 indexed swapId);

    // ============ Constructor ============

    constructor() Ownable(msg.sender) {}

    // ============ Swap Functions ============

    function createSwap(
        address counterparty,
        address tokenAddress,
        uint256 amount,
        bytes32 hashLock
    ) external payable nonReentrant whenNotPaused returns (uint256) {
        require(counterparty != address(0), "Invalid counterparty");
        require(counterparty != msg.sender, "Cannot swap with self");
        require(amount >= MIN_SWAP_AMOUNT, "Amount too small");
        require(!usedHashLocks[hashLock], "Hash lock already used");
        require(amount > 0, "Amount must be > 0");

        swapCounter++;
        uint256 swapId = swapCounter;

        // Handle payment
        if (tokenAddress == address(0)) {
            // Native token (ETH/MATIC)
            require(msg.value == amount, "Incorrect native token amount");
        } else {
            // ERC20 token
            IERC20(tokenAddress).safeTransferFrom(msg.sender, address(this), amount);
        }

        swaps[swapId] = Swap({
            id: swapId,
            initiator: msg.sender,
            counterparty: counterparty,
            tokenAddress: tokenAddress,
            amount: amount,
            hashLock: hashLock,
            timelock: block.timestamp + SWAP_TIMELOCK,
            executed: false,
            refunded: false,
            createdAt: block.timestamp,
            secret: bytes32(0)
        });

        usedHashLocks[hashLock] = true;
        userSwaps[msg.sender].push(swapId);

        emit SwapCreated(swapId, msg.sender, counterparty, amount);
        return swapId;
    }

    function executeSwap(uint256 swapId, bytes32 secret) external nonReentrant whenNotPaused {
        Swap storage swap = swaps[swapId];
        require(swap.initiator != address(0), "Swap not found");
        require(!swap.executed, "Already executed");
        require(!swap.refunded, "Already refunded");
        require(block.timestamp <= swap.timelock, "Swap expired");
        require(keccak256(abi.encodePacked(secret)) == swap.hashLock, "Invalid secret");

        swap.executed = true;
        swap.secret = secret;

        // Transfer tokens
        if (swap.tokenAddress == address(0)) {
            (bool sentToCounterparty, ) = payable(swap.counterparty).call{value: swap.amount}("");
            require(sentToCounterparty, "Swap transfer failed");
        } else {
            IERC20(swap.tokenAddress).safeTransfer(swap.counterparty, swap.amount);
        }

        emit SwapExecuted(swapId, msg.sender, secret);
    }

    function refundSwap(uint256 swapId) external nonReentrant whenNotPaused {
        Swap storage swap = swaps[swapId];
        require(swap.initiator != address(0), "Swap not found");
        require(!swap.executed, "Already executed");
        require(!swap.refunded, "Already refunded");
        require(block.timestamp > swap.timelock, "Timelock not expired");
        require(msg.sender == swap.initiator, "Only initiator can refund");

        swap.refunded = true;

        // Refund tokens
        if (swap.tokenAddress == address(0)) {
            (bool sentToInitiator, ) = payable(swap.initiator).call{value: swap.amount}("");
            require(sentToInitiator, "Swap refund failed");
        } else {
            IERC20(swap.tokenAddress).safeTransfer(swap.initiator, swap.amount);
        }

        emit SwapRefunded(swapId, msg.sender);
    }

    // ============ Cross-Chain Swap Functions ============

    function createCrossChainSwap(
        uint256 destChainId,
        address counterparty,
        address tokenAddress,
        uint256 amount,
        bytes32 hashLock,
        bytes32 proof
    ) external payable nonReentrant whenNotPaused returns (uint256) {
        require(destChainId != block.chainid, "Cannot swap on same chain");
        require(counterparty != address(0), "Invalid counterparty");
        require(amount >= MIN_SWAP_AMOUNT, "Amount too small");
        require(!usedHashLocks[hashLock], "Hash lock already used");

        crossChainSwapCounter++;
        uint256 swapId = crossChainSwapCounter;

        // Handle payment
        if (tokenAddress == address(0)) {
            require(msg.value == amount, "Incorrect native token amount");
        } else {
            IERC20(tokenAddress).safeTransferFrom(msg.sender, address(this), amount);
        }

        crossChainSwaps[swapId] = CrossChainSwap({
            id: swapId,
            sourceChainId: block.chainid,
            destChainId: destChainId,
            initiator: msg.sender,
            counterparty: counterparty,
            tokenAddress: tokenAddress,
            amount: amount,
            hashLock: hashLock,
            timelock: block.timestamp + SWAP_TIMELOCK * 2,
            executed: false,
            refunded: false,
            secret: bytes32(0),
            proof: proof
        });

        usedHashLocks[hashLock] = true;

        emit CrossChainSwapCreated(swapId, block.chainid, destChainId);
        return swapId;
    }

    function executeCrossChainSwap(
        uint256 swapId,
        bytes32 secret,
        bytes32 proof
    ) external nonReentrant whenNotPaused {
        CrossChainSwap storage swap = crossChainSwaps[swapId];
        require(swap.initiator != address(0), "Swap not found");
        require(!swap.executed, "Already executed");
        require(!swap.refunded, "Already refunded");
        require(block.timestamp <= swap.timelock, "Swap expired");
        require(keccak256(abi.encodePacked(secret)) == swap.hashLock, "Invalid secret");
        require(swap.proof == proof, "Invalid proof");

        swap.executed = true;
        swap.secret = secret;

        // Transfer tokens
        if (swap.tokenAddress == address(0)) {
            (bool sentToCounterparty, ) = payable(swap.counterparty).call{value: swap.amount}("");
            require(sentToCounterparty, "Cross-chain swap transfer failed");
        } else {
            IERC20(swap.tokenAddress).safeTransfer(swap.counterparty, swap.amount);
        }

        emit CrossChainSwapExecuted(swapId, secret);
    }

    function refundCrossChainSwap(uint256 swapId) external nonReentrant whenNotPaused {
        CrossChainSwap storage swap = crossChainSwaps[swapId];
        require(swap.initiator != address(0), "Swap not found");
        require(!swap.executed, "Already executed");
        require(!swap.refunded, "Already refunded");
        require(block.timestamp > swap.timelock, "Timelock not expired");
        require(msg.sender == swap.initiator, "Only initiator can refund");

        swap.refunded = true;

        // Refund tokens
        if (swap.tokenAddress == address(0)) {
            (bool sentToInitiator, ) = payable(swap.initiator).call{value: swap.amount}("");
            require(sentToInitiator, "Cross-chain swap refund failed");
        } else {
            IERC20(swap.tokenAddress).safeTransfer(swap.initiator, swap.amount);
        }

        emit CrossChainSwapRefunded(swapId);
    }

    // ============ View Functions ============

    function getSwap(uint256 swapId) external view returns (Swap memory) {
        return swaps[swapId];
    }

    function getCrossChainSwap(uint256 swapId) external view returns (CrossChainSwap memory) {
        return crossChainSwaps[swapId];
    }

    function getUserSwaps(address user) external view returns (uint256[] memory) {
        return userSwaps[user];
    }

    function isHashLockUsed(bytes32 hashLock) external view returns (bool) {
        return usedHashLocks[hashLock];
    }

    function getSwapCount() external view returns (uint256) {
        return swapCounter;
    }

    function getCrossChainSwapCount() external view returns (uint256) {
        return crossChainSwapCounter;
    }

    // ============ Admin Functions ============

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ============ Receive ============

    receive() external payable {
        revert("AtomicSwap: direct deposits not supported");
    }
}