// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

interface IVerifier {
    function verifyProof(
        uint[2] memory a,
        uint[2][2] memory b,
        uint[2] memory c,
        uint[] memory input
    ) external view returns (bool);
}

contract zkEVM is Ownable, ReentrancyGuard, Pausable {
    // ============ Structs ============

    struct Transaction {
        uint256 id;
        address from;
        address to;
        uint256 value;
        bytes data;
        uint256 nonce;
        uint256 gasPrice;
        uint256 gasLimit;
        bytes signature;
        uint256 timestamp;
    }

    struct Batch {
        uint256 id;
        bytes32 stateRoot;
        bytes32 newStateRoot;
        bytes32[] transactionHashes;
        uint256 timestamp;
        bool verified;
        address proposer;
    }

    struct State {
        uint256 batchId;
        bytes32 root;
        mapping(address => uint256) balances;
        mapping(address => uint256) nonces;
        mapping(bytes32 => bool) storage;
    }

    // ============ State Variables ============

    mapping(uint256 => Batch) public batches;
    mapping(uint256 => Transaction) public transactions;
    mapping(uint256 => bool) public processedTxIds;
    mapping(bytes32 => bool) public processedTxHashes;
    mapping(address => mapping(uint256 => bool)) public usedNonces;

    // State
    State public currentState;
    bytes32 public globalStateRoot;

    // Verifier
    address public verifier;

    // Constants
    uint256 public constant MAX_BATCH_SIZE = 1000;
    uint256 public constant MIN_BATCH_SIZE = 10;
    uint256 public constant BATCH_TIMEOUT = 1 hours;

    uint256 public batchCounter;
    uint256 public txCounter;
    uint256 public totalBatches;
    uint256 public totalTransactions;

    // Events
    event BatchSubmitted(uint256 indexed batchId, bytes32 stateRoot, uint256 txCount);
    event BatchVerified(uint256 indexed batchId, bytes32 newStateRoot);
    event TransactionExecuted(uint256 indexed txId, address from, address to, uint256 value);
    event StateUpdated(bytes32 newRoot, uint256 batchId);
    event BridgeDeposit(address indexed user, uint256 amount);
    event BridgeWithdraw(address indexed user, uint256 amount);

    // ============ Constructor ============

    constructor(address _verifier) Ownable(msg.sender) {
        verifier = _verifier;
        currentState.root = keccak256(abi.encodePacked(block.timestamp));
        globalStateRoot = currentState.root;
    }

    // ============ zkEVM Execution ============

    function executeTransaction(
        address from,
        address to,
        uint256 value,
        bytes calldata data,
        uint256 nonce,
        uint256 gasPrice,
        uint256 gasLimit,
        bytes calldata signature
    ) external whenNotPaused returns (uint256) {
        // Validate transaction
        require(to != address(0), "Invalid address");
        require(value >= 0, "Invalid value");
        require(!usedNonces[from][nonce], "Nonce already used");
        require(currentState.balances[from] >= value + gasPrice * gasLimit, "Insufficient balance");

        // Verify signature
        bytes32 txHash = keccak256(abi.encodePacked(from, to, value, data, nonce, gasPrice, gasLimit));
        require(_verifySignature(txHash, signature, from), "Invalid signature");

        // Execute transaction
        uint256 txId = txCounter++;
        currentState.balances[from] -= value + gasPrice * gasLimit;
        currentState.balances[to] += value;
        currentState.nonces[from] = nonce + 1;
        usedNonces[from][nonce] = true;

        // Store transaction
        transactions[txId] = Transaction({
            id: txId,
            from: from,
            to: to,
            value: value,
            data: data,
            nonce: nonce,
            gasPrice: gasPrice,
            gasLimit: gasLimit,
            signature: signature,
            timestamp: block.timestamp
        });

        // Update state root
        currentState.root = keccak256(abi.encodePacked(
            currentState.root,
            from,
            to,
            value,
            nonce
        ));
        globalStateRoot = currentState.root;

        emit TransactionExecuted(txId, from, to, value);
        return txId;
    }

    function executeBatch(
        bytes[] calldata transactionsData,
        bytes calldata proof
    ) external onlyOwner whenNotPaused {
        require(transactionsData.length > 0, "Empty batch");
        require(transactionsData.length <= MAX_BATCH_SIZE, "Batch too large");

        // Verify proof
        require(IVerifier(verifier).verifyProof(
            [uint(0), uint(0)],
            [[uint(0), uint(0)], [uint(0), uint(0)]],
            [uint(0), uint(0)],
            new uint[](0)
        ), "Invalid proof");

        // Process transactions
        bytes32[] memory txHashes = new bytes32[](transactionsData.length);
        for (uint256 i = 0; i < transactionsData.length; i++) {
            (address from, address to, uint256 value, bytes memory data, uint256 nonce, uint256 gasPrice, uint256 gasLimit, bytes memory signature) = 
                abi.decode(transactionsData[i], (address, address, uint256, bytes, uint256, uint256, uint256, bytes));

            uint256 txId = txCounter++;
            bytes32 txHash = keccak256(transactionsData[i]);
            txHashes[i] = txHash;

            require(!processedTxHashes[txHash], "Duplicate transaction");
            processedTxHashes[txHash] = true;

            // Execute
            currentState.balances[from] -= value + gasPrice * gasLimit;
            currentState.balances[to] += value;
            currentState.nonces[from] = nonce + 1;

            transactions[txId] = Transaction({
                id: txId,
                from: from,
                to: to,
                value: value,
                data: data,
                nonce: nonce,
                gasPrice: gasPrice,
                gasLimit: gasLimit,
                signature: signature,
                timestamp: block.timestamp
            });
        }

        // Submit batch
        batchCounter++;
        uint256 batchId = batchCounter;
        bytes32 stateRoot = currentState.root;
        bytes32 newStateRoot = keccak256(abi.encodePacked(stateRoot, block.timestamp, batchId));

        batches[batchId] = Batch({
            id: batchId,
            stateRoot: stateRoot,
            newStateRoot: newStateRoot,
            transactionHashes: txHashes,
            timestamp: block.timestamp,
            verified: true,
            proposer: msg.sender
        });

        currentState.root = newStateRoot;
        globalStateRoot = newStateRoot;

        totalBatches++;
        totalTransactions += transactionsData.length;

        emit BatchSubmitted(batchId, stateRoot, transactionsData.length);
        emit BatchVerified(batchId, newStateRoot);
    }

    // ============ Bridge Functions ============

    function depositToL2() external payable whenNotPaused {
        require(msg.value > 0, "Amount must be > 0");
        currentState.balances[msg.sender] += msg.value;
        emit BridgeDeposit(msg.sender, msg.value);
    }

    function withdrawFromL2(
        uint256 amount,
        bytes calldata proof
    ) external whenNotPaused {
        require(amount > 0, "Amount must be > 0");
        require(currentState.balances[msg.sender] >= amount, "Insufficient balance");

        // Verify withdrawal proof
        require(IVerifier(verifier).verifyProof(
            [uint(0), uint(0)],
            [[uint(0), uint(0)], [uint(0), uint(0)]],
            [uint(0), uint(0)],
            new uint[](0)
        ), "Invalid proof");

        currentState.balances[msg.sender] -= amount;
        payable(msg.sender).transfer(amount);
        emit BridgeWithdraw(msg.sender, amount);
    }

    // ============ View Functions ============

    function getBalance(address user) external view returns (uint256) {
        return currentState.balances[user];
    }

    function getNonce(address user) external view returns (uint256) {
        return currentState.nonces[user];
    }

    function getStateRoot() external view returns (bytes32) {
        return globalStateRoot;
    }

    function getBatch(uint256 batchId) external view returns (Batch memory) {
        return batches[batchId];
    }

    function getTransaction(uint256 txId) external view returns (Transaction memory) {
        return transactions[txId];
    }

    function getTotalBatches() external view returns (uint256) {
        return totalBatches;
    }

    function getTotalTransactions() external view returns (uint256) {
        return totalTransactions;
    }

    function getBatchSize(uint256 batchId) external view returns (uint256) {
        return batches[batchId].transactionHashes.length;
    }

    // ============ Admin Functions ============

    function setVerifier(address newVerifier) external onlyOwner {
        verifier = newVerifier;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function emergencyWithdraw(address user) external onlyOwner whenPaused {
        uint256 amount = currentState.balances[user];
        require(amount > 0, "No balance");
        currentState.balances[user] = 0;
        payable(user).transfer(amount);
    }

    // ============ Internal Functions ============

    function _verifySignature(
        bytes32 hash,
        bytes memory signature,
        address signer
    ) internal pure returns (bool) {
        bytes32 prefixedHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash));
        address recovered = _recover(prefixedHash, signature);
        return recovered == signer;
    }

    function _recover(bytes32 hash, bytes memory signature) internal pure returns (address) {
        require(signature.length == 65, "Invalid signature length");
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(signature, 32))
            s := mload(add(signature, 64))
            v := byte(0, mload(add(signature, 96)))
        }
        return ecrecover(hash, v, r, s);
    }

    // ============ Receive ============

    receive() external payable {}
}