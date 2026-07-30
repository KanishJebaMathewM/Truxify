// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";



contract TruxifyUpgradeable is 
    UUPSUpgradeable, 
    AccessControlUpgradeable, 
    PausableUpgradeable
{

    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant DAO_ROLE = keccak256("DAO_ROLE");

    /// @notice Minimum delay before an emergency upgrade can be executed (2 days).
    ///         Gives the DAO time to detect and potentially block malicious upgrades.
    uint256 public constant EMERGENCY_UPGRADE_TIMELOCK = 2 days;

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

    uint256 private _escrowIdCounter;
    uint256 private _proposalIdCounter;
    uint256 private _upgradeHistoryCounter;

    // Manual reentrancy guard (ReentrancyGuardUpgradeable removed in OZ v5)
    uint256 private _guardStatus;
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;

    modifier nonReentrant() {
        require(_guardStatus != _ENTERED, "ReentrancyGuard: reentrant call");
        _guardStatus = _ENTERED;
        _;
        _guardStatus = _NOT_ENTERED;
    }

    mapping(uint256 => Escrow) public escrows;
    mapping(uint256 => Proposal) public proposals;
    mapping(uint256 => UpgradeRecord) public upgradeHistory;
    mapping(uint256 => mapping(address => bool)) public hasVoted;

    /// @notice Tracks implementation addresses approved by passed DAO proposals.
    ///         Set in executeProposal() and consumed/cleared in _authorizeUpgrade().
    mapping(address => bool) public daoApprovedUpgrades;

    /// @notice Timestamps for pending emergency upgrade requests.
    ///         Maps implementation address → block.timestamp when requested.
    ///         Zero means no pending request.
    mapping(address => uint256) public emergencyUpgradeRequests;

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

    /// @notice Emitted when a passed DAO proposal approves an upgrade.
    event UpgradeApproved(address indexed implementation, uint256 indexed proposalId);

    /// @notice Emitted when an emergency upgrade is requested (timelock starts).
    event EmergencyUpgradeRequested(address indexed implementation, uint256 timestamp, string reason);

    /// @notice Emitted when a pending emergency upgrade request is cancelled.
    event EmergencyUpgradeCancelled(address indexed implementation);

    // ============ Initializer ============
    function initialize() public initializer {
        __AccessControl_init();
        __Pausable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(UPGRADER_ROLE, msg.sender);
        _grantRole(PAUSER_ROLE, msg.sender);

        daoVotingPeriod = 3 days;
        daoQuorum = 1000; // 1000 votes required
        daoThreshold = 60; // 60% approval required

        daoMultiSig = msg.sender;
    }

    // ============ UUPS Upgrade ============
    /**
     * @dev Authorizes an upgrade only if:
     *       1. The implementation has been approved by a passed DAO proposal, OR
     *       2. A valid emergency upgrade request exists and the timelock has elapsed.
     *
     *      The DAO approval flag is consumed (deleted) after this check to prevent
     *      replay attacks (re-using the same approved upgrade twice).
     *
     *      The caller must have UPGRADER_ROLE to execute the actual upgradeTo()
     *      transaction.
     */
    function _authorizeUpgrade(address newImplementation) 
        internal 
        override 
    {
        // Check 1: DAO-approved upgrade (standard governance path)
        // The flag is set by executeProposal after a successful DAO vote.
        // No additional role check is needed - the DAO vote itself is the authorization.
        if (daoApprovedUpgrades[newImplementation]) {
            delete daoApprovedUpgrades[newImplementation];
            return;
        }

        // Check 2: Emergency upgrade with timelock (emergency path)
        uint256 requestTimestamp = emergencyUpgradeRequests[newImplementation];
        if (requestTimestamp != 0) {
            require(
                block.timestamp >= requestTimestamp + EMERGENCY_UPGRADE_TIMELOCK,
                "Emergency timelock not yet elapsed"
            );
            require(
                hasRole(UPGRADER_ROLE, msg.sender),
                "Must have UPGRADER_ROLE to execute upgrade"
            );
            delete emergencyUpgradeRequests[newImplementation];

            // Record upgrade history for emergency upgrades
            _upgradeHistoryCounter += 1;
            uint256 historyId = _upgradeHistoryCounter;
            upgradeHistory[historyId] = UpgradeRecord({
                implementation: newImplementation,
                timestamp: block.timestamp,
                reason: "Emergency upgrade",
                proposer: msg.sender
            });

            return;
        }

        // Neither condition met — reject the upgrade
        revert("Upgrade not approved by DAO");
    }

    // ============ Escrow Functions ============
    function createEscrow(
        address driver,
        uint256 amount
    ) external payable nonReentrant whenNotPaused returns (uint256) {
        require(msg.value == amount, "Amount mismatch");
        require(driver != address(0), "Invalid driver");
        require(amount > 0, "Amount must be > 0");

        _escrowIdCounter += 1;
        uint256 escrowId = _escrowIdCounter;

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

        _proposalIdCounter += 1;
        uint256 proposalId = _proposalIdCounter;

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
            // Set the DAO approval flag before calling upgradeToAndCall. The _authorizeUpgrade
            // hook will find this flag, consume it, and allow the upgrade to proceed.
            daoApprovedUpgrades[proposal.newImplementation] = true;
            emit UpgradeApproved(proposal.newImplementation, proposalId);

            // Triggers _authorizeUpgrade which checks daoApprovedUpgrades flag (+ emergency timelock)
            upgradeToAndCall(proposal.newImplementation, "");

            // Ensure the flag is cleaned up (should already be consumed by _authorizeUpgrade)
            delete daoApprovedUpgrades[proposal.newImplementation];

            _upgradeHistoryCounter += 1;
            uint256 historyId = _upgradeHistoryCounter;
            
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

    /**
     * @dev Register an emergency upgrade request. The upgrade is NOT executed
     *      immediately — it sets a timelock (EMERGENCY_UPGRADE_TIMELOCK).
     *      After the timelock elapses, anyone with UPGRADER_ROLE can call
     *      upgradeTo() which will route through _authorizeUpgrade() and check
     *      the pending request.
     *
     *      This delay gives the DAO time to detect and block malicious upgrades
     *      (e.g., by pausing the contract or cancelling via DEFAULT_ADMIN_ROLE).
     */
    function requestEmergencyUpgrade(address newImplementation, string memory reason) 
        external 
        onlyRole(UPGRADER_ROLE) 
    {
        require(newImplementation != address(0), "Invalid implementation");
        require(bytes(reason).length > 0, "Reason required");
        require(
            emergencyUpgradeRequests[newImplementation] == 0,
            "Emergency upgrade already requested for this implementation"
        );

        emergencyUpgradeRequests[newImplementation] = block.timestamp;

        emit EmergencyUpgradeRequested(newImplementation, block.timestamp, reason);
    }

    /**
     * @dev Cancel a pending emergency upgrade request. Only DEFAULT_ADMIN_ROLE
     *      can cancel, allowing the DAO admin to abort an emergency upgrade
     *      during the timelock window.
     */
    function cancelEmergencyUpgrade(address newImplementation) 
        external 
        onlyRole(DEFAULT_ADMIN_ROLE) 
    {
        require(
            emergencyUpgradeRequests[newImplementation] != 0,
            "No pending emergency upgrade for this implementation"
        );

        delete emergencyUpgradeRequests[newImplementation];

        emit EmergencyUpgradeCancelled(newImplementation);
    }

    // ============ View Functions ============
    function getEscrow(uint256 escrowId) external view returns (Escrow memory) {
        return escrows[escrowId];
    }

    function getUpgradeHistory(uint256 historyId) external view returns (UpgradeRecord memory) {
        return upgradeHistory[historyId];
    }

    function getUpgradeCount() external view returns (uint256) {
        return _upgradeHistoryCounter;
    }

    function getProposalCount() external view returns (uint256) {
        return _proposalIdCounter;
    }

    function getEscrowCount() external view returns (uint256) {
        return _escrowIdCounter;
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