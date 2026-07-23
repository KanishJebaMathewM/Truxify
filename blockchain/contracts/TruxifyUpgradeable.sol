// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/CountersUpgradeable.sol";

contract TruxifyUpgradeable is 
    UUPSUpgradeable, 
    AccessControlUpgradeable, 
    PausableUpgradeable,
    ReentrancyGuardUpgradeable
{
    using CountersUpgradeable for CountersUpgradeable.Counter;

    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant DAO_ROLE = keccak256("DAO_ROLE");

    // Escrow struct
    struct Escrow {
        address customer;
        address driver;
        uint256 amount;
        bool released;
        bool disputed;
        uint256 createdAt;
        uint256 releasedAt;
    }

    // DAO Governance structs
    struct Proposal {
        address proposer;
        address newImplementation;
        string reason;
        uint256 createdAt;
        uint256 votingEndsAt;
        uint256 votesFor;
        uint256 votesAgainst;
        bool executed;
        bool passed;
    }

    // Upgrade history
    struct UpgradeRecord {
        address implementation;
        uint256 timestamp;
        string reason;
        address proposer;
    }

    CountersUpgradeable.Counter private _escrowIdCounter;
    CountersUpgradeable.Counter private _proposalIdCounter;
    CountersUpgradeable.Counter private _upgradeHistoryCounter;

    mapping(uint256 => Escrow) public escrows;
    mapping(uint256 => Proposal) public proposals;
    mapping(uint256 => UpgradeRecord) public upgradeHistory;
    mapping(uint256 => mapping(address => bool)) public hasVoted;

    uint256 public daoVotingPeriod;
    uint256 public daoQuorum;
    uint256 public daoThreshold;

    address public daoMultiSig;

    // Events
    event EscrowCreated(uint256 indexed escrowId, address customer, address driver, uint256 amount);
    event EscrowReleased(uint256 indexed escrowId, address driver, uint256 amount);
    event EscrowDisputed(uint256 indexed escrowId, address customer);
    event ProposalCreated(uint256 indexed proposalId, address proposer, address implementation);
    event VoteCast(uint256 indexed proposalId, address voter, bool support);
    event ProposalExecuted(uint256 indexed proposalId, bool passed);
    event ContractUpgraded(address indexed implementation, uint256 timestamp);
    event ContractPaused(address indexed pauser);
    event ContractUnpaused(address indexed unpauser);
    event EmergencyPauseTriggered(address indexed triggerer);

    // ============ Initializer ============
    function initialize() public initializer {
        __UUPSUpgradeable_init();
        __AccessControl_init();
        __Pausable_init();
        __ReentrancyGuard_init();

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(UPGRADER_ROLE, msg.sender);
        _grantRole(PAUSER_ROLE, msg.sender);

        daoVotingPeriod = 3 days;
        daoQuorum = 1000; // 1000 votes required
        daoThreshold = 60; // 60% approval required

        daoMultiSig = msg.sender;
    }

    // ============ UUPS Upgrade ============
    function _authorizeUpgrade(address newImplementation) 
        internal 
        override 
        onlyRole(UPGRADER_ROLE) 
    {
        // Only DAO can upgrade through governance
        // Emergency upgrades bypass DAO
    }

    // ============ Escrow Functions ============
    function createEscrow(
        address driver,
        uint256 amount
    ) external payable nonReentrant whenNotPaused returns (uint256) {
        require(msg.value == amount, "Amount mismatch");
        require(driver != address(0), "Invalid driver");
        require(amount > 0, "Amount must be > 0");

        _escrowIdCounter.increment();
        uint256 escrowId = _escrowIdCounter.current();

        escrows[escrowId] = Escrow({
            customer: msg.sender,
            driver: driver,
            amount: amount,
            released: false,
            disputed: false,
            createdAt: block.timestamp,
            releasedAt: 0
        });

        emit EscrowCreated(escrowId, msg.sender, driver, amount);
        return escrowId;
    }

    function releaseEscrow(uint256 escrowId) external nonReentrant whenNotPaused {
        Escrow storage escrow = escrows[escrowId];
        require(escrow.customer != address(0), "Escrow not found");
        require(!escrow.released, "Already released");
        require(msg.sender == escrow.driver || msg.sender == escrow.customer, "Not authorized");
        require(!escrow.disputed, "Escrow disputed");

        escrow.released = true;
        escrow.releasedAt = block.timestamp;

        (bool success, ) = payable(escrow.driver).call{value: escrow.amount}("");
        require(success, "Transfer failed");

        emit EscrowReleased(escrowId, escrow.driver, escrow.amount);
    }

    function disputeEscrow(uint256 escrowId) external whenNotPaused {
        Escrow storage escrow = escrows[escrowId];
        require(escrow.customer != address(0), "Escrow not found");
        require(msg.sender == escrow.customer, "Only customer can dispute");
        require(!escrow.disputed, "Already disputed");

        escrow.disputed = true;
        emit EscrowDisputed(escrowId, msg.sender);
    }

    // ============ DAO Governance ============
    function createProposal(
        address newImplementation,
        string memory reason
    ) external onlyRole(DAO_ROLE) returns (uint256) {
        require(newImplementation != address(0), "Invalid implementation");
        require(bytes(reason).length > 0, "Reason required");

        _proposalIdCounter.increment();
        uint256 proposalId = _proposalIdCounter.current();

        proposals[proposalId] = Proposal({
            proposer: msg.sender,
            newImplementation: newImplementation,
            reason: reason,
            createdAt: block.timestamp,
            votingEndsAt: block.timestamp + daoVotingPeriod,
            votesFor: 0,
            votesAgainst: 0,
            executed: false,
            passed: false
        });

        emit ProposalCreated(proposalId, msg.sender, newImplementation);
        return proposalId;
    }

    function vote(uint256 proposalId, bool support) external {
        Proposal storage proposal = proposals[proposalId];
        require(proposal.proposer != address(0), "Proposal not found");
        require(block.timestamp < proposal.votingEndsAt, "Voting ended");
        require(!hasVoted[proposalId][msg.sender], "Already voted");

        hasVoted[proposalId][msg.sender] = true;

        if (support) {
            proposal.votesFor++;
        } else {
            proposal.votesAgainst++;
        }

        emit VoteCast(proposalId, msg.sender, support);
    }

    function executeProposal(uint256 proposalId) external returns (bool) {
        Proposal storage proposal = proposals[proposalId];
        require(proposal.proposer != address(0), "Proposal not found");
        require(block.timestamp >= proposal.votingEndsAt, "Voting not ended");
        require(!proposal.executed, "Already executed");

        uint256 totalVotes = proposal.votesFor + proposal.votesAgainst;
        require(totalVotes >= daoQuorum, "Quorum not reached");

        bool passed = (proposal.votesFor * 100) / totalVotes >= daoThreshold;
        proposal.passed = passed;
        proposal.executed = true;

        if (passed) {
            _upgradeTo(proposal.newImplementation);
            
            _upgradeHistoryCounter.increment();
            uint256 historyId = _upgradeHistoryCounter.current();
            
            upgradeHistory[historyId] = UpgradeRecord({
                implementation: proposal.newImplementation,
                timestamp: block.timestamp,
                reason: proposal.reason,
                proposer: proposal.proposer
            });

            emit ContractUpgraded(proposal.newImplementation, block.timestamp);
        }

        emit ProposalExecuted(proposalId, passed);
        return passed;
    }

    function getProposalStatus(uint256 proposalId) external view returns (
        bool isActive,
        bool canExecute,
        uint256 votesFor,
        uint256 votesAgainst,
        uint256 totalVotes,
        bool passed
    ) {
        Proposal storage proposal = proposals[proposalId];
        require(proposal.proposer != address(0), "Proposal not found");

        isActive = block.timestamp < proposal.votingEndsAt;
        canExecute = !isActive && !proposal.executed;
        votesFor = proposal.votesFor;
        votesAgainst = proposal.votesAgainst;
        totalVotes = votesFor + votesAgainst;
        passed = proposal.passed;

        return (isActive, canExecute, votesFor, votesAgainst, totalVotes, passed);
    }

    // ============ Emergency Functions ============
    function emergencyPause() external onlyRole(PAUSER_ROLE) {
        _pause();
        emit EmergencyPauseTriggered(msg.sender);
    }

    function emergencyUnpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    function emergencyUpgrade(address newImplementation, string memory reason) 
        external 
        onlyRole(UPGRADER_ROLE) 
    {
        require(newImplementation != address(0), "Invalid implementation");
        require(bytes(reason).length > 0, "Reason required");

        _upgradeTo(newImplementation);

        _upgradeHistoryCounter.increment();
        uint256 historyId = _upgradeHistoryCounter.current();

        upgradeHistory[historyId] = UpgradeRecord({
            implementation: newImplementation,
            timestamp: block.timestamp,
            reason: string(abi.encodePacked("EMERGENCY: ", reason)),
            proposer: msg.sender
        });

        emit ContractUpgraded(newImplementation, block.timestamp);
    }

    // ============ View Functions ============
    function getEscrow(uint256 escrowId) external view returns (Escrow memory) {
        return escrows[escrowId];
    }

    function getUpgradeHistory(uint256 historyId) external view returns (UpgradeRecord memory) {
        return upgradeHistory[historyId];
    }

    function getUpgradeCount() external view returns (uint256) {
        return _upgradeHistoryCounter.current();
    }

    function getProposalCount() external view returns (uint256) {
        return _proposalIdCounter.current();
    }

    function getEscrowCount() external view returns (uint256) {
        return _escrowIdCounter.current();
    }

    // ============ DAO Configuration ============
    function setDAOVotingPeriod(uint256 newPeriod) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newPeriod >= 1 days, "Period too short");
        daoVotingPeriod = newPeriod;
    }

    function setDAOQuorum(uint256 newQuorum) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newQuorum > 0, "Quorum must be > 0");
        daoQuorum = newQuorum;
    }

    function setDAOThreshold(uint256 newThreshold) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newThreshold > 0 && newThreshold <= 100, "Threshold must be 1-100");
        daoThreshold = newThreshold;
    }

    function setDAOMultiSig(address newMultiSig) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newMultiSig != address(0), "Invalid address");
        daoMultiSig = newMultiSig;
    }

    // ============ Role Management ============
    function grantUpgraderRole(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        grantRole(UPGRADER_ROLE, account);
    }

    function grantPauserRole(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        grantRole(PAUSER_ROLE, account);
    }

    function grantDAORole(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        grantRole(DAO_ROLE, account);
    }

    // ============ Storage Gap ============

    uint256[50] private __gap;

    // ============ Receive ============
    receive() external payable {}
}