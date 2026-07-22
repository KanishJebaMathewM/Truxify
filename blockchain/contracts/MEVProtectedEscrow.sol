// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract MEVProtectedEscrow is Ownable, ReentrancyGuard, Pausable {
    using ECDSA for bytes32;

    // ============ Structs ============

    struct Escrow {
        address customer;
        address driver;
        uint256 amount;
        bool released;
        bool disputed;
        uint256 createdAt;
        uint256 releasedAt;
        bytes32 commitHash;
        uint256 revealDeadline;
        bool revealed;
        bytes32 secret;
    }

    struct Commitment {
        bytes32 commitHash;
        uint256 timestamp;
        address user;
        bool revealed;
        bytes32 secret;
        uint256 revealBlock;
    }

    // ============ State Variables ============

    mapping(uint256 => Escrow) public escrows;
    mapping(address => bytes32) public userCommitments;
    mapping(bytes32 => bool) public usedCommits;
    mapping(address => uint256) public userNonces;

    uint256 public escrowCounter;
    uint256 public commitRevealPeriod = 10; // blocks
    uint256 public flashbotsProtection = 1; // blocks

    // MEV Protection Parameters
    uint256 public minPriorityFee = 1 gwei;
    uint256 public maxPriorityFee = 100 gwei;
    uint256 public gasPriceBuffer = 10; // percentage

    // Events
    event EscrowCreated(uint256 indexed escrowId, address customer, address driver, uint256 amount);
    event EscrowReleased(uint256 indexed escrowId, address driver, uint256 amount);
    event EscrowDisputed(uint256 indexed escrowId, address customer);
    event CommitmentCreated(address indexed user, bytes32 commitHash);
    event CommitmentRevealed(address indexed user, bytes32 secret);
    event MEVProtected(uint256 indexed escrowId, uint256 protectionLevel);

    // ============ Constructor ============

    constructor() Ownable(msg.sender) {}

    // ============ Commit-Reveal Mechanism ============

    function createCommitment(bytes32 secretHash) external whenNotPaused {
        require(!usedCommits[secretHash], "Commit already used");
        
        userCommitments[msg.sender] = secretHash;
        usedCommits[secretHash] = true;
        
        emit CommitmentCreated(msg.sender, secretHash);
    }

    function revealCommitment(bytes32 secret) external whenNotPaused {
        bytes32 commitHash = keccak256(abi.encodePacked(secret, msg.sender));
        require(userCommitments[msg.sender] == commitHash, "Invalid commit");
        require(!usedCommits[commitHash], "Already revealed");

        usedCommits[commitHash] = true;
        
        emit CommitmentRevealed(msg.sender, secret);
    }

    // ============ MEV Protected Escrow ============

    function createEscrow(
        address driver,
        bytes32 secretHash
    ) external payable nonReentrant whenNotPaused {
        require(msg.value > 0, "Amount must be > 0");
        require(driver != address(0), "Invalid driver");
        require(usedCommits[secretHash], "Commit not created");
        require(userCommitments[msg.sender] == secretHash, "Invalid commit");

        escrowCounter++;
        uint256 escrowId = escrowCounter;

        escrows[escrowId] = Escrow({
            customer: msg.sender,
            driver: driver,
            amount: msg.value,
            released: false,
            disputed: false,
            createdAt: block.timestamp,
            releasedAt: 0,
            commitHash: secretHash,
            revealDeadline: block.number + commitRevealPeriod,
            revealed: false,
            secret: 0
        });

        emit EscrowCreated(escrowId, msg.sender, driver, msg.value);
        emit MEVProtected(escrowId, 1);
    }

    function releaseEscrowWithProof(
        uint256 escrowId,
        bytes32 secret,
        bytes calldata proof
    ) external nonReentrant whenNotPaused {
        Escrow storage escrow = escrows[escrowId];
        require(escrow.customer != address(0), "Escrow not found");
        require(!escrow.released, "Already released");
        require(msg.sender == owner(), "Only owner can release");
        require(!escrow.disputed, "Escrow disputed");

        // Verify commit-reveal
        bytes32 commitHash = keccak256(abi.encodePacked(secret, escrow.customer));
        require(commitHash == escrow.commitHash, "Invalid secret");

        // Verify proof (Flashbots/MEV protection)
        require(_verifyMEVProof(proof, escrowId), "Invalid MEV proof");

        escrow.released = true;
        escrow.releasedAt = block.timestamp;
        escrow.revealed = true;
        escrow.secret = secret;

        (bool success, ) = payable(escrow.driver).call{value: escrow.amount}("");
        require(success, "Transfer failed");

        emit EscrowReleased(escrowId, escrow.driver, escrow.amount);
    }

    function disputeEscrowWithProof(
        uint256 escrowId,
        bytes calldata proof
    ) external whenNotPaused {
        Escrow storage escrow = escrows[escrowId];
        require(escrow.customer != address(0), "Escrow not found");
        require(msg.sender == escrow.customer, "Only customer can dispute");
        require(!escrow.disputed, "Already disputed");

        // Verify dispute proof
        require(_verifyDisputeProof(proof, escrowId), "Invalid dispute proof");

        escrow.disputed = true;

        emit EscrowDisputed(escrowId, msg.sender);
    }

    // ============ MEV Protection Functions ============

    function _verifyMEVProof(bytes memory proof, uint256 escrowId) internal view returns (bool) {
        // In production: verify Flashbots bundle signature
        // Check if transaction is front-run protected
        
        // 1. Check block number (prevent back-running)
        require(block.number > escrows[escrowId].createdAt + flashbotsProtection, "Too early");
        
        // 2. Check gas price (prevent front-running)
        require(tx.gasprice >= minPriorityFee, "Gas price too low");
        require(tx.gasprice <= maxPriorityFee, "Gas price too high");
        
        // 3. Check commit-reveal deadline
        require(block.number <= escrows[escrowId].revealDeadline, "Reveal deadline passed");
        
        return true;
    }

    function _verifyDisputeProof(bytes memory proof, uint256 escrowId) internal view returns (bool) {
        require(proof.length > 0, "Empty proof");
        // Verify validator signature on the dispute
        bytes32 messageHash = keccak256(abi.encodePacked(escrowId, escrows[escrowId].customer, escrows[escrowId].driver));
        bytes32 ethSignedMessageHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash));
        address validator = ecrecover(
            ethSignedMessageHash,
            uint8(proof[0]),
            bytes32(proof[1:33]),
            bytes32(proof[33:65])
        );
        return validator == owner();
    }

    // ============ Flashbots Integration ============

    function submitFlashbotsBundle(
        uint256 escrowId,
        bytes calldata bundleData
    ) external onlyOwner whenNotPaused {
        // In production: submit bundle to Flashbots relay
        // For now, mark as MEV protected
        emit MEVProtected(escrowId, 2);
    }

    // ============ View Functions ============

    function getEscrow(uint256 escrowId) external view returns (Escrow memory) {
        return escrows[escrowId];
    }

    function getCommitment(address user) external view returns (bytes32) {
        return userCommitments[user];
    }

    function isCommitUsed(bytes32 commitHash) external view returns (bool) {
        return usedCommits[commitHash];
    }

    function getMEVProtectionLevel(uint256 escrowId) external view returns (uint256) {
        Escrow storage escrow = escrows[escrowId];
        if (escrow.customer == address(0)) return 0;
        if (block.number > escrow.createdAt + flashbotsProtection) return 2;
        return 1;
    }

    // ============ Admin Functions ============

    function setCommitRevealPeriod(uint256 newPeriod) external onlyOwner {
        commitRevealPeriod = newPeriod;
    }

    function setFlashbotsProtection(uint256 newProtection) external onlyOwner {
        flashbotsProtection = newProtection;
    }

    function setMinPriorityFee(uint256 newFee) external onlyOwner {
        minPriorityFee = newFee;
    }

    function setMaxPriorityFee(uint256 newFee) external onlyOwner {
        maxPriorityFee = newFee;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ============ Receive ============

    receive() external payable {}
}