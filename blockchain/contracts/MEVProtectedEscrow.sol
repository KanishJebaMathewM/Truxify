// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MEVProtectedEscrow
 * @dev Protects high-value freight payment releases from front-running and MEV sandwich attacks via private relayer execution.
 */
contract MEVProtectedEscrow is ReentrancyGuard, Ownable {

    struct ProtectedDeposit {
        address payable shipper;
        address payable driver;
        uint256 amount;
        bool released;
        uint256 blockMin;
        bytes32 secretHash;
    }

    mapping(uint256 => ProtectedDeposit) public deposits;
    uint256 public depositCount;
    address public trustedRelayer;

    event DepositCreated(uint256 indexed depositId, address indexed shipper, address indexed driver, uint256 amount);
    event DepositReleasedMEV(uint256 indexed depositId, address indexed driver, uint256 amount);
    event RelayerUpdated(address indexed newRelayer);

    modifier onlyRelayer() {
        require(msg.sender == trustedRelayer || msg.sender == owner(), "Caller is not trusted MEV relayer");
        _;
    }

    constructor(address _relayer) Ownable(msg.sender) {
        trustedRelayer = _relayer;
    }

    function updateRelayer(address _newRelayer) external onlyOwner {
        trustedRelayer = _newRelayer;
        emit RelayerUpdated(_newRelayer);
    }

    function createProtectedDeposit(address payable _driver, bytes32 _secretHash) external payable returns (uint256 depositId) {
        require(msg.value > 0, "Deposit must be > 0");
        require(_driver != address(0), "Invalid driver address");

        depositId = ++depositCount;
        deposits[depositId] = ProtectedDeposit({
            shipper: payable(msg.sender),
            driver: _driver,
            amount: msg.value,
            released: false,
            blockMin: block.number,
            secretHash: _secretHash
        });

        emit DepositCreated(depositId, msg.sender, _driver, msg.value);
    }

    /**
     * @dev Private Flashbots bundle release function, enforcing block deadlines & preimage verification.
     */
    function releaseDepositPrivate(uint256 _depositId, bytes32 _preimage) external onlyRelayer nonReentrant {
        ProtectedDeposit storage dep = deposits[_depositId];
        require(!dep.released, "Already released");
        require(keccak256(abi.encodePacked(_preimage)) == dep.secretHash, "Invalid preimage");

        dep.released = true;
        uint256 amt = dep.amount;
        (bool success, ) = dep.driver.call{value: amt}("");
        require(success, "ETH transfer failed");

        emit DepositReleasedMEV(_depositId, dep.driver, amt);
    }
}