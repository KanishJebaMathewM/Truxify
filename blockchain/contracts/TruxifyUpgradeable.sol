// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";



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

    /// @notice Mandatory delay between a DAO proposal passing its vote and the
    ///         actual implementation swap being executed. Gives token holders
    ///         and admins time to notice and pause/react to a malicious but
    ///         technically-passed proposal before it takes effect.
    uint256 public constant UPGRADE_EXECUTION_DELAY = 2 days;

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

    /// @notice Implementations pre-approved by DEFAULT_ADMIN_ROLE as safe to
    ///         propose for an upgrade. createProposal reverts for any
    ///         implementation not in this allowlist, so a compromised or
    ///         Sybil-controlled DAO_ROLE account cannot even put an arbitrary
    ///         attacker-chosen implementation up for a vote.
    mapping(address => bool) public approvedImplementations;

    uint256 public daoVotingPeriod;

    /// @notice Quorum required to execute a proposal, expressed in basis
    ///         points (1/100 of a percent) of governanceToken's totalSupply().
    ///         E.g. 1000 = 10% of supply must have voted (for or against)
    ///         before a proposal can be executed. Replaces the old
    ///         one-address-one-vote raw vote count, which any Sybil attacker
    ///         could reach by creating throwaway addresses.
    uint256 public daoQuorumBps;

    uint256 public daoThreshold;

    address public daoMultiSig;

    /// @notice ERC20 token used to weight DAO votes. Voting power for an
    ///         address is its current token balance — an address holding no
    ///         tokens has no voting power, regardless of how many addresses
    ///         it controls.
    IERC20 public governanceToken;

    // Events
    event EscrowCreated(uint256 indexed escrowId, address customer, address driver, uint256 amount);
    event EscrowReleased(uint256 indexed escrowId, address driver, uint256 amount);
    event EscrowDisputed(uint256 indexed escrowId, address customer);
    event ProposalCreated(uint256 indexed proposalId, address proposer, address implementation);
    event VoteCast(uint256 indexed proposalId, address voter, bool support, uint256 weight);
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

    /// @notice Emitted when the governance token used to weight votes is set/changed.
    event GovernanceTokenUpdated(address indexed token);

    /// @notice Emitted when an implementation's allowlist status changes.
    event ImplementationApprovalUpdated(address indexed implementation, bool approved);

    // ============ Constructor ============

    /// @notice The implementation contract is never used directly, only behind a
    ///         UUPS proxy. Locking initialization here prevents an attacker from
    ///         calling initialize() on the implementation itself and seizing the
    ///         DEFAULT_ADMIN_ROLE (and thereby upgrade rights).
    constructor() {
        _disableInitializers();
    }

    // ============ Initializer ============
    function initialize() public initializer {
        __AccessControl_init();
        __Pausable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(UPGRADER_ROLE, msg.sender);
        _grantRole(PAUSER_ROLE, msg.sender);

        daoVotingPeriod = 3 days;
        daoQuorumBps = 1000; // 10% of governance token supply required
        daoThreshold = 60; // 60% approval required

        daoMultiSig = msg.sender;
    }

    // ============ Governance Configuration ============

    /// @notice Sets the ERC20 token whose balances weight DAO votes. Until
    ///         this is set, vote() and executeProposal() cannot be used —
    ///         there is deliberately no unweighted fallback.
    function setGovernanceToken(address token) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(token != address(0), "Invalid token");
        governanceToken = IERC20(token);
        emit GovernanceTokenUpdated(token);
    }

    /// @notice Sets the DAO execution quorum as basis points of the
    ///         governance token's totalSupply() (10000 = 100%).
    function setDAOQuorumBps(uint256 newQuorumBps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newQuorumBps > 0 && newQuorumBps <= 10000, "Quorum bps must be 1-10000");
        daoQuorumBps = newQuorumBps;
    }

    /// @notice Adds or removes an implementation from the trusted-implementation
    ///         allowlist. createProposal() reverts for any implementation not
    ///         on this list, so a passing vote can never install arbitrary,
    ///         unvetted bytecode.
    function setApprovedImplementation(address implementation, bool approved) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(implementation != address(0), "Invalid implementation");
        approvedImplementations[implementation] = approved;
        emit ImplementationApprovalUpdated(implementation, approved);
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

    function releaseEscrow(uint256 escrowId) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant whenNotPaused {
    Escrow storage escrow = escrows[escrowId];
    require(escrow.customer != address(0), "Escrow not found");
    require(!escrow.released, "Already released");
    require(!escrow.disputed, "Escrow disputed");

    escrow.released = true;
    escrow.releasedAt = block.timestamp;

    (bool success, ) = payable(escrow.driver).call{value: escrow.amount}("");
    require(success, "Transfer failed");

    emit EscrowReleased(escrowId, escrow.driver, escrow.amount);
}

function disputeEscrow(uint256 escrowId) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant whenNotPaused {
    Escrow storage escrow = escrows[escrowId];
    require(escrow.customer != address(0), "Escrow not found");
    require(!escrow.disputed, "Already disputed");
    require(!escrow.released, "Already released");

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
        require(approvedImplementations[newImplementation], "Implementation not approved");

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
        require(address(governanceToken) != address(0), "Governance token not configured");

        // Voting power comes from token balance, not address count. An
        // attacker who spins up 1000 empty addresses gets zero extra votes —
        // they'd need to actually acquire 1000 addresses' worth of tokens.
        uint256 weight = governanceToken.balanceOf(msg.sender);
        require(weight > 0, "No voting power");

        hasVoted[proposalId][msg.sender] = true;

        if (support) {
            proposal.votesFor += weight;
        } else {
            proposal.votesAgainst += weight;
        }

        emit VoteCast(proposalId, msg.sender, support, weight);
    }

    function executeProposal(uint256 proposalId) external onlyRole(UPGRADER_ROLE) returns (bool) {
        Proposal storage proposal = proposals[proposalId];
        require(proposal.proposer != address(0), "Proposal not found");
        require(block.timestamp >= proposal.votingEndsAt, "Voting not ended");
        require(!proposal.executed, "Already executed");
        require(address(governanceToken) != address(0), "Governance token not configured");

        uint256 totalVotes = proposal.votesFor + proposal.votesAgainst;
        uint256 requiredQuorum = (governanceToken.totalSupply() * daoQuorumBps) / 10000;
        require(totalVotes >= requiredQuorum, "Quorum not reached");

        bool passed = (proposal.votesFor * 100) / totalVotes >= daoThreshold;

        if (passed) {
            // The mandatory delay only applies to proposals that actually
            // passed and are about to install new bytecode — this gives
            // token holders/admins a final window to notice and react
            // (e.g. pause, or revoke the implementation's allowlist entry)
            // before the upgrade takes effect.
            require(
                block.timestamp >= proposal.votingEndsAt + UPGRADE_EXECUTION_DELAY,
                "Execution timelock not elapsed"
            );
        }

        proposal.passed = passed;
        proposal.executed = true;

        if (passed) {
            require(approvedImplementations[proposal.newImplementation], "Implementation not approved");
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