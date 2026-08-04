// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface ITruxifyUpgradeable {
    function createEscrow(address driver, uint256 amount) external payable returns (uint256);
    function releaseEscrow(uint256 escrowId) external;
    function disputeEscrow(uint256 escrowId) external;
    function createProposal(address newImplementation, string memory reason) external returns (uint256);
    function vote(uint256 proposalId, bool support) external;
    function executeProposal(uint256 proposalId) external returns (bool);
    function emergencyPause() external;
    function emergencyUnpause() external;
    function requestEmergencyUpgrade(address newImplementation, string memory reason) external;
    function cancelEmergencyUpgrade(address newImplementation) external;
    function getEscrow(uint256 escrowId) external view returns (address, address, uint256, bool, bool, uint256, uint256);
    function daoApprovedUpgrades(address implementation) external view returns (bool);
    function emergencyUpgradeRequests(address implementation) external view returns (uint256);
    function EMERGENCY_UPGRADE_TIMELOCK() external view returns (uint256);
    function UPGRADE_EXECUTION_DELAY() external view returns (uint256);
    function setGovernanceToken(address token) external;
    function setDAOQuorumBps(uint256 newQuorumBps) external;
    function setApprovedImplementation(address implementation, bool approved) external;
    function governanceToken() external view returns (address);
    function daoQuorumBps() external view returns (uint256);
    function approvedImplementations(address implementation) external view returns (bool);
}