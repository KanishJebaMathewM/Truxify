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
    function emergencyUpgrade(address newImplementation, string memory reason) external;
    function getEscrow(uint256 escrowId) external view returns (address, address, uint256, bool, bool, uint256, uint256);
}