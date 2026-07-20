// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/// @title Reputation System for Truxify
/// @notice Manages driver reputation scores capped at MAX_REPUTATION.
/// @dev Only authorized relayers can update scores.
contract Reputation is Ownable, Pausable {
    mapping(address => bool) public authorizedRelayers;
    mapping(address => uint256) private scores;

    uint256 public constant MAX_REPUTATION = 10000;

    event RelayerUpdated(address indexed relayer, bool authorized);
    event ReputationIncreased(address indexed driver, uint256 points, uint256 score);
    event ReputationDecreased(address indexed driver, uint256 points, uint256 score);

    modifier onlyRelayer() {
        require(authorizedRelayers[msg.sender], "Not authorized relayer");
        _;
    }

    /// @notice Initializes the contract and sets the initial relayer.
    /// @param initialRelayer Address of the first authorized relayer.
    constructor(address initialRelayer) Ownable(msg.sender) {
        if (initialRelayer != address(0)) {
            authorizedRelayers[initialRelayer] = true;
            emit RelayerUpdated(initialRelayer, true);
        }
    }

    /// @notice Adds or removes a relayer.
    /// @param relayer Address of the relayer.
    /// @param authorized Boolean indicating if they are authorized.
    function setRelayer(address relayer, bool authorized) external onlyOwner {
        require(relayer != address(0), "Invalid relayer");
        authorizedRelayers[relayer] = authorized;
        emit RelayerUpdated(relayer, authorized);
    }

    /// @notice Pauses the contract, preventing score updates.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Unpauses the contract.
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Increases the reputation of a driver.
    /// @param driver Address of the driver.
    /// @param points Amount to increase.
    function increaseReputation(address driver, uint256 points) external onlyRelayer whenNotPaused {
        require(points > 0, "Points must be > 0");
        require(driver != address(0), "Invalid driver");
        require(points > 0, "Points must be greater than zero");
        uint256 current = scores[driver];
        if (current >= MAX_REPUTATION) revert("already at max reputation");
        uint256 newScore = current + points;
        if (newScore > MAX_REPUTATION) {
            scores[driver] = MAX_REPUTATION;
        } else {
            scores[driver] = newScore;
        }
        emit ReputationIncreased(driver, points, scores[driver]);
    }

    /// @notice Decreases the reputation of a driver.
    /// @param driver Address of the driver.
    /// @param points Amount to decrease.
    function decreaseReputation(address driver, uint256 points) external onlyRelayer whenNotPaused {
        require(points > 0, "Points must be > 0");
        require(driver != address(0), "Invalid driver");
        require(points > 0, "Points must be greater than zero");
        uint256 current = scores[driver];
        scores[driver] = points >= current ? 0 : current - points;
        emit ReputationDecreased(driver, points, scores[driver]);
    }

    /// @notice Gets the current reputation score of a driver.
    /// @param driver Address of the driver.
    /// @return Current reputation score.
    function getReputation(address driver) external view returns (uint256) {
        return scores[driver];
    }
}
