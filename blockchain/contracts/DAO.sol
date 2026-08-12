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

    event ProposalCreated(uint256 indexed proposalId, string description, uint256 deadline);
    event VotedQuadratic(uint256 indexed proposalId, address indexed voter, uint256 votes, uint256 tokenCost);

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
     * @dev Quadratic Voting: Token Cost = votes^2
     *
     *      The cost is charged on the caller's cumulative votes for the
     *      proposal: (existing + new)^2 - existing^2. Charging votes^2 per
     *      call would let a voter split their votes across many small calls
     *      (or many addresses) and pay a linear total cost instead of the
     *      quadratic price.
     */
    function voteQuadratic(uint256 _proposalId, uint256 _votes) external {
        Proposal storage proposal = proposals[_proposalId];
        require(block.timestamp < proposal.votingDeadline, "Voting period ended");
        require(_votes > 0, "Votes must be > 0");

        uint256 existingVotes = votesCast[_proposalId][msg.sender];
        uint256 totalVotes = existingVotes + _votes;

        uint256 tokenCost = totalVotes * totalVotes - existingVotes * existingVotes;
        require(governanceToken.transferFrom(msg.sender, address(this), tokenCost), "Token transfer failed");

        votesCast[_proposalId][msg.sender] = totalVotes;
        proposal.voteCount += _votes;

        emit VotedQuadratic(_proposalId, msg.sender, _votes, tokenCost);
    }
}