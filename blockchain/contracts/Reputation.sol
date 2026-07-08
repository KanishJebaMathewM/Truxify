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

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid owner");
        owner = newOwner;
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

    function batchIncreaseReputation(
        address[] calldata drivers,
        uint256[] calldata points
    ) external onlyRelayer {
        require(drivers.length == points.length, "Array length mismatch");
        for (uint256 i = 0; i < drivers.length; i++) {
            require(drivers[i] != address(0), "Invalid driver");
            uint256 newScore = scores[drivers[i]] + points[i];
            scores[drivers[i]] = newScore > MAX_REPUTATION ? MAX_REPUTATION : newScore;
            emit ReputationIncreased(drivers[i], points[i], scores[drivers[i]]);
        }
    }

    function getReputation(address driver) external view returns (uint256) {
        return scores[driver];
    }

    function getReputations(address[] calldata drivers) external view returns (uint256[] memory) {
        uint256[] memory result = new uint256[](drivers.length);
        for (uint256 i = 0; i < drivers.length; i++) {
            result[i] = scores[drivers[i]];
        }
        return result;
    }
}
