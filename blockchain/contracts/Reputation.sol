// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract Reputation {
    address public owner;
    mapping(address => bool) public authorizedRelayers;
    mapping(address => uint256) private scores;

    uint256 public constant MAX_REPUTATION = 10000;

    event RelayerUpdated(address indexed relayer, bool authorized);
    event ReputationIncreased(address indexed driver, uint256 points, uint256 score);
    event ReputationDecreased(address indexed driver, uint256 points, uint256 score);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    modifier onlyRelayer() {
        require(authorizedRelayers[msg.sender], "Not authorized relayer");
        _;
    }

    constructor(address initialRelayer) {
        owner = msg.sender;
        if (initialRelayer != address(0)) {
            authorizedRelayers[initialRelayer] = true;
            emit RelayerUpdated(initialRelayer, true);
        }
    }

    function setRelayer(address relayer, bool authorized) external onlyOwner {
        require(relayer != address(0), "Invalid relayer");
        authorizedRelayers[relayer] = authorized;
        emit RelayerUpdated(relayer, authorized);
    }

    function increaseReputation(address driver, uint256 points) external onlyRelayer {
        require(driver != address(0), "Invalid driver");
        uint256 newScore = scores[driver] + points;
        scores[driver] = newScore > MAX_REPUTATION ? MAX_REPUTATION : newScore;
        emit ReputationIncreased(driver, points, scores[driver]);
    }

    function decreaseReputation(address driver, uint256 points) external onlyRelayer {
        require(driver != address(0), "Invalid driver");
        uint256 current = scores[driver];
        scores[driver] = points >= current ? 0 : current - points;
        emit ReputationDecreased(driver, points, scores[driver]);
    }

    function getReputation(address driver) external view returns (uint256) {
        return scores[driver];
    }
}
