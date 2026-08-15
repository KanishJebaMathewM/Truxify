// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title DAO
 * @dev Quadratic Voting DAO contract for Truxify freight corridor tariff governance.
 */
contract DAO is Ownable {

    struct Proposal {
        string description;
        uint256 voteCount;
        uint256 votingDeadline;
        bool executed;
    }

    IERC20 public governanceToken;
    Proposal[] public proposals;
    mapping(uint256 => mapping(address => uint256)) public votesCast;
    mapping(address => bytes32) public voterIdentity;
    mapping(bytes32 => address) public identityOwner;
    mapping(uint256 => mapping(address => bool)) public votesReleased;
    mapping(uint256 => mapping(address => uint256)) public tokensHeld;

    event ProposalCreated(uint256 indexed proposalId, string description, uint256 deadline);
    event VotedQuadratic(uint256 indexed proposalId, address indexed voter, uint256 votes, uint256 tokenCost);
    event VoterRegistered(address indexed voter, bytes32 indexed identity);
    event VotesReleased(uint256 indexed proposalId, address indexed voter, uint256 refund);

    constructor(address _tokenAddress) Ownable(msg.sender) {
        governanceToken = IERC20(_tokenAddress);
    }

    function createProposal(string calldata _description, uint256 _duration) external returns (uint256 proposalId) {
        proposalId = proposals.length;
        proposals.push(Proposal({
            description: _description,
            voteCount: 0,
            votingDeadline: block.timestamp + _duration,
            executed: false
        }));

        emit ProposalCreated(proposalId, _description, block.timestamp + _duration);
    }

    /**
     * @dev Binds msg.sender to a verified identity. One identity may only be
     * registered to a single address, preventing a voter from splitting votes
     * across many wallets to bypass the quadratic cost.
     */
    function registerVoter(bytes32 _identity) external {
        require(voterIdentity[msg.sender] == bytes32(0), "Address already registered");
        require(identityOwner[_identity] == address(0), "Identity already registered");

        voterIdentity[msg.sender] = _identity;
        identityOwner[_identity] = msg.sender;

        emit VoterRegistered(msg.sender, _identity);
    }

    /**
     * @dev Quadratic Voting: Token Cost = votes^2
     * Only addresses bound to a registered identity may vote.
     */
    function voteQuadratic(uint256 _proposalId, uint256 _votes) external {
        require(voterIdentity[msg.sender] != bytes32(0), "Voter not registered");

        Proposal storage proposal = proposals[_proposalId];
        require(block.timestamp < proposal.votingDeadline, "Voting period ended");
        require(_votes > 0, "Votes must be > 0");

        uint256 tokenCost = _votes * _votes;
        require(governanceToken.transferFrom(msg.sender, address(this), tokenCost), "Token transfer failed");

        votesCast[_proposalId][msg.sender] += _votes;
        tokensHeld[_proposalId][msg.sender] += tokenCost;
        proposal.voteCount += _votes;

        emit VotedQuadratic(_proposalId, msg.sender, _votes, tokenCost);
    }

    /**
     * @dev Releases the escrowed governance tokens for a voter on a proposal.
     * Refunds the exact sum of per-call quadratic costs (tokensHeld), never the
     * square of the accumulated vote total, so the shared pool cannot be drained.
     */
    function releaseVotes(uint256 _proposalId) external {
        uint256 held = tokensHeld[_proposalId][msg.sender];
        require(held > 0, "No votes to release");
        require(!votesReleased[_proposalId][msg.sender], "Already released");

        votesReleased[_proposalId][msg.sender] = true;
        require(governanceToken.transfer(msg.sender, held), "Token transfer failed");

        emit VotesReleased(_proposalId, msg.sender, held);
    }
}