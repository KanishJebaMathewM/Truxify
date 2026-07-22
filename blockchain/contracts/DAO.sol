// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Counters.sol";

contract DAO is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;
    using Counters for Counters.Counter;

    // ============ Structs ============

    struct Proposal {
        uint256 id;
        address proposer;
        string title;
        string description;
        bytes callData;
        address target;
        uint256 value;
        uint256 startTime;
        uint256 endTime;
        uint256 forVotes;
        uint256 againstVotes;
        uint256 abstainVotes;
        bool executed;
        bool passed;
        ProposalState state;
        ProposalType proposalType;
    }

    struct Member {
        address member;
        uint256 joinedAt;
        uint256 votingPower;
        bool isActive;
        uint256 proposalsSubmitted;
        uint256 proposalsVoted;
    }

    struct Treasury {
        uint256 balance;
        uint256 totalDeposited;
        uint256 totalWithdrawn;
        uint256 lastUpdated;
    }

    // ============ Enums ============

    enum ProposalState {
        PENDING,
        ACTIVE,
        PASSED,
        FAILED,
        EXECUTED,
        CANCELLED
    }

    enum ProposalType {
        GENERAL,
        TREASURY,
        GOVERNANCE,
        UPGRADE,
        MEMBERSHIP
    }

    // ============ State Variables ============

    mapping(uint256 => Proposal) public proposals;
    mapping(uint256 => mapping(address => bool)) public hasVoted;
    mapping(address => Member) public members;
    mapping(address => uint256[]) public memberProposals;

    Counters.Counter private _proposalCounter;
    Counters.Counter private _memberCounter;

    uint256 public votingPeriod = 7 days;
    uint256 public votingDelay = 1 hours;
    uint256 public quorum = 1000; // Minimum votes required
    uint256 public proposalThreshold = 100; // Minimum tokens to propose

    address public governanceToken;
    address public treasuryAddress;
    uint256 public totalMembers;

    // Events
    event ProposalCreated(uint256 indexed proposalId, address indexed proposer, string title);
    event VoteCast(uint256 indexed proposalId, address indexed voter, bool support, uint256 weight);
    event ProposalExecuted(uint256 indexed proposalId, bool passed);
    event ProposalCancelled(uint256 indexed proposalId, address indexed canceller);
    event MemberJoined(address indexed member, uint256 votingPower);
    event MemberLeft(address indexed member);
    event TreasuryDeposit(address indexed depositor, uint256 amount);
    event TreasuryWithdraw(address indexed withdrawer, uint256 amount);

    // ============ Modifiers ============

    modifier onlyMember() {
        require(members[msg.sender].isActive, "Not a member");
        _;
    }

    modifier onlyActiveProposal(uint256 proposalId) {
        require(proposals[proposalId].state == ProposalState.ACTIVE, "Proposal not active");
        _;
    }

    // ============ Constructor ============

    constructor(address _governanceToken, address _treasuryAddress) Ownable(msg.sender) {
        governanceToken = _governanceToken;
        treasuryAddress = _treasuryAddress;
    }

    // ============ Membership ============

    function joinDAO() external whenNotPaused {
        require(!members[msg.sender].isActive, "Already a member");
        require(IERC20(governanceToken).balanceOf(msg.sender) >= proposalThreshold, "Insufficient balance");

        _memberCounter.increment();
        members[msg.sender] = Member({
            member: msg.sender,
            joinedAt: block.timestamp,
            votingPower: IERC20(governanceToken).balanceOf(msg.sender),
            isActive: true,
            proposalsSubmitted: 0,
            proposalsVoted: 0
        });

        totalMembers++;
        emit MemberJoined(msg.sender, members[msg.sender].votingPower);
    }

    function leaveDAO() external onlyMember {
        members[msg.sender].isActive = false;
        totalMembers--;
        emit MemberLeft(msg.sender);
    }

    function updateVotingPower(address member) external {
        require(members[member].isActive, "Not a member");
        uint256 balance = IERC20(governanceToken).balanceOf(member);
        members[member].votingPower = balance;
    }

    // ============ Proposal Management ============

    function createProposal(
        string memory title,
        string memory description,
        bytes memory callData,
        address target,
        uint256 value,
        ProposalType proposalType
    ) external onlyMember whenNotPaused returns (uint256) {
        require(bytes(title).length > 0, "Title required");
        require(target != address(0), "Invalid target");
        require(members[msg.sender].votingPower >= proposalThreshold, "Insufficient voting power");

        _proposalCounter.increment();
        uint256 proposalId = _proposalCounter.current();

        proposals[proposalId] = Proposal({
            id: proposalId,
            proposer: msg.sender,
            title: title,
            description: description,
            callData: callData,
            target: target,
            value: value,
            startTime: block.timestamp + votingDelay,
            endTime: block.timestamp + votingDelay + votingPeriod,
            forVotes: 0,
            againstVotes: 0,
            abstainVotes: 0,
            executed: false,
            passed: false,
            state: ProposalState.PENDING,
            proposalType: proposalType
        });

        members[msg.sender].proposalsSubmitted++;
        memberProposals[msg.sender].push(proposalId);

        emit ProposalCreated(proposalId, msg.sender, title);
        return proposalId;
    }

    function castVote(
        uint256 proposalId,
        bool support,
        uint256 votingPower
    ) external onlyMember onlyActiveProposal(proposalId) {
        require(votingPower > 0, "No voting power");
        require(!hasVoted[proposalId][msg.sender], "Already voted");
        require(proposals[proposalId].state == ProposalState.ACTIVE, "Proposal not active");

        Proposal storage proposal = proposals[proposalId];

        if (support) {
            proposal.forVotes += votingPower;
        } else {
            proposal.againstVotes += votingPower;
        }

        hasVoted[proposalId][msg.sender] = true;
        members[msg.sender].proposalsVoted++;

        emit VoteCast(proposalId, msg.sender, support, votingPower);
    }

    function executeProposal(uint256 proposalId) external nonReentrant {
        Proposal storage proposal = proposals[proposalId];
        require(proposal.state == ProposalState.ACTIVE, "Proposal not active");
        require(block.timestamp >= proposal.endTime, "Voting not ended");
        require(!proposal.executed, "Already executed");

        uint256 totalVotes = proposal.forVotes + proposal.againstVotes + proposal.abstainVotes;
        require(totalVotes >= quorum, "Quorum not reached");

        bool passed = proposal.forVotes > proposal.againstVotes;
        proposal.passed = passed;
        proposal.executed = true;

        if (passed) {
            proposal.state = ProposalState.PASSED;
            // Execute transaction
            (bool success, ) = proposal.target.call{value: proposal.value}(proposal.callData);
            require(success, "Execution failed");
        } else {
            proposal.state = ProposalState.FAILED;
        }

        emit ProposalExecuted(proposalId, passed);
    }

    function cancelProposal(uint256 proposalId) external onlyOwner {
        Proposal storage proposal = proposals[proposalId];
        require(proposal.state == ProposalState.PENDING || proposal.state == ProposalState.ACTIVE, "Cannot cancel");
        proposal.state = ProposalState.CANCELLED;
        emit ProposalCancelled(proposalId, msg.sender);
    }

    // ============ Treasury Management ============

    function depositTreasury() external payable {
        require(msg.value > 0, "Amount must be > 0");
        // In production: update treasury state
        emit TreasuryDeposit(msg.sender, msg.value);
    }

    function withdrawTreasury(uint256 amount, address recipient) external onlyOwner nonReentrant {
        require(amount > 0, "Amount must be > 0");
        require(recipient != address(0), "Invalid recipient");
        require(address(this).balance >= amount, "Insufficient balance");

        payable(recipient).transfer(amount);
        emit TreasuryWithdraw(msg.sender, amount);
    }

    function treasuryProposal(
        address recipient,
        uint256 amount,
        string memory reason
    ) external onlyMember returns (uint256) {
        require(recipient != address(0), "Invalid recipient");
        require(amount > 0, "Amount must be > 0");

        bytes memory callData = abi.encodeWithSignature("withdrawTreasury(uint256,address)", amount, recipient);

        return createProposal(
            string(abi.encodePacked("Treasury Withdrawal: ", reason)),
            reason,
            callData,
            address(this),
            0,
            ProposalType.TREASURY
        );
    }

    // ============ Governance ============

    function governanceProposal(
        address target,
        bytes memory callData,
        string memory description
    ) external onlyMember returns (uint256) {
        return createProposal(
            "Governance Proposal",
            description,
            callData,
            target,
            0,
            ProposalType.GOVERNANCE
        );
    }

    function upgradeProposal(
        address implementation,
        string memory reason
    ) external onlyMember returns (uint256) {
        bytes memory callData = abi.encodeWithSignature("upgradeTo(address)", implementation);
        return createProposal(
            "Upgrade Proposal",
            reason,
            callData,
            address(this),
            0,
            ProposalType.UPGRADE
        );
    }

    // ============ View Functions ============

    function getProposal(uint256 proposalId) external view returns (Proposal memory) {
        return proposals[proposalId];
    }

    function getMember(address member) external view returns (Member memory) {
        return members[member];
    }

    function getProposalState(uint256 proposalId) external view returns (ProposalState) {
        Proposal storage proposal = proposals[proposalId];
        if (proposal.state == ProposalState.EXECUTED) return ProposalState.EXECUTED;
        if (proposal.state == ProposalState.CANCELLED) return ProposalState.CANCELLED;
        if (block.timestamp < proposal.startTime) return ProposalState.PENDING;
        if (block.timestamp <= proposal.endTime) return ProposalState.ACTIVE;
        if (proposal.executed) return ProposalState.EXECUTED;
        return proposal.passed ? ProposalState.PASSED : ProposalState.FAILED;
    }

    function getVoteCounts(uint256 proposalId) external view returns (uint256, uint256, uint256) {
        Proposal storage proposal = proposals[proposalId];
        return (proposal.forVotes, proposal.againstVotes, proposal.abstainVotes);
    }

    function getTotalProposals() external view returns (uint256) {
        return _proposalCounter.current();
    }

    function getTotalMembers() external view returns (uint256) {
        return totalMembers;
    }

    function getMemberProposals(address member) external view returns (uint256[] memory) {
        return memberProposals[member];
    }

    function getTreasuryBalance() external view returns (uint256) {
        return address(this).balance;
    }

    function getVotingPower(address member) external view returns (uint256) {
        return members[member].votingPower;
    }

    // ============ Admin Functions ============

    function setVotingPeriod(uint256 newPeriod) external onlyOwner {
        votingPeriod = newPeriod;
    }

    function setVotingDelay(uint256 newDelay) external onlyOwner {
        votingDelay = newDelay;
    }

    function setQuorum(uint256 newQuorum) external onlyOwner {
        quorum = newQuorum;
    }

    function setProposalThreshold(uint256 newThreshold) external onlyOwner {
        proposalThreshold = newThreshold;
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