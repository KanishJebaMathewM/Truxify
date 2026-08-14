// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title EnterpriseMultiSig
 * @dev M-of-N Multi-Signature Governance contract featuring a 48-hour timelock execution queue.
 */
contract EnterpriseMultiSig is ReentrancyGuard {

    struct Transaction {
        address destination;
        uint256 value;
        bytes data;
        bool executed;
        uint256 confirmations;
        uint256 executeAfter;
    }

    address[] public owners;
    mapping(address => bool) public isOwner;
    uint256 public requiredConfirmations;
    uint256 public constant TIMELOCK_DELAY = 2 days;

    Transaction[] public transactions;
    mapping(uint256 => mapping(address => bool)) public isConfirmed;

    event TransactionProposed(uint256 indexed txId, address indexed proposer, address indexed destination, uint256 value, uint256 executeAfter);
    event TransactionConfirmed(uint256 indexed txId, address indexed owner);
    event TransactionExecuted(uint256 indexed txId);

    modifier onlyOwner() {
        require(isOwner[msg.sender], "Not an owner");
        _;
    }

    constructor(address[] memory _owners, uint256 _requiredConfirmations) {
        require(_owners.length > 0, "Owners required");
        require(_requiredConfirmations > 0 && _requiredConfirmations <= _owners.length, "Invalid confirmation count");

        for (uint256 i = 0; i < _owners.length; i++) {
            address owner = _owners[i];
            require(owner != address(0), "Invalid owner");
            require(!isOwner[owner], "Owner not unique");
            isOwner[owner] = true;
            owners.push(owner);
        }
        requiredConfirmations = _requiredConfirmations;
    }

    function proposeTransaction(address _destination, uint256 _value, bytes calldata _data) external onlyOwner returns (uint256 txId) {
        txId = transactions.length;
        transactions.push(Transaction({
            destination: _destination,
            value: _value,
            data: _data,
            executed: false,
            confirmations: 1,
            executeAfter: block.timestamp + TIMELOCK_DELAY
        }));

        isConfirmed[txId][msg.sender] = true;
        emit TransactionProposed(txId, msg.sender, _destination, _value, block.timestamp + TIMELOCK_DELAY);
        emit TransactionConfirmed(txId, msg.sender);
    }

    function confirmTransaction(uint256 _txId) external onlyOwner {
        require(_txId < transactions.length, "Tx does not exist");
        require(!transactions[_txId].executed, "Tx already executed");
        require(!isConfirmed[_txId][msg.sender], "Already confirmed");

        transactions[_txId].confirmations += 1;
        isConfirmed[_txId][msg.sender] = true;
        emit TransactionConfirmed(_txId, msg.sender);
    }

    function executeTransaction(uint256 _txId) external onlyOwner nonReentrant {
        Transaction storage txn = transactions[_txId];
        require(!txn.executed, "Tx already executed");
        require(txn.confirmations >= requiredConfirmations, "Insufficient confirmations");
        require(block.timestamp >= txn.executeAfter, "Timelock delay active");

        txn.executed = true;
        (bool success, ) = txn.destination.call{value: txn.value}(txn.data);
        require(success, "Tx execution failed");

        emit TransactionExecuted(_txId);
    }
}
